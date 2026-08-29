import { dirname, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { fileURLToPath } from "node:url"

import {
  assertAcceptanceRecord,
  assertPublicationAcceptanceRecord,
  createDraftAcceptanceRecord,
  LIVE_ACCEPTANCE_ASSERTIONS,
} from "./release-acceptance.mjs"
import {
  assertReleaseFile as assert,
  inspectReleaseFile,
  parseReleaseJson,
  ReleaseFileError,
  writeReleaseFileAtomically,
} from "./release-managed-file.mjs"
import {
  assertReleaseVersion,
  releaseDocumentPaths,
} from "./release-version.mjs"

const PACKAGE_NAME = "dsh-codex-community"
const PACKAGE_PATH = "package.json"
const PLACEHOLDER_PATTERN = /\b(?:TBD|TODO|PENDING|DRAFT|UNRELEASED)\b|待补|未发布|草稿/iu

export async function acceptanceStatus({ repositoryRoot }) {
  const context = await readAcceptanceContext(repositoryRoot)
  const platformEntries = Object.entries(context.acceptance.platforms)
  const liveEntries = Object.entries(context.acceptance.liveAcceptance)
  return {
    live: summarizeEntries(liveEntries),
    platforms: summarizeEntries(platformEntries),
    releaseStatus: context.acceptance.releaseStatus,
    version: context.version,
  }
}

export async function resetAcceptanceCandidate({
  fromCommit,
  repositoryRoot,
  toCommit,
}) {
  assertTestedCommit(fromCommit, "fromCommit")
  assertTestedCommit(toCommit, "toCommit")
  assert(fromCommit !== toCommit, "fromCommit and toCommit must identify different commits")

  const context = await readAcceptanceContext(repositoryRoot)
  const nextAcceptance = createDraftAcceptanceRecord(context.version)
  nextAcceptance.testedCommit = toCommit
  validateAcceptance(nextAcceptance, context.version, context.acceptancePath)

  if (sameJson(context.acceptance, nextAcceptance)) {
    return { path: context.acceptancePath, status: "unchanged" }
  }

  assert(
    context.acceptance.releaseStatus === "draft",
    "An approved acceptance record is immutable and cannot be reset",
  )
  assert(
    context.acceptance.testedCommit === fromCommit,
    "fromCommit does not match the release candidate currently bound to this record",
  )

  await writeAcceptance(context, nextAcceptance)
  return { path: context.acceptancePath, status: "changed" }
}

export async function recordPlatformAcceptance({
  dshVersion,
  evidenceUrl,
  nodeVersion,
  platform,
  profileSmoke,
  repositoryRoot,
  runner,
  testedAt,
  testedCommit,
}) {
  const context = await readAcceptanceContext(repositoryRoot)
  assert(
    Object.hasOwn(context.acceptance.platforms, platform),
    "Unknown release platform; use status to list the fixed platforms",
  )
  assertTestedCommit(testedCommit)
  assert(
    context.acceptance.testedCommit === "TBD"
      || context.acceptance.testedCommit === testedCommit,
    "testedCommit does not match the release candidate already bound to this record",
  )
  assert(profileSmoke === "passed", "profileSmoke must be explicitly confirmed as passed")

  const nextResult = {
    status: "passed",
    testedAt,
    runner,
    nodeVersion,
    dshVersion,
    profileSmoke: "passed",
    evidenceUrl,
  }
  const currentResult = context.acceptance.platforms[platform]
  const nextAcceptance = structuredClone(context.acceptance)
  nextAcceptance.testedCommit = testedCommit
  nextAcceptance.platforms[platform] = nextResult
  if (sameJson(context.acceptance, nextAcceptance)) {
    return { path: context.acceptancePath, platform, status: "unchanged" }
  }
  assert(
    context.acceptance.releaseStatus !== "approved",
    "An approved acceptance record is immutable",
  )
  assert(
    currentResult.status === "pending",
    `${platform} already passed with different evidence and cannot be overwritten`,
  )

  validateAcceptance(nextAcceptance, context.version, context.acceptancePath)
  await writeAcceptance(context, nextAcceptance)
  return { path: context.acceptancePath, platform, status: "changed" }
}

export async function recordLiveAcceptance({
  assertions,
  check,
  evidenceUrl,
  repositoryRoot,
  testedAt,
  testedCommit,
}) {
  const context = await readAcceptanceContext(repositoryRoot)
  assert(
    Object.hasOwn(LIVE_ACCEPTANCE_ASSERTIONS, check),
    "Unknown live acceptance check; use status to list the fixed checks",
  )
  assertTestedCommit(testedCommit)
  assert(
    context.acceptance.testedCommit === "TBD"
      || context.acceptance.testedCommit === testedCommit,
    "testedCommit does not match the release candidate already bound to this record",
  )
  const expectedAssertions = LIVE_ACCEPTANCE_ASSERTIONS[check]
  assertExplicitAssertions(assertions, expectedAssertions, check)

  const nextResult = {
    status: "passed",
    testedAt,
    evidenceUrl,
    assertions: Object.fromEntries(expectedAssertions.map((name) => [name, true])),
  }
  const currentResult = context.acceptance.liveAcceptance[check]
  const nextAcceptance = structuredClone(context.acceptance)
  nextAcceptance.testedCommit = testedCommit
  nextAcceptance.liveAcceptance[check] = nextResult
  if (sameJson(context.acceptance, nextAcceptance)) {
    return { check, path: context.acceptancePath, status: "unchanged" }
  }
  assert(
    currentResult.status === "pending",
    `${check} already passed with different evidence and cannot be overwritten`,
  )

  validateAcceptance(nextAcceptance, context.version, context.acceptancePath)
  await writeAcceptance(context, nextAcceptance)
  return { check, path: context.acceptancePath, status: "changed" }
}

export async function approveReleaseAcceptance({
  approvedAt,
  approvedBy,
  evidenceUrl,
  repositoryRoot,
  testedCommit,
}) {
  const context = await readAcceptanceContext(repositoryRoot)
  assertTestedCommit(testedCommit)
  assert(
    context.acceptance.testedCommit === testedCommit,
    "testedCommit does not match the release candidate already bound to this record",
  )
  assertPublicMaintainerIdentity(approvedBy)
  const nextAcceptance = {
    ...structuredClone(context.acceptance),
    releaseStatus: "approved",
    approvedBy,
    approvedAt,
    approvalEvidenceUrl: evidenceUrl,
  }
  validatePublicationAcceptance(nextAcceptance, context.version, context.acceptancePath)

  if (sameJson(context.acceptance, nextAcceptance)) {
    return { path: context.acceptancePath, status: "unchanged" }
  }
  assert(
    context.acceptance.releaseStatus !== "approved",
    "An approved acceptance record is immutable",
  )

  await writeAcceptance(context, nextAcceptance)
  return { path: context.acceptancePath, status: "changed" }
}

function summarizeEntries(entries) {
  const passed = entries.filter(([, result]) => result.status === "passed").map(([name]) => name)
  const pending = entries.filter(([, result]) => result.status === "pending").map(([name]) => name)
  return { passed, pending, total: entries.length }
}

function assertExplicitAssertions(assertions, expectedAssertions, check) {
  assert(Array.isArray(assertions), `${check} assertions must be an array`)
  assert(
    assertions.every((name) => typeof name === "string" && name.length > 0),
    `${check} assertions must be non-empty names`,
  )
  const unique = new Set(assertions)
  assert(unique.size === assertions.length, `${check} contains a duplicate assertion`)
  const actual = [...unique].sort()
  const expected = [...expectedAssertions].sort()
  assert(
    sameJson(actual, expected),
    `${check} must explicitly confirm exactly: ${expected.join(", ")}`,
  )
}

function assertPublicMaintainerIdentity(value) {
  assert(typeof value === "string" && value.trim() === value && value.length > 0, "approvedBy is required")
  assert(value.length <= 128, "approvedBy must be at most 128 characters")
  assert(!/[\u0000-\u001f\u007f]/u.test(value), "approvedBy must be a single printable line")
  assert(!PLACEHOLDER_PATTERN.test(value), "approvedBy must identify the approving maintainer")
}

function assertTestedCommit(value, label = "testedCommit") {
  assert(
    typeof value === "string" && /^[0-9a-f]{40}$/u.test(value),
    `${label} must be a full lowercase Git commit`,
  )
}

async function readAcceptanceContext(repositoryRoot) {
  assert(
    typeof repositoryRoot === "string" && repositoryRoot.length > 0,
    "repositoryRoot is required",
  )
  const root = resolve(repositoryRoot)
  const packageFile = await inspectReleaseFile(root, PACKAGE_PATH, { required: true })
  const packageJson = parseReleaseJson(packageFile.content, PACKAGE_PATH)
  assert(
    packageJson !== null && typeof packageJson === "object" && !Array.isArray(packageJson),
    `${PACKAGE_PATH} must contain a JSON object`,
  )
  assert(packageJson.name === PACKAGE_NAME, `${PACKAGE_PATH} name must be ${PACKAGE_NAME}`)

  let version
  try {
    version = assertReleaseVersion(packageJson.version)
  } catch (error) {
    throw new ReleaseFileError(`${PACKAGE_PATH}: ${error.message}`)
  }
  const { acceptance: acceptancePath } = releaseDocumentPaths(version)
  const acceptanceFile = await inspectReleaseFile(root, acceptancePath, { required: true })
  const acceptance = parseReleaseJson(acceptanceFile.content, acceptancePath)
  validateAcceptance(acceptance, version, acceptancePath)
  return { acceptance, acceptanceFile, acceptancePath, version }
}

function validateAcceptance(acceptance, version, path, options) {
  try {
    assertAcceptanceRecord(acceptance, { version, ...options })
  } catch (error) {
    throw new ReleaseFileError(`${path}: ${error.message}`)
  }
}

function validatePublicationAcceptance(acceptance, version, path) {
  try {
    assertPublicationAcceptanceRecord(acceptance, { version })
  } catch (error) {
    throw new ReleaseFileError(`${path}: ${error.message}`)
  }
}

async function writeAcceptance(context, acceptance) {
  const content = `${JSON.stringify(acceptance, null, 2)}\n`
  await writeReleaseFileAtomically(context.acceptanceFile, content, {
    operation: "release-acceptance",
  })
}

function sameJson(left, right) {
  return isDeepStrictEqual(left, right)
}

function parseOptions(arguments_, { allowed, repeatable = new Set() }) {
  const values = new Map()
  for (const argument of arguments_) {
    const match = /^--([a-z][a-z-]*)=(.+)$/u.exec(argument)
    assert(match !== null, "Options must use the --name=value form")
    const [, name, value] = match
    assert(allowed.has(name), `Unknown option --${name}`)
    if (repeatable.has(name)) {
      const current = values.get(name) ?? []
      current.push(value)
      values.set(name, current)
      continue
    }
    assert(!values.has(name), `Option --${name} may be provided only once`)
    values.set(name, value)
  }
  return values
}

function requireOption(options, name) {
  const value = options.get(name)
  assert(typeof value === "string" && value.length > 0, `Option --${name} is required`)
  return value
}

function renderStatus(status) {
  const lines = [
    `Release v${status.version} acceptance: ${status.releaseStatus}`,
    `Platforms: ${status.platforms.passed.length}/${status.platforms.total} passed`,
    `Live checks: ${status.live.passed.length}/${status.live.total} passed`,
  ]
  if (status.platforms.pending.length > 0) {
    lines.push(`Pending platforms: ${status.platforms.pending.join(", ")}`)
  }
  if (status.live.pending.length > 0) {
    lines.push(`Pending live checks: ${status.live.pending.join(", ")}`)
  }
  return lines.join("\n")
}

export async function runReleaseAcceptance({ arguments: rawArguments, repositoryRoot }) {
  assert(Array.isArray(rawArguments), "arguments must be an array")
  const arguments_ = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments
  const command = arguments_[0]

  if (command === "status") {
    assert(arguments_.length === 1, "Usage: pnpm run release:acceptance -- status")
    return {
      changedPaths: [],
      output: renderStatus(await acceptanceStatus({ repositoryRoot })),
      status: "unchanged",
    }
  }

  if (command === "pass-platform") {
    assert(
      typeof arguments_[1] === "string" && !arguments_[1].startsWith("-"),
      "Usage: pnpm run release:acceptance -- pass-platform <platform> --tested-commit=<40hex> --tested-at=<RFC3339> --runner=<name> --node-version=<version> --dsh-version=<version> --profile-smoke=passed --evidence-url=<HTTPS>",
    )
    const options = parseOptions(arguments_.slice(2), {
      allowed: new Set([
        "dsh-version",
        "evidence-url",
        "node-version",
        "profile-smoke",
        "runner",
        "tested-at",
        "tested-commit",
      ]),
    })
    const result = await recordPlatformAcceptance({
      dshVersion: requireOption(options, "dsh-version"),
      evidenceUrl: requireOption(options, "evidence-url"),
      nodeVersion: requireOption(options, "node-version"),
      platform: arguments_[1],
      profileSmoke: requireOption(options, "profile-smoke"),
      repositoryRoot,
      runner: requireOption(options, "runner"),
      testedAt: requireOption(options, "tested-at"),
      testedCommit: requireOption(options, "tested-commit"),
    })
    return {
      changedPaths: result.status === "changed" ? [result.path] : [],
      output: result.status === "changed"
        ? `Recorded ${result.platform} platform smoke as passed.`
        : `${result.platform} platform already has identical passed evidence.`,
      status: result.status,
    }
  }

  if (command === "reset-candidate") {
    const options = parseOptions(arguments_.slice(1), {
      allowed: new Set(["from-commit", "to-commit"]),
    })
    const result = await resetAcceptanceCandidate({
      fromCommit: requireOption(options, "from-commit"),
      repositoryRoot,
      toCommit: requireOption(options, "to-commit"),
    })
    return {
      changedPaths: result.status === "changed" ? [result.path] : [],
      output: result.status === "changed"
        ? "Reset release acceptance for the new candidate."
        : "Release acceptance is already a fresh draft for this candidate.",
      status: result.status,
    }
  }

  if (command === "pass") {
    assert(
      typeof arguments_[1] === "string" && !arguments_[1].startsWith("-"),
      "Usage: pnpm run release:acceptance -- pass <check> --tested-commit=<40hex> --tested-at=<RFC3339> --evidence-url=<HTTPS> --assert=<name> ...",
    )
    const options = parseOptions(arguments_.slice(2), {
      allowed: new Set(["assert", "evidence-url", "tested-at", "tested-commit"]),
      repeatable: new Set(["assert"]),
    })
    const result = await recordLiveAcceptance({
      assertions: options.get("assert") ?? [],
      check: arguments_[1],
      evidenceUrl: requireOption(options, "evidence-url"),
      repositoryRoot,
      testedAt: requireOption(options, "tested-at"),
      testedCommit: requireOption(options, "tested-commit"),
    })
    return {
      changedPaths: result.status === "changed" ? [result.path] : [],
      output: result.status === "changed"
        ? `Recorded ${result.check} as passed.`
        : `${result.check} already has identical passed evidence.`,
      status: result.status,
    }
  }

  if (command === "approve") {
    const options = parseOptions(arguments_.slice(1), {
      allowed: new Set(["approved-at", "approved-by", "evidence-url", "tested-commit"]),
    })
    const result = await approveReleaseAcceptance({
      approvedAt: requireOption(options, "approved-at"),
      approvedBy: requireOption(options, "approved-by"),
      evidenceUrl: requireOption(options, "evidence-url"),
      repositoryRoot,
      testedCommit: requireOption(options, "tested-commit"),
    })
    return {
      changedPaths: result.status === "changed" ? [result.path] : [],
      output: result.status === "changed"
        ? "Approved the release acceptance record."
        : "The release acceptance record already has identical approval.",
      status: result.status,
    }
  }

  throw new ReleaseFileError(
    "Usage: pnpm run release:acceptance -- <status|reset-candidate|pass-platform|pass|approve>",
  )
}

async function runCli() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const result = await runReleaseAcceptance({
    arguments: process.argv.slice(2),
    repositoryRoot,
  })
  console.log(result.output)
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = error?.exitCode ?? 1
  })
}
