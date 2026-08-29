import assert from "node:assert/strict"
import test from "node:test"

import {
  findUnexpectedPostAcceptanceChanges,
  publicationStatePaths,
} from "../scripts/release-source-boundary.mjs"

const releasePaths = Object.freeze({
  acceptancePath: "docs/releases/v0.0.1.acceptance.json",
  releasePath: "docs/releases/v0.0.1.md",
})

test("post-acceptance boundary permits only release evidence and publication-state documents", () => {
  const changedFiles = [
    releasePaths.releasePath,
    releasePaths.acceptancePath,
    ...publicationStatePaths,
  ]

  assert.deepEqual(findUnexpectedPostAcceptanceChanges(changedFiles, releasePaths), [])
})

test("post-acceptance boundary rejects runtime, dependency, and workflow changes", () => {
  const changedFiles = [
    "src/host/provider.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/release.yml",
    releasePaths.releasePath,
  ]

  assert.deepEqual(findUnexpectedPostAcceptanceChanges(changedFiles, releasePaths), [
    "src/host/provider.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/release.yml",
  ])
})

test("post-acceptance boundary does not mutate the reviewed path list", () => {
  const changedFiles = [...publicationStatePaths]
  findUnexpectedPostAcceptanceChanges(changedFiles, releasePaths)

  assert.deepEqual(changedFiles, publicationStatePaths)
  assert.ok(Object.isFrozen(publicationStatePaths))
})
