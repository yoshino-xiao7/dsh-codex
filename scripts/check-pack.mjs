import { spawnSync } from "node:child_process"
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  validatePackedMarkdownLinks,
  validatePackedPaths,
} from "./pack-policy.mjs"
import { resolveNpmCommand } from "./npm-command.mjs"

const cache = await mkdtemp(path.join(os.tmpdir(), "dsh-codex-community-npm-"))
let packed
try {
  const npm = resolveNpmCommand()
  packed = spawnSync(
    npm.executable,
    [...npm.prefixArgs, "pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cache },
      shell: npm.shell,
      windowsHide: true,
    },
  )
} finally {
  await rm(cache, { recursive: true, force: true })
}
if (packed.status !== 0) {
  const detail = [packed.error?.message, packed.stdout, packed.stderr]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n")
  if (detail.length > 0) process.stderr.write(`${detail}\n`)
  process.exit(packed.status ?? 1)
}

const report = JSON.parse(packed.stdout)
if (report.length !== 1 || !Array.isArray(report[0]?.files)) {
  throw new Error("npm pack returned an unexpected report")
}
const files = report[0].files.map((entry) => entry.path)
validatePackedPaths(files)

const markdownByPath = new Map()
for (const file of files) {
  const sourcePath = path.resolve(process.cwd(), file)
  const sourceStat = await lstat(sourcePath)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Packed artifact source must be a regular file: ${file}`)
  }
  if (file.endsWith(".md")) markdownByPath.set(file, await readFile(sourcePath, "utf8"))
}
validatePackedMarkdownLinks(files, markdownByPath)
