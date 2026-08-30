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
import { codexTransportSessionId } from "./codex-session-resources.mjs"

export { supportsCodexFast } from "./codex-model-capabilities.mjs"

const FACTORY_OPTION_KEYS = new Set([
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
}

function resolveSessionPreferenceOptions(resolver, sessionId) {
  const preferences = resolver(sessionId) ?? { fast: false }
  if (!plainObject(preferences)) {
    throw new TypeError("session preferences must be a plain object")
  }
  for (const key of Object.keys(preferences)) {
    if (key !== "fast" && key !== "transport") {
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
  return { fast, transport }
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
        const sessionPreferences = resolveSessionPreferences === undefined
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
        const transportSessionId = resolveTransportSessionId(streamOptions.sessionId)
        if (
          transportSessionId !== undefined
          && (typeof transportSessionId !== "string" || transportSessionId.length === 0)
        ) {
          throw new TypeError("resolved transport session id must be a non-empty string")
        }

        return streamCodexResponses(model, context, {
          ...buildBaseOptions(model, context, streamOptions),
          sessionId: transportSessionId,
          ...reasoningOptions(model, streamOptions.reasoning),
          ...(serviceTier === undefined ? {} : { serviceTier }),
          ...(sessionPreferences?.transport === undefined
            ? {}
            : { transport: sessionPreferences.transport }),
        })
      },
    },
  })
}
