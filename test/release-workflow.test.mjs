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
const REVIEWED_ACTIONS = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "github/codeql-action/analyze@cdf488f595d80d6e07e03d4674febd5ab45fa938",
  "github/codeql-action/init@cdf488f595d80d6e07e03d4674febd5ab45fa938",
  "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86",
])

async function workflow(name) {
  return normalizeNewlines(await readFile(new URL(name, workflowRoot), "utf8"))
}

function normalizeNewlines(source) {
  return source.replace(/\r\n?/gu, "\n")
}

async function workflowNames() {
  return (await readdir(workflowRoot))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort()
}

function workflowJob(source, jobName) {
  source = normalizeNewlines(source)
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

function workflowStep(jobSource, stepName) {
  const header = `      - name: ${stepName}\n`
  const start = jobSource.indexOf(header)
  assert.notEqual(start, -1, `workflow step ${stepName} is missing`)
  const nextHeader = /^      - (?:name:|uses:)/gmu
  nextHeader.lastIndex = start + header.length
  const next = nextHeader.exec(jobSource)
  return jobSource.slice(start, next?.index ?? jobSource.length)
}

test("workflow job parsing accepts Windows CRLF checkouts", async () => {
  const source = (await readFile(new URL("ci.yml", workflowRoot), "utf8"))
    .replace(/\r?\n/gu, "\r\n")
  const job = workflowJob(source, "test")
  assert.match(job, /pnpm run check/u)
})

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

test("every workflow action uses an explicitly reviewed commit", async () => {
  const observed = new Set()
  for (const name of REVIEWED_WORKFLOWS) {
    const source = await workflow(name)
    const uses = [...source.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+)/gmu)]
      .map((match) => match[1])
    for (const reference of uses) {
      assert.ok(REVIEWED_ACTIONS.has(reference), `${name}: unreviewed action ${reference}`)
      observed.add(reference)
    }
  }
  assert.deepEqual(observed, REVIEWED_ACTIONS)
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
  assert.equal((source.match(/pnpm run smoke:dsh-profile/gu) ?? []).length, 1)
  assert.doesNotMatch(source, /DSH_SMOKE_ARTIFACT_DIR/u)
  assert.doesNotMatch(source, /name: npm-package/u)
})

test("CI replays the complete release candidate in an isolated read-only job", async () => {
  const source = await workflow("ci.yml")
  const replay = workflowJob(source, "candidate-replay")
  const toolchain = workflowStep(replay, "Install and verify the candidate packaging npm toolchain")
  const build = workflowStep(replay, "Replay the complete candidate without publishing")
  const upload = workflowStep(replay, "Upload the CI replay candidate and evidence")

  assert.match(replay, /^    name: Release candidate replay \/ Node 24$/mu)
  assert.match(replay, /^    runs-on: ubuntu-latest$/mu)
  assert.match(replay, /^    timeout-minutes: 30$/mu)
  assert.match(replay, /^    permissions:\n      contents: read$/mu)
  assert.match(replay, /node-version: 24/u)
  assert.match(replay, /package-manager-cache: false/u)
  assert.match(replay, /version: 10\.34\.5/u)
  assert.match(
    toolchain,
    /npm install --global --ignore-scripts --no-audit --no-fund npm@11\.16\.0/u,
  )
  assert.match(toolchain, /test "\$\(npm --version\)" = "11\.16\.0"/u)
  assert.match(build, /RELEASE_SOURCE_COMMIT: \$\{\{ github\.sha \}\}/u)
  assert.match(build, /PACKAGE_VERSION="\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/u)
  assert.match(build, /pnpm run release:candidate -- "\$PACKAGE_VERSION"/u)
  assert.equal((replay.match(/pnpm run release:candidate --/gu) ?? []).length, 1)
  assert.ok(replay.indexOf(toolchain) < replay.indexOf(build))
  assert.ok(replay.indexOf(build) < replay.indexOf(upload))
  assert.match(upload, /name: dsh-codex-community-\$\{\{ github\.sha \}\}-ci-replay/u)
  assert.match(upload, /^          path: release\/$/mu)
  assert.match(upload, /^          if-no-files-found: error$/mu)
  assert.match(upload, /^          overwrite: true$/mu)
  assert.match(upload, /^          retention-days: 14$/mu)
  assert.doesNotMatch(replay, /contents: write|id-token: write/u)
  assert.doesNotMatch(replay, /npm publish[^\n]*--access|gh release|git tag/u)
})

test("direct CI full-suite jobs install the frozen DSH fixture before collecting tests", async () => {
  const cases = [
    ["ci.yml", "test", "pnpm run check"],
    ["compatibility.yml", "current-contract", "pnpm test"],
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

test("release dispatch is manual and defaults to the candidate-only control path", async () => {
  const source = await workflow("release.yml")
  const triggerStart = source.indexOf("\non:\n")
  const triggerEnd = source.indexOf("\npermissions:", triggerStart)
  assert.notEqual(triggerStart, -1, "release trigger section is missing")
  assert.notEqual(triggerEnd, -1, "release trigger section is not bounded by permissions")
  const triggers = source.slice(triggerStart + 1, triggerEnd)
  assert.deepEqual(
    [...triggers.matchAll(/^  ([a-zA-Z][a-zA-Z0-9_-]*):/gmu)].map((match) => match[1]),
    ["workflow_dispatch"],
  )
  assert.match(
    triggers,
    /^  workflow_dispatch:\n    inputs:\n      version:\n(?:        description:.*\n)?        required: true\n        type: string$/mu,
  )
  assert.match(
    triggers,
    /^      publish:\n(?:        description:.*\n)?        required: true\n        default: false\n        type: boolean$/mu,
  )

  const candidate = workflowJob(source, "candidate")
  const publish = workflowJob(source, "publish")
  assert.doesNotMatch(candidate, /^    if:/mu)
  assert.match(
    candidate,
    /^    outputs:\n      artifact_digest: \$\{\{ steps\.upload-candidate\.outputs\.artifact-digest \}\}\n      artifact_url: \$\{\{ steps\.upload-candidate\.outputs\.artifact-url \}\}$/mu,
  )
  assert.deepEqual(
    [...candidate.matchAll(/^        if: (.+)$/gmu)].map((match) => match[1]),
    ["inputs.publish"],
  )
  assert.match(publish, /^\s+if: inputs\.publish && github\.ref == 'refs\/heads\/main'$/mu)
  assert.match(publish, /^    needs: candidate$/mu)
  assert.match(
    publish,
    /^    environment:\n      name: npm-release\n      url: \$\{\{ needs\.candidate\.outputs\.artifact_url \}\}$/mu,
  )

  const upload = workflowStep(candidate, "Upload the immutable candidate and evidence")
  const summary = workflowStep(candidate, "Summarize the exact candidate for release approval")
  const candidateGate = workflowStep(
    candidate,
    "Enforce the strict publication gate before requesting approval",
  )
  const publishGate = workflowStep(
    publish,
    "Enforce the strict publication gate against the downloaded candidate",
  )
  assert.ok(candidate.indexOf(upload) < candidate.indexOf(summary))
  assert.ok(candidate.indexOf(summary) < candidate.indexOf(candidateGate))
  assert.match(candidateGate, /^\s+if: inputs\.publish$/mu)
  assert.match(candidateGate, /run: pnpm run verify:release:publish/u)
  assert.doesNotMatch(publishGate, /^\s+if:/mu)
  assert.match(publishGate, /run: pnpm run verify:release:publish/u)
  assert.equal((source.match(/pnpm run verify:release:publish/gu) ?? []).length, 2)
})

test("release candidate is read-only, fails explicitly off main, and delegates its build once", async () => {
  const source = await workflow("release.yml")
  const candidate = workflowJob(source, "candidate")
  const build = workflowStep(candidate, "Build and verify the immutable release candidate")
  const upload = workflowStep(candidate, "Upload the immutable candidate and evidence")

  assert.match(source, /permissions: \{\}/u)
  assert.doesNotMatch(candidate, /^    if:/mu)
  assert.match(candidate, /test "\$GITHUB_REF" = "refs\/heads\/main"/u)
  assert.match(
    candidate,
    /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse refs\/remotes\/origin\/main\)"/u,
  )
  assert.match(source, /candidate:[\s\S]*?permissions:\n\s+contents: read/u)
  assert.equal((source.match(/persist-credentials: false/gu) ?? []).length, 3)
  assert.match(build, /^        env:\n          RELEASE_SOURCE_COMMIT: \$\{\{ github\.sha \}\}$/mu)
  assert.match(
    build,
    /^        run: pnpm run release:candidate -- \$\{\{ inputs\.version \}\}$/mu,
  )
  assert.equal((candidate.match(/pnpm run release:candidate -- \$\{\{ inputs\.version \}\}/gu) ?? []).length, 1)
  assert.ok(candidate.indexOf(build) < candidate.indexOf(upload))

  for (const oldInlineCommand of [
    /pnpm install --frozen-lockfile --ignore-scripts/u,
    /pnpm --dir test\/fixtures\/dsh-runtime install/u,
    /pnpm run check/u,
    /pnpm run verify:release(?:\s|$)/u,
    /npm pack --ignore-scripts/u,
    /npm publish "\.\/\$PACKAGE_FILE" --dry-run/u,
    /scripts\/generate-sbom\.mjs/u,
    /pnpm run smoke:dsh-profile/u,
    /npm ls --all --json/u,
    /npm audit --omit=dev/u,
    /fs\.writeFileSync\("release\/isolated-import\.json"/u,
  ]) {
    assert.doesNotMatch(candidate, oldInlineCommand)
  }
})

test("candidate installs and verifies the reviewed npm toolchain before delegation", async () => {
  const source = await workflow("release.yml")
  const candidate = workflowJob(source, "candidate")
  const install = "npm install --global --ignore-scripts --no-audit --no-fund npm@11.16.0"
  const verify = 'test "$(npm --version)" = "11.16.0"'
  const build = "pnpm run release:candidate -- ${{ inputs.version }}"
  assert.equal((source.match(new RegExp(install, "gu")) ?? []).length, 2)
  assert.equal((candidate.match(/npm --version > release\/npm-cli-version\.txt/gu) ?? []).length, 0)
  assert.ok(candidate.indexOf(install) < candidate.indexOf(build))
  assert.ok(candidate.indexOf(verify) < candidate.indexOf(build))
})

test("release uses no dependency cache in every Node setup", async () => {
  const source = await workflow("release.yml")

  assert.equal((source.match(/package-manager-cache: false/gu) ?? []).length, 3)
  assert.doesNotMatch(source, /^\s+cache:/mu)
})

test("candidate uploads the unified command output before summary and strict approval gate", async () => {
  const source = await workflow("release.yml")
  const candidate = workflowJob(source, "candidate")
  const build = workflowStep(candidate, "Build and verify the immutable release candidate")
  const upload = workflowStep(candidate, "Upload the immutable candidate and evidence")
  const summary = workflowStep(candidate, "Summarize the exact candidate for release approval")
  const gate = workflowStep(
    candidate,
    "Enforce the strict publication gate before requesting approval",
  )
  assert.ok(candidate.indexOf(build) < candidate.indexOf(upload))
  assert.ok(candidate.indexOf(upload) < candidate.indexOf(summary))
  assert.ok(candidate.indexOf(summary) < candidate.indexOf(gate))
  assert.match(upload, /^          path: release\/$/mu)
  assert.match(upload, /^          retention-days: 90$/mu)
  assert.match(gate, /RELEASE_ISOLATED_IMPORT_EVIDENCE: release\/isolated-import\.json/u)
  assert.match(gate, /RELEASE_SOURCE_COMMIT: \$\{\{ github\.sha \}\}/u)
})

test("candidate approval summary validates the portable checksum sidecar", async () => {
  const source = await workflow("release.yml")
  const candidate = workflowJob(source, "candidate")
  const summary = workflowStep(candidate, "Summarize the exact candidate for release approval")
  assert.match(summary, /import path from "node:path"/u)
  assert.match(
    summary,
    /fs\.readFileSync\(`\$\{process\.env\.PACKAGE_FILE\}\.sha256`, "utf8"\)\.trim\(\)/u,
  )
  assert.match(summary, /checksumMatch\[2\] !== path\.basename\(process\.env\.PACKAGE_FILE\)/u)
  assert.ok(
    summary.includes("`- Platform CI / 平台 CI: \\`${platformPassed}/3\\``"),
    "candidate summary must disclose the platform CI count",
  )
  assert.ok(
    summary.includes("`- Post-release live validation / 发布后真实账号验证: \\`${livePassed}/${Object.keys(acceptance.liveAcceptance).length}\\``"),
    "candidate summary must disclose the post-release live-validation count",
  )
})

test("publication separates protected npm OIDC from GitHub Release write permission", async () => {
  const source = await workflow("release.yml")
  const publish = workflowJob(source, "publish")
  const release = workflowJob(source, "release")
  assert.doesNotMatch(source, /^\s+authentication:/mu)
  assert.match(publish, /^  publish:\n\s+if: inputs\.publish && github\.ref == 'refs\/heads\/main'/u)
  assert.match(publish, /^    needs: candidate$/mu)
  assert.match(publish, /environment:\n\s+name: npm-release/u)
  assert.match(publish, /permissions:\n\s+contents: read\n\s+id-token: write/u)
  assert.doesNotMatch(publish, /contents: write/u)
  assert.match(release, /^  release:\n\s+if: inputs\.publish && github\.ref == 'refs\/heads\/main'/u)
  assert.match(release, /^    needs: publish$/mu)
  assert.match(release, /permissions:\n\s+contents: write/u)
  assert.doesNotMatch(release, /id-token: write|environment:/u)
  assert.match(
    source,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8/u,
  )
  assert.match(source, /npm publish "\.\/\$PACKAGE_FILE" --access public --provenance/u)
  assert.doesNotMatch(source, /NPM_TOKEN|attestations: write/u)
  assert.equal(
    (source.match(/test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse refs\/remotes\/origin\/main\)"/gu) ?? []).length,
    1,
    "only the candidate build should require the then-current main tip",
  )
})

test("Registry state automatically selects the isolated bootstrap or routine OIDC path", async () => {
  const source = await workflow("release.yml")
  const publishSource = workflowJob(source, "publish")

  assert.equal((publishSource.match(/secrets\.NPM_BOOTSTRAP_TOKEN/gu) ?? []).length, 1)
  assert.doesNotMatch(publishSource, /secrets\.NPM_TOKEN/u)
  assert.match(
    publishSource,
    /absent\)\n\s+test "\$REQUESTED_VERSION" = "0\.0\.1"/u,
  )
  assert.match(
    publishSource,
    /if: steps\.registry\.outputs\.state == 'absent' && steps\.registry\.outputs\.package_state == 'absent'/u,
  )
  assert.match(
    publishSource,
    /if: steps\.registry\.outputs\.state == 'absent' && steps\.registry\.outputs\.package_state == 'present'/u,
  )
  assert.equal(
    (publishSource.match(/npm publish "\.\/\$PACKAGE_FILE" --access public --provenance/gu) ?? []).length,
    2,
  )
})

test("publication writes only for an absent version and always verifies the identical rerun path", async () => {
  const source = await workflow("release.yml")
  const publish = workflowJob(source, "publish")
  const release = workflowJob(source, "release")
  const registry = workflowStep(publish, "Detect an existing immutable npm version")
  const authentication = workflowStep(
    publish,
    "Select the only permitted authentication for this Registry state",
  )
  const bootstrap = workflowStep(
    publish,
    "Publish the exact candidate with the one-time bootstrap token",
  )
  const trusted = workflowStep(
    publish,
    "Publish the exact candidate with npm Trusted Publisher",
  )
  const readback = workflowStep(publish, "Verify Registry bytes, metadata, and provenance")
  const signatures = workflowStep(
    publish,
    "Verify Registry signatures and provenance attestations",
  )
  const evidenceUpload = workflowStep(
    publish,
    "Upload the Registry-verified evidence without GitHub write permission",
  )
  const githubRelease = workflowStep(
    release,
    "Create, verify, and publish the bilingual GitHub Release",
  )

  const compare = registry.indexOf(
    'cmp "$PACKAGE_FILE" "registry/preflight/dsh-codex-community-$REQUESTED_VERSION.tgz"',
  )
  const identical = registry.indexOf("printf 'state=identical\\n'")
  assert.notEqual(compare, -1, "an existing version must be compared with the candidate")
  assert.ok(identical > compare, "only byte-identical Registry contents may enter recovery")
  assert.match(registry, /printf 'state=absent\\n'/u)
  assert.match(authentication, /^\s+if: steps\.registry\.outputs\.state == 'absent'$/mu)
  assert.match(
    bootstrap,
    /^\s+if: steps\.registry\.outputs\.state == 'absent' && steps\.registry\.outputs\.package_state == 'absent'$/mu,
  )
  assert.match(bootstrap, /secrets\.NPM_BOOTSTRAP_TOKEN/u)
  assert.match(
    trusted,
    /^\s+if: steps\.registry\.outputs\.state == 'absent' && steps\.registry\.outputs\.package_state == 'present'$/mu,
  )
  assert.doesNotMatch(trusted, /secrets\./u)

  for (const step of [readback, signatures, githubRelease]) {
    assert.doesNotMatch(step, /^\s+if:/mu)
  }
  assert.ok(publish.indexOf(bootstrap) < publish.indexOf(readback))
  assert.ok(publish.indexOf(trusted) < publish.indexOf(readback))
  assert.ok(publish.indexOf(readback) < publish.indexOf(signatures))
  assert.ok(publish.indexOf(signatures) < publish.indexOf(evidenceUpload))
  assert.match(
    evidenceUpload,
    /name: dsh-codex-community-\$\{\{ inputs\.version \}\}-\$\{\{ github\.sha \}\}-registry-evidence/u,
  )
  assert.match(
    release,
    /name: dsh-codex-community-\$\{\{ inputs\.version \}\}-\$\{\{ github\.sha \}\}-registry-evidence/u,
  )
  assert.ok(release.indexOf("registry-evidence") < release.indexOf(githubRelease))
})

test("publication pins npm independently and compares the immutable candidate toolchain evidence", async () => {
  const source = await workflow("release.yml")
  const toolchainInstall = "npm install --global --ignore-scripts --no-audit --no-fund npm@11.16.0"
  const publish = 'npm publish "./$PACKAGE_FILE" --access public --provenance'
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

test("publication verifies registry signatures and source-bound provenance from a clean exact install", async () => {
  const source = await workflow("release.yml")
  const publish = workflowJob(source, "publish")
  const signatures = workflowStep(
    publish,
    "Verify Registry signatures and provenance attestations",
  )
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
    signatures,
    /node "\$GITHUB_WORKSPACE\/scripts\/verify-npm-provenance\.mjs" \\\n\s+"\$GITHUB_WORKSPACE\/release\/npm-signatures\.json" \\\n\s+"\$GITHUB_WORKSPACE\/\$PACKAGE_FILE"/u,
  )
  assert.ok(
    signatures.indexOf("npm audit signatures")
      < signatures.indexOf("verify-npm-provenance.mjs"),
    "source binding must consume npm's verified signature report",
  )
})

test("every release carries the complete evidence set under one package-and-version title", async () => {
  const source = await workflow("release.yml")
  const releaseStep = source.slice(source.indexOf("- name: Create, verify, and publish the bilingual GitHub Release"))
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
    (source.match(/--title "dsh-codex-community v\$REQUESTED_VERSION"/gu) ?? []).length,
    2,
  )
  assert.match(
    source,
    /const expectedTitle = `dsh-codex-community v\$\{process\.env\.EXPECTED_VERSION\}`/u,
  )
  assert.doesNotMatch(releaseStep, /社区版本|Community Release|0\.0\.1|首个公开预览|Initial Public Preview/u)
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
  assert.match(source, /gh release view "\$tag" --json assets,body,isDraft,name,tagName/u)
  assert.match(source, /normalize\(release\.body\) !== normalize\(notes\)/u)
  assert.match(source, /release\.tagName !== `v\$\{process\.env\.EXPECTED_VERSION\}`/u)
  assert.match(
    source,
    /release\.isDraft !== \(process\.env\.EXPECTED_DRAFT === "true"\)/u,
  )
  assert.match(source, /gh release download "\$tag" --dir "\$download_dir"/u)
  assert.match(source, /cmp "\$asset" "\$download_dir\/\$\(basename "\$asset"\)"/u)
  const publishOffset = source.indexOf('gh release edit "$tag" --draft=false')
  assert.notEqual(publishOffset, -1)
  const afterPublication = source.slice(publishOffset)
  assert.match(
    afterPublication,
    /verify_release false release\/published-release\.json "\$RUNNER_TEMP\/published-github-release-assets"/u,
  )
  assert.ok(
    afterPublication.indexOf("verify_release false")
      < afterPublication.indexOf('published_commit="$(gh api'),
    "the public Release must be fully rechecked before the final tag assertion",
  )
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
    /existing_tag_commit="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/commits\/tags\/\$tag" --jq \.sha/u,
  )
  assert.match(beforePublication, /test "\$existing_tag_commit" = "\$GITHUB_SHA"/u)
})

test("the accepted release tag exists before draft assets are read back by tag", async () => {
  const source = await workflow("release.yml")
  const releaseStep = source.slice(source.indexOf("- name: Create, verify, and publish the bilingual GitHub Release"))
  const createTagCommand = 'gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs"'
  const createTagOffset = releaseStep.indexOf(createTagCommand)
  const uploadOffset = releaseStep.indexOf('gh release upload "$tag"')
  const downloadOffset = releaseStep.indexOf('gh release download "$tag"')

  assert.notEqual(createTagOffset, -1, "release recovery must be able to create the accepted tag")
  assert.notEqual(uploadOffset, -1, "draft asset upload command is missing")
  assert.notEqual(downloadOffset, -1, "draft asset readback command is missing")
  assert.ok(createTagOffset < uploadOffset, "the accepted tag must exist before draft asset upload")
  assert.ok(createTagOffset < downloadOffset, "the accepted tag must exist before tag-based readback")

  const beforeCreate = releaseStep.slice(0, createTagOffset)
  assert.match(
    beforeCreate,
    /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/tags\/\$tag" > release\/tag-ref\.json 2> release\/tag-error\.log/u,
  )
  assert.match(
    beforeCreate,
    /existing_tag_commit="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/commits\/tags\/\$tag" --jq \.sha/u,
  )
  assert.match(beforeCreate, /test "\$existing_tag_commit" = "\$GITHUB_SHA"/u)
  assert.equal(
    (releaseStep.match(/repos\/\$GITHUB_REPOSITORY\/commits\/tags\/\$tag/gu) ?? []).length,
    4,
    "every tag commit check must use an explicit tags namespace",
  )
  assert.doesNotMatch(releaseStep, /repos\/\$GITHUB_REPOSITORY\/commits\/\$tag/u)
})

test("release notes disclose platform and post-release live-validation progress", async () => {
  const notes = await readFile(new URL("../docs/releases/v0.0.1.md", import.meta.url), "utf8")
  assert.match(notes, /^> 平台验收 \/ Platform acceptance：\d+\/\d+\s*$/mu)
  assert.match(notes, /^> 发布后真实账号验证 \/ Post-release live validation：\d+\/\d+\s*$/mu)
})

test("strict release verification covers every packed publication-state document", async () => {
  const source = await readFile(new URL("../scripts/verify-release.mjs", import.meta.url), "utf8")
  const boundary = await readFile(new URL("../scripts/release-source-boundary.mjs", import.meta.url), "utf8")
  for (const document of [
    "README.md",
    "README.en.md",
    "CHANGELOG.md",
    "docs/compatibility.md",
    "docs/compatibility.en.md",
  ]) {
    assert.ok(boundary.includes(document), `strict verifier does not cover ${document}`)
  }
  assert.match(source, /publicationStatePaths/u)
  assert.match(source, /findUnexpectedPostAcceptanceChanges/u)
  assert.match(source, /assertPublicationAcceptanceRecord/u)
  assert.doesNotMatch(source, /assertNoPublishPlaceholders/u)
  assert.match(source, /test\/fixtures\/dsh-runtime\/package\.json/u)
  assert.match(source, /test\/fixtures\/dsh-runtime\/pnpm-lock\.yaml/u)
  assert.match(source, /dshRuntimeLockSha256: actualDshRuntimeLockSha256/u)
  assert.match(source, /npmCliVersion: "11\.16\.0"/u)
  assert.match(source, /pnpmVersion,/u)
  assert.doesNotMatch(source, /Ready for publication/u)
})
