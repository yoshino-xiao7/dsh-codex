const EFFORT_NAMES = Object.freeze({
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Xhigh",
  max: "Max",
})

const MODEL_MODALITIES = new Set(["text", "image"])

const MODEL_CAPABILITIES = new Map([
  ["gpt-5.3-codex-spark", modelCapability({
    defaultReasoningEffort: "high",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  })],
  ["gpt-5.4", modelCapability({
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    fast: true,
  })],
  ["gpt-5.4-mini", modelCapability({
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  })],
  ["gpt-5.5", modelCapability({
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    fast: true,
  })],
  ["gpt-5.6-luna", modelCapability({
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  })],
  ["gpt-5.6-sol", modelCapability({
    defaultReasoningEffort: "low",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  })],
  ["gpt-5.6-terra", modelCapability({
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  })],
])

function modelCapability({ defaultReasoningEffort, reasoningEfforts, fast = false }) {
  if (!reasoningEfforts.includes(defaultReasoningEffort)) {
    throw new TypeError("defaultReasoningEffort must be included in reasoningEfforts")
  }
  return Object.freeze({
    defaultReasoningEffort,
    reasoningEfforts: Object.freeze(reasoningEfforts.map((id) => Object.freeze({
      id,
      name: EFFORT_NAMES[id],
    }))),
    fast,
  })
}

/**
 * Return the Codex model controls verified from the first-party model catalog.
 * Unknown future models deliberately expose no inferred controls.
 */
export function codexModelCapability(modelId) {
  return MODEL_CAPABILITIES.get(modelId)
}

/**
 * Project one provider catalog row onto the complete client-safe Codex
 * capability interface. Only catalog identity/capacity fields cross this
 * seam; endpoint, pricing, compatibility, credentials, and other provider
 * implementation details are deliberately discarded.
 *
 * Reasoning and Fast are added only for models in the verified controls table.
 * An unknown future model remains usable through the provider catalog without
 * gaining inferred controls.
 */
export function codexModelCapabilityDescriptor(model) {
  if (model === null || typeof model !== "object" || Array.isArray(model)) {
    throw new TypeError("model must be an object")
  }
  if (typeof model.id !== "string" || model.id.trim().length === 0) {
    throw new TypeError("model.id must be a non-empty string")
  }

  const capability = MODEL_CAPABILITIES.get(model.id)
  const inputModalities = catalogModalities(model)
  return Object.freeze({
    id: model.id,
    ...(typeof model.name === "string" && model.name.trim().length > 0
      ? { name: model.name }
      : {}),
    ...(positiveSafeInteger(model.contextWindow)
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(positiveSafeInteger(model.maxTokens)
      ? { maxTokens: model.maxTokens }
      : {}),
    ...(inputModalities === undefined ? {} : { inputModalities }),
    ...(capability === undefined
      ? {}
      : {
          reasoning: Object.freeze({
            efforts: capability.reasoningEfforts,
            defaultEffort: capability.defaultReasoningEffort,
          }),
          fast: capability.fast,
        }),
  })
}

/** Return an immutable, insertion-ordered capability snapshot for a catalog. */
export function codexModelCapabilityCatalog(models) {
  if (!Array.isArray(models)) throw new TypeError("models must be an array")
  return Object.freeze(models.map(codexModelCapabilityDescriptor))
}

export function supportsCodexFast(modelId) {
  return MODEL_CAPABILITIES.get(modelId)?.fast === true
}

export function supportsCodexReasoningEffort(modelId, reasoningEffort) {
  return MODEL_CAPABILITIES.get(modelId)?.reasoningEfforts.some(
    ({ id }) => id === reasoningEffort,
  ) === true
}

export function piThinkingLevelMap(modelId) {
  const capability = MODEL_CAPABILITIES.get(modelId)
  if (capability === undefined) return undefined
  const supported = new Set(capability.reasoningEfforts.map(({ id }) => id))
  return Object.freeze({
    off: null,
    minimal: null,
    low: supported.has("low") ? "low" : null,
    medium: supported.has("medium") ? "medium" : null,
    high: supported.has("high") ? "high" : null,
    xhigh: supported.has("xhigh") ? "xhigh" : null,
    max: supported.has("max") ? "max" : null,
  })
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function catalogModalities(model) {
  const source = Array.isArray(model.input)
    ? model.input
    : Array.isArray(model.inputModalities)
      ? model.inputModalities
      : undefined
  if (source === undefined) return undefined
  return Object.freeze([...new Set(source.filter((value) => MODEL_MODALITIES.has(value)))])
}
