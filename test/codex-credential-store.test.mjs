import assert from "node:assert/strict"
import test from "node:test"

import {
  CODEX_CREDENTIAL_KEY,
  CODEX_PROVIDER_ID,
  CodexCredentialStoreError,
  createCodexCredentialStore,
} from "../src/internal/codex-credential-store.mjs"

const OAUTH_FIXTURE = Object.freeze({
  type: "oauth",
  access: "access-fixture",
  refresh: "refresh-fixture",
  expires: 4_102_444_800_000,
  accountId: "account-fixture",
})

test("Codex credential store owns one scoped grant and never enumerates another scope", async () => {
  const calls = []
  const credentials = {
    async readRecord(key) {
      calls.push(["read", key])
      return { kind: "grant", payload: OAUTH_FIXTURE }
    },
    async describeRecord(key) {
      calls.push(["describe", key])
      return { configured: true, kind: "grant", writable: true }
    },
    async listRecords() {
      throw new Error("the adapter must not enumerate unrelated records")
    },
    async modifyRecord() {
      throw new Error("not used")
    },
    async deleteRecord() {
      throw new Error("not used")
    },
  }
  const store = createCodexCredentialStore(credentials)

  assert.equal(CODEX_CREDENTIAL_KEY, "dsh-codex/openai-codex")
  assert.deepEqual(await store.read(CODEX_PROVIDER_ID), OAUTH_FIXTURE)
  assert.equal(await store.read("another-provider"), undefined)
  assert.deepEqual(await store.list(), [{ providerId: CODEX_PROVIDER_ID, type: "oauth" }])
  assert.deepEqual(calls, [
    ["read", CODEX_CREDENTIAL_KEY],
    ["describe", CODEX_CREDENTIAL_KEY],
  ])
})

test("serialized modify stores only a validated OAuth grant and returns a detached value", async () => {
  let record = { kind: "grant", payload: OAUTH_FIXTURE }
  const credentials = {
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: true, kind: "grant", writable: true }
    },
    async modifyRecord(key, mutate) {
      assert.equal(key, CODEX_CREDENTIAL_KEY)
      const next = await mutate(record)
      if (next !== undefined) record = next
      return record
    },
    async deleteRecord() {
      record = undefined
    },
  }
  const store = createCodexCredentialStore(credentials)
  const replacement = {
    ...OAUTH_FIXTURE,
    access: "rotated-access",
    nested: { compatibleFutureField: true },
  }

  const result = await store.modify(CODEX_PROVIDER_ID, async (current) => {
    assert.deepEqual(current, OAUTH_FIXTURE)
    return replacement
  })

  replacement.nested.compatibleFutureField = false
  assert.deepEqual(record, {
    kind: "grant",
    payload: {
      ...OAUTH_FIXTURE,
      access: "rotated-access",
      nested: { compatibleFutureField: true },
    },
  })
  assert.notEqual(result, record.payload)
  assert.equal(result.nested.compatibleFutureField, true)

  await store.delete(CODEX_PROVIDER_ID)
  assert.equal(record, undefined)
  await store.delete("another-provider")
})

test("corrupt or api-key records fail closed without including credential contents", async () => {
  for (const record of [
    { kind: "api-key", key: "must-not-appear" },
    { kind: "grant", payload: { ...OAUTH_FIXTURE, refresh: "" } },
    { kind: "grant", payload: { ...OAUTH_FIXTURE, expires: Number.POSITIVE_INFINITY } },
  ]) {
    const store = createCodexCredentialStore({
      async readRecord() {
        return record
      },
      async describeRecord() {
        return { configured: true, kind: record.kind, writable: true }
      },
      async modifyRecord() {
        throw new Error("not used")
      },
      async deleteRecord() {},
    })

    await assert.rejects(
      store.read(CODEX_PROVIDER_ID),
      (error) => error instanceof CodexCredentialStoreError
        && !error.message.includes("must-not-appear")
        && !error.message.includes("refresh-fixture"),
    )
  }
})

test("login-style overwrite can repair an incompatible owned record", async () => {
  let record = { kind: "api-key", key: "legacy-fixture" }
  const store = createCodexCredentialStore({
    async readRecord() {
      return record
    },
    async describeRecord() {
      return { configured: true, kind: record.kind, writable: true }
    },
    async modifyRecord(_key, mutate) {
      const next = await mutate(record)
      if (next !== undefined) record = next
      return record
    },
    async deleteRecord() {},
  })

  const result = await store.modify(CODEX_PROVIDER_ID, async (current) => {
    assert.equal(current, undefined)
    return OAUTH_FIXTURE
  })

  assert.deepEqual(result, OAUTH_FIXTURE)
  assert.deepEqual(record, { kind: "grant", payload: OAUTH_FIXTURE })
})

test("the OAuth-only store refuses api-key writes and unknown provider writes", async () => {
  const store = createCodexCredentialStore({
    async readRecord() {
      return undefined
    },
    async describeRecord() {
      return { configured: false, writable: true }
    },
    async modifyRecord(_key, mutate) {
      return mutate(undefined)
    },
    async deleteRecord() {},
  })

  await assert.rejects(
    store.modify("another-provider", async () => OAUTH_FIXTURE),
    (error) => error instanceof CodexCredentialStoreError,
  )
  await assert.rejects(
    store.modify(CODEX_PROVIDER_ID, async () => ({ type: "api_key", key: "not-supported" })),
    (error) => error instanceof CodexCredentialStoreError
      && !error.message.includes("not-supported"),
  )
})
