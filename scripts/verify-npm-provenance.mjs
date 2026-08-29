import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const inTotoStatement = "https://in-toto.io/Statement/v1"
const slsaPredicate = "https://slsa.dev/provenance/v1"
const githubBuildType = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"
const githubBuilder = "https://github.com/actions/runner/github-hosted"
const releaseWorkflowPath = ".github/workflows/release.yml"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.trim() === value && value.length > 0, `${label} is required`)
  return value
}

function decodePayload(envelope) {
  const encoded = envelope?.payload
  assert(typeof encoded === "string" && encoded.length > 0, "Provenance DSSE payload is missing")
  assert(encoded.length <= 2 * 1024 * 1024, "Provenance DSSE payload is too large")
  const bytes = Buffer.from(encoded, "base64")
  assert(bytes.toString("base64") === encoded, "Provenance DSSE payload is not canonical base64")
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new Error("Provenance DSSE payload is not valid JSON")
  }
}

function expectedRepositoryUrl(manifest, github) {
  const repositoryUrl = typeof manifest.repository === "string"
    ? manifest.repository
    : manifest.repository?.url
  const expected = `git+${github.serverUrl}/${github.repository}.git`
  assert(repositoryUrl === expected, "Package repository does not match the publishing repository")
  return `${github.serverUrl}/${github.repository}`
}

function assertGitHubContext(github) {
  for (const key of [
    "serverUrl",
    "repository",
    "ref",
    "sha",
    "workflowRef",
    "eventName",
    "repositoryId",
    "repositoryOwnerId",
  ]) {
    assertNonEmptyString(github[key], `GitHub context ${key}`)
  }
  assert(github.serverUrl === "https://github.com", "GitHub server must be https://github.com")
  assert(/^[0-9a-f]{40}$/u.test(github.sha), "GitHub source commit must be a full lowercase SHA")
  assert(github.ref === "refs/heads/main", "GitHub publication ref must be refs/heads/main")
  assert(github.eventName === "workflow_dispatch", "GitHub publication event must be workflow_dispatch")
  assert(
    github.workflowRef === `${github.repository}/${releaseWorkflowPath}@${github.ref}`,
    "GitHub workflow ref must identify release.yml on the publication ref",
  )
}

export function verifyNpmProvenance({ report, artifactBytes, manifest, github }) {
  assertGitHubContext(github)
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Package manifest is required")
  const packageName = assertNonEmptyString(manifest.name, "Package name")
  const version = assertNonEmptyString(manifest.version, "Package version")
  assert(artifactBytes instanceof Uint8Array && artifactBytes.byteLength > 0, "Package artifact is required")
  const repositoryUrl = expectedRepositoryUrl(manifest, github)

  assert(report && typeof report === "object" && !Array.isArray(report), "npm signature report is required")
  assert(Array.isArray(report.invalid) && report.invalid.length === 0, "npm signature report contains invalid entries")
  assert(Array.isArray(report.missing) && report.missing.length === 0, "npm signature report contains missing entries")
  assert(Array.isArray(report.verified), "npm signature report has no verified entries")
  const targets = report.verified.filter((entry) => entry?.name === packageName && entry?.version === version)
  assert(targets.length === 1, "npm signature report must contain exactly one verified package entry")
  const [target] = targets
  assert(target.attestations?.provenance?.predicateType === slsaPredicate, "npm provenance predicate type is invalid")
  assert(Array.isArray(target.attestationBundles), "npm signature report has no attestation bundles")
  const bundles = target.attestationBundles.filter((entry) => entry?.predicateType === slsaPredicate)
  assert(bundles.length === 1, "npm signature report must contain exactly one SLSA provenance bundle")
  const [provenance] = bundles
  assert(provenance.bundle?.verificationMaterial, "npm provenance verification material is missing")
  assert(provenance.bundle?.dsseEnvelope, "npm provenance DSSE envelope is missing")

  const statement = decodePayload(provenance.bundle.dsseEnvelope)
  assert(statement?._type === inTotoStatement, "npm provenance statement type is invalid")
  assert(statement?.predicateType === slsaPredicate, "npm provenance statement predicate is invalid")
  assert(Array.isArray(statement.subject) && statement.subject.length === 1, "npm provenance must have one subject")
  const [subject] = statement.subject
  const artifactSha512 = createHash("sha512").update(artifactBytes).digest("hex")
  assert(subject?.name === `pkg:npm/${packageName}@${version}`, "npm provenance subject name is invalid")
  assert(
    subject?.digest
      && Object.keys(subject.digest).length === 1
      && subject.digest.sha512 === artifactSha512,
    "npm provenance subject digest does not match the candidate artifact",
  )

  const definition = statement.predicate?.buildDefinition
  assert(definition?.buildType === githubBuildType, "npm provenance GitHub build type is invalid")
  const workflow = definition?.externalParameters?.workflow
  assert(workflow?.repository === repositoryUrl, "npm provenance repository does not match this repository")
  assert(workflow?.path === releaseWorkflowPath, "npm provenance workflow path is not release.yml")
  assert(workflow?.ref === github.ref, "npm provenance workflow ref does not match the publication ref")
  const internal = definition?.internalParameters?.github
  assert(internal?.event_name === github.eventName, "npm provenance event does not match workflow_dispatch")
  assert(internal?.repository_id === github.repositoryId, "npm provenance repository id does not match")
  assert(internal?.repository_owner_id === github.repositoryOwnerId, "npm provenance owner id does not match")
  assert(
    Array.isArray(definition?.resolvedDependencies) && definition.resolvedDependencies.length === 1,
    "npm provenance must have one resolved source dependency",
  )
  const [source] = definition.resolvedDependencies
  assert(
    source?.uri === `git+${repositoryUrl}@${github.ref}`,
    "npm provenance source URI does not match the publication ref",
  )
  assert(
    source?.digest
      && Object.keys(source.digest).length === 1
      && source.digest.gitCommit === github.sha,
    "npm provenance source commit does not match the release commit",
  )
  assert(statement.predicate?.runDetails?.builder?.id === githubBuilder, "npm provenance builder is not GitHub-hosted")
  const invocationId = statement.predicate?.runDetails?.metadata?.invocationId
  const escapedRepositoryUrl = repositoryUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  assert(
    typeof invocationId === "string"
      && new RegExp(`^${escapedRepositoryUrl}/actions/runs/[1-9]\\d*/attempts/[1-9]\\d*$`, "u").test(invocationId),
    "npm provenance invocation does not identify a workflow run in this repository",
  )

  return { artifactSha512, statement }
}

function environment(name) {
  return assertNonEmptyString(process.env[name], name)
}

async function runCli() {
  const [reportPath, artifactPath] = process.argv.slice(2)
  assert(reportPath && artifactPath && process.argv.length === 4, "Usage: verify-npm-provenance.mjs <report.json> <package.tgz>")
  const [reportSource, artifactBytes, manifestSource] = await Promise.all([
    readFile(resolve(reportPath), "utf8"),
    readFile(resolve(artifactPath)),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  ])
  const manifest = JSON.parse(manifestSource)
  verifyNpmProvenance({
    report: JSON.parse(reportSource),
    artifactBytes,
    manifest,
    github: {
      serverUrl: environment("GITHUB_SERVER_URL"),
      repository: environment("GITHUB_REPOSITORY"),
      ref: environment("GITHUB_REF"),
      sha: environment("GITHUB_SHA"),
      workflowRef: environment("GITHUB_WORKFLOW_REF"),
      eventName: environment("GITHUB_EVENT_NAME"),
      repositoryId: environment("GITHUB_REPOSITORY_ID"),
      repositoryOwnerId: environment("GITHUB_REPOSITORY_OWNER_ID"),
    },
  })
  console.log(`npm provenance is bound to ${manifest.name}@${manifest.version} and the release commit`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli()
}
