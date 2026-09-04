import assert from "node:assert/strict"
import test from "node:test"

import {
  compareRegistryVersions,
  pinnedRuntimeVersions,
  registryDriftSummary,
} from "../scripts/check-registry-drift.mjs"

test("runtime drift checks include exact dependencies and peers only", () => {
  assert.deepEqual(pinnedRuntimeVersions({
    dependencies: { zeta: "2.0.0", ranged: ">=1 <2" },
    peerDependencies: { alpha: "1.0.0-rc.2", rangedPeer: "^3.0.0" },
    devDependencies: { developmentOnly: "9.0.0" },
  }), [
    { name: "alpha", pinned: "1.0.0-rc.2" },
    { name: "zeta", pinned: "2.0.0" },
  ])
})

test("runtime drift checks merge exact pins from every runtime manifest", () => {
  assert.deepEqual(pinnedRuntimeVersions(
    {
      dependencies: { alpha: "1.0.0" },
      peerDependencies: { shared: "2.0.0" },
    },
    {
      dependencies: { "@deepseek-ai/dsh": "0.1.2-rc.1", shared: "2.0.0" },
    },
  ), [
    { name: "@deepseek-ai/dsh", pinned: "0.1.2-rc.1" },
    { name: "alpha", pinned: "1.0.0" },
    { name: "shared", pinned: "2.0.0" },
  ])
})

test("runtime drift rejects conflicting pins across manifests", () => {
  assert.throws(
    () => pinnedRuntimeVersions(
      { dependencies: { shared: "1.0.0" } },
      { dependencies: { shared: "2.0.0" } },
    ),
    /Conflicting runtime pins for shared: 1\.0\.0 and 2\.0\.0/u,
  )
})

test("registry comparisons preserve every package and identify drift", () => {
  const comparisons = compareRegistryVersions([
    { name: "alpha", pinned: "1.0.0" },
    { name: "zeta", pinned: "2.0.0" },
  ], new Map([
    ["alpha", "1.0.0"],
    ["zeta", "2.1.0"],
  ]))
  assert.deepEqual(comparisons, [
    { name: "alpha", pinned: "1.0.0", latest: "1.0.0", drifted: false },
    { name: "zeta", pinned: "2.0.0", latest: "2.1.0", drifted: true },
  ])
})

test("registry drift summary is actionable", () => {
  const summary = registryDriftSummary([
    { name: "alpha", pinned: "1.0.0", latest: "1.1.0", drifted: true },
  ])
  assert.match(summary, /alpha/u)
  assert.match(summary, /1\.0\.0/u)
  assert.match(summary, /1\.1\.0/u)
  assert.match(summary, /drift/u)
})
