import assert from "node:assert/strict"
import test from "node:test"

import {
  CODEX_MODEL_CAPABILITY_RPC_CHANNEL,
  createCodexModelCapabilityRpcHandler,
  registerCodexModelCapabilityRpc,
} from "../src/internal/codex-model-capability-bridge.mjs"

test("model capability RPC registers on its dedicated loopback-only channel", async () => {
  const registrations = []
  const context = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registrations.push({ channel, handler, options })
        },
      },
    },
  }
  const getModels = () => [{ id: "gpt-future" }]

  const handler = registerCodexModelCapabilityRpc(context, getModels)

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].channel, CODEX_MODEL_CAPABILITY_RPC_CHANNEL)
  assert.equal(registrations[0].handler, handler)
  assert.deepEqual(registrations[0].options, { authority: "loopback" })
  assert.deepEqual(
    await handler("get", {}, new AbortController().signal),
    { ok: true, value: { models: [{ id: "gpt-future" }] } },
  )
})

test("model capability get accepts only an empty plain object", async () => {
  let calls = 0
  const handler = createCodexModelCapabilityRpcHandler(() => {
    calls += 1
    return []
  })
  const signal = new AbortController().signal

  assert.deepEqual(await handler("get", {}, signal), {
    ok: true,
    value: { models: [] },
  })
  assert.deepEqual(await handler("get", Object.create(null), signal), {
    ok: true,
    value: { models: [] },
  })

  const invalid = [
    ["unknown", {}],
    ["get", null],
    ["get", []],
    ["get", { modelId: "gpt-5.6-sol" }],
    ["get", new Date(0)],
    ["get", Object.create({ inherited: true })],
  ]
  for (const [endpoint, payload] of invalid) {
    const result = await handler(endpoint, payload, signal)
    assert.equal(result.ok, false, `${endpoint}: ${String(payload)}`)
    assert.equal(result.error.code, "bad-request")
    assert.deepEqual(result.error.details, { issues: [] })
  }
  assert.equal(calls, 2)
})

test("model capability RPC contains cancellation before and after catalog lookup", async () => {
  const secret = "model-capability-cancel-secret"
  let calls = 0
  const before = new AbortController()
  before.abort(secret)
  const beforeHandler = createCodexModelCapabilityRpcHandler(() => {
    calls += 1
    return []
  })

  const beforeResult = await beforeHandler("get", {}, before.signal)
  assert.deepEqual(beforeResult, {
    ok: false,
    error: { code: "cancelled", message: "Request cancelled", details: {} },
  })
  assert.equal(calls, 0)

  const after = new AbortController()
  const afterHandler = createCodexModelCapabilityRpcHandler(async () => {
    calls += 1
    after.abort(secret)
    return [{ id: "gpt-5.6-sol" }]
  })
  const afterResult = await afterHandler("get", {}, after.signal)
  assert.deepEqual(afterResult, {
    ok: false,
    error: { code: "cancelled", message: "Request cancelled", details: {} },
  })
  assert.equal(calls, 1)
  assert.doesNotMatch(JSON.stringify([beforeResult, afterResult]), new RegExp(secret, "u"))
})

test("model capability RPC sanitizes internal catalog failures", async () => {
  const secret = "model-capability-internal-secret"
  const handler = createCodexModelCapabilityRpcHandler(() => {
    throw new Error(secret)
  })

  const result = await handler("get", {}, new AbortController().signal)

  assert.deepEqual(result, {
    ok: false,
    error: { code: "internal", message: "Model capabilities are unavailable", details: {} },
  })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, "u"))
})

test("model capability RPC exposes verified controls and never infers unknown model controls", async () => {
  const handler = createCodexModelCapabilityRpcHandler(() => [
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      contextWindow: 272_000,
      maxTokens: 128_000,
      input: ["text", "image"],
      reasoning: true,
      thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
      endpoint: "https://sensitive.invalid",
    },
    {
      id: "gpt-future",
      name: "GPT Future",
      contextWindow: 999_000,
      maxTokens: 222_000,
      inputModalities: ["text", "audio"],
      reasoning: true,
      thinkingLevelMap: { ultra: "ultra" },
      fast: true,
    },
  ])

  const result = await handler("get", {}, new AbortController().signal)

  assert.deepEqual(result, {
    ok: true,
    value: {
      models: [
        {
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
        },
        {
          id: "gpt-future",
          name: "GPT Future",
          contextWindow: 999_000,
          maxTokens: 222_000,
          inputModalities: ["text"],
        },
      ],
    },
  })
  assert.equal(Object.hasOwn(result.value.models[1], "reasoning"), false)
  assert.equal(Object.hasOwn(result.value.models[1], "fast"), false)
  assert.equal(JSON.stringify(result).includes("sensitive.invalid"), false)
  assert.equal(JSON.stringify(result).includes("ultra"), false)
})
