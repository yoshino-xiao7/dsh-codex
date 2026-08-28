const PLATFORM_NAMES = Object.freeze(["linux", "macos", "windows"])
const SUPPORTED_DSH_VERSION = "0.1.1-rc.2"
const SUPPORTED_NODE_MAJORS = new Set([22, 24])
const MINIMUM_NODE_22 = Object.freeze([22, 19, 0])

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

export function assertAcceptanceRecord(acceptance, { version, requirePassed = false } = {}) {
  assertObject(acceptance, "Acceptance record")
  assertExactKeys(acceptance, ROOT_KEYS, "Acceptance record")
  assert(acceptance.schemaVersion === 3, "Acceptance record schemaVersion must be 3")
  assert(acceptance.version === version, `Acceptance record version must be ${version}`)
  assert(
    new Set(["draft", "approved"]).has(acceptance.releaseStatus),
    "Acceptance releaseStatus must be draft or approved",
  )

  assertObject(acceptance.platforms, "Acceptance platforms")
  assertExactKeys(acceptance.platforms, PLATFORM_NAMES, "Acceptance platforms")
  for (const platform of PLATFORM_NAMES) {
    assertPlatformResult(acceptance.platforms[platform], platform, requirePassed)
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

  if (acceptance.releaseStatus === "approved" || requirePassed) {
    assert(acceptance.releaseStatus === "approved", "Acceptance releaseStatus must be approved")
    assertFullCommit(acceptance.testedCommit, "Acceptance testedCommit")
    assertNonEmptyString(acceptance.approvedBy, "Acceptance approvedBy")
    assertIsoTimestamp(acceptance.approvedAt, "Acceptance approvedAt")
    assertEvidenceUrl(acceptance.approvalEvidenceUrl, "Acceptance approvalEvidenceUrl")
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
    assert(result.status === "passed", `${check} acceptance must pass before publication`)
    assertIsoTimestamp(result.testedAt, `${check}.testedAt`)
    assertEvidenceUrl(result.evidenceUrl, `${check}.evidenceUrl`)
    for (const assertionName of assertionNames) {
      assert(
        result.assertions[assertionName] === true,
        `${check}.assertions.${assertionName} must pass before publication`,
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

function assertFullCommit(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/u.test(value), `${label} must be a full lowercase Git commit`)
}

function assertIsoTimestamp(value, label) {
  assert(
    typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
      && Number.isFinite(Date.parse(value)),
    `${label} must be an ISO timestamp`,
  )
}

function assertEvidenceUrl(value, label) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
