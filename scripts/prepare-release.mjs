import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertReleaseVersion,
  compareReleaseVersions,
  releaseDocumentPaths,
} from "./release-version.mjs"
import {
  assertReleaseFile as assert,
  inspectReleaseFile as inspectFile,
  parseReleaseJson as parseJson,
  ReleaseFileError as ReleasePreparationError,
  writeReleaseFileAtomically as writeAtomically,
} from "./release-managed-file.mjs"
import {
  assertAcceptanceRecord,
  createDraftAcceptanceRecord,
} from "./release-acceptance.mjs"

const PACKAGE_PATH = "package.json"
const CHANGELOG_PATH = "CHANGELOG.md"
const PACKAGE_NAME = "dsh-codex-community"

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function renderChangelogEntry(version) {
  return `## [${version}] - Unreleased

### 中文

#### 新增

- TBD

#### 修复

- TBD

### English

#### Added

- TBD

#### Fixed

- TBD`
}

function prepareChangelog(changelog, version) {
  const headings = [...changelog.matchAll(/^## \[([^\r\n]+)\](?: - [^\r\n]+)?\s*$/gmu)]
  const matchingHeadings = headings.filter((match) => match[1] === version)
  assert(
    matchingHeadings.length <= 1,
    `${CHANGELOG_PATH} contains more than one ${version} release heading`,
  )
  if (matchingHeadings.length === 1) {
    const headingIndex = headings.indexOf(matchingHeadings[0])
    const nextHeading = headings[headingIndex + 1]
    const entry = changelog.slice(
      matchingHeadings[0].index,
      nextHeading?.index ?? changelog.length,
    )
    for (const marker of [
      "### 中文",
      "### English",
      "#### 新增",
      "#### 修复",
      "#### Added",
      "#### Fixed",
    ]) {
      const heading = new RegExp(`^${escapeRegExp(marker)}\\s*$`, "mu")
      assert(
        heading.test(entry),
        `${CHANGELOG_PATH} ${version} entry is missing required heading: ${marker}`,
      )
    }
    return changelog
  }

  const entry = renderChangelogEntry(version)
  const firstHeading = headings[0]
  if (firstHeading === undefined) {
    const separator = changelog.endsWith("\n\n") ? "" : changelog.endsWith("\n") ? "\n" : "\n\n"
    return `${changelog}${separator}${entry}\n`
  }

  const prefix = changelog.slice(0, firstHeading.index)
  const suffix = changelog.slice(firstHeading.index)
  const separator = prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n"
  return `${prefix}${separator}${entry}\n\n${suffix}`
}

function renderReleaseNotes({ packageName, version }) {
  const acceptanceFile = `v${version}.acceptance.json`

  return `> 发布日期 / Release date：TBD
> 验收提交 / Accepted commit：TBD
> npm：\`${packageName}@${version}\`

## 中文

### 变更

- TBD

### 兼容性

- TBD

### 验收记录

- [\`${acceptanceFile}\`](${acceptanceFile})

### 制品校验

- SHA-256：TBD
- SRI：TBD

## English

### Changes

- TBD

### Compatibility

- TBD

### Acceptance record

- [\`${acceptanceFile}\`](${acceptanceFile})

### Artifact verification

- SHA-256: TBD
- SRI: TBD
`
}

function assertReleaseNotes(notes, { packageName, path, version }) {
  const identity = `${packageName}@${version}`
  assert(
    !/^#\s+/mu.test(notes),
    `${path} must not duplicate the GitHub Release title`,
  )
  assert(
    new RegExp(`^>\\s*npm\\s*[：:]\\s*\`${escapeRegExp(identity)}\`\\s*$`, "mu").test(notes),
    `${path} does not name npm package ${identity} in its metadata`,
  )
  assert(
    notes.includes(`v${version}.acceptance.json`),
    `${path} does not link the matching acceptance record`,
  )
  for (const marker of ["## 中文", "## English", "SHA-256", "SRI", "验收记录", "Acceptance record"]) {
    assert(notes.includes(marker), `${path} is missing required marker: ${marker}`)
  }
}

function serializePackageJson(packageJson) {
  return `${JSON.stringify(packageJson, null, 2)}\n`
}

function serializeAcceptance(acceptance) {
  return `${JSON.stringify(acceptance, null, 2)}\n`
}

export async function prepareRelease({ repositoryRoot, version }) {
  assert(typeof repositoryRoot === "string" && repositoryRoot.length > 0, "repositoryRoot is required")
  assert(typeof version === "string", "A release version is required")
  try {
    assertReleaseVersion(version)
  } catch (error) {
    throw new ReleasePreparationError(error.message)
  }
  assert(!version.includes("+"), "Release versions with build metadata are not supported")

  const root = resolve(repositoryRoot)
  const packageFile = await inspectFile(root, PACKAGE_PATH, { required: true })
  const changelogFile = await inspectFile(root, CHANGELOG_PATH, { required: true })
  const packageJson = parseJson(packageFile.content, PACKAGE_PATH)
  assert(
    packageJson !== null && typeof packageJson === "object" && !Array.isArray(packageJson),
    `${PACKAGE_PATH} must contain a JSON object`,
  )
  assert(
    packageJson.name === PACKAGE_NAME,
    `${PACKAGE_PATH} name must be ${PACKAGE_NAME}`,
  )

  let currentVersion
  try {
    currentVersion = assertReleaseVersion(packageJson.version)
  } catch (error) {
    throw new ReleasePreparationError(`${PACKAGE_PATH}: ${error.message}`)
  }
  const versionComparison = compareReleaseVersions(version, currentVersion)
  assert(
    versionComparison >= 0,
    `Release version ${version} is older than package version ${currentVersion}`,
  )
  assert(
    versionComparison !== 0 || version === currentVersion,
    `Release version ${version} has the same precedence as package version ${currentVersion}`,
  )

  const documentPaths = releaseDocumentPaths(version)
  const notesFile = await inspectFile(root, documentPaths.notes)
  const acceptanceFile = await inspectFile(root, documentPaths.acceptance)

  let notes = notesFile.content
  if (notes === null) {
    notes = renderReleaseNotes({ packageName: packageJson.name, version })
  }
  assertReleaseNotes(notes, {
    packageName: packageJson.name,
    path: documentPaths.notes,
    version,
  })

  let acceptance
  if (acceptanceFile.content === null) {
    acceptance = createDraftAcceptanceRecord(version)
  } else {
    acceptance = parseJson(acceptanceFile.content, documentPaths.acceptance)
  }
  try {
    assertAcceptanceRecord(acceptance, { version })
  } catch (error) {
    throw new ReleasePreparationError(`${documentPaths.acceptance}: ${error.message}`)
  }

  const changelog = prepareChangelog(changelogFile.content, version)
  const nextPackageJson = { ...packageJson, version }
  const plannedFiles = [
    { ...notesFile, nextContent: notes },
    {
      ...acceptanceFile,
      nextContent: acceptanceFile.content === null
        ? serializeAcceptance(acceptance)
        : acceptanceFile.content,
    },
    { ...changelogFile, nextContent: changelog },
    {
      ...packageFile,
      nextContent: version === currentVersion
        ? packageFile.content
        : serializePackageJson(nextPackageJson),
    },
  ].filter((file) => file.nextContent !== file.content)

  const changedPaths = []
  for (const file of plannedFiles) {
    await writeAtomically(file, file.nextContent)
    changedPaths.push(file.path.replaceAll("\\", "/"))
  }

  changedPaths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

  return {
    changedPaths,
    status: changedPaths.length === 0 ? "unchanged" : "changed",
  }
}

async function runCli() {
  const rawArguments = process.argv.slice(2)
  const arguments_ = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments
  assert(
    arguments_.length === 1 && !arguments_[0].startsWith("-"),
    "Usage: pnpm run release:prepare -- <version>",
  )
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const result = await prepareRelease({ repositoryRoot, version: arguments_[0] })
  if (result.status === "unchanged") {
    console.log(`Release ${arguments_[0]} is already prepared.`)
    return
  }
  console.log(`Prepared release ${arguments_[0]}:`)
  for (const path of result.changedPaths) console.log(`- ${path}`)
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = error?.exitCode ?? 1
  })
}
