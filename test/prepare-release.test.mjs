import assert from "node:assert/strict"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import test from "node:test"

import {
  assertAcceptanceRecord,
  LIVE_ACCEPTANCE_ASSERTIONS,
} from "../scripts/release-acceptance.mjs"
import { prepareRelease } from "../scripts/prepare-release.mjs"

const TARGET_VERSION = "0.0.2"
const MANAGED_PATHS = Object.freeze([
  "CHANGELOG.md",
  `docs/releases/v${TARGET_VERSION}.acceptance.json`,
  `docs/releases/v${TARGET_VERSION}.md`,
  "package.json",
])
const OLD_TIME = new Date("2001-02-03T04:05:06Z")

test("a fresh next version creates exactly the four managed release files", async (t) => {
  const repositoryRoot = await createRepository(t)
  const packageBefore = JSON.parse(await readText(repositoryRoot, "package.json"))

  const result = await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  assert.deepEqual(result, {
    changedPaths: MANAGED_PATHS,
    status: "changed",
  })

  const packageAfter = JSON.parse(await readText(repositoryRoot, "package.json"))
  assert.equal(packageAfter.version, TARGET_VERSION)
  assert.deepEqual(
    { ...packageAfter, version: packageBefore.version },
    packageBefore,
    "preparation must preserve every package field except version",
  )

  const changelog = await readText(repositoryRoot, "CHANGELOG.md")
  assert.equal(countChangelogEntries(changelog, TARGET_VERSION), 1)
  assert.ok(
    changelog.indexOf(`## [${TARGET_VERSION}]`) < changelog.indexOf("## [0.0.1]"),
    "the new changelog entry must precede prior releases",
  )
  assert.match(changelog, /### 中文/u)
  assert.match(changelog, /### English/u)

  const notes = await readText(repositoryRoot, `docs/releases/v${TARGET_VERSION}.md`)
  for (const marker of [
    `v${TARGET_VERSION}`,
    "## 中文",
    "## English",
    "SHA-256",
    "SRI",
    "验收记录",
    "Acceptance record",
  ]) {
    assert.ok(notes.includes(marker), `release notes must contain ${marker}`)
  }
  assert.doesNotMatch(notes, /^#\s+/mu, "the GitHub Release body must not duplicate its title")
})

test("a fresh acceptance record is schema v3 with every platform and live check pending", async (t) => {
  const repositoryRoot = await createRepository(t)
  await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  const acceptance = JSON.parse(await readText(
    repositoryRoot,
    `docs/releases/v${TARGET_VERSION}.acceptance.json`,
  ))
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: TARGET_VERSION }))
  assert.equal(acceptance.schemaVersion, 3)
  assert.equal(acceptance.releaseStatus, "draft")

  for (const [platform, result] of Object.entries(acceptance.platforms)) {
    assert.equal(result.status, "pending", `${platform} must begin pending`)
    assert.equal(result.profileSmoke, "pending", `${platform} smoke must begin pending`)
  }

  assert.deepEqual(
    Object.keys(acceptance.liveAcceptance).sort(),
    Object.keys(LIVE_ACCEPTANCE_ASSERTIONS).sort(),
  )
  for (const [check, result] of Object.entries(acceptance.liveAcceptance)) {
    assert.equal(result.status, "pending", `${check} must begin pending`)
    assert.deepEqual(
      result.assertions,
      Object.fromEntries(LIVE_ACCEPTANCE_ASSERTIONS[check].map((name) => [name, false])),
      `${check} must not fabricate passing evidence`,
    )
  }
})

test("a second preparation is byte- and mtime-idempotent", async (t) => {
  const repositoryRoot = await createRepository(t)
  await prepareRelease({ repositoryRoot, version: TARGET_VERSION })
  await agePaths(repositoryRoot, MANAGED_PATHS)
  const before = await snapshotPaths(repositoryRoot, MANAGED_PATHS)

  const result = await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  assert.deepEqual(result, { changedPaths: [], status: "unchanged" })
  assert.deepEqual(await snapshotPaths(repositoryRoot, MANAGED_PATHS), before)
})

test("preparation resumes an interrupted run without rewriting valid completed files", async (t) => {
  const repositoryRoot = await createRepository(t, {
    currentVersion: TARGET_VERSION,
    changelog: changelogWithEntry(TARGET_VERSION, "人工 changelog / Human changelog"),
  })
  const notesPath = `docs/releases/v${TARGET_VERSION}.md`
  await writeRepositoryFile(
    repositoryRoot,
    notesPath,
    validReleaseNotes(TARGET_VERSION, "人工 Release 正文 / Human release copy"),
  )
  await agePaths(repositoryRoot, ["package.json", "CHANGELOG.md", notesPath])
  const completedBefore = await snapshotPaths(
    repositoryRoot,
    ["package.json", "CHANGELOG.md", notesPath],
  )

  const result = await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  assert.deepEqual(result, {
    changedPaths: [`docs/releases/v${TARGET_VERSION}.acceptance.json`],
    status: "changed",
  })
  assert.deepEqual(
    await snapshotPaths(repositoryRoot, ["package.json", "CHANGELOG.md", notesPath]),
    completedBefore,
  )
  const acceptance = JSON.parse(await readText(
    repositoryRoot,
    `docs/releases/v${TARGET_VERSION}.acceptance.json`,
  ))
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: TARGET_VERSION }))
})

test("valid human-authored release content is preserved exactly", async (t) => {
  const repositoryRoot = await createRepository(t, {
    currentVersion: TARGET_VERSION,
    changelog: changelogWithEntry(TARGET_VERSION, "人工 changelog / Human changelog"),
  })
  const notesPath = `docs/releases/v${TARGET_VERSION}.md`
  const acceptancePath = `docs/releases/v${TARGET_VERSION}.acceptance.json`
  await writeRepositoryFile(
    repositoryRoot,
    notesPath,
    validReleaseNotes(TARGET_VERSION, "不要覆盖这段人工内容 / Keep this human copy"),
  )
  await writeJson(repositoryRoot, acceptancePath, pendingAcceptance(TARGET_VERSION))
  await agePaths(repositoryRoot, MANAGED_PATHS)
  const before = await snapshotPaths(repositoryRoot, MANAGED_PATHS)

  const result = await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  assert.deepEqual(result, { changedPaths: [], status: "unchanged" })
  assert.deepEqual(await snapshotPaths(repositoryRoot, MANAGED_PATHS), before)
})

test("an approved acceptance record and its release copy are never reset", async (t) => {
  const acceptedCommit = "a".repeat(40)
  const repositoryRoot = await createRepository(t)
  const notesPath = `docs/releases/v${TARGET_VERSION}.md`
  const acceptancePath = `docs/releases/v${TARGET_VERSION}.acceptance.json`
  const approved = approvedAcceptance(TARGET_VERSION, acceptedCommit)
  await writeRepositoryFile(
    repositoryRoot,
    notesPath,
    validReleaseNotes(TARGET_VERSION, "已批准人工内容 / Approved human copy", {
      acceptedCommit,
      releaseDate: "2026-08-29",
    }),
  )
  await writeJson(repositoryRoot, acceptancePath, approved)
  await agePaths(repositoryRoot, [notesPath, acceptancePath])
  const approvedBefore = await snapshotPaths(repositoryRoot, [notesPath, acceptancePath])

  const result = await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  assert.deepEqual(result, {
    changedPaths: ["CHANGELOG.md", "package.json"],
    status: "changed",
  })
  assert.deepEqual(
    await snapshotPaths(repositoryRoot, [notesPath, acceptancePath]),
    approvedBefore,
  )
  const preservedAcceptance = JSON.parse(await readText(repositoryRoot, acceptancePath))
  assert.doesNotThrow(() => assertAcceptanceRecord(
    preservedAcceptance,
    { version: TARGET_VERSION, requirePassed: true },
  ))
})

test("invalid version spellings fail before any repository write", async (t) => {
  for (const version of ["v0.0.2", "0.0.0", "0.0.2+build.1"]) {
    const repositoryRoot = await createRepository(t)
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => prepareRelease({ repositoryRoot, version }),
      /version|0\.0\.1|build metadata/iu,
    )
  }
})

test("a version older than package.json fails before any repository write", async (t) => {
  const repositoryRoot = await createRepository(t, { currentVersion: "0.0.2" })
  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => prepareRelease({ repositoryRoot, version: "0.0.1" }),
    /older|newer|version/iu,
  )
})

test("duplicate target changelog entries are rejected atomically", async (t) => {
  const duplicateEntry = releaseChangelogEntry(TARGET_VERSION, "duplicate")
  const repositoryRoot = await createRepository(t, {
    changelog: `${baseChangelog()}\n${duplicateEntry}\n${duplicateEntry}`,
  })
  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => prepareRelease({ repositoryRoot, version: TARGET_VERSION }),
    /changelog|duplicate/iu,
  )
})

test("invalid existing release notes or acceptance records are conflicts with zero writes", async (t) => {
  const cases = [
    {
      label: "release notes",
      path: `docs/releases/v${TARGET_VERSION}.md`,
      content: `# v${TARGET_VERSION}\n\n## 中文\n\n只有中文。\n`,
      pattern: /release notes|release|English/iu,
    },
    {
      label: "acceptance record",
      path: `docs/releases/v${TARGET_VERSION}.acceptance.json`,
      content: `${JSON.stringify({ ...pendingAcceptance(TARGET_VERSION), schemaVersion: 2 }, null, 2)}\n`,
      pattern: /acceptance|schemaVersion/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t)
    await writeRepositoryFile(repositoryRoot, fixture.path, fixture.content)
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => prepareRelease({ repositoryRoot, version: TARGET_VERSION }),
      fixture.pattern,
      fixture.label,
    )
  }
})

test("a managed release file symlink is rejected without touching its target", {
  skip: process.platform === "win32" ? "portable Windows runners may not permit symlink creation" : false,
}, async (t) => {
  const repositoryRoot = await createRepository(t)
  const outsidePath = join(dirname(repositoryRoot), "outside-release-note.md")
  const outsideContent = "outside sentinel\n"
  await writeFile(outsidePath, outsideContent, "utf8")
  const notesPath = join(repositoryRoot, `docs/releases/v${TARGET_VERSION}.md`)
  await symlink(relative(dirname(notesPath), outsidePath), notesPath, "file")
  const outsideBefore = await fileSnapshot(outsidePath)

  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => prepareRelease({ repositoryRoot, version: TARGET_VERSION }),
    /symbolic link|symlink|must be a regular file/iu,
  )
  assert.deepEqual(await fileSnapshot(outsidePath), outsideBefore)
  assert.equal(await readFile(outsidePath, "utf8"), outsideContent)
})

test("a symlinked managed parent directory is rejected before writing", {
  skip: process.platform === "win32" ? "portable Windows runners may not permit symlink creation" : false,
}, async (t) => {
  const repositoryRoot = await createRepository(t, { createReleasesDirectory: false })
  const outsideDirectory = join(dirname(repositoryRoot), "outside-releases")
  await mkdir(outsideDirectory)
  await writeFile(join(outsideDirectory, "sentinel.txt"), "outside sentinel\n", "utf8")
  const releasesPath = join(repositoryRoot, "docs/releases")
  await symlink(relative(dirname(releasesPath), outsideDirectory), releasesPath, "dir")
  const outsideBefore = await snapshotTree(outsideDirectory)

  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => prepareRelease({ repositoryRoot, version: TARGET_VERSION }),
    /symbolic link|symlink/iu,
  )
  assert.deepEqual(await snapshotTree(outsideDirectory), outsideBefore)
})

test("preparation leaves every file outside the managed release set untouched", async (t) => {
  const repositoryRoot = await createRepository(t)
  const outsidePaths = [
    "README.md",
    "README.en.md",
    "pnpm-lock.yaml",
    "docs/compatibility.md",
    "docs/releases/v0.0.1.md",
    "custom/nested.txt",
  ]
  await agePaths(repositoryRoot, outsidePaths)
  const before = await snapshotPaths(repositoryRoot, outsidePaths)

  const result = await prepareRelease({ repositoryRoot, version: TARGET_VERSION })

  assert.deepEqual(result.changedPaths, MANAGED_PATHS)
  assert.deepEqual(await snapshotPaths(repositoryRoot, outsidePaths), before)
})

async function createRepository(t, {
  changelog = baseChangelog(),
  createReleasesDirectory = true,
  currentVersion = "0.0.1",
} = {}) {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "dsh-prepare-release-test-"))
  const repositoryRoot = join(sandboxRoot, "repository")
  await mkdir(join(repositoryRoot, "docs"), { recursive: true })
  if (createReleasesDirectory) {
    await mkdir(join(repositoryRoot, "docs/releases"), { recursive: true })
  }
  await mkdir(join(repositoryRoot, "custom"), { recursive: true })
  t.after(() => rm(sandboxRoot, { force: true, recursive: true }))

  await writeJson(repositoryRoot, "package.json", {
    name: "dsh-codex-community",
    version: currentVersion,
    description: "fixture package",
    type: "module",
    customFieldThatMustSurvive: {
      enabled: true,
      nested: ["one", "two"],
    },
  })
  const fixtureWrites = [
    writeRepositoryFile(repositoryRoot, "CHANGELOG.md", changelog),
    writeRepositoryFile(repositoryRoot, "README.md", "中文 README sentinel\n"),
    writeRepositoryFile(repositoryRoot, "README.en.md", "English README sentinel\n"),
    writeRepositoryFile(repositoryRoot, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n"),
    writeRepositoryFile(repositoryRoot, "docs/compatibility.md", "compatibility sentinel\n"),
    writeRepositoryFile(repositoryRoot, "custom/nested.txt", "custom sentinel\n"),
  ]
  if (createReleasesDirectory) {
    fixtureWrites.push(writeRepositoryFile(
      repositoryRoot,
      "docs/releases/v0.0.1.md",
      "old release sentinel\n",
    ))
  }
  await Promise.all(fixtureWrites)
  return repositoryRoot
}

function baseChangelog() {
  return `# 更新日志 / Changelog

本项目遵循 Keep a Changelog 的结构；\`0.0.x\` 为技术预览。
This project follows the Keep a Changelog structure; \`0.0.x\` is a technical preview.

${releaseChangelogEntry("0.0.1", "initial fixture release")}`
}

function changelogWithEntry(version, marker) {
  const changelog = baseChangelog()
  const previousEntry = releaseChangelogEntry("0.0.1", "initial fixture release")
  return changelog.replace(
    previousEntry,
    `${releaseChangelogEntry(version, marker)}\n${previousEntry}`,
  )
}

function releaseChangelogEntry(version, marker) {
  return `## [${version}] - Unreleased

### 中文

#### 新增

- ${marker}

#### 修复

- 待补

### English

#### Added

- ${marker}

#### Fixed

- TBD
`
}

function countChangelogEntries(changelog, version) {
  const escaped = version.replaceAll(".", "\\.")
  return [...changelog.matchAll(new RegExp(`^## \\[${escaped}\\](?: - .+)?$`, "gmu"))].length
}

function validReleaseNotes(version, marker, {
  acceptedCommit = "TBD",
  releaseDate = "TBD",
} = {}) {
  return `> 发布日期 / Release date：${releaseDate}
> 验收提交 / Accepted commit：${acceptedCommit}
> npm：\`dsh-codex-community@${version}\`

## 中文

${marker}

### 发布验收记录

详见 [v${version}.acceptance.json](v${version}.acceptance.json)。

### 产物验证

- SHA-256：TBD
- SRI：TBD

## English

${marker}

### Acceptance record

See [v${version}.acceptance.json](v${version}.acceptance.json).

### Artifact verification

- SHA-256: TBD
- SRI: TBD
`
}

function pendingAcceptance(version) {
  const platform = () => ({
    status: "pending",
    testedAt: "TBD",
    runner: "TBD",
    nodeVersion: "TBD",
    dshVersion: "0.1.2-rc.1",
    profileSmoke: "pending",
    evidenceUrl: "TBD",
  })
  return {
    schemaVersion: 3,
    version,
    releaseStatus: "draft",
    testedCommit: "TBD",
    approvedBy: "TBD",
    approvedAt: "TBD",
    approvalEvidenceUrl: "TBD",
    platforms: {
      linux: platform(),
      macos: platform(),
      windows: platform(),
    },
    liveAcceptance: Object.fromEntries(
      Object.entries(LIVE_ACCEPTANCE_ASSERTIONS).map(([check, assertionNames]) => [
        check,
        {
          status: "pending",
          testedAt: "TBD",
          evidenceUrl: "TBD",
          assertions: Object.fromEntries(assertionNames.map((name) => [name, false])),
        },
      ]),
    ),
  }
}

function approvedAcceptance(version, testedCommit) {
  const acceptance = pendingAcceptance(version)
  acceptance.releaseStatus = "approved"
  acceptance.testedCommit = testedCommit
  acceptance.approvedBy = "release-maintainer"
  acceptance.approvedAt = "2026-08-29T00:00:00Z"
  acceptance.approvalEvidenceUrl = "https://example.test/approval"

  for (const [platform, result] of Object.entries(acceptance.platforms)) {
    result.status = "passed"
    result.profileSmoke = "passed"
    result.testedAt = "2026-08-29T00:00:00Z"
    result.runner = `${platform}-controlled-runner`
    result.nodeVersion = "22.22.2"
    result.evidenceUrl = `https://example.test/platform/${platform}`
  }
  for (const [check, result] of Object.entries(acceptance.liveAcceptance)) {
    result.status = "passed"
    result.testedAt = "2026-08-29T00:00:00Z"
    result.evidenceUrl = `https://example.test/live/${check}`
    for (const assertion of Object.keys(result.assertions)) result.assertions[assertion] = true
  }
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, {
    version,
    requirePassed: true,
  }))
  return acceptance
}

async function writeJson(repositoryRoot, path, value) {
  await writeRepositoryFile(repositoryRoot, path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeRepositoryFile(repositoryRoot, path, contents) {
  const absolutePath = join(repositoryRoot, ...path.split("/"))
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents, "utf8")
}

async function readText(repositoryRoot, path) {
  return (await readFile(join(repositoryRoot, ...path.split("/")), "utf8"))
    .replace(/\r\n?/gu, "\n")
}

async function agePaths(repositoryRoot, paths) {
  await Promise.all(paths.map((path) => utimes(
    join(repositoryRoot, ...path.split("/")),
    OLD_TIME,
    OLD_TIME,
  )))
}

async function snapshotPaths(repositoryRoot, paths) {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    await fileSnapshot(join(repositoryRoot, ...path.split("/"))),
  ])))
}

async function fileSnapshot(path) {
  const metadata = await stat(path, { bigint: true })
  return {
    bytes: await readFile(path),
    mtimeNs: metadata.mtimeNs,
  }
}

async function assertRejectsWithoutWrites(repositoryRoot, operation, pattern, label = "conflict") {
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)
  await assert.rejects(async () => operation(), pattern, label)
  assert.deepEqual(await snapshotTree(repositoryRoot), before, `${label} must not write any file`)
}

async function ageRepositoryFiles(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) continue
    if (metadata.isDirectory()) await ageRepositoryFiles(path)
    else if (metadata.isFile()) await utimes(path, OLD_TIME, OLD_TIME)
  }
}

async function snapshotTree(root) {
  const snapshot = {}
  await visit(root, "")
  return snapshot

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const metadata = await lstat(absolutePath, { bigint: true })
      if (metadata.isSymbolicLink()) {
        snapshot[relativePath] = {
          kind: "symlink",
          target: await readlink(absolutePath),
        }
      } else if (metadata.isDirectory()) {
        snapshot[relativePath] = { kind: "directory" }
        await visit(absolutePath, relativePath)
      } else {
        snapshot[relativePath] = {
          bytes: await readFile(absolutePath),
          kind: "file",
          mtimeNs: metadata.mtimeNs,
        }
      }
    }
  }
}
