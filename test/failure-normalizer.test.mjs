import assert from "node:assert/strict"
import test from "node:test"

import {
  inspectCodexFailure,
  normalizeCodexFailure,
  parseEmbeddedJsonObjects,
} from "../src/internal/failure-normalizer.mjs"

const reportedFailure = {
  code: "RATE_LIMIT",
  message: "OpenAI API error (429): {\"code\":\"AccountQuotaExceeded\",\"message\":\"You have exceeded the 5-hour usage quota. It will reset at 2026-08-27 16:44:34 +0800 CST. We recommend upgrading your plan for more quota, or waiting for the reset. Request id: req_fixture_0123456789abcdef0123456789abcdef0123456789abcdef\",\"param\":\"\",\"type\":\"TooManyRequests\"}",
}

test("parses balanced embedded JSON without evaluating surrounding text", () => {
  assert.deepEqual(parseEmbeddedJsonObjects('prefix {"outer":{"value":"}"}} suffix'), [
    { outer: { value: "}" } },
  ])
  assert.deepEqual(parseEmbeddedJsonObjects("not { valid } json"), [])
})

test("classifies the reported five-hour AccountQuotaExceeded as terminal quota", () => {
  const result = normalizeCodexFailure(reportedFailure)

  assert.equal(result.changed, true)
  assert.equal(result.failure.code, "QUOTA")
  assert.equal(result.failure.status, 429)
  assert.equal(result.failure.providerRetryAfterMs, undefined)
  assert.equal(
    result.failure.requestId,
    "req_fixture_0123456789abcdef0123456789abcdef0123456789abcdef",
  )
  assert.match(result.failure.message, /已停止自动重试/u)
  assert.match(result.failure.message, /2026-08-27 16:44:34 UTC\+08:00/u)
  assert.equal(result.facts.reset?.iso, "2026-08-27T08:44:34.000Z")
})

test("trusts and sanitizes the Harness canonical QUOTA code", () => {
  const secret = "provider-internal-secret-fixture"
  const result = normalizeCodexFailure({
    code: "QUOTA",
    status: 429,
    message: `provider quota failure ${secret}`,
    debug: { authorization: secret },
  })

  assert.equal(result.changed, true)
  assert.equal(result.facts.kind, "account-quota")
  assert.equal(result.failure.code, "QUOTA")
  assert.deepEqual(Object.keys(result.failure).sort(), ["code", "message", "status"])
  assert.doesNotMatch(JSON.stringify(result.failure), new RegExp(secret, "u"))
})

test("canonical QUOTA retains facts from an independently matching error envelope", () => {
  const result = normalizeCodexFailure({ ...reportedFailure, code: "QUOTA" })

  assert.equal(result.changed, true)
  assert.equal(result.failure.code, "QUOTA")
  assert.equal(result.failure.requestId, "req_fixture_0123456789abcdef0123456789abcdef0123456789abcdef")
  assert.equal(result.facts.reset?.iso, "2026-08-27T08:44:34.000Z")
})

test("canonical QUOTA does not borrow facts from an unrelated JSON envelope", () => {
  const secret = "unrelated_canonical_fixture"
  const result = normalizeCodexFailure({
    code: "QUOTA",
    message: `diagnostic {"resetAt":"2026-08-30T00:00:00Z","requestId":"${secret}"}`,
  })

  assert.equal(result.changed, true)
  assert.equal(result.facts.reset, undefined)
  assert.equal(result.facts.requestId, undefined)
  assert.doesNotMatch(JSON.stringify(result.failure), new RegExp(secret, "u"))
})

test("leaves a transient 429 rate limit retryable", () => {
  const failure = {
    code: "RATE_LIMIT",
    status: 429,
    providerRetryAfterMs: 750,
    message: "HTTP 429: too many requests; retry after 750ms",
  }
  const result = normalizeCodexFailure(failure)

  assert.equal(result.changed, false)
  assert.equal(result.failure, failure)
  assert.equal(result.facts.kind, "other")
})

test("maps only public pi-ai premature-close failures to TRANSPORT", () => {
  for (const failure of [
    {
      code: "STREAM_CLOSED",
      message: "pi-ai event stream ended without done/error",
    },
    {
      code: "PI_AI_ERROR",
      message: "WebSocket closed 1006 other side closed",
    },
    {
      code: "PI_AI_ERROR",
      message: "WebSocket stream closed before response.completed",
    },
  ]) {
    const result = normalizeCodexFailure(failure)

    assert.equal(result.changed, true)
    assert.equal(result.failure.code, "TRANSPORT")
    assert.equal(result.facts.kind, "transport")
  }

  const unrelated = {
    code: "PI_AI_ERROR",
    message: "provider rejected an unsupported request option",
  }
  const result = normalizeCodexFailure(unrelated)
  assert.equal(result.changed, false)
  assert.equal(result.failure, unrelated)
  assert.equal(result.facts.kind, "other")
})

test("transport normalization does not echo a WebSocket close reason or provider fields", () => {
  const secret = "secret-close-reason-fixture"
  const result = normalizeCodexFailure({
    code: "PI_AI_ERROR",
    message: `WebSocket closed 1006 ${secret}`,
    requestId: "req_transport_fixture",
    debug: { authorization: secret },
  })

  assert.equal(result.changed, true)
  assert.deepEqual(Object.keys(result.failure).sort(), ["code", "message", "requestId"])
  assert.equal(result.failure.code, "TRANSPORT")
  assert.equal(result.failure.requestId, "req_transport_fixture")
  assert.doesNotMatch(JSON.stringify(result.failure), new RegExp(secret, "u"))
})

test("does not claim generic pi-ai usage-limit text proves account quota", () => {
  const result = normalizeCodexFailure({
    code: "PI_AI_ERROR",
    message: "You have hit your ChatGPT usage limit (plus plan). Try again in ~17 min.",
  })

  assert.equal(result.changed, true)
  assert.equal(result.failure.code, "QUOTA_OR_RATE_LIMIT")
  assert.equal(result.failure.status, undefined)
  assert.equal(result.facts.kind, "ambiguous-limit")
  assert.equal(result.facts.reset, undefined)
  assert.match(result.failure.message, /无法区分账户配额与临时限流/u)
  assert.doesNotMatch(result.failure.message, /Reset:/u)
})

test("does not mistake a short-window quota reset for exhausted account usage", () => {
  const failure = {
    code: "RATE_LIMIT",
    status: 429,
    message: "Per-minute quota will reset at 2026-08-27 16:44:34 +0800; retry later",
  }
  const result = normalizeCodexFailure(failure)

  assert.equal(result.changed, false)
  assert.equal(result.failure, failure)
  assert.equal(result.facts.kind, "other")
})

test("does not classify a prose mention of AccountQuotaExceeded as quota", () => {
  for (const message of [
    "HTTP 429: transient rate limit, not AccountQuotaExceeded; retry later",
    "HTTP 429: see the AccountQuotaExceeded troubleshooting section for comparison",
    "HTTP 429: this is not an account quota exceeded error; retry later",
  ]) {
    const failure = { code: "RATE_LIMIT", status: 429, message }
    const result = normalizeCodexFailure(failure)

    assert.equal(result.changed, false)
    assert.equal(result.failure, failure)
    assert.equal(result.facts.kind, "other")
  }
})

test("recognizes structured nested insufficient_quota", () => {
  const facts = inspectCodexFailure({
    message: "request failed",
    status: 429,
    error: { code: "insufficient_quota", message: "billing limit" },
    requestId: "req_fixture",
  })

  assert.equal(facts.kind, "account-quota")
  assert.equal(facts.requestId, "req_fixture")
})

test("ignores reset, request ID, and status from unrelated nested metadata", () => {
  const secret = "secret_metadata_fixture"
  const result = normalizeCodexFailure({
    code: "QUOTA",
    message: "provider quota failure",
    request: {
      metadata: {
        status: 451,
        resetAt: "2026-08-29T08:00:00Z",
        requestId: secret,
      },
    },
  })

  assert.equal(result.changed, true)
  assert.equal(result.facts.kind, "account-quota")
  assert.equal(result.facts.status, undefined)
  assert.equal(result.facts.reset, undefined)
  assert.equal(result.facts.requestId, undefined)
  assert.equal(result.failure.status, 429)
  assert.doesNotMatch(JSON.stringify(result.failure), new RegExp(secret, "u"))
  assert.doesNotMatch(result.failure.message, /2026-08-29/u)
})

test("accepts reset and request ID from a known provider error envelope", () => {
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    message: JSON.stringify({
      error: {
        code: "AccountQuotaExceeded",
        status: 429,
        resetAt: "2026-08-29T08:00:00Z",
        requestId: "req_trusted_fixture",
        message: "usage quota exhausted",
      },
    }),
  })

  assert.equal(result.changed, true)
  assert.equal(result.facts.status, 429)
  assert.equal(result.facts.reset?.iso, "2026-08-29T08:00:00.000Z")
  assert.equal(result.failure.requestId, "req_trusted_fixture")
})

test("does not combine quota evidence with facts from another JSON envelope", () => {
  const secret = "unrelated_fixture"
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    message: [
      `diagnostic {"resetAt":"2026-08-30T00:00:00Z","requestId":"${secret}"}`,
      "provider {\"error\":{\"code\":\"AccountQuotaExceeded\",\"message\":\"usage quota exhausted\"}}",
    ].join(" "),
  })

  assert.equal(result.changed, true)
  assert.equal(result.facts.kind, "account-quota")
  assert.equal(result.facts.reset, undefined)
  assert.equal(result.facts.requestId, undefined)
  assert.doesNotMatch(JSON.stringify(result.failure), new RegExp(secret, "u"))
  assert.doesNotMatch(result.failure.message, /2026-08-30/u)
})

test("does not classify quota-like request metadata as a provider error", () => {
  const failure = {
    code: "RATE_LIMIT",
    status: 429,
    message: '{"request":{"type":"insufficient_quota","metadata":{"code":"quota_exceeded"}}}',
  }
  const result = normalizeCodexFailure(failure)

  assert.equal(result.changed, false)
  assert.equal(result.failure, failure)
  assert.equal(result.facts.kind, "other")
})

test("recognizes structured quota_exceeded code as terminal quota", () => {
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    status: 429,
    message: '{"error":{"code":"quota_exceeded","message":"billing limit reached"}}',
  })

  assert.equal(result.changed, true)
  assert.equal(result.failure.code, "QUOTA")
})

test("recognizes structured billing_hard_limit_reached type as terminal quota", () => {
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    status: 429,
    message: '{"error":{"type":"billing_hard_limit_reached","message":"billing limit reached"}}',
  })

  assert.equal(result.changed, true)
  assert.equal(result.failure.code, "QUOTA")
})

test("does not leak arbitrary structured fields into the normalized message", () => {
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    message: 'OpenAI API error (429): {"code":"AccountQuotaExceeded","message":"usage quota exceeded","access_token":"secret-fixture"}',
  })

  assert.equal(result.changed, true)
  assert.doesNotMatch(result.failure.message, /secret-fixture/u)
  assert.doesNotMatch(result.failure.message, /access_token/u)
})

test("drops untrusted reset and request-id text instead of reflecting it", () => {
  const secret = "secret-fixture"
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    status: 429,
    requestId: `req_ok\n${secret}`,
    resetAt: `not-a-date ${secret}`,
    message: '{"code":"AccountQuotaExceeded","message":"usage quota exceeded"}',
  })

  assert.equal(result.changed, true)
  assert.equal(result.failure.requestId, undefined)
  assert.equal(result.facts.reset, undefined)
  assert.equal("originalMessage" in result.facts, false)
  assert.doesNotMatch(result.failure.message, /secret-fixture/u)
})

test("normalizes numeric reset timestamps without retaining arbitrary source text", () => {
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    status: 429,
    resetAt: 1_787_934_400,
    requestId: "req_fixture-123",
    message: '{"code":"AccountQuotaExceeded","message":"usage quota exceeded"}',
  })

  assert.equal(result.changed, true)
  assert.equal(result.failure.requestId, "req_fixture-123")
  assert.equal(result.facts.reset?.raw, "2026-08-28T16:26:40.000Z")
})

test("accepts a strict UTC reset timestamp", () => {
  const result = normalizeCodexFailure({
    code: "RATE_LIMIT",
    status: 429,
    resetAt: "2026-08-28T16:26:40Z",
    message: '{"code":"AccountQuotaExceeded","message":"usage quota exceeded"}',
  })

  assert.equal(result.changed, true)
  assert.equal(result.facts.reset?.raw, "2026-08-28T16:26:40.000Z")
})

test("rejects invalid calendar resets and bounds embedded provider input", () => {
  const invalid = normalizeCodexFailure({
    code: "RATE_LIMIT",
    message: '{"code":"AccountQuotaExceeded","resetAt":"2026-99-99 99:99:99 +0800"}',
  })
  assert.equal(invalid.changed, true)
  assert.equal(invalid.facts.reset, undefined)

  const oversized = `${'{"code":"AccountQuotaExceeded","padding":"'}${"x".repeat(70_000)}"}`
  assert.doesNotThrow(() => inspectCodexFailure({ code: "RATE_LIMIT", message: oversized }))
})
