import assert from "node:assert/strict"
import test from "node:test"

import {
  codexModelCapability,
  piThinkingLevelMap,
  supportsCodexFast,
  supportsCodexReasoningEffort,
} from "../src/internal/codex-model-capabilities.mjs"

const EXPECTED = Object.freeze({
  "gpt-5.3-codex-spark": ["high", ["low", "medium", "high", "xhigh"], false],
  "gpt-5.4": ["medium", ["low", "medium", "high", "xhigh"], true],
  "gpt-5.4-mini": ["medium", ["low", "medium", "high", "xhigh"], false],
  "gpt-5.5": ["medium", ["low", "medium", "high", "xhigh"], true],
  "gpt-5.6-luna": ["medium", ["low", "medium", "high", "xhigh", "max"], true],
  "gpt-5.6-sol": ["low", ["low", "medium", "high", "xhigh", "max"], true],
  "gpt-5.6-terra": ["medium", ["low", "medium", "high", "xhigh", "max"], true],
})

test("keeps the verified Codex reasoning order, defaults, and Fast support per model", () => {
  for (const [modelId, [defaultEffort, effortIds, fast]] of Object.entries(EXPECTED)) {
    const capability = codexModelCapability(modelId)
    assert.equal(capability.defaultReasoningEffort, defaultEffort, modelId)
    assert.deepEqual(capability.reasoningEfforts.map(({ id }) => id), effortIds, modelId)
    assert.equal(supportsCodexFast(modelId), fast, modelId)
    for (const effortId of effortIds) {
      assert.equal(supportsCodexReasoningEffort(modelId, effortId), true, `${modelId}:${effortId}`)
    }
    for (const hidden of ["off", "minimal", "ultra"]) {
      assert.equal(supportsCodexReasoningEffort(modelId, hidden), false, `${modelId}:${hidden}`)
    }
  }
})

test("does not infer controls for an unknown future model", () => {
  assert.equal(codexModelCapability("gpt-future"), undefined)
  assert.equal(piThinkingLevelMap("gpt-future"), undefined)
  assert.equal(supportsCodexFast("gpt-future"), false)
  assert.equal(supportsCodexReasoningEffort("gpt-future", "high"), false)
})

test("maps only verified plain reasoning levels into pi-ai", () => {
  const sol = piThinkingLevelMap("gpt-5.6-sol")
  assert.equal(sol.off, null)
  assert.equal(sol.minimal, null)
  assert.equal(sol.max, "max")

  const luna = piThinkingLevelMap("gpt-5.6-luna")
  assert.equal(luna.minimal, null)
  assert.equal(luna.max, "max")

  const spark = piThinkingLevelMap("gpt-5.3-codex-spark")
  assert.equal(spark.max, null)
})
