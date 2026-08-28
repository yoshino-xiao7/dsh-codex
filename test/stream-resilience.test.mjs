import assert from "node:assert/strict"
import test from "node:test"

import { CODEX_ROUTE_ID } from "../src/internal/codex-route-adapter.mjs"
import { stabilizeCodexStream } from "../src/internal/stream-resilience.mjs"

const quotaMessage = "OpenAI API error (429): {\"code\":\"AccountQuotaExceeded\",\"message\":\"You have exceeded the 5-hour usage quota. It will reset at 2026-08-27 16:44:34 +0800 CST. Request id: req_quota\"}"

async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}

function stream(chunks) {
  return async function* fixture() {
    yield* chunks
  }
}

function failingStream(chunks, failure) {
  return async function* fixture() {
    yield* chunks
    throw failure
  }
}

test("preserves safe partial Codex text and terminates without replay", async () => {
  let calls = 0
  const recoveries = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => {
      calls += 1
      return stream([
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "已经生成的内容" },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 4 } },
        {
          type: "finish",
          reason: { kind: "error", failure: { code: "RATE_LIMIT", message: quotaMessage } },
        },
      ])()
    },
    { onRecovery: (detail) => recoveries.push(detail) },
  ))

  assert.equal(calls, 1)
  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.equal(chunks.filter((chunk) => chunk.type === "usage").length, 1)
  assert.equal(chunks.some((chunk) => chunk.type === "block-end" && chunk.index === 0), true)
  assert.equal(
    chunks.some((chunk) => chunk.type === "text-delta" && /配额已耗尽/u.test(chunk.text)),
    true,
  )
  assert.deepEqual(recoveries, [{
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    code: "QUOTA",
    requestId: "req_quota",
  }])
})

test("maps pre-output account quota to QUOTA so retry policy stops", async () => {
  const observations = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "usage", usage: { inputTokens: 0, outputTokens: 0 } },
      {
        type: "finish",
        reason: { kind: "error", failure: { code: "RATE_LIMIT", message: quotaMessage } },
      },
    ])(),
    { onQuota: (detail) => observations.push(detail) },
  ))

  assert.equal(chunks.at(-1).reason.kind, "error")
  assert.equal(chunks.at(-1).reason.failure.code, "QUOTA")
  assert.equal(chunks.at(-1).reason.failure.requestId, "req_quota")
  assert.deepEqual(observations, [{
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    resetAt: Date.parse("2026-08-27T08:44:34.000Z"),
  }])
})

test("preserves partial text for ambiguous pi-ai 429 without claiming quota", async () => {
  const quotaObservations = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "partial answer" },
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: {
            code: "PI_AI_ERROR",
            message: "You have hit your ChatGPT usage limit.",
          },
        },
      },
    ])(),
    { onQuota: (detail) => quotaObservations.push(detail) },
  ))

  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.deepEqual(quotaObservations, [])
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.index === 0
    && chunk.block.text === "partial answer"
  )), true)
})

test("reports a completed Codex request without letting observation failures break the stream", async () => {
  let observed
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([{ type: "finish", reason: { kind: "stop" } }])(),
    {
      onSuccess: (detail) => {
        observed = detail
        throw new Error("fixture observer failed")
      },
    },
  ))

  assert.deepEqual(observed, {
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
  })
  assert.deepEqual(chunks, [{ type: "finish", reason: { kind: "stop" } }])
})

test("preserves a recovered Codex reply when the recovery observer throws", async () => {
  let observed
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "partial reply" },
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "TRANSPORT", message: "connection closed" },
        },
      },
    ])(),
    {
      onRecovery: (detail) => {
        observed = detail
        throw new Error("fixture observer failed")
      },
    },
  ))

  assert.deepEqual(observed, {
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    code: "TRANSPORT",
    requestId: undefined,
  })
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.index === 0
    && chunk.block.text === "partial reply"
  )), true)
  assert.equal(chunks.some((chunk) => (
    chunk.type === "text-delta"
    && /回复流在完成前中断/u.test(chunk.text)
  )), true)
  assert.deepEqual(chunks.at(-1), { type: "finish", reason: { kind: "stop" } })
})

test("does not report an aborted Codex request as successful", async () => {
  const observations = []
  const aborted = {
    type: "finish",
    reason: {
      kind: "aborted",
      failure: { code: "ABORTED", message: "request cancelled" },
    },
  }
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([aborted])(),
    { onSuccess: (detail) => observations.push(detail) },
  ))

  assert.deepEqual(observations, [])
  assert.deepEqual(chunks, [aborted])
})

test("keeps a pre-output transient 429 retryable", async () => {
  const failure = {
    code: "RATE_LIMIT",
    status: 429,
    providerRetryAfterMs: 500,
    message: "HTTP 429 rate limit; retry later",
  }
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([{ type: "finish", reason: { kind: "error", failure } }])(),
  ))

  assert.equal(chunks.at(-1).reason.failure, failure)
})

test("maps a Codex EOF before output to retryable TRANSPORT", async () => {
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([])(),
  ))

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].type, "finish")
  assert.equal(chunks[0].reason.kind, "error")
  assert.equal(chunks[0].reason.failure.code, "TRANSPORT")
  assert.match(chunks[0].reason.failure.message, /ended before a terminal finish/iu)
})

test("recovers safe partial text when the Codex stream ends without finish", async () => {
  const recoveries = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "truncated text" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2 } },
    ])(),
    { onRecovery: (detail) => recoveries.push(detail) },
  ))

  assert.equal(chunks.at(-1).type, "finish")
  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.equal(chunks.filter((chunk) => chunk.type === "finish").length, 1)
  assert.equal(chunks.filter((chunk) => chunk.type === "usage").length, 1)
  assert.equal(chunks.some((chunk) => chunk.type === "block-end" && chunk.index === 0), true)
  assert.deepEqual(recoveries, [{
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    code: "TRANSPORT",
    requestId: undefined,
  }])
})

test("preserves safe partial text for public pi-ai WebSocket close failures", async () => {
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "reply before close" },
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "PI_AI_ERROR", message: "WebSocket closed 1006" },
        },
      },
    ])(),
  ))

  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.index === 0
    && chunk.block.text === "reply before close"
  )), true)
  assert.equal(chunks.some((chunk) => (
    chunk.type === "text-delta"
    && /回复流在完成前中断/u.test(chunk.text)
  )), true)
})

test("converts a thrown public STREAM_CLOSED into retryable pre-output transport", async () => {
  const failure = Object.assign(
    new Error("pi-ai event stream ended without done/error"),
    { code: "STREAM_CLOSED" },
  )
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([], failure)(),
  ))

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.kind, "error")
  assert.equal(chunks[0].reason.failure.code, "TRANSPORT")
})

test("preserves safe partial text when public STREAM_CLOSED is thrown", async () => {
  const failure = Object.assign(
    new Error("pi-ai event stream ended without done/error"),
    { code: "STREAM_CLOSED" },
  )
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "text before thrown EOF" },
    ], failure)(),
  ))

  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.index === 0
    && chunk.block.text === "text before thrown EOF"
  )), true)
})

test("normalizes a directly thrown account quota before output", async () => {
  const failure = Object.assign(new Error(quotaMessage), { code: "RATE_LIMIT" })
  const observations = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([], failure)(),
    { onQuota: (detail) => observations.push(detail) },
  ))

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.kind, "error")
  assert.equal(chunks[0].reason.failure.code, "QUOTA")
  assert.doesNotMatch(JSON.stringify(chunks[0]), /AccountQuotaExceeded/u)
  assert.deepEqual(observations, [{
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    resetAt: Date.parse("2026-08-27T08:44:34.000Z"),
  }])
})

test("preserves safe partial text when account quota is thrown directly", async () => {
  const failure = Object.assign(new Error(quotaMessage), { code: "RATE_LIMIT" })
  const recoveries = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "answer before quota" },
    ], failure)(),
    { onRecovery: (detail) => recoveries.push(detail) },
  ))

  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.index === 0
    && chunk.block.text === "answer before quota"
  )), true)
  assert.equal(chunks.some((chunk) => (
    chunk.type === "text-delta"
    && /配额已耗尽/u.test(chunk.text)
  )), true)
  assert.doesNotMatch(JSON.stringify(chunks), /AccountQuotaExceeded/u)
  assert.deepEqual(recoveries, [{
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    code: "QUOTA",
    requestId: "req_quota",
  }])
})

test("preserves partial text for a directly thrown ambiguous usage limit", async () => {
  const failure = Object.assign(
    new Error("You have hit your ChatGPT usage limit. Try again in ~17 min."),
    { code: "PI_AI_ERROR" },
  )
  const quotaObservations = []
  const recoveries = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "answer before limit" },
    ], failure)(),
    {
      onQuota: (detail) => quotaObservations.push(detail),
      onRecovery: (detail) => recoveries.push(detail),
    },
  ))

  assert.equal(chunks.at(-1).reason.kind, "stop")
  assert.deepEqual(quotaObservations, [])
  assert.equal(chunks.some((chunk) => (
    chunk.type === "block-end"
    && chunk.index === 0
    && chunk.block.text === "answer before limit"
  )), true)
  assert.deepEqual(recoveries, [{
    provider: CODEX_ROUTE_ID,
    model: "gpt-fixture",
    code: "QUOTA_OR_RATE_LIMIT",
    requestId: undefined,
  }])
})

test("fails closed when account quota is thrown after a tool call", async () => {
  const failure = Object.assign(new Error(quotaMessage), { code: "RATE_LIMIT" })
  const recoveries = []
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "preparing tool" },
      { type: "block-end", index: 0, block: { type: "text", text: "preparing tool" } },
      { type: "block-start", index: 1, blockType: "tool-call" },
      { type: "tool-call-delta", index: 1, id: "call_fixture", name: "write", argumentsDelta: "{" },
    ], failure)(),
    { onRecovery: (detail) => recoveries.push(detail) },
  ))

  assert.equal(chunks.at(-1).reason.kind, "error")
  assert.equal(chunks.at(-1).reason.failure.code, "QUOTA")
  assert.deepEqual(recoveries, [])
  assert.doesNotMatch(JSON.stringify(chunks.at(-1)), /AccountQuotaExceeded/u)
})

test("does not intercept unrelated thrown pi-ai failures", async () => {
  const failure = Object.assign(
    new Error("provider rejected an unsupported request option"),
    { code: "PI_AI_ERROR" },
  )

  await assert.rejects(
    collect(stabilizeCodexStream(
      { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
      () => failingStream([], failure)(),
    )),
    (error) => error === failure,
  )
})

test("fails closed after a partial tool call and disables full-request replay", async () => {
  const secret = "provider-secret-fixture"
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "准备调用工具" },
      { type: "block-end", index: 0, block: { type: "text", text: "准备调用工具" } },
      { type: "block-start", index: 1, blockType: "tool-call" },
      { type: "tool-call-delta", index: 1, id: "call_fixture", name: "write", argumentsDelta: "{" },
      {
        type: "finish",
        reason: { kind: "error", failure: { code: "TRANSPORT", message: `connection closed ${secret}` } },
      },
    ])(),
  ))

  assert.equal(chunks.at(-1).reason.kind, "error")
  assert.equal(chunks.at(-1).reason.failure.code, "PARTIAL_RESPONSE")
  assert.doesNotMatch(chunks.at(-1).reason.failure.message, new RegExp(secret, "u"))
})

test("fails closed for a tool-only stream with a retryable terminal failure", async () => {
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => stream([
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "tool-call-delta", index: 0, id: "call_fixture", name: "write", argumentsDelta: "{" },
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "RATE_LIMIT", message: "HTTP 429 rate limit; retry later" },
        },
      },
    ])(),
  ))

  assert.equal(chunks.at(-1).reason.kind, "error")
  assert.equal(chunks.at(-1).reason.failure.code, "PARTIAL_RESPONSE")
})

test("fails closed when transport is thrown from a tool-only stream", async () => {
  const failure = Object.assign(
    new Error("pi-ai event stream ended without done/error"),
    { code: "STREAM_CLOSED" },
  )
  const chunks = await collect(stabilizeCodexStream(
    { provider: CODEX_ROUTE_ID, model: "gpt-fixture" },
    () => failingStream([
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "tool-call-delta", index: 0, id: "call_fixture", name: "write", argumentsDelta: "{" },
    ], failure)(),
  ))

  assert.equal(chunks.at(-1).reason.kind, "error")
  assert.equal(chunks.at(-1).reason.failure.code, "PARTIAL_RESPONSE")
})

test("does not touch another provider stream", async () => {
  const fixture = [
    { type: "finish", reason: { kind: "error", failure: { code: "RATE_LIMIT", message: quotaMessage } } },
  ]
  const chunks = await collect(stabilizeCodexStream(
    { provider: "deepseek-official", model: "deepseek-fixture" },
    () => stream(fixture)(),
  ))

  assert.deepEqual(chunks, fixture)
})
