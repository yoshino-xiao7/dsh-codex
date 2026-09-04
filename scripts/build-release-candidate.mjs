import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolveNpmCommand } from "./npm-command.mjs"
import {
  assertReleaseVersion,
  releaseVersionHasBuildMetadata,
} from "./release-version.mjs"

const PACKAGE_NAME = "dsh-codex-community"
const NODE_VERSION_PATTERN = /^v24\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const PNPM_VERSION = "10.34.5"
const NPM_VERSION = "11.16.0"
const NPM_REGISTRY = "https://registry.npmjs.org/"
const MAX_COMMAND_DURATION_MS = 10 * 60 * 1000
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024 * 1024
const NPM_AUDIT_RETRY_DELAYS_MS = Object.freeze([5000, 15000, 30000, 60000])
const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

const EXPLICIT_CREDENTIAL_NAMES = new Set([
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_ID_TOKEN",
  "NPM_TOKEN",
  "SIGSTORE_ID_TOKEN",
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseJson(source, label) {
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error })
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function sha512SRI(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`
}

function executableLabel(tool, arguments_) {
  return [tool, ...arguments_].join(" ")
}

function isCredentialEnvironmentName(name) {
  const normalized = name.toUpperCase()
  return EXPLICIT_CREDENTIAL_NAMES.has(normalized)
    || /(?:^|_)(?:AUTH|AUTH_TOKEN|TOKEN|PASSWORD|PASS|SECRET|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIALS?|COOKIE|SESSION|JWT|OAUTH)(?:_|$)/u.test(normalized)
    || new Set(["GIT_ASKPASS", "SSH_ASKPASS", "SSH_AUTH_SOCK"]).has(normalized)
    || /^NPM_CONFIG_.*(?:AUTH|TOKEN|PASSWORD|USERNAME)/u.test(normalized)
}

function sanitizedEnvironment(environment, temporaryRoot) {
  const sanitized = {}
  for (const [name, value] of Object.entries(environment ?? {})) {
    const normalized = name.toUpperCase()
    if (
      isCredentialEnvironmentName(name)
      || normalized.startsWith("NPM_CONFIG_")
    ) continue
    sanitized[name] = value
  }
  sanitized.npm_config_userconfig = path.join(temporaryRoot, "empty-user.npmrc")
  sanitized.npm_config_globalconfig = path.join(temporaryRoot, "empty-global.npmrc")
  sanitized.npm_config_provenance = "false"
  sanitized.npm_config_cache = path.join(temporaryRoot, "npm-cache")
  sanitized.npm_config_registry = NPM_REGISTRY
  return sanitized
}

function candidateOutputNames(version) {
  const artifact = `${PACKAGE_NAME}-${version}.tgz`
  return Object.freeze([
    artifact,
    `${artifact}.sha256`,
    `${artifact}.sri`,
    `${artifact}.cdx.json`,
    "pack.json",
    "npm-cli-version.txt",
    "dsh-runtime-dependency-tree.json",
    "dsh-runtime-environment.json",
    "isolated-dependency-tree.json",
    "npm-audit.json",
    "isolated-import.json",
  ])
}

async function optionalMetadata(candidate) {
  try {
    return await lstat(candidate)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function assertRepositoryRoot(root) {
  const metadata = await lstat(root)
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "repositoryRoot must be a real directory")
}

async function assertManagedOutputsAbsent(root, outputNames) {
  const releaseDirectory = path.join(root, "release")
  const releaseMetadata = await optionalMetadata(releaseDirectory)
  if (releaseMetadata === null) return
  assert(
    releaseMetadata.isDirectory() && !releaseMetadata.isSymbolicLink(),
    "release must be a real directory",
  )
  for (const name of outputNames) {
    if (await optionalMetadata(path.join(releaseDirectory, name)) !== null) {
      throw new Error(`Managed release output already exists: release/${name}`)
    }
  }
  const unexpected = await readdir(releaseDirectory)
  assert(
    unexpected.length === 0,
    `release must be empty before building a candidate: ${unexpected.join(", ")}`,
  )
}

async function assertStagedOutputs(stagingDirectory, outputNames) {
  for (const name of outputNames) {
    const metadata = await lstat(path.join(stagingDirectory, name))
    assert(
      metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0,
      `Staged release output must be a non-empty regular file: ${name}`,
    )
  }
}

async function installOutputs(root, stagingDirectory, outputNames) {
  const releaseDirectory = path.join(root, "release")
  const before = await optionalMetadata(releaseDirectory)
  if (before !== null) {
    assert(before.isDirectory() && !before.isSymbolicLink(), "release must remain a real directory")
  } else {
    await mkdir(releaseDirectory)
  }

  const installed = []
  try {
    await assertManagedOutputsAbsent(root, outputNames)
    for (const name of outputNames) {
      await copyFile(
        path.join(stagingDirectory, name),
        path.join(releaseDirectory, name),
        fsConstants.COPYFILE_EXCL,
      )
      installed.push(path.join(releaseDirectory, name))
    }
    const actualNames = (await readdir(releaseDirectory)).sort()
    const expectedNames = [...outputNames].sort()
    assert(
      JSON.stringify(actualNames) === JSON.stringify(expectedNames),
      "release changed while candidate outputs were being installed",
    )
  } catch (error) {
    await Promise.all(installed.map((candidate) => unlink(candidate).catch(() => {})))
    if (before === null) await rmdir(releaseDirectory).catch(() => {})
    throw error
  }
}

async function readRepositoryJson(root, relativePath) {
  return parseJson(
    await readFile(path.join(root, relativePath), "utf8"),
    relativePath,
  )
}

function assertProcessAdapter(processAdapter) {
  assert(processAdapter !== null && typeof processAdapter === "object", "processAdapter is required")
  assert(typeof processAdapter.run === "function", "processAdapter.run must be a function")
  assert(typeof processAdapter.wait === "function", "processAdapter.wait must be a function")
  assert(
    processAdapter.runtime !== null && typeof processAdapter.runtime === "object",
    "processAdapter.runtime is required",
  )
}

async function run(processAdapter, tool, arguments_, options) {
  const output = await processAdapter.run(tool, arguments_, options)
  assert(typeof output === "string", `${tool} process adapter output must be a string`)
  return output
}

function errorChainText(error) {
  const messages = []
  const visited = new Set()
  let current = error
  while (current !== null && current !== undefined && !visited.has(current)) {
    visited.add(current)
    if (current instanceof Error) messages.push(current.message)
    else messages.push(String(current))
    current = typeof current === "object" ? current.cause : undefined
  }
  return messages.join("\n")
}

function isRetryableNpmAuditError(error) {
  const detail = errorChainText(error)
  return /"?statusCode"?\s*:\s*(?:429|500|502|503|504)\b/iu.test(detail)
    || /\b(?:429 Too Many Requests|500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)\b/iu.test(detail)
    || /\bnetwork timeout at:/iu.test(detail)
    || /\b(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|ERR_SOCKET_TIMEOUT|ETIMEDOUT)\b/u.test(detail)
}

async function runNpmAudit(processAdapter, options) {
  const arguments_ = ["audit", "--omit=dev", "--audit-level=high", "--json"]
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(processAdapter, "npm", arguments_, options)
    } catch (error) {
      const delay = NPM_AUDIT_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !isRetryableNpmAuditError(error)) throw error
      await processAdapter.wait(delay)
    }
  }
}

function normalizedCapturedJson(source, label) {
  assert(source.trim().length > 0, `${label} produced no output`)
  parseJson(source, `${label} output`)
  return source.endsWith("\n") ? source : `${source}\n`
}

function assertCleanStatus(status, label) {
  assert(status.length === 0, `${label} must be clean before building a release candidate`)
}

/**
 * Build the exact local release candidate behind one interface.
 *
 * The process adapter is the only command-execution seam. The production
 * adapter runs local tools; tests use an in-memory command adapter while the
 * module retains ownership of ordering, evidence, output safety, and cleanup.
 */
export async function buildReleaseCandidate({
  repositoryRoot: rootInput,
  version,
  environment = process.env,
  processAdapter = createLocalProcessAdapter(),
}) {
  assert(typeof rootInput === "string" && rootInput.length > 0, "repositoryRoot is required")
  assertProcessAdapter(processAdapter)
  const root = path.resolve(rootInput)
  await assertRepositoryRoot(root)

  const requestedVersion = assertReleaseVersion(version)
  assert(!releaseVersionHasBuildMetadata(requestedVersion), "Release candidates do not support build metadata")
  const manifest = await readRepositoryJson(root, "package.json")
  assert(manifest?.name === PACKAGE_NAME, `package.json name must be ${PACKAGE_NAME}`)
  assert(
    manifest.version === requestedVersion,
    `package.json version must be ${requestedVersion}`,
  )
  assert(
    manifest.packageManager === `pnpm@${PNPM_VERSION}`,
    `package.json packageManager must be pnpm@${PNPM_VERSION}`,
  )

  const fixtureRoot = path.join(root, "test", "fixtures", "dsh-runtime")
  const fixtureManifest = await readRepositoryJson(
    root,
    "test/fixtures/dsh-runtime/package.json",
  )
  assert(
    fixtureManifest.packageManager === `pnpm@${PNPM_VERSION}`,
    `DSH runtime fixture packageManager must be pnpm@${PNPM_VERSION}`,
  )
  const dshVersion = fixtureManifest.dependencies?.["@deepseek-ai/dsh"]
  assert(typeof dshVersion === "string" && dshVersion.length > 0, "DSH runtime fixture must pin @deepseek-ai/dsh")

  const outputNames = candidateOutputNames(requestedVersion)
  await assertManagedOutputsAbsent(root, outputNames)

  let temporaryRoot
  try {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "dsh-codex-release-candidate-"))
    await Promise.all([
      writeFile(path.join(temporaryRoot, "empty-user.npmrc"), "", { flag: "wx" }),
      writeFile(path.join(temporaryRoot, "empty-global.npmrc"), "", { flag: "wx" }),
    ])
    const stagingDirectory = path.join(temporaryRoot, "release")
    const isolatedDirectory = path.join(temporaryRoot, "isolated")
    await mkdir(stagingDirectory)
    const childEnvironment = sanitizedEnvironment(environment, temporaryRoot)
    const commandOptions = (cwd = root, capture = true, overrides = {}) => ({
      capture,
      cwd,
      environment: { ...childEnvironment, ...overrides },
    })

    const initialStatus = await run(
      processAdapter,
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      commandOptions(),
    )
    assertCleanStatus(initialStatus, "Release worktree")
    const head = (await run(
      processAdapter,
      "git",
      ["rev-parse", "HEAD"],
      commandOptions(),
    )).trim()
    assert(/^[0-9a-f]{40}$/u.test(head), "Git HEAD must be a full lowercase commit")
    const sourceCommit = environment.RELEASE_SOURCE_COMMIT === undefined
      ? head
      : environment.RELEASE_SOURCE_COMMIT
    assert(
      /^[0-9a-f]{40}$/u.test(sourceCommit),
      "RELEASE_SOURCE_COMMIT must be a full lowercase Git commit",
    )
    assert(sourceCommit === head, "RELEASE_SOURCE_COMMIT must equal the checked-out HEAD")

    const { nodeVersion, platform, arch } = processAdapter.runtime
    assert(NODE_VERSION_PATTERN.test(nodeVersion), "Release candidates require Node.js 24")
    assert(typeof platform === "string" && platform.length > 0, "processAdapter.runtime.platform is required")
    assert(typeof arch === "string" && arch.length > 0, "processAdapter.runtime.arch is required")
    const pnpmVersion = (await run(
      processAdapter,
      "pnpm",
      ["--version"],
      commandOptions(),
    )).trim()
    assert(pnpmVersion === PNPM_VERSION, `Release candidates require pnpm ${PNPM_VERSION}`)
    const npmVersion = (await run(
      processAdapter,
      "npm",
      ["--version"],
      commandOptions(),
    )).trim()
    assert(npmVersion === NPM_VERSION, `Release candidates require npm ${NPM_VERSION}`)

    await run(
      processAdapter,
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts"],
      commandOptions(root, false),
    )
    await run(
      processAdapter,
      "pnpm",
      ["--dir", "test/fixtures/dsh-runtime", "install", "--frozen-lockfile", "--ignore-scripts"],
      commandOptions(root, false),
    )
    await run(processAdapter, "pnpm", ["run", "check"], commandOptions(root, false))
    await run(processAdapter, "pnpm", ["run", "verify:release"], commandOptions(root, false))
    await run(processAdapter, "git", ["diff", "--exit-code"], commandOptions())
    const verifiedStatus = await run(
      processAdapter,
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      commandOptions(),
    )
    assertCleanStatus(verifiedStatus, "Verified release worktree")

    await writeFile(path.join(stagingDirectory, "npm-cli-version.txt"), `${npmVersion}\n`)

    const packOutput = await run(
      processAdapter,
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", stagingDirectory],
      commandOptions(),
    )
    const packReport = parseJson(packOutput, "npm pack output")
    assert(Array.isArray(packReport) && packReport.length === 1, "npm pack must report exactly one artifact")
    const artifactName = outputNames[0]
    assert(packReport[0]?.filename === artifactName, `npm pack must create ${artifactName}`)
    assert(packReport[0]?.name === PACKAGE_NAME, `npm pack must report ${PACKAGE_NAME}`)
    assert(packReport[0]?.version === requestedVersion, `npm pack must report version ${requestedVersion}`)
    await writeFile(
      path.join(stagingDirectory, "pack.json"),
      packOutput.endsWith("\n") ? packOutput : `${packOutput}\n`,
    )

    const artifactPath = path.join(stagingDirectory, artifactName)
    const dryRun = await run(
      processAdapter,
      "npm",
      ["publish", artifactPath, "--dry-run", "--force", "--ignore-scripts", "--json"],
      commandOptions(),
    )
    normalizedCapturedJson(dryRun, "npm publish --dry-run")

    const artifactBytes = await readFile(artifactPath)
    const artifactSha256 = sha256(artifactBytes)
    await writeFile(
      `${artifactPath}.sha256`,
      `${artifactSha256}  ${artifactName}\n`,
    )
    await writeFile(`${artifactPath}.sri`, `${sha512SRI(artifactBytes)}\n`)
    const sbomPath = `${artifactPath}.cdx.json`
    await run(
      processAdapter,
      "node",
      ["scripts/generate-sbom.mjs", artifactPath, sbomPath],
      commandOptions(),
    )

    const runtimeTree = await run(
      processAdapter,
      "pnpm",
      ["--dir", "test/fixtures/dsh-runtime", "list", "--depth", "Infinity", "--json"],
      commandOptions(),
    )
    const runtimeTreeText = normalizedCapturedJson(runtimeTree, "pnpm DSH runtime list")
    await writeFile(path.join(stagingDirectory, "dsh-runtime-dependency-tree.json"), runtimeTreeText)

    await run(
      processAdapter,
      "pnpm",
      ["run", "smoke:dsh-profile"],
      commandOptions(root, false, {
        DSH_CLI_ROOT: fixtureRoot,
        DSH_PLUGIN_PACKAGE: artifactPath,
      }),
    )

    const runtimeManifest = await readRepositoryJson(
      root,
      "test/fixtures/dsh-runtime/node_modules/@deepseek-ai/dsh/package.json",
    )
    assert(runtimeManifest.name === "@deepseek-ai/dsh", "Installed DSH runtime package has the wrong name")
    assert(runtimeManifest.version === dshVersion, `Installed DSH runtime must be ${dshVersion}`)
    const fixtureLock = await readFile(path.join(fixtureRoot, "pnpm-lock.yaml"))
    const runtimeEnvironment = {
      schemaVersion: 1,
      runtimePackage: runtimeManifest.name,
      runtimeVersion: runtimeManifest.version,
      fixtureLockSha256: sha256(fixtureLock),
      nodeVersion,
      pnpmVersion,
      platform,
      arch,
      lifecycleScripts: "disabled",
    }
    await writeFile(
      path.join(stagingDirectory, "dsh-runtime-environment.json"),
      `${JSON.stringify(runtimeEnvironment, null, 2)}\n`,
    )

    await mkdir(isolatedDirectory)
    await run(processAdapter, "npm", ["init", "-y"], commandOptions(isolatedDirectory, false))
    await run(
      processAdapter,
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifactPath],
      commandOptions(isolatedDirectory, false),
    )
    await run(
      processAdapter,
      "node",
      [
        "--input-type=module",
        "-e",
        `const plugin = await import(${JSON.stringify(PACKAGE_NAME)}); if (plugin.name !== "dsh-codex") process.exit(1)`,
      ],
      commandOptions(isolatedDirectory),
    )
    const isolatedTree = await run(
      processAdapter,
      "npm",
      ["ls", "--all", "--json"],
      commandOptions(isolatedDirectory),
    )
    await writeFile(
      path.join(stagingDirectory, "isolated-dependency-tree.json"),
      normalizedCapturedJson(isolatedTree, "npm ls"),
    )
    const audit = await runNpmAudit(
      processAdapter,
      commandOptions(isolatedDirectory, true, {
        npm_config_fetch_retries: "0",
        npm_config_fetch_timeout: "60000",
      }),
    )
    await writeFile(
      path.join(stagingDirectory, "npm-audit.json"),
      normalizedCapturedJson(audit, "npm audit"),
    )

    const lockPath = path.join(root, "pnpm-lock.yaml")
    const evidenceFiles = {
      sbomSha256: sbomPath,
      dshRuntimeDependencyTreeSha256: path.join(stagingDirectory, "dsh-runtime-dependency-tree.json"),
      dshRuntimeEnvironmentSha256: path.join(stagingDirectory, "dsh-runtime-environment.json"),
      isolatedDependencyTreeSha256: path.join(stagingDirectory, "isolated-dependency-tree.json"),
      npmAuditSha256: path.join(stagingDirectory, "npm-audit.json"),
      npmCliVersionSha256: path.join(stagingDirectory, "npm-cli-version.txt"),
    }
    const evidence = {
      status: "passed",
      packageName: PACKAGE_NAME,
      version: requestedVersion,
      sourceCommit,
      dshProfileSmoke: "passed",
      artifactSha256,
      lockSha256: sha256(await readFile(lockPath)),
    }
    for (const [field, file] of Object.entries(evidenceFiles)) {
      evidence[field] = sha256(await readFile(file))
    }
    await writeFile(
      path.join(stagingDirectory, "isolated-import.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    )

    await assertStagedOutputs(stagingDirectory, outputNames)
    await installOutputs(root, stagingDirectory, outputNames)

    return Object.freeze({
      artifactPath: `release/${artifactName}`,
      evidencePath: "release/isolated-import.json",
      outputPaths: Object.freeze(outputNames.map((name) => `release/${name}`)),
      sourceCommit,
      version: requestedVersion,
    })
  } finally {
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }
}

export function createLocalProcessAdapter({
  nodeExecutable = process.execPath,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
  environment = process.env,
} = {}) {
  const npm = resolveNpmCommand({ environment, nodeExecutable, platform })
  const commands = Object.freeze({
    git: Object.freeze({ executable: "git", prefixArgs: [], shell: false }),
    node: Object.freeze({ executable: nodeExecutable, prefixArgs: [], shell: false }),
    npm,
    pnpm: Object.freeze({
      executable: platform === "win32" ? "pnpm.cmd" : "pnpm",
      prefixArgs: [],
      shell: platform === "win32",
    }),
  })
  return Object.freeze({
    runtime: Object.freeze({ arch, nodeVersion, platform }),
    run(tool, arguments_, { capture = true, cwd, environment: childEnvironment }) {
      const command = commands[tool]
      assert(command !== undefined, `Unknown local process tool: ${String(tool)}`)
      assert(Array.isArray(arguments_), "Process arguments must be an array")
      const result = spawnSync(
        command.executable,
        [...command.prefixArgs, ...arguments_],
        {
          cwd,
          encoding: "utf8",
          env: childEnvironment,
          maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
          shell: command.shell,
          stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
          timeout: MAX_COMMAND_DURATION_MS,
          windowsHide: true,
        },
      )
      if (result.status !== 0 || result.error !== undefined) {
        const detail = [result.error?.message, result.stdout, result.stderr]
          .filter((value) => typeof value === "string" && value.length > 0)
          .join("\n")
        throw new Error(
          `${executableLabel(tool, arguments_)} failed (${String(result.status)})${detail.length === 0 ? "" : `:\n${detail}`}`,
        )
      }
      return capture ? result.stdout ?? "" : ""
    },
    wait(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds))
    },
  })
}

async function runCli() {
  const rawArguments = process.argv.slice(2)
  const arguments_ = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments
  assert(
    arguments_.length === 1 && !arguments_[0].startsWith("-"),
    "Usage: node scripts/build-release-candidate.mjs <version>",
  )
  const result = await buildReleaseCandidate({
    repositoryRoot,
    version: arguments_[0],
  })
  process.stdout.write(
    `Built ${result.artifactPath} from ${result.sourceCommit} with ${result.outputPaths.length} managed outputs.\n`,
  )
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
