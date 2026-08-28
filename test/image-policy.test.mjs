import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_IMAGE_POLICY,
  resolveImagePolicy,
  toAttachmentRequestPolicy,
} from "../src/internal/image-policy.mjs"

test("resolves every image budget to a positive integer", () => {
  const policy = resolveImagePolicy()
  assert.deepEqual(policy, {
    maxRequestImageBytes: 20_971_520,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
  })
  assert.equal(Object.isFrozen(policy), true)
})
test("projects a complete attachment request policy", () => {
  assert.deepEqual(toAttachmentRequestPolicy(), {
    maxPixels: 4_194_304,
    maxBytes: 1_048_576,
  })
})

for (const invalid of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid requestImagePixelBudget ${String(invalid)}`, () => {
    const input = invalid === undefined
      ? { ...DEFAULT_IMAGE_POLICY, requestImagePixelBudget: undefined }
      : { ...DEFAULT_IMAGE_POLICY, requestImagePixelBudget: invalid }
    if (invalid === undefined) {
      assert.equal(resolveImagePolicy(input).requestImagePixelBudget, 4_194_304)
    } else {
      assert.throws(() => resolveImagePolicy(input), /positive safe integer/u)
    }
  })
}

test("rejects non-object configuration", () => {
  assert.throws(() => resolveImagePolicy(null), /must be an object/u)
  assert.throws(() => resolveImagePolicy([]), /must be an object/u)
})
