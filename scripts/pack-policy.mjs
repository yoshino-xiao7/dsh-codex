import path from "node:path"

export const REQUIRED_PACKED_FILES = Object.freeze([
  "package.json",
  "dist/host/index.mjs",
  "dist/client/index.js",
  "dist/internal/reliability.mjs",
  "types/client.d.ts",
  "types/index.d.ts",
  "types/reliability.d.ts",
  "codex-community.patch.yml",
  "README.md",
  "README.en.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING.en.md",
  "SECURITY.md",
  "SUPPORT.md",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
])

const ALLOWED_TOP_LEVEL_FILES = new Set(REQUIRED_PACKED_FILES.filter((file) => !file.includes("/")))

function isAllowedPackedPath(file) {
  if (ALLOWED_TOP_LEVEL_FILES.has(file)) return true
  if (/^dist\/host\/[a-z0-9-]+\.mjs$/u.test(file)) return true
  if (/^dist\/client\/[a-z0-9-]+\.js$/u.test(file)) return true
  if (/^dist\/internal\/[a-z0-9-]+\.mjs$/u.test(file)) return true
  if (/^types\/[a-z0-9-]+\.d\.ts$/u.test(file)) return true
  if (/^docs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/u.test(file)) return true
  return /^docs\/releases\/v\d+\.\d+\.\d+\.acceptance\.json$/u.test(file)
}

export function validatePackedPaths(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Packed artifact did not report any files")
  }

  const seen = new Set()
  for (const file of files) {
    if (typeof file !== "string"
      || file.length === 0
      || file.includes("\\")
      || path.posix.isAbsolute(file)
      || path.posix.normalize(file) !== file
      || seen.has(file)) {
      throw new Error(`Packed artifact contains an invalid path: ${String(file)}`)
    }
    seen.add(file)
    if (!isAllowedPackedPath(file)) {
      throw new Error(`Packed artifact contains a path outside the allowlist: ${file}`)
    }
  }

  for (const required of REQUIRED_PACKED_FILES) {
    if (!seen.has(required)) throw new Error(`Packed artifact is missing ${required}`)
  }
}

function markdownDestinations(markdown) {
  const withoutFencedCode = markdown
    .replace(/^ {0,3}```[^\n]*\n[\s\S]*?^ {0,3}```\s*$/gmu, "")
    .replace(/^ {0,3}~~~[^\n]*\n[\s\S]*?^ {0,3}~~~\s*$/gmu, "")
  const destinations = []
  const inlineLink = /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gu
  const referenceLink = /^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gmu

  for (const match of withoutFencedCode.matchAll(inlineLink)) destinations.push(match[1])
  for (const match of withoutFencedCode.matchAll(referenceLink)) destinations.push(match[1])
  return destinations
}

function resolvePackedLink(source, rawDestination) {
  let destination = rawDestination.startsWith("<") && rawDestination.endsWith(">")
    ? rawDestination.slice(1, -1)
    : rawDestination
  if (destination === "" || destination.startsWith("#")) return undefined
  if (/^[a-z][a-z0-9+.-]*:/iu.test(destination) || destination.startsWith("//")) {
    return undefined
  }

  destination = destination.split(/[?#]/u, 1)[0]
  try {
    destination = decodeURIComponent(destination)
  } catch {
    throw new Error(`${source} contains an invalid percent-encoded Markdown link: ${rawDestination}`)
  }
  if (destination.includes("\\") || path.posix.isAbsolute(destination)) {
    throw new Error(`${source} contains a non-portable Markdown link: ${rawDestination}`)
  }

  const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), destination))
  if (target === ".." || target.startsWith("../")) {
    throw new Error(`${source} contains a Markdown link outside the package: ${rawDestination}`)
  }
  return target
}

const FORBIDDEN_PACKED_DIST_EXPORTS = Object.freeze([
  "installSettingsSection",
  "settingsNamespace",
])

export function validatePackedDistContents(files, contentsByPath) {
  const packed = Array.isArray(files) ? files : []
  for (const file of packed) {
    if (typeof file !== "string" || !file.startsWith("dist/")) continue
    const source = contentsByPath.get(file)
    if (typeof source !== "string") {
      throw new Error(`Packed dist source could not be read: ${file}`)
    }
    for (const name of FORBIDDEN_PACKED_DIST_EXPORTS) {
      if (new RegExp(`\\b${name}\\b`, "u").test(source)) {
        throw new Error(
          `Packed artifact ${file} still references removed dsh-settings export ${name}`,
        )
      }
    }
  }
}

export function validatePackedMarkdownLinks(files, markdownByPath) {
  const packed = new Set(files)
  for (const source of files.filter((file) => file.endsWith(".md"))) {
    const markdown = markdownByPath.get(source)
    if (typeof markdown !== "string") {
      throw new Error(`Packed Markdown source could not be read: ${source}`)
    }
    for (const destination of markdownDestinations(markdown)) {
      const target = resolvePackedLink(source, destination)
      if (target !== undefined && !packed.has(target)) {
        throw new Error(`${source} links to unpacked target ${target}`)
      }
    }
  }
}
