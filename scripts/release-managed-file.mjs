import { lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { resolve, sep } from "node:path"

export class ReleaseFileError extends Error {
  constructor(message) {
    super(message)
    this.name = "ReleaseFileError"
    this.exitCode = 2
  }
}

export function assertReleaseFile(condition, message) {
  if (!condition) throw new ReleaseFileError(message)
}

export function parseReleaseJson(source, path) {
  try {
    return JSON.parse(source)
  } catch {
    throw new ReleaseFileError(`${path} is not valid JSON`)
  }
}

export async function inspectReleaseFile(repositoryRoot, path, { required = false } = {}) {
  const root = resolve(repositoryRoot)
  const normalizedPath = normalizeReleasePath(path)
  const absolutePath = resolveReleasePath(root, normalizedPath)
  await assertReleasePathParents(root, normalizedPath)
  try {
    const metadata = await lstat(absolutePath)
    assertReleaseFile(
      !metadata.isSymbolicLink(),
      `${normalizedPath} is a symlink and violates the managed path boundary`,
    )
    assertReleaseFile(metadata.isFile(), `${normalizedPath} must be a regular file`)
    return {
      absolutePath,
      content: await readFile(absolutePath, "utf8"),
      mode: metadata.mode & 0o777,
      path: normalizedPath,
      repositoryRoot: root,
    }
  } catch (error) {
    if (error?.code === "ENOENT" && !required) {
      return {
        absolutePath,
        content: null,
        mode: undefined,
        path: normalizedPath,
        repositoryRoot: root,
      }
    }
    if (error instanceof ReleaseFileError) throw error
    if (error?.code === "ENOENT") {
      throw new ReleaseFileError(`Required release file is missing: ${normalizedPath}`)
    }
    throw error
  }
}

export async function writeReleaseFileAtomically(file, content, {
  operation = "release update",
} = {}) {
  assertReleaseFile(typeof content === "string", "Release file content must be a string")
  const temporaryPath = `${file.absolutePath}.${operation.replaceAll(/[^a-z0-9-]/giu, "-")}-${process.pid}-${Math.random().toString(16).slice(2)}`
  const lockPath = `${file.absolutePath}.release-update.lock`
  let lock
  try {
    await assertReleasePathParents(file.repositoryRoot, file.path)
    try {
      lock = await open(lockPath, "wx", 0o600)
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new ReleaseFileError(
          `${file.path} is already being updated; retry after the other release command finishes`,
        )
      }
      throw error
    }
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      ...(file.mode === undefined ? {} : { mode: file.mode }),
    })
    const currentContent = await readCurrentContent(file)
    assertReleaseFile(
      currentContent === file.content,
      `${file.path} changed after ${operation} began; no generated content was installed`,
    )
    await assertReleasePathParents(file.repositoryRoot, file.path)
    await rename(temporaryPath, file.absolutePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  } finally {
    await lock?.close().catch(() => {})
    if (lock !== undefined) await unlink(lockPath).catch(() => {})
  }
}

async function assertReleasePathParents(repositoryRoot, path) {
  const rootMetadata = await lstat(repositoryRoot)
  assertReleaseFile(
    !rootMetadata.isSymbolicLink() && rootMetadata.isDirectory(),
    "repositoryRoot must be a real directory, not a symlink/path boundary",
  )

  const segments = path.split("/").slice(0, -1)
  let parentPath = repositoryRoot
  for (const segment of segments) {
    parentPath = resolve(parentPath, segment)
    let metadata
    try {
      metadata = await lstat(parentPath)
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new ReleaseFileError(
          `Managed path parent is missing and violates the path boundary: ${relativeToRoot(repositoryRoot, parentPath)}`,
        )
      }
      throw error
    }
    const relativeParent = relativeToRoot(repositoryRoot, parentPath)
    assertReleaseFile(
      !metadata.isSymbolicLink(),
      `Managed path parent is a symlink and violates the path boundary: ${relativeParent}`,
    )
    assertReleaseFile(
      metadata.isDirectory(),
      `Managed path parent is not a directory and violates the path boundary: ${relativeParent}`,
    )
  }
}

async function readCurrentContent(file) {
  try {
    const metadata = await lstat(file.absolutePath)
    assertReleaseFile(
      !metadata.isSymbolicLink(),
      `${file.path} became a symlink and violates the managed path boundary`,
    )
    assertReleaseFile(
      metadata.isFile(),
      `${file.path} must remain a regular file during the release update`,
    )
    return await readFile(file.absolutePath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function relativeToRoot(repositoryRoot, absolutePath) {
  return absolutePath.slice(repositoryRoot.length + 1).replaceAll("\\", "/")
}

function resolveReleasePath(repositoryRoot, path) {
  const absolutePath = resolve(repositoryRoot, path)
  assertReleaseFile(
    absolutePath.startsWith(`${repositoryRoot}${sep}`),
    `Release path escapes the repository root: ${path}`,
  )
  return absolutePath
}

function normalizeReleasePath(path) {
  assertReleaseFile(
    typeof path === "string" && path.length > 0,
    "Managed release path must be a non-empty string",
  )
  assertReleaseFile(
    !path.includes("\\")
      && !path.startsWith("/")
      && !/^[A-Za-z]:/u.test(path)
      && !path.includes("\0"),
    "Managed release path must be a repository-relative POSIX path",
  )
  const segments = path.split("/")
  assertReleaseFile(
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "Managed release path must be a canonical repository-relative POSIX path",
  )
  return segments.join("/")
}
