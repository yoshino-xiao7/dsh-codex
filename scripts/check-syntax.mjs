import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots = ["src", "scripts", "test"]
const PUBLIC_RUNTIME_IMPORTS = new Set([
  "@deepseek-ai/dsh-authorization",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-llm-pi-ai",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/schemastery",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/api/openai-codex-responses",
  "@earendil-works/pi-ai/api/simple-options",
  "@earendil-works/pi-ai/providers/openai-codex",
])

async function main() {
  const files = (await Promise.all(
    roots.map((directory) => collectJavaScriptFiles(path.join(root, directory))),
  )).flat()
  files.sort((left, right) => left.localeCompare(right, "en"))

  for (const file of files) {
    const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" })
    if (check.status !== 0) {
      process.stderr.write(check.stderr)
      process.exit(check.status ?? 1)
    }
  }

  for (const file of files.filter((candidate) => candidate.includes(`${path.sep}src${path.sep}`))) {
    const source = await readFile(file, "utf8")
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith("node:")) continue
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier)
        const relative = path.relative(path.join(root, "src"), target)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new Error(`Source import leaves src/: ${path.relative(root, file)} -> ${specifier}`)
        }
        continue
      }
      if (!PUBLIC_RUNTIME_IMPORTS.has(specifier)) {
        throw new Error(`Undeclared runtime import: ${path.relative(root, file)} -> ${specifier}`)
      }
    }
  }
}

function moduleSpecifiers(source) {
  const pattern = /(?:\bimport\s+(?:[^"'()]*?\s+from\s+)?|\bexport\s+[^"']*?\s+from\s+|\bimport\s*\(\s*)["']([^"']+)["']/gu
  return [...source.matchAll(pattern)].map((match) => match[1])
}

export async function collectJavaScriptFiles(directory) {
  const files = []
  await collect(directory, files)
  return files
}

async function collect(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== "node_modules") await collect(target, files)
    else if (entry.isFile() && /\.m?js$/u.test(entry.name)) files.push(target)
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (import.meta.url === entry) await main()
