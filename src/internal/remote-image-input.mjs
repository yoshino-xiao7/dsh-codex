import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { promisify } from "node:util"
import {
  brotliDecompress,
  gunzip,
  inflate,
} from "node:zlib"

import { CODEX_ROUTE_ID } from "./codex-identifiers.mjs"

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)
const brotliDecompressAsync = promisify(brotliDecompress)

export const REMOTE_IMAGE_MEDIA_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

export const DEFAULT_REMOTE_IMAGE_POLICY = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxRedirects: 3,
  timeoutMs: 15_000,
  mediaTypes: REMOTE_IMAGE_MEDIA_TYPES,
})

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_LOCATION_LENGTH = 8_192
const MAX_URL_LENGTH = 8_192
const MAX_RESPONSE_CHUNKS = 16_384
const MAX_CONCURRENT_REMOTE_IMAGES = 2
const MAX_QUEUED_REMOTE_IMAGES = 32

export class RemoteImageInputError extends Error {
  constructor(message, code, options) {
    super(message, options)
    this.name = "RemoteImageInputError"
    this.code = code
  }
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

function nonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function resolveMediaTypes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("mediaTypes must be a non-empty array")
  }
  const unique = []
  for (const mediaType of value) {
    if (!REMOTE_IMAGE_MEDIA_TYPES.includes(mediaType)) {
      throw new TypeError(`unsupported remote image media type: ${String(mediaType)}`)
    }
    if (!unique.includes(mediaType)) unique.push(mediaType)
  }
  return Object.freeze(unique)
}

export function resolveRemoteImagePolicy(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("remote image policy must be an object")
  }
  return Object.freeze({
    maxBytes: positiveSafeInteger(input.maxBytes ?? DEFAULT_REMOTE_IMAGE_POLICY.maxBytes, "maxBytes"),
    maxRedirects: nonNegativeSafeInteger(
      input.maxRedirects ?? DEFAULT_REMOTE_IMAGE_POLICY.maxRedirects,
      "maxRedirects",
    ),
    timeoutMs: positiveSafeInteger(input.timeoutMs ?? DEFAULT_REMOTE_IMAGE_POLICY.timeoutMs, "timeoutMs"),
    mediaTypes: resolveMediaTypes(input.mediaTypes ?? DEFAULT_REMOTE_IMAGE_POLICY.mediaTypes),
  })
}

function ipv4Value(address) {
  const parts = address.split(".")
  if (parts.length !== 4) return undefined
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    value = (value << 8n) | BigInt(octet)
  }
  return value
}

function ipv6Value(rawAddress) {
  let address = rawAddress.toLowerCase()
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1)
  if (address.includes("%")) return undefined

  const embeddedV4 = address.includes(".")
  if (embeddedV4) {
    const separator = address.lastIndexOf(":")
    if (separator < 0) return undefined
    const v4 = ipv4Value(address.slice(separator + 1))
    if (v4 === undefined) return undefined
    const high = ((v4 >> 16n) & 0xffffn).toString(16)
    const low = (v4 & 0xffffn).toString(16)
    address = `${address.slice(0, separator)}:${high}:${low}`
  }

  const halves = address.split("::")
  if (halves.length > 2) return undefined
  const left = halves[0] === "" ? [] : halves[0].split(":")
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":")
  if (left.some((part) => !/^[\da-f]{1,4}$/u.test(part))) return undefined
  if (right.some((part) => !/^[\da-f]{1,4}$/u.test(part))) return undefined

  const omitted = 8 - left.length - right.length
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return undefined
  const parts = [...left, ...Array.from({ length: omitted }, () => "0"), ...right]
  if (parts.length !== 8) return undefined
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n)
}

function inCidr(value, network, prefix, bits) {
  const shift = BigInt(bits - prefix)
  return (value >> shift) === (network >> shift)
}

const IPV4_BLOCKS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([address, prefix]) => [ipv4Value(address), prefix])

const IPV6_GLOBAL = [ipv6Value("2000::"), 3]
const IPV6_BLOCKS = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
].map(([address, prefix]) => [ipv6Value(address), prefix])

/** Return true only for an ordinary globally routable unicast address. */
export function isPublicIpAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const value = ipv4Value(address)
    return value !== undefined
      && !IPV4_BLOCKS.some(([network, prefix]) => inCidr(value, network, prefix, 32))
  }
  if (family === 6) {
    const value = ipv6Value(address)
    if (value === undefined) return false
    if (!inCidr(value, IPV6_GLOBAL[0], IPV6_GLOBAL[1], 128)) return false
    return !IPV6_BLOCKS.some(([network, prefix]) => inCidr(value, network, prefix, 128))
  }
  return false
}

function unbracket(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
}

function normalizedHostname(hostname) {
  const host = unbracket(hostname).toLowerCase()
  return host.endsWith(".") ? host.slice(0, -1) : host
}

const FORBIDDEN_HOST_SUFFIXES = [
  ".home.arpa",
  ".internal",
  ".invalid",
  ".local",
  ".localhost",
  ".test",
]

function hasForbiddenHostSuffix(hostname) {
  return FORBIDDEN_HOST_SUFFIXES.some((suffix) => (
    hostname === suffix.slice(1) || hostname.endsWith(suffix)
  ))
}

function assertRemoteUrl(input, base) {
  let url
  try {
    url = base === undefined ? new URL(input) : new URL(input, base)
  } catch (error) {
    throw new RemoteImageInputError("remote image URL is invalid", "INVALID_URL", { cause: error })
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImageInputError("remote image URL must use http or https", "UNSUPPORTED_PROTOCOL")
  }
  if (url.username !== "" || url.password !== "") {
    throw new RemoteImageInputError("remote image URL must not contain user information", "URL_CREDENTIALS")
  }
  if (url.hostname === "") {
    throw new RemoteImageInputError("remote image URL must contain a host", "INVALID_URL")
  }
  if (url.href.length > MAX_URL_LENGTH) {
    throw new RemoteImageInputError("remote image URL is too long", "INVALID_URL")
  }

  const hostname = normalizedHostname(url.hostname)
  if (hostname === "localhost" || hasForbiddenHostSuffix(hostname)) {
    throw new RemoteImageInputError("remote image URL targets a non-public host", "UNSAFE_ADDRESS")
  }
  if (isIP(hostname) === 0 && !hostname.includes(".")) {
    throw new RemoteImageInputError("remote image URL host must be fully qualified", "UNSAFE_ADDRESS")
  }
  return url
}

function normalizeLookupResult(result) {
  const entries = Array.isArray(result) ? result : [result]
  const addresses = []
  for (const entry of entries) {
    const address = typeof entry === "string" ? entry : entry?.address
    const family = typeof entry === "object" && entry !== null ? entry.family : isIP(address)
    const detected = typeof address === "string" ? isIP(address) : 0
    if (detected === 0 || (family !== 4 && family !== 6) || detected !== Number(family)) {
      throw new RemoteImageInputError("DNS returned an invalid address", "DNS_FAILED")
    }
    if (!isPublicIpAddress(address)) {
      throw new RemoteImageInputError("remote image URL resolved to a non-public address", "UNSAFE_ADDRESS")
    }
    const key = `${detected}:${address}`
    if (!addresses.some((candidate) => candidate.key === key)) {
      addresses.push({ key, address, family: detected })
    }
  }
  if (addresses.length === 0) {
    throw new RemoteImageInputError("remote image host did not resolve", "DNS_FAILED")
  }
  return addresses.map(({ address, family }) => Object.freeze({ address, family }))
}

function awaitWithSignal(value, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    Promise.resolve(value).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })
}

async function resolveAddresses(url, lookup, signal) {
  const hostname = normalizedHostname(url.hostname)
  if (isIP(hostname) !== 0) return normalizeLookupResult([{ address: hostname, family: isIP(hostname) }])
  let result
  try {
    result = await awaitWithSignal(
      Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })),
      signal,
    )
  } catch (error) {
    if (error instanceof RemoteImageInputError) throw error
    throw new RemoteImageInputError("remote image host lookup failed", "DNS_FAILED", { cause: error })
  }
  return normalizeLookupResult(result)
}

function pinnedLookup(hostname, addresses) {
  const expected = normalizedHostname(hostname)
  return (requestedHostname, options, callback) => {
    const done = typeof options === "function" ? options : callback
    const lookupOptions = typeof options === "object" && options !== null ? options : {}
    if (typeof done !== "function") throw new TypeError("lookup callback is required")
    if (normalizedHostname(requestedHostname) !== expected) {
      done(new RemoteImageInputError("request attempted an unpinned DNS lookup", "DNS_REBINDING_GUARD"))
      return
    }
    const requestedFamily = Number(lookupOptions.family) || 0
    const candidates = requestedFamily === 0
      ? addresses
      : addresses.filter((candidate) => candidate.family === requestedFamily)
    if (candidates.length === 0) {
      done(new RemoteImageInputError("no pinned address matches the requested family", "DNS_REBINDING_GUARD"))
      return
    }
    if (lookupOptions.all === true) {
      done(null, candidates.map(({ address, family }) => ({ address, family })))
      return
    }
    done(null, candidates[0].address, candidates[0].family)
  }
}

function openNodeResponse(url, options) {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      agent: false,
      headers: options.headers,
      lookup: options.lookup,
      maxHeaderSize: 16 * 1024,
      method: "GET",
      signal: options.signal,
    }, resolve)
    outgoing.once("error", reject)
    outgoing.end()
  })
}

function headerValue(headers, name) {
  const value = headers?.[name]
  if (Array.isArray(value)) return value.join(",")
  return typeof value === "string" ? value : undefined
}

function contentLength(response) {
  const header = headerValue(response.headers, "content-length")
  if (header === undefined) return undefined
  if (!/^\d+$/u.test(header)) {
    throw new RemoteImageInputError("remote image response has an invalid content length", "INVALID_RESPONSE")
  }
  const value = Number(header)
  if (!Number.isSafeInteger(value)) {
    throw new RemoteImageInputError("remote image response has an invalid content length", "INVALID_RESPONSE")
  }
  return value
}

async function readBounded(response, maxBytes, signal) {
  const declared = contentLength(response)
  if (declared !== undefined && declared > maxBytes) {
    response.destroy?.()
    throw new RemoteImageInputError("remote image response exceeds the byte limit", "RESPONSE_TOO_LARGE")
  }
  const chunks = []
  let bytes = 0
  for await (const value of response) {
    if (signal.aborted) throw signal.reason
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    bytes += chunk.byteLength
    if (bytes > maxBytes) {
      response.destroy?.()
      throw new RemoteImageInputError("remote image response exceeds the byte limit", "RESPONSE_TOO_LARGE")
    }
    if (chunks.length >= MAX_RESPONSE_CHUNKS) {
      response.destroy?.()
      throw new RemoteImageInputError("remote image response is excessively fragmented", "INVALID_RESPONSE")
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, bytes)
}

async function decodeBody(data, response, maxBytes) {
  const raw = headerValue(response.headers, "content-encoding")?.trim().toLowerCase()
  const encoding = raw === undefined || raw === "" ? "identity" : raw
  if (encoding.includes(",")) {
    throw new RemoteImageInputError("stacked content encodings are not accepted", "UNSUPPORTED_CONTENT_ENCODING")
  }
  if (encoding === "identity") return data

  let decode
  if (encoding === "gzip" || encoding === "x-gzip") decode = gunzipAsync
  else if (encoding === "deflate") decode = inflateAsync
  else if (encoding === "br") decode = brotliDecompressAsync
  else {
    throw new RemoteImageInputError("remote image content encoding is not supported", "UNSUPPORTED_CONTENT_ENCODING")
  }

  try {
    const decoded = await decode(data, { maxOutputLength: maxBytes })
    if (decoded.byteLength > maxBytes) {
      throw new RemoteImageInputError("decompressed remote image exceeds the byte limit", "RESPONSE_TOO_LARGE")
    }
    return decoded
  } catch (error) {
    if (error instanceof RemoteImageInputError) throw error
    if (error?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|larger than/u.test(error?.message ?? "")) {
      throw new RemoteImageInputError("decompressed remote image exceeds the byte limit", "RESPONSE_TOO_LARGE", {
        cause: error,
      })
    }
    throw new RemoteImageInputError("remote image content encoding is invalid", "INVALID_CONTENT_ENCODING", {
      cause: error,
    })
  }
}

function responseMediaType(response, allowed) {
  const raw = headerValue(response.headers, "content-type")
  const mediaType = raw?.split(";", 1)[0].trim().toLowerCase()
  if (mediaType === undefined || !allowed.includes(mediaType)) {
    throw new RemoteImageInputError("remote response is not an allowed image media type", "UNSUPPORTED_MEDIA_TYPE")
  }
  return mediaType
}

function safeImageName(url, mediaType) {
  const lastSegment = url.pathname.split("/").at(-1)
  let decoded = lastSegment
  try {
    decoded = decodeURIComponent(lastSegment)
  } catch {
    // Keep the URL-encoded segment; it is display-only and never interpreted as a path.
  }
  const cleaned = decoded
    ?.replace(/[\u0000-\u001f\u007f/\\]/gu, "_")
    .trim()
    .slice(0, 120)
  if (cleaned) return cleaned
  const extension = mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length)
  return `remote-image.${extension}`
}

function deadline(parentSignal, timeoutMs) {
  const controller = new AbortController()
  let timer
  const abortFromParent = () => {
    controller.abort(parentSignal.reason ?? new RemoteImageInputError("remote image request was aborted", "ABORTED"))
  }
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true })
  if (!controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(new RemoteImageInputError("remote image request timed out", "TIMEOUT"))
    }, timeoutMs)
  }
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      parentSignal?.removeEventListener("abort", abortFromParent)
    },
  }
}

function abortReason(signal) {
  if (signal.reason instanceof Error) return signal.reason
  return new RemoteImageInputError("remote image request was aborted", "ABORTED")
}

function linkedAbortSignal(...sources) {
  const controller = new AbortController()
  const listeners = []
  const abortFrom = (source) => {
    if (controller.signal.aborted) return
    controller.abort(source.reason ?? new RemoteImageInputError("remote image request was aborted", "ABORTED"))
  }

  for (const source of sources) {
    if (source === undefined) continue
    if (source.aborted) {
      abortFrom(source)
      break
    }
    const listener = () => abortFrom(source)
    source.addEventListener("abort", listener, { once: true })
    listeners.push({ source, listener })
  }

  return {
    signal: controller.signal,
    dispose() {
      for (const { source, listener } of listeners) {
        source.removeEventListener("abort", listener)
      }
    },
  }
}

class RemoteImageWorkLimiter {
  #active = 0
  #queue = []
  #disposedReason
  #idleWaiters = []

  run(signal, task) {
    if (this.#disposedReason !== undefined) return Promise.reject(this.#disposedReason)
    if (signal?.aborted === true) return Promise.reject(abortReason(signal))
    if (this.#active >= MAX_CONCURRENT_REMOTE_IMAGES && this.#queue.length >= MAX_QUEUED_REMOTE_IMAGES) {
      return Promise.reject(new RemoteImageInputError(
        "too many remote image requests are pending",
        "TOO_MANY_REQUESTS",
      ))
    }

    return new Promise((resolve, reject) => {
      const entry = {
        signal,
        task,
        resolve,
        reject,
        started: false,
        onAbort: undefined,
      }
      entry.onAbort = () => {
        if (entry.started) return
        const index = this.#queue.indexOf(entry)
        if (index < 0) return
        this.#queue.splice(index, 1)
        signal.removeEventListener("abort", entry.onAbort)
        reject(abortReason(signal))
      }
      signal?.addEventListener("abort", entry.onAbort, { once: true })
      this.#queue.push(entry)
      this.#drain()
    })
  }

  dispose(reason = new RemoteImageInputError("remote image middleware was disposed", "ABORTED")) {
    if (this.#disposedReason === undefined) {
      this.#disposedReason = reason
      for (const entry of this.#queue.splice(0)) {
        entry.signal?.removeEventListener("abort", entry.onAbort)
        entry.reject(reason)
      }
    }
    if (this.#active === 0) return Promise.resolve()
    return new Promise((resolve) => { this.#idleWaiters.push(resolve) })
  }

  #drain() {
    if (this.#disposedReason !== undefined) return
    while (this.#active < MAX_CONCURRENT_REMOTE_IMAGES && this.#queue.length > 0) {
      const entry = this.#queue.shift()
      entry.started = true
      entry.signal?.removeEventListener("abort", entry.onAbort)
      if (entry.signal?.aborted === true) {
        entry.reject(abortReason(entry.signal))
        continue
      }

      this.#active += 1
      void Promise.resolve()
        .then(() => {
          if (entry.signal?.aborted === true) throw abortReason(entry.signal)
          return entry.task()
        })
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active -= 1
          if (this.#disposedReason !== undefined && this.#active === 0) {
            for (const resolve of this.#idleWaiters.splice(0)) resolve()
          } else {
            this.#drain()
          }
        })
    }
  }
}

function discard(response) {
  response.resume?.()
  response.destroy?.()
}

/**
 * Download one remote image through a DNS-pinned, redirect-aware request path.
 * Network dependencies are injectable so the security boundary can be tested
 * without contacting external hosts.
 */
export async function downloadRemoteImage(input, options = {}) {
  const policy = resolveRemoteImagePolicy(options.policy)
  const lookup = options.lookup ?? dnsLookup
  const openResponse = options.openResponse ?? openNodeResponse
  let current = assertRemoteUrl(input)
  const active = deadline(options.signal, policy.timeoutMs)
  let redirects = 0

  try {
    while (true) {
      if (active.signal.aborted) throw abortReason(active.signal)
      const addresses = await resolveAddresses(current, lookup, active.signal)
      if (active.signal.aborted) throw abortReason(active.signal)

      let response
      try {
        response = await awaitWithSignal(
          Promise.resolve().then(() => openResponse(current, {
            headers: {
              accept: policy.mediaTypes.join(", "),
              "accept-encoding": "gzip, deflate, br",
              "user-agent": "dsh-codex remote-image",
            },
            lookup: pinnedLookup(current.hostname, addresses),
            signal: active.signal,
          })),
          active.signal,
        )
      } catch (error) {
        if (active.signal.aborted) throw abortReason(active.signal)
        if (error instanceof RemoteImageInputError) throw error
        throw new RemoteImageInputError("remote image request failed", "NETWORK", { cause: error })
      }

      const status = response.statusCode
      if (REDIRECT_STATUSES.has(status)) {
        const location = headerValue(response.headers, "location")
        discard(response)
        if (location === undefined || location.length === 0 || location.length > MAX_LOCATION_LENGTH) {
          throw new RemoteImageInputError("remote image redirect location is missing or invalid", "INVALID_REDIRECT")
        }
        if (redirects >= policy.maxRedirects) {
          throw new RemoteImageInputError("remote image exceeded the redirect limit", "TOO_MANY_REDIRECTS")
        }
        current = assertRemoteUrl(location, current)
        redirects += 1
        continue
      }
      if (status !== 200) {
        discard(response)
        throw new RemoteImageInputError(`remote image request returned HTTP ${String(status)}`, "HTTP_STATUS")
      }

      try {
        const mediaType = responseMediaType(response, policy.mediaTypes)
        const encoded = await awaitWithSignal(
          readBounded(response, policy.maxBytes, active.signal),
          active.signal,
        )
        const data = await awaitWithSignal(
          decodeBody(encoded, response, policy.maxBytes),
          active.signal,
        )
        if (data.byteLength === 0) {
          throw new RemoteImageInputError("remote image response is empty", "INVALID_RESPONSE")
        }
        return Object.freeze({
          data: Uint8Array.from(data),
          mediaType,
          name: safeImageName(current, mediaType),
        })
      } catch (error) {
        response.destroy?.()
        if (active.signal.aborted) throw abortReason(active.signal)
        if (error instanceof RemoteImageInputError) throw error
        throw new RemoteImageInputError("remote image response failed", "NETWORK", { cause: error })
      }
    }
  } finally {
    active.dispose()
  }
}

function attachmentPolicy(attachments, policy) {
  if (attachments === null || typeof attachments !== "object" || typeof attachments.saveImage !== "function") {
    throw new RemoteImageInputError("durable attachment service is unavailable", "ATTACHMENT_UNAVAILABLE")
  }
  const limits = attachments.imageLimits
  if (limits === null || typeof limits !== "object") {
    throw new RemoteImageInputError("durable attachment limits are unavailable", "ATTACHMENT_UNAVAILABLE")
  }
  const maxBytes = Math.min(
    policy.maxBytes,
    positiveSafeInteger(limits.maxImageBytes, "attachments.imageLimits.maxImageBytes"),
    positiveSafeInteger(limits.maxMessageImageBytes, "attachments.imageLimits.maxMessageImageBytes"),
  )
  const deployed = Array.isArray(limits.mediaTypes) ? limits.mediaTypes : []
  const mediaTypes = policy.mediaTypes.filter((mediaType) => deployed.includes(mediaType))
  if (mediaTypes.length === 0) {
    throw new RemoteImageInputError("deployment accepts no supported remote image media types", "UNSUPPORTED_MEDIA_TYPE")
  }
  return { ...policy, maxBytes, mediaTypes }
}

/** Download, validate, and commit one URL image before exposing its model block. */
export async function saveRemoteImage(attachments, input, options = {}) {
  const policy = attachmentPolicy(attachments, resolveRemoteImagePolicy(options.policy))
  const downloaded = await downloadRemoteImage(input, { ...options, policy })
  if (options.signal?.aborted) throw abortReason(options.signal)
  const attachment = await attachments.saveImage(downloaded)
  if (options.signal?.aborted) throw abortReason(options.signal)
  return Object.freeze({
    attachment,
    block: Object.freeze({ type: "image", attachment }),
  })
}

function isHttpUrlString(value) {
  return typeof value === "string" && /^https?:\/\//iu.test(value.trim())
}

function displayRemoteUrl(input) {
  const url = assertRemoteUrl(input)
  url.search = ""
  url.hash = ""
  return url.toString()
}

function imageValue(attachment) {
  return {
    attachmentId: attachment.attachmentId,
    mediaType: attachment.mediaType,
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    ...(attachment.name === undefined ? {} : { name: attachment.name }),
    ...(attachment.originalDimensions === undefined
      ? {}
      : { originalDimensions: { ...attachment.originalDimensions } }),
  }
}

function activeModelRoute(exec) {
  const routed = exec.agent?.session.requestHeader()?.config
  return {
    provider: routed?.provider ?? exec.agent?.options.provider,
    model: routed?.model ?? exec.agent?.options.model,
  }
}

async function assertImageCapableRoute(ctx, exec, requestedUrl, signal = exec.signal) {
  const { provider, model } = activeModelRoute(exec)
  const llm = ctx.get("llm")
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${displayRemoteUrl(requestedUrl)}" as an image: the current model route could not be resolved`)
  }
  const active = await awaitWithSignal(
    Promise.resolve().then(() => llm.resolveModelInfo(provider, model, signal)),
    signal,
  )
  if (active.inputModalities === undefined || !active.inputModalities.includes("image")) {
    throw new Error(`cannot read "${displayRemoteUrl(requestedUrl)}" as an image: model "${model}" does not declare image input; switch to an image-capable model to read images`)
  }
}

/**
 * Build a public `tools/execute` middleware that handles only HTTP(S) values
 * passed to the existing `read_image` tool. The tool registry validates this
 * value against the original output schema and invokes its original renderer;
 * ordinary filesystem paths always delegate to `next()` unchanged.
 */
export function createReadImageUrlMiddleware(ctx, options = {}) {
  if (ctx === null || typeof ctx !== "object" || typeof ctx.get !== "function") {
    throw new TypeError("a Cordis context with public service lookup is required")
  }
  const limiter = new RemoteImageWorkLimiter()
  const lifetime = new AbortController()
  let disposal
  const middleware = async (exec, next) => {
    const requested = exec.name === "read_image" ? exec.arguments?.file_path : undefined
    if (!isHttpUrlString(requested)) return next()
    if (activeModelRoute(exec).provider !== CODEX_ROUTE_ID) return next()

    const normalized = requested.trim()
    const active = linkedAbortSignal(exec.signal, lifetime.signal)
    try {
      if (active.signal.aborted) throw abortReason(active.signal)
      return await limiter.run(active.signal, async () => {
        await assertImageCapableRoute(ctx, exec, normalized, active.signal)
        const attachments = ctx.get("attachments")
        const { attachment } = await saveRemoteImage(attachments, normalized, {
          ...options,
          signal: active.signal,
        })
        return {
          isError: false,
          value: {
            path: displayRemoteUrl(normalized),
            image: imageValue(attachment),
          },
        }
      })
    } finally {
      active.dispose()
    }
  }
  middleware.dispose = () => {
    if (disposal !== undefined) return disposal
    const reason = new RemoteImageInputError("remote image middleware was disposed", "ABORTED")
    const pending = limiter.dispose(reason)
    disposal = Promise.resolve(pending)
    lifetime.abort(reason)
    return disposal
  }
  return middleware
}
