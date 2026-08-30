import {
  LlmAdapter,
  LlmError,
  freezeMessage,
} from "@deepseek-ai/dsh-llm"

import {
  CODEX_PROVIDER_ID,
  CODEX_ROUTE_ID,
} from "./codex-identifiers.mjs"
import {
  codexModelCapabilityDescriptor,
  supportsCodexReasoningEffort,
} from "./codex-model-capabilities.mjs"

export { CODEX_ROUTE_ID } from "./codex-identifiers.mjs"

/**
 * Expose one plugin-owned Harness route while keeping pi-ai's native provider
 * identity at the wire/replay boundary. The Harness owns the external route;
 * PiAiAdapter continues to own conversion, tool-call correlation, and replay.
 */
export class CodexRouteAdapter extends LlmAdapter {
  constructor(delegate, options = {}) {
    super()
    if (delegate === null || typeof delegate !== "object") {
      throw new TypeError("delegate must be an LLM adapter")
    }
    for (const method of [
      "providerInfo",
      "providerRetryPolicy",
      "listModels",
      "resolveModel",
      "prepareCall",
      "stream",
    ]) {
      if (typeof delegate[method] !== "function") {
        throw new TypeError(`delegate.${method} must be a function`)
      }
    }
    if (
      options === null
      || typeof options !== "object"
      || Array.isArray(options)
      || Object.keys(options).some((key) => key !== "filterModels")
    ) {
      throw new TypeError("options must contain only filterModels")
    }
    if (options.filterModels !== undefined && typeof options.filterModels !== "function") {
      throw new TypeError("filterModels must be a function")
    }
    this.delegate = delegate
    this.filterModels = options.filterModels
  }

  providerInfo(provider) {
    this.#assertRoute(provider)
    const info = this.delegate.providerInfo(CODEX_PROVIDER_ID)
    return { ...info, id: CODEX_ROUTE_ID }
  }

  providerRetryPolicy(provider) {
    this.#assertRoute(provider)
    return this.delegate.providerRetryPolicy(CODEX_PROVIDER_ID)
  }

  async listModels(provider) {
    this.#assertRoute(provider)
    const catalog = await this.delegate.listModels(CODEX_PROVIDER_ID)
    const visible = this.filterModels === undefined
      ? catalog
      : this.filterModels(catalog)
    if (!Array.isArray(visible)) throw new TypeError("filterModels must return an array")
    return visible.map(externalModelInfo)
  }

  async resolveModel(provider, model, signal) {
    this.#assertRoute(provider)
    return externalModelInfo({
      ...await this.delegate.resolveModel(CODEX_PROVIDER_ID, model, signal),
      provider: CODEX_ROUTE_ID,
    })
  }

  async prepareCall(provider, model, signal) {
    this.#assertRoute(provider)
    const prepared = await this.delegate.prepareCall(
      CODEX_PROVIDER_ID,
      model,
      signal,
    )
    return Object.freeze({
      model: Object.freeze(externalModelInfo({
        ...prepared.model,
        provider: CODEX_ROUTE_ID,
      })),
      stream: (options) => prepared.stream(this.#canonicalOptions(options)),
    })
  }

  stream(options) {
    return this.delegate.stream(this.#canonicalOptions(options))
  }

  #canonicalOptions(options) {
    this.#assertRoute(options?.provider)
    const reasoningEffort = options.reasoningEffort
    if (
      reasoningEffort !== undefined
      && !supportsCodexReasoningEffort(options.model, reasoningEffort)
    ) {
      throw new LlmError(
        `provider "${CODEX_ROUTE_ID}" model "${String(options.model)}" does not support reasoning effort "${String(reasoningEffort)}"`,
        "UNSUPPORTED_REASONING_EFFORT",
      )
    }
    return {
      ...options,
      provider: CODEX_PROVIDER_ID,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      messages: options.messages.map(toCanonicalHistoryMessage),
    }
  }

  #assertRoute(provider) {
    if (provider !== CODEX_ROUTE_ID) {
      throw new LlmError(
        `dsh-codex adapter does not own provider "${String(provider)}"`,
        "NO_ADAPTER",
      )
    }
  }
}

function externalModelInfo(model) {
  const descriptor = codexModelCapabilityDescriptor({
    id: model?.id,
    name: model?.name,
    contextWindow: model?.context?.contextWindow ?? model?.contextWindow,
    maxTokens: model?.defaultMaxTokens ?? model?.maxTokens,
    inputModalities: model?.inputModalities ?? model?.input,
  })
  return Object.freeze({
    provider: CODEX_ROUTE_ID,
    id: descriptor.id,
    name: descriptor.name ?? descriptor.id,
    ...(descriptor.inputModalities === undefined
      ? {}
      : { inputModalities: descriptor.inputModalities }),
    ...(descriptor.contextWindow === undefined
      ? {}
      : { context: Object.freeze({ contextWindow: descriptor.contextWindow }) }),
    ...(descriptor.maxTokens === undefined
      ? {}
      : { defaultMaxTokens: descriptor.maxTokens }),
    ...(descriptor.reasoning === undefined
      ? {}
      : { reasoning: descriptor.reasoning }),
  })
}

function toCanonicalHistoryMessage(message) {
  if (
    message.role !== "assistant"
    || message.source.kind !== "model"
    || message.source.provider !== CODEX_ROUTE_ID
  ) {
    return message
  }
  return freezeMessage({
    ...message,
    source: {
      ...message.source,
      provider: CODEX_PROVIDER_ID,
    },
  })
}
