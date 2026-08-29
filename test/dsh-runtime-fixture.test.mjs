import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const fixtureManifestUrl = new URL("./fixtures/dsh-runtime/package.json", import.meta.url)
const fixtureLockUrl = new URL("./fixtures/dsh-runtime/pnpm-lock.yaml", import.meta.url)
const fixtureRoot = fileURLToPath(new URL("./fixtures/dsh-runtime/", import.meta.url))
const workflowRoot = new URL("../.github/workflows/", import.meta.url)
const candidateBuilderUrl = new URL("../scripts/build-release-candidate.mjs", import.meta.url)

test("the smoke runtime has a committed exact and private pnpm fixture", async () => {
  const manifest = JSON.parse(await readFile(fixtureManifestUrl, "utf8"))
  const lock = await readFile(fixtureLockUrl, "utf8")
  assert.deepEqual(manifest, {
    name: "dsh-codex-compat-runtime",
    version: "0.0.0",
    private: true,
    packageManager: "pnpm@10.34.5",
    dependencies: { "@deepseek-ai/dsh": "0.1.1-rc.2" },
  })
  assert.match(lock, /specifier: 0\.1\.1-rc\.2/u)
  assert.match(lock, /version: 0\.1\.1-rc\.2(?:\(|\s*$)/mu)
})

test("the pinned pnpm CLI accepts the complete dependency-tree evidence command", async () => {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const spawnOptions = {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  }
  const manifest = JSON.parse(await readFile(fixtureManifestUrl, "utf8"))
  const expectedPnpmVersion = /^pnpm@(.+)$/u.exec(manifest.packageManager)?.[1]
  const version = spawnSync(executable, ["--version"], spawnOptions)
  assert.equal(version.status, 0, version.stderr)
  assert.equal(version.stdout.trim(), expectedPnpmVersion)
  const result = spawnSync(
    executable,
    ["--dir", fixtureRoot, "list", "--depth", "Infinity", "--json"],
    { ...spawnOptions, maxBuffer: 16 * 1024 * 1024 },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.ok(Array.isArray(JSON.parse(result.stdout)))
})

test("CI, compatibility, and the delegated release candidate install only the frozen DSH fixture", async () => {
  for (const name of ["ci.yml", "compatibility.yml"]) {
    const source = await readFile(new URL(name, workflowRoot), "utf8")
    assert.match(
      source,
      /pnpm --dir test\/fixtures\/dsh-runtime install --frozen-lockfile --ignore-scripts/u,
      `${name} must install the committed DSH runtime graph`,
    )
    assert.match(source, /test\/fixtures\/dsh-runtime\/pnpm-lock\.yaml/u)
    assert.doesNotMatch(
      source,
      /npm install --prefix [^\n]*@deepseek-ai\/dsh@/u,
      `${name} must not use npm's unbounded DSH peer resolver`,
    )
  }

  const [releaseWorkflow, candidateBuilder] = await Promise.all([
    readFile(new URL("release.yml", workflowRoot), "utf8"),
    readFile(candidateBuilderUrl, "utf8"),
  ])
  assert.equal(
    (releaseWorkflow.match(/pnpm run release:candidate -- \$\{\{ inputs\.version \}\}/gu) ?? []).length,
    1,
  )
  assert.doesNotMatch(
    releaseWorkflow,
    /pnpm --dir test\/fixtures\/dsh-runtime install/u,
    "release.yml must delegate candidate construction instead of duplicating it",
  )
  assert.match(
    candidateBuilder,
    /\["--dir", "test\/fixtures\/dsh-runtime", "install", "--frozen-lockfile", "--ignore-scripts"\]/u,
  )
  assert.match(candidateBuilder, /const fixtureRoot = path\.join\(root, "test", "fixtures", "dsh-runtime"\)/u)
  assert.match(candidateBuilder, /path\.join\(fixtureRoot, "pnpm-lock\.yaml"\)/u)
  assert.doesNotMatch(candidateBuilder, /npm install --prefix [^\n]*@deepseek-ai\/dsh@/u)
})
