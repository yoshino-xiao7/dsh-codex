import { execFileSync } from "node:child_process"
import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

export function pinnedRuntimeVersions(...manifests) {
  const versions = new Map()
  for (const manifest of manifests) {
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, version] of Object.entries(manifest?.[field] ?? {})) {
        if (typeof version !== "string" || !EXACT_VERSION.test(version)) continue
        const existing = versions.get(name)
        if (existing !== undefined && existing !== version) {
          throw new Error(`Conflicting runtime pins for ${name}: ${existing} and ${version}`)
        }
        versions.set(name, version)
      }
    }
  }
  return [...versions]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, pinned]) => ({ name, pinned }))
}

export function compareRegistryVersions(pinned, latestByName) {
  return pinned.map(({ name, pinned: version }) => {
    const latest = latestByName.get(name)
    if (typeof latest !== "string" || !EXACT_VERSION.test(latest)) {
      throw new Error(`Registry returned an invalid latest version for ${name}`)
    }
    return { name, pinned: version, latest, drifted: latest !== version }
  })
}

export function registryDriftSummary(comparisons) {
  const lines = [
    "## Runtime registry drift",
    "",
    "| Package | Pinned | Registry latest | Status |",
    "| --- | --- | --- | --- |",
    ...comparisons.map(({ name, pinned, latest, drifted }) => (
      `| \`${name}\` | \`${pinned}\` | \`${latest}\` | ${drifted ? "drift" : "current"} |`
    )),
    "",
  ]
  return `${lines.join("\n")}\n`
}

function registryLatest(name) {
  const output = execFileSync("npm", ["view", `${name}@latest`, "version", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
  return JSON.parse(output)
}

async function main() {
  const manifestPaths = [
    path.join(root, "package.json"),
    path.join(root, "test", "fixtures", "dsh-runtime", "package.json"),
  ]
  const manifests = await Promise.all(manifestPaths.map(async (manifestPath) => (
    JSON.parse(await readFile(manifestPath, "utf8"))
  )))
  const pinned = pinnedRuntimeVersions(...manifests)
  if (pinned.length === 0) throw new Error("No exact runtime dependency pins were found")
  const latestByName = new Map(pinned.map(({ name }) => [name, registryLatest(name)]))
  const comparisons = compareRegistryVersions(pinned, latestByName)
  const summary = registryDriftSummary(comparisons)
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8")
  }
  if (comparisons.some(({ drifted }) => drifted)) {
    process.stderr.write("Pinned runtime dependencies differ from one or more registry latest versions.\n")
    process.exitCode = 1
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (import.meta.url === entry) await main()
