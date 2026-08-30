import { supportsCodexFast } from "./codex-model-capabilities.mjs"

// Connection channels are one path segment; endpoints are appended by RPC.
export const SESSION_PREFERENCE_RPC_CHANNEL = "/dsh-codex-session"

const MAX_SESSION_ID_CHARS = 256
const MAX_MODEL_ID_CHARS = 256
const TRANSPORTS = new Set(["auto", "sse", "websocket", "websocket-cached"])

class RpcInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "RpcInputError"
  }
}

/**
 * Narrow browser bridge for the existing process-local session preferences.
 * The client can read or change only the public Fast and transport controls
 * for one explicitly named session; store internals remain host-only.
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
    assertOnlyKeys(input, ["sessionId", "modelId"])
    const sessionId = requiredSessionId(input)
    const modelId = optionalModelId(input)
    const result = {
      ...publicPreferenceSnapshot(this.#preferences.resolve(sessionId)),
      ...(modelId === undefined ? {} : { fastSupported: supportsCodexFast(modelId) }),
    }
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
    const result = publicPreferenceSnapshot(this.#preferences.configure(sessionId, { fast: input.fast }))
    throwIfCancelled(signal)
    return result
  }

  setTransport(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, ["sessionId", "transport"])
    const sessionId = requiredSessionId(input)
    if (!Object.hasOwn(input, "transport") || !TRANSPORTS.has(input.transport)) {
      throw new RpcInputError("transport must be auto, sse, websocket, or websocket-cached")
    }
    const result = publicPreferenceSnapshot(this.#preferences.configure(sessionId, {
      transport: input.transport,
    }))
    throwIfCancelled(signal)
    return result
  }

  dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case "get": return this.get(payload, signal)
      case "set-fast": return this.setFast(payload, signal)
      case "set-transport": return this.setTransport(payload, signal)
      default: throw new RpcInputError("Unknown session preference RPC endpoint")
    }
  }
}

/** Register the session-only request controls on a dedicated loopback channel. */
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

function publicPreferenceSnapshot(value) {
  if (
    value === null
    || typeof value !== "object"
    || typeof value.fast !== "boolean"
    || !TRANSPORTS.has(value.transport)
  ) {
    throw new TypeError("session preference store returned an invalid snapshot")
  }
  return { fast: value.fast, transport: value.transport }
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

function optionalModelId(value) {
  const modelId = value.modelId
  if (modelId === undefined) return undefined
  if (
    typeof modelId !== "string"
    || modelId.length < 1
    || modelId.length > MAX_MODEL_ID_CHARS
  ) {
    throw new RpcInputError(`modelId must contain 1 to ${MAX_MODEL_ID_CHARS} characters`)
  }
  return modelId
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
