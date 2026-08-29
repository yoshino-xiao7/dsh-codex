import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { verifyNpmProvenance } from "../scripts/verify-npm-provenance.mjs"

const manifest = Object.freeze({
  name: "dsh-codex-community",
  version: "0.0.1",
  repository: {
    type: "git",
    url: "git+https://github.com/yoshino-xiao7/dsh-codex.git",
  },
})
const github = Object.freeze({
  serverUrl: "https://github.com",
  repository: "yoshino-xiao7/dsh-codex",
  ref: "refs/heads/main",
  sha: "1".repeat(40),
  workflowRef: "yoshino-xiao7/dsh-codex/.github/workflows/release.yml@refs/heads/main",
  eventName: "workflow_dispatch",
  repositoryId: "12345",
  repositoryOwnerId: "67890",
})
const artifactBytes = Buffer.from("exact candidate tarball")

function statement() {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: "pkg:npm/dsh-codex-community@0.0.1",
      digest: { sha512: createHash("sha512").update(artifactBytes).digest("hex") },
    }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/yoshino-xiao7/dsh-codex",
            path: ".github/workflows/release.yml",
          },
        },
        internalParameters: {
          github: {
            event_name: "workflow_dispatch",
            repository_id: "12345",
            repository_owner_id: "67890",
          },
        },
        resolvedDependencies: [{
          uri: "git+https://github.com/yoshino-xiao7/dsh-codex@refs/heads/main",
          digest: { gitCommit: "1".repeat(40) },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: "https://github.com/yoshino-xiao7/dsh-codex/actions/runs/123/attempts/2",
        },
      },
    },
  }
}

function report(value = statement()) {
  return {
    invalid: [],
    missing: [],
    verified: [{
      name: manifest.name,
      version: manifest.version,
      attestations: { provenance: { predicateType: value.predicateType } },
      attestationBundles: [{
        predicateType: value.predicateType,
        bundle: {
          verificationMaterial: { certificate: "verified by npm" },
          dsseEnvelope: { payload: Buffer.from(JSON.stringify(value)).toString("base64") },
        },
      }],
    }],
  }
}

function verify(overrides = {}) {
  return verifyNpmProvenance({
    report: overrides.report ?? report(),
    artifactBytes: overrides.artifactBytes ?? artifactBytes,
    manifest: overrides.manifest ?? manifest,
    github: overrides.github ?? github,
  })
}

test("accepts a signed npm provenance statement bound to the exact release source", () => {
  const result = verify()
  assert.equal(result.artifactSha512, createHash("sha512").update(artifactBytes).digest("hex"))
  assert.equal(result.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit, github.sha)
})

test("rejects provenance for a different package artifact", () => {
  assert.throws(() => verify({ artifactBytes: Buffer.from("different artifact") }), /subject digest/u)
})

test("rejects a malformed or non-canonical DSSE payload", () => {
  const malformed = report()
  malformed.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload = "e30"
  assert.throws(() => verify({ report: malformed }), /canonical base64/u)
})

test("rejects provenance from another repository, workflow, ref, or commit", () => {
  const cases = [
    ["repository", (value) => { value.predicate.buildDefinition.externalParameters.workflow.repository = "https://github.com/example/other" }],
    ["workflow path", (value) => { value.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/other.yml" }],
    ["workflow ref", (value) => { value.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/other" }],
    ["source URI", (value) => { value.predicate.buildDefinition.resolvedDependencies[0].uri = "git+https://github.com/example/other@refs/heads/main" }],
    ["source commit", (value) => { value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "2".repeat(40) }],
  ]
  for (const [label, mutate] of cases) {
    const value = statement()
    mutate(value)
    assert.throws(() => verify({ report: report(value) }), new RegExp(label, "iu"))
  }
})

test("rejects provenance with the wrong event, repository identity, builder, or invocation", () => {
  const cases = [
    ["event", (value) => { value.predicate.buildDefinition.internalParameters.github.event_name = "push" }],
    ["repository id", (value) => { value.predicate.buildDefinition.internalParameters.github.repository_id = "999" }],
    ["owner id", (value) => { value.predicate.buildDefinition.internalParameters.github.repository_owner_id = "999" }],
    ["builder", (value) => { value.predicate.runDetails.builder.id = "https://example.com/runner" }],
    ["invocation", (value) => { value.predicate.runDetails.metadata.invocationId = "https://github.com/example/other/actions/runs/1/attempts/1" }],
  ]
  for (const [label, mutate] of cases) {
    const value = statement()
    mutate(value)
    assert.throws(() => verify({ report: report(value) }), new RegExp(label, "iu"))
  }
})

test("rejects ambiguous package entries and provenance bundles", () => {
  const duplicateTarget = report()
  duplicateTarget.verified.push(structuredClone(duplicateTarget.verified[0]))
  assert.throws(() => verify({ report: duplicateTarget }), /exactly one verified package/u)

  const duplicateBundle = report()
  duplicateBundle.verified[0].attestationBundles.push(
    structuredClone(duplicateBundle.verified[0].attestationBundles[0]),
  )
  assert.throws(() => verify({ report: duplicateBundle }), /exactly one SLSA provenance bundle/u)
})

test("rejects a publication context outside the canonical release workflow", () => {
  assert.throws(
    () => verify({ github: { ...github, ref: "refs/heads/release" } }),
    /publication ref/u,
  )
  assert.throws(
    () => verify({ github: { ...github, workflowRef: "yoshino-xiao7/dsh-codex/.github/workflows/other.yml@refs/heads/main" } }),
    /workflow ref/u,
  )
  assert.throws(
    () => verify({ manifest: { ...manifest, repository: { url: "git+https://github.com/example/other.git" } } }),
    /publishing repository/u,
  )
})
