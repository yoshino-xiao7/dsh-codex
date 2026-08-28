import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { readRequestImageFile } from "@deepseek-ai/dsh-attachment-local"
import { Config as PiAiConfig } from "@deepseek-ai/dsh-llm-pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import {
  resolveImagePolicy,
  toAttachmentRequestPolicy,
} from "../src/internal/image-policy.mjs"

test("published pi-ai provider supplies OAuth and its bundled Codex model catalog", () => {
  const provider = openaiCodexProvider()
  const models = provider.getModels()

  assert.equal(provider.id, "openai-codex")
  assert.equal(typeof provider.auth.oauth?.login, "function")
  assert.equal(models.length > 0, true)
  assert.equal(models.every((model) => model.provider === "openai-codex"), true)
  assert.equal(models.some((model) => model.input?.includes("image")), true)
  assert.equal(models.some((model) => model.reasoning), true)
})

test("published DSH pi-ai schema accepts and retains the complete image policy", () => {
  const image = resolveImagePolicy()
  const config = PiAiConfig({
    providers: {
      "openai-codex": {
        ...image,
        retryPolicy: { mode: "normal", maxRetries: 2 },
      },
    },
  })
  const profile = config.providers["openai-codex"]

  assert.equal(profile.requestImagePixelBudget, 4_194_304)
  assert.equal(profile.requestImageMaxBytes, 1_048_576)
  assert.equal(profile.maxRequestImageBytes, 20_971_520)
  assert.equal(profile.retryPolicy.maxRetries, 2)
})

test("resolved policy crosses the real attachment seam without maxPixels failure", async () => {
  const data = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ))
  const digest = createHash("sha256").update(data).digest("hex")
  const stored = {
    ref: {
      attachmentId: `sha256:${digest}`,
      mediaType: "image/png",
      bytes: data.byteLength,
      width: 1,
      height: 1,
    },
    data,
  }

  const result = await readRequestImageFile(
    "/private/tmp/dsh-codex-community-attachment-test",
    stored,
    toAttachmentRequestPolicy(resolveImagePolicy()),
  )

  assert.equal(result.mediaType === "image/png" || result.mediaType === "image/jpeg", true)
  assert.equal(result.data.byteLength > 0, true)
})
