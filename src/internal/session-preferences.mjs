const MAX_SESSION_ID_CHARS = 256
const DEFAULT_MAX_SESSIONS = 512
const MAX_MAX_SESSIONS = 4_096
const TRANSPORTS = new Set(["auto", "sse", "websocket", "websocket-cached"])
const PREFERENCE_KEYS = new Set(["fast", "transport"])

const SAFE_DEFAULTS = Object.freeze({ fast: false, transport: "auto" })

/**
 * Process-local, per-session request preferences.
 *
 * Callers see one immutable snapshot and never learn how entries are bounded or
 * merged. The provider may resolve with no session id for direct/diagnostic
 * calls; those always use safe defaults. Lifecycle owners remove an entry when
 * its agent is disposed.
 */
export function createSessionPreferences(options = {}) {
  const input = plainObject(options, "options")
  assertOnlyKeys(input, ["defaultFast", "defaultTransport", "maxSessions"], "option")
  const maxSessions = input.maxSessions ?? DEFAULT_MAX_SESSIONS
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_MAX_SESSIONS) {
    throw new TypeError(`maxSessions must be an integer from 1 to ${MAX_MAX_SESSIONS}`)
  }
  const defaults = snapshot({
    fast: input.defaultFast ?? SAFE_DEFAULTS.fast,
    transport: input.defaultTransport ?? SAFE_DEFAULTS.transport,
  })
  const entries = new Map()
  let disposed = false

  return Object.freeze({
    resolve(sessionId) {
      if (disposed || sessionId === undefined) return defaults
      return entries.get(validSessionId(sessionId)) ?? defaults
    },

    configure(sessionId, patch) {
      if (disposed) throw new Error("session preferences are disposed")
      const id = validSessionId(sessionId)
      const change = plainObject(patch, "preference patch")
      const keys = Object.keys(change)
      if (keys.length === 0 || keys.some((key) => !PREFERENCE_KEYS.has(key))) {
        throw new TypeError("preference patch must set only fast and/or transport")
      }
      if (!entries.has(id) && entries.size >= maxSessions) {
        throw new Error("session preference capacity reached")
      }
      const next = snapshot({ ...(entries.get(id) ?? defaults), ...change })
      entries.set(id, next)
      return next
    },

    remove(sessionId) {
      if (disposed) return false
      return entries.delete(validSessionId(sessionId))
    },

    dispose() {
      if (disposed) return
      disposed = true
      entries.clear()
    },
  })
}

function snapshot(value) {
  if (typeof value.fast !== "boolean") throw new TypeError("fast must be a boolean")
  if (!TRANSPORTS.has(value.transport)) {
    throw new TypeError("transport must be auto, sse, websocket, or websocket-cached")
  }
  return Object.freeze({ fast: value.fast, transport: value.transport })
}

function validSessionId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SESSION_ID_CHARS) {
    throw new TypeError(`session id must contain 1 to ${MAX_SESSION_ID_CHARS} characters`)
  }
  return value
}

function plainObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function assertOnlyKeys(value, allowed, label) {
  const accepted = new Set(allowed)
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new TypeError(`unknown ${label}`)
  }
}
