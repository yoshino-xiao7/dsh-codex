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
      return { provider, id: model, name: model }
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
