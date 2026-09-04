import assert from "node:assert/strict"
import test from "node:test"

import {
  validatePackedDistContents,
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

test("packed dist contents reject removed dsh-settings named exports in every dist file", () => {
  const files = [
    "dist/host/index.mjs",
    "dist/internal/codex-provider-runtime.mjs",
  ]
  assert.throws(
    () => validatePackedDistContents(
      files,
      new Map([
        ["dist/host/index.mjs", "export const name = \"dsh-codex\"\n"],
        ["dist/internal/codex-provider-runtime.mjs", "import { installSettingsSection } from \"@deepseek-ai/dsh-settings\"\n"],
      ]),
    ),
    /Packed artifact dist\/internal\/codex-provider-runtime\.mjs still references removed dsh-settings export installSettingsSection/u,
  )
  assert.throws(
    () => validatePackedDistContents(
      files,
      new Map([
        ["dist/host/index.mjs", "export const name = \"dsh-codex\"\n"],
        ["dist/internal/codex-provider-runtime.mjs", "const ns = settingsNamespace(\"dsh-codex\")\n"],
      ]),
    ),
    /Packed artifact dist\/internal\/codex-provider-runtime\.mjs still references removed dsh-settings export settingsNamespace/u,
  )
  assert.throws(
    () => validatePackedDistContents(
      files,
      new Map([["dist/host/index.mjs", "export const name = \"dsh-codex\"\n"]]),
    ),
    /Packed dist source could not be read: dist\/internal\/codex-provider-runtime\.mjs/u,
  )
  assert.doesNotThrow(() => validatePackedDistContents(
    files,
    new Map([
      ["dist/host/index.mjs", "export const name = \"dsh-codex\"\n"],
      ["dist/internal/codex-provider-runtime.mjs", "ctx.settings.installSection(ctx, \"dsh-codex\", Config, entry, hooks)\n"],
    ]),
  ))
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
