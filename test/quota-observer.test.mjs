import assert from "node:assert/strict"
import test from "node:test"

import { createQuotaObserver } from "../src/internal/quota-observer.mjs"

function fakeClock(initial = 0) {
  let now = initial
  return {
    clock: () => now,
    set(value) {
      now = value
    },
  }
}

test("starts unknown and returns a frozen JSON-safe snapshot", () => {
  const observer = createQuotaObserver({ clock: () => 1_000, staleMs: 100 })
  const snapshot = observer.snapshot()

  assert.deepEqual(snapshot, { status: "unknown" })
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(observer), true)
  assert.throws(() => {
    snapshot.status = "exhausted"
  }, TypeError)
})

test("recent success remains valid before the stale boundary and then becomes unknown", () => {
  const time = fakeClock(1_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 100 })

  assert.deepEqual(observer.observeSuccess(1_000), {
    status: "recent-success",
    observedAt: 1_000,
  })
  time.set(1_099)
  assert.equal(observer.snapshot().status, "recent-success")
  time.set(1_100)
  assert.deepEqual(observer.snapshot(), { status: "unknown" })
})

test("known reset keeps quota exhausted until the exact reset boundary", () => {
  const time = fakeClock(2_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 10 })

  const observed = observer.observeQuota({ observedAt: 2_000, resetAt: 2_500 })
  assert.deepEqual(observed, {
    status: "exhausted",
    observedAt: 2_000,
    resetAt: 2_500,
  })
  assert.equal(Object.isFrozen(observed), true)

  time.set(2_499)
  assert.equal(observer.snapshot().status, "exhausted")
  time.set(2_500)
  assert.deepEqual(observer.snapshot(), { status: "unknown" })
  time.set(9_000)
  assert.deepEqual(observer.snapshot(), { status: "unknown" })
})

test("quota without reset uses a finite stale window", () => {
  const time = fakeClock(3_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 250 })

  const observed = observer.observeQuota({ observedAt: 3_000 })
  assert.deepEqual(observed, {
    status: "exhausted",
    observedAt: 3_000,
  })
  assert.equal("resetAt" in observed, false)

  time.set(3_249)
  assert.equal(observer.snapshot().status, "exhausted")
  time.set(3_250)
  assert.deepEqual(observer.snapshot(), { status: "unknown" })
})

test("an implausibly distant reset is discarded and cannot pin exhausted state", () => {
  const time = fakeClock(3_000)
  const observer = createQuotaObserver({
    clock: time.clock,
    staleMs: 250,
    maxResetHorizonMs: 1_000,
  })

  const observed = observer.observeQuota({ observedAt: 3_000, resetAt: 4_001 })
  assert.deepEqual(observed, {
    status: "exhausted",
    observedAt: 3_000,
  })

  time.set(3_249)
  assert.equal(observer.snapshot().status, "exhausted")
  time.set(3_250)
  assert.deepEqual(observer.snapshot(), { status: "unknown" })
})

test("a reset at the accepted horizon remains observable", () => {
  const time = fakeClock(3_000)
  const observer = createQuotaObserver({
    clock: time.clock,
    staleMs: 100,
    maxResetHorizonMs: 1_000,
  })

  assert.deepEqual(observer.observeQuota({ observedAt: 3_000, resetAt: 4_000 }), {
    status: "exhausted",
    observedAt: 3_000,
    resetAt: 4_000,
  })
  time.set(3_999)
  assert.equal(observer.snapshot().status, "exhausted")
  time.set(4_000)
  assert.deepEqual(observer.snapshot(), { status: "unknown" })
})

test("a quota observation whose reset has already arrived is immediately unknown", () => {
  const time = fakeClock(4_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 100 })

  assert.deepEqual(
    observer.observeQuota({ observedAt: 4_000, resetAt: 4_000 }),
    { status: "unknown" },
  )
  assert.deepEqual(
    observer.observeQuota({ observedAt: 4_100, resetAt: 4_050 }),
    { status: "unknown" },
  )
})

test("new observations replace older state while delayed observations are ignored", () => {
  const time = fakeClock(5_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 1_000 })

  observer.observeQuota({ observedAt: 5_000, resetAt: 5_800 })
  observer.observeSuccess(5_100)
  assert.equal(observer.snapshot().status, "recent-success")

  observer.observeQuota({ observedAt: 5_050, resetAt: 5_900 })
  assert.equal(observer.snapshot().status, "recent-success")

  observer.observeQuota({ observedAt: 5_100, resetAt: 5_900 })
  assert.equal(observer.snapshot().status, "exhausted")
})

test("previous snapshots remain immutable and detached from later transitions", () => {
  const time = fakeClock(6_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 100 })
  const exhausted = observer.observeQuota({ observedAt: 6_000, resetAt: 6_500 })

  time.set(6_100)
  const success = observer.observeSuccess(6_100)

  assert.deepEqual(exhausted, {
    status: "exhausted",
    observedAt: 6_000,
    resetAt: 6_500,
  })
  assert.deepEqual(success, {
    status: "recent-success",
    observedAt: 6_100,
  })
  assert.notEqual(exhausted, success)
  assert.equal(Object.isFrozen(exhausted), true)
  assert.equal(Object.isFrozen(success), true)
})

test("snapshot contains only redacted state and timestamps", () => {
  const time = fakeClock(7_000)
  const observer = createQuotaObserver({ clock: time.clock, staleMs: 100 })
  const snapshot = observer.observeQuota({ observedAt: 7_000, resetAt: 8_000 })
  const serialized = JSON.stringify(snapshot)

  assert.deepEqual(Object.keys(snapshot), ["status", "observedAt", "resetAt"])
  assert.doesNotMatch(serialized, /request|account|message|token|secret/iu)
  assert.deepEqual(JSON.parse(serialized), snapshot)
})

for (const invalid of [null, [], "options", 1]) {
  test(`rejects non-object options ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => createQuotaObserver(invalid), /options must be a plain object/u)
  })
}

for (const invalid of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "100"]) {
  test(`rejects invalid staleMs ${String(invalid)}`, () => {
    assert.throws(
      () => createQuotaObserver({ staleMs: invalid }),
      /staleMs must be a positive safe integer/u,
    )
  })
}

for (const invalid of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "100"]) {
  test(`rejects invalid maxResetHorizonMs ${String(invalid)}`, () => {
    assert.throws(
      () => createQuotaObserver({ maxResetHorizonMs: invalid }),
      /maxResetHorizonMs must be a positive safe integer/u,
    )
  })
}

test("rejects invalid clocks, clock results, and unknown options", () => {
  assert.throws(() => createQuotaObserver({ clock: 1 }), /clock must be a function/u)
  assert.throws(
    () => createQuotaObserver({ clock: () => Number.NaN }).snapshot(),
    /clock\(\) must be a non-negative safe integer/u,
  )
  assert.throws(
    () => createQuotaObserver({ clock: () => 1.5 }).snapshot(),
    /clock\(\) must be a non-negative safe integer/u,
  )
  assert.throws(
    () => createQuotaObserver({ staleMs: 100, extra: true }),
    /unknown quota observer option: extra/u,
  )
})

test("strictly validates observations without retaining extra provider data", () => {
  const observer = createQuotaObserver({ clock: () => 0, staleMs: 100 })

  for (const invalid of [undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => observer.observeSuccess(invalid),
      /now must be a non-negative safe integer/u,
    )
  }

  for (const invalid of [undefined, null, [], "quota"]) {
    assert.throws(
      () => observer.observeQuota(invalid),
      /quota observation must be a plain object/u,
    )
  }

  assert.throws(
    () => observer.observeQuota({}),
    /observedAt must be a non-negative safe integer/u,
  )
  assert.throws(
    () => observer.observeQuota({ observedAt: 0, resetAt: -1 }),
    /resetAt must be a non-negative safe integer/u,
  )
  assert.throws(
    () => observer.observeQuota({ observedAt: 0, requestId: "secret-fixture" }),
    /unknown quota observation field: requestId/u,
  )
})
