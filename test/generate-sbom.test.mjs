import assert from "node:assert/strict"
import test from "node:test"

import {
  assertArtifactManifestMatchesRepository,
  assertSbomIdentity,
  buildCycloneDx,
  manifestDescriptorHash,
  productionManifest,
  readPnpmProductionList,
  validateTarEntries,
} from "../scripts/generate-sbom.mjs"

const manifest = Object.freeze({
  name: "dsh-codex-community",
  version: "0.0.1",
  license: "Apache-2.0",
  repository: {
    type: "git",
    url: "git+https://github.com/yoshino-xiao7/dsh-codex.git",
  },
  scripts: { prepack: "npm run build" },
  dependencies: { runtime: "1.0.0" },
  devDependencies: { test: "1.0.0" },
  peerDependencies: { host: "1.0.0" },
  peerDependenciesMeta: { host: { optional: true } },
})

const artifactSha256 = "a".repeat(64)
const lockSha256 = "b".repeat(64)

function productionTree(reverse = false) {
  const sharedWithLeaf = {
    from: "shared",
    version: "3.0.0",
    path: "/private/local/node_modules/shared",
    resolved: "https://registry.npmjs.org/shared/-/shared-3.0.0.tgz",
    dependencies: {
      leaf: {
        from: "leaf",
        version: "4.0.0",
        path: "C:\\local\\node_modules\\leaf",
      },
    },
  }
  const sharedDeduped = {
    from: "shared",
    version: "3.0.0",
    deduped: true,
  }
  const dependencies = reverse
    ? {
        zeta: {
          from: "zeta",
          version: "2.0.0",
          dependencies: { shared: sharedDeduped },
        },
        runtime: {
          from: "runtime",
          version: "1.0.0",
          dependencies: { shared: sharedWithLeaf },
        },
      }
    : {
        runtime: {
          from: "runtime",
          version: "1.0.0",
          dependencies: { shared: sharedWithLeaf },
        },
        zeta: {
          from: "zeta",
          version: "2.0.0",
          dependencies: { shared: sharedDeduped },
        },
      }
  return {
    name: manifest.name,
    version: manifest.version,
    path: "/private/local/project",
    dependencies,
  }
}

test("SBOM manifest keeps runtime metadata and removes development execution fields", () => {
  const runtime = productionManifest(manifest)
  assert.deepEqual(runtime, {
    name: "dsh-codex-community",
    version: "0.0.1",
    license: "Apache-2.0",
    repository: manifest.repository,
    dependencies: { runtime: "1.0.0" },
    peerDependencies: { host: "1.0.0" },
    peerDependenciesMeta: { host: { optional: true } },
  })
  assert.equal(manifest.scripts.prepack, "npm run build")
  assert.equal(manifest.devDependencies.test, "1.0.0")
})

test("artifact manifest identity and dependency descriptors must match the repository", () => {
  assert.doesNotThrow(() => assertArtifactManifestMatchesRepository(
    structuredClone(manifest),
    manifest,
  ))
  assert.throws(
    () => assertArtifactManifestMatchesRepository(
      { ...manifest, dependencies: { runtime: "1.0.1" } },
      manifest,
    ),
    /dependencies does not match/u,
  )
  assert.throws(
    () => assertArtifactManifestMatchesRepository(
      { ...manifest, repository: { ...manifest.repository, url: "https://example.invalid/repo" } },
      manifest,
    ),
    /repository does not match/u,
  )
})

test("SBOM tar entry validation accepts exactly one safe npm package root", () => {
  assert.deepEqual(
    validateTarEntries("package/package.json\npackage/dist/host/index.mjs\n"),
    ["package/package.json", "package/dist/host/index.mjs"],
  )
  assert.throws(() => validateTarEntries("package/dist/file\n"), /exactly one package\/package.json/u)
  assert.throws(
    () => validateTarEntries("package/package.json\npackage/package.json\n"),
    /exactly one package\/package.json/u,
  )
  assert.throws(
    () => validateTarEntries("package/package.json\npackage/../outside\n"),
    /unsafe path/u,
  )
  assert.throws(
    () => validateTarEntries("package/package.json\noutside/file\n"),
    /unsafe path/u,
  )
})

test("CycloneDX graph is deterministic, sorted, deduplicated, and strips local resolution data", () => {
  const first = buildCycloneDx({
    artifactManifest: manifest,
    artifactSha256,
    lockSha256,
    productionTree: productionTree(false),
  })
  const second = buildCycloneDx({
    artifactManifest: manifest,
    artifactSha256,
    lockSha256,
    productionTree: productionTree(true),
  })

  assert.deepEqual(first, second)
  assert.deepEqual(
    first.components.map((component) => component["bom-ref"]),
    [
      "pkg:npm/leaf@4.0.0",
      "pkg:npm/runtime@1.0.0",
      "pkg:npm/shared@3.0.0",
      "pkg:npm/zeta@2.0.0",
    ],
  )
  assert.equal(first.components.filter((component) => component.name === "shared").length, 1)
  assert.deepEqual(
    first.dependencies.find((entry) => entry.ref === "pkg:npm/shared@3.0.0"),
    { ref: "pkg:npm/shared@3.0.0", dependsOn: ["pkg:npm/leaf@4.0.0"] },
  )
  assert.doesNotMatch(JSON.stringify(first), /(?:\/private\/local|C:\\local|"path"|"resolved"|registry\.npmjs)/u)
})

test("CycloneDX evidence binds the artifact, lockfile, and manifest descriptors", () => {
  const sbom = buildCycloneDx({
    artifactManifest: manifest,
    artifactSha256,
    lockSha256,
    productionTree: productionTree(),
  })
  const properties = Object.fromEntries(
    sbom.metadata.component.properties.map(({ name, value }) => [name, value]),
  )
  assert.deepEqual(sbom.metadata.component.hashes, [
    { alg: "SHA-256", content: artifactSha256 },
  ])
  assert.equal(properties["dsh-codex:artifact:sha256"], artifactSha256)
  assert.equal(properties["dsh-codex:pnpm-lock:sha256"], lockSha256)
  assert.equal(
    properties["dsh-codex:manifest-descriptors:sha256"],
    manifestDescriptorHash(manifest),
  )
  assert.doesNotThrow(() => assertSbomIdentity(sbom, manifest, {
    artifactSha256,
    lockSha256,
  }))
  assert.throws(
    () => assertSbomIdentity(sbom, manifest, {
      artifactSha256: "c".repeat(64),
      lockSha256,
    }),
    /artifact hash/u,
  )
  assert.throws(
    () => assertSbomIdentity(sbom, manifest, {
      artifactSha256,
      lockSha256: "c".repeat(64),
    }),
    /lock hash/u,
  )
})

test("pnpm production graph is read once from the frozen lockfile without registry resolution", () => {
  const calls = []
  const expected = [{ name: manifest.name, version: manifest.version, dependencies: {} }]
  const result = readPnpmProductionList({
    cwd: "/work/repository",
    environment: { PATH: "/bin" },
    run(command, arguments_, options) {
      calls.push({ command, arguments_, options })
      return JSON.stringify(expected)
    },
  })

  assert.deepEqual(result, expected[0])
  assert.equal(calls.length, 1)
  assert.match(calls[0].command, /^pnpm(?:\.cmd)?$/u)
  assert.deepEqual(calls[0].arguments_, [
    "list",
    "--prod",
    "--json",
    "--depth",
    "Infinity",
    "--lockfile-only",
  ])
  assert.equal(calls[0].options.cwd, "/work/repository")
  assert.equal(calls[0].options.env.npm_config_offline, "true")
  assert.equal(calls[0].options.env.npm_config_audit, "false")
  assert.equal(calls[0].options.env.npm_config_fund, "false")
})
