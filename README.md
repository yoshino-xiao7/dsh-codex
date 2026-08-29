# dsh-codex

[简体中文](README.md) | [English](README.en.md)

面向 DeepSeek Harness 的 Codex 插件，提供 ChatGPT OAuth 登录、Codex 模型、图片输入和可靠的流式回复。

> 当前版本：`0.0.3` 技术预览，使用 npm `latest` 与正式 GitHub Release 发布。npm 包名：`dsh-codex-community`。

## 功能

- 在 DSH Web 中完成 ChatGPT OAuth 登录、重新登录和退出；
- 选择并启用 Codex 模型，支持流式文本、reasoning、usage、工具调用和会话 replay；
- 使用 DSH Web 原生的图片粘贴、拖放和 attachment 流程；
- 让 `read_image` 安全读取 HTTP(S) 图片，并限制地址、重定向、格式、大小和超时；
- 为请求图片补全有效的像素与字节预算，避免无效 `maxPixels`；
- 将 `AccountQuotaExceeded` 识别为不可重试的账户配额错误，并显示脱敏后的重置时间；
- 流中断时保留安全的半段纯文本；涉及未完成工具调用时停止，不自动重放请求；
- 每次进入设置页或手动刷新时读取真实的 5 小时与每周额度；读取失败时安全降级，不向 Web 页面暴露 OAuth 凭据；
- 使用紧凑的额度卡展示剩余比例：5 小时额度显示精确重置时间，每周额度在不足 24 小时时显示精确时间，其余时间显示相对天数；
- 在设置页优先展示已选择模型，默认收起未选择模型；上下文和最大输出使用来自当前 provider catalog 的紧凑 `K` 标签；
- 使用模型选择器左侧的闪电按钮或 `/codex` 为当前会话切换官方 Fast（1.5 倍速）和传输方式，默认关闭 Fast、自动选择传输。

## 运行要求

- DeepSeek Harness `0.1.1-rc.2`
- Node.js `>=22.19.0 <25`

## 安装

请固定安装精确版本：

```sh
dsh plugin --profile web add dsh-codex-community@0.0.3
dsh web
```

## 登录与使用

1. 打开 **设置 → OpenAI Codex**，按页面提示完成 ChatGPT OAuth；
2. 在同一页面启用模型；
3. 从会话模型选择器中选择 Codex 模型开始使用；需要时点击选择器左侧的闪电按钮开启 Fast。

可用命令：

```text
/codex-login status
/codex-login cancel
/codex-login logout
/codex-usage
/codex status
/codex reset
/codex set fast on|off
/codex set transport auto|sse|websocket|websocket-cached
```

Fast 和传输偏好只保存在当前进程的当前会话中，不会持久化，进程重启后恢复默认。Fast 在 GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 和 Terra 上从下一次请求起使用官方 priority service tier，目标速度为 1.5 倍并消耗更多额度；关闭后，下一次请求恢复默认速度。失败请求不会自动降级重放。

更新：

```sh
dsh plugin --profile web update dsh-codex-community@0.0.3
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

- `0.0.x` 不承诺稳定 API，请固定版本；
- `0.0.3` 的 Linux、macOS 和 Windows CI/profile smoke 已达到 `3/3`，候选提交与平台证据见[验收记录](docs/releases/v0.0.3.acceptance.json)；
- `0.0.3` 的真实 OAuth、对话、图片、transport 和 Fast 网络验收从独立记录的 `0/13 pending` 开始；这些未验证能力继续如实展示，并在发布后逐项补齐；
- 设置页额度通过官方 Codex 客户端使用的 Web 后端兼容接口读取；接口不可用或返回异常时保留最近的安全读数，并降级为请求观测或未知状态，不把错误伪装成零余额；
- 模型名称、上下文和最大输出来自当前安装的 provider catalog；推理选择器只展示已按订阅 Codex 目录核验且 Provider 能完整实现的 Low 至 Max 与模型默认值，不展示通用的 `Default`、`Off`、`Minimal`，也不把需要主动任务委派的 `Ultra` 伪装成普通推理档位；
- Fast 仅用于 GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 和 Terra，并会提高额度消耗；其他模型不会发送 Fast service tier；
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
