# 兼容性与支持边界

[简体中文](compatibility.md) | [English](compatibility.en.md)

最近更新：2026-09-04。

`1.1.3` 是当前正式版。完整检查与 Linux、macOS、Windows CI/profile smoke 必须按本版本候选重新通过并获维护者批准；发布后真实账号验证从 `0/13` 开始，不继承旧版本证据。

| 组件或环境 | `1.1.3` 兼容目标 | 状态 |
| --- | --- | --- |
| DeepSeek Harness | `test/fixtures/dsh-runtime/pnpm-lock.yaml` 继续锁定 `@deepseek-ai/dsh@0.1.1-rc.2` runtime/peer 图 | 完整检查与 profile smoke 已通过 |
| pi-ai | 锁定 `@earendil-works/pi-ai@0.84.4`，提供全局请求默认值、会话稀疏覆盖、传输 generation 与一次性诊断 seam | 合同回归已通过；真实网络验收发布后记录 |
| Node.js | 声明 `>=22.19.0 <25` | 本地与三平台 Node 22/24 门禁已通过 |
| macOS | `macos-latest` Node 22/24 完整检查、冻结 DSH 安装与 Web/profile smoke | `passed` |
| Windows x64 | `windows-latest` Node 22/24 完整检查、冻结 DSH 安装与 Web/profile smoke | `passed` |
| Linux x64 | `ubuntu-latest` Node 22/24 完整检查、冻结 DSH 安装与 Web/profile smoke | `passed` |
| ChatGPT OAuth 真实登录 | 自动化不读取或修改用户真实 grant | 受控验收待完成 |
| Codex 额度窗口 | 进入、页面重新可见、重置节点与 `/codex-usage refresh` 触发账号读取；每周不足 24 小时阈值只在本地切换显示；展示套餐、统一剩余语义与安全重置时间 | 自动化回归已通过；真实账号验收发布后记录 |
| Codex 模型设置 | 通用模型发现配合独立 loopback-only 只读能力 RPC，展示紧凑 `K` 标签、输入模态、当前安装 provider catalog 实际提供的推理档位、Fast 与已选/未选排序 | 自动化与三平台 profile smoke 已通过；RPC 不可用或未知能力不推断 |
| Codex 真实网络对话 | 自动化不消耗用户账户配额 | 受控验收待完成 |
| 文本 / reasoning / usage / 工具 / replay | 自动化覆盖文本、reasoning、usage、工具与 replay 合同 | 自动化回归已通过；真实 reasoning、工具闭环和连续对话发布后验收 |
| Codex 图片输入 | 自动化覆盖 attachment seam 与预算投影 | 自动化回归已通过；`maxPixels=4194304` 真实请求发布后验收 |
| auto / SSE / WebSocket / cached | 自动化覆盖 transport 映射与会话隔离 | 自动化回归已通过；四种真实请求发布后验收 |
| Fast / priority tier | 自动化断言只有当前会话明确开启才改变 `service_tier` | 自动化回归已通过；账号权限与真实网络发布后验收 |
| npm / GitHub Release | 严格工作流校验候选、Registry 回读、provenance、签名与 Release 资产 | 正式版 `v1.1.3` 由本次受保护工作流生成 |

`1.1.3` 保留 `1.1.2` 的服务过载分类、恢复语义与依赖基线，新增新版 Harness typed remote/settings 合同兼容层，同时保留旧版连接与设置帮助函数路径；不改变请求或隐私合同。

`1.1.3` 仍只声明精确的 DSH 预发布依赖目标。候选提交、Linux/macOS/Windows CI/profile smoke 与维护者批准记录在本版本[验收记录](releases/v1.1.3.acceptance.json)中；真实账号验证从 `0/13` 独立开始。`1.1.2` 与更早版本的记录仅作为历史证据保留，不能替代本版本门禁。

根目录 `pnpm-lock.yaml` 锁定插件依赖，`test/fixtures/dsh-runtime/pnpm-lock.yaml` 独立锁定兼容性 smoke 的完整 DSH runtime 与 peer 图；CI 使用 `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts`，不把该 peer 图交给直接 npm 解算，以避免不确定依赖结果和内存失控。该冻结层验证 Web/profile 集成，不声称覆盖 DSH 依赖中需要生命周期脚本的原生终端或本机构建能力。依赖升级必须通过固定版本变更 PR，同时更新并审查两套 lockfile，在发布前重跑完整 CI、profile smoke 和供应链校验，发布后重新记录受控真实验证。定时兼容工作流只验证当前锁定图并报告 Registry 漂移，不能从宽泛 semver 或一次定时运行推断跨 RC 兼容。

## Profile 组合

`1.1.3` 的 bundle 不修改通用 `llm-pi-ai` Cordis row。它提供：

- `dsh-codex` route；
- `dsh-codex` 设置命名空间；
- `dsh-codex/openai-codex` OAuth 凭据记录与登录流程。

其他 pi-ai provider 可以在同一 profile 中继续使用。本插件不注册通用 configurable-provider directory；模型选择由本插件设置页管理。若用户另外启用通用 `openai-codex`，模型选择器会显示两个不同 route 的 Codex provider 组，两个凭据范围互不读取或迁移。

## 模型与会话能力

模型目录来自安装的 pi-ai `0.84.4`，不是在线动态目录。设置页至少要求选中一个模型；全选且条目没有自定义字段时移除模型覆盖并随以后版本的目录更新；部分选择或已有自定义字段时保留显式配置。未配置 `models` 时展示完整目录，显式空数组则不展示任何模型；精确指定的隐藏模型仍可解析，因此旧会话不会因目录筛选失效。

图片只发送给明确声明 `image` input 的模型。text-only 模型在 provider I/O 前拒绝图片。

插件设置中的 Fast、Transport、回复详略和推理摘要是持久化全局默认值；`/codex` 只为当前进程中的精确会话保存显式稀疏覆盖。重启会清除会话覆盖但保留全局默认值，`/codex reset` 让当前会话重新继承这些默认值；传输健康统计随精确会话清理。Fast 默认关闭；失败后不会自动降级重放。

## 凭据与功能边界

- Codex route 只接受 ChatGPT OAuth，不读取 OpenAI Platform API key；
- 请通过插件设置页或 `/codex-login cancel` 取消登录：写入线性化前会正常取消，提交已经开始时会明确提示无法取消并继续等待最终状态；`logout` 始终删除凭据。DSH 当前公共 seam 没有“提交后禁止取消”能力，第三方代码直接调用 `ctx.authorization.cancel()` 会绕过这一协调，不属于 `1.1.3` 支持的交互路径；
- 插件或热重载 flow owner 卸载时，提交选择前的登录会取消，已经进入凭据提交的登录会等待最终写入再完成卸载；不支持类型或结构损坏的已存记录显示为 `invalid`，需要重新登录或退出清除，不会显示为已登录；
- 额度卡会在进入设置页、页面重新可见、额度重置节点和手动刷新时读取真实五小时与每周额度；每周不足 24 小时阈值只触发本地重新渲染。`/codex-usage refresh` 使用同一 Reader，而 `status` 只读取进程内 `QuotaObserver`。Host 只向 Web 页面返回严格解析后的窗口、百分比、重置时间与可选套餐类型，不返回 OAuth 凭据或原始响应。接口不可用或结构异常时保留最近一次安全读数，并降级为请求观测或未知状态，不把失败显示成零余额；
- DSH 的 Web search 使用它自己的 provider 和凭据，不复用 ChatGPT OAuth；
- `1.1.3` 不提供图片生成或编辑；
- 会话压缩继续使用 DSH 自带的自动压缩和 `/compact`。
