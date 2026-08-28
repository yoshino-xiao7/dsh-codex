import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024 * 1024
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const PNPM_LIST_ARGUMENTS = Object.freeze([
  "list",
  "--prod",
  "--json",
  "--depth",
  "Infinity",
  "--lockfile-only",
])

const EVIDENCE_PROPERTIES = Object.freeze({
  artifactSha256: "dsh-codex:artifact:sha256",
  lockSha256: "dsh-codex:pnpm-lock:sha256",
  manifestDescriptorsSha256: "dsh-codex:manifest-descriptors:sha256",
})

const MANIFEST_DESCRIPTOR_FIELDS = Object.freeze([
  "name",
  "version",
  "license",
  "repository",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  )
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex")
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
  }
}

function assertPackageName(value, label = "package name") {
  if (
    typeof value !== "string"
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)
  ) {
    throw new Error(`${label} is not a supported npm package name`)
  }
}

function packagePurl(name, version) {
  assertPackageName(name)
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`package ${name} has no resolved version`)
  }
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/")
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
}

function artifactFileName(manifest) {
  return `${manifest.name.replace(/^@/u, "").replaceAll("/", "-")}-${manifest.version}.tgz`
}

function evidencePropertyMap(sbom) {
  const properties = sbom.metadata?.component?.properties
  if (!Array.isArray(properties)) return new Map()
  return new Map(properties.map((property) => [property?.name, property?.value]))
}

export function productionManifest(input) {
  if (!isObject(input)) throw new TypeError("package manifest must be an object")
  const manifest = structuredClone(input)
  delete manifest.devDependencies
  delete manifest.scripts
  return manifest
}

export function manifestDescriptors(input) {
  if (!isObject(input)) throw new TypeError("package manifest must be an object")
  return Object.fromEntries(
    MANIFEST_DESCRIPTOR_FIELDS
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, structuredClone(input[field])]),
  )
}

export function manifestDescriptorHash(input) {
  return sha256(canonicalJson(manifestDescriptors(input)))
}

export function assertArtifactManifestMatchesRepository(artifactManifest, repositoryManifest) {
  if (!isObject(artifactManifest) || !isObject(repositoryManifest)) {
    throw new TypeError("artifact and repository manifests must be objects")
  }
  for (const field of MANIFEST_DESCRIPTOR_FIELDS) {
    const artifactValue = artifactManifest[field]
    const repositoryValue = repositoryManifest[field]
    if (canonicalJson(artifactValue) !== canonicalJson(repositoryValue)) {
      throw new Error(`artifact package.json ${field} does not match the repository`)
    }
  }
}

export function validateTarEntries(output) {
  if (typeof output !== "string") throw new TypeError("tar entry list must be a string")
  const entries = output.replaceAll("\r\n", "\n").split("\n").filter(Boolean)
  if (entries.filter((entry) => entry === "package/package.json").length !== 1) {
    throw new Error("npm artifact must contain exactly one package/package.json")
  }
  for (const entry of entries) {
    const normalized = entry.endsWith("/") ? entry.slice(0, -1) : entry
    if (
      normalized !== "package"
      && (
        !normalized.startsWith("package/")
        || normalized.split("/").includes("..")
        || path.posix.isAbsolute(normalized)
      )
    ) {
      throw new Error(`npm artifact contains an unsafe path: ${entry}`)
    }
  }
  return entries
}

export function readArtifactManifest(artifact) {
  const entries = execFileSync("tar", ["-tzf", artifact], {
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  })
  validateTarEntries(entries)
  const serialized = execFileSync("tar", ["-xOzf", artifact, "package/package.json"], {
    encoding: "utf8",
    maxBuffer: MAX_MANIFEST_BYTES,
  })
  const manifest = JSON.parse(serialized)
  if (!isObject(manifest)) throw new Error("artifact package.json must be an object")
  return manifest
}

export function readPnpmProductionList({
  cwd = root,
  environment = process.env,
  run = execFileSync,
} = {}) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const serialized = run(command, [...PNPM_LIST_ARGUMENTS], {
    cwd,
    encoding: "utf8",
    env: {
      ...environment,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_offline: "true",
    },
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const projects = JSON.parse(serialized)
  if (!Array.isArray(projects) || projects.length !== 1 || !isObject(projects[0])) {
    throw new Error("pnpm list must return exactly one project")
  }
  return projects[0]
}

function dependencyMaps(node) {
  return [node.dependencies, node.optionalDependencies].filter(isObject)
}

export function buildCycloneDx({ artifactManifest, artifactSha256, lockSha256, productionTree }) {
  assertSha256(artifactSha256, "artifactSha256")
  assertSha256(lockSha256, "lockSha256")
  if (!isObject(artifactManifest)) throw new TypeError("artifact manifest must be an object")
  if (!isObject(productionTree)) throw new TypeError("pnpm production tree must be an object")
  if (
    productionTree.name !== artifactManifest.name
    || productionTree.version !== artifactManifest.version
  ) {
    throw new Error("pnpm production tree identity does not match the artifact")
  }

  for (const dependencyName of Object.keys(artifactManifest.dependencies ?? {})) {
    if (!isObject(productionTree.dependencies?.[dependencyName])) {
      throw new Error(`pnpm production tree is missing direct dependency ${dependencyName}`)
    }
  }
  for (const dependencyName of Object.keys(artifactManifest.optionalDependencies ?? {})) {
    if (
      !isObject(productionTree.dependencies?.[dependencyName])
      && !isObject(productionTree.optionalDependencies?.[dependencyName])
    ) {
      throw new Error(`pnpm production tree is missing optional dependency ${dependencyName}`)
    }
  }

  const graph = new Map()
  const visitDependencies = (dependencies) => {
    if (!isObject(dependencies)) return []
    const directReferences = []
    for (const [name, node] of Object.entries(dependencies)) {
      if (!isObject(node)) throw new Error(`pnpm dependency ${name} must be an object`)
      assertPackageName(name, `pnpm dependency ${name}`)
      const reference = packagePurl(name, node.version)
      directReferences.push(reference)
      let entry = graph.get(reference)
      if (entry === undefined) {
        entry = {
          component: {
            type: "library",
            "bom-ref": reference,
            name,
            version: node.version,
            purl: reference,
          },
          dependencies: new Set(),
        }
        graph.set(reference, entry)
      } else if (entry.component.name !== name || entry.component.version !== node.version) {
        throw new Error(`conflicting pnpm dependency identity for ${reference}`)
      }
      for (const childMap of dependencyMaps(node)) {
        for (const childReference of visitDependencies(childMap)) {
          entry.dependencies.add(childReference)
        }
      }
    }
    return [...new Set(directReferences)].sort(compareText)
  }

  const rootDependencies = new Set()
  for (const dependencyMap of dependencyMaps(productionTree)) {
    for (const reference of visitDependencies(dependencyMap)) rootDependencies.add(reference)
  }

  const rootReference = packagePurl(artifactManifest.name, artifactManifest.version)
  const components = [...graph.values()]
    .map((entry) => entry.component)
    .sort((left, right) => compareText(left["bom-ref"], right["bom-ref"]))
  const dependencies = [
    { ref: rootReference, dependsOn: [...rootDependencies].sort(compareText) },
    ...[...graph.entries()].map(([reference, entry]) => ({
      ref: reference,
      dependsOn: [...entry.dependencies].sort(compareText),
    })),
  ].sort((left, right) => compareText(left.ref, right.ref))

  const descriptorSha256 = manifestDescriptorHash(artifactManifest)
  const properties = [
    { name: EVIDENCE_PROPERTIES.artifactSha256, value: artifactSha256 },
    { name: EVIDENCE_PROPERTIES.lockSha256, value: lockSha256 },
    { name: EVIDENCE_PROPERTIES.manifestDescriptorsSha256, value: descriptorSha256 },
  ].sort((left, right) => compareText(left.name, right.name))

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "library",
        "bom-ref": rootReference,
        name: artifactManifest.name,
        version: artifactManifest.version,
        purl: rootReference,
        hashes: [{ alg: "SHA-256", content: artifactSha256 }],
        properties,
      },
    },
    components,
    dependencies,
  }
}

export function assertSbomIdentity(sbom, manifest, evidence = {}) {
  if (!isObject(sbom)) throw new TypeError("SBOM must be an object")
  const expectedReference = packagePurl(manifest.name, manifest.version)
  const component = sbom.metadata?.component
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || sbom.version !== 1) {
    throw new Error("SBOM must use deterministic CycloneDX 1.6 document version 1")
  }
  if (component?.["bom-ref"] !== expectedReference) {
    throw new Error("SBOM root reference does not match the package")
  }
  if (component?.name !== manifest.name || component?.version !== manifest.version) {
    throw new Error("SBOM root identity does not match the package")
  }
  if (component?.purl !== expectedReference) {
    throw new Error("SBOM root purl does not match the package")
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error("SBOM contains no runtime components")
  }
  if (!Array.isArray(sbom.dependencies) || sbom.dependencies.length === 0) {
    throw new Error("SBOM contains no dependency graph")
  }

  const componentReferences = sbom.components.map((entry) => entry?.["bom-ref"])
  const sortedComponentReferences = [...componentReferences].sort(compareText)
  if (
    componentReferences.some((reference) => typeof reference !== "string")
    || new Set(componentReferences).size !== componentReferences.length
    || canonicalJson(componentReferences) !== canonicalJson(sortedComponentReferences)
  ) {
    throw new Error("SBOM components must have unique, sorted references")
  }
  const knownReferences = new Set([expectedReference, ...componentReferences])
  const dependencyReferences = sbom.dependencies.map((entry) => entry?.ref)
  if (
    dependencyReferences.some((reference) => typeof reference !== "string")
    || new Set(dependencyReferences).size !== dependencyReferences.length
    || dependencyReferences.length !== knownReferences.size
    || canonicalJson(dependencyReferences) !== canonicalJson([...dependencyReferences].sort(compareText))
  ) {
    throw new Error("SBOM dependency rows must be unique, complete, and sorted")
  }
  for (const entry of sbom.dependencies) {
    if (!knownReferences.has(entry.ref) || !Array.isArray(entry.dependsOn)) {
      throw new Error("SBOM dependency graph contains an unknown reference")
    }
    if (
      new Set(entry.dependsOn).size !== entry.dependsOn.length
      || canonicalJson(entry.dependsOn) !== canonicalJson([...entry.dependsOn].sort(compareText))
      || entry.dependsOn.some((reference) => !knownReferences.has(reference))
    ) {
      throw new Error("SBOM dependency edges must be unique, known, and sorted")
    }
  }

  const properties = evidencePropertyMap(sbom)
  const expectedDescriptorSha256 = manifestDescriptorHash(manifest)
  if (properties.get(EVIDENCE_PROPERTIES.manifestDescriptorsSha256) !== expectedDescriptorSha256) {
    throw new Error("SBOM manifest descriptor hash does not match package.json")
  }
  if (evidence.artifactSha256 !== undefined) {
    assertSha256(evidence.artifactSha256, "artifactSha256")
    if (
      component.hashes?.some((hash) => (
        hash?.alg === "SHA-256" && hash?.content === evidence.artifactSha256
      )) !== true
      || properties.get(EVIDENCE_PROPERTIES.artifactSha256) !== evidence.artifactSha256
    ) {
      throw new Error("SBOM artifact hash does not match the release artifact")
    }
  }
  if (evidence.lockSha256 !== undefined) {
    assertSha256(evidence.lockSha256, "lockSha256")
    if (properties.get(EVIDENCE_PROPERTIES.lockSha256) !== evidence.lockSha256) {
      throw new Error("SBOM lock hash does not match pnpm-lock.yaml")
    }
  }

  const serialized = JSON.stringify(sbom)
  if (
    serialized.includes('"path":')
    || serialized.includes('"resolved":')
    || /(?:file:\/\/|https?:\/\/registry\.npmjs\.)/u.test(serialized)
  ) {
    throw new Error("SBOM must not contain local paths or resolved registry URLs")
  }
}

export async function generateSbom(artifactInput, outputInput) {
  if (typeof artifactInput !== "string" || artifactInput.length === 0) {
    throw new TypeError("artifact path is required")
  }
  if (typeof outputInput !== "string" || outputInput.length === 0) {
    throw new TypeError("SBOM output path is required")
  }
  const artifact = path.resolve(root, artifactInput)
  const output = path.resolve(root, outputInput)
  if (artifact === output) throw new Error("SBOM output must differ from the artifact")
  if (!(await stat(artifact)).isFile()) throw new Error("release artifact must be a file")

  const repositoryManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assertPackageName(repositoryManifest.name)
  const expectedArtifact = artifactFileName(repositoryManifest)
  if (path.basename(artifact) !== expectedArtifact) {
    throw new Error(`expected release artifact ${expectedArtifact}`)
  }

  const artifactManifest = readArtifactManifest(artifact)
  assertArtifactManifestMatchesRepository(artifactManifest, repositoryManifest)
  const lockBytes = await readFile(path.join(root, "pnpm-lock.yaml"))
  const artifactBytes = await readFile(artifact)
  const evidence = {
    artifactSha256: sha256(artifactBytes),
    lockSha256: sha256(lockBytes),
  }
  const productionTree = readPnpmProductionList()
  const sbom = buildCycloneDx({ artifactManifest, productionTree, ...evidence })
  assertSbomIdentity(sbom, artifactManifest, evidence)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`)
}

function isMainModule() {
  if (process.argv[1] === undefined) return false
  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
}

if (isMainModule()) {
  const [artifact, output, ...extra] = process.argv.slice(2)
  if (artifact === undefined || output === undefined || extra.length > 0) {
    throw new Error("Usage: node scripts/generate-sbom.mjs <artifact.tgz> <output.cdx.json>")
  }
  await generateSbom(artifact, output)
}
