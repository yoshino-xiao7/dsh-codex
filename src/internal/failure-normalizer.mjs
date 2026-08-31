const ACCOUNT_QUOTA_CODES = new Set([
  "accountquotaexceeded",
  "billinghardlimitreached",
  "insufficientquota",
  "insufficientcredits",
  "quota",
  "quotaexceeded",
  "usagequotaexceeded",
])

const ACCOUNT_QUOTA_PATTERNS = [
  /\binsufficient[\s_-]+(?:quota|credits?|balance)\b/iu,
  /\byou\s+have\s+exceeded\s+the\s+(?:(?:\d+|five)[\s-]*hour\s+)?usage\s+quota\b/iu,
  /\b(?:chatgpt|account)\s+(?:quota|usage\s+limit)\s+will\s+reset\s+at\b/iu,
]

const PI_AI_AMBIGUOUS_429_PATTERN = /^you\s+have\s+hit\s+your\s+chatgpt\s+usage\s+limit(?:\s+\([^\r\n)]{1,80}\))?\.(?:\s+try\s+again\s+in\s+~\d+\s+min\.)?$/iu

const PI_AI_TRANSPORT_PATTERNS = [
  /^websocket\s+closed(?:\s|$)/iu,
  /^websocket\s+stream\s+closed\s+before\s+response\.completed$/iu,
  /^websocket\s+error(?:\s|$)/iu,
]

const PI_AI_CODEX_SERVER_PATTERNS = [
  /^(?:codex\s+error:\s*)?our\s+servers\s+are\s+currently\s+overloaded\.\s*please\s+try\s+again\s+later\.?$/iu,
]

const MAX_FAILURE_TEXT_CHARS = 65_536
const MAX_EMBEDDED_JSON_CHARS = 32_768
const MAX_EMBEDDED_OBJECTS = 16

const RESET_KEYS = new Set([
  "resetat",
  "resettime",
  "resetsat",
  "quotaresetat",
  "usageresetat",
])

const REQUEST_ID_KEYS = new Set([
  "requestid",
  "requestidentifier",
  "xrequestid",
])

const CLASSIFIER_KEYS = new Set(["code", "type"])

function normalizedKey(value) {
  return String(value).replaceAll(/[^a-z0-9]/giu, "").toLowerCase()
}

function scalarText(value) {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
}

function safeRequestId(value) {
  const candidate = scalarText(value)?.trim()
  if (candidate === undefined || !/^[A-Za-z0-9._:-]{1,128}$/u.test(candidate)) return undefined
  return candidate
}

/** Extract balanced JSON objects without evaluating the surrounding text. */
export function parseEmbeddedJsonObjects(text) {
  if (typeof text !== "string" || text.length === 0) return []

  const bounded = text.slice(0, MAX_FAILURE_TEXT_CHARS)
  const values = []
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false

  for (let index = 0; index < bounded.length; index += 1) {
    const character = bounded[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
      continue
    }

    if (character === '"') {
      quoted = true
      continue
    }
    if (character === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (character !== "}" || depth === 0) continue

    depth -= 1
    if (depth !== 0 || start < 0) continue
    if (index - start + 1 > MAX_EMBEDDED_JSON_CHARS) {
      start = -1
      continue
    }
    try {
      const value = JSON.parse(bounded.slice(start, index + 1))
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        values.push(value)
        if (values.length >= MAX_EMBEDDED_OBJECTS) return values
      }
    } catch {
      // The provider prefix may contain braces that are not JSON. Ignore them.
    }
    start = -1
  }

  return values
}

function knownErrorRecords(values) {
  const records = []
  for (const value of values) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue
    records.push(value)
    let error
    try {
      error = value.error
    } catch {
      continue
    }
    if (error !== null && typeof error === "object" && !Array.isArray(error)) records.push(error)
  }
  return records
}

function withoutEmbeddedObjects(text) {
  let output = ""
  let cursor = 0
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
      continue
    }
    if (character === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (character !== "}" || depth === 0) continue
    depth -= 1
    if (depth !== 0) continue
    output += `${text.slice(cursor, start)} `
    cursor = index + 1
    start = -1
  }

  if (depth > 0 && start >= 0) return output + text.slice(cursor, start)
  return output + text.slice(cursor)
}

function parseStatus(text, records, explicit) {
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) return explicit
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!new Set(["status", "statuscode", "httpstatus"]).has(normalizedKey(key))) continue
      const parsed = Number(value)
      if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed
    }
  }
  const hit = text.match(/\b(?:openai\s+api\s+error|api\s+error|http(?:\s+status)?)\s*\(?\s*(\d{3})\s*\)?/iu)
  return hit === null ? undefined : Number(hit[1])
}

function explicitOffsetDate(raw) {
  const hit = raw.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-])(\d{2}):?(\d{2})\b/u)
  if (hit === null) return undefined
  const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = hit
  const values = [year, month, day, hour, minute, second].map(Number)
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = values
  const offsetHourValue = Number(offsetHour)
  const offsetMinuteValue = Number(offsetMinute)
  if (monthValue < 1 || monthValue > 12 || dayValue < 1 || dayValue > 31
    || hourValue > 23 || minuteValue > 59 || secondValue > 59
    || offsetHourValue > 23 || offsetMinuteValue > 59) return undefined
  const wallTime = Date.UTC(
    yearValue,
    monthValue - 1,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
  )
  const wall = new Date(wallTime)
  if (wall.getUTCFullYear() !== yearValue || wall.getUTCMonth() !== monthValue - 1
    || wall.getUTCDate() !== dayValue || wall.getUTCHours() !== hourValue
    || wall.getUTCMinutes() !== minuteValue || wall.getUTCSeconds() !== secondValue) return undefined
  const offset = (offsetHourValue * 60 + offsetMinuteValue) * (sign === "+" ? 1 : -1)
  const epochMs = wallTime - offset * 60_000
  if (!Number.isFinite(epochMs)) return undefined
  return {
    raw: `${year}-${month}-${day} ${hour}:${minute}:${second} UTC${sign}${offsetHour}:${offsetMinute}`,
    epochMs,
    iso: new Date(epochMs).toISOString(),
  }
}

function explicitZuluDate(raw) {
  const hit = raw.match(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z\b/u)
  if (hit === null) return undefined
  const [, year, month, day, hour, minute, second] = hit
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = [
    year,
    month,
    day,
    hour,
    minute,
    second,
  ].map(Number)
  if (monthValue < 1 || monthValue > 12 || dayValue < 1 || dayValue > 31
    || hourValue > 23 || minuteValue > 59 || secondValue > 59) return undefined
  const epochMs = Date.UTC(
    yearValue,
    monthValue - 1,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
  )
  const date = new Date(epochMs)
  if (date.getUTCFullYear() !== yearValue || date.getUTCMonth() !== monthValue - 1
    || date.getUTCDate() !== dayValue || date.getUTCHours() !== hourValue
    || date.getUTCMinutes() !== minuteValue || date.getUTCSeconds() !== secondValue) return undefined
  const iso = date.toISOString()
  return { raw: iso, epochMs, iso }
}

function resetCandidate(text, records) {
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!RESET_KEYS.has(normalizedKey(key))) continue
      const candidate = scalarText(value)
      if (candidate !== undefined && candidate.length > 0) return candidate
    }
  }
  const hit = text.match(/\b(?:it\s+will\s+)?reset(?:s)?\s+at\s+(.+?)(?=\.\s+(?:we|please|request)\b|$)/iu)
  return hit?.[1]?.trim()
}

function parseReset(text, records) {
  const candidate = resetCandidate(text, records)
  if (candidate === undefined || candidate.length > 128 || /[\r\n\0]/u.test(candidate)) return undefined
  const offset = explicitOffsetDate(candidate)
  if (offset !== undefined) return offset
  const zulu = explicitZuluDate(candidate)
  if (zulu !== undefined) return zulu
  const numeric = /^\d{10}(?:\d{3})?$/u.test(candidate)
    ? Number(candidate) * (candidate.length === 10 ? 1_000 : 1)
    : undefined
  const epochMs = numeric
  if (!Number.isFinite(epochMs)) return undefined
  const iso = new Date(epochMs).toISOString()
  return { raw: iso, epochMs, iso }
}

function requestIdCandidate(text, records, explicit) {
  const direct = safeRequestId(explicit)
  if (direct !== undefined) return direct
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!REQUEST_ID_KEYS.has(normalizedKey(key))) continue
      const candidate = safeRequestId(value)
      if (candidate !== undefined) return candidate
    }
  }
  return safeRequestId(
    text.match(/\brequest\s+id\s*[:：]\s*([A-Za-z0-9._:-]{1,128})(?=$|[\s,;}"'])/iu)?.[1],
  )
}

function structuredClassifiers(records) {
  const values = []
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!CLASSIFIER_KEYS.has(normalizedKey(key))) continue
      const text = scalarText(value)
      if (text !== undefined) values.push(text)
    }
  }
  return values
}

function structuredMessages(records) {
  const values = []
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (normalizedKey(key) !== "message") continue
      const text = scalarText(value)
      if (text !== undefined) values.push(text)
    }
  }
  return values
}

function hasAccountQuotaClassifier(records) {
  return structuredClassifiers(records)
    .some((code) => ACCOUNT_QUOTA_CODES.has(normalizedKey(code)))
}

function hasAccountQuotaMessage(text, records) {
  const joined = [
    text,
    ...structuredMessages(records).map((value) => withoutEmbeddedObjects(value)),
  ].join("\n")
  return ACCOUNT_QUOTA_PATTERNS.some((pattern) => pattern.test(joined))
}

function accountQuotaEvidence(source, message, embeddedObjects) {
  const sourceRecords = knownErrorRecords([source])
  const sourceGroup = {
    classifierRecords: [source],
    messageRecords: [],
    records: [source],
    text: withoutEmbeddedObjects(message),
  }
  const detailGroups = [
    ...sourceRecords.slice(1).map((error) => ({
      classifierRecords: [error],
      messageRecords: [error],
      records: [error],
      text: "",
    })),
    ...embeddedObjects.map((embedded) => {
      const records = knownErrorRecords([embedded])
      return {
        classifierRecords: records,
        messageRecords: records,
        records,
        text: "",
      }
    }),
  ]
  const groups = [sourceGroup, ...detailGroups]

  const matchingGroup = groups.find((group) => hasAccountQuotaClassifier(group.classifierRecords))
    ?? groups.find((group) => hasAccountQuotaMessage(group.text, group.messageRecords))
  if (matchingGroup === undefined || matchingGroup !== sourceGroup) return matchingGroup

  return detailGroups.find((group) => hasAccountQuotaClassifier(group.classifierRecords))
    ?? detailGroups.find((group) => hasAccountQuotaMessage(group.text, group.messageRecords))
    ?? sourceGroup
}

function isKnownTransportFailure(source, message) {
  const code = normalizedKey(source.code)
  if (code === "streamclosed") return true
  return code === "piaierror"
    && PI_AI_TRANSPORT_PATTERNS.some((pattern) => pattern.test(message.trim()))
}

function isAmbiguousPiAi429(source, message) {
  return normalizedKey(source.code) === "piaierror"
    && PI_AI_AMBIGUOUS_429_PATTERN.test(message.trim())
}

function isKnownServerFailure(source, message) {
  const code = normalizedKey(source.code)
  if (code === "server" || code === "servererror") return true
  return code === "piaierror"
    && PI_AI_CODEX_SERVER_PATTERNS.some((pattern) => pattern.test(message.trim()))
}

export function inspectCodexFailure(failure) {
  const source = failure !== null && typeof failure === "object" ? failure : {}
  const rawMessage = typeof source.message === "string" ? source.message : String(failure ?? "Unknown Codex failure")
  const message = rawMessage.slice(0, MAX_FAILURE_TEXT_CHARS)
  const embeddedObjects = parseEmbeddedJsonObjects(message)
  const quotaEvidence = accountQuotaEvidence(source, message, embeddedObjects)
  const accountQuota = quotaEvidence !== undefined
  const factRecords = accountQuota
    ? [source, ...quotaEvidence.records.filter((record) => record !== source)]
    : [source]
  const trustedText = [
    withoutEmbeddedObjects(message),
    ...(quotaEvidence === undefined
      ? []
      : structuredMessages(quotaEvidence.messageRecords)
        .map((value) => withoutEmbeddedObjects(value))),
  ].join("\n")
  const transport = !accountQuota && isKnownTransportFailure(source, message)
  const ambiguous429 = !accountQuota && !transport && isAmbiguousPiAi429(source, message)
  const server = !accountQuota && !transport && !ambiguous429
    && isKnownServerFailure(source, message)
  return Object.freeze({
    kind: accountQuota
      ? "account-quota"
      : transport
        ? "transport"
        : ambiguous429
          ? "ambiguous-limit"
          : server
            ? "server"
            : "other",
    status: parseStatus(trustedText, factRecords, source.status),
    reset: parseReset(trustedText, factRecords),
    requestId: requestIdCandidate(trustedText, factRecords, source.requestId),
  })
}

function quotaMessage(facts) {
  const reset = facts.reset?.raw === undefined
    ? ""
    : ` 重置时间 / Reset: ${facts.reset.raw}.`
  const request = facts.requestId === undefined
    ? ""
    : ` 请求 ID / Request ID: ${facts.requestId}.`
  return `ChatGPT Codex 账户用量配额已耗尽，已停止自动重试。 / ChatGPT Codex account quota exhausted; automatic retry stopped.${reset}${request}`
}

function ambiguousLimitMessage() {
  return "pi-ai 返回了无法区分账户配额与临时限流的通用 ChatGPT usage-limit 文案；因原始结构化证据不可用，未标记为账户配额，并已停止自动重试。 / pi-ai returned generalized ChatGPT usage-limit text that cannot distinguish account quota from transient rate limiting; because the original structured evidence is unavailable, it was not marked as account quota, and automatic retry stopped."
}

function transportMessage() {
  return "Codex 传输在响应完成前中断。 / Codex transport ended before the response completed."
}

function serverMessage() {
  return "Codex 服务当前繁忙，请稍后继续。 / Codex servers are currently overloaded; please continue shortly."
}

/** Normalize only failures with a public, narrowly verifiable classification. */
export function normalizeCodexFailure(failure) {
  const facts = inspectCodexFailure(failure)
  if (facts.kind === "transport") {
    return {
      changed: true,
      failure: Object.freeze({
        message: transportMessage(),
        code: "TRANSPORT",
        ...(facts.status === undefined ? {} : { status: facts.status }),
        ...(facts.requestId === undefined ? {} : { requestId: facts.requestId }),
      }),
      facts,
    }
  }
  if (facts.kind === "ambiguous-limit") {
    return {
      changed: true,
      failure: Object.freeze({
        message: ambiguousLimitMessage(),
        code: "QUOTA_OR_RATE_LIMIT",
        ...(facts.status === undefined ? {} : { status: facts.status }),
        ...(facts.requestId === undefined ? {} : { requestId: facts.requestId }),
      }),
      facts,
    }
  }
  if (facts.kind === "server") {
    return {
      changed: true,
      failure: Object.freeze({
        message: serverMessage(),
        code: "SERVER",
        ...(facts.status === undefined ? {} : { status: facts.status }),
        ...(facts.requestId === undefined ? {} : { requestId: facts.requestId }),
      }),
      facts,
    }
  }
  if (facts.kind !== "account-quota") return { changed: false, failure, facts }

  const normalized = {
    message: quotaMessage(facts),
    code: "QUOTA",
    status: facts.status ?? 429,
    ...(facts.requestId === undefined ? {} : { requestId: facts.requestId }),
  }
  return { changed: true, failure: Object.freeze(normalized), facts }
}
