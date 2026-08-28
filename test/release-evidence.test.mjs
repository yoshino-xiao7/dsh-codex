import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  CANDIDATE_EVIDENCE_FILES,
  assertCandidateEvidenceHashes,
} from "../scripts/release-evidence.mjs"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

const expected = Object.freeze({
  dshVersion: "0.1.1-rc.2",
  dshRuntimeLockSha256: "a".repeat(64),
  npmCliVersion: "11.16.0",
  packageName: "dsh-codex-community",
  pnpmVersion: "10.34.5",
  version: "0.0.1",
})

function validRecords() {
  return {
    dshRuntimeDependencyTreeSha256: [{
      dependencies: { "@deepseek-ai/dsh": { version: "0.1.1-rc.2" } },
    }],
    dshRuntimeEnvironmentSha256: {
      schemaVersion: 1,
      runtimePackage: "@deepseek-ai/dsh",
      runtimeVersion: "0.1.1-rc.2",
      fixtureLockSha256: "a".repeat(64),
      nodeVersion: "v24.7.0",
      pnpmVersion: "10.34.5",
      platform: "linux",
      arch: "x64",
      lifecycleScripts: "disabled",
    },
    isolatedDependencyTreeSha256: {
      dependencies: { "dsh-codex-community": { version: "0.0.1" } },
    },
    npmAuditSha256: {
      metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    },
    npmCliVersionSha256: "11.16.0\n",
  }
}

async function writeEvidence(directory, records) {
  const evidence = {}
  for (const [field, file] of Object.entries(CANDIDATE_EVIDENCE_FILES)) {
    const record = records[field]
    const contents = typeof record === "string" ? record : `${JSON.stringify(record)}\n`
    await writeFile(path.join(directory, file), contents)
    evidence[field] = sha256(contents)
  }
  return evidence
}

test("candidate evidence binds each archived dependency and audit record", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-codex-evidence-"))
  context.after(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(directory, { recursive: true, force: true })
  })

  const records = validRecords()
  const evidence = await writeEvidence(directory, records)
  await assert.doesNotReject(() => assertCandidateEvidenceHashes(
    path.join(directory, "isolated-import.json"),
    evidence,
    expected,
  ))

  records.npmAuditSha256.metadata.vulnerabilities.high = 1
  const changedAudit = `${JSON.stringify(records.npmAuditSha256)}\n`
  await writeFile(path.join(directory, CANDIDATE_EVIDENCE_FILES.npmAuditSha256), changedAudit)
  evidence.npmAuditSha256 = sha256(changedAudit)
  await assert.rejects(
    () => assertCandidateEvidenceHashes(path.join(directory, "isolated-import.json"), evidence, expected),
    /high or critical/u,
  )
})

test("candidate evidence rejects a mismatched DSH runtime environment", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-codex-evidence-"))
  context.after(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(directory, { recursive: true, force: true })
  })

  const cases = [
    ["fixtureLockSha256", "b".repeat(64), /fixture lock/u],
    ["pnpmVersion", "10.35.0", /pnpm/u],
    ["nodeVersion", "v22.22.2", /Node\.js 24/u],
    ["platform", "darwin", /Linux/u],
    ["arch", "arm64", /x64/u],
    ["lifecycleScripts", "enabled", /lifecycle scripts/u],
  ]
  for (const [field, value, pattern] of cases) {
    const records = validRecords()
    records.dshRuntimeEnvironmentSha256[field] = value
    const evidence = await writeEvidence(directory, records)
    await assert.rejects(
      () => assertCandidateEvidenceHashes(path.join(directory, "isolated-import.json"), evidence, expected),
      pattern,
      `${field} must be bound to the reviewed runtime environment`,
    )
  }
})

test("candidate evidence rejects an unreviewed npm CLI record", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-codex-evidence-"))
  context.after(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(directory, { recursive: true, force: true })
  })
  const records = validRecords()
  records.npmCliVersionSha256 = "11.15.0\n"
  const evidence = await writeEvidence(directory, records)
  await assert.rejects(
    () => assertCandidateEvidenceHashes(path.join(directory, "isolated-import.json"), evidence, expected),
    /npm CLI/u,
  )
})

test("candidate evidence rejects missing or malformed digests", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-codex-evidence-"))
  context.after(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(directory, { recursive: true, force: true })
  })
  for (const file of Object.values(CANDIDATE_EVIDENCE_FILES)) {
    await writeFile(path.join(directory, file), "record\n")
  }
  await assert.rejects(
    () => assertCandidateEvidenceHashes(path.join(directory, "isolated-import.json"), {}, expected),
    /lowercase SHA-256/u,
  )
})
