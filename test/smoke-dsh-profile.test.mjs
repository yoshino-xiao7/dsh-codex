import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { resolveNpmCommand } from "../scripts/npm-command.mjs"
import {
  assertInstalledConfig,
  commandFromDshManifest,
  resolveDshCommand,
  resolvePluginPackage,
} from "../scripts/smoke-dsh-profile.mjs"

const originalConfig = `# == base
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
- id: another-base-entry
  name: '@example/base'
`

const additions = `# == dsh-codex-community
- id: authorization
  name: '@deepseek-ai/dsh-authorization'
- id: dsh-codex
  name: dsh-codex-community
  config:
    partialResponseRecovery: true
`

test("npm command resolution avoids Windows shims and uses a safe fallback", () => {
  const configured = path.resolve("runtime", "npm-cli.js")
  assert.deepEqual(resolveNpmCommand({
    environment: { npm_execpath: configured },
    nodeExecutable: "node.exe",
    platform: "win32",
    fileExists: (candidate) => candidate === configured,
  }), {
    executable: "node.exe",
    prefixArgs: [configured],
    shell: false,
  })

  assert.deepEqual(resolveNpmCommand({
    environment: {},
    nodeExecutable: "node.exe",
    platform: "win32",
    fileExists: () => false,
  }), {
    executable: "npm.cmd",
    prefixArgs: [],
    shell: true,
  })
})

test("profile assertion accepts independent enabled entries", () => {
  assert.doesNotThrow(() => assertInstalledConfig(originalConfig, `${originalConfig}${additions}`))
})

test("profile assertion rejects a modified base pi-ai entry", () => {
  const installed = `${originalConfig.replace(
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    "  name: '@deepseek-ai/dsh-llm-pi-ai'\n  config:\n    providers: {}",
  )}${additions}`
  assert.throws(
    () => assertInstalledConfig(originalConfig, installed),
    /modified the base llm-pi-ai entry/u,
  )
})

test("profile assertion rejects duplicate plugin entries", () => {
  assert.throws(
    () => assertInstalledConfig(originalConfig, `${originalConfig}${additions}${additions}`),
    /Expected exactly one authorization entry, found 2/u,
  )
})

test("profile assertion rejects disabled base pi-ai", () => {
  const disabledOriginal = originalConfig.replace(
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    "  name: '@deepseek-ai/dsh-llm-pi-ai'\n  disabled: true",
  )
  assert.throws(
    () => assertInstalledConfig(disabledOriginal, `${disabledOriginal}${additions}`),
    /Expected llm-pi-ai to remain enabled/u,
  )
})

test("DSH package metadata resolves the real JS entry through Node", () => {
  const packageRoot = path.resolve("runtime", "node_modules", "@deepseek-ai", "dsh")
  assert.deepEqual(
    commandFromDshManifest({
      name: "@deepseek-ai/dsh",
      version: "0.1.1-rc.2",
      bin: { dsh: "lib/bin.js" },
    }, packageRoot, "/node-under-test"),
    {
      executable: "/node-under-test",
      prefixArgs: [path.join(packageRoot, "lib", "bin.js")],
      label: `/node-under-test ${path.join(packageRoot, "lib", "bin.js")}`,
    },
  )
})

test("DSH package metadata rejects a drifting CLI version", () => {
  assert.throws(
    () => commandFromDshManifest({
      name: "@deepseek-ai/dsh",
      version: "0.1.1-rc.3",
      bin: { dsh: "lib/bin.js" },
    }, "/runtime/dsh"),
    /Expected @deepseek-ai\/dsh 0\.1\.1-rc\.2, found 0\.1\.1-rc\.3/u,
  )
})

test("DSH CLI root resolution bypasses platform-specific npm shims", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dsh-command-test-"))
  const packageRoot = path.join(temporary, "node_modules", "@deepseek-ai", "dsh")
  try {
    await mkdir(path.join(packageRoot, "lib"), { recursive: true })
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@deepseek-ai/dsh",
      version: "0.1.1-rc.2",
      bin: { dsh: "lib/bin.js" },
    }))
    await writeFile(path.join(packageRoot, "lib", "bin.js"), "")

    const command = await resolveDshCommand({
      cliRoot: temporary,
      nodeExecutable: "node.exe",
      platform: "win32",
    })
    assert.equal(command.executable, "node.exe")
    assert.deepEqual(command.prefixArgs, [path.join(packageRoot, "lib", "bin.js")])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("an existing release candidate tarball is used without repacking", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dsh-package-test-"))
  const candidate = path.join(temporary, "release-candidate.tgz")
  const unusedPackDirectory = path.join(temporary, "unused-pack-directory")
  try {
    await writeFile(candidate, "candidate bytes")
    assert.equal(
      await resolvePluginPackage(candidate, unusedPackDirectory),
      candidate,
    )
    await assert.rejects(access(unusedPackDirectory), { code: "ENOENT" })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("release candidate input rejects non-tarball files", async () => {
  await assert.rejects(
    resolvePluginPackage("release-candidate.zip", os.tmpdir()),
    /DSH_PLUGIN_PACKAGE must point to an npm \.tgz/u,
  )
})
