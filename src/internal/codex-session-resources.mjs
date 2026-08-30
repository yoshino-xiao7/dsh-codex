import { randomUUID } from "node:crypto"

import {
  closeOpenAICodexWebSocketSessions,
  getOpenAICodexWebSocketDebugStats,
  resetOpenAICodexWebSocketDebugStats,
} from "@earendil-works/pi-ai/api/openai-codex-responses"

const TRANSPORT_SESSION_PREFIX = "dsh-codex:"
const DEFAULT_MAX_SESSIONS = 512
const MAX_MAX_SESSIONS = 4_096
const MAX_SESSION_ID_CHARS = 256

/** Keep pi-ai transport/cache state distinct from other consumers of the same session id. */
export function codexTransportSessionId(sessionId) {
  if (sessionId === undefined) return undefined
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new TypeError("transport session id must be a non-empty string")
  }
  return `${TRANSPORT_SESSION_PREFIX}${sessionId}`
}

function generationSessionId(managerEpoch, logicalSessionId, generation) {
  return `${TRANSPORT_SESSION_PREFIX}e:${managerEpoch}:g:${generation}:${logicalSessionId}`
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

function transportHealthForResolvedSession(resolved) {
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

/**
 * Project pi-ai's process-local debug counters onto a small, content-free
 * transport health contract. Response ids, input sizes, and raw errors never
 * cross this seam.
 */
export function codexTransportHealth(sessionId) {
  const resolved = codexTransportSessionId(sessionId)
  if (resolved === undefined) return undefined
  return transportHealthForResolvedSession(resolved)
}

/**
 * Own the public pi-ai transport state created by this plugin instance.
 *
 * A transport generation is leased for the complete lifetime of one provider
 * stream. Resetting a session or changing an inherited default retires the old
 * generation immediately for future requests, but does not close it until its
 * final lease is released. This keeps fallback/cache state from leaking into a
 * new policy without interrupting an in-flight response. A manager-unique epoch
 * and generation precede the logical id so both remain distinct in truncated
 * prompt-cache keys and during overlapping runtime replacement.
 */
export function createCodexSessionResourceManager(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object")
  }
  if (Object.keys(options).some((key) => key !== "maxSessions")) {
    throw new TypeError("unknown option")
  }
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_MAX_SESSIONS) {
    throw new TypeError(`maxSessions must be an integer from 1 to ${MAX_MAX_SESSIONS}`)
  }

  let disposed = false
  let accessSequence = 0
  const managerEpoch = randomUUID().replaceAll("-", "")
  const sessions = new Map()

  function generation(record) {
    const number = record.nextGeneration
    record.nextGeneration += 1
    return {
      active: 0,
      cleared: false,
      inheritedDefault: undefined,
      retired: false,
      sessionId: generationSessionId(managerEpoch, record.logicalSessionId, number),
    }
  }

  function initialGeneration(logicalSessionId) {
    return {
      active: 0,
      cleared: false,
      inheritedDefault: undefined,
      retired: false,
      sessionId: generationSessionId(managerEpoch, logicalSessionId, 0),
    }
  }

  function cleanup(candidate) {
    if (candidate.cleared) return
    candidate.cleared = true
    clearTransportSession(candidate.sessionId)
  }

  function recordIsIdle(record) {
    if ((record.current?.active ?? 0) !== 0) return false
    for (const candidate of record.retired) {
      if (candidate.active !== 0) return false
    }
    return true
  }

  function deleteIfAbandoned(record) {
    if (
      record.removeWhenIdle
      && record.current === undefined
      && record.retired.size === 0
      && sessions.get(record.logicalSessionId) === record
    ) {
      sessions.delete(record.logicalSessionId)
    }
  }

  function cleanupRetired(record, candidate, containError) {
    if (!candidate.retired || candidate.active !== 0) return
    record.retired.delete(candidate)
    try {
      cleanup(candidate)
    } catch (error) {
      if (!containError) throw error
    } finally {
      deleteIfAbandoned(record)
    }
  }

  function retire(record, candidate, containError = false) {
    if (candidate === undefined || candidate.retired) return
    candidate.retired = true
    record.retired.add(candidate)
    cleanupRetired(record, candidate, containError)
  }

  function evictOneIdleSession() {
    let selected
    for (const record of sessions.values()) {
      if (!recordIsIdle(record)) continue
      if (selected === undefined || record.lastAccess < selected.lastAccess) selected = record
    }
    if (selected === undefined) {
      throw new Error("Codex transport session capacity reached")
    }
    sessions.delete(selected.logicalSessionId)
    const errors = []
    for (const candidate of [selected.current, ...selected.retired]) {
      if (candidate === undefined) continue
      try {
        cleanup(candidate)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to evict Codex session resources")
    }
  }

  function ensureRecord(sessionId) {
    const logicalSessionId = validLogicalSessionId(sessionId)
    let record = sessions.get(logicalSessionId)
    if (record === undefined) {
      if (sessions.size >= maxSessions) evictOneIdleSession()
      record = {
        current: initialGeneration(logicalSessionId),
        lastAccess: 0,
        logicalSessionId,
        nextGeneration: 1,
        removeWhenIdle: false,
        retired: new Set(),
      }
      sessions.set(logicalSessionId, record)
    }
    accessSequence += 1
    record.lastAccess = accessSequence
    return record
  }

  function rollover(record) {
    const previous = record.current
    record.current = generation(record)
    record.removeWhenIdle = false
    retire(record, previous)
    return record.current
  }

  function release(record, candidate) {
    if (candidate.active <= 0) return
    candidate.active -= 1
    cleanupRetired(record, candidate, true)
  }

  return Object.freeze({
    /**
     * Compatibility resolver for callers that cannot expose an iterable lease.
     * Plugin requests use acquire() so their active lifetime is protected.
     */
    transportSessionId(sessionId) {
      if (sessionId === undefined) return undefined
      if (disposed) throw new Error("Codex session resources are disposed")
      const record = ensureRecord(sessionId)
      if (record.current === undefined) record.current = generation(record)
      record.removeWhenIdle = false
      return record.current.sessionId
    },

    acquire(sessionId, leaseOptions = {}) {
      if (sessionId === undefined) return undefined
      if (disposed) throw new Error("Codex session resources are disposed")
      if (
        leaseOptions === null
        || typeof leaseOptions !== "object"
        || Array.isArray(leaseOptions)
        || Object.keys(leaseOptions).some((key) => key !== "inheritsDefault")
      ) {
        throw new TypeError("lease options must set only inheritsDefault")
      }
      const inheritsDefault = leaseOptions.inheritsDefault ?? true
      if (typeof inheritsDefault !== "boolean") {
        throw new TypeError("inheritsDefault must be a boolean")
      }
      const record = ensureRecord(sessionId)
      if (record.current === undefined) record.current = generation(record)
      record.removeWhenIdle = false
      if (
        record.current.inheritedDefault !== undefined
        && record.current.inheritedDefault !== inheritsDefault
      ) {
        rollover(record)
      }
      const candidate = record.current
      candidate.inheritedDefault = inheritsDefault
      candidate.active += 1
      let released = false
      return Object.freeze({
        sessionId: candidate.sessionId,
        release() {
          if (released) return
          released = true
          release(record, candidate)
        },
      })
    },

    transportHealth(sessionId) {
      if (disposed) throw new Error("Codex session resources are disposed")
      const logicalSessionId = validLogicalSessionId(sessionId)
      const current = sessions.get(logicalSessionId)?.current
      return current === undefined
        ? Object.freeze({ status: "idle" })
        : transportHealthForResolvedSession(current.sessionId)
    },

    /** Retire only generations whose current transport came from the global default. */
    rolloverInherited() {
      if (disposed) return
      const errors = []
      for (const record of sessions.values()) {
        if (record.current?.inheritedDefault !== true) continue
        try {
          rollover(record)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to roll over inherited Codex transports")
      }
    },

    /** Retire one session for an explicit transport change or /codex reset. */
    reset(sessionId) {
      if (disposed || sessionId === undefined) return
      rollover(ensureRecord(sessionId))
    },

    /** Stop owning a known agent id; an active generation drains before final cleanup. */
    disposeSession(sessionId) {
      if (disposed || sessionId === undefined) return
      const logicalSessionId = validLogicalSessionId(sessionId)
      const record = sessions.get(logicalSessionId)
      if (record === undefined) return
      const current = record.current
      record.current = undefined
      record.removeWhenIdle = true
      retire(record, current)
      deleteIfAbandoned(record)
    },

    dispose() {
      if (disposed) return
      disposed = true
      const errors = []
      for (const record of sessions.values()) {
        const current = record.current
        record.current = undefined
        record.removeWhenIdle = true
        try {
          retire(record, current)
        } catch (error) {
          errors.push(error)
        }
        deleteIfAbandoned(record)
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to clear Codex session resources")
      }
    },
  })
}

function validLogicalSessionId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SESSION_ID_CHARS) {
    throw new TypeError(`transport session id must contain 1 to ${MAX_SESSION_ID_CHARS} characters`)
  }
  return value
}
