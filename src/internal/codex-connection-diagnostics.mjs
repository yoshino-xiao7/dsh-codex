import { randomUUID } from "node:crypto"

import { CODEX_ROUTE_ID } from "./codex-identifiers.mjs"
import { isCodexNetworkProbeModelId } from "./codex-network-probe-contract.mjs"

export const CODEX_DIAGNOSTICS_RPC_CHANNEL = "/dsh-codex-diagnostics"

const REPORT_VERSION = 2
const HISTORY_VERSION = 1
const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 50
const CONSENT_TTL_MS = 60_000
const MAX_CONSENTS = 8
const DEFAULT_NETWORK_PREFLIGHT_TIMEOUT_MS = 30_000
const MAX_NETWORK_PREFLIGHT_TIMEOUT_MS = 60_000
const MODES = new Set(["local", "account", "network"])
const PASSIVE_MODES = new Set(["local", "account"])
const CREDENTIAL_STATES = new Set(["signed-in", "signed-out", "invalid"])
const SELECTIONS = new Set(["all", "custom"])
const LOCAL_CHECK_IDS = Object.freeze(["runtime", "credential", "models"])
const ACCOUNT_CHECK_IDS = Object.freeze([...LOCAL_CHECK_IDS, "account-usage"])
const NETWORK_CHECK_IDS = Object.freeze([...LOCAL_CHECK_IDS, "model-request"])

class RpcInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "RpcInputError"
  }
}

class DiagnosticConsentError extends Error {
  constructor() {
    super("Network diagnostic consent is missing or expired")
    this.name = "DiagnosticConsentError"
  }
}

/**
 * Build a bounded, read-only diagnostic surface for the installed Codex route.
 *
 * `local` calls only the process-local snapshot and credential metadata seams.
 * `account` performs those same checks and then calls AccountUsageReader once.
 * `network` is reachable only through a short-lived, one-shot consent and asks
 * the injected isolated probe to make at most one real request. Reports are
 * constructed from fixed check IDs, status codes, and primitive facts so
 * provider failures, OAuth grants, account identifiers, response content, and
 * tokens cannot cross the interface.
 */
export function createCodexConnectionDiagnostics(options) {
  const input = plainOptions(options)
  const getRuntimeSnapshot = requiredFunction(input, "getRuntimeSnapshot")
  const describeCredential = requiredFunction(input, "describeCredential")
  const accountUsageReader = input.accountUsageReader
  const networkProbe = input.networkProbe
  const clock = input.clock ?? Date.now
  const historyLimit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT
  const networkPreflightTimeoutMs = input.networkPreflightTimeoutMs
    ?? DEFAULT_NETWORK_PREFLIGHT_TIMEOUT_MS

  if (accountUsageReader?.read === undefined || typeof accountUsageReader.read !== "function") {
    throw new TypeError("accountUsageReader must provide read")
  }
  if (networkProbe?.run === undefined || typeof networkProbe.run !== "function") {
    throw new TypeError("networkProbe must provide run")
  }
  if (networkProbe.dispose !== undefined && typeof networkProbe.dispose !== "function") {
    throw new TypeError("networkProbe.dispose must be a function when provided")
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function")
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_HISTORY_LIMIT) {
    throw new TypeError(`historyLimit must be an integer from 1 to ${MAX_HISTORY_LIMIT}`)
  }
  if (
    !Number.isSafeInteger(networkPreflightTimeoutMs)
    || networkPreflightTimeoutMs < 1
    || networkPreflightTimeoutMs > MAX_NETWORK_PREFLIGHT_TIMEOUT_MS
  ) {
    throw new TypeError(
      `networkPreflightTimeoutMs must be an integer from 1 to ${MAX_NETWORK_PREFLIGHT_TIMEOUT_MS}`,
    )
  }

  const previousReports = []
  const consents = new Map()
  const lifetime = new AbortController()
  let disposed = false

  function complete(mode, outcome, checks) {
    const value = report(mode, outcome, checks, clock)
    if (disposed) return value
    previousReports.push(value)
    if (previousReports.length > historyLimit) previousReports.shift()
    return value
  }

  async function runDiagnostic(mode, signal, networkModelId) {
    if (disposed) throw new Error("diagnostics are disposed")
    if (!MODES.has(mode)) throw new TypeError("diagnostic mode must be local, account, or network")
    assertAbortSignal(signal)

    const expectedIds = mode === "account"
      ? ACCOUNT_CHECK_IDS
      : mode === "network"
        ? NETWORK_CHECK_IDS
        : LOCAL_CHECK_IDS
    const diagnosticSignal = AbortSignal.any([
      lifetime.signal,
      ...(signal === undefined ? [] : [signal]),
    ])
    const preflightSignal = mode === "network"
      ? AbortSignal.any([
          diagnosticSignal,
          AbortSignal.timeout(networkPreflightTimeoutMs),
        ])
      : diagnosticSignal
    if (diagnosticSignal?.aborted === true) {
      return complete(mode, "cancelled", expectedIds.map(cancelledCheck))
    }

    const checks = []
    let runtimeSnapshot
    const runtimeStep = await diagnosticStep(
      () => getRuntimeSnapshot({ signal: preflightSignal }),
      preflightSignal,
    )
    if (runtimeStep.kind === "aborted") {
      if (diagnosticSignal.aborted) {
        appendCancelledChecks(checks, expectedIds)
        return complete(mode, "cancelled", checks)
      }
      appendPreflightTimeoutChecks(checks, expectedIds)
      return complete(mode, "fail", checks)
    }
    try {
      if (runtimeStep.kind === "failed") throw runtimeStep.error
      runtimeSnapshot = normalizeRuntimeSnapshot(runtimeStep.value)
      checks.push(check("runtime", runtimeSnapshot.routeRegistered ? "pass" : "fail", {
        code: runtimeSnapshot.routeRegistered ? "runtime-ready" : "route-unavailable",
        facts: {
          route: CODEX_ROUTE_ID,
          registered: runtimeSnapshot.routeRegistered,
        },
      }))
    } catch {
      checks.push(check("runtime", "fail", { code: "runtime-unavailable" }))
    }

    if (diagnosticSignal?.aborted === true) {
      appendCancelledChecks(checks, expectedIds)
      return complete(mode, "cancelled", checks)
    }

    let credential
    const credentialStep = await diagnosticStep(
      () => describeCredential({ signal: preflightSignal }),
      preflightSignal,
    )
    if (credentialStep.kind === "aborted") {
      if (diagnosticSignal.aborted) {
        appendCancelledChecks(checks, expectedIds)
        return complete(mode, "cancelled", checks)
      }
      appendPreflightTimeoutChecks(checks, expectedIds)
      return complete(mode, "fail", checks)
    }
    try {
      if (credentialStep.kind === "failed") throw credentialStep.error
      credential = normalizeCredential(credentialStep.value)
      checks.push(credentialCheck(credential))
    } catch {
      checks.push(check("credential", "fail", { code: "credential-unavailable" }))
    }

    if (diagnosticSignal?.aborted === true) {
      appendCancelledChecks(checks, expectedIds)
      return complete(mode, "cancelled", checks)
    }

    checks.push(modelsCheck(runtimeSnapshot))

    if (mode === "account") {
      if (diagnosticSignal?.aborted === true) {
        checks.push(cancelledCheck("account-usage"))
        return complete(mode, "cancelled", checks)
      }

      try {
        const usageStep = await diagnosticStep(
          () => accountUsageReader.read({ signal: diagnosticSignal }),
          diagnosticSignal,
        )
        if (usageStep.kind === "aborted") {
          checks.push(cancelledCheck("account-usage"))
          return complete(mode, "cancelled", checks)
        }
        if (usageStep.kind === "failed") throw usageStep.error
        checks.push(accountUsageCheck(usageStep.value))
      } catch (error) {
        if (diagnosticSignal?.aborted === true || error?.code === "ABORTED") {
          checks.push(cancelledCheck("account-usage"))
          return complete(mode, "cancelled", checks)
        }
        checks.push(check("account-usage", "fail", {
          code: publicAccountUsageFailureCode(error),
        }))
      }
    }

    if (mode === "network") {
      if (diagnosticSignal.aborted === true) {
        checks.push(cancelledCheck("model-request"))
        return complete(mode, "cancelled", checks)
      }
      if (
        runtimeSnapshot?.routeRegistered !== true
        || credential?.state !== "signed-in"
        || runtimeSnapshot.enabledCount < 1
        || !runtimeSnapshot.enabledModelIds.includes(networkModelId)
      ) {
        checks.push(check("model-request", "fail", {
          code: "model-request-prerequisite-failed",
        }))
        return complete(mode, outcomeFor(checks), checks)
      }
      try {
        const probeStep = await diagnosticStep(
          () => networkProbe.run(diagnosticSignal, networkModelId),
          diagnosticSignal,
        )
        if (probeStep.kind === "aborted") {
          checks.push(networkRequestCheck({
            kind: "cancelled-after-attempt",
            outputObserved: false,
          }, networkModelId))
        } else {
          if (probeStep.kind === "failed") throw probeStep.error
          checks.push(networkRequestCheck(probeStep.value, networkModelId))
        }
      } catch {
        checks.push(check("model-request", "fail", { code: "model-request-unavailable" }))
      }
    }

    return complete(mode, outcomeFor(checks), checks)
  }

  function run(mode, signal) {
    if (!PASSIVE_MODES.has(mode)) {
      throw new TypeError("diagnostic mode must be local or account")
    }
    return runDiagnostic(mode, signal)
  }

  async function prepareNetwork(signal) {
    if (disposed) throw new DiagnosticConsentError()
    assertAbortSignal(signal)
    if (signal?.aborted === true) throw new DiagnosticConsentError()
    const preparationSignal = AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(networkPreflightTimeoutMs),
      ...(signal === undefined ? [] : [signal]),
    ])
    const snapshotStep = await diagnosticStep(
      () => getRuntimeSnapshot({ signal: preparationSignal }),
      preparationSignal,
    )
    if (snapshotStep.kind !== "completed") throw new DiagnosticConsentError()
    let snapshot
    try {
      snapshot = normalizeRuntimeSnapshot(snapshotStep.value)
    } catch {
      throw new DiagnosticConsentError()
    }
    const modelId = snapshot.enabledModelIds[0]
    if (snapshot.routeRegistered !== true || !isCodexNetworkProbeModelId(modelId)) {
      throw new DiagnosticConsentError()
    }
    expireConsents(consents, readClock(clock))
    while (consents.size >= MAX_CONSENTS) consents.delete(consents.keys().next().value)
    const preparedAt = readClock(clock)
    const consentId = randomUUID()
    const expiresAt = preparedAt + CONSENT_TTL_MS
    consents.set(consentId, Object.freeze({ expiresAt, modelId }))
    return Object.freeze({
      version: 1,
      consentId,
      expiresAt,
      modelId,
      transport: "sse",
    })
  }

  async function runNetwork(consentId, signal) {
    if (disposed) throw new DiagnosticConsentError()
    assertAbortSignal(signal)
    if (typeof consentId !== "string" || !/^[0-9a-f-]{36}$/u.test(consentId)) {
      throw new DiagnosticConsentError()
    }
    const now = readClock(clock)
    expireConsents(consents, now)
    const consent = consents.get(consentId)
    consents.delete(consentId)
    if (consent === undefined || consent.expiresAt <= now || signal?.aborted === true) {
      throw new DiagnosticConsentError()
    }
    return runDiagnostic("network", signal, consent.modelId)
  }

  function history() {
    if (disposed) throw new Error("diagnostics are disposed")
    return Object.freeze({
      version: HISTORY_VERSION,
      limit: historyLimit,
      reports: Object.freeze([...previousReports]),
    })
  }

  function clearHistory() {
    if (disposed) return Object.freeze({ cleared: 0 })
    const cleared = previousReports.length
    previousReports.length = 0
    return Object.freeze({ cleared })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    lifetime.abort()
    consents.clear()
    previousReports.length = 0
    networkProbe.dispose?.()
  }

  return Object.freeze({ clearHistory, dispose, history, prepareNetwork, run, runNetwork })
}

/** Register diagnostics on an isolated loopback-only RPC channel. */
export function registerCodexDiagnosticsRpc(ctx, diagnostics) {
  const bridge = new CodexDiagnosticsBridge(diagnostics)
  ctx.connection.rpc.handle(
    CODEX_DIAGNOSTICS_RPC_CHANNEL,
    createCodexDiagnosticsRpcHandler(bridge),
    { authority: "loopback" },
  )
  ctx.effect?.(() => () => bridge.dispose(), "dsh-codex: diagnostics RPC state")
  return bridge
}

export class CodexDiagnosticsBridge {
  #diagnostics
  #disposed = false

  constructor(diagnostics) {
    if (
      diagnostics === null
      || typeof diagnostics !== "object"
      || typeof diagnostics.run !== "function"
      || typeof diagnostics.prepareNetwork !== "function"
      || typeof diagnostics.runNetwork !== "function"
      || typeof diagnostics.history !== "function"
      || typeof diagnostics.clearHistory !== "function"
    ) {
      throw new TypeError(
        "diagnostics must provide run, prepareNetwork, runNetwork, history, and clearHistory",
      )
    }
    this.#diagnostics = diagnostics
  }

  run(payload, signal) {
    const input = objectInput(payload)
    assertOnlyKeys(input, ["mode"])
    if (!PASSIVE_MODES.has(input.mode)) throw new RpcInputError("mode must be local or account")
    return this.#service().run(input.mode, signal)
  }

  prepareNetwork(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, [])
    return this.#service().prepareNetwork(signal)
  }

  runNetwork(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, ["consentId"])
    if (
      typeof input.consentId !== "string"
      || input.consentId.length < 1
      || input.consentId.length > 64
    ) {
      throw new RpcInputError("consentId must be a bounded string")
    }
    return this.#service().runNetwork(input.consentId, signal)
  }

  history(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, [])
    return this.#service().history()
  }

  clearHistory(payload, signal) {
    throwIfCancelled(signal)
    const input = objectInput(payload)
    assertOnlyKeys(input, [])
    return this.#service().clearHistory()
  }

  dispose() {
    this.#disposed = true
  }

  dispatch(endpoint, payload, signal) {
    this.#service()
    switch (endpoint) {
      case "run": return this.run(payload, signal)
      case "prepare-network": return this.prepareNetwork(payload, signal)
      case "run-network": return this.runNetwork(payload, signal)
      case "history": return this.history(payload, signal)
      case "clear-history": return this.clearHistory(payload, signal)
      default: throw new RpcInputError("Unknown diagnostics RPC endpoint")
    }
  }

  #service() {
    if (this.#disposed) throw new Error("diagnostics RPC bridge is disposed")
    return this.#diagnostics
  }
}

/** Convert all failures into a bounded RPC envelope without raw messages. */
export function createCodexDiagnosticsRpcHandler(bridge) {
  if (bridge === null || typeof bridge !== "object" || typeof bridge.dispatch !== "function") {
    throw new TypeError("bridge must provide dispatch")
  }
  return async (endpoint, payload, signal) => {
    try {
      return { ok: true, value: await bridge.dispatch(endpoint, payload, signal) }
    } catch (error) {
      if (error instanceof RpcInputError) {
        return {
          ok: false,
          error: { code: "bad-request", message: error.message, details: { issues: [] } },
        }
      }
      if (error instanceof DiagnosticConsentError) {
        return {
          ok: false,
          error: {
            code: "consent-invalid",
            message: "Network diagnostic consent is missing or expired",
            details: {},
          },
        }
      }
      return {
        ok: false,
        error: { code: "internal", message: "Connection diagnostic failed", details: {} },
      }
    }
  }
}

function credentialCheck(credential) {
  const facts = {
    configured: credential.configured,
    state: credential.state,
    writable: credential.writable,
  }
  if (credential.state === "invalid") {
    return check("credential", "fail", { code: "credential-invalid", facts })
  }
  if (credential.state === "signed-out") {
    return check("credential", "warning", { code: "credential-signed-out", facts })
  }
  if (!credential.writable) {
    return check("credential", "warning", { code: "credential-read-only", facts })
  }
  return check("credential", "pass", { code: "credential-ready", facts })
}

function modelsCheck(snapshot) {
  if (snapshot === undefined) {
    return check("models", "fail", { code: "models-unavailable" })
  }
  if (snapshot.catalogCount === 0) {
    return check("models", "fail", {
      code: "catalog-empty",
      facts: modelFacts(snapshot),
    })
  }
  if (snapshot.enabledCount === 0) {
    return check("models", "warning", {
      code: "models-disabled",
      facts: modelFacts(snapshot),
    })
  }
  return check("models", "pass", {
    code: "models-ready",
    facts: modelFacts(snapshot),
  })
}

function modelFacts(snapshot) {
  return {
    catalogCount: snapshot.catalogCount,
    enabledCount: snapshot.enabledCount,
    selection: snapshot.selection,
    allEnabled: snapshot.catalogCount === snapshot.enabledCount,
  }
}

function accountUsageCheck(value) {
  if (value === null || typeof value !== "object" || !Array.isArray(value.rateLimits)) {
    return check("account-usage", "fail", { code: "account-usage-invalid" })
  }
  let primaryWindows = 0
  let secondaryWindows = 0
  for (const limit of value.rateLimits) {
    if (limit !== null && typeof limit === "object") {
      if (limit.primary !== undefined) primaryWindows += 1
      if (limit.secondary !== undefined) secondaryWindows += 1
    }
  }
  const facts = {
    rateLimitCount: value.rateLimits.length,
    primaryWindows,
    secondaryWindows,
  }
  if (primaryWindows === 0 && secondaryWindows === 0) {
    return check("account-usage", "warning", { code: "account-usage-empty", facts })
  }
  return check("account-usage", "pass", { code: "account-usage-ready", facts })
}

function networkRequestCheck(value, modelId) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.kind !== "string"
    || typeof value.outputObserved !== "boolean"
  ) {
    return check("model-request", "fail", { code: "model-request-unavailable" })
  }
  if (value.kind === "model-unavailable") {
    return check("model-request", "fail", { code: "model-request-unavailable" })
  }
  if (value.kind === "cancelled") return cancelledCheck("model-request")
  if (value.kind === "busy") {
    return check("model-request", "fail", { code: "model-request-busy" })
  }
  if (!isCodexNetworkProbeModelId(modelId)) {
    return check("model-request", "fail", { code: "model-request-unavailable" })
  }
  const facts = { attempted: true, outputObserved: value.outputObserved, modelId }
  switch (value.kind) {
    case "cancelled-after-attempt": return check("model-request", "warning", {
      code: "model-request-cancelled-after-attempt",
      facts,
    })
    case "success": return check("model-request", "pass", {
      code: "model-request-ready",
      facts,
    })
    case "max-tokens": return check("model-request", "warning", {
      code: "model-request-max-tokens",
      facts,
    })
    case "unexpected-tool-call": return check("model-request", "warning", {
      code: "model-request-tool-call",
      facts,
    })
    case "empty-response": return check("model-request", "warning", {
      code: "model-response-empty",
      facts,
    })
    case "auth": return check("model-request", "fail", { code: "model-request-auth-error", facts })
    case "quota": return check("model-request", "fail", { code: "model-request-quota-exhausted", facts })
    case "rate-limit": return check("model-request", "fail", { code: "model-request-rate-limited", facts })
    case "timeout": return check("model-request", "fail", { code: "model-request-timeout", facts })
    case "server": return check("model-request", "fail", { code: "model-request-server-error", facts })
    case "transport":
    case "stream-closed": return check("model-request", "fail", { code: "model-request-transport-error", facts })
    case "unsupported": return check("model-request", "fail", { code: "model-request-unsupported", facts })
    case "invalid-request": return check("model-request", "fail", { code: "model-request-invalid", facts })
    case "provider-error": return check("model-request", "fail", { code: "model-request-provider-error", facts })
    case "unknown-model": return check("model-request", "fail", { code: "model-request-unknown-model", facts })
    case "missing-credential": return check("model-request", "fail", { code: "model-request-credential-missing", facts })
    case "aborted": return check("model-request", "fail", { code: "model-request-aborted", facts })
    default: return check("model-request", "fail", { code: "model-request-failed", facts })
  }
}

function publicAccountUsageFailureCode(error) {
  let code
  let status
  try {
    code = error?.code
    status = error?.status
  } catch {
    return "account-usage-unavailable"
  }
  switch (code) {
    case "AUTH_UNAVAILABLE": return "account-auth-unavailable"
    case "NETWORK": return "account-network-unavailable"
    case "TIMEOUT": return "account-timeout"
    case "HTTP_STATUS": {
      if (status === 401 || status === 403) return "account-http-auth-error"
      if (status === 429) return "account-http-rate-limited"
      if (Number.isInteger(status) && status >= 500 && status <= 599) {
        return "account-http-server-error"
      }
      return "account-http-error"
    }
    case "BODY_TOO_LARGE":
    case "INVALID_CONTENT_TYPE":
    case "INVALID_RESPONSE":
    case "REDIRECT": return "account-response-invalid"
    default: return "account-usage-unavailable"
  }
}

function normalizeRuntimeSnapshot(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("runtime snapshot must be an object")
  }
  if (value.route !== CODEX_ROUTE_ID || typeof value.routeRegistered !== "boolean") {
    throw new TypeError("runtime route snapshot is invalid")
  }
  if (!Array.isArray(value.catalog) || !Array.isArray(value.enabledModels)) {
    throw new TypeError("runtime model snapshot is invalid")
  }
  if (!SELECTIONS.has(value.selection)) throw new TypeError("runtime model selection is invalid")

  const catalog = modelIds(value.catalog, "catalog")
  const enabled = modelIds(value.enabledModels, "enabled models")
  for (const id of enabled) {
    if (!catalog.has(id)) throw new TypeError("enabled model is absent from catalog")
  }
  if (value.selection === "all" && enabled.size !== catalog.size) {
    throw new TypeError("all-model selection does not cover the catalog")
  }
  return Object.freeze({
    routeRegistered: value.routeRegistered,
    catalogCount: catalog.size,
    enabledCount: enabled.size,
    enabledModelIds: Object.freeze([...enabled]),
    selection: value.selection,
  })
}

function modelIds(entries, name) {
  const result = new Set()
  for (const entry of entries) {
    const id = typeof entry === "string" ? entry : entry?.id
    if (!isCodexNetworkProbeModelId(id) || result.has(id)) {
      throw new TypeError(`${name} contains an invalid model identifier`)
    }
    result.add(id)
  }
  return result
}

function normalizeCredential(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("credential description must be an object")
  }
  if (
    typeof value.configured !== "boolean"
    || typeof value.writable !== "boolean"
    || !CREDENTIAL_STATES.has(value.state)
  ) {
    throw new TypeError("credential description is invalid")
  }
  if (value.state === "signed-in" && !value.configured) {
    throw new TypeError("signed-in credential must be configured")
  }
  if (value.state === "invalid" && !value.configured) {
    throw new TypeError("invalid credential must be configured")
  }
  return Object.freeze({
    configured: value.configured,
    state: value.state,
    writable: value.writable,
  })
}

function check(id, status, { code, facts } = {}) {
  return Object.freeze({
    id,
    status,
    code,
    ...(facts === undefined ? {} : { facts: Object.freeze({ ...facts }) }),
  })
}

function cancelledCheck(id) {
  return check(id, "skipped", { code: "cancelled" })
}

function appendCancelledChecks(checks, expectedIds) {
  const completed = new Set(checks.map(({ id }) => id))
  for (const id of expectedIds) {
    if (!completed.has(id)) checks.push(cancelledCheck(id))
  }
}

function appendPreflightTimeoutChecks(checks, expectedIds) {
  const completed = new Set(checks.map(({ id }) => id))
  let timedOut = false
  for (const id of expectedIds) {
    if (completed.has(id)) continue
    checks.push(check(id, timedOut ? "skipped" : "fail", {
      code: timedOut ? "preflight-not-run" : "preflight-timeout",
    }))
    timedOut = true
  }
}

function outcomeFor(checks) {
  if (checks.some(({ status, code }) => status === "fail" && code === "preflight-timeout")) {
    return "fail"
  }
  if (checks.some(({ status }) => status === "skipped")) return "cancelled"
  if (checks.some(({ status }) => status === "fail")) return "fail"
  if (checks.some(({ status }) => status === "warning")) return "warning"
  return "pass"
}

function report(mode, outcome, checks, clock) {
  let observedAt
  try {
    observedAt = clock()
  } catch {
    observedAt = 0
  }
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) observedAt = 0
  return Object.freeze({
    version: REPORT_VERSION,
    mode,
    outcome,
    observedAt,
    checks: Object.freeze([...checks]),
  })
}

function readClock(clock) {
  let value
  try {
    value = clock()
  } catch {
    value = 0
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function expireConsents(consents, now) {
  for (const [consentId, consent] of consents) {
    if (consent.expiresAt <= now) consents.delete(consentId)
  }
}

function plainOptions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("diagnostic options must be an object")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("diagnostic options must be a plain object")
  }
  const allowed = new Set([
    "accountUsageReader",
    "clock",
    "describeCredential",
    "getRuntimeSnapshot",
    "historyLimit",
    "networkPreflightTimeoutMs",
    "networkProbe",
  ])
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("diagnostic options contain an unknown field")
  }
  return value
}

function diagnosticStep(operation, signal) {
  if (signal?.aborted === true) return Promise.resolve({ kind: "aborted" })
  const attempt = Promise.resolve().then(operation).then(
    (value) => ({ kind: "completed", value }),
    (error) => ({ kind: "failed", error }),
  )
  if (signal === undefined) return attempt
  let listener
  const aborted = new Promise((resolve) => {
    listener = () => resolve({ kind: "aborted" })
    signal.addEventListener("abort", listener, { once: true })
  })
  return Promise.race([attempt, aborted]).finally(() => {
    signal.removeEventListener("abort", listener)
  })
}

function requiredFunction(value, name) {
  if (typeof value[name] !== "function") throw new TypeError(`${name} must be a function`)
  return value[name]
}

function objectInput(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcInputError("RPC payload must be an object")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RpcInputError("RPC payload must be a plain object")
  }
  return value
}

function assertOnlyKeys(value, allowed) {
  const accepted = new Set(allowed)
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !accepted.has(key))) {
    throw new RpcInputError("RPC payload contains an unknown field")
  }
}

function assertAbortSignal(value) {
  if (value !== undefined && !(value instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal")
  }
}

function throwIfCancelled(signal) {
  assertAbortSignal(signal)
  if (signal?.aborted === true) throw new RpcInputError("Request cancelled")
}
