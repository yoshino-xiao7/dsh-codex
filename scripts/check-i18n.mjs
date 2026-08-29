import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assertReleaseVersion, releaseDocumentPaths } from "./release-version.mjs"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const version = assertReleaseVersion(packageJson.version)
const pairs = [
  ["README.md", "README.en.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING.en.md"],
  ["docs/README.md", "docs/README.en.md"],
  ["docs/architecture.md", "docs/architecture.en.md"],
  ["docs/configuration.md", "docs/configuration.en.md"],
  ["docs/compatibility.md", "docs/compatibility.en.md"],
  ["docs/contribution-sources.md", "docs/contribution-sources.en.md"],
  ["docs/troubleshooting.md", "docs/troubleshooting.en.md"],
  ["docs/testing.md", "docs/testing.en.md"],
  ["docs/releasing.md", "docs/releasing.en.md"],
]

const combinedDocuments = [
  ["CHANGELOG.md", ["### 中文", "### English"]],
  ["SECURITY.md", ["## 中文", "## English"]],
  ["SUPPORT.md", ["使用问题", "Usage questions"]],
  ["THIRD_PARTY_NOTICES.md", ["本项目的运行时组合依赖", "This project composes"]],
  ["docs/github-about.md", ["社区维护的 DeepSeek Harness Codex 插件", "Community Codex plugin for DSH"]],
  [".github/ISSUE_TEMPLATE/bug.yml", ["不要提交 token", "Never submit tokens"]],
  [".github/ISSUE_TEMPLATE/compatibility.yml", ["隐私确认", "Privacy confirmation"]],
  [".github/pull_request_template.md", ["有权提交全部内容", "right to submit every included item"]],
]

for (const [chineseFile, englishFile] of pairs) {
  await access(path.join(root, chineseFile))
  await access(path.join(root, englishFile))
  const chinese = await readFile(path.join(root, chineseFile), "utf8")
  const english = await readFile(path.join(root, englishFile), "utf8")
  if (chinese.trim().length === 0 || english.trim().length === 0) {
    throw new Error(`Language pair contains an empty file: ${chineseFile} / ${englishFile}`)
  }
  const chineseStructure = markdownStructure(chinese)
  const englishStructure = markdownStructure(english)
  if (JSON.stringify(chineseStructure) !== JSON.stringify(englishStructure)) {
    throw new Error(`Markdown structure drifted: ${chineseFile} / ${englishFile}`)
  }
}

for (const [file, markers] of combinedDocuments) {
  const source = await readFile(path.join(root, file), "utf8")
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${file} is missing bilingual marker: ${marker}`)
  }
}

const readmeZh = await readFile(path.join(root, "README.md"), "utf8")
const readmeEn = await readFile(path.join(root, "README.en.md"), "utf8")
for (const [chinese, english] of [
  [version, version],
  ["AccountQuotaExceeded", "AccountQuotaExceeded"],
  ["maxPixels", "maxPixels"],
  ["Codex 登录", "Codex sign-in"],
]) {
  if (!readmeZh.includes(chinese) || !readmeEn.includes(english)) {
    throw new Error(`README language pair is missing required markers ${chinese} / ${english}`)
  }
}

const { notes: releasePath } = releaseDocumentPaths(version)
const release = await readFile(path.join(root, releasePath), "utf8")
if (!release.includes("## 中文") || !release.includes("## English")) {
  throw new Error(`v${version} release notes must contain complete Chinese and English sections`)
}

function markdownStructure(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n")
  const headings = []
  const fences = []
  const lists = []
  let tableRows = 0
  for (const line of lines) {
    const heading = /^(#{1,6})\s+/u.exec(line)
    if (heading !== null) headings.push(heading[1].length)
    const fence = /^```\s*([^\s`]*)/u.exec(line)
    if (fence !== null) fences.push(fence[1])
    if (/^\s*[-*+]\s+/u.test(line)) lists.push("bullet")
    else if (/^\s*\d+\.\s+/u.test(line)) lists.push("ordered")
    if (/^\s*\|.*\|\s*$/u.test(line)) tableRows += 1
  }
  return { headings, fences, lists, tableRows }
}
