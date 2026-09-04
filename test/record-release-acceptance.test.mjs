import assert from "node:assert/strict"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  assertAcceptanceRecord,
  assertPublicationAcceptanceRecord,
  createDraftAcceptanceRecord,
  LIVE_ACCEPTANCE_ASSERTIONS,
} from "../scripts/release-acceptance.mjs"
import { inspectReleaseFile } from "../scripts/release-managed-file.mjs"
import { runReleaseAcceptance } from "../scripts/record-release-acceptance.mjs"

const VERSION = "0.0.2"
const ACCEPTANCE_PATH = `docs/releases/v${VERSION}.acceptance.json`
const TESTED_COMMIT = "a".repeat(40)
const OTHER_COMMIT = "b".repeat(40)
const THIRD_COMMIT = "c".repeat(40)
const PASS_TIME = "2026-08-29T10:00:00+08:00"
const COMPLETE_EVIDENCE_TIME = "2026-08-29T02:00:00Z"
const APPROVED_AT = "2026-08-29T03:00:00Z"
const POST_RELEASE_PASS_TIME = "2026-08-29T04:00:00Z"
const DSH_VERSION = "0.1.2-rc.1"
const PLATFORM_NODE_VERSION = "22.22.2"
const PLATFORM_RUNNER = "linux-controlled-runner"
const PLATFORM_EVIDENCE_URL = "https://evidence.example.test/platform/linux"
const TEXT_EVIDENCE_URL = "https://evidence.example.test/live/text-stream"
const APPROVAL_EVIDENCE_URL = "https://evidence.example.test/approval/review"
const OLD_TIME = new Date("2001-02-03T04:05:06Z")

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const COMMAND_PATH = join(REPOSITORY_ROOT, "scripts/record-release-acceptance.mjs")

test("status is read-only and reports progress without exposing evidence values", async (t) => {
  const acceptance = statusAcceptance()
  const repositoryRoot = await createRepository(t, { acceptance })
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)

  const result = await runReleaseAcceptance({
    repositoryRoot,
    arguments: ["status"],
  })

  assert.deepEqual(Object.keys(result).sort(), ["changedPaths", "output", "status"])
  assert.deepEqual(result.changedPaths, [])
  assert.equal(result.status, "unchanged")
  assert.match(result.output, /Release v0\.0\.2 acceptance: draft/u)
  assert.match(result.output, /Platforms: 1\/3 passed/u)
  assert.match(result.output, new RegExp(`Live checks: 1/${Object.keys(LIVE_ACCEPTANCE_ASSERTIONS).length} passed`, "u"))
  assert.match(result.output, /Pending platforms: macos, windows/u)
  assert.match(result.output, /Pending live checks:/u)
  assert.doesNotMatch(result.output, /status-secret/iu)
  for (const value of [
    acceptance.testedCommit,
    acceptance.approvedBy,
    acceptance.approvedAt,
    acceptance.approvalEvidenceUrl,
    acceptance.platforms.linux.testedAt,
    acceptance.platforms.linux.runner,
    acceptance.platforms.linux.evidenceUrl,
    acceptance.liveAcceptance.textStream.testedAt,
    acceptance.liveAcceptance.textStream.evidenceUrl,
  ]) {
    assert.equal(result.output.includes(value), false, `status output must redact ${value}`)
  }
  assert.deepEqual(await snapshotTree(repositoryRoot), before)
})

test("reset-candidate replaces a populated draft with fresh evidence bound to the new commit", async (t) => {
  const initialAcceptance = completeDraftAcceptance()
  initialAcceptance.approvedBy = "superseded-reviewer"
  initialAcceptance.approvedAt = APPROVED_AT
  initialAcceptance.approvalEvidenceUrl = "https://evidence.example.test/approval/superseded"
  assert.doesNotThrow(() => assertAcceptanceRecord(initialAcceptance, { version: VERSION }))
  const repositoryRoot = await createRepository(t, { acceptance: initialAcceptance })
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)
  const arguments_ = resetCandidateArguments()

  const result = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })

  assert.deepEqual(result, {
    changedPaths: [ACCEPTANCE_PATH],
    output: "Reset release acceptance for the new candidate.",
    status: "changed",
  })
  assertSensitiveValuesRedacted(result.output, [TESTED_COMMIT, OTHER_COMMIT])
  const expected = createDraftAcceptanceRecord(VERSION)
  expected.testedCommit = OTHER_COMMIT
  const acceptance = await readAcceptance(repositoryRoot)
  assert.deepEqual(acceptance, expected)
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  assertOnlyAcceptanceChanged(before, await snapshotTree(repositoryRoot))

  await ageRepositoryFiles(repositoryRoot)
  const beforeReplay = await snapshotTree(repositoryRoot)
  const replay = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })
  assert.deepEqual(replay, {
    changedPaths: [],
    output: "Release acceptance is already a fresh draft for this candidate.",
    status: "unchanged",
  })
  assert.deepEqual(await snapshotTree(repositoryRoot), beforeReplay)
})

test("reset-candidate rejects invalid arguments, commit conflicts, and non-fresh replays without writes", async (t) => {
  const mismatchedCommit = freshCandidateAcceptance(THIRD_COMMIT)

  const platformReplay = freshCandidateAcceptance(OTHER_COMMIT)
  platformReplay.platforms.linux = structuredClone(completeDraftAcceptance().platforms.linux)

  const liveReplay = freshCandidateAcceptance(OTHER_COMMIT)
  liveReplay.liveAcceptance.textStream = structuredClone(
    completeDraftAcceptance().liveAcceptance.textStream,
  )

  const approvalReplay = freshCandidateAcceptance(OTHER_COMMIT)
  approvalReplay.approvedBy = "stale-reviewer"
  approvalReplay.approvedAt = APPROVED_AT
  approvalReplay.approvalEvidenceUrl = "https://evidence.example.test/approval/stale"

  for (const acceptance of [platformReplay, liveReplay, approvalReplay]) {
    assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  }

  const cases = [
    {
      label: "missing from commit",
      arguments: resetCandidateArguments({ fromCommit: null }),
      pattern: /--from-commit is required/iu,
    },
    {
      label: "missing to commit",
      arguments: resetCandidateArguments({ toCommit: null }),
      pattern: /--to-commit is required/iu,
    },
    {
      label: "duplicate from commit",
      arguments: [...resetCandidateArguments(), `--from-commit=${TESTED_COMMIT}`],
      pattern: /--from-commit may be provided only once/iu,
    },
    {
      label: "duplicate to commit",
      arguments: [...resetCandidateArguments(), `--to-commit=${OTHER_COMMIT}`],
      pattern: /--to-commit may be provided only once/iu,
    },
    {
      label: "unknown option",
      arguments: [...resetCandidateArguments(), "--force=true"],
      pattern: /Unknown option --force/iu,
    },
    {
      label: "non-equals option spelling",
      arguments: [
        "reset-candidate",
        "--from-commit",
        TESTED_COMMIT,
        `--to-commit=${OTHER_COMMIT}`,
      ],
      pattern: /--name=value form/iu,
    },
    {
      label: "short from commit",
      arguments: resetCandidateArguments({ fromCommit: "a".repeat(39) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "uppercase from commit",
      arguments: resetCandidateArguments({ fromCommit: "A".repeat(40) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "short to commit",
      arguments: resetCandidateArguments({ toCommit: "b".repeat(39) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "uppercase to commit",
      arguments: resetCandidateArguments({ toCommit: "B".repeat(40) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "identical commits",
      arguments: resetCandidateArguments({ toCommit: TESTED_COMMIT }),
      pattern: /fromCommit and toCommit must (?:differ|be different|identify different commits)/iu,
    },
    {
      label: "current commit does not match from commit",
      acceptance: mismatchedCommit,
      arguments: resetCandidateArguments(),
      pattern: /fromCommit does not match|from commit.*does not match|testedCommit does not match/iu,
    },
    {
      label: "approved record",
      acceptance: approvedAcceptance(),
      arguments: resetCandidateArguments(),
      pattern: /approved acceptance record is immutable|only draft/iu,
    },
    {
      label: "target commit replay retains platform evidence",
      acceptance: platformReplay,
      arguments: resetCandidateArguments(),
      pattern: /fresh candidate state|not fresh|non-fresh|fromCommit does not match/iu,
    },
    {
      label: "target commit replay retains live evidence",
      acceptance: liveReplay,
      arguments: resetCandidateArguments(),
      pattern: /fresh candidate state|not fresh|non-fresh|fromCommit does not match/iu,
    },
    {
      label: "target commit replay retains approval evidence",
      acceptance: approvalReplay,
      arguments: resetCandidateArguments(),
      pattern: /fresh candidate state|not fresh|non-fresh|fromCommit does not match/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t, {
      acceptance: fixture.acceptance ?? completeDraftAcceptance(),
    })
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: fixture.arguments }),
      fixture.pattern,
      fixture.label,
    )
  }
})

test("concurrent identical candidate resets write once and leave no lock or temporary file", async (t) => {
  const repositoryRoot = await createRepository(t, { acceptance: completeDraftAcceptance() })
  const outcomes = await Promise.allSettled([
    runReleaseAcceptance({ repositoryRoot, arguments: resetCandidateArguments() }),
    runReleaseAcceptance({ repositoryRoot, arguments: resetCandidateArguments() }),
  ])
  const changed = outcomes.filter(({ status, value }) => (
    status === "fulfilled" && value.status === "changed"
  ))
  const unchanged = outcomes.filter(({ status, value }) => (
    status === "fulfilled" && value.status === "unchanged"
  ))
  const rejected = outcomes.filter(({ status }) => status === "rejected")

  assert.equal(changed.length, 1, "only one concurrent reset may report writing the fresh state")
  assert.equal(unchanged.length + rejected.length, 1)
  for (const outcome of rejected) {
    assert.match(
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      /already being updated|changed after release-acceptance began/iu,
    )
  }

  const expected = createDraftAcceptanceRecord(VERSION)
  expected.testedCommit = OTHER_COMMIT
  assert.deepEqual(await readAcceptance(repositoryRoot), expected)
  const remainingPaths = Object.keys(await snapshotTree(repositoryRoot))
  assert.equal(
    remainingPaths.some((path) => (
      path.endsWith(".release-update.lock")
        || /\.release-acceptance-[^/]+$/u.test(path)
    )),
    false,
    "concurrent reset completion must clean lock and temporary files",
  )
})

test("pass-platform first binds the candidate commit and changes only the selected platform", async (t) => {
  const fixtures = [
    ["linux", "22.22.2"],
    ["macos", "v24.0.0"],
    ["windows", "24.19.0"],
  ]

  for (const [platform, nodeVersion] of fixtures) {
    const initialAcceptance = createDraftAcceptanceRecord(VERSION)
    const repositoryRoot = await createRepository(t, { acceptance: initialAcceptance })
    await ageRepositoryFiles(repositoryRoot)
    const before = await snapshotTree(repositoryRoot)
    const arguments_ = platformPassArguments({ nodeVersion, platform })

    const result = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })

    assert.deepEqual(result, {
      changedPaths: [ACCEPTANCE_PATH],
      output: `Recorded ${platform} platform smoke as passed.`,
      status: "changed",
    })
    assertSensitiveValuesRedacted(result.output, [
      TESTED_COMMIT,
      PASS_TIME,
      `${platform}-controlled-runner`,
      nodeVersion,
      DSH_VERSION,
      `https://evidence.example.test/platform/${platform}`,
    ])

    const acceptance = await readAcceptance(repositoryRoot)
    const expected = structuredClone(initialAcceptance)
    expected.testedCommit = TESTED_COMMIT
    expected.platforms[platform] = {
      status: "passed",
      testedAt: PASS_TIME,
      runner: `${platform}-controlled-runner`,
      nodeVersion,
      dshVersion: DSH_VERSION,
      profileSmoke: "passed",
      evidenceUrl: `https://evidence.example.test/platform/${platform}`,
    }
    assert.deepEqual(acceptance, expected)
    assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
    assert.equal(
      (await readFile(absoluteRepositoryPath(repositoryRoot, ACCEPTANCE_PATH), "utf8")).endsWith("\n"),
      true,
    )
    assertOnlyAcceptanceChanged(before, await snapshotTree(repositoryRoot))
  }
})

test("pass-platform requires every exact option and rejects invalid platform evidence without writes", async (t) => {
  const cases = [
    {
      label: "missing platform",
      arguments: platformPassArguments({ platform: null }),
      pattern: /Usage:.*pass-platform <platform>/iu,
    },
    {
      label: "unknown platform",
      arguments: platformPassArguments({ platform: "solaris" }),
      pattern: /Unknown release platform/iu,
    },
    {
      label: "case-changed platform",
      arguments: platformPassArguments({ platform: "Linux" }),
      pattern: /Unknown release platform/iu,
    },
    {
      label: "prototype platform key",
      arguments: platformPassArguments({ platform: "__proto__" }),
      pattern: /Unknown release platform/iu,
    },
    {
      label: "missing tested commit",
      arguments: platformPassArguments({ testedCommit: null }),
      pattern: /--tested-commit is required/iu,
    },
    {
      label: "missing tested time",
      arguments: platformPassArguments({ testedAt: null }),
      pattern: /--tested-at is required/iu,
    },
    {
      label: "missing runner",
      arguments: platformPassArguments({ runner: null }),
      pattern: /--runner is required/iu,
    },
    {
      label: "missing Node version",
      arguments: platformPassArguments({ nodeVersion: null }),
      pattern: /--node-version is required/iu,
    },
    {
      label: "missing DSH version",
      arguments: platformPassArguments({ dshVersion: null }),
      pattern: /--dsh-version is required/iu,
    },
    {
      label: "missing profile smoke result",
      arguments: platformPassArguments({ profileSmoke: null }),
      pattern: /--profile-smoke is required/iu,
    },
    {
      label: "missing evidence URL",
      arguments: platformPassArguments({ evidenceUrl: null }),
      pattern: /--evidence-url is required/iu,
    },
    {
      label: "duplicate runner",
      arguments: [...platformPassArguments(), `--runner=${PLATFORM_RUNNER}`],
      pattern: /--runner may be provided only once/iu,
    },
    {
      label: "unknown option",
      arguments: [...platformPassArguments(), "--architecture=x64"],
      pattern: /Unknown option --architecture/iu,
    },
    {
      label: "non-equals option spelling",
      arguments: [
        "pass-platform",
        "linux",
        "--tested-commit",
        TESTED_COMMIT,
        `--tested-at=${PASS_TIME}`,
        `--runner=${PLATFORM_RUNNER}`,
        `--node-version=${PLATFORM_NODE_VERSION}`,
        `--dsh-version=${DSH_VERSION}`,
        "--profile-smoke=passed",
        `--evidence-url=${PLATFORM_EVIDENCE_URL}`,
      ],
      pattern: /--name=value form/iu,
    },
    {
      label: "short tested commit",
      arguments: platformPassArguments({ testedCommit: "a".repeat(39) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "uppercase tested commit",
      arguments: platformPassArguments({ testedCommit: "A".repeat(40) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "unsupported Node major",
      arguments: platformPassArguments({ nodeVersion: "20.19.0" }),
      pattern: /tested Node 22 or 24 line/iu,
    },
    {
      label: "Node 22 below minimum",
      arguments: platformPassArguments({ nodeVersion: "22.18.9" }),
      pattern: /at least 22\.19\.0/iu,
    },
    {
      label: "non-concrete Node version",
      arguments: platformPassArguments({ nodeVersion: "24" }),
      pattern: /concrete stable Node version/iu,
    },
    {
      label: "wrong DSH version",
      arguments: platformPassArguments({ dshVersion: "0.1.1-rc.3" }),
      pattern: /dshVersion must be 0\.1\.2-rc\.1/iu,
    },
    {
      label: "unconfirmed profile smoke",
      arguments: platformPassArguments({ profileSmoke: "pending" }),
      pattern: /profileSmoke must be explicitly confirmed as passed/iu,
    },
    {
      label: "placeholder runner",
      arguments: platformPassArguments({ runner: "TBD" }),
      pattern: /runner must not be a placeholder/iu,
    },
    {
      label: "multiline runner",
      arguments: platformPassArguments({ runner: "controlled\nrunner" }),
      pattern: /--name=value form|runner must be a bounded printable line/iu,
    },
    {
      label: "unreal tested time",
      arguments: platformPassArguments({ testedAt: "2026-02-29T00:00:00Z" }),
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "tested time without timezone",
      arguments: platformPassArguments({ testedAt: "2026-08-29T02:00:00" }),
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "HTTP evidence URL",
      arguments: platformPassArguments({ evidenceUrl: "http://evidence.example.test/platform/linux" }),
      pattern: /must use HTTPS/iu,
    },
    {
      label: "evidence URL query",
      arguments: platformPassArguments({
        evidenceUrl: "https://evidence.example.test/platform/linux?token=secret",
      }),
      pattern: /query data/iu,
    },
    {
      label: "evidence URL fragment",
      arguments: platformPassArguments({
        evidenceUrl: "https://evidence.example.test/platform/linux#private",
      }),
      pattern: /fragments/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t)
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: fixture.arguments }),
      fixture.pattern,
      fixture.label,
      fixture.redact,
    )
  }
})

test("pass-platform is byte-idempotent and cannot replace different platform evidence", async (t) => {
  const repositoryRoot = await createRepository(t)
  const arguments_ = platformPassArguments()
  await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })
  await ageRepositoryFiles(repositoryRoot)
  const beforeReplay = await snapshotTree(repositoryRoot)

  const replay = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })

  assert.deepEqual(replay, {
    changedPaths: [],
    output: "linux platform already has identical passed evidence.",
    status: "unchanged",
  })
  assert.deepEqual(await snapshotTree(repositoryRoot), beforeReplay)

  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: platformPassArguments({
        evidenceUrl: "https://evidence.example.test/platform/linux/rerun",
      }),
    }),
    /linux already passed with different evidence/iu,
    "different platform evidence",
  )
})

test("platform and live passes bind both directions to one candidate commit", async (t) => {
  {
    const repositoryRoot = await createRepository(t)
    await runReleaseAcceptance({ repositoryRoot, arguments: platformPassArguments() })
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({
        repositoryRoot,
        arguments: textStreamPassArguments({ testedCommit: OTHER_COMMIT }),
      }),
      /testedCommit does not match/iu,
      "live check with a different platform-bound commit",
    )

    const liveResult = await runReleaseAcceptance({
      repositoryRoot,
      arguments: textStreamPassArguments(),
    })
    assert.equal(liveResult.status, "changed")
    const acceptance = await readAcceptance(repositoryRoot)
    assert.equal(acceptance.testedCommit, TESTED_COMMIT)
    assert.equal(acceptance.platforms.linux.status, "passed")
    assert.equal(acceptance.liveAcceptance.textStream.status, "passed")
  }

  {
    const repositoryRoot = await createRepository(t)
    await runReleaseAcceptance({ repositoryRoot, arguments: textStreamPassArguments() })
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({
        repositoryRoot,
        arguments: platformPassArguments({ testedCommit: OTHER_COMMIT }),
      }),
      /testedCommit does not match/iu,
      "platform with a different live-bound commit",
    )
  }
})

test("pass binds the first full candidate commit and changes only the selected live check", async (t) => {
  const initialAcceptance = createDraftAcceptanceRecord(VERSION)
  const repositoryRoot = await createRepository(t, { acceptance: initialAcceptance })
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)
  const arguments_ = textStreamPassArguments()

  const result = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })

  assert.deepEqual(result, {
    changedPaths: [ACCEPTANCE_PATH],
    output: "Recorded textStream as passed.",
    status: "changed",
  })
  assertSensitiveValuesRedacted(result.output, [TESTED_COMMIT, PASS_TIME, TEXT_EVIDENCE_URL])

  const acceptance = await readAcceptance(repositoryRoot)
  const expected = structuredClone(initialAcceptance)
  expected.testedCommit = TESTED_COMMIT
  expected.liveAcceptance.textStream = {
    status: "passed",
    testedAt: PASS_TIME,
    evidenceUrl: TEXT_EVIDENCE_URL,
    assertions: {
      nonEmptyTextDelta: true,
      terminalStopObserved: true,
    },
  }
  assert.deepEqual(acceptance, expected)
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  assert.equal((await readFile(absoluteRepositoryPath(repositoryRoot, ACCEPTANCE_PATH), "utf8")).endsWith("\n"), true)
  assertOnlyAcceptanceChanged(before, await snapshotTree(repositoryRoot))
})

test("pass requires exact command options and every fixed assertion exactly once", async (t) => {
  const credentialCanary = "credential-canary-must-never-be-read-or-printed"
  const cases = [
    {
      label: "missing check",
      arguments: ["pass", ...textStreamPassArguments().slice(2)],
      pattern: /Usage:.*pass <check>/iu,
    },
    {
      label: "unknown check",
      arguments: textStreamPassArguments({ check: "unknownCheck" }),
      pattern: /Unknown live acceptance check/iu,
    },
    {
      label: "case-changed check",
      arguments: textStreamPassArguments({ check: "TextStream" }),
      pattern: /Unknown live acceptance check/iu,
    },
    {
      label: "prototype key",
      arguments: textStreamPassArguments({ check: "__proto__" }),
      pattern: /Unknown live acceptance check/iu,
    },
    {
      label: "missing tested commit",
      arguments: textStreamPassArguments({ testedCommit: null }),
      pattern: /--tested-commit is required/iu,
    },
    {
      label: "short tested commit",
      arguments: textStreamPassArguments({ testedCommit: "a".repeat(39) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "uppercase tested commit",
      arguments: textStreamPassArguments({ testedCommit: "A".repeat(40) }),
      pattern: /full lowercase Git commit/iu,
    },
    {
      label: "duplicate tested commit",
      arguments: [...textStreamPassArguments(), `--tested-commit=${TESTED_COMMIT}`],
      pattern: /--tested-commit may be provided only once/iu,
    },
    {
      label: "missing tested time",
      arguments: textStreamPassArguments({ testedAt: null }),
      pattern: /--tested-at is required/iu,
    },
    {
      label: "duplicate tested time",
      arguments: [...textStreamPassArguments(), `--tested-at=${PASS_TIME}`],
      pattern: /--tested-at may be provided only once/iu,
    },
    {
      label: "missing evidence URL",
      arguments: textStreamPassArguments({ evidenceUrl: null }),
      pattern: /--evidence-url is required/iu,
    },
    {
      label: "duplicate evidence URL",
      arguments: [...textStreamPassArguments(), `--evidence-url=${TEXT_EVIDENCE_URL}`],
      pattern: /--evidence-url may be provided only once/iu,
    },
    {
      label: "missing assertion",
      arguments: textStreamPassArguments({ assertions: ["nonEmptyTextDelta"] }),
      pattern: /must explicitly confirm exactly/iu,
    },
    {
      label: "duplicate assertion",
      arguments: textStreamPassArguments({
        assertions: ["nonEmptyTextDelta", "terminalStopObserved", "terminalStopObserved"],
      }),
      pattern: /duplicate assertion/iu,
    },
    {
      label: "unknown assertion",
      arguments: textStreamPassArguments({
        assertions: ["nonEmptyTextDelta", "terminalStopObserved", "unreviewedClaim"],
      }),
      pattern: /must explicitly confirm exactly/iu,
    },
    {
      label: "assertion from another check",
      arguments: textStreamPassArguments({
        assertions: ["nonEmptyTextDelta", "reasoningBlockObserved"],
      }),
      pattern: /must explicitly confirm exactly/iu,
    },
    {
      label: "unknown credential option",
      arguments: [...textStreamPassArguments(), `--token=${credentialCanary}`],
      pattern: /Unknown option --token/iu,
      redact: [credentialCanary],
    },
    {
      label: "non-equals option spelling",
      arguments: [
        "pass",
        "textStream",
        "--tested-commit",
        TESTED_COMMIT,
        `--tested-at=${PASS_TIME}`,
        `--evidence-url=${TEXT_EVIDENCE_URL}`,
        "--assert=nonEmptyTextDelta",
        "--assert=terminalStopObserved",
      ],
      pattern: /--name=value form/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t)
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: fixture.arguments }),
      fixture.pattern,
      fixture.label,
      fixture.redact,
    )
  }
})

test("pass rejects unreal timestamps and evidence URLs that can carry hidden data", async (t) => {
  const cases = [
    {
      label: "non-leap February 29",
      testedAt: "2026-02-29T00:00:00Z",
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "April 31",
      testedAt: "2026-04-31T00:00:00Z",
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "24th hour",
      testedAt: "2026-08-29T24:00:00Z",
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "missing timezone",
      testedAt: "2026-08-29T02:00:00",
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "too many fractional digits",
      testedAt: "2026-08-29T02:00:00.1234Z",
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "relative URL",
      evidenceUrl: "/private/evidence",
      pattern: /absolute HTTPS URL/iu,
    },
    {
      label: "HTTP URL",
      evidenceUrl: "http://evidence.example.test/live/text-stream",
      pattern: /must use HTTPS/iu,
    },
    {
      label: "URL userinfo",
      evidenceUrl: "https://operator:secret@evidence.example.test/live/text-stream",
      pattern: /must not contain credentials/iu,
    },
    {
      label: "URL query",
      evidenceUrl: "https://evidence.example.test/live/text-stream?token=secret",
      pattern: /query data/iu,
    },
    {
      label: "URL fragment",
      evidenceUrl: "https://evidence.example.test/live/text-stream#private",
      pattern: /fragments/iu,
    },
    {
      label: "bare query delimiter",
      evidenceUrl: "https://evidence.example.test/live/text-stream?",
      pattern: /query data/iu,
    },
    {
      label: "bare fragment delimiter",
      evidenceUrl: "https://evidence.example.test/live/text-stream#",
      pattern: /fragments/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t)
    const arguments_ = textStreamPassArguments({
      ...(fixture.testedAt === undefined ? {} : { testedAt: fixture.testedAt }),
      ...(fixture.evidenceUrl === undefined ? {} : { evidenceUrl: fixture.evidenceUrl }),
    })
    const rejectedValue = fixture.testedAt ?? fixture.evidenceUrl
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: arguments_ }),
      fixture.pattern,
      fixture.label,
      [rejectedValue],
    )
  }
})

test("pass is byte-idempotent and rejects different evidence or a different bound commit", async (t) => {
  const repositoryRoot = await createRepository(t)
  const arguments_ = textStreamPassArguments()
  await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })
  await ageRepositoryFiles(repositoryRoot)
  const beforeReplay = await snapshotTree(repositoryRoot)

  const replay = await runReleaseAcceptance({
    repositoryRoot,
    arguments: textStreamPassArguments({
      assertions: ["terminalStopObserved", "nonEmptyTextDelta"],
    }),
  })

  assert.deepEqual(replay, {
    changedPaths: [],
    output: "textStream already has identical passed evidence.",
    status: "unchanged",
  })
  assert.deepEqual(await snapshotTree(repositoryRoot), beforeReplay)

  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: textStreamPassArguments({
        evidenceUrl: "https://evidence.example.test/live/text-stream/rerun",
      }),
    }),
    /already passed with different evidence/iu,
    "different evidence",
  )

  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: livePassArguments({
        assertions: ["requestSucceeded"],
        check: "transportAuto",
        evidenceUrl: "https://evidence.example.test/live/transport-auto",
        testedCommit: OTHER_COMMIT,
      }),
    }),
    /testedCommit does not match/iu,
    "different candidate commit",
  )
})

test("approve records a later maintainer decision after all platforms pass while live checks remain pending", async (t) => {
  const initialAcceptance = completePlatformDraftAcceptance()
  const repositoryRoot = await createRepository(t, { acceptance: initialAcceptance })
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)
  const arguments_ = approveArguments()

  const result = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })

  assert.deepEqual(result, {
    changedPaths: [ACCEPTANCE_PATH],
    output: "Approved the release acceptance record.",
    status: "changed",
  })
  assertSensitiveValuesRedacted(result.output, [
    TESTED_COMMIT,
    "release-maintainer",
    APPROVED_AT,
    APPROVAL_EVIDENCE_URL,
  ])
  const acceptance = await readAcceptance(repositoryRoot)
  assert.equal(acceptance.releaseStatus, "approved")
  assert.equal(acceptance.testedCommit, TESTED_COMMIT)
  assert.equal(acceptance.approvedBy, "release-maintainer")
  assert.equal(acceptance.approvedAt, APPROVED_AT)
  assert.equal(acceptance.approvalEvidenceUrl, APPROVAL_EVIDENCE_URL)
  assert.deepEqual(acceptance.platforms, initialAcceptance.platforms)
  assert.deepEqual(acceptance.liveAcceptance, initialAcceptance.liveAcceptance)
  assert.doesNotThrow(() => assertPublicationAcceptanceRecord(acceptance, { version: VERSION }))
  assert.throws(
    () => assertAcceptanceRecord(acceptance, { version: VERSION, requirePassed: true }),
    /acceptance must pass for complete live validation/iu,
  )
  assertOnlyAcceptanceChanged(before, await snapshotTree(repositoryRoot))

  await ageRepositoryFiles(repositoryRoot)
  const beforeReplay = await snapshotTree(repositoryRoot)
  const replay = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })
  assert.deepEqual(replay, {
    changedPaths: [],
    output: "The release acceptance record already has identical approval.",
    status: "unchanged",
  })
  assert.deepEqual(await snapshotTree(repositoryRoot), beforeReplay)
})

test("approve rejects a pending platform, an earlier decision, mismatched commit, or loose options", async (t) => {
  const pendingPlatform = completePlatformDraftAcceptance()
  pendingPlatform.platforms.linux = createDraftAcceptanceRecord(VERSION).platforms.linux

  const cases = [
    {
      label: "pending platform",
      acceptance: pendingPlatform,
      arguments: approveArguments(),
      pattern: /linux acceptance must pass/iu,
    },
    {
      label: "approval before latest evidence",
      acceptance: completePlatformDraftAcceptance(),
      arguments: approveArguments({ approvedAt: "2026-08-29T01:59:59Z" }),
      pattern: /must not precede the latest accepted evidence/iu,
    },
    {
      label: "different candidate commit",
      acceptance: completePlatformDraftAcceptance(),
      arguments: approveArguments({ testedCommit: OTHER_COMMIT }),
      pattern: /testedCommit does not match/iu,
    },
    {
      label: "missing maintainer",
      acceptance: completePlatformDraftAcceptance(),
      arguments: approveArguments({ approvedBy: null }),
      pattern: /--approved-by is required/iu,
    },
    {
      label: "duplicate approval time",
      acceptance: completePlatformDraftAcceptance(),
      arguments: [...approveArguments(), `--approved-at=${APPROVED_AT}`],
      pattern: /--approved-at may be provided only once/iu,
    },
    {
      label: "placeholder maintainer",
      acceptance: completePlatformDraftAcceptance(),
      arguments: approveArguments({ approvedBy: "TBD" }),
      pattern: /identify the approving maintainer/iu,
    },
    {
      label: "approval URL query",
      acceptance: completePlatformDraftAcceptance(),
      arguments: approveArguments({
        evidenceUrl: "https://evidence.example.test/approval?token=secret",
      }),
      pattern: /query data/iu,
    },
    {
      label: "unreviewed approval option",
      acceptance: completePlatformDraftAcceptance(),
      arguments: [...approveArguments(), "--assert=not-applicable"],
      pattern: /Unknown option --assert/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t, { acceptance: fixture.acceptance })
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: fixture.arguments }),
      fixture.pattern,
      fixture.label,
    )
  }
})

test("an approved release permits a pending live check to be backfilled without exposing evidence", async (t) => {
  const initialAcceptance = approvedAcceptanceWithPendingLive()
  const repositoryRoot = await createRepository(t, { acceptance: initialAcceptance })
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)
  const arguments_ = textStreamPassArguments({ testedAt: POST_RELEASE_PASS_TIME })

  const result = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })

  assert.deepEqual(result, {
    changedPaths: [ACCEPTANCE_PATH],
    output: "Recorded textStream as passed.",
    status: "changed",
  })
  assertSensitiveValuesRedacted(result.output, [
    TESTED_COMMIT,
    POST_RELEASE_PASS_TIME,
    TEXT_EVIDENCE_URL,
    APPROVAL_EVIDENCE_URL,
  ])
  const acceptance = await readAcceptance(repositoryRoot)
  assert.equal(acceptance.releaseStatus, "approved")
  assert.equal(acceptance.testedCommit, initialAcceptance.testedCommit)
  assert.equal(acceptance.approvedBy, initialAcceptance.approvedBy)
  assert.equal(acceptance.approvedAt, initialAcceptance.approvedAt)
  assert.equal(acceptance.approvalEvidenceUrl, initialAcceptance.approvalEvidenceUrl)
  assert.deepEqual(acceptance.platforms, initialAcceptance.platforms)
  assert.deepEqual(acceptance.liveAcceptance.textStream, {
    status: "passed",
    testedAt: POST_RELEASE_PASS_TIME,
    evidenceUrl: TEXT_EVIDENCE_URL,
    assertions: {
      nonEmptyTextDelta: true,
      terminalStopObserved: true,
    },
  })
  assert.equal(acceptance.liveAcceptance.fastPriority.status, "pending")
  assert.doesNotThrow(() => assertPublicationAcceptanceRecord(acceptance, { version: VERSION }))
  assertOnlyAcceptanceChanged(before, await snapshotTree(repositoryRoot))

  const status = await runReleaseAcceptance({ repositoryRoot, arguments: ["status"] })
  assert.match(status.output, /Release v0\.0\.2 acceptance: approved/u)
  assert.match(status.output, new RegExp(`Live checks: 1/${Object.keys(LIVE_ACCEPTANCE_ASSERTIONS).length} passed`, "u"))
  assert.match(status.output, /Pending live checks:/u)
  assertSensitiveValuesRedacted(status.output, [
    acceptance.testedCommit,
    acceptance.approvedBy,
    acceptance.approvedAt,
    acceptance.approvalEvidenceUrl,
    acceptance.liveAcceptance.textStream.testedAt,
    acceptance.liveAcceptance.textStream.evidenceUrl,
  ])

  await ageRepositoryFiles(repositoryRoot)
  const beforeReplay = await snapshotTree(repositoryRoot)
  const replay = await runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })
  assert.deepEqual(replay, {
    changedPaths: [],
    output: "textStream already has identical passed evidence.",
    status: "unchanged",
  })
  assert.deepEqual(await snapshotTree(repositoryRoot), beforeReplay)
})

test("approved live backfill still requires the exact assertions, commit, timestamp, and evidence URL", async (t) => {
  const cases = [
    {
      label: "missing fixed assertion",
      arguments: textStreamPassArguments({
        assertions: ["nonEmptyTextDelta"],
        testedAt: POST_RELEASE_PASS_TIME,
      }),
      pattern: /must explicitly confirm exactly/iu,
    },
    {
      label: "different candidate commit",
      arguments: textStreamPassArguments({
        testedAt: POST_RELEASE_PASS_TIME,
        testedCommit: OTHER_COMMIT,
      }),
      pattern: /testedCommit does not match/iu,
    },
    {
      label: "unreal timestamp",
      arguments: textStreamPassArguments({ testedAt: "2026-08-29T24:00:00Z" }),
      pattern: /real RFC3339 timestamp/iu,
    },
    {
      label: "evidence URL query",
      arguments: textStreamPassArguments({
        evidenceUrl: "https://evidence.example.test/live/text-stream?token=secret",
        testedAt: POST_RELEASE_PASS_TIME,
      }),
      pattern: /query data/iu,
    },
  ]

  for (const fixture of cases) {
    const repositoryRoot = await createRepository(t, {
      acceptance: approvedAcceptanceWithPendingLive(),
    })
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: fixture.arguments }),
      fixture.pattern,
      fixture.label,
    )
  }
})

test("an approved record permits identical replays but rejects every attempted mutation", async (t) => {
  const acceptance = approvedAcceptance()
  const repositoryRoot = await createRepository(t, { acceptance })
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)

  const identicalPass = await runReleaseAcceptance({
    repositoryRoot,
    arguments: textStreamPassArguments({
      evidenceUrl: acceptance.liveAcceptance.textStream.evidenceUrl,
      testedAt: acceptance.liveAcceptance.textStream.testedAt,
    }),
  })
  assert.equal(identicalPass.status, "unchanged")
  assert.deepEqual(identicalPass.changedPaths, [])
  assert.deepEqual(await snapshotTree(repositoryRoot), before)

  const identicalPlatform = await runReleaseAcceptance({
    repositoryRoot,
    arguments: platformPassArguments({
      dshVersion: acceptance.platforms.linux.dshVersion,
      evidenceUrl: acceptance.platforms.linux.evidenceUrl,
      nodeVersion: acceptance.platforms.linux.nodeVersion,
      runner: acceptance.platforms.linux.runner,
      testedAt: acceptance.platforms.linux.testedAt,
    }),
  })
  assert.equal(identicalPlatform.status, "unchanged")
  assert.deepEqual(identicalPlatform.changedPaths, [])
  assert.deepEqual(await snapshotTree(repositoryRoot), before)

  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: approveArguments({ approvedBy: "different-maintainer" }),
    }),
    /approved acceptance record is immutable/iu,
    "changed approval",
  )
  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: textStreamPassArguments({
        evidenceUrl: "https://evidence.example.test/live/text-stream/replacement",
        testedAt: acceptance.liveAcceptance.textStream.testedAt,
      }),
    }),
    /already passed with different evidence/iu,
    "changed live evidence",
  )
  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: platformPassArguments({
        dshVersion: acceptance.platforms.linux.dshVersion,
        evidenceUrl: "https://evidence.example.test/platform/linux/replacement",
        nodeVersion: acceptance.platforms.linux.nodeVersion,
        runner: acceptance.platforms.linux.runner,
        testedAt: acceptance.platforms.linux.testedAt,
      }),
    }),
    /approved acceptance record is immutable/iu,
    "changed platform evidence",
  )
  await assertRejectsWithoutWrites(
    repositoryRoot,
    () => runReleaseAcceptance({
      repositoryRoot,
      arguments: resetCandidateArguments(),
    }),
    /approved acceptance record is immutable/iu,
    "candidate reset",
  )
})

test("acceptance files and their parent directories may not cross symlink boundaries", {
  skip: process.platform === "win32" ? "portable Windows runners may not permit symlink creation" : false,
}, async (t) => {
  {
    const repositoryRoot = await createRepository(t)
    const acceptancePath = absoluteRepositoryPath(repositoryRoot, ACCEPTANCE_PATH)
    const outsidePath = join(dirname(repositoryRoot), "outside-acceptance.json")
    const outsideContent = `${JSON.stringify(createDraftAcceptanceRecord(VERSION), null, 2)}\n`
    await writeFile(outsidePath, outsideContent, "utf8")
    await unlink(acceptancePath)
    await symlink(relative(dirname(acceptancePath), outsidePath), acceptancePath, "file")
    const outsideBefore = await fileSnapshot(outsidePath)

    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: ["status"] }),
      /symlink|symbolic link/iu,
      "acceptance file symlink",
    )
    assert.deepEqual(await fileSnapshot(outsidePath), outsideBefore)
    assert.equal(await readFile(outsidePath, "utf8"), outsideContent)
  }

  {
    const repositoryRoot = await createRepository(t, { createReleasesDirectory: false })
    const outsideDirectory = join(dirname(repositoryRoot), "outside-releases")
    await mkdir(outsideDirectory)
    await writeFile(join(outsideDirectory, "sentinel.txt"), "outside sentinel\n", "utf8")
    const releasesPath = join(repositoryRoot, "docs/releases")
    await symlink(relative(dirname(releasesPath), outsideDirectory), releasesPath, "dir")
    const outsideBefore = await snapshotTree(outsideDirectory)

    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: ["status"] }),
      /symlink|symbolic link/iu,
      "acceptance parent symlink",
    )
    assert.deepEqual(await snapshotTree(outsideDirectory), outsideBefore)
  }
})

test("managed release paths reject every non-canonical spelling before reaching an outside symlink target", {
  skip: process.platform === "win32" ? "portable Windows runners may not permit symlink creation" : false,
}, async (t) => {
  const repositoryRoot = await createRepository(t)
  const outsideDirectory = join(dirname(repositoryRoot), "outside-managed-path")
  const outsidePath = join(outsideDirectory, "sentinel.txt")
  await mkdir(outsideDirectory)
  await writeFile(outsidePath, "outside path sentinel\n", "utf8")
  const escapeLink = join(repositoryRoot, "escape-link")
  await symlink(relative(repositoryRoot, outsideDirectory), escapeLink, "dir")
  const outsideBefore = await snapshotTree(outsideDirectory)

  const cases = [
    {
      label: "absolute path",
      path: outsidePath,
      pattern: /repository-relative POSIX path/iu,
    },
    {
      label: "backslash path",
      path: `docs\\releases\\v${VERSION}.acceptance.json`,
      pattern: /repository-relative POSIX path/iu,
    },
    {
      label: "dot segment",
      path: `docs/./releases/v${VERSION}.acceptance.json`,
      pattern: /canonical repository-relative POSIX path/iu,
    },
    {
      label: "parent segment",
      path: `docs/releases/../v${VERSION}.acceptance.json`,
      pattern: /canonical repository-relative POSIX path/iu,
    },
    {
      label: "empty segment",
      path: `docs//releases/v${VERSION}.acceptance.json`,
      pattern: /canonical repository-relative POSIX path/iu,
    },
    {
      label: "outside parent symlink",
      path: "escape-link/sentinel.txt",
      pattern: /symlink|symbolic link/iu,
    },
  ]

  for (const fixture of cases) {
    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => inspectReleaseFile(repositoryRoot, fixture.path, { required: true }),
      fixture.pattern,
      fixture.label,
    )
    assert.deepEqual(
      await snapshotTree(outsideDirectory),
      outsideBefore,
      `${fixture.label} must not touch the outside symlink target`,
    )
  }
})

test("concurrent passes never report two successes while losing one accepted check", async (t) => {
  const repositoryRoot = await createRepository(t)
  const attempts = [
    {
      check: "textStream",
      arguments: textStreamPassArguments(),
    },
    {
      check: "reasoningStream",
      arguments: livePassArguments({
        assertions: ["reasoningBlockObserved", "terminalStopObserved"],
        check: "reasoningStream",
        evidenceUrl: "https://evidence.example.test/live/reasoning-stream",
      }),
    },
  ]

  const outcomes = await Promise.allSettled(attempts.map(({ arguments: arguments_ }) => (
    runReleaseAcceptance({ repositoryRoot, arguments: arguments_ })
  )))
  const fulfilled = outcomes.filter(({ status }) => status === "fulfilled")
  const rejected = outcomes.filter(({ status }) => status === "rejected")

  assert.ok(
    (fulfilled.length === 2 && rejected.length === 0)
      || (fulfilled.length === 1 && rejected.length === 1),
    "concurrent passes must either preserve both results or report one explicit conflict",
  )
  for (const outcome of fulfilled) {
    assert.equal(outcome.value.status, "changed")
    assert.deepEqual(outcome.value.changedPaths, [ACCEPTANCE_PATH])
  }
  for (const outcome of rejected) {
    assert.match(
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      /already being updated|changed after release-acceptance began/iu,
    )
  }

  const acceptance = await readAcceptance(repositoryRoot)
  const passedChecks = attempts.filter(({ check }) => (
    acceptance.liveAcceptance[check].status === "passed"
  ))
  assert.equal(
    passedChecks.length,
    fulfilled.length,
    "every fulfilled pass must remain present in the final acceptance record",
  )
  assert.equal(acceptance.testedCommit, TESTED_COMMIT)
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))

  const remainingPaths = Object.keys(await snapshotTree(repositoryRoot))
  assert.equal(
    remainingPaths.some((path) => (
      path.endsWith(".release-update.lock")
        || /\.release-acceptance-[^/]+$/u.test(path)
    )),
    false,
    "concurrent completion must clean lock and temporary files",
  )
})

test("semantic JSON reordering stays byte-idempotent and malformed JSON errors redact source content", async (t) => {
  {
    const acceptance = reorderedPassedAcceptance()
    const repositoryRoot = await createRepository(t, { acceptance })
    await ageRepositoryFiles(repositoryRoot)
    const before = await snapshotTree(repositoryRoot)

    const result = await runReleaseAcceptance({
      repositoryRoot,
      arguments: textStreamPassArguments(),
    })

    assert.deepEqual(result, {
      changedPaths: [],
      output: "textStream already has identical passed evidence.",
      status: "unchanged",
    })
    assert.deepEqual(
      await snapshotTree(repositoryRoot),
      before,
      "human-authored key order must remain byte- and mtime-identical",
    )
  }

  {
    const canary = "invalid-json-secret-canary-must-not-leak"
    const repositoryRoot = await createRepository(t)
    await writeFile(
      absoluteRepositoryPath(repositoryRoot, ACCEPTANCE_PATH),
      `{"schemaVersion":3,"private":"${canary}",`,
      "utf8",
    )

    await assertRejectsWithoutWrites(
      repositoryRoot,
      () => runReleaseAcceptance({ repositoryRoot, arguments: ["status"] }),
      /acceptance\.json is not valid JSON/iu,
      "malformed acceptance JSON",
      [canary],
    )
  }
})

test("the package command and its local dependency closure stay offline and credential-free", async () => {
  const packageJson = JSON.parse(await readFile(join(REPOSITORY_ROOT, "package.json"), "utf8"))
  assert.equal(
    packageJson.scripts["release:acceptance"],
    "node scripts/record-release-acceptance.mjs",
  )

  const modules = await readLocalModuleClosure(COMMAND_PATH)
  assert.ok(modules.length >= 1)
  const forbiddenNodeImports = new Set([
    "node:child_process",
    "node:dns",
    "node:http",
    "node:http2",
    "node:https",
    "node:net",
    "node:tls",
  ])
  for (const module of modules) {
    const label = relative(REPOSITORY_ROOT, module.path).replaceAll("\\", "/")
    assert.doesNotMatch(module.source, /\bprocess\.env\b/u, `${label} must not read environment credentials`)
    assert.doesNotMatch(module.source, /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u, `${label} must not open a network client`)
    for (const specifier of module.specifiers) {
      assert.equal(
        [...forbiddenNodeImports].some((forbidden) => (
          specifier === forbidden || specifier.startsWith(`${forbidden}/`)
        )),
        false,
        `${label} must not import ${specifier}`,
      )
    }
  }
})

function resetCandidateArguments({
  fromCommit = TESTED_COMMIT,
  toCommit = OTHER_COMMIT,
} = {}) {
  const arguments_ = ["reset-candidate"]
  if (fromCommit !== null) arguments_.push(`--from-commit=${fromCommit}`)
  if (toCommit !== null) arguments_.push(`--to-commit=${toCommit}`)
  return arguments_
}

function platformPassArguments({
  dshVersion = DSH_VERSION,
  evidenceUrl,
  nodeVersion = PLATFORM_NODE_VERSION,
  platform = "linux",
  profileSmoke = "passed",
  runner,
  testedAt = PASS_TIME,
  testedCommit = TESTED_COMMIT,
} = {}) {
  const platformName = platform ?? "linux"
  const arguments_ = ["pass-platform"]
  if (platform !== null) arguments_.push(platform)
  if (testedCommit !== null) arguments_.push(`--tested-commit=${testedCommit}`)
  if (testedAt !== null) arguments_.push(`--tested-at=${testedAt}`)
  if (runner !== null) arguments_.push(`--runner=${runner ?? `${platformName}-controlled-runner`}`)
  if (nodeVersion !== null) arguments_.push(`--node-version=${nodeVersion}`)
  if (dshVersion !== null) arguments_.push(`--dsh-version=${dshVersion}`)
  if (profileSmoke !== null) arguments_.push(`--profile-smoke=${profileSmoke}`)
  if (evidenceUrl !== null) {
    arguments_.push(
      `--evidence-url=${evidenceUrl ?? `https://evidence.example.test/platform/${platformName}`}`,
    )
  }
  return arguments_
}

function textStreamPassArguments(options = {}) {
  return livePassArguments({
    assertions: ["nonEmptyTextDelta", "terminalStopObserved"],
    check: "textStream",
    evidenceUrl: TEXT_EVIDENCE_URL,
    testedAt: PASS_TIME,
    testedCommit: TESTED_COMMIT,
    ...options,
  })
}

function livePassArguments({
  assertions,
  check,
  evidenceUrl,
  testedAt = PASS_TIME,
  testedCommit = TESTED_COMMIT,
}) {
  const arguments_ = ["pass", check]
  if (testedCommit !== null) arguments_.push(`--tested-commit=${testedCommit}`)
  if (testedAt !== null) arguments_.push(`--tested-at=${testedAt}`)
  if (evidenceUrl !== null) arguments_.push(`--evidence-url=${evidenceUrl}`)
  for (const assertionName of assertions) arguments_.push(`--assert=${assertionName}`)
  return arguments_
}

function approveArguments({
  approvedAt = APPROVED_AT,
  approvedBy = "release-maintainer",
  evidenceUrl = APPROVAL_EVIDENCE_URL,
  testedCommit = TESTED_COMMIT,
} = {}) {
  const arguments_ = ["approve"]
  if (testedCommit !== null) arguments_.push(`--tested-commit=${testedCommit}`)
  if (approvedBy !== null) arguments_.push(`--approved-by=${approvedBy}`)
  if (approvedAt !== null) arguments_.push(`--approved-at=${approvedAt}`)
  if (evidenceUrl !== null) arguments_.push(`--evidence-url=${evidenceUrl}`)
  return arguments_
}

function statusAcceptance() {
  const acceptance = createDraftAcceptanceRecord(VERSION)
  acceptance.testedCommit = TESTED_COMMIT
  acceptance.approvedBy = "status-secret-maintainer"
  acceptance.approvedAt = "2026-08-29T04:00:00Z"
  acceptance.approvalEvidenceUrl = "https://status-secret.example.test/approval"
  acceptance.platforms.linux = {
    status: "passed",
    testedAt: "2026-08-29T01:00:00Z",
    runner: "status-secret-controlled-runner",
    nodeVersion: "24.19.0",
    dshVersion: "0.1.2-rc.1",
    profileSmoke: "passed",
    evidenceUrl: "https://status-secret.example.test/platform/linux",
  }
  acceptance.liveAcceptance.textStream = {
    status: "passed",
    testedAt: "2026-08-29T01:30:00Z",
    evidenceUrl: "https://status-secret.example.test/live/text-stream",
    assertions: {
      nonEmptyTextDelta: true,
      terminalStopObserved: true,
    },
  }
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  return acceptance
}

function completePlatformDraftAcceptance() {
  const acceptance = createDraftAcceptanceRecord(VERSION)
  acceptance.testedCommit = TESTED_COMMIT
  for (const [platform, result] of Object.entries(acceptance.platforms)) {
    result.status = "passed"
    result.testedAt = COMPLETE_EVIDENCE_TIME
    result.runner = `${platform}-controlled-runner`
    result.nodeVersion = "24.19.0"
    result.profileSmoke = "passed"
    result.evidenceUrl = `https://evidence.example.test/platform/${platform}`
  }
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  return acceptance
}

function completeDraftAcceptance() {
  const acceptance = completePlatformDraftAcceptance()
  for (const [check, result] of Object.entries(acceptance.liveAcceptance)) {
    result.status = "passed"
    result.testedAt = COMPLETE_EVIDENCE_TIME
    result.evidenceUrl = `https://evidence.example.test/live/${check}`
    for (const assertionName of Object.keys(result.assertions)) {
      result.assertions[assertionName] = true
    }
  }
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  return acceptance
}

function freshCandidateAcceptance(testedCommit) {
  const acceptance = createDraftAcceptanceRecord(VERSION)
  acceptance.testedCommit = testedCommit
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, { version: VERSION }))
  return acceptance
}

function approvedAcceptance() {
  const acceptance = completeDraftAcceptance()
  acceptance.releaseStatus = "approved"
  acceptance.approvedBy = "release-maintainer"
  acceptance.approvedAt = APPROVED_AT
  acceptance.approvalEvidenceUrl = APPROVAL_EVIDENCE_URL
  assert.doesNotThrow(() => assertAcceptanceRecord(acceptance, {
    version: VERSION,
    requirePassed: true,
  }))
  return acceptance
}

function approvedAcceptanceWithPendingLive() {
  const acceptance = completePlatformDraftAcceptance()
  acceptance.releaseStatus = "approved"
  acceptance.approvedBy = "release-maintainer"
  acceptance.approvedAt = APPROVED_AT
  acceptance.approvalEvidenceUrl = APPROVAL_EVIDENCE_URL
  assert.doesNotThrow(() => assertPublicationAcceptanceRecord(acceptance, {
    version: VERSION,
  }))
  return acceptance
}

function reorderedPassedAcceptance() {
  const acceptance = createDraftAcceptanceRecord(VERSION)
  acceptance.testedCommit = TESTED_COMMIT
  acceptance.liveAcceptance.textStream = {
    assertions: {
      terminalStopObserved: true,
      nonEmptyTextDelta: true,
    },
    evidenceUrl: TEXT_EVIDENCE_URL,
    testedAt: PASS_TIME,
    status: "passed",
  }
  const liveAcceptance = Object.fromEntries(Object.entries(acceptance.liveAcceptance).reverse())
  const platforms = Object.fromEntries(Object.entries(acceptance.platforms).reverse())
  const reordered = {
    liveAcceptance,
    platforms,
    approvalEvidenceUrl: acceptance.approvalEvidenceUrl,
    approvedAt: acceptance.approvedAt,
    approvedBy: acceptance.approvedBy,
    testedCommit: acceptance.testedCommit,
    releaseStatus: acceptance.releaseStatus,
    version: acceptance.version,
    schemaVersion: acceptance.schemaVersion,
  }
  assert.doesNotThrow(() => assertAcceptanceRecord(reordered, { version: VERSION }))
  return reordered
}

async function createRepository(t, {
  acceptance = createDraftAcceptanceRecord(VERSION),
  createReleasesDirectory = true,
} = {}) {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "dsh-record-acceptance-test-"))
  const repositoryRoot = join(sandboxRoot, "repository")
  await mkdir(join(repositoryRoot, "docs"), { recursive: true })
  await mkdir(join(repositoryRoot, "custom"), { recursive: true })
  if (createReleasesDirectory) {
    await mkdir(join(repositoryRoot, "docs/releases"), { recursive: true })
  }
  t.after(() => rm(sandboxRoot, { force: true, recursive: true }))

  await writeJson(repositoryRoot, "package.json", {
    name: "dsh-codex-community",
    version: VERSION,
    description: "temporary acceptance fixture",
    type: "module",
  })
  await writeRepositoryFile(repositoryRoot, "README.md", "scope sentinel\n")
  await writeRepositoryFile(repositoryRoot, "custom/nested.txt", "nested scope sentinel\n")
  if (createReleasesDirectory) {
    await writeJson(repositoryRoot, ACCEPTANCE_PATH, acceptance)
  }
  return repositoryRoot
}

async function readAcceptance(repositoryRoot) {
  return JSON.parse(await readFile(absoluteRepositoryPath(repositoryRoot, ACCEPTANCE_PATH), "utf8"))
}

async function writeJson(repositoryRoot, path, value) {
  await writeRepositoryFile(repositoryRoot, path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeRepositoryFile(repositoryRoot, path, contents) {
  const absolutePath = absoluteRepositoryPath(repositoryRoot, path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents, "utf8")
}

function absoluteRepositoryPath(repositoryRoot, path) {
  return join(repositoryRoot, ...path.split("/"))
}

function assertOnlyAcceptanceChanged(before, after) {
  const withoutAcceptance = (snapshot) => Object.fromEntries(
    Object.entries(snapshot).filter(([path]) => path !== ACCEPTANCE_PATH),
  )
  assert.deepEqual(withoutAcceptance(after), withoutAcceptance(before))
  assert.notDeepEqual(after[ACCEPTANCE_PATH], before[ACCEPTANCE_PATH])
}

function assertSensitiveValuesRedacted(output, values) {
  for (const value of values) {
    assert.equal(output.includes(value), false, `output must not expose ${value}`)
  }
}

async function assertRejectsWithoutWrites(
  repositoryRoot,
  operation,
  pattern,
  label,
  redactedValues = [],
) {
  await ageRepositoryFiles(repositoryRoot)
  const before = await snapshotTree(repositoryRoot)
  let observedError
  await assert.rejects(operation, (error) => {
    observedError = error
    assert.match(error instanceof Error ? error.message : String(error), pattern)
    return true
  }, label)
  assert.deepEqual(await snapshotTree(repositoryRoot), before, `${label} must not write any file`)
  const message = observedError instanceof Error ? observedError.message : String(observedError)
  assertSensitiveValuesRedacted(message, redactedValues)
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

async function fileSnapshot(path) {
  const metadata = await lstat(path, { bigint: true })
  return {
    bytes: await readFile(path),
    mtimeNs: metadata.mtimeNs,
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

async function readLocalModuleClosure(entryPath) {
  const queue = [entryPath]
  const visited = new Set()
  const modules = []

  while (queue.length > 0) {
    const path = queue.shift()
    if (visited.has(path)) continue
    visited.add(path)
    const source = await readFile(path, "utf8")
    const specifiers = [...source.matchAll(/\b(?:from\s+|import\s*)["']([^"']+)["']/gu)]
      .map((match) => match[1])
    modules.push({ path, source, specifiers })
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue
      const dependencyPath = resolve(dirname(path), specifier)
      assert.ok(
        dependencyPath.startsWith(`${join(REPOSITORY_ROOT, "scripts")}${sep}`),
        `${specifier} must stay within scripts`,
      )
      queue.push(dependencyPath)
    }
  }

  return modules
}
