# 更新日志 / Changelog

本项目遵循 Keep a Changelog 的结构；`0.0.x` 为技术预览。
This project follows the Keep a Changelog structure; `0.0.x` is a technical preview.

## [0.0.4] - 2026-08-30

### 中文

#### 新增

- 会话输入区新增独立的传输方式按钮，以图形菜单选择自动、SSE、WebSocket 或 WebSocket 缓存；支持键盘导航、焦点退出、恢复自动以及中英文提示，并与 `/codex set transport` 共用当前会话状态。
- 设置页新增默认折叠的连接诊断，可按需执行完全离线的本机检查或只读取账号额度的账号检查；两种检查均不发送模型请求或消耗模型额度，报告只包含固定状态码和受限事实。
- Host 新增不可变的模型能力描述接口，统一提供 provider catalog 的名称、上下文、最大输出、输入模态以及逐模型核验的推理档位与 Fast 支持。

#### 修复

- Web 客户端不再维护 Fast 支持模型的硬编码副本，模型切换后直接向 Host 查询当前模型能力，避免目录升级后前后端能力漂移。
- Transport 不再只能通过命令修改；会话输入区能够读取并展示真实当前值，写入失败时可安全重试，进程重启后仍按既有合同恢复自动。
- 诊断 RPC 与授权 RPC 分离并限制为 loopback；凭据、account ID、原始响应、请求头和原始错误不会进入浏览器报告。

### English

#### Added

- The conversation composer now has a dedicated transport button with a graphical menu for Auto, SSE, WebSocket, or cached WebSocket. It supports keyboard navigation, focus dismissal, reset-to-Auto, bilingual copy, and the same current-session state as `/codex set transport`.
- Settings now provides collapsed, on-demand connection diagnostics: a fully offline local check and an account check limited to reading usage. Neither sends a model request nor consumes model usage, and reports contain only fixed codes and bounded facts.
- The Host now exposes an immutable model-capability descriptor that combines provider-catalog names, context, maximum output, and input modalities with model-specific verified reasoning levels and Fast support.

#### Fixed

- The Web client no longer carries a hard-coded duplicate list of Fast-capable models. It queries the Host after model changes, preventing capability drift when catalogs evolve.
- Transport is no longer command-only. The conversation control reads and displays the actual current value, safely retries failed writes, and preserves the existing reset-to-Auto-on-restart contract.
- Diagnostics use a loopback-only RPC isolated from authorization. Credentials, account IDs, raw responses, headers, and raw errors never enter browser reports.

## [0.0.3] - 2026-08-29

### 中文

#### 新增

- OpenAI Codex 设置入口改用独立的代码括号图标，与其他 Provider 插件保持可辨识的视觉差异。
- 额度卡新增带图标的刷新按钮、刷新中状态、响应式双列布局和更清晰的剩余额度层级；五小时额度始终显示精确重置时间，每周额度在不足 24 小时时显示精确时间，其余时间显示相对天数，完整时间保留在提示与无障碍标签中。
- 模型设置按“已选择在前、未选择在后”排序；未选择模型默认收起并可按需展开，同时显示已选择、当前显示与总数摘要。

#### 修复

- 缩短设置页内容高度并避免插件覆盖 Harness 弹窗宽度或滚动容器，改善窄屏与较矮窗口中的滚动体验。
- 模型能力改为与 Grok Build 一致的紧凑标签，使用 `272K`、`128K` 一类上下文与最大输出表示，不推测 provider catalog 未提供的能力。
- 在收起未选择模型时取消勾选，键盘焦点会回到展开按钮，避免焦点停留在隐藏元素；重置时间解析也会拒绝无法构造有效日期的值。

### English

#### Added

- The OpenAI Codex settings entry now uses a dedicated code-brackets icon that remains visually distinct from other provider plugins.
- Usage cards now provide an icon button with a refreshing state, a responsive two-column layout, and a clearer remaining-usage hierarchy. Five-hour limits always show the exact reset time; weekly limits show the exact time within 24 hours and otherwise use relative days, while the complete timestamp remains available in tooltips and accessible labels.
- Model settings now sort selected models before unselected models. Unselected models are collapsed by default and can be expanded on demand, with selected, visible, and total counts shown in the summary.

#### Fixed

- The settings content is shorter and no longer overrides the Harness dialog width or scroll container, improving scrolling in narrow or low-height windows.
- Model capabilities use compact Grok Build-style labels such as `272K` and `128K` for context and maximum output, without inferring capabilities absent from the provider catalog.
- Deselecting a model while unselected entries are collapsed returns keyboard focus to the expansion control instead of leaving it on a hidden element; reset-time parsing also rejects values that cannot produce a valid date.

## [0.0.2] - 2026-08-29

### 中文

#### 新增

- 设置页每次进入以及手动刷新时读取真实的五小时与每周额度；Host 通过官方 Codex 客户端使用的 Web 后端兼容接口获取并严格解析数据，Web 页面不会收到 OAuth 凭据或原始响应。
- 会话模型选择器左侧新增闪电按钮，与 `/codex set fast on|off` 共用当前会话状态；GPT-5.4、GPT-5.5 和 GPT-5.6 系列可从下一次请求起切换官方 Fast 1.5 倍速。

#### 变更

- 额度刷新失败时不再伪装成零余额：保留最近一次已验证读数，或安全降级为最近请求观测/未知状态。
- 模型展示元数据以当前安装的 provider catalog 为准；推理选择器改用逐模型核验的订阅 Codex 默认值与 Low 至 Max，隐藏通用 `Default`、`Off`、`Minimal`，且不把需要主动任务委派的 `Ultra` 伪装成普通 Provider 档位。
- 模型卡片的上下文与最大输出改用 `272K`、`128K` 一类紧凑标签，不再展示冗长的原始 token 数字。
- 保存了 `Off` 或 `Minimal` 的旧会话不再被静默迁移；只有用户点击带有默认模型影响说明的修复按钮后，才切换到当前模型默认档位。
- Fast 仅在支持的 GPT-5.4、GPT-5.5 和 GPT-5.6 系列请求上发送 priority service tier，会消耗更多额度；关闭或开启均从下一次请求生效，进程重启后恢复关闭。
- DSH profile smoke 改为核对新版模型设置标题，避免 UI 文案更新被误判为插件加载失败。

### English

#### Added

- The settings page reads real five-hour and weekly usage limits whenever it opens or is refreshed manually. The Host obtains and strictly parses the data through the Web-backend compatibility endpoint used by the official Codex client; the Web page receives neither OAuth credentials nor raw responses.
- A lightning button to the left of the conversation model selector shares current-session state with `/codex set fast on|off`. GPT-5.4, GPT-5.5, and the GPT-5.6 family can switch to official Fast at 1.5× starting with the next request.

#### Changed

- A failed usage refresh is no longer presented as zero remaining usage. The page retains the latest verified reading or safely falls back to recent-request observation/an unknown state.
- Display metadata follows the installed provider catalog. The reasoning picker now uses model-specific subscription-Codex defaults and efforts from Low through Max, hides generic `Default`, `Off`, and `Minimal`, and does not disguise agent-level `Ultra` as a plain Provider effort.
- Model cards format context and maximum output as compact labels such as `272K` and `128K` instead of long raw token counts.
- Older conversations that saved `Off` or `Minimal` are no longer migrated silently. They switch to the current model default only after the user clicks a repair action that discloses its default-model effect.
- Fast sends the priority service tier only for supported GPT-5.4, GPT-5.5, and GPT-5.6-family requests and consumes more usage. Enabling or disabling it applies to the next request, and a process restart restores off.
- The DSH profile smoke now checks the current model-settings title so a UI copy update is not misreported as a plugin-load failure.

## [0.0.1] - 2026-08-29

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
- 发布候选生成双语审批摘要，并在受保护环境审批前后各执行一次严格门禁；npm Trusted Publisher/OIDC 与 GitHub Release 写权限分属独立 job，Registry 回读证据通过不可变 Actions artifact 交接。
- `0.0.1` 使用 npm `latest` 与正式 GitHub Release；发布前三平台 CI/profile smoke 必须 `3/3` 通过，供应链证据必须完整且必须经维护者批准。真实账号验证允许以 `0/13` 如实发布并在发布后持续记录；发现的问题进入 `0.0.2` 迭代。
- 不发布、不读取凭据的 `pnpm run release:candidate -- 0.0.1` 本地/CI 候选复演：要求干净提交与 Node 24、pnpm `10.34.5`、npm `11.16.0`，精确执行 frozen install、完整检查、仅一次生成候选 tarball、dry-run、SBOM、DSH profile smoke、隔离导入和生产依赖 audit，写入 `release/`，已有输出时在写前失败。普通 CI 的独立只读 Ubuntu/Node 24 `candidate-replay` job 动态读取版本后调用该命令一次，并把完整证据上传为保留 14 天的 `dsh-codex-community-${{ github.sha }}-ci-replay` artifact；权威候选仍由 `main` 发布 workflow 生成，该复演不替代三平台 CI/profile smoke、真实账号验收或审批。
- 幂等且离线的 `release:prepare` 命令，用于生成下一版本的双语 CHANGELOG/Release 草稿和全新 schema v3 验收记录；它会保护人工内容、在冲突发生时写入前失败，并拒绝受管文件或父目录符号链接。
- 不联网、不读取凭据的 `release:acceptance` 离线证据记录器；新增 `pass-platform <linux|macos|windows>`，只记录维护者已核验的 CI/profile smoke，不检查提交是否存在；平台与真实网络证据必须绑定同一候选 SHA，已通过项只允许相同证据的幂等重放，不能覆盖不同证据；真实检查只有明确列齐固定断言才记录通过，`status` 不显示证据值，提交存在性/祖先关系仍由严格门禁验证，审批仍由维护者人工作出。
- draft 专用的离线 `pnpm run release:acceptance -- reset-candidate --from-commit=<旧SHA> --to-commit=<新SHA>`：源码变化后清空全部旧平台/live 证据与审批并绑定新候选，再运行新 CI/profile smoke 并用 `pass-platform` 记录；它不检查提交存在性，通过受管路径检查、写锁和原子替换安全写入，拒绝重置 approved 记录，并把 fresh 状态下同一命令的重放保持为 `unchanged`。

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
- Windows DSH profile smoke 结束后短暂的目录锁可能让临时目录清理报 `EBUSY`，并由 `finally` 覆盖真正的 smoke 失败；清理现在有限重试，若 smoke 与清理同时失败则保留两个错误。
- 模型可选字段的显式 `null` 与非有限流空闲超时可能穿过基础 Schema；配置现在会在适配器 profile 与设置保存边界拒绝这些不可服务值。
- 发布候选过早获得写权限、可变 Action 引用、未 smoke 精确候选、把参考 SBOM 当成实际安装树、缺少生产依赖高危审计、exact SRI 与签名/attestation 校验、GitHub Release 资产未回读、draft/tag 目标未在公开前验证和重复发布恢复不完整；直接依赖声明、贡献许可、双语隐私模板和协调依赖升级新增本地门禁，候选证据保留 90 天，并支持只重跑失败 job。
- 发布阶段曾在同一 job 同时持有 npm OIDC 与 GitHub contents 写权限、provenance 未绑定候选仓库/工作流/ref/源码提交，且 Release 转为公开后缺少最终全量回读；现已拆分权限，逐项绑定来源，并在公开动作后重新校验标题、正文、标签、资产与字节摘要。
- GitHub Actions 审核门禁现在逐条校验每个 `uses:` 是否属于明确审核的完整提交 allowlist，避免新增未审核 Action 借用其他位置的已审核 SHA 通过测试。
- 发布工作流从错误分支触发时不再静默跳过；首次 `0.0.1` 根据 Registry 状态自动进入受限引导，后续版本自动使用 OIDC。候选会用固定 npm 对 `./` 本地 tarball 做 dry-run，发布后按 npm 11 的 `attestationBundles` 结构验证 SLSA provenance，并绑定包摘要、仓库、发布工作流、`main` ref 与候选源码提交；所有 Actions 已更新到审核过的 Node 24 版本。

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
- Release candidates produce a bilingual approval summary and run the strict gate both before and after protected-environment approval. npm Trusted Publisher/OIDC and GitHub Release write access live in separate jobs, with Registry readback evidence handed off through an immutable Actions artifact.
- `0.0.1` uses npm `latest` and a full GitHub Release. Before publication, all three CI/profile-smoke platform gates must pass, supply-chain evidence must be complete, and a maintainer must approve the release. Controlled-account validation may be disclosed at `0/13` and continue after release; findings are iterated in `0.0.2`.
- A non-publishing, credential-free `pnpm run release:candidate -- 0.0.1` local/CI replay requires a clean committed checkout plus Node 24, pnpm `10.34.5`, and npm `11.16.0`. It performs frozen installs, the complete checks, exactly one artifact-producing pack, dry-run, SBOM, DSH profile smoke, isolated import, and production-dependency audit into `release/`, failing before any write when output already exists. Regular CI's separate read-only Ubuntu/Node 24 `candidate-replay` job reads the version dynamically, invokes the command once, and uploads the complete evidence as the 14-day `dsh-codex-community-${{ github.sha }}-ci-replay` artifact. The authoritative candidate still comes from the release workflow on `main`; this replay does not replace three-platform CI/profile smoke, live-account acceptance, or approval.
- An idempotent offline `release:prepare` command that creates the next bilingual CHANGELOG/Release drafts and a fresh schema-v3 acceptance record, preserves human-authored content, fails before writing on conflicts, and rejects managed-file or parent-directory symlinks.
- An offline `release:acceptance` evidence recorder that neither accesses the network nor reads credentials, now with `pass-platform <linux|macos|windows>` to record only maintainer-verified CI/profile smoke without checking that the commit exists. Platform and live-network evidence must bind to one candidate SHA; a passed item permits only an idempotent replay of identical evidence and cannot be overwritten with different evidence. Live checks pass only when every fixed assertion is explicitly listed, `status` hides evidence values, the strict gate still checks commit existence/ancestry, and approval remains a maintainer decision.
- A draft-only offline `pnpm run release:acceptance -- reset-candidate --from-commit=<old-SHA> --to-commit=<new-SHA>` command that clears all old platform/live evidence and approval fields after source changes, binds the new candidate, and precedes new CI/profile smoke recorded with `pass-platform`. It does not check commit existence, writes safely through managed-path checks, a write lock, and atomic replacement, rejects approved records, and keeps a replay of the same command against fresh state `unchanged`.

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
- A transient Windows directory lock after DSH profile smoke could make temporary cleanup fail with `EBUSY`, while `finally` masked the real smoke failure. Cleanup now retries within a fixed bound and preserves both errors when smoke and cleanup fail together.
- Explicit `null` model overrides and non-finite stream idle timeouts could pass the basic Schema. Configuration now rejects these unserviceable values at the adapter-profile and settings-save boundaries.
- Release candidates receiving write permission too early, mutable Action references, a missing exact-candidate smoke, reference SBOMs being treated as actual install trees, missing high-severity production-dependency audit, exact SRI and signature/attestation checks, missing GitHub asset readback, missing pre-publication draft/tag target verification, and incomplete recovery after a partial publication. Local gates now cover direct-dependency notices, contribution licensing, bilingual privacy templates, and coordinated dependency updates. Candidate evidence is retained for 90 days and supports rerunning only failed jobs.
- A publication job previously held npm OIDC and GitHub contents write access together, provenance was not bound to the candidate repository/workflow/ref/source commit, and a Release lacked a final full readback after becoming public. Permissions are now split, every source field is bound, and the public title, body, tag, assets, and byte digests are revalidated after publication.
- The GitHub Actions review gate now checks every `uses:` entry against an explicit allowlist of reviewed full commits, preventing an unreviewed Action from passing merely because a reviewed SHA appears elsewhere.
- A release dispatch from the wrong branch now fails instead of silently skipping. The first `0.0.1` automatically enters a Registry-state-gated bootstrap, while later versions automatically use OIDC. The candidate dry-runs the `./` local tarball with the pinned npm; post-publication checks use npm 11's `attestationBundles` shape for SLSA provenance and bind the package digest, repository, release workflow, `main` ref, and candidate source commit. Every Action is pinned to a reviewed Node 24 release.
