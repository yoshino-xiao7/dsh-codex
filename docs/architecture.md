# 架构

[简体中文](architecture.md) | [English](architecture.en.md)

## 责任范围

本插件注册 Codex route、设置命名空间、OAuth 流程、会话偏好和可靠性策略。消息转换、模型协议、工具权限、session 持久化与 OAuth 协议行为通过 DSH、`@deepseek-ai/dsh-llm-pi-ai` 和 pi-ai 的公开接口完成。

```text
DSH Web 设置 ── loopback RPC ── AuthorizationBridge
        │                             │
        │ 进入页面 / 手动刷新          │
        ▼                             ▼
AccountUsageReader ────────── CodexCredentialStore
        │                             │
        ▼                             ▼
Codex Web usage endpoint      ChatGPT OAuth grant

Harness Agent Loop
        │
        ├── SessionPreferences ── 闪电按钮、Fast / transport
        │
        ▼
StreamResilience ── CodexRouteAdapter (`dsh-codex`)
                              │
                              ▼
                PiAiAdapter (`openai-codex`) ── CodexPiProvider
        ▲
        └── attachment service ── ImagePolicy
```

## ProviderRuntime

`ProviderRuntime` 在 `dsh-codex` 设置命名空间中创建 `dsh-codex` route 和 OAuth 流程。外层 `CodexRouteAdapter` 把 DSH route 映射到 PiAiAdapter 内部的 canonical `openai-codex` provider，并在 provider info、模型、stream 历史 source 与错误边界恢复外部 route。这样可以保留 pi-ai 对 response ID、reasoning signature、tool-call ID 和 replay envelope 的语义。

每次请求从当前设置生成不可变 profile；已开始的请求不会被并发设置修改影响，下一次请求会读取新配置，外层 adapter 实例保持不变。

模型目录来自安装版本的 pi-ai。模型筛选、图片预算、缓存策略、超时和有界重试在 profile 边界一次解析。未知模型或重复模型在产生网络请求前失败；未配置 `models` 时展示完整目录，显式空数组则不展示任何模型。

## CodexCredentialStore

凭据记录键为 `dsh-codex/openai-codex`。存储适配器只读取和修改这一条记录，并且只接受 OAuth grant；API key、其他 provider 的记录或结构无效的数据都会失败关闭。写入和删除经过 DSH credentials service 的串行接口：删除先获得锁时不会再发起 refresh，refresh 已获得锁时删除会等待并成为最终状态，避免退出后凭据复活。

Web 设置页只接收登录方法、脱敏提示、授权页面地址、验证码和完成状态。access token、refresh token、完整 grant 与完整 provider 错误不会跨过 loopback RPC，也不会写入命令输出。

## AuthorizationBridge

Host 端通过 DSH authorization service 启动、取消和观察登录流程，并通过 credentials service 查询“是否已配置”或执行退出。RPC 限制并发 attempt、长轮询 waiter、事件数量、字符串长度和可接受 URL。登录结果返回后，插件会在 credentials service 持有该记录的串行写锁时再次检查取消信号；这个 mutate 回调是取消的线性化点：回调选择 grant 前的取消会阻止写入，选择后写入会完成，插件不会再用补偿性删除回滚，因为那可能删除另一个 DSH 进程已经排队的新登录。无凭据内容的 generation tracker 会把提交阶段保持到对应 `authorization/settled`；设置页和 `/codex-login cancel` 在同一同步调用栈内拒绝已经过线性化点的取消，并继续观察最终 `authorized` 状态。退出登录绕过这道限制，先中止活动 attempt，再通过同一串行记录路径显式删除凭据，因此已经开始的旧写入不能在退出完成后复活。已经结束但仍处于短期保留期的 attempt ID 不能取消后来启动的登录。

`/codex-login status|cancel|logout` 使用同一边界，并禁止把命令输入写入会话记录。

## AccountUsageReader

设置页每次挂载以及用户点击“刷新”时，Host 端 `AccountUsageReader` 使用当前 OAuth grant 请求官方 Codex 客户端使用的 Web 后端 usage 兼容接口。它严格解析使用百分比、窗口时长和 reset 时间，并把五小时与每周窗口转换为不含凭据的最小快照；access token、refresh token、account ID、原始响应和任意响应头都不会跨过 loopback RPC。

该接口是 Web 后端兼容边界，不被当作稳定的插件公共 API。请求具有超时、响应大小和数值范围限制；网络失败、鉴权失败或结构变化不会被显示成零余额，也不会清除最近一次已验证读数。若没有可保留的实时读数，页面会安全降级为最近请求产生的 `QuotaObserver` 状态或“未知”，而不是推断额度。

## SessionPreferences

模型选择器左侧的闪电按钮和 `/codex` 修改同一份当前会话状态：

- 闪电按钮或 `fast on|off` 控制是否发送 Fast priority service tier，默认关闭；
- `transport` 可选 `auto`、`sse`、`websocket` 或 `websocket-cached`，默认 `auto`；
- `reset` 恢复当前会话默认值。

偏好保存在有容量上限的内存表中，返回不可变快照，不写入全局 provider 设置，进程重启后恢复默认。Fast 只对 GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 和 Terra 请求生效，使用官方 priority service tier，目标速度为 1.5 倍并消耗更多额度；其他模型不会携带该 tier。切换只影响下一次请求，已经开始的请求不变。Fast 请求失败后不会自动以另一 service tier 重放，避免重复工具副作用。

DSH 原始 session ID 只用于偏好查询和消息/replay provenance；传给 pi-ai 的 transport/cache session ID 带有 `dsh-codex:` 命名空间。`/codex reset`、`agent/disposed` 和 runtime dispose 只通过 pi-ai 的公开、精确 session API 清理本插件拥有的 WebSocket 连接、fallback 与 debug 状态，不调用无参全局清理，也不影响同进程其他 pi-ai consumer 的 session。该命名空间只进入 pi-ai stream options，不改写历史消息或 replay envelope。

## ModelEnablement

本插件的设置页通过 `llm.discoverModels` 从当前 pi-ai catalog 展示可请求模型，并把选择写入 `dsh-codex` 设置命名空间。Runtime 只注册该命名空间的直接 discovery handler，不为本 route 注册通用 configurable-provider directory，避免干扰 DSH 的通用模型编辑器。

设置页至少要求选中一个模型。全选且条目没有自定义字段时移除 `models` 覆盖，使目录随 pi-ai 版本更新；部分选择、额外字段和自定义参数保留显式配置。目录筛选只影响模型发现，精确指定的隐藏模型仍可解析，因此旧会话不会仅因模型被隐藏而失效。

模型名称、上下文窗口与输入能力来自当前安装的 provider catalog，不声称是账号动态目录。推理选择器由 `CodexRouteAdapter` 按已核验的订阅 Codex 模型目录重新投影：删除通用 `Default`、`Off` 与 `Minimal`，写入逐模型默认值，并只暴露可以由 Provider 请求层诚实表达的 Low 至 Max。Codex 的 `Ultra` 同时代表最高普通推理与主动任务委派，属于 Agent 编排模式；本插件不会只发送一个伪造的 `ultra` 值，也不会静默退化成 `Max`。未知模型不获得推断能力，route 边界也拒绝直接注入未核验档位。

## ImagePolicy

可选配置会解析为不可变、没有 optional 数字的完整策略。attachment contract 只收到 `{ maxPixels, maxBytes }`。零、负数、浮点、`NaN` 和超安全整数会在配置边界被拒绝。

远程图片通过 `tools/execute` middleware 扩展现有 `read_image`。本地路径原样交给原工具；HTTP(S) URL 经过公网 DNS 校验、地址固定、逐跳重定向校验、总超时、MIME allowlist，以及响应和解压后的字节上限。通过校验的内容先写入 DSH attachment store，再按原工具的 output schema 返回。

每个插件实例最多同时执行 2 个远程图片任务并排队 32 个；队列已满时返回 `TOO_MANY_REQUESTS`。排队期间取消会移除任务，下载阶段取消会终止网络工作。插件卸载会先关闭 limiter、原子拒绝所有排队任务，并用独立 lifetime signal 中止仍处于模型解析或网络阶段的活动任务；Context cleanup 会等待已经进入 `saveImage` 的任务收敛。DSH 当前公开的 `saveImage` 接口没有 `AbortSignal` 或回滚合同，因此保存开始后的取消只保证不向调用方返回成功，不能保证删除可能已经落盘的附件；执行槽也要等 `saveImage` 结束后才释放。有界队列和生命周期封口共同防止卸载后继续启动新工作或造成无限内存增长。

## FailureNormalizer 与 QuotaObserver

`FailureNormalizer` 将 DSH `LlmFailure` 和嵌入的结构化 JSON 转换为稳定分类。只有可验证的结构化 `code`/`type`（例如 `AccountQuotaExceeded`、`insufficient_quota`）或窄化的账户级文本特征确认用量耗尽时才映射成 `QUOTA`；普通 429 保持 `RATE_LIMIT`。多个嵌入 JSON 各自保持独立来源：reset、request ID 和 status 只能来自 failure 顶层或一个自身也能独立证明配额的 `error` envelope，不能跨 envelope 拼接。pi-ai `0.82.1` 会把不同 429 折叠成同一条 ChatGPT usage-limit 文案，且不再提供原始 code/body；这种无结构证据的结果映射为非自动重试的 `QUOTA_OR_RATE_LIMIT`，不会谎称为已确认账户配额。

`QUOTA`、`QUOTA_OR_RATE_LIMIT` 和已确认 transport 的输出均重新构造为最小 failure，只保留固定脱敏消息、code，以及可选的有效 HTTP status/受限字符集 request ID；不回显任意 provider 字段或 WebSocket close reason。`QUOTA_OR_RATE_LIMIT` 不写入 `QuotaObserver`：无 partial 输出时直接失败且不重试，已有安全纯文本时只保存 partial。

`QuotaObserver` 只记录成功终止、`QUOTA` 和通过严格格式及有限时距校验的 reset timestamp。快照只有 `unknown`、`recent-success` 和 `exhausted` 三态。它不轮询账户，也不展示余额或百分比；它作为 `AccountUsageReader` 无可用实时快照时的请求观测降级，两类证据不会互相伪装。

## StreamResilience

该模块运行在 `llm/stream` waterfall：

1. 原样转发 provider chunk，并记录开放 block；
2. 在终止 error、直接抛出的已确认 quota/usage-limit/transport、公开 `STREAM_CLOSED`/WebSocket failure 或无终止 chunk 的 EOF 到达时做窄化分类；
3. 若已有纯文本且没有工具调用，闭合开放 block、追加恢复提示，并以 `stop` 完成；
4. 若存在工具调用（包括没有文本的纯工具流），返回非重试失败，不重放整次请求。

模块不自行执行工具，也不增加隐藏的 pre-stream 重试。只有没有产生内容且命中 retry policy 的 `RATE_LIMIT`、`SERVER`、`TIMEOUT` 或已确认 `TRANSPORT` 才可由上层最多重试两次；直接抛出的已确认 failure 走同一脱敏与恢复路径，不相关的异常仍原样抛出。Fast 和 transport 选择不会触发 service-tier 降级或整次请求重放。

## Profile 组合

`codex-community.patch.yml` 只插入 authorization 与 `dsh-codex`，不修改通用 `llm-pi-ai` Cordis row。其他 pi-ai provider 可在同一 profile 中继续使用。

本插件的外部 route 是 `dsh-codex`，凭据键是 `dsh-codex/openai-codex`；通用插件的 route 和凭据范围保持不变。用户若同时启用两条 Codex route，模型选择器会显示两个 provider 组。每次升级 DSH 都必须重跑 bundle 共存、replay 与隔离 profile 加载测试。

## 其他能力边界

- 会话压缩使用 DSH 自带的自动压缩和 `/compact`；本插件不改写压缩协议；
- Web search 使用 DSH 的工具和对应凭据，不复用 ChatGPT OAuth；
- 图片生成或编辑需要单独的模型、凭据与计费边界，`0.0.1` 不提供该能力。
