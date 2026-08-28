# 故障排查

[简体中文](troubleshooting.md) | [English](troubleshooting.en.md)

## `Image request maxPixels must be a positive integer.`

`0.0.1` 的 bundle 显式提供 `requestImagePixelBudget: 4194304`，并在测试中让真实 PNG 穿过 DSH attachment seam。若仍出现该错误：

1. 确认运行的是 `dsh-codex-community@0.0.1` 的精确包体；
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

设置页的“Codex 额度观测”和 `/codex-usage` 只显示最近请求产生的状态。它们不会主动查询账户，也不代表实时余额；reset 必须通过严格格式和有限时距校验，否则耗尽状态会在有限时间后回到“未知”。

请等待重置、使用账户允许的其他模型/方案，或按 ChatGPT 账户页面提供的选项处理。不要在 Issue 中提交账户截图、token 或完整原始响应。

## `QUOTA_OR_RATE_LIMIT`

pi-ai 可能只返回通用的 ChatGPT usage-limit 文案，而不再提供原始 429 body/code。此时插件无法可靠区分账户配额与瞬时限流，因此不会把它写成 `QUOTA`、不会更新额度观测，也不会在无输出时自动重试。若已经产生安全纯文本，插件只保存该 partial；若已经出现工具调用，则失败关闭。请由用户确认账户页面或稍后手动重试，不要循环切换 transport。

## Fast 不可用

先运行 `/codex status` 确认当前会话是否开启 Fast。Fast 请求 priority service tier，但可用性取决于账号与服务端；插件不会把失败请求自动降级重放。可以运行 `/codex set fast off` 关闭当前会话的 Fast，再由用户决定是否重新发送请求。

## 回复到一半中断

- 已有可见文本且没有工具调用：无论 failure 来自终止 chunk 还是直接抛出，插件都会闭合 text/reasoning block、保存内容并提示发送“继续”；
- 已出现工具调用（包括没有文本的纯工具流）：插件失败关闭且不自动重放；具体错误码保留可靠分类，避免写文件、发请求或其他工具副作用重复发生；
- 尚无任何输出的瞬时 `RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`：最多重试两次。
- 无结构证据的 `QUOTA_OR_RATE_LIMIT`：无输出时不重试，有安全纯文本时只保存 partial，且不写入额度观测。

## 登录后仍不可用

先在 **设置 → Codex 登录** 确认登录状态，并在同一页面确认目标模型已启用，再从会话模型选择器的 `dsh-codex` provider 组中选用。不要把 ChatGPT OAuth bearer 当成 OpenAI Platform API key。若 refresh 失败，先在 Codex 登录页退出再重新登录；卸载包不会自动删除 grant。
