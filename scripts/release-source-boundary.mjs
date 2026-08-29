export const publicationStatePaths = Object.freeze([
  "README.md",
  "README.en.md",
  "CHANGELOG.md",
  "docs/compatibility.md",
  "docs/compatibility.en.md",
])

export function findUnexpectedPostAcceptanceChanges(changedFiles, {
  acceptancePath,
  releasePath,
}) {
  if (!Array.isArray(changedFiles)) throw new TypeError("changedFiles must be an array")
  if (typeof acceptancePath !== "string" || typeof releasePath !== "string") {
    throw new TypeError("releasePath and acceptancePath must be strings")
  }

  const allowedEvidenceChanges = new Set([
    releasePath,
    acceptancePath,
    ...publicationStatePaths,
  ])
  return changedFiles.filter((path) => !allowedEvidenceChanges.has(path))
}
