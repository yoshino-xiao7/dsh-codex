import {
  closeOpenAICodexWebSocketSessions,
  getOpenAICodexWebSocketDebugStats,
  resetOpenAICodexWebSocketDebugStats,
} from "@earendil-works/pi-ai/api/openai-codex-responses"

const TRANSPORT_SESSION_PREFIX = "dsh-codex:"

/** Keep pi-ai transport/cache state distinct from other consumers of the same session id. */
export function codexTransportSessionId(sessionId) {
  if (sessionId === undefined) return undefined
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new TypeError("transport session id must be a non-empty string")
  }
  return `${TRANSPORT_SESSION_PREFIX}${sessionId}`
}

function clearTransportSession(sessionId) {
  try {
    closeOpenAICodexWebSocketSessions(sessionId)
  } finally {
    resetOpenAICodexWebSocketDebugStats(sessionId)
  }
}

function safeTransportCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * Project pi-ai's process-local debug counters onto a small, content-free
 * transport health contract. Response ids, input sizes, and raw errors never
 * cross this seam.
 */
export function codexTransportHealth(sessionId) {
  const resolved = codexTransportSessionId(sessionId)
  if (resolved === undefined) return undefined
  const stats = getOpenAICodexWebSocketDebugStats(resolved)
  if (stats === undefined) return Object.freeze({ status: "idle" })
  return Object.freeze({
    status: "observed",
    requests: safeTransportCount(stats.requests),
    connectionsCreated: safeTransportCount(stats.connectionsCreated),
    connectionsReused: safeTransportCount(stats.connectionsReused),
    cachedContextRequests: safeTransportCount(stats.cachedContextRequests),
    fullContextRequests: safeTransportCount(stats.fullContextRequests),
    deltaRequests: safeTransportCount(stats.deltaRequests),
    websocketFailures: safeTransportCount(stats.websocketFailures),
    sseFallbacks: safeTransportCount(stats.sseFallbacks),
    websocketFallbackActive: stats.websocketFallbackActive === true,
  })
}

/** Own only the public pi-ai transport state created by this plugin instance. */
export function createCodexSessionResourceManager() {
  let disposed = false
  const owned = new Set()

  return Object.freeze({
    transportSessionId(sessionId) {
      const resolved = codexTransportSessionId(sessionId)
      if (resolved === undefined) return undefined
      if (disposed) throw new Error("Codex session resources are disposed")
      owned.add(resolved)
      return resolved
    },

    transportHealth(sessionId) {
      if (disposed) throw new Error("Codex session resources are disposed")
      return codexTransportHealth(sessionId)
    },

    reset(sessionId) {
      if (disposed) return
      const resolved = codexTransportSessionId(sessionId)
      if (resolved === undefined) return
      owned.delete(resolved)
      clearTransportSession(resolved)
    },

    dispose() {
      if (disposed) return
      disposed = true
      const errors = []
      for (const sessionId of owned) {
        try {
          clearTransportSession(sessionId)
        } catch (error) {
          errors.push(error)
        }
      }
      owned.clear()
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to clear Codex session resources")
      }
    },
  })
}
