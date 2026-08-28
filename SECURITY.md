# 安全策略 / Security Policy

## 中文

### 支持范围

`0.0.1` 发布后，仅最新 `0.0.x` 获得安全修复。支持范围以 [兼容性矩阵](docs/compatibility.md) 的精确 DSH/pi-ai/Node 版本为准；尚未完成的真实账号或平台验收不应被视为安全保证。

高优先级问题包括：OAuth grant/token 泄漏、浏览器端收到凭据、错误或日志回显敏感 JSON、未授权网络目标、图片预算绕过、账户 quota 无限重试，以及流重放造成重复工具副作用。

### 私下报告

优先使用 GitHub **Private vulnerability reporting**。若入口不可用，请使用[安全私下联络回退表单](https://github.com/yoshino-xiao7/dsh-codex/issues/new?template=security-contact.yml)；公开 Issue 只请求私下渠道，不得包含技术细节或秘密。

报告应包含受影响精确版本、平台、最小复现条件、影响和脱敏 code/shape。绝对不要发送 access/refresh token、OAuth code、cookie、credentials 文件、账户 ID、完整提示词、工具参数、私人路径、原图或完整 provider 响应。

如果秘密已经暴露，请先在 ChatGPT/DSH 设置中退出并撤销相关会话，再联系维护者。不要等待插件修复后才撤销。

### 披露

维护者会确认边界与复现，准备修复和新版本，再协调披露。npm 版本不可覆盖；安全修复使用递增版本。

## English

### Supported versions

After `0.0.1` is released, only the latest `0.0.x` receives security fixes. Support is limited to the exact DSH/pi-ai/Node versions in the [compatibility matrix](docs/compatibility.en.md). Pending real-account or platform acceptance is not a security guarantee.

High-priority issues include OAuth grant/token exposure, credentials reaching the browser, sensitive JSON echoed in errors or logs, unauthorized network targets, image-limit bypass, infinite account-quota retry, and stream replay that duplicates tool side effects.

### Private reporting

Use GitHub **Private vulnerability reporting** whenever available. If unavailable, use the [private security contact fallback form](https://github.com/yoshino-xiao7/dsh-codex/issues/new?template=security-contact.yml). The public issue may only request a private channel and must contain no technical details or secrets.

Include the exact affected version, platform, minimal preconditions, impact, and a sanitized code/shape. Never send an access/refresh token, OAuth code, cookie, credentials file, account ID, complete prompt, tool arguments, private path, source image, or complete provider response.

If a secret was exposed, sign out and revoke the affected ChatGPT/DSH session before contacting maintainers. Do not wait for a plugin release before revocation.

### Disclosure

Maintainers confirm scope and reproduction, prepare a fix and incremented release, and then coordinate disclosure. Published npm versions are immutable and are never overwritten.
