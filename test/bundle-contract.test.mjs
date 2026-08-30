import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot"

test("bundle preserves the base pi-ai row and inserts one independent Codex row", () => {
  const basePiAi = {
    id: "llm-pi-ai",
    name: "@deepseek-ai/dsh-llm-pi-ai",
    config: {
      providers: {
        anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      },
    },
  }
  const baseLayer = [{
    insert: [{
      ...basePiAi,
    }],
  }]
  const pluginLayer = loadOverlayPatches(
    "dsh-codex-community test",
    fileURLToPath(new URL("../codex-community.patch.yml", import.meta.url)),
  )
  const warnings = []
  const entries = composeEntries([baseLayer, pluginLayer], (warning) => warnings.push(warning))
  const piAiRows = entries.filter((entry) => entry.id === "llm-pi-ai")
  const authorizationRows = entries.filter((entry) => entry.id === "authorization")
  const resilienceRows = entries.filter((entry) => entry.id === "dsh-codex")

  assert.deepEqual(warnings, [])
  assert.equal(piAiRows.length, 1)
  assert.deepEqual(piAiRows[0], basePiAi)
  assert.notEqual(piAiRows[0].disabled, true)
  assert.equal(authorizationRows.length, 1)
  assert.equal(authorizationRows[0].name, "@deepseek-ai/dsh-authorization")
  assert.equal(resilienceRows.length, 1)

  assert.deepEqual(resilienceRows[0].config, {
    defaultFast: false,
    defaultTransport: "auto",
    defaultTextVerbosity: "low",
    defaultReasoningSummary: "auto",
    partialResponseRecovery: true,
    cacheRetention: "short",
    streamIdleTimeoutMs: 300_000,
    maxRequestImageBytes: 20_971_520,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
  })
})
