import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { collectJavaScriptFiles } from "../scripts/check-syntax.mjs"

test("syntax scanning excludes installed dependency trees", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-codex-syntax-"))
  context.after(() => rm(directory, { recursive: true, force: true }))

  await mkdir(path.join(directory, "nested"), { recursive: true })
  await mkdir(path.join(directory, "node_modules", "dependency"), { recursive: true })
  await writeFile(path.join(directory, "entry.mjs"), "export const value = 1\n")
  await writeFile(path.join(directory, "nested", "helper.js"), "export const helper = true\n")
  await writeFile(path.join(directory, "node_modules", "dependency", "broken.mjs"), "not valid {{\n")

  const files = (await collectJavaScriptFiles(directory))
    .map((file) => path.relative(directory, file))
    .sort()
  assert.deepEqual(files, ["entry.mjs", path.join("nested", "helper.js")])
})
