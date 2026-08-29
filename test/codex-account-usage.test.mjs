import assert from "node:assert/strict"
import test from "node:test"

import {
  createCodexAccountUsageReader,
} from "../src/internal/codex-account-usage.mjs"

const ACCESS_TOKEN = "access-token-must-not-leak"
const ACCOUNT_ID = "account-id-must-not-leak"
const NOW = 1_787_973_000_000

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  })
}

function reader(options = {}) {
  return createCodexAccountUsageReader({
    baseUrl: "https://chatgpt.example/backend-api/codex",
    resolveAuth: async () => ({ access: ACCESS_TOKEN, accountId: ACCOUNT_ID }),
    clock: () => NOW,
    fetch: async () => jsonResponse({ rate_limit: {} }),
    ...options,
  })
}

test("reads the primary Codex windows with refreshed OAuth headers and safe normalized output", async () => {
  let request
  const usage = reader({
    fetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        plan_type: "plus",
        rate_limit: {
          limit_id: "codex",
          primary_window: {
            used_percent: 12.5,
            limit_window_seconds: 18_000,
            reset_at: 1_787_991_000,
            reset_after_seconds: 18_000,
          },
          secondary_window: {
            used_percent: 3.25,
            limit_window_seconds: 604_800,
            reset_at: 1_788_577_800,
          },
          future_server_field: { ignored: true },
        },
        future_top_level_field: ACCESS_TOKEN,
      })
    },
  })

  const result = await usage.read()

  assert.equal(request.url, "https://chatgpt.example/backend-api/codex/wham/usage")
  assert.equal(request.init.method, "GET")
  assert.equal(request.init.redirect, "error")
  assert.equal(request.init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`)
  assert.equal(request.init.headers["ChatGPT-Account-Id"], ACCOUNT_ID)
  assert.equal(request.init.headers.Accept, "application/json")
  assert.equal(request.init.signal instanceof AbortSignal, true)
  assert.deepEqual(result, {
    observedAt: NOW,
    planType: "plus",
    rateLimits: [{
      limitId: "codex",
      limitName: null,
      primary: {
        usedPercent: 12.5,
        windowDurationMins: 300,
        resetsAt: 1_787_991_000_000,
      },
      secondary: {
        usedPercent: 3.25,
        windowDurationMins: 10_080,
        resetsAt: 1_788_577_800_000,
      },
    }],
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.rateLimits), true)
  assert.equal(Object.isFrozen(result.rateLimits[0].primary), true)
  assert.doesNotMatch(JSON.stringify(result), /access-token|account-id|future_server_field/u)
})

test("keeps the main limit first and preserves additional limit identity when windows are missing", async () => {
  const usage = reader({
    fetch: async () => jsonResponse({
      rate_limit: {
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 18_000,
          reset_at: 1_787_991_000,
        },
      },
      additional_rate_limits: [{
        limit_id: "codex-review",
        limit_name: "Code review",
        rate_limit: {
          secondary_window: {
            used_percent: 99.875,
            limit_window_seconds: 604_800,
            reset_at: 1_788_577_800,
          },
          ignored: true,
        },
        ignored: true,
      }, {
        limit_name: "codex-other",
        rate_limit: {
          primary_window: {
            used_percent: 100,
            limit_window_seconds: 3_600,
            reset_at: 1_787_976_600,
          },
        },
      }],
      ignored: true,
    }),
  })

  const result = await usage.read()

  assert.deepEqual(result, {
    observedAt: NOW,
    rateLimits: [{
      limitId: "codex",
      limitName: null,
      primary: {
        usedPercent: 0,
        windowDurationMins: 300,
        resetsAt: 1_787_991_000_000,
      },
    }, {
      limitId: "codex-review",
      limitName: "Code review",
      secondary: {
        usedPercent: 99.875,
        windowDurationMins: 10_080,
        resetsAt: 1_788_577_800_000,
      },
    }, {
      limitId: "codex-other",
      limitName: "codex-other",
      primary: {
        usedPercent: 100,
        windowDurationMins: 60,
        resetsAt: 1_787_976_600_000,
      },
    }],
  })
  assert.equal("planType" in result, false)
})

test("rejects invalid critical payload shapes and implausible quota values", async () => {
  const validWindow = {
    used_percent: 50,
    limit_window_seconds: 18_000,
    reset_at: 1_787_991_000,
  }
  const invalidPayloads = [
    null,
    [],
    {},
    { rate_limit: null },
    { rate_limit: { primary_window: [] } },
    { rate_limit: { primary_window: { ...validWindow, used_percent: -0.001 } } },
    { rate_limit: { primary_window: { ...validWindow, used_percent: 100.001 } } },
    { rate_limit: { primary_window: { ...validWindow, used_percent: "50" } } },
    { rate_limit: { primary_window: { ...validWindow, limit_window_seconds: 0 } } },
    { rate_limit: { primary_window: { ...validWindow, limit_window_seconds: 60.5 } } },
    { rate_limit: { primary_window: { ...validWindow, limit_window_seconds: 61 } } },
    { rate_limit: { primary_window: { ...validWindow, reset_at: NOW / 1_000 } } },
    {
      rate_limit: {
        primary_window: {
          ...validWindow,
          reset_at: Math.floor((NOW + 367 * 24 * 60 * 60_000) / 1_000),
        },
      },
    },
    { plan_type: "", rate_limit: {} },
    { plan_type: { unsafe: true }, rate_limit: {} },
    { limit_id: "outer", rate_limit: { limit_id: "inner" } },
    { rate_limit: {}, additional_rate_limits: {} },
    { rate_limit: {}, additional_rate_limits: [{}] },
    {
      rate_limit: { limit_id: "codex" },
      additional_rate_limits: [{ limit_id: "codex", rate_limit: {} }],
    },
  ]

  for (const payload of invalidPayloads) {
    const usage = reader({ fetch: async () => jsonResponse(payload) })
    await assert.rejects(usage.read(), (error) => {
      assert.equal(error.name, "CodexAccountUsageError")
      assert.equal(error.code, "INVALID_RESPONSE")
      return true
    })
  }
})

test("rejects HTTP errors, redirects, non-JSON, and malformed JSON without exposing response bodies", async () => {
  const rawSecret = "raw-body-secret-with-account-data"
  const cases = [{
    response: new Response(JSON.stringify({ error: rawSecret }), {
      status: 429,
      headers: { "content-type": "application/json" },
    }),
    code: "HTTP_STATUS",
    status: 429,
  }, {
    response: new Response(null, {
      status: 302,
      headers: { location: `https://attacker.example/?token=${ACCESS_TOKEN}` },
    }),
    code: "REDIRECT",
  }, {
    response: new Response(rawSecret, {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    code: "INVALID_CONTENT_TYPE",
  }, {
    response: new Response(`{"secret":"${rawSecret}"`, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    code: "INVALID_RESPONSE",
  }]

  for (const fixture of cases) {
    const usage = reader({ fetch: async () => fixture.response })
    await assert.rejects(usage.read(), (error) => {
      assert.equal(error.code, fixture.code)
      if (fixture.status !== undefined) assert.equal(error.status, fixture.status)
      const visible = `${String(error)} ${JSON.stringify(error)} ${error.stack ?? ""}`
      assert.doesNotMatch(visible, new RegExp(rawSecret, "u"))
      assert.doesNotMatch(visible, new RegExp(ACCESS_TOKEN, "u"))
      assert.doesNotMatch(visible, new RegExp(ACCOUNT_ID, "u"))
      return true
    })
  }
})

test("sanitizes authentication and network dependency failures", async () => {
  const authFailure = reader({
    resolveAuth: async () => {
      throw new Error(`refresh failed for ${ACCESS_TOKEN} and ${ACCOUNT_ID}`)
    },
  })
  await assert.rejects(authFailure.read(), (error) => {
    assert.equal(error.code, "AUTH_UNAVAILABLE")
    assert.doesNotMatch(`${String(error)} ${error.stack ?? ""}`, /access-token|account-id/u)
    assert.equal("cause" in error, false)
    return true
  })

  const networkFailure = reader({
    fetch: async () => {
      throw new Error(`request https://example.test/?token=${ACCESS_TOKEN}&account=${ACCOUNT_ID}`)
    },
  })
  await assert.rejects(networkFailure.read(), (error) => {
    assert.equal(error.code, "NETWORK")
    assert.doesNotMatch(`${String(error)} ${error.stack ?? ""}`, /access-token|account-id|example\.test/u)
    assert.equal("cause" in error, false)
    return true
  })
})

test("enforces both declared and streamed response byte limits", async () => {
  const declared = reader({
    maxResponseBytes: 32,
    fetch: async () => new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "33",
      },
    }),
  })
  await assert.rejects(declared.read(), { code: "BODY_TOO_LARGE" })

  const streamed = reader({
    maxResponseBytes: 32,
    fetch: async () => new Response(JSON.stringify({
      rate_limit: {},
      padding: "x".repeat(64),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  })
  await assert.rejects(streamed.read(), { code: "BODY_TOO_LARGE" })
})

test("propagates a caller AbortSignal through refresh and fetch using a sanitized abort error", async () => {
  const controller = new AbortController()
  let refreshSignal
  let fetchCalled = false
  const usage = reader({
    resolveAuth: ({ signal }) => {
      refreshSignal = signal
      return new Promise(() => {})
    },
    fetch: async () => {
      fetchCalled = true
      return jsonResponse({ rate_limit: {} })
    },
  })

  const pending = usage.read({ signal: controller.signal })
  await Promise.resolve()
  controller.abort(new Error(`caller secret ${ACCESS_TOKEN} ${ACCOUNT_ID}`))

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "ABORTED")
    assert.doesNotMatch(`${String(error)} ${error.stack ?? ""}`, /access-token|account-id|caller secret/u)
    return true
  })
  assert.equal(refreshSignal instanceof AbortSignal, true)
  assert.equal(refreshSignal.aborted, true)
  assert.equal(fetchCalled, false)
})

test("applies one strict timeout across OAuth refresh and the HTTP request", async () => {
  let refreshSignal
  const usage = reader({
    timeoutMs: 20,
    resolveAuth: async ({ signal }) => {
      refreshSignal = signal
      return { access: ACCESS_TOKEN, accountId: ACCOUNT_ID }
    },
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    }),
  })

  await assert.rejects(usage.read(), { code: "TIMEOUT" })
  assert.equal(refreshSignal.aborted, true)

  const stalledBody = reader({
    timeoutMs: 20,
    fetch: async () => ({
      status: 200,
      redirected: false,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          return {
            read: () => new Promise(() => {}),
            cancel: () => new Promise(() => {}),
          }
        },
      },
    }),
  })
  await assert.rejects(stalledBody.read(), { code: "TIMEOUT" })
})
