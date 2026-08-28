import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import test from "node:test"
import { gzipSync } from "node:zlib"

import { Context, Service } from "@deepseek-ai/cordis"
import LocalAttachmentStore from "@deepseek-ai/dsh-attachment-local"
import {
  Config as ToolFsConfig,
  apply as applyToolFs,
  inject as toolFsInject,
} from "@deepseek-ai/dsh-tool-fs"
import SystemPrompt from "@deepseek-ai/dsh-system-prompt"
import ToolRuntime from "@deepseek-ai/dsh-tools"

import { CODEX_ROUTE_ID } from "../src/internal/codex-route-adapter.mjs"
import {
  RemoteImageInputError,
  createReadImageUrlMiddleware,
  downloadRemoteImage,
  isPublicIpAddress,
  saveRemoteImage,
} from "../src/internal/remote-image-input.mjs"

const PUBLIC_V4 = "93.184.216.34"
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"
const FIXTURE_ATTACHMENT_ID = `sha256:${"a".repeat(64)}`

function lookupWith(addresses) {
  return async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))
}

function response(statusCode, headers, chunks = []) {
  const stream = Readable.from(chunks)
  stream.statusCode = statusCode
  stream.headers = headers
  return stream
}

function requester(routes, visits = []) {
  let index = 0
  return async (url, options) => {
    visits.push(url.toString())
    const pinned = await new Promise((resolve, reject) => {
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        if (error) reject(error)
        else resolve(addresses)
      })
    })
    assert.equal(pinned.every(({ address }) => isPublicIpAddress(address)), true)
    const route = routes[index]
    index += 1
    return route
  }
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof RemoteImageInputError, true)
    assert.equal(error.code, code)
    return true
  })
}

test("accepts only globally routable unicast IP addresses", () => {
  for (const address of [PUBLIC_V4, "1.1.1.1", PUBLIC_V6, "2001:4860:4860::8888"]) {
    assert.equal(isPublicIpAddress(address), true, address)
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.100.100.200",
    "127.0.0.1",
    "168.63.129.16",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ]) assert.equal(isPublicIpAddress(address), false, address)
})

test("rejects non-http URLs, userinfo, ambiguous hosts, and private literals before I/O", async () => {
  let opened = false
  const options = {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: async () => {
      opened = true
      throw new Error("must not open")
    },
  }
  await rejectsCode(downloadRemoteImage("file:///tmp/image.png", options), "UNSUPPORTED_PROTOCOL")
  await rejectsCode(downloadRemoteImage("https://user:secret@images.example.net/a.png", options), "URL_CREDENTIALS")
  await rejectsCode(downloadRemoteImage("https://localhost/a.png", options), "UNSAFE_ADDRESS")
  await rejectsCode(downloadRemoteImage("https://metadata.google.internal/a.png", options), "UNSAFE_ADDRESS")
  await rejectsCode(downloadRemoteImage("http://169.254.169.254/a.png", options), "UNSAFE_ADDRESS")
  await rejectsCode(downloadRemoteImage("http://2130706433/a.png", options), "UNSAFE_ADDRESS")
  assert.equal(opened, false)
})

test("fails closed on mixed DNS answers and pins the accepted answer set", async () => {
  let opened = false
  await rejectsCode(downloadRemoteImage("https://images.example.net/a.png", {
    lookup: lookupWith([PUBLIC_V4, "127.0.0.1"]),
    openResponse: async () => {
      opened = true
    },
  }), "UNSAFE_ADDRESS")
  assert.equal(opened, false)

  const body = Buffer.from("image bytes")
  const result = await downloadRemoteImage("https://images.example.net/a.png", {
    lookup: lookupWith([PUBLIC_V4, PUBLIC_V6]),
    openResponse: async (url, options) => {
      const pinned = await new Promise((resolve, reject) => {
        options.lookup(url.hostname, { all: true }, (error, addresses) => {
          if (error) reject(error)
          else resolve(addresses)
        })
      })
      assert.deepEqual(pinned, [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ])
      await assert.rejects(new Promise((resolve, reject) => {
        options.lookup("changed.example.net", {}, (error) => error ? reject(error) : resolve())
      }), (error) => error.code === "DNS_REBINDING_GUARD")
      return response(200, { "content-type": "image/png" }, [body])
    },
  })
  assert.deepEqual(Buffer.from(result.data), body)
})

test("revalidates every redirect and refuses a redirect to a private target", async () => {
  const visits = []
  await rejectsCode(downloadRemoteImage("https://images.example.net/a.png", {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(302, { location: "http://127.0.0.1/private.png" }),
    ], visits),
  }), "UNSAFE_ADDRESS")
  assert.deepEqual(visits, ["https://images.example.net/a.png"])
})

test("enforces the redirect limit", async () => {
  await rejectsCode(downloadRemoteImage("https://images.example.net/a.png", {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(302, { location: "/b.png" }),
      response(302, { location: "/c.png" }),
    ]),
    policy: { maxRedirects: 1 },
  }), "TOO_MANY_REDIRECTS")
})

test("bounds declared, streamed, and decompressed response bytes", async () => {
  const base = {
    lookup: lookupWith([PUBLIC_V4]),
    policy: { maxBytes: 1_024 },
  }
  await rejectsCode(downloadRemoteImage("https://images.example.net/declared.png", {
    ...base,
    openResponse: requester([
      response(200, { "content-length": "2048", "content-type": "image/png" }, [Buffer.alloc(1)]),
    ]),
  }), "RESPONSE_TOO_LARGE")

  await rejectsCode(downloadRemoteImage("https://images.example.net/streamed.png", {
    ...base,
    openResponse: requester([
      response(200, { "content-type": "image/png" }, [Buffer.alloc(700), Buffer.alloc(700)]),
    ]),
  }), "RESPONSE_TOO_LARGE")

  const compressed = gzipSync(Buffer.alloc(4_096))
  await rejectsCode(downloadRemoteImage("https://images.example.net/compressed.png", {
    ...base,
    openResponse: requester([
      response(200, {
        "content-encoding": "gzip",
        "content-length": String(compressed.byteLength),
        "content-type": "image/png",
      }, [compressed]),
    ]),
  }), "RESPONSE_TOO_LARGE")
})

test("rejects a non-image response before storing it", async () => {
  await rejectsCode(downloadRemoteImage("https://images.example.net/index.png", {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(200, { "content-type": "text/html; charset=utf-8" }, [Buffer.from("<html>")]),
    ]),
  }), "UNSUPPORTED_MEDIA_TYPE")
})

test("uses attachment deployment limits and returns a model image block after durable save", async () => {
  const saved = []
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 1_024,
      mediaTypes: ["image/png"],
    },
    async saveImage(input) {
      saved.push(input)
      return {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  }
  const result = await saveRemoteImage(attachments, "https://images.example.net/pixel.png?signature=private", {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(200, { "content-type": "image/png" }, [Buffer.from("fixture")]),
    ]),
  })

  assert.equal(saved.length, 1)
  assert.equal(saved[0].name, "pixel.png")
  assert.deepEqual(result.block, {
    type: "image",
    attachment: result.attachment,
  })
  assert.equal(result.attachment.attachmentId, FIXTURE_ATTACHMENT_ID)
})

test("cancellation while saveImage is pending cannot publish a successful remote image result", async () => {
  let releaseSave
  let markSaveStarted
  const saveStarted = new Promise((resolve) => { markSaveStarted = resolve })
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 2_048,
      mediaTypes: ["image/png"],
    },
    async saveImage(input) {
      markSaveStarted()
      await new Promise((resolve) => { releaseSave = resolve })
      return {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  }
  const controller = new AbortController()
  const saving = saveRemoteImage(attachments, "https://images.example.net/pixel.png", {
    signal: controller.signal,
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(200, { "content-type": "image/png" }, [Buffer.from("fixture")]),
    ]),
  })
  await saveStarted
  controller.abort()
  releaseSave()

  await assert.rejects(saving, (error) => error?.name === "AbortError")
})

test("disposing remote image middleware aborts active network work", async () => {
  let markRequestStarted
  let saveCalls = 0
  const requestStarted = new Promise((resolve) => { markRequestStarted = resolve })
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 2_048,
      mediaTypes: ["image/png"],
    },
    async saveImage() {
      saveCalls += 1
      throw new Error("aborted network work must not reach saveImage")
    },
  }
  const ctx = {
    get(name) {
      if (name === "attachments") return attachments
      if (name === "llm") return {
        async resolveModelInfo() {
          return { inputModalities: ["text", "image"] }
        },
      }
      return undefined
    },
  }
  const middleware = createReadImageUrlMiddleware(ctx, {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: (_url, { signal }) => new Promise((_resolve, reject) => {
      markRequestStarted()
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    }),
  })
  const execution = middleware({
    name: "read_image",
    arguments: { file_path: "https://images.example.net/active.png" },
    signal: new AbortController().signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("URL branch must not delegate")
  })
  const rejected = assert.rejects(execution, (error) => error?.code === "ABORTED")

  await requestStarted
  await middleware.dispose()
  await rejected
  assert.equal(saveCalls, 0)
})

test("commits verified bytes through the published durable attachment service", async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), "dsh-remote-image-test-"))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(dshHome, { force: true, recursive: true })
  })
  await ctx.plugin(LocalAttachmentStore, { dshHome })

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  )
  const result = await saveRemoteImage(ctx.attachments, "https://images.example.net/pixel.png", {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(200, { "content-type": "image/png" }, [png]),
    ]),
  })
  const stored = await ctx.attachments.readImage(result.attachment)

  assert.match(result.attachment.attachmentId, /^sha256:[\da-f]{64}$/u)
  assert.equal(result.attachment.mediaType, "image/png")
  assert.equal(result.attachment.width, 1)
  assert.equal(result.attachment.height, 1)
  assert.equal(stored.data.byteLength, result.attachment.bytes)
  assert.equal(result.block.attachment, result.attachment)
})

test("applies one total timeout across DNS and redirects", async () => {
  await rejectsCode(downloadRemoteImage("https://images.example.net/a.png", {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(signal.reason)
      }, { once: true })
    }),
    policy: { timeoutMs: 20 },
  }), "TIMEOUT")
})

test("applies the total timeout while DNS resolution is pending", async () => {
  await rejectsCode(downloadRemoteImage("https://images.example.net/a.png", {
    lookup: () => new Promise(() => undefined),
    openResponse: async () => {
      throw new Error("must not open")
    },
    policy: { timeoutMs: 20 },
  }), "TIMEOUT")
})

test("read_image middleware delegates local paths and returns the original tool value shape for URLs", async () => {
  const calls = []
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 2_048,
      mediaTypes: ["image/png"],
    },
    async saveImage(input) {
      return {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  }
  const ctx = {
    get(name) {
      if (name === "attachments") return attachments
      if (name === "llm") return {
        async resolveModelInfo(provider, model) {
          calls.push({ provider, model })
          return { inputModalities: ["text", "image"] }
        },
      }
      return undefined
    },
  }
  const middleware = createReadImageUrlMiddleware(ctx, {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(200, { "content-type": "image/png" }, [Buffer.from("fixture")]),
    ]),
  })
  const delegated = { isError: false, value: { local: true } }
  assert.equal(await middleware({
    name: "read_image",
    arguments: { file_path: "/tmp/local.png" },
  }, async () => delegated), delegated)
  assert.equal(await middleware({
    name: "read_image",
    arguments: { file_path: "https://images.example.net/not-codex.png" },
    agent: {
      options: { provider: "other-provider", model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => delegated), delegated)

  const result = await middleware({
    name: "read_image",
    arguments: { file_path: "https://images.example.net/pixel.png?signature=private" },
    signal: new AbortController().signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("URL branch must not delegate")
  })

  assert.deepEqual(calls, [{ provider: CODEX_ROUTE_ID, model: "fixture" }])
  assert.deepEqual(result, {
    isError: false,
    value: {
      path: "https://images.example.net/pixel.png",
      image: {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: "image/png",
        bytes: 7,
        width: 1,
        height: 1,
        name: "pixel.png",
      },
    },
  })
})

test("a queued and cancelled remote image never starts durable saveImage work", async () => {
  let openResponseCalls = 0
  let saveCalls = 0
  const openedPaths = []
  const savedNames = []
  let releaseSaves
  let markTwoSavesStarted
  const saveGate = new Promise((resolve) => { releaseSaves = resolve })
  const twoSavesStarted = new Promise((resolve) => { markTwoSavesStarted = resolve })
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 2_048,
      mediaTypes: ["image/png"],
    },
    async saveImage(input) {
      saveCalls += 1
      savedNames.push(input.name)
      if (saveCalls === 2) markTwoSavesStarted()
      await saveGate
      return {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  }
  const ctx = {
    get(name) {
      if (name === "attachments") return attachments
      if (name === "llm") return {
        async resolveModelInfo() {
          return { inputModalities: ["text", "image"] }
        },
      }
      return undefined
    },
  }
  const middleware = createReadImageUrlMiddleware(ctx, {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: async (url) => {
      openResponseCalls += 1
      openedPaths.push(url.pathname)
      return response(
        200,
        { "content-type": "image/png" },
        [Buffer.from("fixture")],
      )
    },
  })
  const execute = (filePath, signal = new AbortController().signal) => middleware({
    name: "read_image",
    arguments: { file_path: filePath },
    signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("URL branch must not delegate")
  })

  const first = execute("https://images.example.net/first.png")
  const second = execute("https://images.example.net/second.png")
  await twoSavesStarted

  const thirdController = new AbortController()
  const third = execute("https://images.example.net/cancelled.png", thirdController.signal)
  const thirdRejected = assert.rejects(third, (error) => error?.name === "AbortError")
  const fourth = execute("https://images.example.net/after-cancel.png")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(openResponseCalls, 2)
  assert.equal(saveCalls, 2)
  thirdController.abort()
  releaseSaves()

  await Promise.all([first, second, fourth])
  await thirdRejected
  assert.equal(openResponseCalls, 3)
  assert.equal(saveCalls, 3)
  assert.equal(openedPaths.includes("/cancelled.png"), false)
  assert.equal(savedNames.includes("cancelled.png"), false)
  assert.equal(openedPaths.includes("/after-cancel.png"), true)
  assert.equal(savedNames.includes("after-cancel.png"), true)
})

test("disposing the plugin context rejects queued images and waits for active saves", async (t) => {
  let openResponseCalls = 0
  let saveCalls = 0
  let releaseSaves
  let markTwoSavesStarted
  const saveGate = new Promise((resolve) => { releaseSaves = resolve })
  const twoSavesStarted = new Promise((resolve) => { markTwoSavesStarted = resolve })
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 2_048,
      mediaTypes: ["image/png"],
    },
    async saveImage(input) {
      saveCalls += 1
      if (saveCalls === 2) markTwoSavesStarted()
      await saveGate
      return {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  }
  const imageCtx = {
    get(name) {
      if (name === "attachments") return attachments
      if (name === "llm") return {
        async resolveModelInfo() {
          return { inputModalities: ["text", "image"] }
        },
      }
      return undefined
    },
  }
  const middleware = createReadImageUrlMiddleware(imageCtx, {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: async () => {
      openResponseCalls += 1
      return response(
        200,
        { "content-type": "image/png" },
        [Buffer.from("fixture")],
      )
    },
  })
  assert.equal(typeof middleware.dispose, "function")

  const root = new Context()
  t.after(async () => {
    releaseSaves()
    await root.fiber.dispose()
  })
  const plugin = await root.plugin({
    name: "remote-image-lifecycle-fixture",
    apply(ctx) {
      ctx.effect(() => () => middleware.dispose(), "remote image fixture lifecycle")
    },
  })
  const execute = (index) => middleware({
    name: "read_image",
    arguments: { file_path: `https://images.example.net/lifecycle-${index}.png` },
    signal: new AbortController().signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("URL branch must not delegate")
  })

  const first = execute(0)
  const second = execute(1)
  await twoSavesStarted
  const queued = execute(2)
  const firstRejected = assert.rejects(first, (error) => error?.code === "ABORTED")
  const secondRejected = assert.rejects(second, (error) => error?.code === "ABORTED")
  const queuedRejected = assert.rejects(queued, (error) => error?.code === "ABORTED")

  let disposalSettled = false
  const disposal = plugin.dispose().then(() => { disposalSettled = true })
  await queuedRejected
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(openResponseCalls, 2)
  assert.equal(saveCalls, 2)
  assert.equal(disposalSettled, false)

  releaseSaves()
  await Promise.all([firstRejected, secondRejected, disposal])
  assert.equal(disposalSettled, true)
  assert.equal(openResponseCalls, 2)
  assert.equal(saveCalls, 2)
})

test("remote image limits include model capability preflight and disposal", async () => {
  let resolverCalls = 0
  let releaseResolvers
  let markTwoResolversStarted
  const resolverGate = new Promise((resolve) => { releaseResolvers = resolve })
  const twoResolversStarted = new Promise((resolve) => { markTwoResolversStarted = resolve })
  const ctx = {
    get(name) {
      if (name === "llm") return {
        async resolveModelInfo() {
          resolverCalls += 1
          if (resolverCalls === 2) markTwoResolversStarted()
          await resolverGate
          return { inputModalities: ["text", "image"] }
        },
      }
      if (name === "attachments") throw new Error("disposed preflight must not reach attachments")
      return undefined
    },
  }
  const middleware = createReadImageUrlMiddleware(ctx)
  const execute = (index) => middleware({
    name: "read_image",
    arguments: { file_path: `https://images.example.net/preflight-${index}.png` },
    signal: new AbortController().signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("URL branch must not delegate")
  })
  const executions = Array.from({ length: 35 }, (_, index) => execute(index))
  const observed = executions.map((promise) => promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  ))

  try {
    await twoResolversStarted
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(resolverCalls, 2)
    assert.equal((await observed[34]).error?.code, "TOO_MANY_REQUESTS")
  } finally {
    const disposal = middleware.dispose()
    releaseResolvers()
    await disposal
    await Promise.all(observed)
  }

  assert.equal(resolverCalls, 2)
  assert.equal(observed.length, 35)
})

test("remote image work rejects a thirty-third queued request without starting it", async () => {
  let activeSaves = 0
  let saveCalls = 0
  let openResponseCalls = 0
  let releaseInitialSaves
  let markInitialSavesStarted
  const initialSaveGate = new Promise((resolve) => { releaseInitialSaves = resolve })
  const initialSavesStarted = new Promise((resolve) => { markInitialSavesStarted = resolve })
  const attachments = {
    imageLimits: {
      maxImageBytes: 2_048,
      maxMessageImageBytes: 2_048,
      mediaTypes: ["image/png"],
    },
    async saveImage(input) {
      saveCalls += 1
      activeSaves += 1
      if (activeSaves === 2) markInitialSavesStarted()
      await initialSaveGate
      activeSaves -= 1
      return {
        attachmentId: FIXTURE_ATTACHMENT_ID,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  }
  const ctx = {
    get(name) {
      if (name === "attachments") return attachments
      if (name === "llm") return {
        async resolveModelInfo() {
          return { inputModalities: ["text", "image"] }
        },
      }
      return undefined
    },
  }
  const middleware = createReadImageUrlMiddleware(ctx, {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: async () => {
      openResponseCalls += 1
      return response(
        200,
        { "content-type": "image/png" },
        [Buffer.from("fixture")],
      )
    },
  })
  const execute = (index) => middleware({
    name: "read_image",
    arguments: { file_path: `https://images.example.net/queued-${index}.png` },
    signal: new AbortController().signal,
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
  }, async () => {
    throw new Error("URL branch must not delegate")
  })

  const first = execute(0)
  const second = execute(1)
  await initialSavesStarted
  const queued = Array.from({ length: 32 }, (_, index) => execute(index + 2))
  const overflow = execute(34)

  assert.equal(openResponseCalls, 2)
  assert.equal(saveCalls, 2)
  releaseInitialSaves()
  await assert.rejects(
    overflow,
    (error) => error?.code === "TOO_MANY_REQUESTS",
  )
  await Promise.all([first, second, ...queued])

  assert.equal(openResponseCalls, 34)
  assert.equal(saveCalls, 34)
})

test("real ToolRuntime validates and renders a URL through the published read_image tool", async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), "dsh-remote-image-tool-runtime-"))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(dshHome, { force: true, recursive: true })
  })

  class FileSystemStub extends Service {
    constructor(context) {
      super(context, "fs")
    }
  }
  class LlmStub extends Service {
    constructor(context) {
      super(context, "llm")
    }

    async resolveModelInfo(provider, model) {
      assert.equal(provider, CODEX_ROUTE_ID)
      assert.equal(model, "fixture")
      return { inputModalities: ["text", "image"] }
    }
  }

  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, { mode: "native" })
  await ctx.plugin(FileSystemStub)
  await ctx.plugin(LlmStub)
  await ctx.plugin(LocalAttachmentStore, { dshHome })
  await ctx.plugin({
    name: "tool-fs-integration-fixture",
    inject: toolFsInject,
    apply: applyToolFs,
  }, ToolFsConfig({}))

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  )
  ctx.on("tools/execute", createReadImageUrlMiddleware(ctx, {
    lookup: lookupWith([PUBLIC_V4]),
    openResponse: requester([
      response(200, { "content-type": "image/png" }, [png]),
    ]),
  }), { global: true })

  assert.ok(ctx.get("attachments"), "local attachment service should be mounted")
  assert.ok(ctx.get("tools"), "tool runtime should be mounted")
  assert.ok(ctx.get("fs"), "filesystem service should be mounted")
  assert.equal(ctx.tools.get("read_image")?.name, "read_image")
  const result = await ctx.tools.execute({
    callId: "call_remote_image",
    name: "read_image",
    arguments: { file_path: "https://images.example.net/pixel.png?signature=private" },
    agent: {
      options: { provider: CODEX_ROUTE_ID, model: "fixture" },
      session: { requestHeader: () => undefined },
    },
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  assert.equal(result.content.length, 2)
  assert.match(result.content[0].text, /<path>https:\/\/images\.example\.net\/pixel\.png<\/path>/u)
  assert.equal(result.content[1].type, "image")
  assert.match(result.content[1].attachment.attachmentId, /^sha256:[\da-f]{64}$/u)
})
