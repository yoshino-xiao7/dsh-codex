import {
  closeOpenAICodexWebSocketSessions,
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
