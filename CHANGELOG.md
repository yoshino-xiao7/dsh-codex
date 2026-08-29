# 更新日志 / Changelog

本项目遵循 Keep a Changelog 的结构；`0.0.x` 为技术预览。
This project follows the Keep a Changelog structure; `0.0.x` is a technical preview.

## [0.0.1] - Unreleased

### 中文

#### 新增

- `dsh-codex` route、Host 插件和 Web 登录页。
- 与同一 profile 中其他 pi-ai provider 共存，不改写通用 `llm-pi-ai` 配置。
- 插件专用的设置命名空间与 OAuth 凭据范围，只接受 ChatGPT OAuth。
- Codex 模型启用管理、最近额度观测卡，以及 `/codex-login` 和 `/codex-usage` 命令。
- `/codex` 当前会话偏好：Fast 开关和 `auto`、SSE、WebSocket 传输选择。
- pi-ai Codex 模型目录、流式内容、reasoning、工具、图片和 replay 接线。
- 安全 HTTP(S) 图片读取、图片预算、2 个活动任务与 32 个排队任务的有界调度、账户配额规范化与半段回复恢复模块。
- 带 `dsh-codex:` 命名空间的 transport/cache session，以及 reset、agent dispose 和 runtime dispose 的精确资源清理。
- 中英文 Web 设置页的操作互斥、卸载安全、长文本换行与 320 像素窄屏布局。
- 覆盖单元、SDK 合同、真实 attachment seam、真实 DSH `LlmRuntime` waterfall、Web client 与 Host 加载的测试套件。
- 冻结的 DSH 兼容性 smoke 运行时夹具，提交独立 `pnpm-lock.yaml` 并在 CI、兼容性监测与发布候选中使用 `--frozen-lockfile --ignore-scripts` 安装。
- 发布候选在 Web/profile smoke 成功后记录 DSH 版本、夹具 lock SHA-256、Node、pnpm、平台、架构与生命周期脚本状态，并由严格门禁重新验证。
- 中英文文档、社区治理、Issue/PR、跨平台 CI，以及最小权限、SHA 固定、离线确定性 SBOM 和可恢复重跑的发布流程。

#### 修复

- `Image request maxPixels must be a positive integer.`
- `AccountQuotaExceeded` 被误判为可重试 `RATE_LIMIT`，直接抛出的配额错误绕过恢复层，DSH canonical `QUOTA` 绕过脱敏输出，无结构证据的通用 429 被误报为已确认账户配额，以及 request metadata/其他 JSON envelope 污染 provider 配额事实；只有 canonical `QUOTA`、顶层或一个自身匹配的 `error` envelope 可以确认账户配额和提供 reset/request ID/status，其他通用 429 使用非重试 `QUOTA_OR_RATE_LIMIT`。
- `STREAM_CLOSED`、WebSocket 中断、直接抛错或缺少终止 chunk 的 EOF 导致半段回复丢失，或在已产生可见输出/工具调用后整次重放造成重复内容和工具副作用；纯工具流现在也失败关闭，`onRecovery` 观察者异常被隔离，不再破坏恢复文本、提示与终态。
- OAuth 取消后的补偿删除可能误删另一 DSH 进程已排队的新登录；取消现在以串行 mutate 回调为线性化点，提交阶段由无凭据 generation tracker 阻止误报取消，退出仍通过同一记录锁保证最终状态；真实 Cordis flow owner 卸载会在提交选择前取消，或在提交选择后等待最终写入完成。
- 已结束的保留 attempt 误取消新登录、排队图片取消后仍开始持久化、插件卸载后仍启动排队图片、模型能力预检在限流器外绕过活动/排队上限，以及保存阶段取消仍向调用方返回成功。
- 不支持类型或结构损坏的已存 OAuth 记录被显示为已登录；现在会返回独立的 `invalid` 状态，且凭据 secret 不跨 RPC。
- Web 登录操作竞态、异步完成后更新已卸载组件、热重载后残留旧样式节点，以及窄屏设置页横向溢出。
- CI 与发布 smoke 直接通过 npm 解算 DSH peer 图可能产生不确定依赖结果和内存失控；现在只安装已提交的冻结 pnpm 运行时图，并要求依赖升级同步更新两套 lockfile 后重跑 CI 与验收。
- 跨平台维护门禁在 Linux 区分 PR 模板文件名大小写、在 Windows 误判 CRLF 工作流文本并无法可靠启动 `pnpm.cmd` 或 npm 打包检查；模板路径、换行读取与包管理器调用现已跨平台一致。
- 模型可选字段的显式 `null` 与非有限流空闲超时可能穿过基础 Schema；配置现在会在适配器 profile 与设置保存边界拒绝这些不可服务值。
- 发布候选过早获得写权限、可变 Action 引用、未 smoke 精确候选、把参考 SBOM 当成实际安装树、缺少生产依赖高危审计、exact SRI 与签名/attestation 校验、GitHub Release 资产未回读、draft/tag 目标未在公开前验证和重复发布恢复不完整；直接依赖声明、贡献许可、双语隐私模板和协调依赖升级新增本地门禁，候选证据保留 90 天，并支持只重跑失败 job。
- GitHub Actions 审核门禁现在逐条校验每个 `uses:` 是否属于明确审核的完整提交 allowlist，避免新增未审核 Action 借用其他位置的已审核 SHA 通过测试。

### English

#### Added

- A `dsh-codex` route, Host plugin, and Web sign-in page.
- Coexistence with other pi-ai providers in the same profile without rewriting the general `llm-pi-ai` configuration.
- A plugin-scoped settings namespace and OAuth credential scope that accepts ChatGPT OAuth only.
- Codex model enablement, a recent quota-observation card, and `/codex-login` and `/codex-usage` commands.
- Per-session `/codex` preferences for Fast and `auto`, SSE, or WebSocket transport.
- pi-ai Codex catalog, streaming content, reasoning, tools, images, and replay wiring.
- Safe HTTP(S) image reading, image policy, bounded scheduling with two active and 32 queued jobs, account-quota normalization, and partial-response recovery modules.
- `dsh-codex:`-namespaced transport/cache sessions with exact cleanup on reset, agent disposal, and runtime disposal.
- Mutually exclusive actions, unmount safety, long-text wrapping, and a 320-pixel narrow-screen layout in the Chinese and English Web settings page.
- A test suite covering units, SDK contracts, the real attachment seam, the real DSH `LlmRuntime` waterfall, the Web client, and Host loading.
- A frozen DSH compatibility-smoke runtime fixture with its own committed `pnpm-lock.yaml`, installed through `--frozen-lockfile --ignore-scripts` in CI, compatibility monitoring, and release candidates.
- Release candidates record the DSH version, fixture-lock SHA-256, Node, pnpm, platform, architecture, and lifecycle-script state only after Web/profile smoke succeeds, and the strict gate re-verifies them.
- Chinese and English documentation, governance, issue/PR templates, cross-platform CI, and a least-privilege release flow with pinned Actions, an offline deterministic SBOM, and recoverable reruns.

#### Fixed

- `Image request maxPixels must be a positive integer.`
- `AccountQuotaExceeded` being mistaken for retryable `RATE_LIMIT`, directly thrown quota bypassing recovery, canonical DSH `QUOTA` bypassing sanitized output, generic 429 text without structured evidence being mislabeled as confirmed account quota, and request metadata/another JSON envelope contaminating provider quota facts. Only canonical `QUOTA`, the top level, or one independently matching `error` envelope can confirm quota and provide reset/request ID/status; other generic 429 failures use non-retryable `QUOTA_OR_RATE_LIMIT`.
- Lost partial responses after `STREAM_CLOSED`, WebSocket interruption, a direct throw, or EOF without a terminal chunk, plus full-request replay after visible output or a tool call that could duplicate content or tool side effects. Tool-only streams now fail closed, and exceptions from the `onRecovery` observer cannot break recovered text, the notice, or the terminal event.
- A compensating delete after OAuth cancellation could erase a newer sign-in already queued by another DSH process; cancellation now linearizes at the serialized mutate callback, a credential-free generation tracker prevents a commit from being misreported as cancelled, and sign-out still establishes its final state through the same record lock. Real Cordis flow-owner disposal now cancels before commit selection or waits for the final write after selection.
- A retained completed attempt cancelling a newer sign-in, a cancelled or post-disposal queued image starting persistence, model-capability preflight bypassing active/queued bounds outside the limiter, and persistence-stage cancellation still returning success.
- Unsupported or malformed stored OAuth records being presented as signed in; they now produce a distinct `invalid` state, and credential secrets never cross RPC.
- Web sign-in action races, state updates after unmount, stale style nodes after hot reload, and horizontal overflow in narrow settings dialogs.
- CI and release smoke resolving the DSH peer graph directly through npm, which could produce nondeterministic dependency results and uncontrolled memory use. They now install only the committed frozen pnpm runtime graph, and dependency upgrades must update both lockfiles before CI and acceptance are repeated.
- Cross-platform maintenance gates failing on Linux due to pull-request-template filename casing, and on Windows due to CRLF-sensitive workflow assertions or unreliable direct spawning of `pnpm.cmd` and the npm pack check. Template paths, text normalization, and package-manager invocation are now portable.
- Explicit `null` model overrides and non-finite stream idle timeouts could pass the basic Schema. Configuration now rejects these unserviceable values at the adapter-profile and settings-save boundaries.
- Release candidates receiving write permission too early, mutable Action references, a missing exact-candidate smoke, reference SBOMs being treated as actual install trees, missing high-severity production-dependency audit, exact SRI and signature/attestation checks, missing GitHub asset readback, missing pre-publication draft/tag target verification, and incomplete recovery after a partial publication. Local gates now cover direct-dependency notices, contribution licensing, bilingual privacy templates, and coordinated dependency updates. Candidate evidence is retained for 90 days and supports rerunning only failed jobs.
- The GitHub Actions review gate now checks every `uses:` entry against an explicit allowlist of reviewed full commits, preventing an unreviewed Action from passing merely because a reviewed SHA appears elsewhere.
