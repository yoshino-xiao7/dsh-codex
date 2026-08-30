import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"

const EFFORT_NAMES = Object.freeze({
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Xhigh",
  max: "Max",
})
const REASONING_LEVELS = Object.freeze(Object.keys(EFFORT_NAMES))

const MODEL_MODALITIES = new Set(["text", "image"])

const MODEL_CAPABILITIES = new Map([
  ["gpt-5.3-codex-spark", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  })],
  ["gpt-5.4", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    fast: true,
  })],
  ["gpt-5.4-mini", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  })],
  ["gpt-5.5", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    fast: true,
  })],
  ["gpt-5.6-luna", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  })],
  ["gpt-5.6-sol", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  })],
  ["gpt-5.6-terra", modelCapability({
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  })],
])

function modelCapability({ reasoningEfforts, fast = false }) {
  return Object.freeze({
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
 * Reasoning is copied only from the installed catalog's explicit map (or an
 * already-normalized adapter descriptor). Fast remains an explicit verified
 * allowlist. Unknown future models never gain inferred controls.
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
  const reasoning = capability === undefined
    ? undefined
    : catalogReasoning(model, capability)
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
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(capability === undefined ? {} : { fast: capability.fast }),
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

function catalogReasoning(model, capability) {
  const allowed = new Set(capability.reasoningEfforts.map(({ id }) => id))
  if (model.reasoning !== null && typeof model.reasoning === "object" && !Array.isArray(model.reasoning)) {
    return copiedReasoning(model.reasoning, allowed)
  }
  if (model.reasoning !== true) return undefined
  const supported = new Set(getSupportedThinkingLevels(model))
  const efforts = REASONING_LEVELS
    .filter((id) => allowed.has(id) && supported.has(id))
    .map((id) => Object.freeze({ id, name: EFFORT_NAMES[id] }))
  return efforts.length === 0
    ? undefined
    : Object.freeze({ efforts: Object.freeze(efforts) })
}

function copiedReasoning(value, allowed) {
  if (!Array.isArray(value.efforts) || value.efforts.length < 1 || value.efforts.length > 8) {
    return undefined
  }
  const seen = new Set()
  const efforts = []
  for (const effort of value.efforts) {
    if (
      !plainObject(effort)
      || typeof effort.id !== "string"
      || !/^[a-z][a-z0-9-]{0,31}$/u.test(effort.id)
      || typeof effort.name !== "string"
      || effort.name.length < 1
      || effort.name.length > 32
    ) return undefined
    if (!allowed.has(effort.id) || seen.has(effort.id)) continue
    seen.add(effort.id)
    efforts.push(Object.freeze({ id: effort.id, name: EFFORT_NAMES[effort.id] }))
  }
  if (efforts.length === 0) return undefined
  return Object.freeze({
    efforts: Object.freeze(efforts),
    ...(value.defaultEffort === undefined || !seen.has(value.defaultEffort)
      ? {}
      : { defaultEffort: value.defaultEffort }),
  })
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
