export const DEFAULT_IMAGE_POLICY = Object.freeze({
  maxRequestImageBytes: 20 * 1024 * 1024,
  requestImagePixelBudget: 2048 * 2048,
  requestImageMaxBytes: 1024 * 1024,
})

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}
/**
 * Resolve every optional image limit at the configuration boundary.
 * Downstream callers receive no optional numeric fields.
 */
export function resolveImagePolicy(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("image policy must be an object")
  }

  return Object.freeze({
    maxRequestImageBytes: positiveSafeInteger(
      input.maxRequestImageBytes ?? DEFAULT_IMAGE_POLICY.maxRequestImageBytes,
      "maxRequestImageBytes",
    ),
    requestImagePixelBudget: positiveSafeInteger(
      input.requestImagePixelBudget ?? DEFAULT_IMAGE_POLICY.requestImagePixelBudget,
      "requestImagePixelBudget",
    ),
    requestImageMaxBytes: positiveSafeInteger(
      input.requestImageMaxBytes ?? DEFAULT_IMAGE_POLICY.requestImageMaxBytes,
      "requestImageMaxBytes",
    ),
  })
}

/** Convert a resolved provider profile into the attachment service contract. */
export function toAttachmentRequestPolicy(policy) {
  const resolved = resolveImagePolicy(policy)
  return Object.freeze({
    maxPixels: resolved.requestImagePixelBudget,
    maxBytes: resolved.requestImageMaxBytes,
  })
}
