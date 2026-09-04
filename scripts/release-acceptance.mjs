const PLATFORM_NAMES = Object.freeze(["linux", "macos", "windows"])
const SUPPORTED_DSH_VERSION = "0.1.2-rc.1"
const SUPPORTED_NODE_MAJORS = new Set([22, 24])
const MINIMUM_NODE_22 = Object.freeze([22, 19, 0])
const PLACEHOLDER_PATTERN = /\b(?:TBD|TODO|PENDING|DRAFT|UNRELEASED)\b|待补|未发布|草稿/iu

export const LIVE_ACCEPTANCE_ASSERTIONS = Object.freeze({
  oauthWebSignIn: Object.freeze([
    "flowStartedFromSettings",
    "credentialConfigured",
    "postSignInRequestSucceeded",
  ]),
  modelCatalog: Object.freeze([
    "settingsCatalogVisible",
    "conversationModelSelectable",
  ]),
  textStream: Object.freeze([
    "nonEmptyTextDelta",
    "terminalStopObserved",
  ]),
  reasoningStream: Object.freeze([
    "reasoningBlockObserved",
    "terminalStopObserved",
  ]),
  terminalUsage: Object.freeze([
    "inputTokensObserved",
    "outputTokensObserved",
  ]),
  toolRoundTrip: Object.freeze([
    "toolCallObserved",
    "toolExecuted",
    "toolResultReturned",
    "followUpSucceeded",
  ]),
  replayContinuity: Object.freeze([
    "firstTurnSucceeded",
    "secondTurnUsedPriorContext",
    "secondTurnSucceeded",
  ]),
  imageMaxPixels: Object.freeze([
    "nativeImageAccepted",
    "maxPixels4194304Projected",
    "requestSucceeded",
  ]),
  transportAuto: Object.freeze(["requestSucceeded"]),
  transportSse: Object.freeze(["requestSucceeded"]),
  transportWebsocket: Object.freeze(["requestSucceeded"]),
  transportWebsocketCached: Object.freeze([
    "firstTurnSucceeded",
    "secondTurnSucceeded",
  ]),
  fastPriority: Object.freeze([
    "priorityRequested",
    "requestSucceeded",
    "noAutomaticDowngrade",
  ]),
})

export function createDraftAcceptanceRecord(version) {
  const record = {
    schemaVersion: 3,
    version,
    releaseStatus: "draft",
    testedCommit: "TBD",
    approvedBy: "TBD",
    approvedAt: "TBD",
    approvalEvidenceUrl: "TBD",
    platforms: Object.fromEntries(PLATFORM_NAMES.map((platform) => [platform, {
      status: "pending",
      testedAt: "TBD",
      runner: "TBD",
      nodeVersion: "TBD",
      dshVersion: SUPPORTED_DSH_VERSION,
      profileSmoke: "pending",
      evidenceUrl: "TBD",
    }])),
    liveAcceptance: Object.fromEntries(Object.entries(LIVE_ACCEPTANCE_ASSERTIONS)
      .map(([check, assertionNames]) => [check, {
        status: "pending",
        testedAt: "TBD",
        evidenceUrl: "TBD",
        assertions: Object.fromEntries(assertionNames.map((assertionName) => [assertionName, false])),
      }])),
  }
  assertAcceptanceRecord(record, { version })
  return record
}

const ROOT_KEYS = Object.freeze([
  "approvalEvidenceUrl",
  "approvedAt",
  "approvedBy",
  "liveAcceptance",
  "platforms",
  "releaseStatus",
  "schemaVersion",
  "testedCommit",
  "version",
])

const PLATFORM_KEYS = Object.freeze([
  "dshVersion",
  "evidenceUrl",
  "nodeVersion",
  "profileSmoke",
  "runner",
  "status",
  "testedAt",
])

const LIVE_CHECK_KEYS = Object.freeze([
  "assertions",
  "evidenceUrl",
  "status",
  "testedAt",
])

export function assertAcceptanceRecord(acceptance, {
  version,
  requirePassed = false,
  requirePublicationApproval = false,
} = {}) {
  assertObject(acceptance, "Acceptance record")
  assertExactKeys(acceptance, ROOT_KEYS, "Acceptance record")
  assert(acceptance.schemaVersion === 3, "Acceptance record schemaVersion must be 3")
  assert(acceptance.version === version, `Acceptance record version must be ${version}`)
  assert(
    new Set(["draft", "approved"]).has(acceptance.releaseStatus),
    "Acceptance releaseStatus must be draft or approved",
  )
  const requireApproval = requirePublicationApproval
    || requirePassed
    || acceptance.releaseStatus === "approved"

  assertObject(acceptance.platforms, "Acceptance platforms")
  assertExactKeys(acceptance.platforms, PLATFORM_NAMES, "Acceptance platforms")
  for (const platform of PLATFORM_NAMES) {
    assertPlatformResult(acceptance.platforms[platform], platform, requireApproval)
  }

  assertObject(acceptance.liveAcceptance, "Acceptance liveAcceptance")
  const liveChecks = Object.keys(LIVE_ACCEPTANCE_ASSERTIONS)
  assertExactKeys(acceptance.liveAcceptance, liveChecks, "Acceptance liveAcceptance")
  for (const check of liveChecks) {
    assertLiveResult(
      acceptance.liveAcceptance[check],
      check,
      LIVE_ACCEPTANCE_ASSERTIONS[check],
      requirePassed,
    )
  }

  if (requireApproval) {
    assert(acceptance.releaseStatus === "approved", "Acceptance releaseStatus must be approved")
    assertFullCommit(acceptance.testedCommit, "Acceptance testedCommit")
    assertEvidenceLabel(acceptance.approvedBy, "Acceptance approvedBy")
    assertIsoTimestamp(acceptance.approvedAt, "Acceptance approvedAt")
    assertEvidenceUrl(acceptance.approvalEvidenceUrl, "Acceptance approvalEvidenceUrl")
    const latestEvidenceTime = Math.max(
      ...Object.values(acceptance.platforms).map(({ testedAt }) => Date.parse(testedAt)),
    )
    assert(
      Date.parse(acceptance.approvedAt) >= latestEvidenceTime,
      "Acceptance approvedAt must not precede the latest accepted evidence",
    )
  } else {
    for (const [field, value] of [
      ["testedCommit", acceptance.testedCommit],
      ["approvedBy", acceptance.approvedBy],
      ["approvedAt", acceptance.approvedAt],
      ["approvalEvidenceUrl", acceptance.approvalEvidenceUrl],
    ]) {
      assertNonEmptyString(value, `Acceptance ${field}`)
    }
  }
}

export function assertPublicationAcceptanceRecord(acceptance, { version } = {}) {
  assertAcceptanceRecord(acceptance, { version, requirePublicationApproval: true })
}

function assertPlatformResult(result, platform, requirePassed) {
  assertObject(result, `Acceptance platforms.${platform}`)
  assertExactKeys(result, PLATFORM_KEYS, `Acceptance platforms.${platform}`)
  assert(new Set(["pending", "passed"]).has(result.status), `${platform} status must be pending or passed`)
  assert(
    new Set(["pending", "passed"]).has(result.profileSmoke),
    `${platform} profileSmoke must be pending or passed`,
  )
  assert(
    result.status === result.profileSmoke,
    `${platform} status and profileSmoke must describe the same result`,
  )
  for (const field of ["testedAt", "runner", "nodeVersion", "dshVersion", "evidenceUrl"]) {
    assertNonEmptyString(result[field], `${platform}.${field}`)
  }
  if (result.status === "passed" || requirePassed) {
    assert(result.status === "passed", `${platform} acceptance must pass before publication`)
    assertIsoTimestamp(result.testedAt, `${platform}.testedAt`)
    assertEvidenceLabel(result.runner, `${platform}.runner`)
    assertSupportedNodeVersion(result.nodeVersion, `${platform}.nodeVersion`)
    assert(
      result.dshVersion === SUPPORTED_DSH_VERSION,
      `${platform}.dshVersion must be ${SUPPORTED_DSH_VERSION}`,
    )
    assertEvidenceUrl(result.evidenceUrl, `${platform}.evidenceUrl`)
  }
}

function assertSupportedNodeVersion(value, label) {
  const match = typeof value === "string" ? /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(value) : null
  assert(match !== null, `${label} must be a concrete stable Node version`)
  const version = match.slice(1).map(Number)
  assert(SUPPORTED_NODE_MAJORS.has(version[0]), `${label} must use the tested Node 22 or 24 line`)
  if (version[0] === 22) {
    assert(compareVersion(version, MINIMUM_NODE_22) >= 0, `${label} must be at least 22.19.0`)
  }
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function assertLiveResult(result, check, assertionNames, requirePassed) {
  const label = `Acceptance liveAcceptance.${check}`
  assertObject(result, label)
  assertExactKeys(result, LIVE_CHECK_KEYS, label)
  assert(new Set(["pending", "passed"]).has(result.status), `${check} status must be pending or passed`)
  assertNonEmptyString(result.testedAt, `${check}.testedAt`)
  assertNonEmptyString(result.evidenceUrl, `${check}.evidenceUrl`)
  assertObject(result.assertions, `${check}.assertions`)
  assertExactKeys(result.assertions, assertionNames, `${check}.assertions`)
  for (const assertionName of assertionNames) {
    assert(
      typeof result.assertions[assertionName] === "boolean",
      `${check}.assertions.${assertionName} must be boolean`,
    )
  }
  if (result.status === "passed" || requirePassed) {
    assert(result.status === "passed", `${check} acceptance must pass for complete live validation`)
    assertIsoTimestamp(result.testedAt, `${check}.testedAt`)
    assertEvidenceUrl(result.evidenceUrl, `${check}.evidenceUrl`)
    for (const assertionName of assertionNames) {
      assert(
        result.assertions[assertionName] === true,
        `${check}.assertions.${assertionName} must pass for complete live validation`,
      )
    }
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  assert(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} must contain exactly: ${wanted.join(", ")}`,
  )
}

function assertObject(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`)
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} is required`)
}

function assertEvidenceLabel(value, label) {
  assertNonEmptyString(value, label)
  assert(
    value.trim() === value
      && value.length <= 128
      && !/[\u0000-\u001f\u007f]/u.test(value),
    `${label} must be a bounded printable line`,
  )
  assert(!PLACEHOLDER_PATTERN.test(value), `${label} must not be a placeholder`)
}

function assertFullCommit(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/u.test(value), `${label} must be a full lowercase Git commit`)
}

function assertIsoTimestamp(value, label) {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value)
    : null
  assert(match !== null, `${label} must be a real RFC3339 timestamp`)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)
  assert(
    year >= 1
      && month >= 1
      && month <= 12
      && day >= 1
      && day <= daysInMonth(year, month)
      && hour <= 23
      && minute <= 59
      && second <= 59
      && offsetHour <= 23
      && offsetMinute <= 59
      && Number.isFinite(Date.parse(value)),
    `${label} must be a real RFC3339 timestamp`,
  )
}

function assertEvidenceUrl(value, label) {
  assert(
    typeof value === "string" && !/[?#]/u.test(value),
    `${label} must not contain credentials, query data, or fragments`,
  )
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`)
  }
  assert(url.protocol === "https:", `${label} must use HTTPS`)
  assert(
    !url.username && !url.password && !url.search && !url.hash,
    `${label} must not contain credentials, query data, or fragments`,
  )
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return new Set([4, 6, 9, 11]).has(month) ? 30 : 31
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
