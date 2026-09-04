import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { buildReleaseCandidate } from "../scripts/build-release-candidate.mjs"

const VERSION = "0.0.1"
const SOURCE_COMMIT = "a".repeat(40)
const ARTIFACT_NAME = `dsh-codex-community-${VERSION}.tgz`
const SECRET_NAMES = [
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_OTP",
  "NPM_CONFIG_REGISTRY",
  "OPENAI_API_KEY",
  "SSH_AUTH_SOCK",
  "npm_config_//registry.npmjs.org/:_authToken",
]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function createRepository(t, { manifestVersion = VERSION } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "candidate-builder-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeJson(path.join(root, "package.json"), {
    name: "dsh-codex-community",
    version: manifestVersion,
    packageManager: "pnpm@10.34.5",
  })
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  await writeJson(path.join(root, "test/fixtures/dsh-runtime/package.json"), {
    name: "candidate-builder-dsh-runtime",
    private: true,
    packageManager: "pnpm@10.34.5",
    dependencies: { "@deepseek-ai/dsh": "0.1.1-rc.2" },
  })
  await writeFile(
    path.join(root, "test/fixtures/dsh-runtime/pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nfixture: true\n",
  )
  await writeJson(
    path.join(root, "test/fixtures/dsh-runtime/node_modules/@deepseek-ai/dsh/package.json"),
    { name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" },
  )
  return root
}

function commandLabel(tool, arguments_) {
  if (tool === "npm" && arguments_[0] === "publish") return "npm publish <artifact> --dry-run"
  if (tool === "npm" && arguments_[0] === "pack") return "npm pack <staging>"
  if (tool === "node" && arguments_[0] === "scripts/generate-sbom.mjs") return "node generate-sbom"
  if (tool === "npm" && arguments_[0] === "install") return "npm install <artifact>"
  if (tool === "node" && arguments_[0] === "--input-type=module") return "node isolated-import"
  return [tool, ...arguments_].join(" ")
}

function createFakeProcessAdapter({
  auditFailures = [],
  failAt,
  head = SOURCE_COMMIT,
  npmVersion = "11.16.0",
  pnpmVersion = "10.34.5",
  runtime = {},
} = {}) {
  const calls = []
  const delays = []
  const npmConfigReads = []
  let auditFailureIndex = 0
  const adapter = {
    runtime: {
      nodeVersion: "v24.9.0",
      platform: "linux",
      arch: "x64",
      ...runtime,
    },
    async run(tool, arguments_, options) {
      const label = commandLabel(tool, arguments_)
      calls.push({ arguments_: [...arguments_], label, options, tool })
      npmConfigReads.push(await readFile(options.environment.npm_config_userconfig, "utf8"))
      if (failAt === label) throw new Error(`synthetic failure: ${label}`)

      if (tool === "git" && arguments_[0] === "status") return ""
      if (tool === "git" && arguments_[0] === "rev-parse") return `${head}\n`
      if (tool === "pnpm" && arguments_[0] === "--version") return `${pnpmVersion}\n`
      if (tool === "npm" && arguments_[0] === "--version") return `${npmVersion}\n`
      if (tool === "npm" && arguments_[0] === "pack") {
        const destination = arguments_[arguments_.indexOf("--pack-destination") + 1]
        await writeFile(path.join(destination, ARTIFACT_NAME), "immutable candidate bytes\n")
        return `${JSON.stringify([{
          filename: ARTIFACT_NAME,
          name: "dsh-codex-community",
          version: VERSION,
        }])}\n`
      }
      if (tool === "npm" && arguments_[0] === "publish") {
        assert.ok(arguments_.includes("--dry-run"), "the fake must never observe a real publish")
        return "{\"id\":\"dry-run\"}\n"
      }
      if (tool === "node" && arguments_[0] === "scripts/generate-sbom.mjs") {
        await writeFile(arguments_[2], "{\"bomFormat\":\"CycloneDX\",\"specVersion\":\"1.6\"}\n")
        return ""
      }
      if (tool === "pnpm" && arguments_.includes("list")) {
        return `${JSON.stringify([{
          name: "candidate-builder-dsh-runtime",
          dependencies: { "@deepseek-ai/dsh": { version: "0.1.1-rc.2" } },
        }])}\n`
      }
      if (tool === "npm" && arguments_[0] === "ls") {
        return `${JSON.stringify({
          name: "isolated",
          dependencies: { "dsh-codex-community": { version: VERSION } },
        })}\n`
      }
      if (tool === "npm" && arguments_[0] === "audit") {
        const failure = auditFailures[auditFailureIndex]
        auditFailureIndex += 1
        if (failure !== undefined) throw failure
        return `${JSON.stringify({
          auditReportVersion: 2,
          metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
        })}\n`
      }
      return ""
    },
    async wait(milliseconds) {
      delays.push(milliseconds)
    },
  }
  return { adapter, calls, delays, npmConfigReads }
}

test("the deep candidate interface replays the reviewed build once and installs bound evidence", async (t) => {
  const root = await createRepository(t)
  const fake = createFakeProcessAdapter()
  const environment = {
    PATH: process.env.PATH,
    SAFE_MARKER: "retained",
    RELEASE_SOURCE_COMMIT: undefined,
    NODE_AUTH_TOKEN: "node-secret",
    NPM_TOKEN: "npm-secret",
    GH_TOKEN: "gh-secret",
    GITHUB_TOKEN: "github-secret",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-secret",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
    AWS_WEB_IDENTITY_TOKEN_FILE: "/user/aws-oidc-token",
    "npm_config_//registry.npmjs.org/:_authToken": "registry-secret",
    npm_config_userconfig: "/user/.npmrc",
    npm_config_provenance: "true",
    NPM_CONFIG_CACHE: "/user/npm-cache",
    NPM_CONFIG_OTP: "123456",
    NPM_CONFIG_REGISTRY: "https://private.example.invalid/",
    OPENAI_API_KEY: "provider-secret",
    SSH_AUTH_SOCK: "/user/ssh-agent.sock",
  }

  const result = await buildReleaseCandidate({
    repositoryRoot: root,
    version: VERSION,
    environment,
    processAdapter: fake.adapter,
  })

  assert.equal(result.artifactPath, `release/${ARTIFACT_NAME}`)
  assert.equal(result.evidencePath, "release/isolated-import.json")
  assert.equal(result.sourceCommit, SOURCE_COMMIT)
  assert.equal(result.outputPaths.length, 11)
  assert.deepEqual(fake.calls.map(({ label }) => label), [
    "git status --porcelain=v1 -z --untracked-files=all",
    "git rev-parse HEAD",
    "pnpm --version",
    "npm --version",
    "pnpm install --frozen-lockfile --ignore-scripts",
    "pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts",
    "pnpm run check",
    "pnpm run verify:release",
    "git diff --exit-code",
    "git status --porcelain=v1 -z --untracked-files=all",
    "npm pack <staging>",
    "npm publish <artifact> --dry-run",
    "node generate-sbom",
    "pnpm --dir test/fixtures/dsh-runtime list --depth Infinity --json",
    "pnpm run smoke:dsh-profile",
    "npm init -y",
    "npm install <artifact>",
    "node isolated-import",
    "npm ls --all --json",
    "npm audit --omit=dev --audit-level=high --json",
  ])
  assert.equal(fake.calls.filter(({ label }) => label === "npm pack <staging>").length, 1)
  assert.equal(fake.calls.filter(({ tool, arguments_ }) => (
    tool === "npm" && arguments_[0] === "publish"
  )).length, 1)
  assert.ok(fake.npmConfigReads.every((source) => source === ""))
  for (const { options } of fake.calls) {
    assert.equal(options.environment.SAFE_MARKER, "retained")
    assert.equal(options.environment.npm_config_provenance, "false")
    assert.equal(options.environment.npm_config_registry, "https://registry.npmjs.org/")
    assert.notEqual(options.environment.npm_config_userconfig, "/user/.npmrc")
    for (const name of SECRET_NAMES) assert.equal(options.environment[name], undefined, name)
  }

  const releaseDirectory = path.join(root, "release")
  assert.deepEqual(
    (await readdir(releaseDirectory)).sort(),
    result.outputPaths.map((candidate) => path.basename(candidate)).sort(),
  )
  const artifact = await readFile(path.join(releaseDirectory, ARTIFACT_NAME))
  const evidence = JSON.parse(await readFile(path.join(releaseDirectory, "isolated-import.json"), "utf8"))
  assert.deepEqual(
    Object.fromEntries(Object.entries(evidence).filter(([field]) => !field.endsWith("Sha256"))),
    {
      status: "passed",
      packageName: "dsh-codex-community",
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      dshProfileSmoke: "passed",
    },
  )
  assert.equal(evidence.artifactSha256, sha256(artifact))
  assert.equal(
    evidence.lockSha256,
    sha256(await readFile(path.join(root, "pnpm-lock.yaml"))),
  )
  const evidenceFiles = {
    sbomSha256: `${ARTIFACT_NAME}.cdx.json`,
    dshRuntimeDependencyTreeSha256: "dsh-runtime-dependency-tree.json",
    dshRuntimeEnvironmentSha256: "dsh-runtime-environment.json",
    isolatedDependencyTreeSha256: "isolated-dependency-tree.json",
    npmAuditSha256: "npm-audit.json",
    npmCliVersionSha256: "npm-cli-version.txt",
  }
  for (const [field, file] of Object.entries(evidenceFiles)) {
    assert.equal(evidence[field], sha256(await readFile(path.join(releaseDirectory, file))), field)
  }
  const runtimeEnvironment = JSON.parse(await readFile(
    path.join(releaseDirectory, "dsh-runtime-environment.json"),
    "utf8",
  ))
  assert.deepEqual(runtimeEnvironment, {
    schemaVersion: 1,
    runtimePackage: "@deepseek-ai/dsh",
    runtimeVersion: "0.1.1-rc.2",
    fixtureLockSha256: sha256(await readFile(
      path.join(root, "test/fixtures/dsh-runtime/pnpm-lock.yaml"),
    )),
    nodeVersion: "v24.9.0",
    pnpmVersion: "10.34.5",
    platform: "linux",
    arch: "x64",
    lifecycleScripts: "disabled",
  })
  const isolatedDirectory = fake.calls.find(({ label }) => label === "npm init -y").options.cwd
  const temporaryRoot = path.dirname(fake.calls[0].options.environment.npm_config_userconfig)
  await assert.rejects(access(isolatedDirectory), { code: "ENOENT" })
  await assert.rejects(access(temporaryRoot), { code: "ENOENT" })
})

test("a command failure leaves no managed output and always removes the isolated directory", async (t) => {
  const root = await createRepository(t)
  const fake = createFakeProcessAdapter({ failAt: "npm audit --omit=dev --audit-level=high --json" })

  await assert.rejects(
    buildReleaseCandidate({
      repositoryRoot: root,
      version: VERSION,
      environment: { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
      processAdapter: fake.adapter,
    }),
    /synthetic failure: npm audit/u,
  )

  await assert.rejects(access(path.join(root, "release")), { code: "ENOENT" })
  const isolatedDirectory = fake.calls.find(({ label }) => label === "npm init -y").options.cwd
  const temporaryRoot = path.dirname(fake.calls[0].options.environment.npm_config_userconfig)
  await assert.rejects(access(isolatedDirectory), { code: "ENOENT" })
  await assert.rejects(access(temporaryRoot), { code: "ENOENT" })
  assert.equal(
    fake.calls.filter(({ label }) => label === "npm audit --omit=dev --audit-level=high --json").length,
    1,
  )
  assert.deepEqual(fake.delays, [])
})

test("npm audit retries bounded transient service failures before capturing evidence", async (t) => {
  const root = await createRepository(t)
  const fake = createFakeProcessAdapter({
    auditFailures: [
      new Error('npm audit failed (1): {"statusCode":503,"error":"Service Unavailable"}'),
      new Error("npm audit failed (1): 503 Service Unavailable"),
    ],
  })

  await buildReleaseCandidate({
    repositoryRoot: root,
    version: VERSION,
    environment: { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
    processAdapter: fake.adapter,
  })

  assert.equal(
    fake.calls.filter(({ label }) => label === "npm audit --omit=dev --audit-level=high --json").length,
    3,
  )
  assert.deepEqual(fake.delays, [1000, 4000])
  const audit = JSON.parse(await readFile(path.join(root, "release/npm-audit.json"), "utf8"))
  assert.equal(audit.metadata.vulnerabilities.high, 0)
})

test("npm audit does not retry a vulnerability result", async (t) => {
  const root = await createRepository(t)
  const vulnerabilityReport = JSON.stringify({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { high: 1, critical: 0 } },
  })
  const fake = createFakeProcessAdapter({
    auditFailures: [new Error(`npm audit failed (1):\n${vulnerabilityReport}`)],
  })

  await assert.rejects(
    buildReleaseCandidate({
      repositoryRoot: root,
      version: VERSION,
      environment: { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
      processAdapter: fake.adapter,
    }),
    /"high":1/u,
  )

  assert.equal(
    fake.calls.filter(({ label }) => label === "npm audit --omit=dev --audit-level=high --json").length,
    1,
  )
  assert.deepEqual(fake.delays, [])
  await assert.rejects(access(path.join(root, "release")), { code: "ENOENT" })
})

test("npm audit fails closed after bounded transient retries", async (t) => {
  const root = await createRepository(t)
  const fake = createFakeProcessAdapter({
    auditFailures: Array.from(
      { length: 3 },
      () => new Error(
        "npm audit failed (1): network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
      ),
    ),
  })

  await assert.rejects(
    buildReleaseCandidate({
      repositoryRoot: root,
      version: VERSION,
      environment: { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
      processAdapter: fake.adapter,
    }),
    /network timeout at/u,
  )

  assert.equal(
    fake.calls.filter(({ label }) => label === "npm audit --omit=dev --audit-level=high --json").length,
    3,
  )
  assert.deepEqual(fake.delays, [1000, 4000])
  const auditCalls = fake.calls.filter(
    ({ label }) => label === "npm audit --omit=dev --audit-level=high --json",
  )
  assert.ok(auditCalls.every(({ options }) => (
    options.environment.npm_config_fetch_retries === "0"
      && options.environment.npm_config_fetch_timeout === "30000"
  )))
  await assert.rejects(access(path.join(root, "release")), { code: "ENOENT" })
})

test("an existing managed output is rejected before commands or writes and is never overwritten", async (t) => {
  const root = await createRepository(t)
  const releaseDirectory = path.join(root, "release")
  const existing = path.join(releaseDirectory, "isolated-import.json")
  await mkdir(releaseDirectory)
  await writeFile(existing, "maintainer-owned sentinel\n")
  const fake = createFakeProcessAdapter()

  await assert.rejects(
    buildReleaseCandidate({
      repositoryRoot: root,
      version: VERSION,
      environment: { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
      processAdapter: fake.adapter,
    }),
    /Managed release output already exists/u,
  )

  assert.equal(await readFile(existing, "utf8"), "maintainer-owned sentinel\n")
  assert.deepEqual(await readdir(releaseDirectory), ["isolated-import.json"])
  assert.equal(fake.calls.length, 0)
})

test("an unrelated file under release is rejected instead of being uploaded with the candidate", async (t) => {
  const root = await createRepository(t)
  const releaseDirectory = path.join(root, "release")
  await mkdir(releaseDirectory)
  await writeFile(path.join(releaseDirectory, "maintainer-notes.txt"), "do not upload\n")
  const fake = createFakeProcessAdapter()

  await assert.rejects(
    buildReleaseCandidate({
      repositoryRoot: root,
      version: VERSION,
      environment: { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
      processAdapter: fake.adapter,
    }),
    /release must be empty before building a candidate/u,
  )

  assert.deepEqual(await readdir(releaseDirectory), ["maintainer-notes.txt"])
  assert.equal(fake.calls.length, 0)
})

test("manifest, source, and toolchain drift fail before dependency installation", async (t) => {
  const cases = [
    {
      label: "manifest version",
      repository: { manifestVersion: "0.0.2" },
      fake: createFakeProcessAdapter(),
      pattern: /package\.json version must be 0\.0\.1/u,
      lastPermitted: undefined,
    },
    {
      label: "source commit",
      repository: {},
      fake: createFakeProcessAdapter(),
      environment: { RELEASE_SOURCE_COMMIT: "b".repeat(40) },
      pattern: /must equal the checked-out HEAD/u,
      lastPermitted: "git rev-parse HEAD",
    },
    {
      label: "Node version",
      repository: {},
      fake: createFakeProcessAdapter({ runtime: { nodeVersion: "v22.19.0" } }),
      pattern: /require Node\.js 24/u,
      lastPermitted: "git rev-parse HEAD",
    },
    {
      label: "pnpm version",
      repository: {},
      fake: createFakeProcessAdapter({ pnpmVersion: "10.34.4" }),
      pattern: /require pnpm 10\.34\.5/u,
      lastPermitted: "pnpm --version",
    },
    {
      label: "npm version",
      repository: {},
      fake: createFakeProcessAdapter({ npmVersion: "11.15.0" }),
      pattern: /require npm 11\.16\.0/u,
      lastPermitted: "npm --version",
    },
  ]

  for (const fixture of cases) {
    await t.test(fixture.label, async (t) => {
      const root = await createRepository(t, fixture.repository)
      await assert.rejects(
        buildReleaseCandidate({
          repositoryRoot: root,
          version: VERSION,
          environment: fixture.environment ?? { RELEASE_SOURCE_COMMIT: SOURCE_COMMIT },
          processAdapter: fixture.fake.adapter,
        }),
        fixture.pattern,
      )
      assert.equal(
        fixture.fake.calls.some(({ label }) => label === "pnpm install --frozen-lockfile --ignore-scripts"),
        false,
      )
      assert.equal(fixture.fake.calls.at(-1)?.label, fixture.lastPermitted)
      await assert.rejects(access(path.join(root, "release")), { code: "ENOENT" })
    })
  }
})

test("CLI rejects missing, option-like, or extra version arguments without starting a build", () => {
  const script = fileURLToPath(new URL("../scripts/build-release-candidate.mjs", import.meta.url))
  for (const arguments_ of [[], ["--"], ["--help"], [VERSION, "extra"]]) {
    const result = spawnSync(process.execPath, [script, ...arguments_], {
      encoding: "utf8",
      env: {},
    })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, /Usage: node scripts\/build-release-candidate\.mjs <version>/u)
  }

  const separated = spawnSync(process.execPath, [script, "--", "not-a-version"], {
    encoding: "utf8",
    env: {},
  })
  assert.equal(separated.status, 1)
  assert.doesNotMatch(separated.stderr, /Usage:/u)
  assert.match(separated.stderr, /release version/u)
})

test("package.json exposes the unified candidate command", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(
    manifest.scripts["release:candidate"],
    "node scripts/build-release-candidate.mjs",
  )
})
