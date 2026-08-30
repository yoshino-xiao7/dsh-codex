import assert from "node:assert/strict"
import test from "node:test"
import { zstdDecompressSync } from "node:zlib"

import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"
import {
  CODEX_NETWORK_PROBE_SESSION_PREFIX,
} from "../src/internal/codex-network-probe-contract.mjs"
import { codexTransportSessionId } from "../src/internal/codex-session-resources.mjs"

const CONTEXT = Object.freeze({
  systemPrompt: "system",
  messages: Object.freeze([
    Object.freeze({ role: "user", content: "payload probe", timestamp: 1 }),
  ]),
  tools: Object.freeze([]),
})

function fakeAccessToken() {
  const claims = {
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-probe" },
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `e30.${payload}.probe`
}

async function capturePayload(provider, options = {}, modelId = "gpt-5.4") {
  const model = provider.getModels().find((candidate) => candidate.id === modelId)
    ?? provider.getModels()[0]
  let captured
  const stream = provider.streamSimple(model, CONTEXT, {
    apiKey: fakeAccessToken(),
    reasoning: "medium",
    transport: "sse",
    cacheRetention: "short",
    maxTokens: 321,
    ...options,
    onPayload(payload) {
      captured = structuredClone(payload)
      throw new Error("CAPTURE_PAYLOAD_BEFORE_NETWORK")
    },
  })

  for await (const event of stream) {
    if (event.type === "error") break
  }
  assert.notEqual(captured, undefined)
  return captured
}

async function captureNetworkPayload(provider, options = {}, modelId = "gpt-5.4") {
  const model = provider.getModels().find((candidate) => candidate.id === modelId)
    ?? provider.getModels()[0]
  const originalFetch = globalThis.fetch
  let captured
  let fetchCalls = 0
  globalThis.fetch = async (_url, request) => {
    fetchCalls += 1
    const headers = new Headers(request.headers)
    const bytes = Buffer.from(request.body)
    const json = headers.get("content-encoding") === "zstd"
      ? zstdDecompressSync(bytes).toString("utf8")
      : bytes.toString("utf8")
    captured = JSON.parse(json)
    return new Response("capture complete", { status: 400 })
  }

  try {
    const stream = provider.streamSimple(model, CONTEXT, {
      apiKey: fakeAccessToken(),
      transport: "sse",
      maxRetries: 0,
      ...options,
    })
    for await (const event of stream) {
      if (event.type === "error") break
    }
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(fetchCalls, 1)
  assert.notEqual(captured, undefined)
  return captured
}

test("keeps the published Codex provider catalog and OAuth owner", () => {
  const published = openaiCodexProvider()
  const wrapped = createCodexPiProvider()

  assert.equal(wrapped.id, published.id)
  assert.equal(wrapped.name, published.name)
  assert.equal(wrapped.baseUrl, published.baseUrl)
  assert.equal(wrapped.auth.apiKey, published.auth.apiKey)
  assert.equal(wrapped.auth.oauth?.name, published.auth.oauth?.name)
  assert.equal(typeof wrapped.auth.oauth?.login, "function")
  assert.equal(typeof wrapped.auth.oauth?.refresh, "function")
  assert.equal(typeof wrapped.auth.oauth?.toAuth, "function")
  assert.deepEqual(
    wrapped.getModels().map(({ thinkingLevelMap: _thinkingLevelMap, ...model }) => model),
    published.getModels().map(({ thinkingLevelMap: _thinkingLevelMap, ...model }) => model),
  )
  assert.ok(wrapped.getModels().every((model) => model.thinkingLevelMap.off === null))
  assert.ok(wrapped.getModels().every((model) => model.thinkingLevelMap.minimal === null))
})

test("defaults to the published streamSimple payload without a service tier", async () => {
  const published = openaiCodexProvider()
  const wrapped = createCodexPiProvider()

  const expected = await capturePayload(published, {
    sessionId: codexTransportSessionId("session-default"),
  })
  const actual = await capturePayload(wrapped, { sessionId: "session-default" })

  assert.equal(actual.service_tier, undefined)
  assert.deepEqual(actual, expected)
})

test("keeps ordinary request payloads free of the network probe output cap", async () => {
  const wrapped = createCodexPiProvider()
  let onPayloadCalls = 0

  const actual = await captureNetworkPayload(wrapped, {
    sessionId: "session-not-a-network-probe",
    maxTokens: 321,
    onPayload(payload) {
      onPayloadCalls += 1
      return { ...payload, caller_marker: true }
    },
  })

  assert.equal(onPayloadCalls, 1)
  assert.equal(actual.caller_marker, true)
  assert.equal(Object.hasOwn(actual, "max_output_tokens"), false)
})

test("keeps the network probe on the published Codex SDK wire schema", async () => {
  let preferenceReads = 0
  const wrapped = createCodexPiProvider({
    resolveSessionPreferences() {
      preferenceReads += 1
      return {
        fast: true,
        transport: "websocket-cached",
        textVerbosity: "high",
        reasoningSummary: "detailed",
      }
    },
  })
  const actual = await captureNetworkPayload(wrapped, {
    sessionId: `${CODEX_NETWORK_PROBE_SESSION_PREFIX}sdk-schema`,
  })

  assert.equal(preferenceReads, 0)
  assert.equal(actual.service_tier, undefined)
  assert.equal(actual.text?.verbosity, "low")
  assert.equal(actual.reasoning, undefined)
  assert.equal(Object.hasOwn(actual, "max_output_tokens"), false)
  assert.equal(actual.tools === undefined || actual.tools.length === 0, true)
})

test("resolves Fast per session and changes only service_tier", async () => {
  const seen = []
  const published = openaiCodexProvider()
  const wrapped = createCodexPiProvider({
    resolveSessionPreferences(sessionId) {
      seen.push(sessionId)
      return {
        fast: sessionId === "session-fast",
        transport: "sse",
      }
    },
  })

  const expected = await capturePayload(published, {
    sessionId: codexTransportSessionId("session-fast"),
  })
  const actual = await capturePayload(wrapped, { sessionId: "session-fast" })
  const withoutTier = structuredClone(actual)
  delete withoutTier.service_tier

  assert.deepEqual(seen, ["session-fast"])
  assert.equal(actual.service_tier, "priority")
  assert.deepEqual(withoutTier, expected)
})

test("enables Fast only for the officially supported GPT-5.4, GPT-5.5, and GPT-5.6 families", async () => {
  const wrapped = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: true, transport: "sse" }),
  })

  for (const modelId of ["gpt-5.4", "gpt-5.5", "gpt-5.6-sol"]) {
    const payload = await capturePayload(wrapped, {}, modelId)
    assert.equal(payload.service_tier, "priority", modelId)
  }
  for (const modelId of ["gpt-5.3-codex-spark", "gpt-5.4-mini"]) {
    const payload = await capturePayload(wrapped, {}, modelId)
    assert.equal(payload.service_tier, undefined, modelId)
  }
})

test("keeps only verified plain Codex reasoning levels", async () => {
  const wrapped = createCodexPiProvider()

  for (const model of wrapped.getModels()) {
    const levels = getSupportedThinkingLevels(model)
    assert.equal(levels.includes("off"), false, model.id)
    assert.equal(levels.includes("minimal"), false, model.id)
  }

  const max = await capturePayload(wrapped, { reasoning: "max" }, "gpt-5.6-sol")
  assert.equal(max.reasoning?.effort, "max")
})

test("keeps preference lookup on the DSH id and namespaces only pi-ai transport state", async () => {
  const seen = []
  const wrapped = createCodexPiProvider({
    resolveSessionPreferences(sessionId) {
      seen.push(sessionId)
      return { fast: false, transport: "sse" }
    },
  })

  const payload = await capturePayload(wrapped, { sessionId: "session-namespace" })

  assert.deepEqual(seen, ["session-namespace"])
  assert.equal(
    payload.prompt_cache_key,
    codexTransportSessionId("session-namespace"),
  )
})

test("runtime session preferences override a static service tier", async () => {
  const wrapped = createCodexPiProvider({
    serviceTier: "priority",
    resolveSessionPreferences: () => ({ fast: false, transport: "sse" }),
  })

  const payload = await capturePayload(wrapped, { sessionId: "session-standard" })

  assert.equal(payload.service_tier, undefined)
})

test("session transport overrides the stream option before provider dispatch", async () => {
  const published = openaiCodexProvider()
  const wrapped = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, transport: "sse" }),
  })

  const expected = await capturePayload(published, { transport: "sse" })
  const actual = await capturePayload(wrapped, { transport: "unsupported-probe" })

  assert.deepEqual(actual, expected)
})

test("passes session reply verbosity and reasoning summary to the Codex request", async () => {
  const wrapped = createCodexPiProvider({
    resolveSessionPreferences: () => ({
      fast: false,
      transport: "sse",
      textVerbosity: "high",
      reasoningSummary: "detailed",
    }),
  })

  const payload = await capturePayload(wrapped, { sessionId: "session-output-controls" })

  assert.equal(payload.text?.verbosity, "high")
  assert.equal(payload.reasoning?.summary, "detailed")
})

test("supports a static priority tier when no session resolver is installed", async () => {
  const wrapped = createCodexPiProvider({ serviceTier: "priority" })

  const payload = await capturePayload(wrapped)

  assert.equal(payload.service_tier, "priority")
})

test("rejects invalid factory options and session preferences", () => {
  assert.throws(() => createCodexPiProvider(null), /options must be a plain object/u)
  assert.throws(
    () => createCodexPiProvider({ serviceTier: "fast" }),
    /serviceTier must be priority/u,
  )
  assert.throws(
    () => createCodexPiProvider({ resolveSessionPreferences: true }),
    /resolveSessionPreferences must be a function/u,
  )
  assert.throws(
    () => createCodexPiProvider({ resolveTransportSessionId: true }),
    /resolveTransportSessionId must be a function/u,
  )
  assert.throws(
    () => createCodexPiProvider({ acquireTransportSession: true }),
    /acquireTransportSession must be a function/u,
  )
  assert.throws(
    () => createCodexPiProvider({
      acquireTransportSession: () => undefined,
      resolveTransportSessionId: () => undefined,
    }),
    /mutually exclusive/u,
  )

  const invalidResolvedSession = createCodexPiProvider({
    resolveTransportSessionId: () => "",
  })
  assert.throws(
    () => invalidResolvedSession.streamSimple(
      invalidResolvedSession.getModels()[0],
      CONTEXT,
      { sessionId: "session-invalid" },
    ),
    /resolved transport session id must be a non-empty string/u,
  )

  const invalidLease = createCodexPiProvider({
    acquireTransportSession: () => ({ sessionId: "", release() {} }),
  })
  assert.throws(
    () => invalidLease.streamSimple(
      invalidLease.getModels()[0],
      CONTEXT,
      { sessionId: "session-invalid-lease" },
    ),
    /transport lease/u,
  )

  const invalid = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: "yes" }),
  })
  assert.throws(
    () => invalid.streamSimple(invalid.getModels()[0], CONTEXT, {}),
    /session preferences fast must be a boolean/u,
  )

  const invalidTransport = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, transport: "udp" }),
  })
  assert.throws(
    () => invalidTransport.streamSimple(
      invalidTransport.getModels()[0],
      CONTEXT,
      {},
    ),
    /session preferences transport is invalid/u,
  )

  const invalidTextVerbosity = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, textVerbosity: "verbose" }),
  })
  assert.throws(
    () => invalidTextVerbosity.streamSimple(
      invalidTextVerbosity.getModels()[0],
      CONTEXT,
      {},
    ),
    /session preferences textVerbosity is invalid/u,
  )

  const invalidReasoningSummary = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, reasoningSummary: "full" }),
  })
  assert.throws(
    () => invalidReasoningSummary.streamSimple(
      invalidReasoningSummary.getModels()[0],
      CONTEXT,
      {},
    ),
    /session preferences reasoningSummary is invalid/u,
  )
})
