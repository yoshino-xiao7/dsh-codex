import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

import {
  assertReleaseVersion,
  compareReleaseVersions,
  releaseDocumentPaths,
  releaseVersionHasBuildMetadata,
} from "../scripts/release-version.mjs"

async function readText(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/gu, "\n")
}

test("the pull-request template uses one portable canonical path", async () => {
  const entries = await readdir(new URL("../.github/", import.meta.url))
  assert.ok(entries.includes("pull_request_template.md"))
  assert.equal(entries.includes("PULL_REQUEST_TEMPLATE.md"), false)
})

test("release versions start at 0.0.1 and remain future-version compatible", () => {
  for (const version of ["0.0.1", "0.0.2", "1.0.0", "2.1.0-rc.1"]) {
    assert.equal(assertReleaseVersion(version), version)
  }
  for (const version of ["0.0.0", "00.0.1", "0.01.0", "1.0", "v1.0.0", "1.0.0-"]) {
    assert.throws(() => assertReleaseVersion(version), /release version/u)
  }
})

test("release version ordering follows SemVer precedence", () => {
  const ordered = [
    "0.0.1-alpha",
    "0.0.1-alpha.1",
    "0.0.1-alpha.beta",
    "0.0.1-beta",
    "0.0.1-beta.2",
    "0.0.1-beta.11",
    "0.0.1-rc.1",
    "0.0.1",
    "0.0.2",
  ]
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareReleaseVersions(ordered[index - 1], ordered[index]), -1)
    assert.equal(compareReleaseVersions(ordered[index], ordered[index - 1]), 1)
  }
  assert.equal(compareReleaseVersions("1.0.0+build.1", "1.0.0+build.2"), 0)
  assert.equal(
    compareReleaseVersions("99999999999999999999.0.0", "100000000000000000000.0.0"),
    -1,
  )
  assert.equal(releaseVersionHasBuildMetadata("1.0.0+build.1"), true)
  assert.equal(releaseVersionHasBuildMetadata("1.0.0"), false)
})

test("release document paths follow the current package version", () => {
  assert.deepEqual(releaseDocumentPaths("0.2.3"), {
    acceptance: "docs/releases/v0.2.3.acceptance.json",
    notes: "docs/releases/v0.2.3.md",
  })
})

test("release and i18n verification derive versioned files from package.json", async () => {
  const [releaseVerifier, i18nVerifier] = await Promise.all([
    readText(new URL("../scripts/verify-release.mjs", import.meta.url)),
    readText(new URL("../scripts/check-i18n.mjs", import.meta.url)),
  ])
  assert.doesNotMatch(releaseVerifier, /version === "0\.0\.1"/u)
  assert.doesNotMatch(i18nVerifier, /docs\/releases\/v0\.0\.1\.md/u)
  assert.match(releaseVerifier, /assertReleaseVersion\(packageJson\.version\)/u)
  assert.match(i18nVerifier, /assertReleaseVersion\(packageJson\.version\)/u)
})

test("compatibility watch compares every pinned runtime package with the registry", async () => {
  const [workflow, checker] = await Promise.all([
    readText(new URL("../.github/workflows/compatibility.yml", import.meta.url)),
    readText(new URL("../scripts/check-registry-drift.mjs", import.meta.url)),
  ])
  assert.match(workflow, /check-registry-drift\.mjs/u)
  assert.match(checker, /GITHUB_STEP_SUMMARY/u)
  assert.match(checker, /exitCode = 1/u)
})

test("third-party notices cover every direct runtime and peer dependency", async () => {
  const [manifestSource, notices] = await Promise.all([
    readText(new URL("../package.json", import.meta.url)),
    readText(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url)),
  ])
  const manifest = JSON.parse(manifestSource)
  const packages = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])

  for (const packageName of packages) {
    assert.ok(
      notices.includes(`| \`${packageName}\` |`),
      `THIRD_PARTY_NOTICES.md is missing ${packageName}`,
    )
  }
})

test("contribution rules retain the Apache-2.0 inbound-license and rights declaration", async () => {
  const files = await Promise.all([
    "CONTRIBUTING.md",
    "CONTRIBUTING.en.md",
    "docs/contribution-sources.md",
    "docs/contribution-sources.en.md",
    ".github/pull_request_template.md",
  ].map((name) => readText(new URL(`../${name}`, import.meta.url))))

  for (const source of files) assert.match(source, /Apache-2\.0/u)
  assert.match(files[0], /有权提交/u)
  assert.match(files[1], /right to submit/u)
  assert.match(files[4], /有权提交/u)
  assert.match(files[4], /right to submit/u)
})

test("public issue and pull-request templates keep bilingual privacy guidance", async () => {
  const [bug, feature, compatibility, pullRequest] = await Promise.all([
    readText(new URL("../.github/ISSUE_TEMPLATE/bug.yml", import.meta.url)),
    readText(new URL("../.github/ISSUE_TEMPLATE/feature.yml", import.meta.url)),
    readText(new URL("../.github/ISSUE_TEMPLATE/compatibility.yml", import.meta.url)),
    readText(new URL("../.github/pull_request_template.md", import.meta.url)),
  ])

  assert.match(bug, /Never submit/u)
  assert.match(bug, /I removed all credentials/u)
  assert.match(feature, /Link the official public/u)
  assert.match(compatibility, /id: safety/u)
  assert.match(compatibility, /I removed all credentials/u)
  assert.match(pullRequest, /Describe the problem/u)
  assert.match(pullRequest, /List the commands actually run/u)
})

test("Dependabot updates both npm manifests through one coordinated configuration", async () => {
  const source = await readText(new URL("../.github/dependabot.yml", import.meta.url))
  assert.equal((source.match(/package-ecosystem: npm/gu) ?? []).length, 1)
  const npmBlock = source.slice(0, source.indexOf("  - package-ecosystem: github-actions"))
  assert.match(npmBlock, /directories:\n\s+- \/\n\s+- \/test\/fixtures\/dsh-runtime/u)
  assert.match(npmBlock, /dsh-runtime:\n\s+patterns:\n\s+- "@deepseek-ai\/\*"/u)

  const actionsBlock = source.slice(source.indexOf("  - package-ecosystem: github-actions"))
  assert.match(actionsBlock, /interval: monthly/u)
  assert.match(actionsBlock, /reviewed-actions:\n\s+patterns:\n\s+- "\*"/u)
})

test("root DSH package pins stay aligned with the compatibility runtime", async () => {
  const [rootSource, fixtureSource] = await Promise.all([
    readText(new URL("../package.json", import.meta.url)),
    readText(new URL("./fixtures/dsh-runtime/package.json", import.meta.url)),
  ])
  const rootManifest = JSON.parse(rootSource)
  const fixtureManifest = JSON.parse(fixtureSource)
  const fixtureVersion = fixtureManifest.dependencies["@deepseek-ai/dsh"]
  const declarations = {
    ...rootManifest.dependencies,
    ...rootManifest.devDependencies,
    ...rootManifest.peerDependencies,
  }
  const dshPins = Object.entries(declarations)
    .filter(([name]) => name.startsWith("@deepseek-ai/dsh-"))

  assert.ok(dshPins.length > 0)
  for (const [name, version] of dshPins) {
    assert.equal(version, fixtureVersion, `${name} drifted from the DSH runtime fixture`)
  }
})

test("i18n verification covers combined bilingual governance and templates", async () => {
  const source = await readText(new URL("../scripts/check-i18n.mjs", import.meta.url))
  for (const file of [
    "CHANGELOG.md",
    "SECURITY.md",
    "SUPPORT.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/github-about.md",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/ISSUE_TEMPLATE/compatibility.yml",
    ".github/pull_request_template.md",
  ]) {
    assert.ok(source.includes(file), `i18n verification is missing ${file}`)
  }
})
