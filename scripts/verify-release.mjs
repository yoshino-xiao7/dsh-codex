import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertArtifactManifestMatchesRepository,
  assertSbomIdentity,
  readArtifactManifest,
} from "./generate-sbom.mjs"
import {
  assertAcceptanceRecord,
  assertPublicationAcceptanceRecord,
} from "./release-acceptance.mjs"
import { assertCandidateEvidenceHashes } from "./release-evidence.mjs"
import {
  findUnexpectedPostAcceptanceChanges,
  publicationStatePaths,
} from "./release-source-boundary.mjs"
import { assertReleaseVersion, releaseDocumentPaths } from "./release-version.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="))
const mode = modeArgument?.slice("--mode=".length) ?? "draft"

if (!new Set(["draft", "publish"]).has(mode)) {
  throw new Error(`Unknown release verification mode: ${mode}`)
}

const readRepositoryFile = (path) => readFile(resolve(repositoryRoot, path), "utf8")
const packageJson = JSON.parse(await readRepositoryFile("package.json"))
const version = assertReleaseVersion(packageJson.version)
const { notes: releasePath, acceptance: acceptancePath } = releaseDocumentPaths(version)
const changelog = await readRepositoryFile("CHANGELOG.md")
const releaseNotes = await readRepositoryFile(releasePath)
const acceptance = JSON.parse(await readRepositoryFile(acceptancePath))
const publicationStateDocuments = new Map(await Promise.all(
  publicationStatePaths.map(async (path) => [path, await readRepositoryFile(path)]),
))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertDraftRelease() {
  assert(changelog.includes(`[${version}]`), `CHANGELOG has no ${version} entry`)
  assert(releaseNotes.includes(`v${version}`), `Release notes do not name v${version}`)
  for (const marker of ["## 中文", "## English", "SHA-256", "SRI", "验收记录", "Acceptance record"]) {
    assert(releaseNotes.includes(marker), `Release notes are missing ${marker}`)
  }
  assertAcceptanceRecord(acceptance, { version })
}

function runGit(arguments_) {
  return execFileSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function assertAcceptedSource(sourceCommit) {
  assert(/^[0-9a-f]{40}$/.test(sourceCommit), "RELEASE_SOURCE_COMMIT must be a full lowercase Git commit")
  assert(runGit(["rev-parse", "HEAD"]) === sourceCommit, "RELEASE_SOURCE_COMMIT must equal the checked-out HEAD")
  const allowedGeneratedPrefixes = ["release/", "registry/", "isolated/"]
  const worktreeEntries = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
  const unexpectedEntries = worktreeEntries.filter((entry) => {
    if (!entry.startsWith("?? ")) return true
    const path = entry.slice(3)
    return !allowedGeneratedPrefixes.some((prefix) => path.startsWith(prefix))
  })
  assert(unexpectedEntries.length === 0, `Release worktree contains unexpected changes: ${unexpectedEntries.join(", ")}`)
  assert(/^[0-9a-f]{40}$/.test(acceptance.testedCommit), "Acceptance testedCommit must be a full lowercase Git commit")

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", acceptance.testedCommit, sourceCommit], {
      cwd: repositoryRoot,
      stdio: "ignore",
    })
  } catch {
    throw new Error("Acceptance testedCommit must be an ancestor of the release commit")
  }

  const changedFiles = runGit(["diff", "--name-only", `${acceptance.testedCommit}..${sourceCommit}`])
    .split("\n")
    .filter(Boolean)
  const productChanges = findUnexpectedPostAcceptanceChanges(changedFiles, {
    acceptancePath,
    releasePath,
  })
  assert(
    productChanges.length === 0,
    `Product files changed after the accepted commit: ${productChanges.join(", ")}`,
  )
}

function assertReleaseMetadata() {
  const releaseDate = /^> 发布日期 \/ Release date：(\d{4}-\d{2}-\d{2})\s*$/mu.exec(releaseNotes)?.[1]
  const parsedReleaseDate = releaseDate ? Date.parse(`${releaseDate}T00:00:00Z`) : Number.NaN
  assert(
    releaseDate && Number.isFinite(parsedReleaseDate) && new Date(parsedReleaseDate).toISOString().slice(0, 10) === releaseDate,
    "Release notes must contain a concrete YYYY-MM-DD date",
  )
  const acceptedCommit = /^> 验收提交 \/ Accepted commit：([0-9a-f]{40})\s*$/mu.exec(releaseNotes)?.[1]
  assert(acceptedCommit === acceptance.testedCommit, "Release notes accepted commit must match acceptance.testedCommit")
  return { acceptedCommit, releaseDate }
}

function assertReleaseValidationSummary() {
  const platformPassed = Object.values(acceptance.platforms)
    .filter(({ status }) => status === "passed").length
  const platformTotal = Object.keys(acceptance.platforms).length
  const livePassed = Object.values(acceptance.liveAcceptance)
    .filter(({ status }) => status === "passed").length
  const liveTotal = Object.keys(acceptance.liveAcceptance).length
  const platformSummary = /^> 平台验收 \/ Platform acceptance：(\d+)\/(\d+)\s*$/mu.exec(releaseNotes)
  const liveSummary = /^> 发布后真实账号验证 \/ Post-release live validation：(\d+)\/(\d+)\s*$/mu.exec(releaseNotes)
  assert(platformSummary !== null, "Release notes must contain the bilingual platform-acceptance summary")
  assert(liveSummary !== null, "Release notes must contain the bilingual post-release live-validation summary")
  assert(
    Number(platformSummary[1]) === platformPassed && Number(platformSummary[2]) === platformTotal,
    "Release notes platform-acceptance summary does not match the acceptance record",
  )
  assert(
    Number(liveSummary[1]) === livePassed && Number(liveSummary[2]) === liveTotal,
    "Release notes live-validation summary does not match the acceptance record",
  )
}

function assertPublicationStateMetadata(releaseDate) {
  const escapedVersion = version.replaceAll(".", "\\.")
  const changelogMatch = new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`, "mu")
    .exec(changelog)
  assert(changelogMatch !== null, `CHANGELOG ${version} entry must have a concrete release date`)
  assert(changelogMatch[1] === releaseDate, "CHANGELOG and release notes must use the same release date")

  const zhReadme = publicationStateDocuments.get("README.md") ?? ""
  const enReadme = publicationStateDocuments.get("README.en.md") ?? ""
  const zhCompatibility = publicationStateDocuments.get("docs/compatibility.md") ?? ""
  const enCompatibility = publicationStateDocuments.get("docs/compatibility.en.md") ?? ""
  assert(zhReadme.includes(`当前版本：\`${version}\` 技术预览`), "README must name the current technical-preview version")
  assert(enReadme.includes(`Current version: \`${version}\` technical preview`), "English README must name the current technical-preview version")
  assert(zhCompatibility.includes("发布后"), "Chinese compatibility status must describe post-release validation")
  assert(/post-release/iu.test(enCompatibility), "English compatibility status must describe post-release validation")
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function sha512SRI(path) {
  return `sha512-${createHash("sha512").update(await readFile(path)).digest("base64")}`
}

async function assertArtifactEvidence(sourceCommit) {
  const artifactSetting = process.env.RELEASE_PACKAGE_FILE
  const importEvidenceSetting = process.env.RELEASE_ISOLATED_IMPORT_EVIDENCE
  assert(artifactSetting, "RELEASE_PACKAGE_FILE is required for publish verification")
  assert(importEvidenceSetting, "RELEASE_ISOLATED_IMPORT_EVIDENCE is required for publish verification")

  const artifactPath = resolve(repositoryRoot, artifactSetting)
  const artifactName = basename(artifactPath)
  const expectedName = `${packageJson.name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`
  assert(artifactName === expectedName, `Expected release artifact ${expectedName}, got ${artifactName}`)
  assert((await stat(artifactPath)).size > 0, "Release artifact is empty")

  const actualSha256 = await sha256(artifactPath)
  const recordedSha256 = await readFile(`${artifactPath}.sha256`, "utf8")
  const expectedSha256 = `${actualSha256}  ${artifactName}\n`
  assert(
    recordedSha256 === expectedSha256,
    "SHA-256 sidecar must contain the artifact digest and portable basename",
  )

  const actualSRI = await sha512SRI(artifactPath)
  const recordedSRI = (await readFile(`${artifactPath}.sri`, "utf8")).trim()
  assert(recordedSRI === actualSRI, "SRI sidecar does not match the release artifact")

  const artifactManifest = readArtifactManifest(artifactPath)
  assertArtifactManifestMatchesRepository(artifactManifest, packageJson)
  const actualLockSha256 = await sha256(resolve(repositoryRoot, "pnpm-lock.yaml"))
  const dshRuntimeManifest = JSON.parse(await readRepositoryFile("test/fixtures/dsh-runtime/package.json"))
  const dshRuntimeVersion = dshRuntimeManifest.dependencies?.["@deepseek-ai/dsh"]
  const pnpmVersion = /^pnpm@(.+)$/u.exec(dshRuntimeManifest.packageManager ?? "")?.[1]
  assert(typeof dshRuntimeVersion === "string", "DSH runtime fixture must pin @deepseek-ai/dsh")
  assert(typeof pnpmVersion === "string", "DSH runtime fixture must pin pnpm")
  const actualDshRuntimeLockSha256 = await sha256(resolve(
    repositoryRoot,
    "test/fixtures/dsh-runtime/pnpm-lock.yaml",
  ))
  const sbom = JSON.parse(await readFile(`${artifactPath}.cdx.json`, "utf8"))
  assertSbomIdentity(sbom, artifactManifest, {
    artifactSha256: actualSha256,
    lockSha256: actualLockSha256,
  })
  const actualSbomSha256 = await sha256(`${artifactPath}.cdx.json`)

  const importEvidencePath = resolve(repositoryRoot, importEvidenceSetting)
  const importEvidence = JSON.parse(await readFile(importEvidencePath, "utf8"))
  assert(importEvidence.status === "passed", "Isolated artifact import did not pass")
  assert(importEvidence.packageName === packageJson.name, "Isolated import package name does not match")
  assert(importEvidence.version === version, "Isolated import version does not match")
  assert(importEvidence.sourceCommit === sourceCommit, "Isolated import evidence does not match the release commit")
  assert(importEvidence.dshProfileSmoke === "passed", "Exact-candidate DSH profile smoke did not pass")
  assert(importEvidence.artifactSha256 === actualSha256, "Isolated import evidence does not match the release artifact")
  assert(importEvidence.lockSha256 === actualLockSha256, "Isolated import evidence does not match pnpm-lock.yaml")
  assert(importEvidence.sbomSha256 === actualSbomSha256, "Isolated import evidence does not match the release SBOM")
  await assertCandidateEvidenceHashes(importEvidencePath, importEvidence, {
    dshVersion: dshRuntimeVersion,
    dshRuntimeLockSha256: actualDshRuntimeLockSha256,
    npmCliVersion: "11.16.0",
    packageName: packageJson.name,
    pnpmVersion,
    version,
  })
}

assertDraftRelease()

if (mode === "publish") {
  assertPublicationAcceptanceRecord(acceptance, { version })
  const { releaseDate } = assertReleaseMetadata()
  assertReleaseValidationSummary()
  assertPublicationStateMetadata(releaseDate)

  const sourceCommit = process.env.RELEASE_SOURCE_COMMIT ?? ""
  assertAcceptedSource(sourceCommit)
  await assertArtifactEvidence(sourceCommit)
}

console.log(`Release verification passed in ${mode} mode for v${version}`)
