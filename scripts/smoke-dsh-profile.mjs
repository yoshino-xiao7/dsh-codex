import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolveNpmCommand } from "./npm-command.mjs"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const supportedDshVersion = "0.1.1-rc.2"

if (isMainModule()) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dsh-codex-profile-smoke-"))
  let primaryFailure
  try {
    const command = await resolveDshCommand()
    const home = path.join(temporary, "home")
    const environment = {
      ...process.env,
      DSH_HOME: home,
      npm_config_cache: path.join(temporary, "npm-cache"),
    }
    assertDshVersion(command, environment)
    const packageFile = await resolvePluginPackage(process.env.DSH_PLUGIN_PACKAGE, temporary)

    const beforeInstallDump = run(command, ["--profile", "web", "--dump-config"], environment).stdout
    run(command, ["plugin", "--profile", "web", "add", packageFile], environment)
    const installedDump = run(command, ["--profile", "web", "--dump-config"], environment).stdout
    assertInstalledConfig(beforeInstallDump, installedDump)

    await expectWebReady(command, environment)
    await preserveSmokeArtifact(packageFile, process.env.DSH_SMOKE_ARTIFACT_DIR)
  } catch (error) {
    primaryFailure = error
  }
  await finalizeSmokeTemporaryDirectory(temporary, primaryFailure)
}

export async function finalizeSmokeTemporaryDirectory(
  temporary,
  primaryFailure,
  { removeDirectory = rm } = {},
) {
  let cleanupFailure
  try {
    await removeDirectory(temporary, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 250,
    })
  } catch (error) {
    cleanupFailure = error
  }

  if (primaryFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      "DSH profile smoke failed and temporary cleanup also failed",
    )
  }
  if (primaryFailure !== undefined) throw primaryFailure
  if (cleanupFailure !== undefined) throw cleanupFailure
}

export async function resolvePluginPackage(candidate, temporary) {
  if (candidate === undefined || candidate === "") return pack(temporary)
  const packageFile = path.resolve(candidate)
  if (path.extname(packageFile).toLowerCase() !== ".tgz") {
    throw new Error(`DSH_PLUGIN_PACKAGE must point to an npm .tgz, found ${packageFile}`)
  }
  await access(packageFile)
  return packageFile
}

export async function resolveDshCommand({
  cliRoot = process.env.DSH_CLI_ROOT,
  executable = process.env.DSH_BIN,
  nodeExecutable = process.execPath,
  platform = process.platform,
  projectRoot = root,
} = {}) {
  if (cliRoot !== undefined && executable !== undefined) {
    throw new Error("Set only one of DSH_CLI_ROOT or DSH_BIN")
  }

  if (cliRoot !== undefined) {
    return readDshPackageCommand(
      path.join(path.resolve(cliRoot), "node_modules", "@deepseek-ai", "dsh"),
      nodeExecutable,
    )
  }

  if (executable !== undefined) {
    const commandPath = resolveCommandPath(executable)
    if (/\.[cm]?js$/iu.test(commandPath)) {
      await access(commandPath)
      return { executable: nodeExecutable, prefixArgs: [commandPath], label: commandPath }
    }
    if (platform === "win32" && /\.(?:cmd|ps1)$/iu.test(commandPath)) {
      const packageRoot = path.resolve(
        path.dirname(commandPath),
        "..",
        "@deepseek-ai",
        "dsh",
      )
      return readDshPackageCommand(packageRoot, nodeExecutable)
    }
    if (path.isAbsolute(commandPath)) await access(commandPath)
    return { executable: commandPath, prefixArgs: [], label: commandPath }
  }

  const localPackageRoot = path.join(projectRoot, "node_modules", "@deepseek-ai", "dsh")
  try {
    return await readDshPackageCommand(localPackageRoot, nodeExecutable)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  const localBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    platform === "win32" ? "dsh.cmd" : "dsh",
  )
  await access(localBin)
  return { executable: localBin, prefixArgs: [], label: localBin }
}

export function commandFromDshManifest(manifest, packageRoot, nodeExecutable = process.execPath) {
  if (manifest?.name !== "@deepseek-ai/dsh") {
    throw new Error(`Expected @deepseek-ai/dsh package metadata, found ${String(manifest?.name)}`)
  }
  if (manifest.version !== supportedDshVersion) {
    throw new Error(`Expected @deepseek-ai/dsh ${supportedDshVersion}, found ${String(manifest.version)}`)
  }
  const relativeEntry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh
  if (typeof relativeEntry !== "string" || relativeEntry.length === 0) {
    throw new Error("@deepseek-ai/dsh does not declare the dsh CLI entry")
  }
  const normalizedRoot = path.resolve(packageRoot)
  const entry = path.resolve(normalizedRoot, relativeEntry)
  const relative = path.relative(normalizedRoot, entry)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("@deepseek-ai/dsh declares a CLI entry outside its package")
  }
  return {
    executable: nodeExecutable,
    prefixArgs: [entry],
    label: `${nodeExecutable} ${entry}`,
  }
}

async function readDshPackageCommand(packageRoot, nodeExecutable) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"))
  const command = commandFromDshManifest(manifest, packageRoot, nodeExecutable)
  await access(command.prefixArgs[0])
  return command
}

function resolveCommandPath(value) {
  if (path.isAbsolute(value) || value.includes("/") || value.includes("\\")) {
    return path.resolve(value)
  }
  return value
}

export function assertInstalledConfig(beforeInstallDump, installedDump) {
  const originalPiAi = singletonEntry(beforeInstallDump, "llm-pi-ai")
  assertEntryName(originalPiAi, "llm-pi-ai", "@deepseek-ai/dsh-llm-pi-ai")
  assertEnabled(originalPiAi, "llm-pi-ai")

  const installedPiAi = singletonEntry(installedDump, "llm-pi-ai")
  if (installedPiAi !== originalPiAi) {
    throw new Error("The installed plugin modified the base llm-pi-ai entry")
  }

  const authorization = singletonEntry(installedDump, "authorization")
  assertEntryName(authorization, "authorization", "@deepseek-ai/dsh-authorization")
  assertEnabled(authorization, "authorization")

  const codex = singletonEntry(installedDump, "dsh-codex")
  assertEntryName(codex, "dsh-codex", "dsh-codex-community")
  assertEnabled(codex, "dsh-codex")
}

function singletonEntry(dump, id) {
  const entries = extractEntries(dump).filter((entry) => entry.id === id)
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one ${id} entry, found ${entries.length}`)
  }
  return entries[0].source
}

function extractEntries(dump) {
  const lines = String(dump).replaceAll("\r\n", "\n").split("\n")
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^- id: ([^\s]+)\s*$/u)
    if (match !== null) starts.push({ id: match[1], index })
  }
  return starts.map(({ id, index }, entryIndex) => {
    const end = starts[entryIndex + 1]?.index ?? lines.length
    const sourceLines = lines.slice(index, end)
    while (sourceLines.at(-1)?.trim() === "" || sourceLines.at(-1)?.startsWith("#")) {
      sourceLines.pop()
    }
    return { id, source: sourceLines.join("\n") }
  })
}

function assertEntryName(entry, id, expected) {
  const raw = entry.match(/^  name: (.+)$/mu)?.[1]?.trim()
  const actual = unquoteYamlScalar(raw)
  if (actual !== expected) {
    throw new Error(`Expected ${id} to load ${expected}, found ${String(actual)}`)
  }
}

function assertEnabled(entry, id) {
  if (/^  disabled:/mu.test(entry)) {
    throw new Error(`Expected ${id} to remain enabled`)
  }
}

function unquoteYamlScalar(value) {
  if (typeof value !== "string" || value.length < 2) return value
  const first = value.at(0)
  const last = value.at(-1)
  return (first === last && (first === "'" || first === '"')) ? value.slice(1, -1) : value
}

function isMainModule() {
  if (process.argv[1] === undefined) return false
  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
}

function pack(destination) {
  const npm = resolveNpmCommand()
  const packed = spawnSync(
    npm.executable,
    [...npm.prefixArgs, "pack", "--json", "--pack-destination", destination],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: path.join(destination, "npm-cache") },
      shell: npm.shell,
      windowsHide: true,
    },
  )
  if (packed.status !== 0) failCommand("npm pack", packed)
  const report = JSON.parse(packed.stdout)
  const filename = report[0]?.filename
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack did not report an artifact filename")
  }
  return path.join(destination, filename)
}

function assertDshVersion(command, environment) {
  const actual = run(command, ["--version"], environment).stdout.trim()
  if (actual !== supportedDshVersion) {
    throw new Error(`Expected dsh ${supportedDshVersion}, found ${JSON.stringify(actual)}`)
  }
}

function run(command, args, environment) {
  const result = spawnSync(command.executable, [...command.prefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.status !== 0) failCommand(formatCommand(command, args), result)
  return result
}

async function expectWebReady(command, environment) {
  const args = ["--profile", "web", "--no-open", "--port", "0"]
  const child = spawn(command.executable, [...command.prefixArgs, ...args], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let output = ""
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }))
    child.once("error", (error) => resolve({ error }))
  })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DSH Web did not become ready:\n${output}`)), 30_000)
    const consume = (chunk) => {
      output += chunk.toString("utf8")
      const match = output.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u)
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on("data", consume)
    child.stderr.on("data", consume)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(new Error(`Could not start DSH Web: ${error.message}`))
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`DSH Web exited before readiness (${String(code)}/${String(signal)}):\n${output}`))
    })
  })

  let shutdownRequested = false
  try {
    const baseUrl = await ready
    await probeAuthorizationRpc(baseUrl)
    await probeClientBundle(baseUrl)
  } finally {
    shutdownRequested = await stopChild(child, exited)
  }
  const result = await exited
  if (result.error !== undefined) throw result.error
  if (!shutdownRequested && result.signal === null && result.code !== 0 && result.code !== 130) {
    throw new Error(`DSH Web failed after readiness (${String(result.code)}/${String(result.signal)}):\n${output}`)
  }
}

async function stopChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) return false
  const requested = child.kill(process.platform === "win32" ? "SIGTERM" : "SIGINT")
  if (!requested) return false
  if (await settlesWithin(exited, 5_000)) return true
  child.kill("SIGKILL")
  if (!await settlesWithin(exited, 5_000)) {
    throw new Error("DSH Web did not exit after SIGKILL")
  }
  return true
}

async function settlesWithin(promise, timeout) {
  let timer
  const sentinel = Symbol("timeout")
  const result = await Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(sentinel), timeout)
    }),
  ])
  clearTimeout(timer)
  return result !== sentinel
}

async function preserveSmokeArtifact(packageFile, destination) {
  if (destination === undefined || destination === "") return
  const directory = path.resolve(destination)
  await mkdir(directory, { recursive: true })
  const artifact = path.join(directory, path.basename(packageFile))
  if (path.resolve(packageFile) !== artifact) await copyFile(packageFile, artifact)
  process.stdout.write(`verified npm artifact: ${artifact}\n`)
}

async function probeAuthorizationRpc(baseUrl) {
  const rpcId = randomUUID()
  const response = await fetch(`${baseUrl}/dsh-codex/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId,
      method: "status",
      payload: {},
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Codex authorization RPC returned HTTP ${response.status}`)
  const result = await response.json()
  if (result?.type !== "server-response" || result.rpcId !== rpcId || result.result?.ok !== true) {
    throw new Error("Codex authorization RPC returned an invalid response envelope")
  }
  const value = result.result.value
  if (value?.flow?.key !== "dsh-codex/openai-codex") {
    throw new Error("Codex authorization RPC did not expose the expected public flow")
  }
  if (!value.flow.methods?.some(({ id }) => id === "oauth")) {
    throw new Error("Codex authorization RPC did not expose the OAuth method")
  }
  if (typeof value.credential?.configured !== "boolean" || typeof value.credential?.writable !== "boolean") {
    throw new Error("Codex authorization RPC did not return bounded credential metadata")
  }
  if (value.quota?.status !== "unknown") {
    throw new Error("Codex status RPC did not return the initial sanitized quota observation")
  }
  const serialized = JSON.stringify(result)
  for (const forbidden of ["accessToken", "refreshToken", "access_token", "refresh_token"]) {
    if (serialized.includes(forbidden)) throw new Error(`Codex authorization RPC leaked ${forbidden}`)
  }
}

async function probeClientBundle(baseUrl) {
  const response = await fetch(`${baseUrl}/plugins/dsh-codex-community/client.js`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Codex client bundle returned HTTP ${response.status}`)
  const source = await response.text()
  for (const marker of [
    'id: "dsh-codex-community"',
    '"settings.section"',
    '"/dsh-codex"',
    '"OpenAI Codex"',
    '"Usage"',
    '"Codex models in this installation"',
  ]) {
    if (!source.includes(marker)) throw new Error(`Codex client bundle is missing ${marker}`)
  }
}

function failCommand(label, result) {
  const cause = result.error === undefined ? "" : `${result.error.message}\n`
  throw new Error(`${label} failed (${String(result.status)}):\n${cause}${result.stdout ?? ""}${result.stderr ?? ""}`)
}

function formatCommand(command, args) {
  return [command.label, ...args].join(" ")
}
