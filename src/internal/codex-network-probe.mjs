import { randomUUID } from "node:crypto"
import {
  clearTimeout as cancelTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers"

import { createUserMessage } from "@deepseek-ai/dsh-llm"

import {
  CODEX_NETWORK_PROBE_PREFERENCES,
  CODEX_NETWORK_PROBE_SESSION_PREFIX,
  isCodexNetworkProbeModelId,
} from "./codex-network-probe-contract.mjs"
import { inspectCodexFailure } from "./failure-normalizer.mjs"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 60_000
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER
const PROCESS_COORDINATOR_KEY = Symbol.for("dsh-codex.network-probe-coordinator.v1")
const PROCESS_COORDINATOR = processCodexNetworkProbeCoordinator()

/**
 * Execute one deliberately small Codex request without AgentLoop retries.
 *
 * The result is a fixed, content-free projection. Prompt text, response text,
 * request identifiers, credentials, provider objects, and raw failures never
 * leave this module. Every probe gets an isolated temporary session so global
 * Fast/transport defaults cannot make the diagnostic less deterministic. The
 * Codex endpoint has no supported hard output-cap field here, so the probe
 * tears down its stream immediately after the first visible model output.
 */
export function createCodexNetworkProbe(options) {
  const input = plainOptions(options)
  const stream = requiredFunction(input, "stream")
  const selectModel = requiredFunction(input, "selectModel")
  const sessionPreferences = requiredObject(input, "sessionPreferences")
  const sessionResources = requiredObject(input, "sessionResources")
  const coordinator = input.coordinator ?? PROCESS_COORDINATOR
  if (
    typeof sessionPreferences.configure !== "function"
    || typeof sessionPreferences.remove !== "function"
  ) {
    throw new TypeError("sessionPreferences must provide configure and remove")
  }
  if (typeof sessionResources.reset !== "function") {
    throw new TypeError("sessionResources must provide reset")
  }
  if (
    coordinator === null
    || typeof coordinator !== "object"
    || typeof coordinator.acquire !== "function"
    || typeof coordinator.release !== "function"
  ) {
    throw new TypeError("coordinator must provide acquire and release")
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`)
  }

  let sequence = 0
  const generation = randomUUID()
  let active = false
  let disposed = false
  const lifetime = new AbortController()

  async function run(signal, preparedModelId) {
    assertAbortSignal(signal)
    if (disposed || signal?.aborted === true) return result("cancelled")
    if (active) return result("busy")
    const lease = coordinator.acquire()
    if (lease === undefined) return result("busy")
    active = true
    let retained = false
    const retain = () => { retained = true }
    const release = () => coordinator.release(lease)
    try {
      return await runOnce(signal, preparedModelId, retain, release)
    } finally {
      active = false
      if (!retained) release()
    }
  }

  async function runOnce(signal, preparedModelId, retainLease, releaseLease) {
    const timeout = new AbortController()
    const teardown = new AbortController()
    const timer = scheduleTimeout(() => timeout.abort(), timeoutMs)
    const combined = AbortSignal.any([
      lifetime.signal,
      timeout.signal,
      teardown.signal,
      ...(signal === undefined ? [] : [signal]),
    ])
    const abortWait = waitForAbort(combined)
    let iterator
    let iteratorDone = false
    let pendingNextAttempt
    let requestDispatched = false
    let sessionId
    let sessionReleased = false
    let outputObserved = false
    const releaseSession = () => {
      if (sessionId === undefined || sessionReleased) return
      sessionReleased = true
      try {
        sessionPreferences.remove(sessionId)
      } finally {
        sessionResources.reset(sessionId)
      }
    }
    try {
      const selected = preparedModelId === undefined
        ? await Promise.race([
            Promise.resolve().then(selectModel).then(
              (value) => ({ kind: "selected", value }),
              () => ({ kind: "selection-failed" }),
            ),
            abortWait.promise,
          ])
        : { kind: "selected", value: preparedModelId }
      if (selected.kind === "aborted") {
        return abortResult(signal, lifetime.signal, outputObserved, requestDispatched)
      }
      if (
        selected.kind !== "selected"
        || !isCodexNetworkProbeModelId(selected.value)
      ) {
        return result("model-unavailable")
      }
      if (combined.aborted) {
        return abortResult(signal, lifetime.signal, outputObserved, requestDispatched)
      }

      sequence = sequence >= MAX_SEQUENCE ? 1 : sequence + 1
      sessionId = `${CODEX_NETWORK_PROBE_SESSION_PREFIX}${generation}:${sequence}`
      sessionPreferences.configure(sessionId, CODEX_NETWORK_PROBE_PREFERENCES)
      requestDispatched = true
      const iterable = stream({
        provider: "dsh-codex",
        model: selected.value,
        sessionId,
        signal: combined,
        messages: [createUserMessage({
          content: [{ type: "text", text: "Reply with exactly OK." }],
          source: { kind: "user" },
        })],
      })
      iterator = iterable[Symbol.asyncIterator]()

      while (true) {
        const nextAttempt = Promise.resolve().then(() => iterator.next()).then(
          (value) => ({ kind: "next", value }),
          (error) => ({ kind: "stream-error", error }),
        )
        pendingNextAttempt = nextAttempt
        const next = await Promise.race([nextAttempt, abortWait.promise])
        if (next.kind === "aborted") {
          return abortResult(signal, lifetime.signal, outputObserved, requestDispatched)
        }
        pendingNextAttempt = undefined
        if (next.kind === "stream-error") throw next.error
        if (next.value.done) {
          iteratorDone = true
          return result("stream-closed", outputObserved)
        }
        const chunk = next.value.value
        if (
          (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta")
          && typeof chunk.text === "string"
          && chunk.text.length > 0
        ) {
          outputObserved = true
          return result("success", true)
        }
        if (chunk?.type === "finish") {
          return terminalResult(chunk.reason, outputObserved)
        }
      }
    } catch (error) {
      if (disposed || lifetime.signal.aborted || signal?.aborted === true) {
        return abortResult(signal, lifetime.signal, outputObserved, requestDispatched)
      }
      if (timeout.signal.aborted) {
        return result("timeout", outputObserved)
      }
      return result(classifyFailure(error), outputObserved)
    } finally {
      cancelTimeout(timer)
      // Abort the provider request before asking every iterator layer to
      // return. The explicit return below remains necessary because aborting a
      // fetch signal alone does not prove that adapter cleanup has converged.
      teardown.abort()
      abortWait.dispose()
      if (!iteratorDone && iterator !== undefined) {
        retainLease()
        const teardown = iteratorReturnAttempt(iterator)
        const pendingNext = pendingNextAttempt ?? Promise.resolve()
        void Promise.allSettled([pendingNext, teardown]).then((settled) => {
          if (
            // A rejected next() is still settled. Only a fulfilled return()
            // proves the iterator accepted teardown; otherwise retain the
            // safe session lease and process coordinator quarantine.
            settled[1]?.status !== "fulfilled"
          ) return
          try {
            releaseSession()
            releaseLease()
          } catch {
            // Failed cleanup cannot safely release a later real request.
          }
        })
      } else if (sessionId !== undefined) {
        // Cleanup is part of the real-request exclusion contract. Retain the
        // process lease before touching either cleanup dependency; an
        // exception must preserve the original bounded result and quarantine
        // later probes until restart.
        retainLease()
        try {
          releaseSession()
          releaseLease()
        } catch {
          // Failed cleanup cannot safely release a later real request.
        }
      }
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    lifetime.abort()
  }

  return Object.freeze({ dispose, run })
}

export function createCodexNetworkProbeCoordinator() {
  let current
  return Object.freeze({
    acquire() {
      if (current !== undefined) return undefined
      current = Object.freeze({})
      return current
    },
    release(lease) {
      if (lease !== current) return false
      current = undefined
      return true
    },
  })
}

function processCodexNetworkProbeCoordinator() {
  const existing = globalThis[PROCESS_COORDINATOR_KEY]
  if (existing !== undefined) {
    if (
      existing !== null
      && typeof existing === "object"
      && typeof existing.acquire === "function"
      && typeof existing.release === "function"
    ) {
      return existing
    }
    throw new TypeError("process network probe coordinator is invalid")
  }
  const coordinator = createCodexNetworkProbeCoordinator()
  Object.defineProperty(globalThis, PROCESS_COORDINATOR_KEY, {
    configurable: false,
    enumerable: false,
    value: coordinator,
    writable: false,
  })
  return coordinator
}

function terminalResult(terminal, outputObserved) {
  if (terminal?.kind === "stop") {
    return result(outputObserved ? "success" : "empty-response", outputObserved)
  }
  if (terminal?.kind === "max-tokens") return result("max-tokens", outputObserved)
  if (terminal?.kind === "tool-calls") return result("unexpected-tool-call", outputObserved)
  if (terminal?.kind === "aborted") return result("aborted", outputObserved)
  if (terminal?.kind === "error") {
    return result(classifyFailure(terminal.failure), outputObserved)
  }
  return result("stream-closed", outputObserved)
}

function abortResult(signal, lifetime, outputObserved, requestDispatched) {
  if (signal?.aborted === true || lifetime.aborted) {
    return result(requestDispatched ? "cancelled-after-attempt" : "cancelled", outputObserved)
  }
  return result("timeout", outputObserved)
}

function waitForAbort(signal) {
  let listener
  const promise = signal.aborted
    ? Promise.resolve({ kind: "aborted" })
    : new Promise((resolve) => {
        listener = () => resolve({ kind: "aborted" })
        signal.addEventListener("abort", listener, { once: true })
      })
  return {
    promise,
    dispose() {
      if (listener !== undefined) signal.removeEventListener("abort", listener)
    },
  }
}

function iteratorReturnAttempt(iterator) {
  try {
    const returnIterator = iterator?.return
    if (typeof returnIterator !== "function") {
      return Promise.reject(new Error("network probe iterator does not support teardown"))
    }
    return Promise.resolve(returnIterator.call(iterator)).then((value) => {
      if (value === null || typeof value !== "object" || value.done !== true) {
        throw new Error("network probe iterator teardown did not finish")
      }
      return value
    })
  } catch (error) {
    // The probe result remains content-free even when an SDK refuses teardown.
    return Promise.reject(error)
  }
}

function classifyFailure(error) {
  let code
  try {
    code = error?.code
  } catch {
    return "failure"
  }
  const quota = inspectCodexFailure(error)
  if (quota.kind === "account-quota" || code === "QUOTA" || code === "QUOTA_EXCEEDED") {
    return "quota"
  }
  switch (code) {
    case "AUTH":
    case "INVALID_CREDENTIAL": return "auth"
    case "RATE_LIMIT":
    case "QUOTA_OR_RATE_LIMIT": return "rate-limit"
    case "TIMEOUT": return "timeout"
    case "SERVER": return "server"
    case "TRANSPORT":
    case "STREAM_CLOSED": return "transport"
    case "EMPTY_RESPONSE": return "empty-response"
    case "UNSUPPORTED_CONTENT":
    case "UNSUPPORTED_OPTION":
    case "UNSUPPORTED_REASONING_EFFORT": return "unsupported"
    case "INVALID_REQUEST": return "invalid-request"
    case "PI_AI_ERROR": return "provider-error"
    case "UNKNOWN_MODEL": return "unknown-model"
    case "MISSING_CREDENTIAL": return "missing-credential"
    case "ABORTED": return "aborted"
    default: return "failure"
  }
}

function result(kind, outputObserved = false) {
  return Object.freeze({ kind, outputObserved: outputObserved === true })
}

function plainOptions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("network probe options must be a plain object")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("network probe options must be a plain object")
  }
  const allowed = new Set([
    "selectModel",
    "sessionPreferences",
    "sessionResources",
    "stream",
    "timeoutMs",
    "coordinator",
  ])
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("network probe options contain an unknown field")
  }
  return value
}

function requiredFunction(value, key) {
  if (typeof value[key] !== "function") throw new TypeError(`${key} must be a function`)
  return value[key]
}

function requiredObject(value, key) {
  if (value[key] === null || typeof value[key] !== "object" || Array.isArray(value[key])) {
    throw new TypeError(`${key} must be an object`)
  }
  return value[key]
}

function assertAbortSignal(value) {
  if (value !== undefined && !(value instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal")
  }
}
