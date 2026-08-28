import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { Context } from "@deepseek-ai/cordis"
import LlmRuntime, {
  LlmAdapter,
  createUserMessage,
  resolveRetryPolicy,
} from "@deepseek-ai/dsh-llm"

import { CODEX_ROUTE_ID } from "../src/internal/codex-identifiers.mjs"
import { stabilizeCodexStream } from "../src/internal/stream-resilience.mjs"

const exactQuotaMessage = "OpenAI API error (429): {\"code\":\"AccountQuotaExceeded\",\"message\":\"You have exceeded the 5-hour usage quota.\"}"

const fixtureRequire = createRequire(
  new URL("./fixtures/dsh-runtime/package.json", import.meta.url),
)
const frozenDshRequire = createRequire(
  fixtureRequire.resolve("@deepseek-ai/dsh/package.json"),
)

async function loadFrozenDshPackage(specifier) {
  return import(pathToFileURL(frozenDshRequire.resolve(specifier)).href)
}

const [
  frozenCordis,
  frozenLlm,
  frozenAgent,
  frozenSession,
  frozenSystemPrompt,
  frozenTools,
  frozenAgentLoop,
  frozenLlmRetry,
] = await Promise.all([
  loadFrozenDshPackage("@deepseek-ai/cordis"),
  loadFrozenDshPackage("@deepseek-ai/dsh-llm"),
  loadFrozenDshPackage("@deepseek-ai/dsh-agent"),
  loadFrozenDshPackage("@deepseek-ai/dsh-session"),
  loadFrozenDshPackage("@deepseek-ai/dsh-system-prompt"),
  loadFrozenDshPackage("@deepseek-ai/dsh-tools"),
  loadFrozenDshPackage("@deepseek-ai/dsh-agent-loop"),
  loadFrozenDshPackage("@deepseek-ai/dsh-llm-retry"),
])

class QuotaProbeAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: "Quota probe" }
  }

  providerRetryPolicy() {
    return resolveRetryPolicy({
      mode: "normal",
      maxRetries: 2,
      retryableCodes: ["RATE_LIMIT"],
      backoff: {
        initialDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
      },
    }, "quota probe retry policy")
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async prepareCall(provider, model) {
    return {
      model: await this.resolveModel(provider, model),
      stream: () => this.stream(),
    }
  }

  async *stream() {
    yield {
      type: "finish",
      reason: {
        kind: "error",
        failure: {
          code: "RATE_LIMIT",
          message: exactQuotaMessage,
        },
      },
    }
  }
}

class RetryProbeAdapter extends frozenLlm.LlmAdapter {
  constructor(failures) {
    super()
    this.failures = failures
    this.attempts = 0
  }

  providerInfo(provider) {
    return { id: provider, name: "Retry probe" }
  }

  providerRetryPolicy() {
    return frozenLlm.resolveRetryPolicy({
      mode: "normal",
      maxRetries: 2,
      retryableCodes: ["RATE_LIMIT"],
      backoff: {
        initialDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
      },
    }, "retry probe policy")
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async prepareCall(provider, model) {
    return {
      model: await this.resolveModel(provider, model),
      stream: () => this.stream(),
    }
  }

  async *stream() {
    const failure = this.failures[this.attempts]
    this.attempts += 1

    if (failure) {
      yield {
        type: "finish",
        reason: { kind: "error", failure },
      }
      return
    }

    yield { type: "text-delta", text: "recovered" }
    yield { type: "finish", reason: { kind: "stop" } }
  }
}

async function runFrozenDshRetryProbe(failures) {
  const root = new frozenCordis.Context()
  const errors = []
  root.on("agent/error", ({ error }) => errors.push(error), { global: true })

  try {
    await root.plugin(frozenLlm.default)
    await root.plugin(frozenAgent.default)
    await root.plugin(frozenSession.default)
    await root.plugin(frozenSystemPrompt.default, {})
    await root.plugin(frozenTools.default, { mode: "native" })
    await root.plugin(frozenAgentLoop.default, {
      agents: [],
      maxParallelToolCalls: 1,
    })
    await root.plugin(frozenLlmRetry, {})

    const adapter = new RetryProbeAdapter(failures)
    root.llm.registerAdapter([CODEX_ROUTE_ID], adapter)
    root.on(
      "llm/stream",
      (options, next) => stabilizeCodexStream(options, next),
      { global: true },
    )

    const agent = root.agentLoop.create(
      frozenSession.SessionId("codex-retry-probe"),
      { provider: CODEX_ROUTE_ID, model: "retry-probe" },
    )
    agent.followup(frozenLlm.createUserMessage({
      content: [{ type: "text", text: "probe" }],
      source: { kind: "user" },
    }))
    await agent.whenIdle()

    return {
      attempts: adapter.attempts,
      errors: errors.map((error) => error?.failure),
      eventTypes: agent.session.events.map((event) => event.type),
    }
  } finally {
    await root.fiber.dispose()
  }
}

test("real LlmRuntime waterfall publishes normalized quota before recovery policy sees the result", async () => {
  const root = new Context()
  const runtimeFiber = await root.plugin(LlmRuntime)

  try {
    root.llm.registerAdapter([CODEX_ROUTE_ID], new QuotaProbeAdapter())
    root.on(
      "llm/stream",
      (options, next) => stabilizeCodexStream(options, next),
      { global: true },
    )

    const chunks = []
    for await (const chunk of root.llm.stream({
      provider: CODEX_ROUTE_ID,
      model: "quota-probe",
      messages: [createUserMessage({
        content: [{ type: "text", text: "probe" }],
        source: { kind: "user" },
      })],
    })) chunks.push(chunk)

    const terminal = chunks.at(-1)
    assert.equal(terminal.reason.kind, "error")
    assert.equal(terminal.reason.failure.code, "QUOTA")
    assert.equal(
      root.llm.providerRetryPolicy(CODEX_ROUTE_ID).retryableCodes.includes("QUOTA"),
      false,
    )
  } finally {
    await runtimeFiber.dispose()
  }
})

test("frozen DSH agent loop retries a transient Codex rate limit through the provider route", async () => {
  const result = await runFrozenDshRetryProbe([{
    code: "RATE_LIMIT",
    status: 429,
    providerRetryAfterMs: 1,
    message: "HTTP 429: too many requests; retry after 1ms",
  }])

  assert.equal(result.attempts, 2)
  assert.deepEqual(result.errors, [])
  assert.equal(result.eventTypes.filter((type) => type === "llm/retry").length, 1)
  assert.equal(result.eventTypes.filter((type) => type === "llm/retry-started").length, 1)
})

test("frozen DSH retry stops after one provider attempt for normalized Codex quota", async () => {
  const result = await runFrozenDshRetryProbe([{
    code: "RATE_LIMIT",
    message: exactQuotaMessage,
  }])

  assert.equal(result.attempts, 1)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].code, "QUOTA")
  assert.equal(result.eventTypes.includes("llm/retry"), false)
  assert.equal(result.eventTypes.includes("llm/retry-started"), false)
})

test("frozen DSH retry stops after one provider attempt for an ambiguous Codex usage limit", async () => {
  const result = await runFrozenDshRetryProbe([{
    code: "PI_AI_ERROR",
    message: "You have hit your ChatGPT usage limit (plus plan). Try again in ~17 min.",
  }])

  assert.equal(result.attempts, 1)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].code, "QUOTA_OR_RATE_LIMIT")
  assert.equal(result.eventTypes.includes("llm/retry"), false)
  assert.equal(result.eventTypes.includes("llm/retry-started"), false)
})
