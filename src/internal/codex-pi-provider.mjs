import {
  clampThinkingLevel,
  createProvider,
} from "@earendil-works/pi-ai"
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options"
import { stream as streamCodexResponses } from "@earendil-works/pi-ai/api/openai-codex-responses"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import {
  codexModelCapabilityDescriptor,
  piThinkingLevelMap,
  supportsCodexFast,
} from "./codex-model-capabilities.mjs"
import {
  CODEX_NETWORK_PROBE_PREFERENCES,
  isCodexNetworkProbeSession,
} from "./codex-network-probe-contract.mjs"
import { codexTransportSessionId } from "./codex-session-resources.mjs"

export { supportsCodexFast } from "./codex-model-capabilities.mjs"

const FACTORY_OPTION_KEYS = new Set([
  "acquireTransportSession",
  "resolveSessionPreferences",
  "resolveTransportSessionId",
  "serviceTier",
])
const TRANSPORTS = new Set([
  "auto",
  "sse",
  "websocket",
  "websocket-cached",
])
const TEXT_VERBOSITIES = new Set(["low", "medium", "high"])
const REASONING_SUMMARIES = new Set(["auto", "concise", "detailed", "off"])

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateFactoryOptions(options) {
  if (!plainObject(options)) throw new TypeError("options must be a plain object")
  for (const key of Object.keys(options)) {
    if (!FACTORY_OPTION_KEYS.has(key)) throw new TypeError(`unknown option: ${key}`)
  }
  if (options.serviceTier !== undefined && options.serviceTier !== "priority") {
    throw new TypeError("serviceTier must be priority when provided")
  }
  if (
    options.resolveSessionPreferences !== undefined
    && typeof options.resolveSessionPreferences !== "function"
  ) {
    throw new TypeError("resolveSessionPreferences must be a function")
  }
  if (
    options.resolveTransportSessionId !== undefined
    && typeof options.resolveTransportSessionId !== "function"
  ) {
    throw new TypeError("resolveTransportSessionId must be a function")
  }
  if (
    options.acquireTransportSession !== undefined
    && typeof options.acquireTransportSession !== "function"
  ) {
    throw new TypeError("acquireTransportSession must be a function")
  }
  if (
    options.acquireTransportSession !== undefined
    && options.resolveTransportSessionId !== undefined
  ) {
    throw new TypeError(
      "acquireTransportSession and resolveTransportSessionId are mutually exclusive",
    )
  }
}

function resolveSessionPreferenceOptions(resolver, sessionId) {
  const preferences = resolver(sessionId) ?? {
    fast: false,
    transport: "auto",
    textVerbosity: "low",
    reasoningSummary: "auto",
  }
  if (!plainObject(preferences)) {
    throw new TypeError("session preferences must be a plain object")
  }
  for (const key of Object.keys(preferences)) {
    if (
      key !== "fast"
      && key !== "transport"
      && key !== "textVerbosity"
      && key !== "reasoningSummary"
    ) {
      throw new TypeError(`unknown session preference: ${key}`)
    }
  }
  const fast = preferences.fast ?? false
  if (typeof fast !== "boolean") {
    throw new TypeError("session preferences fast must be a boolean")
  }
  const transport = preferences.transport
  if (transport !== undefined && !TRANSPORTS.has(transport)) {
    throw new TypeError("session preferences transport is invalid")
  }
  const textVerbosity = preferences.textVerbosity ?? "low"
  if (!TEXT_VERBOSITIES.has(textVerbosity)) {
    throw new TypeError("session preferences textVerbosity is invalid")
  }
  const reasoningSummary = preferences.reasoningSummary ?? "auto"
  if (!REASONING_SUMMARIES.has(reasoningSummary)) {
    throw new TypeError("session preferences reasoningSummary is invalid")
  }
  return { fast, transport, textVerbosity, reasoningSummary }
}

function reasoningOptions(model, reasoning) {
  if (reasoning === undefined) return {}
  const effort = clampThinkingLevel(model, reasoning)
  return { reasoningEffort: effort === "off" ? "none" : effort }
}

function truthfulCodexModel(model) {
  const descriptor = codexModelCapabilityDescriptor(model)
  if (descriptor.reasoning === undefined) {
    return Object.freeze({
      ...model,
      // A newly published model stays usable with the provider default, but
      // gains no selector controls until its catalog capabilities are verified.
      reasoning: false,
      thinkingLevelMap: undefined,
    })
  }
  return Object.freeze({
    ...model,
    thinkingLevelMap: piThinkingLevelMap(descriptor.id),
  })
}

function validTransportLease(value) {
  if (value === undefined) return undefined
  if (
    value === null
    || typeof value !== "object"
    || typeof value.sessionId !== "string"
    || value.sessionId.length === 0
    || typeof value.release !== "function"
  ) {
    throw new TypeError("transport lease must provide a non-empty sessionId and release")
  }
  return value
}

/**
 * Keep one transport-generation lease until the upstream stream and any
 * pending iterator teardown have settled. The returned proxy preserves
 * EventStream.result() and every other provider-specific member.
 */
export function withCodexTransportLease(stream, lease) {
  if (
    stream === null
    || typeof stream !== "object"
    || typeof stream[Symbol.asyncIterator] !== "function"
  ) {
    throw new TypeError("stream must be an async iterable")
  }
  const resolvedLease = validTransportLease(lease)
  if (resolvedLease === undefined) return stream

  let iterator
  try {
    iterator = stream[Symbol.asyncIterator]()
  } catch (error) {
    resolvedLease.release()
    throw error
  }
  if (iterator === null || typeof iterator !== "object" || typeof iterator.next !== "function") {
    resolvedLease.release()
    throw new TypeError("stream must return an async iterator")
  }

  let released = false
  let upstreamSettled = false
  let upstreamResultTracked = false
  let terminalRequested = false
  const pendingNext = new Set()
  const pendingTeardown = new Set()

  function releaseOnce() {
    if (released) return
    released = true
    try {
      resolvedLease.release()
    } catch {
      // Transport cleanup must not replace the provider's terminal result.
    }
  }

  function maybeRelease() {
    if (pendingNext.size !== 0 || pendingTeardown.size !== 0) return
    if (!upstreamSettled && (upstreamResultTracked || !terminalRequested)) return
    releaseOnce()
  }

  function observeNext(promise) {
    pendingNext.add(promise)
    promise.then(
      (result) => {
        pendingNext.delete(promise)
        if (result?.done === true) {
          terminalRequested = true
          if (!upstreamResultTracked) upstreamSettled = true
        }
        maybeRelease()
      },
      () => {
        pendingNext.delete(promise)
        terminalRequested = true
        if (!upstreamResultTracked) upstreamSettled = true
        maybeRelease()
      },
    )
    return promise
  }

  function observeTeardown(promise, terminalOnFulfill) {
    pendingTeardown.add(promise)
    promise.then(
      (result) => {
        pendingTeardown.delete(promise)
        if (terminalOnFulfill || (!upstreamResultTracked && result?.done === true)) {
          upstreamSettled = true
        }
        maybeRelease()
      },
      () => {
        pendingTeardown.delete(promise)
        if (!upstreamResultTracked) upstreamSettled = true
        maybeRelease()
      },
    )
    return promise
  }

  if (typeof stream.result === "function") {
    try {
      const result = stream.result()
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        upstreamResultTracked = true
        Promise.resolve(result).then(
          () => {
            upstreamSettled = true
            maybeRelease()
          },
          () => {
            upstreamSettled = true
            maybeRelease()
          },
        )
      }
    } catch {
      // Iterator terminal state remains the fallback lifecycle signal.
    }
  }

  const leasedIterator = Object.freeze({
    next(...args) {
      let result
      try {
        result = Promise.resolve(iterator.next(...args))
      } catch (error) {
        terminalRequested = true
        if (!upstreamResultTracked) upstreamSettled = true
        maybeRelease()
        return Promise.reject(error)
      }
      return observeNext(result)
    },

    return(value) {
      terminalRequested = true
      if (typeof iterator.return !== "function") {
        if (!upstreamResultTracked) upstreamSettled = true
        maybeRelease()
        return Promise.resolve({ done: true, value })
      }
      let result
      try {
        result = Promise.resolve(iterator.return(value))
      } catch (error) {
        if (!upstreamResultTracked) upstreamSettled = true
        maybeRelease()
        return Promise.reject(error)
      }
      return observeTeardown(result, !upstreamResultTracked)
    },

    throw(error) {
      if (typeof iterator.throw !== "function") {
        terminalRequested = true
        upstreamSettled = !upstreamResultTracked
        maybeRelease()
        return Promise.reject(error)
      }
      let result
      try {
        result = Promise.resolve(iterator.throw(error))
      } catch (thrown) {
        terminalRequested = true
        if (!upstreamResultTracked) upstreamSettled = true
        maybeRelease()
        return Promise.reject(thrown)
      }
      pendingTeardown.add(result)
      result.then(
        (step) => {
          pendingTeardown.delete(result)
          if (step?.done === true) {
            terminalRequested = true
            if (!upstreamResultTracked) upstreamSettled = true
          }
          maybeRelease()
        },
        () => {
          pendingTeardown.delete(result)
          terminalRequested = true
          if (!upstreamResultTracked) upstreamSettled = true
          maybeRelease()
        },
      )
      return result
    },

    [Symbol.asyncIterator]() {
      return this
    },
  })

  return new Proxy(stream, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return () => leasedIterator
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

/**
 * Build the public pi-ai Codex provider with an optional per-session Fast policy.
 * Authentication, models, transports, and response conversion remain owned by
 * the published provider and PiAiAdapter; only the documented service tier is
 * added to the provider-specific request options.
 */
export function createCodexPiProvider(options = {}) {
  validateFactoryOptions(options)
  const source = openaiCodexProvider()
  const models = source.getModels().map(truthfulCodexModel)
  const resolveSessionPreferences = options.resolveSessionPreferences
  const acquireTransportSession = options.acquireTransportSession
  const resolveTransportSessionId = options.resolveTransportSessionId
    ?? codexTransportSessionId

  return createProvider({
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    headers: source.headers,
    auth: source.auth,
    models,
    ...(source.filterModels === undefined
      ? {}
      : {
          filterModels: (models, credential) => source.filterModels(models, credential),
        }),
    api: {
      stream: streamCodexResponses,
      streamSimple(model, context, streamOptions = {}) {
        const networkProbe = isCodexNetworkProbeSession(streamOptions.sessionId)
        const sessionPreferences = networkProbe
          ? CODEX_NETWORK_PROBE_PREFERENCES
          : resolveSessionPreferences === undefined
            ? undefined
            : resolveSessionPreferenceOptions(
                resolveSessionPreferences,
                streamOptions.sessionId,
              )
        const requestedServiceTier = sessionPreferences === undefined
          ? options.serviceTier
          : sessionPreferences.fast
            ? "priority"
            : undefined
        const serviceTier = requestedServiceTier !== undefined && supportsCodexFast(model.id)
          ? requestedServiceTier
          : undefined
        const baseOptions = buildBaseOptions(model, context, streamOptions)

        let transportLease
        try {
          transportLease = acquireTransportSession === undefined
            ? undefined
            : validTransportLease(acquireTransportSession(streamOptions.sessionId))
          const transportSessionId = transportLease?.sessionId
            ?? resolveTransportSessionId(streamOptions.sessionId)
          if (
            transportSessionId !== undefined
            && (typeof transportSessionId !== "string" || transportSessionId.length === 0)
          ) {
            throw new TypeError("resolved transport session id must be a non-empty string")
          }

          const stream = streamCodexResponses(model, context, {
            ...baseOptions,
            sessionId: transportSessionId,
            ...reasoningOptions(model, streamOptions.reasoning),
            ...(serviceTier === undefined ? {} : { serviceTier }),
            ...(sessionPreferences?.transport === undefined
              ? {}
              : { transport: sessionPreferences.transport }),
            ...(sessionPreferences === undefined
              ? {}
              : {
                  textVerbosity: sessionPreferences.textVerbosity,
                  reasoningSummary: sessionPreferences.reasoningSummary,
                }),
          })
          return transportLease === undefined
            ? stream
            : withCodexTransportLease(stream, transportLease)
        } catch (error) {
          transportLease?.release()
          throw error
        }
      },
    },
  })
}
