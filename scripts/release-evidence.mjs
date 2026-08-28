import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"

export const CANDIDATE_EVIDENCE_FILES = Object.freeze({
  dshRuntimeDependencyTreeSha256: "dsh-runtime-dependency-tree.json",
  dshRuntimeEnvironmentSha256: "dsh-runtime-environment.json",
  isolatedDependencyTreeSha256: "isolated-dependency-tree.json",
  npmAuditSha256: "npm-audit.json",
  npmCliVersionSha256: "npm-cli-version.txt",
})

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

function dependencyTree(record, label) {
  const tree = Array.isArray(record)
    ? record.length === 1 ? record[0] : undefined
    : record
  if (tree === null || typeof tree !== "object" || Array.isArray(tree)) {
    throw new Error(`${label} must contain exactly one dependency tree`)
  }
  return tree
}

export async function assertCandidateEvidenceHashes(importEvidencePath, evidence, expected) {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("Candidate evidence must be an object")
  }
  for (const field of [
    "dshVersion",
    "dshRuntimeLockSha256",
    "npmCliVersion",
    "packageName",
    "pnpmVersion",
    "version",
  ]) {
    if (typeof expected?.[field] !== "string" || expected[field].length === 0) {
      throw new TypeError(`Expected ${field} must be a non-empty string`)
    }
  }
  const evidenceDirectory = path.dirname(path.resolve(importEvidencePath))
  const records = {}
  for (const [field, file] of Object.entries(CANDIDATE_EVIDENCE_FILES)) {
    const recordedDigest = evidence[field]
    if (typeof recordedDigest !== "string" || !/^[0-9a-f]{64}$/u.test(recordedDigest)) {
      throw new Error(`${field} must be a lowercase SHA-256 digest`)
    }
    const evidenceFile = path.join(evidenceDirectory, file)
    const metadata = await lstat(evidenceFile)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${file} must be a regular evidence file`)
    }
    if (await sha256(evidenceFile) !== recordedDigest) {
      throw new Error(`${field} does not match ${file}`)
    }
    const contents = await readFile(evidenceFile, "utf8")
    if (field === "npmCliVersionSha256") {
      records[field] = contents
      continue
    }
    try {
      records[field] = JSON.parse(contents)
    } catch (error) {
      throw new Error(`${file} must contain valid JSON`, { cause: error })
    }
  }

  const dshRuntimeTree = dependencyTree(
    records.dshRuntimeDependencyTreeSha256,
    "DSH runtime dependency evidence",
  )
  const isolatedTree = dependencyTree(
    records.isolatedDependencyTreeSha256,
    "Isolated dependency evidence",
  )
  if (dshRuntimeTree.dependencies?.["@deepseek-ai/dsh"]?.version !== expected.dshVersion) {
    throw new Error(`DSH runtime dependency tree must contain @deepseek-ai/dsh@${expected.dshVersion}`)
  }
  const runtime = records.dshRuntimeEnvironmentSha256
  if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("DSH runtime environment evidence must be an object")
  }
  if (runtime.schemaVersion !== 1 || runtime.runtimePackage !== "@deepseek-ai/dsh") {
    throw new Error("DSH runtime environment evidence has an unsupported schema or package")
  }
  if (runtime.runtimeVersion !== expected.dshVersion) {
    throw new Error(`DSH runtime environment must contain @deepseek-ai/dsh@${expected.dshVersion}`)
  }
  if (runtime.fixtureLockSha256 !== expected.dshRuntimeLockSha256) {
    throw new Error("DSH runtime environment does not match the fixture lock")
  }
  if (runtime.pnpmVersion !== expected.pnpmVersion) {
    throw new Error(`DSH runtime environment must use pnpm ${expected.pnpmVersion}`)
  }
  if (typeof runtime.nodeVersion !== "string" || !/^v24\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(runtime.nodeVersion)) {
    throw new Error("DSH runtime environment must record Node.js 24")
  }
  if (runtime.platform !== "linux") {
    throw new Error("DSH runtime environment must record the Linux release runner")
  }
  if (runtime.arch !== "x64") {
    throw new Error("DSH runtime environment must record the x64 release runner")
  }
  if (runtime.lifecycleScripts !== "disabled") {
    throw new Error("DSH runtime lifecycle scripts must remain disabled")
  }
  if (isolatedTree.dependencies?.[expected.packageName]?.version !== expected.version) {
    throw new Error(`Isolated dependency tree must contain ${expected.packageName}@${expected.version}`)
  }
  const vulnerabilities = records.npmAuditSha256?.metadata?.vulnerabilities
  if (
    vulnerabilities === null
    || typeof vulnerabilities !== "object"
    || !Number.isSafeInteger(vulnerabilities.high)
    || !Number.isSafeInteger(vulnerabilities.critical)
    || vulnerabilities.high !== 0
    || vulnerabilities.critical !== 0
  ) {
    throw new Error("Production dependency audit must report zero high or critical vulnerabilities")
  }
  if (records.npmCliVersionSha256 !== `${expected.npmCliVersion}\n`) {
    throw new Error(`Candidate npm CLI must be exactly ${expected.npmCliVersion}`)
  }
}
