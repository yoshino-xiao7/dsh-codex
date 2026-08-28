const DEFAULT_STALE_MS = 5 * 60_000
const DEFAULT_MAX_RESET_HORIZON_MS = 8 * 24 * 60 * 60_000
const UNKNOWN_SNAPSHOT = Object.freeze({ status: "unknown" })

const OPTION_FIELDS = new Set(["clock", "staleMs", "maxResetHorizonMs"])
const QUOTA_FIELDS = new Set(["observedAt", "resetAt"])

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function plainObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be a plain object`)
  return value
}

function rejectUnknownFields(value, allowed, messagePrefix) {
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field === "string" && allowed.has(field)) continue
    throw new TypeError(`${messagePrefix}: ${String(field)}`)
  }
}

function timestamp(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function positiveDuration(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

function staleAt(now, observedAt, staleMs) {
  return now >= observedAt && now - observedAt >= staleMs
}

function frozenSnapshot(evidence) {
  if (evidence === undefined) return UNKNOWN_SNAPSHOT
  if (evidence.status === "recent-success") {
    return Object.freeze({
      status: evidence.status,
      observedAt: evidence.observedAt,
    })
  }
  if (evidence.resetAt === undefined) {
    return Object.freeze({
      status: evidence.status,
      observedAt: evidence.observedAt,
    })
  }
  return Object.freeze({
    status: evidence.status,
    observedAt: evidence.observedAt,
    resetAt: evidence.resetAt,
  })
}

/**
 * Observe only quota availability facts. Provider payloads, account data,
 * request identifiers, and error text never cross this module's interface.
 */
export function createQuotaObserver(options = {}) {
  const input = plainObject(options, "quota observer options")
  rejectUnknownFields(input, OPTION_FIELDS, "unknown quota observer option")

  const clock = input.clock === undefined ? Date.now : input.clock
  if (typeof clock !== "function") throw new TypeError("clock must be a function")
  const staleMs = positiveDuration(
    input.staleMs === undefined ? DEFAULT_STALE_MS : input.staleMs,
    "staleMs",
  )
  const maxResetHorizonMs = positiveDuration(
    input.maxResetHorizonMs === undefined ? DEFAULT_MAX_RESET_HORIZON_MS : input.maxResetHorizonMs,
    "maxResetHorizonMs",
  )

  let evidence
  let lastObservedAt = -1

  function readClock() {
    return timestamp(clock(), "clock()")
  }

  function expire(now) {
    if (evidence === undefined) return
    if (evidence.status === "recent-success") {
      if (staleAt(now, evidence.observedAt, staleMs)) evidence = undefined
      return
    }
    if (evidence.resetAt !== undefined) {
      if (now >= evidence.resetAt) evidence = undefined
      return
    }
    if (staleAt(now, evidence.observedAt, staleMs)) evidence = undefined
  }

  function snapshot() {
    expire(readClock())
    return frozenSnapshot(evidence)
  }

  function observeSuccess(now) {
    const observedAt = timestamp(now, "now")
    if (observedAt < lastObservedAt) return snapshot()

    lastObservedAt = observedAt
    evidence = { status: "recent-success", observedAt }
    return snapshot()
  }

  function observeQuota(observation) {
    const value = plainObject(observation, "quota observation")
    rejectUnknownFields(value, QUOTA_FIELDS, "unknown quota observation field")

    const observedAt = timestamp(value.observedAt, "observedAt")
    const resetAt = value.resetAt === undefined
      ? undefined
      : timestamp(value.resetAt, "resetAt")
    if (observedAt < lastObservedAt) return snapshot()

    lastObservedAt = observedAt
    if (resetAt !== undefined && resetAt <= observedAt) {
      evidence = undefined
      return snapshot()
    }

    const acceptedResetAt = resetAt !== undefined && resetAt - observedAt <= maxResetHorizonMs
      ? resetAt
      : undefined
    evidence = { status: "exhausted", observedAt, resetAt: acceptedResetAt }
    return snapshot()
  }

  return Object.freeze({ observeSuccess, observeQuota, snapshot })
}
