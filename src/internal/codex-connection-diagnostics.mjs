import { CODEX_ROUTE_ID } from "./codex-identifiers.mjs"

export const CODEX_DIAGNOSTICS_RPC_CHANNEL = "/dsh-codex-diagnostics"

const REPORT_VERSION = 1
const MODES = new Set(["local", "account"])
const CREDENTIAL_STATES = new Set(["signed-in", "signed-out", "invalid"])
const SELECTIONS = new Set(["all", "custom"])
const LOCAL_CHECK_IDS = Object.freeze(["runtime", "credential", "models"])
const ACCOUNT_CHECK_IDS = Object.freeze([...LOCAL_CHECK_IDS, "account-usage"])

class RpcInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "RpcInputError"
  }
}

/**
 * Build a bounded, read-only diagnostic surface for the installed Codex route.
 *
 * `local` calls only the process-local snapshot and credential metadata seams.
 * `account` performs those same checks and then calls AccountUsageReader once;
 * it never owns or receives an LLM stream function. Reports are constructed
 * from fixed check IDs, status codes, and primitive facts so provider failures,
 * OAuth grants, account identifiers, and tokens cannot cross the interface.
 */
export function createCodexConnectionDiagnostics(options) {
  const input = plainOptions(options)
  const getRuntimeSnapshot = requiredFunction(input, "getRuntimeSnapshot")
  const describeCredential = requiredFunction(input, "describeCredential")
  const accountUsageReader = input.accountUsageReader
  const clock = input.clock ?? Date.now

  if (accountUsageReader?.read === undefined || typeof accountUsageReader.read !== "function") {
    throw new TypeError("accountUsageReader must provide read")
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function")

  async function run(mode, signal) {
    if (!MODES.has(mode)) throw new TypeError("diagnostic mode must be local or account")
    assertAbortSignal(signal)

    const expectedIds = mode === "account" ? ACCOUNT_CHECK_IDS : LOCAL_CHECK_IDS
    if (signal?.aborted === true) {
      return report(mode, "cancelled", expectedIds.map(cancelledCheck), clock)
    }

    const checks = []
    let runtimeSnapshot
    try {
      runtimeSnapshot = normalizeRuntimeSnapshot(await getRuntimeSnapshot())
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

    if (signal?.aborted === true) {
      appendCancelledChecks(checks, expectedIds)
      return report(mode, "cancelled", checks, clock)
    }

    try {
      const credential = normalizeCredential(await describeCredential())
      checks.push(credentialCheck(credential))
    } catch {
      checks.push(check("credential", "fail", { code: "credential-unavailable" }))
    }

    if (signal?.aborted === true) {
      appendCancelledChecks(checks, expectedIds)
      return report(mode, "cancelled", checks, clock)
    }

    checks.push(modelsCheck(runtimeSnapshot))

    if (mode === "account") {
      if (signal?.aborted === true) {
        checks.push(cancelledCheck("account-usage"))
        return report(mode, "cancelled", checks, clock)
      }

      try {
        const usage = await accountUsageReader.read({ signal })
        if (signal?.aborted === true) {
          checks.push(cancelledCheck("account-usage"))
          return report(mode, "cancelled", checks, clock)
        }
        checks.push(accountUsageCheck(usage))
      } catch (error) {
        if (signal?.aborted === true || error?.code === "ABORTED") {
          checks.push(cancelledCheck("account-usage"))
          return report(mode, "cancelled", checks, clock)
        }
        checks.push(check("account-usage", "fail", {
          code: publicAccountUsageFailureCode(error?.code),
        }))
      }
    }

    return report(mode, outcomeFor(checks), checks, clock)
  }

  return Object.freeze({ run })
}

/** Register diagnostics on an isolated loopback-only RPC channel. */
export function registerCodexDiagnosticsRpc(ctx, diagnostics) {
  const bridge = new CodexDiagnosticsBridge(diagnostics)
  ctx.connection.rpc.handle(
    CODEX_DIAGNOSTICS_RPC_CHANNEL,
    createCodexDiagnosticsRpcHandler(bridge),
    { authority: "loopback" },
  )
  return bridge
}

export class CodexDiagnosticsBridge {
  #diagnostics

  constructor(diagnostics) {
    if (diagnostics === null || typeof diagnostics !== "object" || typeof diagnostics.run !== "function") {
      throw new TypeError("diagnostics must provide run")
    }
    this.#diagnostics = diagnostics
  }

  run(payload, signal) {
    const input = objectInput(payload)
    assertOnlyKeys(input, ["mode"])
    if (!MODES.has(input.mode)) throw new RpcInputError("mode must be local or account")
    return this.#diagnostics.run(input.mode, signal)
  }

  dispatch(endpoint, payload, signal) {
    if (endpoint !== "run") throw new RpcInputError("Unknown diagnostics RPC endpoint")
    return this.run(payload, signal)
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

function publicAccountUsageFailureCode(code) {
  switch (code) {
    case "AUTH_UNAVAILABLE": return "account-auth-unavailable"
    case "NETWORK": return "account-network-unavailable"
    case "TIMEOUT": return "account-timeout"
    case "HTTP_STATUS": return "account-http-error"
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
    selection: value.selection,
  })
}

function modelIds(entries, name) {
  const result = new Set()
  for (const entry of entries) {
    const id = typeof entry === "string" ? entry : entry?.id
    if (typeof id !== "string" || id.length === 0 || id.length > 256 || result.has(id)) {
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

function outcomeFor(checks) {
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

function plainOptions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("diagnostic options must be an object")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("diagnostic options must be a plain object")
  }
  const allowed = new Set(["accountUsageReader", "clock", "describeCredential", "getRuntimeSnapshot"])
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("diagnostic options contain an unknown field")
  }
  return value
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
