import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const source = path.join(root, "src")
const output = path.join(root, "dist")

await rm(output, { recursive: true, force: true })
await copyTree(source, output)

const host = await readFile(path.join(output, "host", "index.mjs"), "utf8")
for (const forbidden of ["accessToken", "refreshToken", "auth.json", "access_token"]) {
  if (host.includes(forbidden)) {
    throw new Error(`Host entry unexpectedly contains credential-shaped field ${forbidden}`)
  }
}
async function copyTree(from, to) {
  await mkdir(to, { recursive: true })
  const entries = await readdir(from, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"))
  for (const entry of entries) {
    const input = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) await copyTree(input, target)
    else if (entry.isFile()) await copyFile(input, target)
    else throw new Error(`Unsupported source entry: ${input}`)
  }
}
