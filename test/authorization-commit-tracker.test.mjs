import assert from "node:assert/strict"
import test from "node:test"

import { createAuthorizationCommitTracker } from "../src/internal/authorization-commit-tracker.mjs"

test("authorization commit tracker keeps cancellation and commit selection atomic", () => {
  const tracker = createAuthorizationCommitTracker()
  const cancelled = []
  const attempt = tracker.begin()

  assert.equal(tracker.tryCancel(() => cancelled.push("precommit")), true)
  assert.deepEqual(cancelled, ["precommit"])
  assert.equal(attempt.selectCommit(), true)
  assert.equal(tracker.tryCancel(() => cancelled.push("too-late")), false)
  assert.deepEqual(cancelled, ["precommit"])
  assert.equal(tracker.isCommitPending(), true)

  attempt.finish()
  assert.equal(tracker.isCommitPending(), true)
  tracker.settle()
  assert.equal(tracker.isCommitPending(), false)
})

test("a stale authorization handle cannot clear or select a newer generation", () => {
  const tracker = createAuthorizationCommitTracker()
  const stale = tracker.begin()
  tracker.settle()
  const current = tracker.begin()

  stale.finish()
  assert.equal(stale.selectCommit(), false)
  assert.equal(current.selectCommit(), true)
  assert.equal(tracker.isCommitPending(), true)
  tracker.settle()
})

test("a cancellable attempt releases tracking when it finishes without selecting a commit", () => {
  const tracker = createAuthorizationCommitTracker()
  const attempt = tracker.begin()
  attempt.finish()

  assert.equal(tracker.isCommitPending(), false)
  assert.doesNotThrow(() => tracker.begin())
  assert.throws(() => tracker.tryCancel(undefined), /cancel must be a function/u)
})
