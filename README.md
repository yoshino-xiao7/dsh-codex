# dsh-codex

[简体中文](README.md) | [English](README.en.md)

面向 DeepSeek Harness 的 Codex 插件，提供 ChatGPT OAuth 登录、Codex 模型、图片输入和可靠的流式回复。

> 当前版本：`1.1.0` 正式版，通过 npm `latest` 与正式 GitHub Release 发布。npm 包名：`dsh-codex-community`。

## 功能

- 在 DSH Web 中完成 ChatGPT OAuth 登录、重新登录和退出；
- 选择并启用 Codex 模型，支持流式文本、reasoning、usage、工具调用和会话 replay；
- 使用 DSH Web 原生的图片粘贴、拖放和 attachment 流程；
- 让 `read_image` 安全读取 HTTP(S) 图片，并限制地址、重定向、格式、大小和超时；
- 为请求图片补全有效的像素与字节预算，避免无效 `maxPixels`；
- 将 `AccountQuotaExceeded` 识别为不可重试的账户配额错误，并显示脱敏后的重置时间；
- 流中断时保留安全的半段纯文本；涉及未完成工具调用时停止，不自动重放请求；
- 每次进入设置页、页面重新可见或额度窗口到达重置节点时主动读取真实的 5 小时与每周额度，也可通过刷新按钮或 `/codex-usage refresh` 立即刷新；每周相对天数递减与不足 24 小时切换都只更新本地时间显示；
- 使用紧凑的额度卡展示统一的剩余额度语义、套餐类型与安全的重置时间；5 小时额度显示精确时间，每周额度不足 24 小时时也显示精确时间；
- 在设置页优先展示已选择模型，默认收起未选择模型；上下文和最大输出使用来自当前 provider catalog 的紧凑 `K` 标签；
- 使用模型选择器左侧的闪电按钮为当前会话切换官方 Fast（1.5 倍速），并通过相邻的图形按钮或 `/codex` 选择自动、SSE、WebSocket 或 WebSocket 缓存传输；
- 通过独立的本机 loopback-only 只读 RPC 从 Host 读取输入模态、当前安装 provider catalog 实际提供的可选推理档位与 Fast 支持，并与 Harness 通用模型目录合并为真实能力标签；RPC 不可用或能力未知时不推断；
- 在当前会话中选择回复详略（低、中、高）和推理摘要（自动、简洁、详细、关闭），从下一次请求生效；
- OAuth 授权提示支持分别复制登录链接和验证码，复制只在用户点击时发生，不记录短期凭据；
- 在默认折叠的连接诊断中按需运行“本机检查”或“账号检查”，并复制仅含固定状态与受限事实的脱敏报告；
- 在会话请求设置中查看本会话的请求数、连接复用、增量上下文和 SSE 回退等脱敏传输健康状态。

`1.1.0` 新增：

- 在插件设置中持久化 Fast、Transport、回复详略和推理摘要的全局默认值；会话只保存显式覆盖，`/codex reset` 恢复当前全局默认值；
- 在应用运行期间，依据已验证的 5 小时与每周窗口显示低额度、耗尽和到期刷新提醒；不做后台轮询，不发送操作系统通知；
- 新增一次性真实网络诊断：确认框会明确列出本次验证的模型；只有用户阅读消耗说明并再次确认后，才会通过 SSE、关闭 Fast 发送一条短提示。请求遵循 Codex SDK 的公开 wire schema，不携带会话历史或工具，也不自动重试；专用端点没有可用的服务端硬输出上限，插件会在首次看到模型文本后立即结束流，但不能保证取消或结束流不消耗额度；
- 保留最多 20 条进程内脱敏诊断历史，支持导出已验证的安全 JSON；重启进程会清空历史。

## 运行要求

- DeepSeek Harness `0.1.1-rc.2`
- Node.js `>=22.19.0 <25`

## 安装

请固定安装精确版本：

```sh
dsh plugin --profile web add dsh-codex-community@1.1.0
dsh web
```

## 登录与使用

1. 打开 **设置 → OpenAI Codex**，按页面提示完成 ChatGPT OAuth；
2. 在同一页面启用模型；
3. 从会话模型选择器中选择 Codex 模型开始使用；需要时点击选择器左侧的闪电按钮开启 Fast，并通过相邻的传输按钮或 `/codex set transport ...` 切换当前会话的传输方式。

可用命令：

```text
/codex-login status
/codex-login cancel
/codex-login logout
/codex-usage status
/codex-usage refresh
/codex status
/codex reset
/codex set fast on|off
/codex set transport auto|sse|websocket|websocket-cached
/codex set verbosity low|medium|high
/codex set summary auto|concise|detailed|off
```

`1.1.0` 将关闭、`auto`、`low` 和 `auto` 作为可持久化的安全全局默认；会话只记录用户明确修改的字段，所以未覆盖的字段会跟随新默认值。所有切换从下一次请求生效。Fast 在 GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 和 Terra 上使用官方 priority service tier，目标速度为 1.5 倍并消耗更多额度；失败请求不会自动降级重放。

更新：

```sh
dsh plugin --profile web update dsh-codex-community@1.1.0
dsh web
```

卸载前请先在 **设置 → OpenAI Codex** 中退出，然后执行：

```sh
dsh plugin --profile web remove dsh-codex-community
dsh web
```

## 错误处理

- `Image request maxPixels must be a positive integer.`：图片预算缺省或为 `null` 时会回填安全默认值；零、负数、浮点和其他显式非法值会在配置加载时被拒绝。
- `AccountQuotaExceeded`：插件会停止自动重试并保留安全的已显示文本；重置时间存在且通过校验时才会显示。它不会通过切换传输方式绕过账户配额。
- `QUOTA_OR_RATE_LIMIT`：服务只返回通用 429 文案、缺少结构化证据时，插件不会把它误报为已确认账户配额，也不会自动重试；请稍后手动重试或检查账户页面。
- 回复到一半中断：纯文本可安全保存；未完成工具调用不会自动重放，以免重复产生副作用。

排查步骤见[故障排查](docs/troubleshooting.md)。

## 支持边界

- `1.1.0` 的完整检查与 Linux、macOS、Windows CI/profile smoke 已按本版本候选 `3/3` 通过并获维护者批准；发布后真实账号验证从 `0/13` 开始，状态见[验收记录](docs/releases/v1.1.0.acceptance.json)；
- `1.0.0` 的历史发布证据继续保留，但不会继承为 `1.1.0` 的验收结果；
- 设置页额度通过官方 Codex 客户端使用的 Web 后端兼容接口读取；接口不可用或返回异常时保留最近的安全读数，并降级为请求观测或未知状态，不把错误伪装成零余额；
- 模型名称、上下文、最大输出和可选的 Low 至 Max 推理档位来自当前安装 provider catalog 的实际语义；插件不会虚构或标注 catalog 未提供的默认档位，无显式 effort 时由当前 Provider 或服务端采用其默认行为。选择器不展示通用的 `Default`、`Off`、`Minimal`，也不把需要主动任务委派的 `Ultra` 伪装成普通推理档位；
- Fast 仅用于 GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 和 Terra，并会提高额度消耗；其他模型不会发送 Fast service tier；
- 本机和账号诊断不发送模型请求；一次性真实网络诊断只会在二次确认后使用页面列出的模型单独发送一次短提示并消耗额度。它没有服务端硬输出上限，只会在首次可见文本后尽快结束流，仍不能替代图片、工具、Fast 或全部传输方式的完整验收；
- 不提供图片生成或编辑；
- Windows、Linux、真实 OAuth 与真实 Codex 网络验收状态见[兼容性文档](docs/compatibility.md)。

## 文档与贡献

- [文档索引](docs/README.md)
- [配置参考](docs/configuration.md)
- [参与贡献](CONTRIBUTING.md)
- [安全报告](SECURITY.md)
- [支持范围](SUPPORT.md)

提交 Issue 时不要附带 token、OAuth code、cookie、凭据文件或完整私人会话。

Apache-2.0，详见 [LICENSE](LICENSE)。本项目由社区维护，与 OpenAI 或 DeepSeek 无隶属或背书关系。
