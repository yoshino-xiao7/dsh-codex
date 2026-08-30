import assert from "node:assert/strict"
import test from "node:test"

import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm"

import { CODEX_PROVIDER_ID } from "../src/internal/codex-credential-store.mjs"
import {
  CODEX_ROUTE_ID,
  CodexRouteAdapter,
} from "../src/internal/codex-route-adapter.mjs"

test("same-model replay maps the external history source and keeps canonical state", async () => {
  const delegate = fakeCanonicalAdapter()
  const adapter = new CodexRouteAdapter(delegate)
  const replayState = replay("gpt-5.4", [{ type: "text" }])
  const assistant = createAssistantMessage({
    content: [{ type: "text", text: "first" }],
    source: {
      provider: CODEX_ROUTE_ID,
      model: "gpt-5.4",
      replayState,
    },
  })
  const prepared = await adapter.prepareCall(CODEX_ROUTE_ID, "gpt-5.4")
  const chunks = await collect(prepared.stream(options("gpt-5.4", [assistant])))

  assert.equal(prepared.model.provider, CODEX_ROUTE_ID)
  assert.equal(delegate.calls[0].provider, CODEX_PROVIDER_ID)
  const mapped = delegate.calls[0].messages.find(({ role }) => role === "assistant")
  assert.equal(mapped.source.provider, CODEX_PROVIDER_ID)
  assert.deepEqual(mapped.source.replayState, replayState)
  assert.equal(assistant.source.provider, CODEX_ROUTE_ID)
  assert.deepEqual(chunks.at(-1).replayState, replayState)
})

test("exposes the installed catalog reasoning controls without inventing a default", async () => {
  const delegate = fakeCanonicalAdapter()
  const adapter = new CodexRouteAdapter(delegate)

  const sol = await adapter.resolveModel(CODEX_ROUTE_ID, "gpt-5.6-sol")
  assert.deepEqual(sol.reasoning.efforts.map(({ id }) => id), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ])
  assert.equal(Object.hasOwn(sol.reasoning, "defaultEffort"), false)

  const spark = await adapter.resolveModel(CODEX_ROUTE_ID, "gpt-5.3-codex-spark")
  assert.deepEqual(spark.reasoning.efforts.map(({ id }) => id), [
    "low",
    "medium",
    "high",
    "xhigh",
  ])
  assert.equal(Object.hasOwn(spark.reasoning, "defaultEffort"), false)

  const unknown = await adapter.resolveModel(CODEX_ROUTE_ID, "gpt-future")
  assert.equal(unknown.reasoning, undefined)
})

test("projects every outward model row through the client-safe allowlist", async () => {
  const delegate = fakeCanonicalAdapter()
  const unsafe = {
    apiKey: "must-not-leak",
    baseUrl: "https://user:secret@example.test",
    headers: { authorization: "Bearer must-not-leak" },
    cost: { input: 1 },
  }
  delegate.listModels = async (provider) => [{
    provider,
    id: "gpt-5.4",
    name: "GPT-5.4",
    inputModalities: ["text", "audio", "image"],
    ...unsafe,
  }]
  delegate.resolveModel = async (provider, model) => ({
    provider,
    id: model,
    name: "GPT-5.4",
    inputModalities: ["text", "image"],
    context: { contextWindow: 272_000, internal: "must-not-leak" },
    defaultMaxTokens: 128_000,
    reasoning: { efforts: [{ id: "ultra", name: "Ultra" }] },
    ...unsafe,
  })
  delegate.prepareCall = async (provider, model) => ({
    model: await delegate.resolveModel(provider, model),
    stream: (streamOptions) => delegate.stream(streamOptions),
  })
  const adapter = new CodexRouteAdapter(delegate)

  const [listed] = await adapter.listModels(CODEX_ROUTE_ID)
  const resolved = await adapter.resolveModel(CODEX_ROUTE_ID, "gpt-5.4")
  const prepared = await adapter.prepareCall(CODEX_ROUTE_ID, "gpt-5.4")

  assert.deepEqual(listed, {
    provider: CODEX_ROUTE_ID,
    id: "gpt-5.4",
    name: "GPT-5.4",
    inputModalities: ["text", "image"],
  })
  for (const outward of [listed, resolved, prepared.model]) {
    assert.equal(JSON.stringify(outward).includes("must-not-leak"), false)
    assert.equal("apiKey" in outward, false)
    assert.equal("headers" in outward, false)
    assert.equal(outward.reasoning, undefined)
  }
  assert.deepEqual(resolved.context, { contextWindow: 272_000 })
  assert.equal(resolved.defaultMaxTokens, 128_000)
  assert.deepEqual(prepared.model.context, { contextWindow: 272_000 })
  assert.equal(prepared.model.defaultMaxTokens, 128_000)
})

test("passes verified reasoning levels and rejects hidden or agent-level modes", async () => {
  const delegate = fakeCanonicalAdapter()
  const adapter = new CodexRouteAdapter(delegate)

  const prepared = await adapter.prepareCall(CODEX_ROUTE_ID, "gpt-5.6-sol")
  await collect(adapter.stream({
    ...options("gpt-5.6-sol", []),
    reasoningEffort: "max",
  }))
  assert.equal(delegate.calls.at(-1).reasoningEffort, "max")

  for (const reasoningEffort of ["off", "minimal", "ultra"]) {
    assert.throws(
      () => adapter.stream({
        ...options("gpt-5.6-sol", []),
        reasoningEffort,
      }),
      (error) => error?.code === "UNSUPPORTED_REASONING_EFFORT",
      reasoningEffort,
    )
  }
  assert.throws(
    () => prepared.stream({
      ...options("gpt-5.6-sol", []),
      reasoningEffort: "minimal",
    }),
    (error) => error?.code === "UNSUPPORTED_REASONING_EFFORT",
  )
  assert.throws(
    () => adapter.stream({
      ...options("gpt-5.4", []),
      reasoningEffort: "max",
    }),
    (error) => error?.code === "UNSUPPORTED_REASONING_EFFORT",
  )
  assert.throws(
    () => adapter.stream({
      ...options("gpt-future", []),
      reasoningEffort: "high",
    }),
    (error) => error?.code === "UNSUPPORTED_REASONING_EFFORT",
  )
})

test("cross-model replay preserves the producing model while routing the new model canonically", async () => {
  const delegate = fakeCanonicalAdapter()
  const adapter = new CodexRouteAdapter(delegate)
  const history = createAssistantMessage({
    content: [{ type: "text", text: "older model" }],
    source: {
      provider: CODEX_ROUTE_ID,
      model: "gpt-5.3-codex",
      replayState: replay("gpt-5.3-codex", [{ type: "text" }]),
    },
  })

  await collect(adapter.stream(options("gpt-5.4", [history])))

  assert.equal(delegate.calls[0].provider, CODEX_PROVIDER_ID)
  assert.equal(delegate.calls[0].model, "gpt-5.4")
  const mapped = delegate.calls[0].messages.find(({ role }) => role === "assistant")
  assert.equal(mapped.source.provider, CODEX_PROVIDER_ID)
  assert.equal(mapped.source.model, "gpt-5.3-codex")
})

test("tool replay maps only assistant provenance and preserves call/result correlation", async () => {
  const delegate = fakeCanonicalAdapter()
  const adapter = new CodexRouteAdapter(delegate)
  const callId = CallId("call-1")
  const assistant = createAssistantMessage({
    content: [{
      type: "tool-call",
      id: callId,
      name: "read_file",
      arguments: "{\"path\":\"README.md\"}",
    }],
    source: {
      provider: CODEX_ROUTE_ID,
      model: "gpt-5.4",
      replayState: replay("gpt-5.4", [{
        type: "tool-call",
        thoughtSignature: "signature-fixture",
      }]),
    },
  })
  const result = createToolResultMessage({
    callId,
    content: [{ type: "text", text: "contents" }],
    isError: false,
  })

  await collect(adapter.stream(options("gpt-5.4", [assistant, result])))

  const mappedAssistant = delegate.calls[0].messages.find(
    ({ role }) => role === "assistant",
  )
  const mappedResult = delegate.calls[0].messages.find(
    ({ source }) => source.kind === "tool",
  )
  assert.equal(mappedAssistant.source.provider, CODEX_PROVIDER_ID)
  assert.equal(mappedAssistant.content[0].id, callId)
  assert.equal(mappedResult, result)
  assert.equal(mappedResult.source.callId, callId)
  assert.equal(mappedResult.content[0].toolCallId, callId)
})

function replay(model, blocks) {
  return {
    response: {
      kind: "pi-ai",
      version: 2,
      api: "openai-codex-responses",
      provider: CODEX_PROVIDER_ID,
      model,
      responseId: `response-${model}`,
      stopReason: blocks.some(({ type }) => type === "tool-call")
        ? "toolUse"
        : "stop",
    },
    blocks,
  }
}

function options(model, messages) {
  return {
    provider: CODEX_ROUTE_ID,
    model,
    messages: [
      createUserMessage({
        content: [{ type: "text", text: "prompt" }],
        source: { kind: "user" },
      }),
      ...messages,
    ],
  }
}

function fakeCanonicalAdapter() {
  return {
    calls: [],
    providerInfo(provider) {
      return { id: provider, name: "Codex fixture" }
    },
    providerRetryPolicy() {
      return undefined
    },
    async listModels(provider) {
      return [{ provider, id: "gpt-5.4", name: "GPT-5.4" }]
    },
    async resolveModel(provider, model) {
      const effortIds = model === "gpt-future"
        ? []
        : model.startsWith("gpt-5.6-")
          ? ["low", "medium", "high", "xhigh", "max"]
          : ["low", "medium", "high", "xhigh"]
      return {
        provider,
        id: model,
        name: model,
        ...(effortIds.length === 0
          ? {}
          : {
              reasoning: {
                efforts: effortIds.map((id) => ({
                  id,
                  name: id === "xhigh"
                    ? "Xhigh"
                    : `${id[0].toUpperCase()}${id.slice(1)}`,
                })),
              },
            }),
      }
    },
    async prepareCall(provider, model) {
      return {
        model: await this.resolveModel(provider, model),
        stream: (streamOptions) => this.stream(streamOptions),
      }
    },
    stream(streamOptions) {
      this.calls.push(streamOptions)
      const state = streamOptions.messages.find(
        ({ role }) => role === "assistant",
      )?.source.replayState
      return chunks(state)
    },
  }
}

async function* chunks(replayState) {
  yield {
    type: "finish",
    reason: { kind: "stop" },
    ...(replayState === undefined ? {} : { replayState }),
  }
}

async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}
