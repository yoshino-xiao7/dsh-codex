import assert from "node:assert/strict"
import test from "node:test"

import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import {
  codexModelCapabilityCatalog,
  codexModelCapability,
  codexModelCapabilityDescriptor,
  piThinkingLevelMap,
  supportsCodexFast,
  supportsCodexReasoningEffort,
} from "../src/internal/codex-model-capabilities.mjs"

const EXPECTED = Object.freeze({
  "gpt-5.3-codex-spark": [["low", "medium", "high", "xhigh"], false],
  "gpt-5.4": [["low", "medium", "high", "xhigh"], true],
  "gpt-5.4-mini": [["low", "medium", "high", "xhigh"], false],
  "gpt-5.5": [["low", "medium", "high", "xhigh"], true],
  "gpt-5.6-luna": [["low", "medium", "high", "xhigh", "max"], true],
  "gpt-5.6-sol": [["low", "medium", "high", "xhigh", "max"], true],
  "gpt-5.6-terra": [["low", "medium", "high", "xhigh", "max"], true],
})

test("keeps the verified Codex reasoning order and Fast support per model without inventing defaults", () => {
  for (const [modelId, [effortIds, fast]] of Object.entries(EXPECTED)) {
    const capability = codexModelCapability(modelId)
    assert.equal(Object.hasOwn(capability, "defaultReasoningEffort"), false, modelId)
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

test("merges the installed provider catalog with verified controls behind one immutable descriptor", () => {
  const catalog = codexModelCapabilityCatalog(openaiCodexProvider().getModels())
  const sol = catalog.find(({ id }) => id === "gpt-5.6-sol")

  assert.deepEqual(sol, {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    contextWindow: 272_000,
    maxTokens: 128_000,
    inputModalities: ["text", "image"],
    reasoning: {
      efforts: [
        { id: "low", name: "Low" },
        { id: "medium", name: "Medium" },
        { id: "high", name: "High" },
        { id: "xhigh", name: "Xhigh" },
        { id: "max", name: "Max" },
      ],
    },
    fast: true,
  })
  assert.equal(Object.isFrozen(catalog), true)
  assert.equal(Object.isFrozen(sol), true)
  assert.equal(Object.isFrozen(sol.inputModalities), true)
  assert.equal(Object.isFrozen(sol.reasoning), true)
  assert.equal(Object.isFrozen(sol.reasoning.efforts), true)
  assert.equal(Object.isFrozen(sol.reasoning.efforts[0]), true)
})

test("projects only client-safe catalog fields and never infers controls for unknown models", () => {
  const descriptor = codexModelCapabilityDescriptor({
    id: "gpt-future",
    name: "GPT Future",
    contextWindow: 400_000,
    maxTokens: 100_000,
    input: ["text", "audio", "image", "text"],
    reasoning: true,
    thinkingLevelMap: { ultra: "ultra" },
    fast: true,
    apiKey: "secret",
    baseUrl: "https://user:secret@example.test",
    headers: { authorization: "Bearer secret" },
    cost: { input: 1 },
    compat: { privatePreview: true },
  })

  assert.deepEqual(descriptor, {
    id: "gpt-future",
    name: "GPT Future",
    contextWindow: 400_000,
    maxTokens: 100_000,
    inputModalities: ["text", "image"],
  })
  assert.equal(JSON.stringify(descriptor).includes("secret"), false)
  assert.equal("reasoning" in descriptor, false)
  assert.equal("fast" in descriptor, false)
})

test("omits malformed optional catalog fields and rejects an unusable identity", () => {
  assert.deepEqual(codexModelCapabilityDescriptor({
    id: "gpt-future",
    name: "",
    contextWindow: 0,
    maxTokens: 1.5,
    input: "text",
  }), { id: "gpt-future" })
  assert.throws(
    () => codexModelCapabilityDescriptor(null),
    /model must be an object/u,
  )
  assert.throws(
    () => codexModelCapabilityDescriptor({ id: " " }),
    /model.id must be a non-empty string/u,
  )
  assert.throws(
    () => codexModelCapabilityCatalog({}),
    /models must be an array/u,
  )
})
