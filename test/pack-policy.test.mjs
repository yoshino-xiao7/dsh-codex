import assert from "node:assert/strict"
import test from "node:test"

import {
  validatePackedMarkdownLinks,
  validatePackedPaths,
} from "../scripts/pack-policy.mjs"

test("packed path policy rejects sensitive files inside an allowed directory", () => {
  assert.throws(
    () => validatePackedPaths([
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
      "docs/.env",
    ]),
    /Packed artifact contains a path outside the allowlist: docs\/\.env/u,
  )
})

test("packed Markdown links must resolve to another packed file", () => {
  assert.throws(
    () => validatePackedMarkdownLinks(
      ["docs/index.md"],
      new Map([["docs/index.md", "Read [support](../SUPPORT.md)."]]),
    ),
    /docs\/index\.md links to unpacked target SUPPORT\.md/u,
  )
})
