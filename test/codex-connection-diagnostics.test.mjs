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
    networkProbe: {
      run: async () => ({ kind: "success", outputObserved: true }),
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
    version: 2,
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
  assert.equal(receivedSignal instanceof AbortSignal, true)
  assert.equal(receivedSignal.aborted, false)
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

test("network diagnostics require one-shot consent and retain only bounded safe history", async () => {
  let now = NOW
  let probeCalls = 0
  let probedModelId
  const service = diagnostics({
    clock: () => now,
    historyLimit: 2,
    networkProbe: {
      run: async (_signal, modelId) => {
        probeCalls += 1
        probedModelId = modelId
        return { kind: "success", outputObserved: true, raw: SECRET }
      },
    },
  })

  const consent = await service.prepareNetwork(new AbortController().signal)
  assert.deepEqual(Object.keys(consent), [
    "version",
    "consentId",
    "expiresAt",
    "modelId",
    "transport",
  ])
  assert.equal(consent.version, 1)
  assert.equal(consent.expiresAt, NOW + 60_000)
  assert.equal(consent.modelId, "gpt-fixture-a")
  assert.equal(consent.transport, "sse")
  assert.equal(probeCalls, 0, "preparing consent must stay offline")

  const report = await service.runNetwork(consent.consentId, new AbortController().signal)
  assert.equal(probeCalls, 1)
  assert.equal(probedModelId, "gpt-fixture-a")
  assert.equal(report.version, 2)
  assert.equal(report.mode, "network")
  assert.deepEqual(report.checks.at(-1), {
    id: "model-request",
    status: "pass",
    code: "model-request-ready",
    facts: { attempted: true, outputObserved: true, modelId: "gpt-fixture-a" },
  })
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET, "u"))
  await assert.rejects(
    () => service.runNetwork(consent.consentId),
    /missing or expired/u,
  )
  assert.equal(probeCalls, 1, "a consumed consent must never replay the request")

  await service.run("local")
  await service.run("account")
  const history = service.history()
  assert.equal(history.version, 1)
  assert.equal(history.limit, 2)
  assert.deepEqual(history.reports.map(({ mode }) => mode), ["local", "account"])
  assert.equal(Object.isFrozen(history), true)
  assert.equal(Object.isFrozen(history.reports), true)
  assert.deepEqual(service.clearHistory(), { cleared: 2 })
  assert.deepEqual(service.history().reports, [])

  const expired = await service.prepareNetwork()
  now = expired.expiresAt
  await assert.rejects(() => service.runNetwork(expired.consentId), /missing or expired/u)
  assert.equal(probeCalls, 1)
})

test("network diagnostics do not spend usage when local prerequisites fail", async () => {
  let probeCalls = 0
  const service = diagnostics({
    describeCredential: async () => ({
      configured: false,
      state: "signed-out",
      writable: true,
    }),
    networkProbe: {
      run: async () => {
        probeCalls += 1
        return { kind: "success", outputObserved: true }
      },
    },
  })

  const consent = await service.prepareNetwork()
  const report = await service.runNetwork(consent.consentId)
  assert.equal(probeCalls, 0)
  assert.equal(report.outcome, "fail")
  assert.deepEqual(report.checks.at(-1), {
    id: "model-request",
    status: "fail",
    code: "model-request-prerequisite-failed",
  })
})

test("network diagnostics report an overlapping probe as not attempted", async () => {
  const service = diagnostics({
    networkProbe: {
      run: async () => ({ kind: "busy", outputObserved: false }),
    },
  })
  const consent = await service.prepareNetwork()
  const report = await service.runNetwork(consent.consentId)
  assert.deepEqual(report.checks.at(-1), {
    id: "model-request",
    status: "fail",
    code: "model-request-busy",
  })
})

test("network diagnostics retain post-dispatch cancellation as an attempted warning", async () => {
  const service = diagnostics({
    networkProbe: {
      run: async () => ({ kind: "cancelled-after-attempt", outputObserved: false }),
    },
  })
  const consent = await service.prepareNetwork()
  const report = await service.runNetwork(consent.consentId)
  assert.equal(report.outcome, "warning")
  assert.deepEqual(report.checks.at(-1), {
    id: "model-request",
    status: "warning",
    code: "model-request-cancelled-after-attempt",
    facts: { attempted: true, outputObserved: false, modelId: "gpt-fixture-a" },
  })
  assert.deepEqual(service.history().reports, [report])
})

test("network diagnostics map provider adapter failures to fixed sanitized codes", async (t) => {
  const cases = [
    ["invalid-request", "model-request-invalid"],
    ["provider-error", "model-request-provider-error"],
    ["unknown-model", "model-request-unknown-model"],
    ["missing-credential", "model-request-credential-missing"],
  ]
  for (const [kind, code] of cases) {
    await t.test(kind, async () => {
      const service = diagnostics({
        networkProbe: {
          run: async () => ({ kind, outputObserved: false, raw: `${SECRET}-${kind}` }),
        },
      })
      const consent = await service.prepareNetwork()
      const report = await service.runNetwork(consent.consentId)
      assert.deepEqual(report.checks.at(-1), {
        id: "model-request",
        status: "fail",
        code,
        facts: { attempted: true, outputObserved: false, modelId: "gpt-fixture-a" },
      })
      assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET, "u"))
    })
  }
})

test("network consent rejects unsafe model identifiers before dispatch", async () => {
  let probeCalls = 0
  const service = diagnostics({
    getRuntimeSnapshot: () => ({
      route: "dsh-codex",
      routeRegistered: true,
      catalog: [{ id: `gpt-fixture\n${SECRET}` }],
      enabledModels: [{ id: `gpt-fixture\n${SECRET}` }],
      selection: "all",
    }),
    networkProbe: {
      run: async () => {
        probeCalls += 1
        return { kind: "success", outputObserved: true }
      },
    },
  })

  await assert.rejects(() => service.prepareNetwork(), /missing or expired/u)
  assert.equal(probeCalls, 0)
})

test("network diagnostic preflight settles on caller cancellation and service disposal", async () => {
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  let probeCalls = 0
  let probeDisposals = 0
  let receivedSignal
  const service = diagnostics({
    describeCredential: async ({ signal }) => {
      receivedSignal = signal
      markStarted()
      return new Promise(() => undefined)
    },
    networkProbe: {
      run: async () => {
        probeCalls += 1
        return { kind: "success", outputObserved: true }
      },
      dispose() {
        probeDisposals += 1
      },
    },
  })
  const controller = new AbortController()
  const consent = await service.prepareNetwork(controller.signal)
  const pending = service.runNetwork(consent.consentId, controller.signal)
  await started

  controller.abort(new Error(SECRET))
  service.dispose()
  const report = await pending
  assert.equal(receivedSignal.aborted, true)
  assert.equal(report.outcome, "cancelled")
  assert.deepEqual(report.checks.map(({ code }) => code), [
    "runtime-ready",
    "cancelled",
    "cancelled",
    "cancelled",
  ])
  assert.equal(probeCalls, 0)
  assert.equal(probeDisposals, 1)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET, "u"))
})

test("network diagnostic preflight has a bounded deadline before quota can be spent", async () => {
  let probeCalls = 0
  const service = diagnostics({
    networkPreflightTimeoutMs: 5,
    describeCredential: async () => new Promise(() => undefined),
    networkProbe: {
      run: async () => {
        probeCalls += 1
        return { kind: "success", outputObserved: true }
      },
    },
  })
  const consent = await service.prepareNetwork()
  let guard
  const report = await Promise.race([
    service.runNetwork(consent.consentId),
    new Promise((_resolve, reject) => {
      guard = setTimeout(() => reject(new Error("preflight deadline did not settle")), 100)
    }),
  ]).finally(() => clearTimeout(guard))

  assert.equal(report.outcome, "fail")
  assert.deepEqual(report.checks.map(({ code }) => code), [
    "runtime-ready",
    "preflight-timeout",
    "preflight-not-run",
    "preflight-not-run",
  ])
  assert.deepEqual(report.checks.map(({ status }) => status), [
    "pass",
    "fail",
    "skipped",
    "skipped",
  ])
  assert.equal(probeCalls, 0)
})

test("service disposal also settles a passive account read that ignores abort", async () => {
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const service = diagnostics({
    accountUsageReader: {
      read: async () => {
        markStarted()
        return new Promise(() => undefined)
      },
    },
  })
  const pending = service.run("account")
  await started
  service.dispose()

  const report = await pending
  assert.equal(report.outcome, "cancelled")
  assert.equal(report.checks.at(-1).code, "cancelled")
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
  const prepared = await registrations[0].handler("prepare-network", {}, signal)
  assert.equal(prepared.ok, true)
  const network = await registrations[0].handler("run-network", {
    consentId: prepared.value.consentId,
  }, signal)
  assert.equal(network.ok, true)
  assert.equal(network.value.mode, "network")
  const replay = await registrations[0].handler("run-network", {
    consentId: prepared.value.consentId,
  }, signal)
  assert.equal(replay.ok, false)
  assert.equal(replay.error.code, "consent-invalid")
  const history = await registrations[0].handler("history", {}, signal)
  assert.equal(history.ok, true)
  assert.equal(history.value.reports.length, 2)
  const cleared = await registrations[0].handler("clear-history", {}, signal)
  assert.deepEqual(cleared, { ok: true, value: { cleared: 2 } })
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

test("diagnostics RPC lifecycle isolates connection cleanup from the shared service", async () => {
  let probeDisposals = 0
  const service = diagnostics({
    networkProbe: {
      run: async () => ({ kind: "success", outputObserved: true }),
      dispose: () => { probeDisposals += 1 },
    },
  })
  const cleanups = []
  let firstHandler
  registerCodexDiagnosticsRpc({
    connection: { rpc: { handle: (_channel, handler) => { firstHandler = handler } } },
    effect(callback) {
      cleanups.push(callback())
    },
  }, service)

  await service.prepareNetwork()
  assert.equal(cleanups.length, 1)
  cleanups[0]()
  cleanups[0]()
  assert.equal(probeDisposals, 0)
  assert.deepEqual(await firstHandler("run", { mode: "local" }), {
    ok: false,
    error: { code: "internal", message: "Connection diagnostic failed", details: {} },
  })

  let replacementHandler
  registerCodexDiagnosticsRpc({
    connection: { rpc: { handle: (_channel, handler) => { replacementHandler = handler } } },
  }, service)
  const replacement = await replacementHandler("run", { mode: "local" })
  assert.equal(replacement.ok, true)
  assert.equal(replacement.value.mode, "local")

  service.dispose()
  assert.equal(probeDisposals, 1)
  assert.throws(() => service.history(), /disposed/u)
  await assert.rejects(() => service.prepareNetwork(), /missing or expired/u)
})
