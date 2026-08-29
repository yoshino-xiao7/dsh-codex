import {
  clearTimeout as cancelTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers"

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024
const MAX_TIMEOUT_MS = 60_000
const MAX_CONFIGURED_RESPONSE_BYTES = 1024 * 1024
const MAX_RESET_HORIZON_MS = 366 * 24 * 60 * 60_000
const MAX_ADDITIONAL_LIMITS = 64
const MAX_BODY_CHUNKS = 4_096
const MAX_BASE_URL_LENGTH = 2_048
const MAX_ACCESS_LENGTH = 64 * 1024
const MAX_ACCOUNT_ID_LENGTH = 1_024
const MAX_LABEL_LENGTH = 128

const OPTION_FIELDS = new Set([
  "baseUrl",
  "clock",
  "fetch",
  "maxResponseBytes",
  "resolveAuth",
  "timeoutMs",
])
const READ_OPTION_FIELDS = new Set(["signal"])

export class CodexAccountUsageError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = "CodexAccountUsageError"
    this.code = code
    if (details.status !== undefined) this.status = details.status
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function plainObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be a plain object`)
  return value
}

function rejectUnknownFields(value, allowed, prefix) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string" && allowed.has(key)) continue
    throw new TypeError(`${prefix}: ${String(key)}`)
  }
}

function boundedPositiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be a positive safe integer no greater than ${String(maximum)}`)
  }
  return value
}

function readClock(clock) {
  let now
  try {
    now = clock()
  } catch {
    throw new CodexAccountUsageError("account usage clock returned an invalid timestamp", "INVALID_CLOCK")
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new CodexAccountUsageError("account usage clock returned an invalid timestamp", "INVALID_CLOCK")
  }
  return now
}

function usageUrl(rawBaseUrl) {
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.length === 0 || rawBaseUrl.length > MAX_BASE_URL_LENGTH) {
    throw new TypeError("baseUrl must be a non-empty bounded string")
  }

  let baseUrl
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch {
    throw new TypeError("baseUrl must be a valid HTTPS URL")
  }
  if (
    baseUrl.protocol !== "https:"
    || baseUrl.username !== ""
    || baseUrl.password !== ""
    || baseUrl.search !== ""
    || baseUrl.hash !== ""
  ) {
    throw new TypeError("baseUrl must be a credential-free HTTPS URL without query or fragment")
  }
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
  return new URL("wham/usage", baseUrl).href
}

function assertAbortSignal(value) {
  if (value === undefined) return
  if (!(value instanceof AbortSignal)) throw new TypeError("signal must be an AbortSignal")
}

function deadline(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const abortFromParent = () => {
    controller.abort(new CodexAccountUsageError("account usage request was aborted", "ABORTED"))
  }

  if (parentSignal?.aborted === true) abortFromParent()
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true })

  let timer
  if (!controller.signal.aborted) {
    timer = scheduleTimeout(() => {
      controller.abort(new CodexAccountUsageError("account usage request timed out", "TIMEOUT"))
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) cancelTimeout(timer)
      parentSignal?.removeEventListener("abort", abortFromParent)
    },
  }
}

function abortReason(signal) {
  if (signal.reason instanceof CodexAccountUsageError) return signal.reason
  return new CodexAccountUsageError("account usage request was aborted", "ABORTED")
}

function awaitWithSignal(value, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener("abort", onAbort, { once: true })
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener("abort", onAbort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

function safeHeaderValue(value, name, maximum, allowWhitespace) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (!allowWhitespace && /\s/u.test(value))
  ) {
    throw new CodexAccountUsageError(`account usage ${name} is unavailable`, "AUTH_UNAVAILABLE")
  }
  return value
}

async function resolveRequestAuth(resolveAuth, signal) {
  let resolved
  try {
    resolved = await awaitWithSignal(
      Promise.resolve().then(() => resolveAuth({ signal })),
      signal,
    )
  } catch (error) {
    if (signal.aborted) throw abortReason(signal)
    if (error instanceof CodexAccountUsageError) throw error
    throw new CodexAccountUsageError("account usage authentication is unavailable", "AUTH_UNAVAILABLE")
  }

  if (!isPlainObject(resolved)) {
    throw new CodexAccountUsageError("account usage authentication is unavailable", "AUTH_UNAVAILABLE")
  }
  try {
    return {
      access: safeHeaderValue(resolved.access, "access token", MAX_ACCESS_LENGTH, false),
      accountId: safeHeaderValue(resolved.accountId, "account identifier", MAX_ACCOUNT_ID_LENGTH, true),
    }
  } catch (error) {
    if (error instanceof CodexAccountUsageError) throw error
    throw new CodexAccountUsageError("account usage authentication is unavailable", "AUTH_UNAVAILABLE")
  }
}

function discardResponse(response) {
  try {
    const cancellation = response?.body?.cancel?.()
    cancellation?.catch?.(() => {})
  } catch {
    // Discard failures never replace the safe protocol error.
  }
}

function responseHeader(response, name) {
  try {
    return response?.headers?.get?.(name) ?? null
  } catch {
    throw new CodexAccountUsageError("account usage response headers are invalid", "INVALID_RESPONSE")
  }
}

function assertJsonContentType(response) {
  const raw = responseHeader(response, "content-type")
  const mediaType = raw?.split(";", 1)[0].trim().toLowerCase()
  if (
    mediaType !== "application/json"
    && !/^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType ?? "")
  ) {
    throw new CodexAccountUsageError("account usage response is not JSON", "INVALID_CONTENT_TYPE")
  }
}

function assertContentLength(response, maxResponseBytes) {
  const raw = responseHeader(response, "content-length")
  if (raw === null) return
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new CodexAccountUsageError("account usage response length is invalid", "INVALID_RESPONSE")
  }
  const length = Number(raw)
  if (!Number.isSafeInteger(length)) {
    throw new CodexAccountUsageError("account usage response length is invalid", "INVALID_RESPONSE")
  }
  if (length > maxResponseBytes) {
    throw new CodexAccountUsageError("account usage response exceeds the byte limit", "BODY_TOO_LARGE")
  }
}

async function readBoundedBody(response, maxResponseBytes, signal) {
  let reader
  try {
    reader = response?.body?.getReader?.()
  } catch {
    throw new CodexAccountUsageError("account usage response body is unavailable", "INVALID_RESPONSE")
  }
  if (reader === undefined) {
    throw new CodexAccountUsageError("account usage response body is unavailable", "INVALID_RESPONSE")
  }

  const chunks = []
  let total = 0
  let chunkCount = 0
  try {
    while (true) {
      const part = await awaitWithSignal(reader.read(), signal)
      if (part.done) break
      if (!(part.value instanceof Uint8Array)) {
        throw new CodexAccountUsageError("account usage response body is invalid", "INVALID_RESPONSE")
      }
      total += part.value.byteLength
      if (total > maxResponseBytes) {
        throw new CodexAccountUsageError("account usage response exceeds the byte limit", "BODY_TOO_LARGE")
      }
      chunkCount += 1
      if (chunkCount > MAX_BODY_CHUNKS) {
        throw new CodexAccountUsageError("account usage response body is invalid", "INVALID_RESPONSE")
      }
      chunks.push(part.value)
    }
  } catch (error) {
    try {
      const cancellation = reader.cancel()
      cancellation?.catch?.(() => {})
    } catch {
      // Cancellation failures never replace the safe body error.
    }
    if (signal.aborted) throw abortReason(signal)
    if (error instanceof CodexAccountUsageError) throw error
    throw new CodexAccountUsageError("account usage response body is invalid", "INVALID_RESPONSE")
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function readJson(response, maxResponseBytes, signal) {
  assertJsonContentType(response)
  assertContentLength(response, maxResponseBytes)
  const body = await readBoundedBody(response, maxResponseBytes, signal)
  if (body.byteLength === 0) {
    throw new CodexAccountUsageError("account usage response body is invalid", "INVALID_RESPONSE")
  }

  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    throw new CodexAccountUsageError("account usage response body is invalid", "INVALID_RESPONSE")
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new CodexAccountUsageError("account usage response body is invalid", "INVALID_RESPONSE")
  }
}

function safeShortString(value, name, { nullable = false } = {}) {
  if (nullable && (value === undefined || value === null)) return null
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_LABEL_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CodexAccountUsageError(`account usage ${name} is invalid`, "INVALID_RESPONSE")
  }
  return value
}

function optionalConsistentField(envelope, bucket, field) {
  const outer = envelope[field]
  const inner = bucket[field]
  if (outer !== undefined && inner !== undefined && outer !== inner) {
    throw new CodexAccountUsageError("account usage limit identity is inconsistent", "INVALID_RESPONSE")
  }
  return outer ?? inner
}

function normalizeWindow(raw, observedAt) {
  if (raw === undefined || raw === null) return undefined
  if (!isPlainObject(raw)) {
    throw new CodexAccountUsageError("account usage quota window is invalid", "INVALID_RESPONSE")
  }

  const usedPercent = raw.used_percent
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    throw new CodexAccountUsageError("account usage percentage is invalid", "INVALID_RESPONSE")
  }

  const seconds = raw.limit_window_seconds
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds % 60 !== 0) {
    throw new CodexAccountUsageError("account usage window duration is invalid", "INVALID_RESPONSE")
  }

  const resetSeconds = raw.reset_at
  if (
    !Number.isSafeInteger(resetSeconds)
    || resetSeconds < 0
    || resetSeconds > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  ) {
    throw new CodexAccountUsageError("account usage reset timestamp is invalid", "INVALID_RESPONSE")
  }
  const resetsAt = resetSeconds * 1_000
  if (resetsAt <= observedAt || resetsAt - observedAt > MAX_RESET_HORIZON_MS) {
    throw new CodexAccountUsageError("account usage reset timestamp is implausible", "INVALID_RESPONSE")
  }

  return Object.freeze({
    usedPercent,
    windowDurationMins: seconds / 60,
    resetsAt,
  })
}

function normalizeLimit(envelope, bucket, observedAt, fallbackId) {
  if (!isPlainObject(envelope) || !isPlainObject(bucket)) {
    throw new CodexAccountUsageError("account usage rate limit is invalid", "INVALID_RESPONSE")
  }
  const explicitId = optionalConsistentField(envelope, bucket, "limit_id")
  const explicitName = optionalConsistentField(envelope, bucket, "limit_name")
  const limitName = safeShortString(explicitName, "limit name", { nullable: true })
  const limitId = safeShortString(explicitId ?? fallbackId ?? limitName, "limit identifier")
  const primary = normalizeWindow(bucket.primary_window, observedAt)
  const secondary = normalizeWindow(bucket.secondary_window, observedAt)

  const result = {
    limitId,
    limitName,
  }
  if (primary !== undefined) result.primary = primary
  if (secondary !== undefined) result.secondary = secondary
  return Object.freeze(result)
}

function normalizePayload(payload, observedAt) {
  if (!isPlainObject(payload) || !isPlainObject(payload.rate_limit)) {
    throw new CodexAccountUsageError("account usage response shape is invalid", "INVALID_RESPONSE")
  }

  const main = normalizeLimit(payload, payload.rate_limit, observedAt, "codex")
  const limits = [main]
  const seen = new Set([main.limitId])
  const additional = payload.additional_rate_limits ?? []
  if (!Array.isArray(additional) || additional.length > MAX_ADDITIONAL_LIMITS) {
    throw new CodexAccountUsageError("account usage additional limits are invalid", "INVALID_RESPONSE")
  }
  for (const entry of additional) {
    if (!isPlainObject(entry) || !isPlainObject(entry.rate_limit)) {
      throw new CodexAccountUsageError("account usage additional limit is invalid", "INVALID_RESPONSE")
    }
    const limit = normalizeLimit(entry, entry.rate_limit, observedAt)
    if (seen.has(limit.limitId)) {
      throw new CodexAccountUsageError("account usage limit identifier is duplicated", "INVALID_RESPONSE")
    }
    seen.add(limit.limitId)
    limits.push(limit)
  }

  const result = {
    observedAt,
    rateLimits: Object.freeze(limits),
  }
  if (payload.plan_type !== undefined && payload.plan_type !== null) {
    result.planType = safeShortString(payload.plan_type, "plan type")
  }
  return Object.freeze(result)
}

function responseMetadata(response) {
  try {
    return {
      redirected: response?.redirected === true,
      status: response?.status,
    }
  } catch {
    throw new CodexAccountUsageError("account usage response metadata is invalid", "INVALID_RESPONSE")
  }
}

/**
 * Build a host-side reader for the authenticated Codex account usage endpoint.
 * `resolveAuth` owns pi-ai-compatible refresh/serialization and must return the
 * resulting OAuth credential as `{ access, accountId }`.
 */
export function createCodexAccountUsageReader(options) {
  const input = plainObject(options, "account usage reader options")
  rejectUnknownFields(input, OPTION_FIELDS, "unknown account usage reader option")

  const endpoint = usageUrl(input.baseUrl)
  const resolveAuth = input.resolveAuth
  const fetchImpl = input.fetch ?? globalThis.fetch
  const clock = input.clock ?? Date.now
  if (typeof resolveAuth !== "function") throw new TypeError("resolveAuth must be a function")
  if (typeof fetchImpl !== "function") throw new TypeError("fetch must be a function")
  if (typeof clock !== "function") throw new TypeError("clock must be a function")
  const timeoutMs = boundedPositiveInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", MAX_TIMEOUT_MS)
  const maxResponseBytes = boundedPositiveInteger(
    input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
    MAX_CONFIGURED_RESPONSE_BYTES,
  )

  async function read(readOptions = {}) {
    const request = plainObject(readOptions, "account usage read options")
    rejectUnknownFields(request, READ_OPTION_FIELDS, "unknown account usage read option")
    assertAbortSignal(request.signal)
    const active = deadline(request.signal, timeoutMs)

    try {
      if (active.signal.aborted) throw abortReason(active.signal)
      const auth = await resolveRequestAuth(resolveAuth, active.signal)

      let response
      try {
        response = await awaitWithSignal(fetchImpl(endpoint, {
          method: "GET",
          redirect: "error",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${auth.access}`,
            "ChatGPT-Account-Id": auth.accountId,
          },
          signal: active.signal,
        }), active.signal)
      } catch (error) {
        if (active.signal.aborted) throw abortReason(active.signal)
        if (error instanceof CodexAccountUsageError) throw error
        throw new CodexAccountUsageError("account usage network request failed", "NETWORK")
      }

      const metadata = responseMetadata(response)
      const status = metadata.status
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        discardResponse(response)
        throw new CodexAccountUsageError("account usage response status is invalid", "INVALID_RESPONSE")
      }
      if (metadata.redirected || (status >= 300 && status < 400)) {
        discardResponse(response)
        throw new CodexAccountUsageError("account usage response redirected", "REDIRECT")
      }
      if (status < 200 || status >= 300) {
        discardResponse(response)
        throw new CodexAccountUsageError("account usage request returned an HTTP error", "HTTP_STATUS", { status })
      }

      const payload = await readJson(response, maxResponseBytes, active.signal)
      const observedAt = readClock(clock)
      return normalizePayload(payload, observedAt)
    } finally {
      active.dispose()
    }
  }

  return Object.freeze({ read })
}
