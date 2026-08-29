const EFFORT_NAMES = Object.freeze({
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Xhigh",
  max: "Max",
})

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
