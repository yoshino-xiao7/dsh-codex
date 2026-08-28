import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

const workflowRoot = new URL("../.github/workflows/", import.meta.url)
const REVIEWED_WORKFLOWS = Object.freeze([
  "ci.yml",
  "codeql.yml",
  "compatibility.yml",
  "release.yml",
])

async function workflow(name) {
  return readFile(new URL(name, workflowRoot), "utf8")
}

async function workflowNames() {
  return (await readdir(workflowRoot))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort()
}

function workflowJob(source, jobName) {
  const jobsOffset = source.indexOf("\njobs:\n")
  assert.notEqual(jobsOffset, -1, "workflow jobs section is missing")
  const header = `  ${jobName}:\n`
  const start = source.indexOf(header, jobsOffset)
  assert.notEqual(start, -1, `workflow job ${jobName} is missing`)
  const nextHeader = /^  [a-zA-Z0-9_-]+:\n/gmu
  nextHeader.lastIndex = start + header.length
  const next = nextHeader.exec(source)
  return source.slice(start, next?.index ?? source.length)
}

test("workflow directory contains only reviewed workflow entry points", async () => {
  assert.deepEqual(await workflowNames(), REVIEWED_WORKFLOWS)
})

test("every third-party GitHub Action is pinned to a full commit", async () => {
  for (const name of await workflowNames()) {
    const source = await workflow(name)
    const uses = [...source.matchAll(/^\s*- uses:\s*([^\s#]+)/gmu)].map((match) => match[1])
    assert.ok(uses.length > 0, `${name} must use at least one pinned action`)
    for (const reference of uses) {
      assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u, `${name}: ${reference}`)
    }
  }
})

test("workflows retain the reviewed action commits", async () => {
  const sources = await Promise.all(
    REVIEWED_WORKFLOWS.map(workflow),
  )
  const combined = sources.join("\n")
  for (const reference of [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
    "github/codeql-action/init@6f5948dfacef28e207b48d0905cf90c03365536d",
    "github/codeql-action/analyze@6f5948dfacef28e207b48d0905cf90c03365536d",
  ]) {
    assert.ok(combined.includes(reference), `missing reviewed action pin ${reference}`)
  }
})

test("CI boots the exact DSH CLI from the final tarball on the full OS and Node matrix", async () => {
  const source = await workflow("ci.yml")
  assert.match(source, /os: \[ubuntu-latest, macos-latest, windows-latest\]/u)
  assert.match(source, /node: \[22, 24\]/u)
  assert.match(
    source,
    /pnpm --dir test\/fixtures\/dsh-runtime install --frozen-lockfile --ignore-scripts/u,
  )
  assert.match(source, /DSH_CLI_ROOT: \$\{\{ github\.workspace \}\}\/test\/fixtures\/dsh-runtime/u)
  assert.match(source, /DSH_SMOKE_ARTIFACT_DIR: \$\{\{ runner\.temp \}\}\/npm-package/u)
  assert.equal((source.match(/pnpm run smoke:dsh-profile/gu) ?? []).length, 1)
  assert.match(
    source,
    /path: \$\{\{ runner\.temp \}\}\/npm-package\/dsh-codex-community-\*\.tgz/u,
  )
})

test("every full-suite job installs the frozen DSH fixture before collecting tests", async () => {
  const cases = [
    ["ci.yml", "test", "pnpm run check"],
    ["compatibility.yml", "current-contract", "pnpm test"],
    ["release.yml", "candidate", "pnpm run check"],
  ]
  const fixtureInstall = "pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts"

  for (const [workflowName, jobName, suiteCommand] of cases) {
    const job = workflowJob(await workflow(workflowName), jobName)
    const installOffset = job.indexOf(fixtureInstall)
    const suiteOffset = job.indexOf(suiteCommand)
    assert.notEqual(installOffset, -1, `${workflowName}:${jobName} must install the DSH fixture`)
    assert.notEqual(suiteOffset, -1, `${workflowName}:${jobName} must run ${suiteCommand}`)
    assert.ok(
      installOffset < suiteOffset,
      `${workflowName}:${jobName} must install the frozen DSH fixture before ${suiteCommand}`,
    )
    assert.equal(
      job.split(fixtureInstall).length - 1,
      1,
      `${workflowName}:${jobName} must install the DSH fixture exactly once`,
    )
  }
})

test("release candidate is read-only, main-only, and built once", async () => {
  const source = await workflow("release.yml")
  assert.match(source, /permissions: \{\}/u)
  assert.match(source, /candidate:\n\s+if: github\.ref == 'refs\/heads\/main'/u)
  assert.match(source, /candidate:[\s\S]*?permissions:\n\s+contents: read/u)
  assert.equal((source.match(/persist-credentials: false/gu) ?? []).length, 2)
  assert.equal((source.match(/npm pack --ignore-scripts --json --pack-destination release/gu) ?? []).length, 1)
  assert.equal((source.match(/pnpm run check/gu) ?? []).length, 1)
  assert.match(source, /pnpm install --frozen-lockfile --ignore-scripts/u)
  assert.match(source, /git diff --exit-code/u)
  assert.match(source, /git status --porcelain=v1 --untracked-files=all/u)
})

test("candidate packaging uses and records the exact reviewed npm toolchain before pack", async () => {
  const source = await workflow("release.yml")
  const install = "npm install --global --ignore-scripts --no-audit --no-fund npm@11.16.0"
  const record = "npm --version > release/npm-cli-version.txt"
  const pack = "npm pack --ignore-scripts --json --pack-destination release"
  assert.equal((source.match(new RegExp(install, "gu")) ?? []).length, 2)
  assert.equal((source.match(new RegExp(record, "gu")) ?? []).length, 1)
  assert.ok(source.indexOf(install) < source.indexOf(pack))
  assert.ok(source.indexOf(record) < source.indexOf(pack))
  assert.match(source, /if \(candidateVersion !== "11\.16\.0\\n"\) process\.exit\(1\)/u)
})

test("release boots the exact once-built candidate in the supported DSH runtime", async () => {
  const source = await workflow("release.yml")
  assert.match(
    source,
    /pnpm --dir test\/fixtures\/dsh-runtime install --frozen-lockfile --ignore-scripts/u,
  )
  assert.match(source, /DSH_CLI_ROOT: \$\{\{ github\.workspace \}\}\/test\/fixtures\/dsh-runtime/u)
  assert.match(source, /DSH_PLUGIN_PACKAGE: \$\{\{ env\.PACKAGE_FILE \}\}/u)
  assert.equal((source.match(/pnpm run smoke:dsh-profile/gu) ?? []).length, 1)
  assert.match(source, /dshProfileSmoke: "passed"/u)
  const smoke = source.indexOf("pnpm run smoke:dsh-profile")
  const environmentEvidence = source.indexOf("release/dsh-runtime-environment.json")
  assert.ok(environmentEvidence > smoke, "runtime environment evidence must be written only after smoke passes")
  assert.match(source, /fixtureLockSha256/u)
  assert.match(source, /nodeVersion: process\.version/u)
  assert.match(source, /pnpmVersion/u)
  assert.match(source, /platform: process\.platform/u)
  assert.match(source, /arch: process\.arch/u)
  assert.match(source, /lifecycleScripts: "disabled"/u)
})

test("release candidate retains auditable dependency and production vulnerability evidence", async () => {
  const source = await workflow("release.yml")
  assert.match(source, /retention-days: 90/u)
  assert.match(
    source,
    /pnpm --dir test\/fixtures\/dsh-runtime list --depth Infinity --json > release\/dsh-runtime-dependency-tree\.json/u,
  )
  assert.doesNotMatch(source, /pnpm --dir test\/fixtures\/dsh-runtime list --all/u)
  assert.match(source, /npm ls --all --json > \.\.\/release\/isolated-dependency-tree\.json/u)
  assert.match(
    source,
    /npm audit --omit=dev --audit-level=high --json > \.\.\/release\/npm-audit\.json/u,
  )
  assert.match(
    source,
    /dshRuntimeDependencyTreeSha256: hash\("release\/dsh-runtime-dependency-tree\.json"\)/u,
  )
  assert.match(
    source,
    /isolatedDependencyTreeSha256: hash\("release\/isolated-dependency-tree\.json"\)/u,
  )
  assert.match(source, /npmAuditSha256: hash\("release\/npm-audit\.json"\)/u)
  assert.match(source, /npmCliVersionSha256: hash\("release\/npm-cli-version\.txt"\)/u)
  assert.match(
    source,
    /dshRuntimeEnvironmentSha256: hash\("release\/dsh-runtime-environment\.json"\)/u,
  )
})

test("release checksum sidecar is portable outside the CI release directory", async () => {
  const source = await workflow("release.yml")
  assert.match(source, /import path from "node:path"/u)
  assert.match(
    source,
    /fs\.writeFileSync\(`\$\{artifact\}\.sha256`, `\$\{sha256\}  \$\{path\.basename\(artifact\)\}\\n`\)/u,
  )
  assert.doesNotMatch(source, /`\$\{sha256\}  \$\{artifact\}\\n`/u)
})

test("publication uses a protected OIDC job and the downloaded candidate", async () => {
  const source = await workflow("release.yml")
  assert.match(source, /publish:\n\s+if: inputs\.publish && github\.ref == 'refs\/heads\/main'/u)
  assert.match(source, /needs: candidate/u)
  assert.match(source, /environment:\n\s+name: npm-release/u)
  assert.match(source, /permissions:\n\s+contents: write\n\s+id-token: write/u)
  assert.match(
    source,
    /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4/u,
  )
  assert.match(source, /npm publish "\$PACKAGE_FILE" --access public --provenance/u)
  assert.doesNotMatch(source, /NPM_TOKEN|attestations: write/u)
  assert.equal(
    (source.match(/test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse refs\/remotes\/origin\/main\)"/gu) ?? []).length,
    1,
    "only the candidate build should require the then-current main tip",
  )
})

test("publication pins npm independently and compares the immutable candidate toolchain evidence", async () => {
  const source = await workflow("release.yml")
  const toolchainInstall = "npm install --global --ignore-scripts --no-audit --no-fund npm@11.16.0"
  const publish = 'npm publish "$PACKAGE_FILE" --access public --provenance'
  const publishSource = source.slice(source.indexOf("\n  publish:"))
  assert.ok(source.includes(toolchainInstall))
  assert.ok(publishSource.indexOf(toolchainInstall) < publishSource.indexOf(publish))
  assert.match(publishSource, /actual_npm_version="\$\(npm --version\)"/u)
  assert.match(publishSource, /const candidateVersion = fs\.readFileSync\("release\/npm-cli-version\.txt", "utf8"\)/u)
  assert.match(publishSource, /if \(candidateVersion !== "11\.16\.0\\n"\) process\.exit\(1\)/u)
  assert.match(
    publishSource,
    /if \(`\$\{process\.env\.ACTUAL_NPM_VERSION\}\\n` !== candidateVersion\) process\.exit\(1\)/u,
  )
  assert.doesNotMatch(publishSource, /npm --version > release\/npm-cli-version\.txt/u)
})

test("registry readback verifies exact integrity and downloads provenance only from the expected endpoint", async () => {
  const source = await workflow("release.yml")
  assert.match(
    source,
    /const expectedIntegrity = fs\.readFileSync\(`\$\{process\.env\.PACKAGE_FILE\}\.sri`, "utf8"\)\.trim\(\)/u,
  )
  assert.match(source, /if \(integrity !== expectedIntegrity\) process\.exit\(1\)/u)
  assert.match(
    source,
    /attestations\?\.provenance\?\.predicateType !== "https:\/\/slsa\.dev\/provenance\/v1"/u,
  )
  assert.match(source, /attestationUrl\.origin !== "https:\/\/registry\.npmjs\.org"/u)
  assert.match(source, /attestationUrl\.pathname !== expectedAttestationPath/u)
  assert.match(source, /attestationUrl\.search !== ""/u)
  assert.match(source, /attestationUrl\.hash !== ""/u)
  assert.match(source, /fetch\(attestationUrl, \{ redirect: "error" \}\)/u)
  assert.match(source, /const maxAttestationBytes = 4 \* 1024 \* 1024/u)
  assert.match(source, /response\.headers\.get\("content-length"\)/u)
  assert.match(source, /declaredBytes > maxAttestationBytes/u)
  assert.match(source, /for await \(const chunk of response\.body\)/u)
  assert.match(source, /receivedBytes > maxAttestationBytes/u)
  assert.match(source, /Buffer\.concat\(chunks, receivedBytes\)\.toString\("utf8"\)/u)
  assert.match(source, /JSON\.parse\(attestationBundle\)/u)
  assert.match(source, /release\/npm-attestations\.json/u)
  assert.doesNotMatch(source, /attestations\.url\.startsWith\("https:\/\/"\)/u)
  assert.doesNotMatch(source, /response\.text\(\)/u)
})

test("publication verifies registry signatures and attestations from a clean exact install", async () => {
  const source = await workflow("release.yml")
  assert.match(source, /signature_dir="\$RUNNER_TEMP\/npm-signature-audit"/u)
  assert.match(source, /test ! -e "\$signature_dir"/u)
  assert.match(source, /mkdir "\$signature_dir"/u)
  assert.match(
    source,
    /npm install --ignore-scripts --no-audit --no-fund "dsh-codex-community@\$REQUESTED_VERSION"/u,
  )
  assert.match(
    source,
    /npm audit signatures --json --include-attestations > "\$GITHUB_WORKSPACE\/release\/npm-signatures\.json"/u,
  )
  assert.match(
    source,
    /JSON\.parse\(fs\.readFileSync\(`\$\{process\.env\.GITHUB_WORKSPACE\}\/release\/npm-signatures\.json`, "utf8"\)\)/u,
  )
  assert.match(source, /Array\.isArray\(report\.verified\)/u)
  assert.match(
    source,
    /entry\?\.name === "dsh-codex-community" && entry\?\.version === process\.env\.REQUESTED_VERSION/u,
  )
  assert.match(
    source,
    /target\.attestations\?\.provenance\?\.predicateType !== "https:\/\/slsa\.dev\/provenance\/v1"/u,
  )
  assert.match(source, /!Array\.isArray\(target\.attestations\?\.bundles\)/u)
  assert.match(source, /target\.attestations\.bundles\.length === 0/u)
})

test("every release carries the complete evidence set under a version-neutral bilingual title", async () => {
  const source = await workflow("release.yml")
  const assetsBlock = source.match(/assets=\(\n([\s\S]*?)\n\s+\)/u)?.[1]
  const expectedBlock = source.match(/const expected = \[\n([\s\S]*?)\n\s+\]\.sort\(\)/u)?.[1]
  assert.ok(assetsBlock)
  assert.ok(expectedBlock)
  for (const name of [
    "dsh-runtime-dependency-tree.json",
    "dsh-runtime-environment.json",
    "isolated-dependency-tree.json",
    "npm-audit.json",
    "npm-cli-version.txt",
    "npm-attestations.json",
    "npm-signatures.json",
  ]) {
    assert.ok(assetsBlock.includes(`"release/${name}"`), `upload list is missing ${name}`)
    assert.ok(expectedBlock.includes(`"${name}"`), `readback list is missing ${name}`)
  }
  assert.equal(
    (source.match(/--title "v\$REQUESTED_VERSION 社区版本 \/ Community Release"/gu) ?? []).length,
    2,
  )
  assert.match(
    source,
    /const expectedTitle = `v\$\{process\.env\.EXPECTED_VERSION\} 社区版本 \/ Community Release`/u,
  )
  assert.doesNotMatch(source, /0\.0\.1|首个公开预览|Initial Public Preview/u)
})

test("publication is safely repeatable and verifies every GitHub Release asset before going public", async () => {
  const source = await workflow("release.yml")
  assert.match(source, /state=identical/u)
  assert.match(source, /state=absent/u)
  assert.match(source, /cmp "\$PACKAGE_FILE" "registry\/preflight/u)
  assert.match(source, /if: steps\.registry\.outputs\.state == 'absent'/u)
  assert.match(source, /gh release edit/u)
  assert.match(source, /gh release create/u)
  assert.match(source, /process\.stdout\.write\("published"\)/u)
  assert.match(source, /overwrite: true/u)
  assert.match(source, /if \[ "\$release_state" != "published" \]; then[\s\S]*?gh release upload/u)
  assert.match(source, /gh release view "\$tag" --json assets,body,isDraft,name/u)
  assert.match(source, /normalize\(release\.body\) !== normalize\(notes\)/u)
  assert.match(source, /gh release download "\$tag" --dir "\$download_dir"/u)
  assert.match(source, /cmp "\$asset" "\$download_dir\/\$\(basename "\$asset"\)"/u)
  assert.match(source, /gh release edit "\$tag" --draft=false/u)
  assert.match(source, /release\.isDraft !== false/u)
})

test("draft recovery verifies its target and any existing tag before publication", async () => {
  const source = await workflow("release.yml")
  const publishCommand = 'gh release edit "$tag" --draft=false'
  const publishOffset = source.indexOf(publishCommand)
  assert.notEqual(publishOffset, -1, "draft publication command is missing")

  const beforePublication = source.slice(0, publishOffset)
  assert.match(
    beforePublication,
    /gh release view "\$tag" --json isDraft,tagName,targetCommitish > release\/prepublish-release\.json/u,
  )
  assert.match(beforePublication, /release\.isDraft !== true/u)
  assert.match(
    beforePublication,
    /release\.tagName !== `v\$\{process\.env\.REQUESTED_VERSION\}`/u,
  )
  assert.match(beforePublication, /release\.targetCommitish !== process\.env\.GITHUB_SHA/u)
  assert.match(
    beforePublication,
    /existing_tag_commit="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/commits\/\$tag" --jq \.sha/u,
  )
  assert.match(beforePublication, /test "\$existing_tag_commit" = "\$GITHUB_SHA"/u)
})

test("publish-blocking placeholders appear only in the release metadata header", async () => {
  const notes = await readFile(new URL("../docs/releases/v0.0.1.md", import.meta.url), "utf8")
  const body = notes.replace(/^>.*$/gmu, "")
  assert.doesNotMatch(
    body,
    /\b(?:TBD|TODO|PENDING|DRAFT|UNRELEASED)\b|待补|未发布|草稿/iu,
  )
})

test("strict release verification covers every packed publication-state document", async () => {
  const source = await readFile(new URL("../scripts/verify-release.mjs", import.meta.url), "utf8")
  for (const document of [
    "README.md",
    "README.en.md",
    "CHANGELOG.md",
    "docs/compatibility.md",
    "docs/compatibility.en.md",
  ]) {
    assert.ok(source.includes(document), `strict verifier does not cover ${document}`)
  }
  assert.match(source, /test\/fixtures\/dsh-runtime\/package\.json/u)
  assert.match(source, /test\/fixtures\/dsh-runtime\/pnpm-lock\.yaml/u)
  assert.match(source, /dshRuntimeLockSha256: actualDshRuntimeLockSha256/u)
  assert.match(source, /npmCliVersion: "11\.16\.0"/u)
  assert.match(source, /pnpmVersion,/u)
  assert.doesNotMatch(source, /Ready for publication/u)
})
