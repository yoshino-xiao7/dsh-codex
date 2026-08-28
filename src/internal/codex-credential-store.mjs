import {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
} from "./codex-identifiers.mjs"

export {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
} from "./codex-identifiers.mjs"

const MAX_JSON_DEPTH = 24
const MAX_JSON_NODES = 8_192
const MAX_STRING_CHARS = 1_048_576

export class CodexCredentialStoreError extends Error {
  constructor(message, code = "INVALID_CODEX_CREDENTIAL", options) {
    super(message, options)
    this.name = "CodexCredentialStoreError"
    this.code = code
  }
}

/**
 * Adapt the Harness credential-record seam to pi-ai's provider-scoped store.
 *
 * The adapter owns exactly one record. It never enumerates or interprets any
 * other plugin's records, and it accepts OAuth grants only: an API key cannot
 * accidentally become an alternate authentication path for this provider.
 */
export function createCodexCredentialStore(credentials) {
  if (credentials === null || typeof credentials !== "object") {
    throw new TypeError("credentials must be a credential provider")
  }

  return Object.freeze({
    async read(providerId) {
      if (providerId !== CODEX_PROVIDER_ID) return undefined
      return credentialFromRecord(await credentials.readRecord(CODEX_CREDENTIAL_KEY), true)
    },

    async list() {
      const info = await credentials.describeRecord(CODEX_CREDENTIAL_KEY)
      if (info.configured !== true) return []
      if (info.kind !== "grant") {
        throw invalidCredential("stored Codex credential is not an OAuth grant")
      }
      return [{ providerId: CODEX_PROVIDER_ID, type: "oauth" }]
    },

    async modify(providerId, mutate) {
      if (providerId !== CODEX_PROVIDER_ID) {
        throw new CodexCredentialStoreError(
          "the Codex credential store does not own this provider",
          "UNOWNED_PROVIDER",
        )
      }
      if (typeof mutate !== "function") throw new TypeError("mutate must be a function")

      const result = await credentials.modifyRecord(CODEX_CREDENTIAL_KEY, async (current) => {
        // An explicit sign-in may repair an incompatible record. Request-time
        // refresh still fails closed because a callback returning undefined
        // leaves the incompatible record untouched and the final decode rejects.
        const decoded = credentialFromRecord(current, false)
        const next = await mutate(decoded)
        return next === undefined ? undefined : recordFromCredential(next)
      })
      return credentialFromRecord(result, true)
    },

    async delete(providerId) {
      if (providerId !== CODEX_PROVIDER_ID) return
      await credentials.deleteRecord(CODEX_CREDENTIAL_KEY)
    },
  })
}

function credentialFromRecord(record, strict) {
  if (record === undefined) return undefined
  if (record?.kind !== "grant") {
    if (!strict) return undefined
    throw invalidCredential("stored Codex credential is not an OAuth grant")
  }

  try {
    return oauthCredential(record.payload)
  } catch (error) {
    if (!strict) return undefined
    if (error instanceof CodexCredentialStoreError) throw error
    throw invalidCredential("stored Codex OAuth grant is invalid", error)
  }
}

function recordFromCredential(credential) {
  return { kind: "grant", payload: oauthCredential(credential) }
}

function oauthCredential(value) {
  const payload = cloneJson(value)
  if (!plainRecord(payload) || payload.type !== "oauth") {
    throw invalidCredential("Codex credentials must use OAuth")
  }
  for (const field of ["access", "refresh"]) {
    if (typeof payload[field] !== "string" || payload[field].length === 0) {
      throw invalidCredential(`Codex OAuth credential is missing ${field}`)
    }
  }
  if (!Number.isSafeInteger(payload.expires) || payload.expires <= 0) {
    throw invalidCredential("Codex OAuth credential has an invalid expiry")
  }
  return payload
}

function cloneJson(value) {
  const state = { nodes: 0, stack: new Set() }
  validateJson(value, state, 0)
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    throw invalidCredential("Codex OAuth credential is not JSON compatible", error)
  }
}

function validateJson(value, state, depth) {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw invalidCredential("Codex OAuth credential exceeds structural limits")
  }
  if (value === null || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidCredential("Codex OAuth credential contains an invalid number")
    return
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_CHARS) throw invalidCredential("Codex OAuth credential contains an oversized string")
    return
  }
  if (typeof value !== "object") {
    throw invalidCredential("Codex OAuth credential contains a non-JSON value")
  }
  if (state.stack.has(value)) throw invalidCredential("Codex OAuth credential contains a cycle")
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw invalidCredential("Codex OAuth credential contains a non-plain object")
  }

  state.stack.add(value)
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, state, depth + 1)
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > MAX_STRING_CHARS) throw invalidCredential("Codex OAuth credential contains an oversized key")
      validateJson(item, state, depth + 1)
    }
  }
  state.stack.delete(value)
}

function plainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalidCredential(message, cause) {
  return new CodexCredentialStoreError(message, "INVALID_CODEX_CREDENTIAL", cause === undefined ? undefined : { cause })
}
