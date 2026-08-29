// Connection channels are one path segment; endpoints are appended by RPC.
export const SESSION_PREFERENCE_RPC_CHANNEL = "/dsh-codex-session"

const MAX_SESSION_ID_CHARS = 256

class RpcInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "RpcInputError"
  }
}

/**
 * Narrow browser bridge for the existing process-local session preferences.
 * Transport choices and all store internals remain host-only; the client can
 * read or change only Fast for one explicitly named session.
 */
export class CodexSessionPreferenceBridge {
  #preferences

  constructor(sessionPreferences) {
    if (
      sessionPreferences === null
      || typeof sessionPreferences !== "object"
      || typeof sessionPreferences.resolve !== "function"
      || typeof sessionPreferences.configure !== "function"
    ) {
      throw new TypeError("sessionPreferences must provide resolve and configure")
    }
    this.#preferences = sessionPreferences
  }

  get(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, ["sessionId"])
    const sessionId = requiredSessionId(input)
    const result = publicFastSnapshot(this.#preferences.resolve(sessionId))
    throwIfCancelled(signal)
    return result
  }

  setFast(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, ["sessionId", "fast"])
    const sessionId = requiredSessionId(input)
    if (!Object.hasOwn(input, "fast") || typeof input.fast !== "boolean") {
      throw new RpcInputError("fast must be a boolean")
    }
    const result = publicFastSnapshot(this.#preferences.configure(sessionId, { fast: input.fast }))
    throwIfCancelled(signal)
    return result
  }

  dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case "get": return this.get(payload, signal)
      case "set-fast": return this.setFast(payload, signal)
      default: throw new RpcInputError("Unknown session preference RPC endpoint")
    }
  }
}

/** Register the session-only Fast surface on a dedicated loopback channel. */
export function registerSessionPreferenceRpc(ctx, sessionPreferences) {
  const bridge = new CodexSessionPreferenceBridge(sessionPreferences)
  ctx.connection.rpc.handle(
    SESSION_PREFERENCE_RPC_CHANNEL,
    createSessionPreferenceRpcHandler(bridge),
    { authority: "loopback" },
  )
  return bridge
}

/** Convert bridge failures into the bounded browser RPC result envelope. */
export function createSessionPreferenceRpcHandler(bridge) {
  if (bridge === null || typeof bridge !== "object" || typeof bridge.dispatch !== "function") {
    throw new TypeError("bridge must provide dispatch")
  }
  return async (endpoint, payload, signal) => {
    if (signal?.aborted === true) return cancelledResult()
    try {
      const value = await bridge.dispatch(endpoint, payload, signal)
      if (signal?.aborted === true) return cancelledResult()
      return { ok: true, value }
    } catch (error) {
      if (signal?.aborted === true) return cancelledResult()
      if (error instanceof RpcInputError) {
        return {
          ok: false,
          error: { code: "bad-request", message: error.message, details: { issues: [] } },
        }
      }
      return {
        ok: false,
        error: { code: "internal", message: "Session preference request failed", details: {} },
      }
    }
  }
}

function publicFastSnapshot(value) {
  if (value === null || typeof value !== "object" || typeof value.fast !== "boolean") {
    throw new TypeError("session preference store returned an invalid snapshot")
  }
  return { fast: value.fast }
}

function objectInput(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcInputError("RPC payload must be an object")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RpcInputError("RPC payload must be a plain object")
  }
  return value
}

function assertOnlyKeys(value, allowed) {
  const accepted = new Set(allowed)
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new RpcInputError("RPC payload contains an unknown field")
  }
}

function requiredSessionId(value) {
  const sessionId = value.sessionId
  if (
    !Object.hasOwn(value, "sessionId")
    || typeof sessionId !== "string"
    || sessionId.length < 1
    || sessionId.length > MAX_SESSION_ID_CHARS
  ) {
    throw new RpcInputError(`sessionId must contain 1 to ${MAX_SESSION_ID_CHARS} characters`)
  }
  return sessionId
}

function throwIfCancelled(signal) {
  if (signal?.aborted === true) throw new Error("request cancelled")
}

function cancelledResult() {
  return {
    ok: false,
    error: { code: "cancelled", message: "Request cancelled", details: {} },
  }
}
