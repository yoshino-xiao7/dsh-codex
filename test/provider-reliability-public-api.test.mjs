import assert from "node:assert/strict"
import test from "node:test"

import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm"
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai"

import {
  Config,
  createCodexProfile,
} from "../src/internal/codex-provider-runtime.mjs"
import { CODEX_PROVIDER_ID } from "../src/internal/codex-credential-store.mjs"
import { createCodexPiProvider } from "../src/internal/codex-pi-provider.mjs"
import {
  CODEX_ROUTE_ID,
  CodexRouteAdapter,
} from "../src/internal/codex-route-adapter.mjs"
import { stabilizeCodexStream } from "../src/internal/stream-resilience.mjs"

test("public pi-ai chain keeps a generalized 429 with discarded body/code unconfirmed", async () => {
  const token = fakeAccessToken()
  const credential = {
    type: "oauth",
    access: token,
    refresh: "refresh-probe",
    expires: Date.now() + 60_000,
  }
  const provider = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, transport: "sse" }),
  })
  const profile = createCodexProfile(Config({}), provider)
  const profiles = new Map([[CODEX_PROVIDER_ID, profile]])
  const canonical = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => undefined,
    auth: {
      credentials: memoryCredentials(credential),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const adapter = new CodexRouteAdapter(canonical)
  const quotaObservations = []
  const model = provider.getModels().find(({ id }) => id === "gpt-5.4")
    ?? provider.getModels()[0]
  const options = {
    provider: CODEX_ROUTE_ID,
    model: model.id,
    sessionId: "session-public-429",
    messages: [createUserMessage({
      content: [{ type: "text", text: "probe" }],
      source: { kind: "user" },
    })],
  }
  const previousFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({
      error: { code: "rate_limit_exceeded", message: "temporary rate limit" },
    }), {
      status: 429,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const chunks = await collect(stabilizeCodexStream(
      options,
      () => adapter.stream(options),
      { onQuota: (detail) => quotaObservations.push(detail) },
    ))

    assert.equal(requests, 1)
    assert.equal(chunks.at(-1).reason.kind, "error")
    assert.equal(chunks.at(-1).reason.failure.code, "QUOTA_OR_RATE_LIMIT")
    assert.equal(chunks.at(-1).reason.failure.status, undefined)
    assert.equal(chunks.at(-1).reason.failure.requestId, undefined)
    assert.deepEqual(quotaObservations, [])
    assert.match(chunks.at(-1).reason.failure.message, /structured evidence is unavailable/iu)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("public PiAiAdapter carries structured AccountQuotaExceeded into a sanitized quota observation", async () => {
  const provider = createCodexPiProvider({
    resolveSessionPreferences: () => ({ fast: false, transport: "sse" }),
  })
  const { adapter, options } = publicChain(provider, "session-public-account-quota-429")
  const quotaObservations = []
  const requestId = "req_public_account_quota_fixture"
  const resetAt = Math.floor((Date.now() + 60 * 60_000) / 1_000) * 1_000
  const resetLocal = new Date(resetAt + 8 * 60 * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ")
  const resetText = `${resetLocal} +0800 CST`
  const previousFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({
      code: "AccountQuotaExceeded",
      message: `You have exceeded the 5-hour usage quota. It will reset at ${resetText}. We recommend upgrading your plan for more quota, or waiting for the reset. Request id: ${requestId}`,
      param: "",
      type: "TooManyRequests",
    }), {
      status: 429,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const chunks = await collect(stabilizeCodexStream(
      options,
      () => adapter.stream(options),
      { onQuota: (detail) => quotaObservations.push(detail) },
    ))
    const failure = chunks.at(-1).reason.failure

    assert.equal(requests, 1)
    assert.equal(chunks.at(-1).reason.kind, "error")
    assert.equal(failure.code, "QUOTA")
    assert.equal(failure.status, 429)
    assert.equal(failure.requestId, requestId)
    assert.match(failure.message, /automatic retry stopped/iu)
    assert.ok(failure.message.includes(`${resetLocal} UTC+08:00`))
    assert.deepEqual(Object.keys(failure).sort(), ["code", "message", "requestId", "status"])
    assert.deepEqual(quotaObservations, [{
      provider: CODEX_ROUTE_ID,
      model: options.model,
      resetAt,
    }])
    assert.doesNotMatch(
      JSON.stringify({ failure, quotaObservations }),
      /AccountQuotaExceeded|TooManyRequests|upgrade your plan/iu,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("public PiAiAdapter STREAM_CLOSED preserves partial text without replay", async () => {
  let providerCalls = 0
  const provider = providerWithStream(() => {
    providerCalls += 1
    return piEvents([
      { type: "text_start", contentIndex: 0, partial: {} },
      {
        type: "text_delta",
        contentIndex: 0,
        delta: "public partial text",
        partial: {},
      },
    ])
  })
  const { adapter, options } = publicChain(provider, "session-public-stream-closed")

  const chunks = await collect(stabilizeCodexStream(
    options,
    () => adapter.stream(options),
  ))

  assert.equal(providerCalls, 1)
  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.block.text === "public partial text"
  )), true)
})

test("public PiAiAdapter WebSocket error is normalized without its close reason", async () => {
  const secret = "secret-public-close-fixture"
  const provider = providerWithStream(() => piEvents([{
    type: "error",
    reason: "error",
    error: piErrorMessage(`WebSocket closed 1006 ${secret}`),
  }]))
  const { adapter, options } = publicChain(provider, "session-public-ws-error")

  const chunks = await collect(stabilizeCodexStream(
    options,
    () => adapter.stream(options),
  ))
  const terminal = chunks.at(-1)

  assert.equal(terminal.reason.kind, "error")
  assert.equal(terminal.reason.failure.code, "TRANSPORT")
  assert.doesNotMatch(JSON.stringify(terminal.reason.failure), new RegExp(secret, "u"))
})

test("public PiAiAdapter sends a positive maxPixels budget through the attachment seam", async () => {
  const baseProvider = createCodexPiProvider()
  const model = baseProvider.getModels().find(({ input }) => input?.includes("image"))
  assert.ok(model, "the published Codex catalog must include an image-capable model")

  let providerContext
  const provider = Object.freeze({
    ...baseProvider,
    streamSimple(_model, context) {
      providerContext = context
      return piEvents([{ type: "done", message: piMessage(model.id) }])
    },
  })
  const profile = createCodexProfile(Config({}), provider)
  const attachment = Object.freeze({
    attachmentId: `sha256:${"a".repeat(64)}`,
    mediaType: "image/png",
    bytes: 68,
    width: 1,
    height: 1,
  })
  const policies = []
  const attachments = {
    async readImageRequest(reference, policy, signal) {
      assert.deepEqual(reference, attachment)
      assert.equal(signal?.aborted, false)
      policies.push({ ...policy })
      return {
        attachment: reference,
        data: Uint8Array.from([137, 80, 78, 71]),
        mediaType: "image/png",
        bytes: 4,
        width: 1,
        height: 1,
      }
    },
  }
  const canonical = new PiAiAdapter({
    profiles: () => new Map([[CODEX_PROVIDER_ID, profile]]),
    resolveApiKey: async () => undefined,
    resolveAttachments: () => attachments,
    auth: {
      credentials: memoryCredentials({
        type: "oauth",
        access: fakeAccessToken(),
        refresh: "refresh-probe",
        expires: Date.now() + 60_000,
      }),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const adapter = new CodexRouteAdapter(canonical)
  const options = {
    provider: CODEX_ROUTE_ID,
    model: model.id,
    sessionId: "session-public-image-policy",
    signal: new AbortController().signal,
    messages: [createUserMessage({
      content: [
        { type: "text", text: "describe the image" },
        { type: "image", attachment },
      ],
      source: { kind: "user" },
    })],
  }

  const chunks = await collect(adapter.stream(options))

  assert.deepEqual(policies, [{ maxPixels: 4_194_304, maxBytes: 1_048_576 }])
  assert.equal(Number.isSafeInteger(policies[0].maxPixels), true)
  assert.equal(policies[0].maxPixels > 0, true)
  assert.equal(providerContext.messages[0].content.some(({ type }) => type === "image"), true)
  assert.equal(chunks.at(-1).reason.kind, "stop")
})

test("read_image tool replay projects the image budget into the next provider request", async () => {
  const baseProvider = createCodexPiProvider()
  const model = baseProvider.getModels().find(({ input }) => input?.includes("image"))
  assert.ok(model, "the published Codex catalog must include an image-capable model")

  let providerCalls = 0
  let replayContext
  const provider = Object.freeze({
    ...baseProvider,
    streamSimple(selectedModel, context) {
      providerCalls += 1
      if (providerCalls === 1) {
        assert.equal(context.tools.length, 1)
        assert.equal(context.tools[0].name, "read_image")
        const toolCall = {
          type: "toolCall",
          id: "call-public-image-replay",
          name: "read_image",
          arguments: { file_path: "https://images.example.net/pixel.png" },
          thoughtSignature: "image-tool-thought-signature-fixture",
        }
        return piEvents([
          {
            type: "toolcall_start",
            contentIndex: 0,
            partial: { content: [toolCall] },
          },
          {
            type: "toolcall_delta",
            contentIndex: 0,
            delta: '{"file_path":"https://images.example.net/pixel.png"}',
            partial: { content: [toolCall] },
          },
          {
            type: "toolcall_end",
            contentIndex: 0,
            toolCall,
            partial: { content: [toolCall] },
          },
          {
            type: "done",
            message: piMessage(selectedModel.id, {
              content: [toolCall],
              stopReason: "toolUse",
              responseId: "response-image-tool-fixture",
            }),
          },
        ])
      }

      replayContext = context
      return piEvents([{
        type: "done",
        message: piMessage(selectedModel.id, {
          responseId: "response-after-image-tool-fixture",
        }),
      }])
    },
  })
  const attachment = Object.freeze({
    attachmentId: `sha256:${"c".repeat(64)}`,
    mediaType: "image/png",
    bytes: 68,
    width: 1,
    height: 1,
  })
  const policies = []
  const canonical = new PiAiAdapter({
    profiles: () => new Map([[
      CODEX_PROVIDER_ID,
      createCodexProfile(Config({}), provider),
    ]]),
    resolveApiKey: async () => undefined,
    resolveAttachments: () => ({
      async readImageRequest(reference, policy, signal) {
        assert.deepEqual(reference, attachment)
        assert.equal(signal?.aborted, false)
        policies.push({ ...policy })
        return {
          attachment: reference,
          data: Uint8Array.from([137, 80, 78, 71]),
          mediaType: "image/png",
          bytes: 4,
          width: 1,
          height: 1,
        }
      },
    }),
    auth: {
      credentials: memoryCredentials({
        type: "oauth",
        access: fakeAccessToken(),
        refresh: "refresh-probe",
        expires: Date.now() + 60_000,
      }),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const adapter = new CodexRouteAdapter(canonical)
  const options = {
    provider: CODEX_ROUTE_ID,
    model: model.id,
    sessionId: "session-public-image-tool-replay",
    signal: new AbortController().signal,
    messages: [createUserMessage({
      content: [{ type: "text", text: "read the remote image" }],
      source: { kind: "user" },
    })],
    tools: [{
      name: "read_image",
      description: "Read one image",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" } },
        required: ["file_path"],
        additionalProperties: false,
      },
    }],
  }

  const first = await collect(adapter.stream(options))
  const toolEnd = first.find((chunk) => (
    chunk.type === "block-end" && chunk.block.type === "tool-call"
  ))
  const firstTerminal = first.at(-1)
  assert.equal(firstTerminal.reason.kind, "tool-calls")
  assert.ok(toolEnd)

  const assistant = createAssistantMessage({
    content: [toolEnd.block],
    source: {
      provider: CODEX_ROUTE_ID,
      model: options.model,
      replayState: firstTerminal.replayState,
    },
  })
  const result = createToolResultMessage({
    callId: toolEnd.block.id,
    content: [
      { type: "text", text: "<path>https://images.example.net/pixel.png</path>" },
      { type: "image", attachment },
    ],
    isError: false,
  })
  const second = await collect(adapter.stream({
    ...options,
    messages: [...options.messages, assistant, result],
  }))

  assert.equal(providerCalls, 2)
  assert.deepEqual(policies, [{ maxPixels: 4_194_304, maxBytes: 1_048_576 }])
  const replayedResult = replayContext.messages.find(({ role }) => role === "toolResult")
  assert.equal(replayedResult.toolCallId, "call-public-image-replay")
  assert.equal(replayedResult.toolName, "read_image")
  assert.equal(replayedResult.content.some((block) => (
    block.type === "image"
    && block.mimeType === "image/png"
    && block.data === "iVBORw=="
  )), true)
  assert.equal(second.at(-1).reason.kind, "stop")
})

test("public PiAiAdapter rejects an image for a text-only model before attachment or provider I/O", async () => {
  let providerCalls = 0
  let attachmentReads = 0
  const provider = providerWithStream(() => {
    providerCalls += 1
    return piEvents([])
  })
  const model = provider.getModels().find(({ input }) => !input?.includes("image"))
  assert.ok(model, "the published Codex catalog must include a text-only model fixture")
  const profile = createCodexProfile(Config({}), provider)
  const canonical = new PiAiAdapter({
    profiles: () => new Map([[CODEX_PROVIDER_ID, profile]]),
    resolveApiKey: async () => undefined,
    resolveAttachments: () => ({
      async readImageRequest() {
        attachmentReads += 1
        throw new Error("text-only routing must reject before reading an attachment")
      },
    }),
    auth: {
      credentials: memoryCredentials({
        type: "oauth",
        access: fakeAccessToken(),
        refresh: "refresh-probe",
        expires: Date.now() + 60_000,
      }),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const adapter = new CodexRouteAdapter(canonical)
  const attachment = {
    attachmentId: `sha256:${"b".repeat(64)}`,
    mediaType: "image/png",
    bytes: 68,
    width: 1,
    height: 1,
  }
  const options = {
    provider: CODEX_ROUTE_ID,
    model: model.id,
    messages: [createUserMessage({
      content: [{ type: "image", attachment }],
      source: { kind: "user" },
    })],
  }

  await assert.rejects(
    collect(adapter.stream(options)),
    (error) => error?.code === "UNSUPPORTED_CONTENT" && /does not support image input/u.test(error.message),
  )
  assert.equal(attachmentReads, 0)
  assert.equal(providerCalls, 0)
})

test("public adapter success preserves text, reasoning, terminal usage, and replay metadata", async () => {
  let selectedModel
  const provider = providerWithStream((model) => {
    selectedModel = model.id
    const message = piMessage(model.id, {
      content: [
        {
          type: "thinking",
          thinking: "reasoning fixture",
          thinkingSignature: "reasoning-signature-fixture",
          redacted: false,
        },
        {
          type: "text",
          text: "answer fixture",
          textSignature: "text-signature-fixture",
        },
      ],
      responseId: "response-success-fixture",
      usage: {
        input: 17,
        output: 9,
        cacheRead: 2,
        cacheWrite: 1,
        totalTokens: 26,
      },
    })
    return piEvents([
      { type: "thinking_start", contentIndex: 0, partial: {} },
      { type: "thinking_delta", contentIndex: 0, delta: "reasoning fixture", partial: {} },
      { type: "thinking_end", contentIndex: 0, content: "reasoning fixture", partial: {} },
      { type: "text_start", contentIndex: 1, partial: {} },
      { type: "text_delta", contentIndex: 1, delta: "answer fixture", partial: {} },
      { type: "text_end", contentIndex: 1, content: "answer fixture", partial: {} },
      { type: "done", message },
    ])
  })
  const { adapter, options } = publicChain(provider, "session-public-success")
  const successes = []

  const chunks = await collect(stabilizeCodexStream(
    options,
    () => adapter.stream(options),
    { onSuccess: (detail) => successes.push(detail) },
  ))

  assert.equal(chunks.some((chunk) => (
    chunk.type === "reasoning-delta" && chunk.text === "reasoning fixture"
  )), true)
  assert.equal(chunks.some((chunk) => (
    chunk.type === "text-delta" && chunk.text === "answer fixture"
  )), true)
  assert.deepEqual(chunks.find(({ type }) => type === "usage"), {
    type: "usage",
    usage: {
      inputTokens: 17,
      outputTokens: 9,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    },
  })
  const terminal = chunks.at(-1)
  assert.equal(terminal.reason.kind, "stop")
  assert.equal(terminal.replayState.response.provider, CODEX_PROVIDER_ID)
  assert.equal(terminal.replayState.response.model, selectedModel)
  assert.equal(terminal.replayState.response.responseId, "response-success-fixture")
  assert.deepEqual(terminal.replayState.blocks, [
    {
      type: "reasoning",
      thinkingSignature: "reasoning-signature-fixture",
      redacted: false,
    },
    { type: "text", textSignature: "text-signature-fixture" },
  ])
  assert.deepEqual(successes, [{ provider: CODEX_ROUTE_ID, model: selectedModel }])
})

test("public adapter closes a tool-call and replay round trip through real PiAiAdapter", async () => {
  let calls = 0
  let secondContext
  const provider = providerWithStream((model, context) => {
    calls += 1
    if (calls === 1) {
      assert.equal(context.tools.length, 1)
      assert.equal(context.tools[0].name, "read_file")
      const toolCall = {
        type: "toolCall",
        id: "call-public-replay",
        name: "read_file",
        arguments: { path: "README.md" },
        thoughtSignature: "tool-thought-signature-fixture",
      }
      return piEvents([
        {
          type: "toolcall_start",
          contentIndex: 0,
          partial: { content: [toolCall] },
        },
        {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: '{"path":"README.md"}',
          partial: { content: [toolCall] },
        },
        { type: "toolcall_end", contentIndex: 0, toolCall, partial: { content: [toolCall] } },
        {
          type: "done",
          message: piMessage(model.id, {
            content: [toolCall],
            stopReason: "toolUse",
            responseId: "response-tool-fixture",
          }),
        },
      ])
    }

    secondContext = context
    return piEvents([
      { type: "text_start", contentIndex: 0, partial: {} },
      { type: "text_delta", contentIndex: 0, delta: "tool result accepted", partial: {} },
      { type: "text_end", contentIndex: 0, content: "tool result accepted", partial: {} },
      {
        type: "done",
        message: piMessage(model.id, {
          content: [{ type: "text", text: "tool result accepted" }],
          responseId: "response-after-tool-fixture",
        }),
      },
    ])
  })
  const { adapter, options } = publicChain(provider, "session-public-tool-replay")
  options.tools = [{
    name: "read_file",
    description: "Read one file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  }]

  const first = await collect(adapter.stream(options))
  const toolEnd = first.find((chunk) => (
    chunk.type === "block-end" && chunk.block.type === "tool-call"
  ))
  const firstTerminal = first.at(-1)
  assert.equal(firstTerminal.reason.kind, "tool-calls")
  assert.deepEqual(toolEnd.block, {
    type: "tool-call",
    id: "call-public-replay",
    name: "read_file",
    arguments: '{"path":"README.md"}',
  })
  assert.deepEqual(firstTerminal.replayState.blocks, [{
    type: "tool-call",
    thoughtSignature: "tool-thought-signature-fixture",
  }])

  const assistant = createAssistantMessage({
    content: [toolEnd.block],
    source: {
      provider: CODEX_ROUTE_ID,
      model: options.model,
      replayState: firstTerminal.replayState,
    },
  })
  const result = createToolResultMessage({
    callId: toolEnd.block.id,
    content: [{ type: "text", text: "README contents fixture" }],
    isError: false,
  })
  const secondOptions = {
    ...options,
    messages: [
      ...options.messages,
      assistant,
      result,
      createUserMessage({
        content: [{ type: "text", text: "continue" }],
        source: { kind: "user" },
      }),
    ],
  }
  const second = await collect(adapter.stream(secondOptions))

  assert.equal(calls, 2)
  const replayed = secondContext.messages.find(({ role }) => role === "assistant")
  assert.equal(replayed.provider, CODEX_PROVIDER_ID)
  assert.equal(replayed.responseId, "response-tool-fixture")
  assert.equal(replayed.content[0].thoughtSignature, "tool-thought-signature-fixture")
  const replayedResult = secondContext.messages.find(({ role }) => role === "toolResult")
  assert.equal(replayedResult.toolCallId, "call-public-replay")
  assert.equal(replayedResult.toolName, "read_file")
  assert.equal(second.some((chunk) => (
    chunk.type === "text-delta" && chunk.text === "tool result accepted"
  )), true)
  assert.equal(second.at(-1).reason.kind, "stop")
})

function fakeAccessToken() {
  const claims = {
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-probe" },
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `e30.${payload}.probe`
}

function memoryCredentials(credential) {
  return {
    read: async () => credential,
    list: async () => [{ providerId: CODEX_PROVIDER_ID, type: "oauth" }],
    modify: async (_provider, mutate) => (await mutate(credential)) ?? credential,
    delete: async () => undefined,
  }
}

function providerWithStream(streamSimple) {
  return Object.freeze({
    ...createCodexPiProvider(),
    streamSimple,
  })
}

function publicChain(provider, sessionId) {
  const credential = {
    type: "oauth",
    access: fakeAccessToken(),
    refresh: "refresh-probe",
    expires: Date.now() + 60_000,
  }
  const profile = createCodexProfile(Config({}), provider)
  const canonical = new PiAiAdapter({
    profiles: () => new Map([[CODEX_PROVIDER_ID, profile]]),
    resolveApiKey: async () => undefined,
    auth: {
      credentials: memoryCredentials(credential),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  const adapter = new CodexRouteAdapter(canonical)
  const model = provider.getModels().find(({ id }) => id === "gpt-5.4")
    ?? provider.getModels()[0]
  return {
    adapter,
    options: {
      provider: CODEX_ROUTE_ID,
      model: model.id,
      sessionId,
      messages: [createUserMessage({
        content: [{ type: "text", text: "probe" }],
        source: { kind: "user" },
      })],
    },
  }
}

async function* piEvents(events) {
  yield* events
}

function piErrorMessage(message) {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider: CODEX_PROVIDER_ID,
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: 1,
  }
}

function piMessage(model, options = {}) {
  const usage = options.usage ?? {}
  return {
    role: "assistant",
    content: options.content ?? [{ type: "text", text: "ok" }],
    api: "openai-codex-responses",
    provider: CODEX_PROVIDER_ID,
    model,
    ...(options.responseId === undefined ? {} : { responseId: options.responseId }),
    usage: {
      input: usage.input ?? 1,
      output: usage.output ?? 1,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: usage.totalTokens ?? 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options.stopReason ?? "stop",
    timestamp: 1,
  }
}

async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}
