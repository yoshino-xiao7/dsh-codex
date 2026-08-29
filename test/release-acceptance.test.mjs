import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  assertAcceptanceRecord,
  createDraftAcceptanceRecord,
  LIVE_ACCEPTANCE_ASSERTIONS,
} from "../scripts/release-acceptance.mjs"

const acceptancePath = new URL("../docs/releases/v0.0.1.acceptance.json", import.meta.url)
const draft = JSON.parse(await readFile(acceptancePath, "utf8"))

test("draft acceptance enumerates every release-critical live capability", () => {
  assert.doesNotThrow(() => assertAcceptanceRecord(draft, { version: "0.0.1" }))
  assert.deepEqual(
    Object.keys(draft.liveAcceptance).sort(),
    Object.keys(LIVE_ACCEPTANCE_ASSERTIONS).sort(),
  )
})

test("new release acceptance starts from a fresh schema-v3 draft", () => {
  const generated = createDraftAcceptanceRecord("0.0.2")
  assert.doesNotThrow(() => assertAcceptanceRecord(generated, { version: "0.0.2" }))
  assert.equal(generated.releaseStatus, "draft")
  assert.equal(generated.testedCommit, "TBD")
  for (const platform of Object.values(generated.platforms)) {
    assert.equal(platform.status, "pending")
    assert.equal(platform.profileSmoke, "pending")
    assert.equal(platform.dshVersion, "0.1.1-rc.2")
  }
  for (const result of Object.values(generated.liveAcceptance)) {
    assert.equal(result.status, "pending")
    assert.ok(Object.values(result.assertions).every((value) => value === false))
  }
})

test("obsolete acceptance schemas cannot omit reasoning, tools, or replay", () => {
  const obsolete = structuredClone(draft)
  obsolete.schemaVersion = 2
  delete obsolete.liveAcceptance.reasoningStream
  delete obsolete.liveAcceptance.toolRoundTrip
  delete obsolete.liveAcceptance.replayContinuity
  assert.throws(
    () => assertAcceptanceRecord(obsolete, { version: "0.0.1" }),
    /schemaVersion must be 3/u,
  )
})

test("an approved record requires every platform and live assertion to pass", () => {
  const approved = approvedFixture()
  assert.doesNotThrow(() => assertAcceptanceRecord(approved, {
    version: "0.0.1",
    requirePassed: true,
  }))

  approved.liveAcceptance.fastPriority.assertions.priorityRequested = false
  assert.throws(
    () => assertAcceptanceRecord(approved, { version: "0.0.1", requirePassed: true }),
    /fastPriority\.assertions\.priorityRequested must pass/u,
  )
})

test("acceptance rejects missing, renamed, or unreviewed live checks", () => {
  const missing = structuredClone(draft)
  delete missing.liveAcceptance.imageMaxPixels
  assert.throws(
    () => assertAcceptanceRecord(missing, { version: "0.0.1" }),
    /Acceptance liveAcceptance must contain exactly/u,
  )

  const extra = structuredClone(draft)
  extra.liveAcceptance.freeFormClaim = structuredClone(extra.liveAcceptance.transportAuto)
  assert.throws(
    () => assertAcceptanceRecord(extra, { version: "0.0.1" }),
    /Acceptance liveAcceptance must contain exactly/u,
  )
})

test("passed evidence must be timestamped and use a credential-free HTTPS URL", () => {
  const approved = approvedFixture()
  approved.liveAcceptance.textStream.evidenceUrl = "https://example.test/evidence?token=secret"
  assert.throws(
    () => assertAcceptanceRecord(approved, { version: "0.0.1", requirePassed: true }),
    /must not contain credentials, query data, or fragments/u,
  )
})

test("platform evidence must use the exact DSH runtime and a tested Node line", () => {
  for (const [field, value, pattern] of [
    ["dshVersion", "0.1.1-rc.3", /dshVersion must be 0\.1\.1-rc\.2/u],
    ["nodeVersion", "20.19.0", /must use the tested Node 22 or 24 line/u],
    ["nodeVersion", "22.18.9", /must be at least 22\.19\.0/u],
    ["nodeVersion", "23.11.0", /must use the tested Node 22 or 24 line/u],
  ]) {
    const approved = approvedFixture()
    approved.platforms.linux[field] = value
    assert.throws(
      () => assertAcceptanceRecord(approved, { version: "0.0.1", requirePassed: true }),
      pattern,
    )
  }

  const node24 = approvedFixture()
  node24.platforms.windows.nodeVersion = "v24.0.0"
  assert.doesNotThrow(() => assertAcceptanceRecord(node24, {
    version: "0.0.1",
    requirePassed: true,
  }))
})

function approvedFixture() {
  const acceptance = structuredClone(draft)
  acceptance.releaseStatus = "approved"
  acceptance.testedCommit = "a".repeat(40)
  acceptance.approvedBy = "release-maintainer"
  acceptance.approvedAt = "2026-08-29T00:00:00Z"
  acceptance.approvalEvidenceUrl = "https://example.test/approval"

  for (const [platform, result] of Object.entries(acceptance.platforms)) {
    result.status = "passed"
    result.profileSmoke = "passed"
    result.testedAt = "2026-08-29T00:00:00Z"
    result.runner = `${platform}-controlled-runner`
    result.nodeVersion = "22.22.2"
    result.dshVersion = "0.1.1-rc.2"
    result.evidenceUrl = `https://example.test/platform/${platform}`
  }

  for (const [check, result] of Object.entries(acceptance.liveAcceptance)) {
    result.status = "passed"
    result.testedAt = "2026-08-29T00:00:00Z"
    result.evidenceUrl = `https://example.test/live/${check}`
    for (const assertion of Object.keys(result.assertions)) result.assertions[assertion] = true
  }
  return acceptance
}
