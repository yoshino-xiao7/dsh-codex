const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

function parseReleaseVersion(value) {
  const match = typeof value === "string" ? SEMVER_PATTERN.exec(value) : null
  if (match === null) throw new Error(`Invalid release version: ${String(value)}`)

  const [, major, minor, patch, prerelease, build] = match
  if (Number(major) === 0 && Number(minor) === 0 && Number(patch) === 0) {
    throw new Error("Invalid release version: releases start at 0.0.1")
  }
  if (prerelease?.split(".").some((identifier) => /^\d+$/u.test(identifier) && identifier.startsWith("0") && identifier !== "0")) {
    throw new Error(`Invalid release version: ${value}`)
  }
  return {
    build,
    core: [major, minor, patch],
    prerelease: prerelease?.split(".") ?? [],
    value,
  }
}

export function assertReleaseVersion(value) {
  return parseReleaseVersion(value).value
}

export function releaseVersionHasBuildMetadata(value) {
  return parseReleaseVersion(value).build !== undefined
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function compareReleaseVersions(left, right) {
  const parsedLeft = parseReleaseVersion(left)
  const parsedRight = parseReleaseVersion(right)

  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const difference = compareNumericIdentifiers(parsedLeft.core[index], parsedRight.core[index])
    if (difference !== 0) return difference
  }

  const leftPrerelease = parsedLeft.prerelease
  const rightPrerelease = parsedRight.prerelease
  if (leftPrerelease.length === 0 || rightPrerelease.length === 0) {
    if (leftPrerelease.length === rightPrerelease.length) return 0
    return leftPrerelease.length === 0 ? 1 : -1
  }

  const length = Math.max(leftPrerelease.length, rightPrerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index]
    const rightIdentifier = rightPrerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = /^\d+$/u.test(leftIdentifier)
    const rightNumeric = /^\d+$/u.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftIdentifier, rightIdentifier)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

export function releaseDocumentPaths(version) {
  const validated = assertReleaseVersion(version)
  return {
    acceptance: `docs/releases/v${validated}.acceptance.json`,
    notes: `docs/releases/v${validated}.md`,
  }
}
