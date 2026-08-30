import { supportsCodexFast } from "./codex-model-capabilities.mjs"

// Connection channels are one path segment; endpoints are appended by RPC.
export const SESSION_PREFERENCE_RPC_CHANNEL = "/dsh-codex-session"

const MAX_SESSION_ID_CHARS = 256
const MAX_MODEL_ID_CHARS = 256
const TRANSPORTS = new Set(["auto", "sse", "websocket", "websocket-cached"])
const TEXT_VERBOSITIES = new Set(["low", "medium", "high"])
const REASONING_SUMMARIES = new Set(["auto", "concise", "detailed", "off"])
const TRANSPORT_HEALTH_COUNT_KEYS = Object.freeze([
  "requests",
  "connectionsCreated",
  "connectionsReused",
  "cachedContextRequests",
  "fullContextRequests",
  "deltaRequests",
  "websocketFailures",
  "sseFallbacks",
])

class RpcInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "RpcInputError"
  }
}

/**
 * Narrow browser bridge for the existing process-local session preferences.
 * The client can read or change only the public request controls for one
 * explicitly named session; store internals remain host-only.
 */
export class CodexSessionPreferenceBridge {
  #preferences
  #sessionResources

  constructor(sessionPreferences, sessionResourcesOrOptions) {
    if (
      sessionPreferences === null
      || typeof sessionPreferences !== "object"
      || typeof sessionPreferences.resolve !== "function"
      || typeof sessionPreferences.configure !== "function"
    ) {
      throw new TypeError("sessionPreferences must provide resolve and configure")
    }
    this.#preferences = sessionPreferences
    this.#sessionResources = optionalSessionResources(sessionResourcesOrOptions)
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
      ...this.#transportHealth(sessionId),
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
    const result = {
      ...publicPreferenceSnapshot(this.#preferences.configure(sessionId, { fast: input.fast })),
      ...this.#transportHealth(sessionId),
    }
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
    const snapshot = publicPreferenceSnapshot(this.#preferences.configure(sessionId, {
      transport: input.transport,
    }))
    this.#sessionResources?.reset?.(sessionId)
    const result = {
      ...snapshot,
      ...this.#transportHealth(sessionId),
    }
    throwIfCancelled(signal)
    return result
  }

  setTextVerbosity(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, ["sessionId", "textVerbosity"])
    const sessionId = requiredSessionId(input)
    if (!Object.hasOwn(input, "textVerbosity") || !TEXT_VERBOSITIES.has(input.textVerbosity)) {
      throw new RpcInputError("textVerbosity must be low, medium, or high")
    }
    const result = {
      ...publicPreferenceSnapshot(this.#preferences.configure(sessionId, {
        textVerbosity: input.textVerbosity,
      })),
      ...this.#transportHealth(sessionId),
    }
    throwIfCancelled(signal)
    return result
  }

  setReasoningSummary(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, ["sessionId", "reasoningSummary"])
    const sessionId = requiredSessionId(input)
    if (
      !Object.hasOwn(input, "reasoningSummary")
      || !REASONING_SUMMARIES.has(input.reasoningSummary)
    ) {
      throw new RpcInputError("reasoningSummary must be auto, concise, detailed, or off")
    }
    const result = {
      ...publicPreferenceSnapshot(this.#preferences.configure(sessionId, {
        reasoningSummary: input.reasoningSummary,
      })),
      ...this.#transportHealth(sessionId),
    }
    throwIfCancelled(signal)
    return result
  }

  dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case "get": return this.get(payload, signal)
      case "set-fast": return this.setFast(payload, signal)
      case "set-transport": return this.setTransport(payload, signal)
      case "set-text-verbosity": return this.setTextVerbosity(payload, signal)
      case "set-reasoning-summary": return this.setReasoningSummary(payload, signal)
      default: throw new RpcInputError("Unknown session preference RPC endpoint")
    }
  }

  #transportHealth(sessionId) {
    if (this.#sessionResources === undefined) return {}
    return {
      transportHealth: publicTransportHealth(
        this.#sessionResources.transportHealth(sessionId),
      ),
    }
  }
}

/** Register the session-only request controls on a dedicated loopback channel. */
export function registerSessionPreferenceRpc(ctx, sessionPreferences, sessionResourcesOrOptions) {
  const bridge = new CodexSessionPreferenceBridge(sessionPreferences, sessionResourcesOrOptions)
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
    || !TEXT_VERBOSITIES.has(value.textVerbosity)
    || !REASONING_SUMMARIES.has(value.reasoningSummary)
  ) {
    throw new TypeError("session preference store returned an invalid snapshot")
  }
  return {
    fast: value.fast,
    transport: value.transport,
    textVerbosity: value.textVerbosity,
    reasoningSummary: value.reasoningSummary,
  }
}

function optionalSessionResources(value) {
  if (value === undefined) return undefined
  const candidate = value !== null
    && typeof value === "object"
    && Object.hasOwn(value, "sessionResources")
    ? value.sessionResources
    : value
  if (candidate === undefined) return undefined
  if (
    candidate === null
    || typeof candidate !== "object"
    || typeof candidate.transportHealth !== "function"
    || (candidate.reset !== undefined && typeof candidate.reset !== "function")
  ) {
    throw new TypeError("sessionResources must provide transportHealth and an optional reset")
  }
  return candidate
}

function publicTransportHealth(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("session resources returned invalid transport health")
  }
  if (value.status === "idle") return { status: "idle" }
  if (value.status !== "observed") {
    throw new TypeError("session resources returned invalid transport health")
  }
  const result = { status: "observed" }
  for (const key of TRANSPORT_HEALTH_COUNT_KEYS) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new TypeError("session resources returned invalid transport health")
    }
    result[key] = value[key]
  }
  if (typeof value.websocketFallbackActive !== "boolean") {
    throw new TypeError("session resources returned invalid transport health")
  }
  result.websocketFallbackActive = value.websocketFallbackActive
  return result
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
