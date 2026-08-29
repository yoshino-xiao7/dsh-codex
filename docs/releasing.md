# 发布流程

[简体中文](releasing.md) | [English](releasing.en.md)

新版本从 `0.0.1` 开始。`0.0.x` 是技术预览，每次发布都必须使用中英双语 Release 正文。

## 准备

1. 从 `main` 创建名称清晰的发布分支；
2. 更新 `package.json`、`CHANGELOG.md`、README 功能与支持边界、兼容日期和 `docs/releases/v<version>.md`；
3. 确认 package name、repository URL、license、peer 范围和 `dsh.bundle`；
4. 同步审查并更新根目录 `pnpm-lock.yaml` 与 `test/fixtures/dsh-runtime/pnpm-lock.yaml`，不能只更新其中一套依赖图；
5. 合并前让 CI 在 Linux、macOS、Windows 通过；
6. 用受控测试账号完成本版本要求的真实验收，不能把 token、OAuth code、Cookie 或账号凭据写入记录。

可以用离线准备脚本建立下一版本的发布骨架：

```sh
pnpm run release:prepare -- 0.0.2
```

它只创建或补齐 `package.json` 版本、双语 `CHANGELOG.md` 草稿、双语 Release 草稿和全新的 schema v3 draft 验收记录。脚本幂等，不访问 Git 或网络，也不会伪造日期、提交或通过证据；已有有效人工内容不会被覆盖，任何冲突都会在写入前失败。README、兼容性文档、lockfile、发布分支、提交和标签仍需人工处理。

## 两级门禁

普通 CI 使用草稿模式。它允许 `TBD` 和 `pending`，但会检查版本、双语 Release 结构及验收记录结构，因此未发布版本可以持续集成：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run verify:release
```

`npm publish` 使用严格模式。下面任一条件不满足都会在网络发布前失败：

- Release 正文仍包含 `TBD`、`pending`、`draft`、`unreleased` 或对应中文占位词；
- `docs/releases/v<version>.acceptance.json` 未标记为 `approved`；
- Linux、macOS、Windows 的 `smoke:dsh-profile`，或固定清单中的真实 ChatGPT OAuth、模型、文本/reasoning 流、usage、工具闭环、replay、图片、transport 与 Fast 验收没有全部通过；
- 验收时间、运行环境、Node 版本、审批人或 HTTPS 证据链接缺失；
- 验收后的提交修改了允许的发布证据文件以外的文件；允许清理发布状态的文件仅包括双语 Release 正文、验收 JSON、双语 README、`CHANGELOG.md` 和双语兼容性文档；
- `.tgz`、SHA-256、SRI、锁定参考 SBOM、实际安装树、生产依赖审计或隔离导入证据缺失或不匹配。

严格命令由发布工作流和 `prepublishOnly` 同时调用：

```sh
pnpm run verify:release:publish
```

不要通过设置伪造环境变量绕过门禁。缺少真实证据时保持草稿状态。
`prepublishOnly` 保护从仓库 checkout 发起的发布；npm 对现成 tarball 不执行该生命周期，因此工作流会在发布同一 `.tgz` 的前一步显式运行严格门禁，并只在受保护 environment 审批后申请短期 OIDC identity token。

## 验收记录

1. 在已提交的 release candidate 上运行跨平台 CI 和真实网络验收；
2. 把该提交的完整 40 位 commit 写入 `testedCommit`；
3. 在三个系统分别使用精确 DSH `0.1.1-rc.2` 和已测试的 Node 22（至少 `22.19.0`）或 24 运行 profile smoke，填写 `testedAt`、环境信息和不含敏感参数的 HTTPS 证据链接；
4. 使用受控测试账号逐项完成下表的真实验收；每项只能在对应断言均有脱敏证据后改为 `passed`，不能用自由文本概括代替；
5. 所有项目通过后由维护者填写审批信息，并把 `releaseStatus` 改为 `approved`；
6. 此后只允许修改 `docs/releases/v<version>.md`、对应验收 JSON、`README.md`、`README.en.md`、`CHANGELOG.md`、`docs/compatibility.md` 和 `docs/compatibility.en.md`，用于填写日期、证据和发布状态。源码、配置、依赖、锁文件或工作流有任何变化，都必须基于新提交重新验收。

| 验收项 | 必须证明 |
| --- | --- |
| `oauthWebSignIn` | 从 DSH 设置页启动 OAuth、凭据显示已配置，并能完成登录后的请求 |
| `modelCatalog` | 设置页能看到目录，且会话模型选择器可选择 Codex 模型 |
| `textStream` | 收到非空文本 delta 和正常终止事件 |
| `reasoningStream` | reasoning block 可见且请求正常终止 |
| `terminalUsage` | 终态同时提供 input/output token usage |
| `toolRoundTrip` | 收到工具调用、执行安全测试工具、返回结果，并成功完成后续回复 |
| `replayContinuity` | 连续两轮请求成功，第二轮正确使用第一轮上下文 |
| `imageMaxPixels` | 原生图片输入成功，且实际请求投影了 `maxPixels=4194304` |
| `transportAuto` / `transportSse` / `transportWebsocket` | 每种 transport 至少完成一次真实请求 |
| `transportWebsocketCached` | 同一会话连续两轮请求均成功 |
| `fastPriority` | 请求了 priority、真实请求成功，并确认没有自动降级重放 |

每项记录只允许 `status`、`testedAt`、无查询参数的 HTTPS `evidenceUrl` 和门禁定义的布尔 `assertions`。证据不得包含 token、OAuth code、Cookie、账号标识或完整私人会话。

macOS/Linux：

```sh
DSH_BIN=/path/to/dsh pnpm run smoke:dsh-profile
```

Windows PowerShell：

```powershell
$env:DSH_BIN = "C:\path\to\dsh.exe"
pnpm run smoke:dsh-profile
```

发布前填写 Release 日期和 `testedCommit` 对应的验收提交，并清除全部占位词。工作流实际构建所用的 release commit 会写入隔离导入证据并作为附件上传。

## 产物门禁

发布工作流按以下顺序执行：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run verify:release
npm pack --ignore-scripts --json --pack-destination release
pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts
# 从最终 tarball 生成 SHA-256、SRI 与锁定参考 SBOM，并完成实际安装树、生产依赖审计和隔离导入取证
pnpm run verify:release:publish
```

只构建一次 `.tgz`，随后生成 SHA-256、SRI 和 CycloneDX SBOM。SRI 必须与 npm Registry 回读的 `dist.integrity` 完全相等，不接受只比较算法前缀或重新格式化后的值。

CycloneDX SBOM 是从已提交 `pnpm-lock.yaml` 与 package manifest 离线生成的**锁定参考依赖图**，用于证明候选源码所声明和锁定的依赖；它不冒充某次安装实际得到的完整依赖树。生成脚本只执行 `pnpm list --prod --json --depth Infinity --lockfile-only`，不会运行 `npm install`、`npm sbom` 或向 Registry 重新解析依赖。输出会去重并稳定排序，删除本机绝对路径和下载 URL，同时绑定 tarball SHA-256、lockfile SHA-256 与 package 依赖描述符 SHA-256，并校验 tarball 内 `package.json` 的包名、版本、许可、仓库和生产/peer 依赖描述符与仓库一致。

根目录 `pnpm-lock.yaml` 锁定插件的构建与发布依赖；`test/fixtures/dsh-runtime/pnpm-lock.yaml` 则锁定兼容性 smoke 使用的完整 DSH runtime 与 peer 图。CI、兼容性监测和发布候选都使用 `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts`，不会在运行时用 `npm install @deepseek-ai/dsh@...` 重新解算无界 peer 图。后者既可能造成内存失控，也会让相同源码随 Registry 状态得到不同运行时。

同一包体随后由夹具中的精确 `0.1.1-rc.2` DSH runtime 安装到隔离 profile 并启动 Web smoke，同时在空目录用 `--ignore-scripts` 安装并导入 Host。两次实际安装分别保存 `dsh-runtime-dependency-tree.json` 和 `isolated-dependency-tree.json`，与参考 SBOM 并列取证。Web/profile smoke 成功后才生成 `dsh-runtime-environment.json`，记录 DSH 版本、夹具 lock SHA-256、Node 完整版本、pnpm 版本、平台、架构和生命周期脚本禁用状态；严格门禁会根据发布提交重新计算并核对这些值。隔离安装还执行 `npm audit --omit=dev --audit-level=high --json` 并保存 `npm-audit.json`；出现 high 或 critical 生产依赖漏洞会阻止发布。候选 job 只有 `contents: read` 权限，候选产物与证据保留 90 天；只有 `publish=true`、`refs/heads/main` 且通过 `npm-release` 受保护 environment 审批后，发布 job 才获得 `contents: write` 与 `id-token: write`。

冻结夹具使用 `--ignore-scripts`，因此该层只证明 DSH Web/profile 与本插件的兼容性，不声称验证 DSH 依赖中需要生命周期脚本的原生终端或本机构建能力。

升级 DSH、pi-ai 或其他运行依赖时，必须更新并审查两套 lockfile，确认夹具仍只固定目标 DSH 版本，再重跑完整跨平台 CI、profile smoke 与受控真实验收。定时 Registry 漂移报告不能替代这条升级流程。

## 发布环境

在 GitHub 仓库的 **Settings → Environments** 创建 `npm-release`：

1. 配置至少一名 required reviewer；
2. deployment branches 只允许 `main`；
3. 不添加普通仓库级 npm token；只有首次发布引导期间，才临时添加 environment secret `NPM_BOOTSTRAP_TOKEN`；
4. 发布人手工触发工作流，并在核对版本、提交和候选 job 后审批 environment。

发布工作流固定使用 npm `11.16.0`，在任何网络写入前精确校验并记录版本。Trusted Publishing 最低需要 npm CLI `11.5.1`，`--include-attestations` 至少需要 `11.12.0`；升级 npm 时必须更新固定版本、测试和发布说明。

先运行只读候选流程：

```sh
gh workflow run release.yml --ref main \
  -f version=0.0.1 \
  -f publish=false
```

`--ref main` 是硬门禁；从其他分支触发时 candidate 会明确失败，不会以全部 job 被跳过的方式显示成功。下载并核对候选附件、完成真实验收、更新允许的发布证据文件并合并到 `main` 后，再开始发布。

## 首次发布 `0.0.1`

npm 只允许给**已经存在**的包配置 Trusted Publisher，因此新包第一次发布需要一次性引导。该例外只适用于 `dsh-codex-community@0.0.1` 且 Registry 中尚不存在这个包；工作流会同时检查版本、包名状态和精确候选产物，条件不满足就失败。

1. 在 npm 网页创建最短有效期的 Granular Access Token：Packages and scopes 设为 **Read and write**，选择 **All packages**，开启 **Bypass 2FA**。新包尚不存在，无法把 token 限定到该包；因此必须使用最短有效期，并在成功后立即撤销；
2. 只把 token 粘贴到 GitHub `npm-release` environment 的 secret `NPM_BOOTSTRAP_TOKEN`。不要写入仓库、终端历史、Issue、Release 证据或聊天；
3. 确认严格门禁已通过后触发一次性发布：

   ```sh
   gh workflow run release.yml --ref main \
     -f version=0.0.1 \
     -f publish=true
   ```

4. 审批 `npm-release` environment。工作流只在实际需要写入不存在的 `0.0.1` 时把该 secret 注入 `npm publish`，并在 GitHub 托管 runner 上生成 provenance；
5. npm 包出现后，在包的 **Settings → Trusted Publisher** 中填写：Provider `GitHub Actions`、owner `yoshino-xiao7`、repository `dsh-codex`、workflow filename `release.yml`、environment `npm-release`、allowed action `npm publish`；
6. 撤销 npm token，并删除 GitHub environment secret：

   ```sh
   gh secret delete NPM_BOOTSTRAP_TOKEN --env npm-release
   ```

7. 在包的 **Settings → Publishing access** 选择 **Require two-factor authentication and disallow tokens**，再验证 Trusted Publisher 配置；
8. 后续版本由工作流自动选择 Trusted Publisher。Registry 中包名不存在时，只有 `0.0.1` 可以进入一次性引导；包名已存在时不会读取 bootstrap secret；如果 `0.0.1` 已经存在且包体与候选逐字节一致，重跑只恢复后续 Release 步骤，不再需要 token。

首次引导依据 npm 的 [Trusted Publisher 限制](https://docs.npmjs.com/trusted-publishers/)、[2FA 与 Granular Access Token 要求](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)和[GitHub Actions provenance 要求](https://docs.npmjs.com/generating-provenance-statements/)设计。

## 常规发布

Trusted Publisher 配置完成后，所有版本使用：

```sh
gh workflow run release.yml --ref main \
  -f version=0.0.2 \
  -f publish=true
```

- `publish=false` 只生成并验证候选产物；`publish=true` 才启用严格门禁、Registry 写入和双语 GitHub Release；
- 常规发布只使用 GitHub OIDC，不读取 token；
- npm 发布成功后回读 `repository.url`、`dist.integrity` 和 provenance，要求 `dist.integrity` 与候选 `.sri` 逐字符一致；
- 在全新目录安装精确 Registry 版本并执行 `npm audit signatures --json --include-attestations`；签名或 attestation 校验失败会阻止公开 Release，原始 provenance bundle 与审计结果随 Release 保存；
- 从 Registry 重新下载 tarball，验证其与工作流产生的 `.tgz` 逐字节一致；
- 若 npm 已存在同版本，工作流会先下载并逐字节比较：完全一致则跳过 `npm publish` 并继续恢复 Release，不一致则立即失败；
- GitHub Release 先保持 draft；工作流用 `--clobber` 恢复上传全部附件，从 Release 回下载后逐字节比较，只有附件集合和内容全部匹配才公开；已公开版本重跑时只接受 tag commit 和全部附件与候选产物一致；
- 不从本地开发机直接创建 tag 或发布包。

任何一步失败都停止，绝不覆盖 npm 的不可变版本。若 Registry 中的包体与候选逐字节一致，可以安全恢复后续步骤；若包体不同，修复后必须递增版本。候选 job 已成功而 publish job 失败时，只在同一 workflow run 中重跑失败的 job，不重跑已经成功的候选 job：恢复过程继续使用原始 `GITHUB_SHA` 与保留 90 天的已上传候选，即使 `main` 后来前进也不会改用新源码；新 workflow run 则从当时的 `main` 重新构建。
