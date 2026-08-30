# 故障排查

[简体中文](troubleshooting.md) | [English](troubleshooting.en.md)

## `Image request maxPixels must be a positive integer.`

当前实现显式提供 `requestImagePixelBudget: 4194304`，并在测试中让真实 PNG 穿过 DSH attachment seam。若仍出现该错误：

1. 确认运行的是已安装的精确包体；`1.0.0` 尚未发布，当前正式版仍为 `dsh-codex-community@0.0.4`，不要把其他版本的文件混入同一 profile；
2. 确认 profile 中的 `dsh-codex` 配置包含完整的三项图片预算；
3. 检查 settings 中是否把图片字段写成 `0`、负数、浮点或其他显式非法值；缺省和 `null` 会回填安全默认值；
4. 运行 `npm test -- --test-name-pattern=maxPixels` 或完整 `pnpm test`；
5. 报告时只附插件、DSH、Node 版本和脱敏 stack，不附图片原件或凭据。

如果另一个 bundle 或用户设置替换了 `dsh-codex` 的整行 config，请合并回三项有效正整数预算，而不是只保留其中一项。

## `AccountQuotaExceeded` / 五小时配额

这是账户使用窗口耗尽，不是瞬时请求速率限制。插件会：

- 映射为 `QUOTA`，停止自动重试；
- 只在 failure 顶层或同一个可独立确认配额的 `error` envelope 中存在且通过格式校验时，显示 provider 给出的 reset 时间和 request ID；
- 在安全情况下保存已经显示的纯文本；
- 不承诺通过换 transport 或重复请求绕过账户额度。

设置页每次进入、页面重新可见、窗口重置节点以及手动点击“刷新”时，会由 Host 请求真实的五小时与每周使用窗口；每周窗口进入不足 24 小时时只切换本地显示，不额外联网。`/codex-usage refresh` 使用相同 Reader 主动读取账号窗口，`/codex-usage status` 则只查看最近请求产生的脱敏 `QuotaObserver` 观测，用于实时读取不可用时的安全降级。failure 中的 reset 必须通过严格格式和有限时距校验，否则耗尽观测会在有限时间后回到“未知”。

请等待重置、使用账户允许的其他模型/方案，或按 ChatGPT 账户页面提供的选项处理。不要在 Issue 中提交账户截图、token 或完整原始响应。

## 五小时或每周额度无法刷新

设置页通过官方 Codex 客户端使用的 Web 后端兼容接口读取额度，因此登录有效但网络、鉴权或接口结构变化仍可能让本次刷新失败。页面不会把失败显示成剩余 `0%`，也不会清空最近一次已验证读数；没有可保留读数时，只会显示最近请求观测或“未知”。

先确认登录状态，再手动刷新一次或执行 `/codex-usage refresh`。如果仍失败，请检查到 ChatGPT/Codex 服务的网络访问和系统时间，然后重新登录。账号诊断会把 HTTP 失败固定区分为 401/403 鉴权、429 限流、5xx 服务端或其他 HTTP 错误，不显示原始响应。报告问题时只提供插件版本、DSH 版本、发生时间和这个脱敏错误类别；不要提交 token、account ID、请求头或 usage 原始响应。

## `QUOTA_OR_RATE_LIMIT`

pi-ai 可能只返回通用的 ChatGPT usage-limit 文案，而不再提供原始 429 body/code。此时插件无法可靠区分账户配额与瞬时限流，因此不会把它写成 `QUOTA`、不会更新额度观测，也不会在无输出时自动重试。若已经产生安全纯文本，插件只保存该 partial；若已经出现工具调用，则失败关闭。请由用户确认账户页面或稍后手动重试，不要循环切换 transport。

## Fast 不可用

先确认当前选择的是 GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 或 Terra；闪电按钮在 GPT-5.3 Codex Spark、GPT-5.4 mini 和未知模型上不可用，也不会发送 Fast service tier。点击模型选择器左侧的闪电按钮，或运行 `/codex status` 与 `/codex set fast on|off` 检查和修改当前会话状态。切换从下一次请求生效；进程重启后恢复关闭。

Fast 使用官方 priority service tier，目标速度为 1.5 倍并消耗更多额度。插件不会把失败请求自动降级重放；关闭 Fast 后，需要由用户决定是否重新发送请求。

## 使用连接诊断

打开 **设置 → OpenAI Codex → 连接诊断**。该区域默认折叠且不会自动运行：

- “检查本机”只读取本机 route、模型目录、启用数量和凭据元数据，不联网、不刷新 OAuth，也不发送模型请求；
- “检查账号”在本机检查后读取一次额度，必要时可按既有凭据合同刷新 OAuth，但不发送模型请求、不消耗模型额度。

诊断只显示固定检查项、状态码和受限事实，不显示 token、account ID、原始响应或原始错误。账号读取可区分 401/403 鉴权、429 限流、5xx 服务端和其他 HTTP 错误；“复制诊断报告”复制的也是同一份已验证安全投影，不会回读原始异常。它能区分本机配置与账号额度读取问题，但不能证明真实文本、图片、工具、Fast 或指定 Transport 请求可用；这些仍需由用户主动发送请求验证。

## 模型或推理档位与预期不同

设置页显示当前安装的 provider catalog，不是账号动态模型目录。基础目录来自 Harness 通用发现接口，输入模态、当前目录实际提供的 Low 至 Max 可选推理档位和 Fast 标签来自独立的本机 loopback-only 只读能力 RPC；该 RPC 不可用时仍显示基础目录，但省略无法证实的标签。插件不会虚构或标注 catalog 未提供的默认档位；没有显式 effort 时由当前 Provider 或服务端采用其默认行为。当前不会显示 `Default`、`Off` 或 `Minimal`。GPT-5.6 三款显示到 `Max`；Codex 客户端中的 `Ultra` 还会开启主动任务委派，本 Provider 尚未实现对应的 Harness Agent 编排，所以不会显示一个只有名字相同、行为却不完整的 `Ultra`。未知模型不会获得推断档位或 Fast 支持。

旧会话若保存了 `Off` 或 `Minimal`，请点击输入框旁的“修复旧推理档位”。页面不会自动迁移；点击后会移除旧的不支持显式 effort，后续由当前 Provider 或服务端采用其默认行为。修复不会展示、写入或声称 catalog 未提供的具体默认档位；它仍沿用模型选择器的模型保存语义，把当前模型保存为未来新会话的默认模型。

请先重新进入设置页并确认已启用目标模型，再检查当前安装的精确插件版本。不要根据旧截图或模型名称猜测能力；若 catalog 与选择器不一致，请提交脱敏后的模型 ID 和版本信息，不要附 OAuth 凭据。

## 回复到一半中断

- 已有可见文本且没有工具调用：无论 failure 来自终止 chunk 还是直接抛出，插件都会闭合 text/reasoning block、保存内容并提示发送“继续”；
- 已出现工具调用（包括没有文本的纯工具流）：插件失败关闭且不自动重放；具体错误码保留可靠分类，避免写文件、发请求或其他工具副作用重复发生；
- 尚无任何输出的瞬时 `RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`：最多重试两次。
- 无结构证据的 `QUOTA_OR_RATE_LIMIT`：无输出时不重试，有安全纯文本时只保存 partial，且不写入额度观测。

## 登录后仍不可用

先在 **设置 → OpenAI Codex** 确认登录状态，并在同一页面确认目标模型已启用，再从会话模型选择器的 `dsh-codex` provider 组中选用。不要把 ChatGPT OAuth bearer 当成 OpenAI Platform API key。若 refresh 失败，先在该设置页退出再重新登录；卸载包不会自动删除 grant。
