# 测试策略

[简体中文](testing.md) | [English](testing.en.md)

## 本地门禁

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run verify:release
```

`pnpm run check` 依次执行语法与导入边界扫描、公开声明的严格 TypeScript 消费检查、全部测试、构建、中英文配对检查和 npm pack 白名单检查。全部测试包含真实冻结 DSH AgentLoop/Retry 编排，因此本地、CI、兼容性监测和发布候选都必须先安装已提交的 DSH 运行时夹具。

根目录 `pnpm-lock.yaml` 与夹具的 `test/fixtures/dsh-runtime/pnpm-lock.yaml` 必须同时保持受审查状态。升级 DSH、pi-ai 或其他运行依赖时要更新两套 lockfile，在发布前重新运行完整 CI、profile smoke 与供应链校验，正式发布后再重新开始受控真实验证。

夹具禁用生命周期脚本，因此这一级只验证 DSH Web/profile 与插件集成，不代表已验证 DSH 依赖中需要安装脚本的原生终端或本机构建能力。

### 普通 CI 候选复演

普通 CI 另设只读的 `candidate-replay` Ubuntu/Node 24 job。它从干净 checkout 安装固定 pnpm `10.34.5` 和 npm `11.16.0`，动态读取 `package.json` 版本，随后仅调用一次 `pnpm run release:candidate -- <version>`；完整 `release/` 以 `dsh-codex-community-${{ github.sha }}-ci-replay` artifact 上传并保留 14 天。该 job 不发布、不读取凭据，也不是 `main` 上 `release.yml` 生成的权威发布候选；它不能替代三平台 CI/profile smoke、完整供应链门禁或维护者审批，也不执行发布后的真实账号验证。

## 故障回归

- `failure-normalizer.test.mjs`：精确的 `AccountQuotaExceeded`、DSH canonical `QUOTA`、五小时 reset、request ID、普通/不确定 429、窄化 transport 与敏感字段不回显；嵌套 request metadata 和其他独立 JSON envelope 不得冒充或向命中的 provider `error` envelope 注入配额事实，canonical `QUOTA` 仍可从一个自身匹配的 envelope 保留合法 reset/request ID；
- `image-policy.test.mjs`：完整默认值与所有非法数字；
- `stream-resilience.test.mjs`：半段纯文本保存、pre-output quota、瞬时/不确定 429、直接抛出的 quota/usage-limit/`STREAM_CLOSED`、未完成工具调用、纯工具流失败关闭与非 Codex route；`onRecovery` 观察者自身抛错时也不能破坏已恢复的文本、恢复提示或正常终态；
- `provider-reliability-public-api.test.mjs`：公开 pi-ai → PiAiAdapter → route → resilience 的成功文本/reasoning/usage、工具调用与两轮 replay、原生图片预算、text-only 图片拒绝、429、`STREAM_CLOSED` 与 WebSocket failure 链路；
- `llm-runtime-integration.test.mjs`：真实冻结 DSH `LlmRuntime + AgentLoop + Retry` 编排证明瞬时 `RATE_LIMIT` 发生一次重试，而归一化后的 `QUOTA` 与 `QUOTA_OR_RATE_LIMIT` 都只调用 provider 一次；同时验证 waterfall 在恢复策略读取结果前发布非重试 `QUOTA`；
- `codex-session-resources.test.mjs`：命名空间与有界 transport generation、双 manager 热替换的 epoch 隔离、未知 session dispose 隔离、真实 WebSocket→SSE fallback rollover、继承默认值与显式覆盖隔离、在途 `next`/`return`/error/result 竞态、reset/agent/runtime 延迟清理、当前 generation 的脱敏传输健康，以及同进程外部 pi-ai session 隔离；
- `sdk-contract.test.mjs`：真实 pi-ai OAuth/模型目录、DSH profile schema，以及 PNG 穿过真实 attachment seam；
- `bundle-contract.test.mjs`：bundle 保留通用 `llm-pi-ai` 配置、插入 `dsh-codex`，且图片预算完整；
- `codex-route-adapter.test.mjs`：外部 `dsh-codex` route 与内部 canonical provider 的映射、replay 和 tool-call ID；
- `codex-provider-runtime.test.mjs`：专用 route、设置热更新、模型筛选、四项持久化全局默认值的动态同步、全局 Transport 变更时仅 rollover 继承默认值的 generation、显式覆盖隔离与同 profile 共存；
- `codex-model-capabilities.test.mjs`：目录字段白名单投影、不可变能力快照、逐模型推理/Fast 控件与未知模型不推断；
- `codex-model-capability-bridge.test.mjs`：独立 loopback-only 只读 RPC、只接受空对象的 `get`、取消、内部错误脱敏、能力白名单与未知模型不推断；
- `codex-connection-diagnostics.test.mjs`：本机模式零账号读取、账号模式恰好一次额度读取、主动网络模式的短期单次同意与不可重放、30 秒前置 deadline 的取消/内部超时区分及未进入 probe、最多 20 条的进程内脱敏历史、清空、固定失败分类、loopback-only RPC 与 token/account ID/请求 ID/提示/输出/原始错误不泄漏；
- `codex-network-probe.test.mjs`：恪守一次请求、SSE、Fast 关闭、无工具、无会话历史且不注入私有输出上限的 SDK 请求形状；首次非空可见文本后立即 teardown；发送前/发送后取消、空响应与硬超时分类；`INVALID_REQUEST`、`PI_AI_ERROR`、`UNKNOWN_MODEL`、`MISSING_CREDENTIAL` 的固定脱敏分类；真实 Provider→PiAiAdapter→Route→Probe 链路在 mock HTTP 边界下的 200、`response.incomplete`、400；跨模块重新求值的进程级隔离；以及仅在旧 `next()` 收敛、`return()` 成功返回 `{ done: true }` 和临时清理成功后放行。缺失、不完整、拒绝或 getter 抛错的 teardown 与 remove/reset 清理失败都会 fail closed；
- `authorization-commit-tracker.test.mjs`、`authorization-commit-integration.test.mjs`、`codex-credential-store.test.mjs` 与 `codex-authorization.test.mjs`：专用 OAuth 范围、串行 refresh、非法记录失败关闭、登录事件脱敏、generation 隔离和取消线性化点；真实 Cordis `AuthorizationService + Bridge` 回归还验证 flow owner 卸载在提交选择前取消、提交选择后等待最终写入、提交失败后释放、退出最终删除，以及一个进程取消时不会删除另一进程已排队的新登录；
- `oauth-refresh-logout-race.test.mjs`：使用公开 PiAiAdapter 请求链验证 refresh/delete 锁顺序，保证退出登录后凭据不会复活；
- `codex-pi-provider.test.mjs`：默认 payload、当前会话 Fast、transport、回复详略、推理摘要和不自动降级；并拦截实际 SSE 请求体，证明真实诊断保持已发布 Codex SDK 的 wire schema，不注入 `max_output_tokens`，且普通请求不受影响；
- `session-preferences.test.mjs`、`session-preference-command.test.mjs` 与 `session-preference-bridge.test.mjs`：当前会话隔离、容量限制、稀疏覆盖与全局默认值热更新、原子校验、重置继承、Fast 支持查询、四种 Transport、回复详略、推理摘要、脱敏传输健康和命令/RPC 错误边界；
- `authorization-bridge.test.mjs`：登录交互限额、凭据不出 RPC、退出登录、`/codex-usage status|refresh` 与命令输出；不支持类型或结构损坏的已存记录必须返回独立的 `invalid` 状态，不能显示为已登录，也不能跨 RPC 暴露 secret；
- `quota-observer.test.mjs`：三态、reset/stale 到期、乱序观测、严格输入与冻结脱敏快照；
- `client-bundle.test.mjs`：Web 登录页与显式 OAuth 链接/验证码复制、四项全局默认值的单字段持久化、套餐及额度展示、低额度/耗尽/重置单次刷新提醒、无后台轮询与无系统通知、通用发现加独立能力 RPC、模型启用写入、会话请求菜单、主动网络诊断二次确认、同意失效与不可重放、脱敏历史的显式读取/导出/清空、登录操作互斥、组件卸载安全、窄屏布局与 loopback RPC 调用边界；
- `remote-image-input.test.mjs`：URL、DNS、重定向、响应大小、MIME、超时、2 个活动任务、32 个排队任务、队列满拒绝、排队取消、插件卸载时的队列封口/活动任务收敛、保存阶段取消边界，以及真实 ToolRuntime 和正式 `read_image` renderer 的端到端执行；模型能力预检位于同一限流器内，阻塞或忽略 abort 的 resolver 也不能绕过活动与排队上限；
- `generate-sbom.test.mjs`、`release-evidence.test.mjs` 与 `release-workflow.test.mjs`：离线确定性参考依赖图、产物/两套锁文件哈希绑定、DSH smoke 运行环境、实际安装树和生产依赖审计取证、精确 SRI、签名/attestation 审计、Action SHA 固定、最小权限、draft/tag 目标预检和可恢复发布；
- `release-maintainability.test.mjs`：直接运行依赖声明覆盖、Apache-2.0 贡献许可、双语隐私模板、根/夹具 DSH 版本一致性与协调 Dependabot 配置；
- `dsh-runtime-fixture.test.mjs`：夹具为 private、精确固定 DSH `0.1.1-rc.2` 且提交完整 pnpm lock；CI、兼容性和发布工作流只能用 `--frozen-lockfile --ignore-scripts` 安装该图，并禁止直接交给 npm 重新解算无界 DSH peer 图；
- `types-consumer.ts`：从 npm package exports 消费公开 `.d.ts`，并以严格 TypeScript 配置编译；
- `host-load.test.mjs`：Host export、Config、waterfall、独立模型能力 RPC 与动态服务注册；配额纵向回归把真实 stream listener 的结构化/模糊 429 观测贯通到脱敏状态 RPC 和 `/codex-usage` 命令，并验证成功请求恢复近期成功状态。

## 验收层级

1. 单元：纯函数与 stream fixture；
2. SDK 合同：锁定发布包的 public exports；
3. 隔离安装：从 `.tgz` 安装到空目录并导入 Host；
4. Harness smoke：先从 `test/fixtures/dsh-runtime/pnpm-lock.yaml` 冻结安装精确 DSH runtime，再从本地 `.tgz` 安装到隔离 profile、确认通用 pi-ai provider 配置未改变、启动 Web，并读取登录状态 RPC 与 client bundle；模型发现由 SDK 合同和 Host runtime 测试覆盖；
5. 正式发布读回：npm `dist.integrity` 与候选 SRI 精确一致，签名/attestation 审计通过，GitHub 资产与本地 tarball 逐字节一致；发布前还必须确认三平台 `3/3`和维护者批准；
6. 发布后真实网络：首次发布的 `0.0.1` 历史上允许以 `0/13` 正式发布；后续每个版本都从独立记录开始。仓库所有者在受控本地环境中使用测试账号人工逐项验证 Web OAuth、模型目录、文本/reasoning 流、终态 usage、安全工具闭环、两轮 replay、`maxPixels=4194304` 图片路径、四种 transport 与 Fast；该过程会消耗账号额度，只有固定布尔断言全部有脱敏证据时才能将对应项改为 `passed`，未通过项必须如实保留；发现的产品问题进入下一个尚未发布的递增版本。

维护者核验一个平台的 CI 与 profile smoke 后，用完整参数离线记录该结论：

```sh
pnpm run release:acceptance -- pass-platform <linux|macos|windows> \
  --tested-commit=<完整40位小写SHA> \
  --tested-at=<带时区的RFC3339> \
  --runner=<运行环境单行标识> \
  --node-version=<22.x.y或24.x.y> \
  --dsh-version=0.1.1-rc.2 \
  --profile-smoke=passed \
  --evidence-url=<脱敏HTTPS>
```

七个选项都必须且只能用 `--name=value` 提供一次。runner 必须去除首尾空格、不是占位词、最长 128 字符且不含控制字符；Node 必须是可带 `v` 前缀的稳定三段 22（至少 `22.19.0`）或 24；证据必须是没有 userinfo、查询参数或片段的绝对 HTTPS URL。

已绑定候选后若源码或其他受验收内容变化，必须先重置 draft 记录，再验收新提交：

```sh
pnpm run release:acceptance -- reset-candidate \
  --from-commit=<旧完整40位小写SHA> \
  --to-commit=<新完整40位小写SHA>
```

`--from-commit` 必须匹配当前 `testedCommit`，两个完整小写 SHA 必须不同。命令会清空全部旧平台/live 证据和审批字段并绑定新 SHA；approved 记录不能重置。它离线运行且不检查提交存在性，并通过受管路径检查、并发写锁和原子替换安全写入。同一条 `old → new` 命令在记录已是只绑定新 SHA 的 fresh draft 时返回 `unchanged`；任何残留证据都会冲突且不写入。重置后先在新 SHA 上运行 CI/profile smoke，再通过 `pass-platform` 记录新平台证据。

真实 OAuth、配额或网络 smoke 不应要求贡献者在 CI 提交秘密，也不能使用外部 PR 可访问的 secret。`release:acceptance` 只是离线证据记录器：`pass-platform` 只记录维护者已核验的 CI/profile smoke，既不运行测试、不联网，也不检查提交是否存在；`pass` 不读取凭据、不推断或自动通过断言；两者都不替代人工审批。`status` 只显示计数和检查项名称，不显示证据值。第一次 `pass-platform` 绑定完整候选 SHA，后续所有平台/live 记录和 `approve` 必须使用同一 SHA。已通过项目只允许完全相同的幂等重放，任何不同证据都不能覆盖。严格 publish gate 负责验证三平台 `3/3`、供应链证据、维护者批准、提交存在性和祖先关系；live 可在 `0/13` 状态正式发布并在发布后继续补录。
