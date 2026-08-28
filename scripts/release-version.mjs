const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

export function assertReleaseVersion(value) {
  const match = typeof value === "string" ? SEMVER_PATTERN.exec(value) : null
  if (match === null) throw new Error(`Invalid release version: ${String(value)}`)

  const [, major, minor, patch, prerelease] = match
  if (Number(major) === 0 && Number(minor) === 0 && Number(patch) === 0) {
    throw new Error("Invalid release version: releases start at 0.0.1")
  }
  if (prerelease?.split(".").some((identifier) => /^\d+$/u.test(identifier) && identifier.startsWith("0") && identifier !== "0")) {
    throw new Error(`Invalid release version: ${value}`)
  }
  return value
}

export function releaseDocumentPaths(version) {
  const validated = assertReleaseVersion(version)
  return {
    acceptance: `docs/releases/v${validated}.acceptance.json`,
    notes: `docs/releases/v${validated}.md`,
  }
}
