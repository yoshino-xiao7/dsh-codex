import { codexModelCapabilityCatalog } from "./codex-model-capabilities.mjs"

export const CODEX_MODEL_CAPABILITY_RPC_CHANNEL = "/dsh-codex-model-capabilities"

class CapabilityInputError extends Error {}

/**
 * Read-only loopback bridge for model capabilities that the current generic
 * Harness discovery schema intentionally does not carry.
 */
export function registerCodexModelCapabilityRpc(ctx, getModels) {
  if (typeof getModels !== "function") throw new TypeError("getModels must be a function")
  const handler = createCodexModelCapabilityRpcHandler(getModels)
  ctx.connection.rpc.handle(
    CODEX_MODEL_CAPABILITY_RPC_CHANNEL,
    handler,
    { authority: "loopback" },
  )
  return handler
}

export function createCodexModelCapabilityRpcHandler(getModels) {
  if (typeof getModels !== "function") throw new TypeError("getModels must be a function")
  return async (endpoint, payload, signal) => {
    if (signal?.aborted === true) return cancelledResult()
    try {
      if (endpoint !== "get") throw new CapabilityInputError("Unknown model capability endpoint")
      assertEmptyPayload(payload)
      const models = codexModelCapabilityCatalog(await getModels())
      if (signal?.aborted === true) return cancelledResult()
      return { ok: true, value: { models } }
    } catch (error) {
      if (signal?.aborted === true) return cancelledResult()
      if (error instanceof CapabilityInputError) {
        return {
          ok: false,
          error: { code: "bad-request", message: error.message, details: { issues: [] } },
        }
      }
      return {
        ok: false,
        error: { code: "internal", message: "Model capabilities are unavailable", details: {} },
      }
    }
  }
}

function assertEmptyPayload(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CapabilityInputError("RPC payload must be an object")
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.keys(value).length > 0) {
    throw new CapabilityInputError("RPC payload must be an empty plain object")
  }
}

function cancelledResult() {
  return {
    ok: false,
    error: { code: "cancelled", message: "Request cancelled", details: {} },
  }
}
