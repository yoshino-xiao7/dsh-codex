import assert from "node:assert/strict"
import test from "node:test"

import {
  CODEX_DIAGNOSTICS_RPC_CHANNEL,
  CodexDiagnosticsBridge,
  createCodexConnectionDiagnostics,
  createCodexDiagnosticsRpcHandler,
  registerCodexDiagnosticsRpc,
} from "../src/internal/codex-connection-diagnostics.mjs"

const NOW = 1_788_000_000_000
const SECRET = "diagnostic-secret-must-not-cross-the-seam"
const ACCOUNT_ID = "account-id-must-not-cross-the-seam"

function diagnostics(options = {}) {
  return createCodexConnectionDiagnostics({
    clock: () => NOW,
    getRuntimeSnapshot: () => ({
      route: "dsh-codex",
      routeRegistered: true,
      catalog: [{ id: "gpt-fixture-a", rawHeader: SECRET }, { id: "gpt-fixture-b" }],
      enabledModels: [{ id: "gpt-fixture-a", endpoint: `https://example.test/?token=${SECRET}` }],
      selection: "custom",
      rawAccountId: ACCOUNT_ID,
    }),
    describeCredential: async () => ({
      configured: true,
      state: "signed-in",
      writable: true,
      grant: { access: SECRET, accountId: ACCOUNT_ID },
    }),
    accountUsageReader: {
      read: async () => ({
        observedAt: NOW,
        rateLimits: [],
      }),
    },
    ...options,
  })
}

test("local diagnostics are fully offline and return only fixed primitive facts", async () => {
  let accountReads = 0
  const report = await diagnostics({
    accountUsageReader: {
      read: async () => {
        accountReads += 1
        throw new Error(`unexpected network read ${SECRET}`)
      },
    },
  }).run("local", new AbortController().signal)

  assert.equal(accountReads, 0)
  assert.deepEqual(report, {
    version: 1,
    mode: "local",
    outcome: "pass",
    observedAt: NOW,
    checks: [{
      id: "runtime",
      status: "pass",
      code: "runtime-ready",
      facts: { route: "dsh-codex", registered: true },
    }, {
      id: "credential",
      status: "pass",
      code: "credential-ready",
      facts: { configured: true, state: "signed-in", writable: true },
    }, {
      id: "models",
      status: "pass",
      code: "models-ready",
      facts: {
        catalogCount: 2,
        enabledCount: 1,
        selection: "custom",
        allEnabled: false,
      },
    }],
  })
  assert.equal(Object.isFrozen(report), true)
  assert.equal(Object.isFrozen(report.checks), true)
  assert.equal(Object.isFrozen(report.checks[0].facts), true)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(`${SECRET}|${ACCOUNT_ID}`, "u"))
  for (const row of report.checks) {
    for (const value of Object.values(row.facts ?? {})) {
      assert.equal(["boolean", "number", "string"].includes(typeof value), true)
    }
  }
})

test("account diagnostics call AccountUsageReader exactly once and never require a stream seam", async () => {
  let accountReads = 0
  let receivedSignal
  const controller = new AbortController()
  const report = await diagnostics({
    accountUsageReader: {
      read: async ({ signal }) => {
        accountReads += 1
        receivedSignal = signal
        return {
          observedAt: NOW,
          planType: "untrusted-plan-name",
          rateLimits: [{
            limitId: `secret-limit-${SECRET}`,
            primary: { usedPercent: 7, resetAt: NOW + 1_000 },
            secondary: { usedPercent: 3, resetAt: NOW + 2_000 },
          }, {
            limitId: "another",
            secondary: { usedPercent: 1, resetAt: NOW + 3_000 },
          }],
          rawGrant: SECRET,
        }
      },
    },
  }).run("account", controller.signal)

  assert.equal(accountReads, 1)
  assert.equal(receivedSignal, controller.signal)
  assert.equal(report.outcome, "pass")
  assert.deepEqual(report.checks.at(-1), {
    id: "account-usage",
    status: "pass",
    code: "account-usage-ready",
    facts: {
      rateLimitCount: 2,
      primaryWindows: 1,
      secondaryWindows: 2,
    },
  })
  assert.doesNotMatch(JSON.stringify(report), new RegExp(`${SECRET}|untrusted-plan-name`, "u"))
})

test("diagnostics map credential and account failures without exposing raw errors", async () => {
  const readerError = Object.assign(
    new Error(`network failed for ${SECRET} ${ACCOUNT_ID}`),
    { code: "NETWORK", token: SECRET, accountId: ACCOUNT_ID },
  )
  const report = await diagnostics({
    describeCredential: async () => {
      throw Object.assign(new Error(`grant ${SECRET}`), { grant: SECRET })
    },
    accountUsageReader: {
      read: async () => { throw readerError },
    },
  }).run("account", new AbortController().signal)

  assert.equal(report.outcome, "fail")
  assert.deepEqual(report.checks[1], {
    id: "credential",
    status: "fail",
    code: "credential-unavailable",
  })
  assert.deepEqual(report.checks.at(-1), {
    id: "account-usage",
    status: "fail",
    code: "account-network-unavailable",
  })
  assert.doesNotMatch(JSON.stringify(report), new RegExp(`${SECRET}|${ACCOUNT_ID}|network failed`, "u"))
})

test("diagnostics classify account usage HTTP failures without exposing response bodies", async (t) => {
  const cases = [
    { status: 401, code: "account-http-auth-error" },
    { status: 403, code: "account-http-auth-error" },
    { status: 429, code: "account-http-rate-limited" },
    { status: 500, code: "account-http-server-error" },
    { status: 503, code: "account-http-server-error" },
    { status: 418, code: "account-http-error" },
  ]

  for (const entry of cases) {
    await t.test(String(entry.status), async () => {
      const report = await diagnostics({
        accountUsageReader: {
          read: async () => {
            throw Object.assign(new Error(`HTTP ${entry.status}: ${SECRET}`), {
              code: "HTTP_STATUS",
              status: entry.status,
              responseBody: SECRET,
            })
          },
        },
      }).run("account", new AbortController().signal)

      assert.equal(report.outcome, "fail")
      assert.deepEqual(report.checks.at(-1), {
        id: "account-usage",
        status: "fail",
        code: entry.code,
      })
      assert.doesNotMatch(JSON.stringify(report), new RegExp(`${SECRET}|responseBody|HTTP ${entry.status}`, "u"))
    })
  }
})

test("account cancellation returns the fixed cancelled report without raw abort reasons", async () => {
  const controller = new AbortController()
  const report = await diagnostics({
    accountUsageReader: {
      read: async () => {
        controller.abort(new Error(`cancel ${SECRET}`))
        throw Object.assign(new Error(`abort ${SECRET}`), { code: "ABORTED" })
      },
    },
  }).run("account", controller.signal)

  assert.equal(report.outcome, "cancelled")
  assert.deepEqual(report.checks.at(-1), {
    id: "account-usage",
    status: "skipped",
    code: "cancelled",
  })
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET, "u"))
})

test("diagnostics report empty account usage as a warning", async () => {
  const report = await diagnostics().run("account", new AbortController().signal)

  assert.equal(report.outcome, "warning")
  assert.deepEqual(report.checks.at(-1), {
    id: "account-usage",
    status: "warning",
    code: "account-usage-empty",
    facts: { rateLimitCount: 0, primaryWindows: 0, secondaryWindows: 0 },
  })
})

test("diagnostics RPC is isolated, loopback-only, and rejects unknown input", async () => {
  const registrations = []
  const bridge = registerCodexDiagnosticsRpc({
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registrations.push({ channel, handler, options })
        },
      },
    },
  }, diagnostics())

  assert.equal(bridge instanceof CodexDiagnosticsBridge, true)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].channel, CODEX_DIAGNOSTICS_RPC_CHANNEL)
  assert.deepEqual(registrations[0].options, { authority: "loopback" })

  const signal = new AbortController().signal
  const result = await registrations[0].handler("run", { mode: "local" }, signal)
  assert.equal(result.ok, true)
  assert.equal(result.value.mode, "local")
  assert.deepEqual(
    await registrations[0].handler("run", { mode: "active" }, signal),
    {
      ok: false,
      error: {
        code: "bad-request",
        message: "mode must be local or account",
        details: { issues: [] },
      },
    },
  )
  assert.equal(
    (await registrations[0].handler("run", { mode: "local", token: SECRET }, signal)).ok,
    false,
  )
})

test("diagnostics RPC replaces unexpected dependency failures with a fixed error", async () => {
  const handler = createCodexDiagnosticsRpcHandler({
    dispatch: async () => {
      throw Object.assign(new Error(`raw ${SECRET}`), { grant: SECRET })
    },
  })

  const result = await handler("run", { mode: "local" }, new AbortController().signal)
  assert.deepEqual(result, {
    ok: false,
    error: { code: "internal", message: "Connection diagnostic failed", details: {} },
  })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET, "u"))
})
