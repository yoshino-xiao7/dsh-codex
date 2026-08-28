# 兼容性与支持边界

[简体中文](compatibility.md) | [English](compatibility.en.md)

最近更新：2026-08-29。

| 组件或环境 | `0.0.1` 证据 | 状态 |
| --- | --- | --- |
| DeepSeek Harness | `test/fixtures/dsh-runtime/pnpm-lock.yaml` 锁定完整 `@deepseek-ai/dsh@0.1.1-rc.2` runtime/peer 图，并验证 `dsh-llm` schema 与 stream contract | 精确版本已验证 |
| pi-ai | `@earendil-works/pi-ai@0.82.1` 的 OAuth、模型目录、Codex payload 与 replay 合同测试 | 公开合同已验证；真实登录待验收 |
| Node.js | 本地 `22.22.2` 完整测试；CI 覆盖 22 与 24 | `>=22.19.0 <25` |
| macOS arm64 | 本地测试、构建、attachment seam 与隔离 profile 启动 | 部分验证 |
| Windows x64 | 源码路径没有本项目原生模块 | CI 与真机待验证 |
| Linux x64 | 源码路径没有本项目原生模块 | CI 待验证 |
| ChatGPT OAuth 真实登录 | 自动化不读取或修改用户真实 grant | 受控验收待完成 |
| Codex 真实网络对话 | 自动化不消耗用户账户配额 | 受控验收待完成 |
| 文本 / reasoning / usage / 工具 / replay | 公开 PiAiAdapter 成功流、工具调用和两轮 replay 自动化已通过 | 真实 reasoning、工具闭环与连续对话待验收 |
| Codex 图片输入 | attachment seam 与预算投影自动化已通过 | `maxPixels=4194304` 真实请求待验收 |
| auto / SSE / WebSocket / cached | transport 映射与会话隔离自动化已通过 | 四种真实请求待验收 |
| Fast / priority tier | 已验证仅在当前会话开启时改变 `service_tier` | 账号权限与真实网络待验收 |
| npm / GitHub Release | 严格工作流校验候选、Registry 回读与 Release 资产 | 以公开 Registry/Release 记录为准 |

`0.0.x` 是技术预览，只对表中的精确 DSH prerelease 声明兼容。根目录 `pnpm-lock.yaml` 锁定插件依赖，`test/fixtures/dsh-runtime/pnpm-lock.yaml` 独立锁定兼容性 smoke 的完整 DSH runtime 与 peer 图；CI 使用 `pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts`，不把该 peer 图交给直接 npm 解算，以避免不确定依赖结果和内存失控。该冻结层验证 Web/profile 集成，不声称覆盖 DSH 依赖中需要生命周期脚本的原生终端或本机构建能力。依赖升级必须通过固定版本变更 PR，同时更新并审查两套 lockfile，再完成完整 CI、profile smoke 与受控验收；定时兼容工作流只验证当前锁定图并报告 Registry 漂移，不能从宽泛 semver 或一次定时运行推断跨 RC 兼容。

## Profile 组合

`0.0.1` 的 bundle 不修改通用 `llm-pi-ai` Cordis row。它新增：

- `dsh-codex` route；
- `dsh-codex` 设置命名空间；
- `dsh-codex/openai-codex` OAuth 凭据记录与登录流程。

其他 pi-ai provider 可以在同一 profile 中继续使用。本插件不注册通用 configurable-provider directory；模型选择由本插件设置页管理。若用户另外启用通用 `openai-codex`，模型选择器会显示两个不同 route 的 Codex provider 组，两个凭据范围互不读取或迁移。

## 模型与会话能力

模型目录来自安装的 pi-ai `0.82.1`，不是在线动态目录。设置页至少要求选中一个模型；全选且条目没有自定义字段时移除模型覆盖并随以后版本的目录更新；部分选择或已有自定义字段时保留显式配置。未配置 `models` 时展示完整目录，显式空数组则不展示任何模型；精确指定的隐藏模型仍可解析，因此旧会话不会因目录筛选失效。

图片只发送给明确声明 `image` input 的模型。text-only 模型在 provider I/O 前拒绝图片。

`/codex` 的 Fast 和 transport 偏好只存在于当前进程、当前会话。重启、插件卸载或执行 `/codex reset` 后恢复默认值。Fast 默认关闭；失败后不会自动降级重放。

## 凭据与功能边界

- Codex route 只接受 ChatGPT OAuth，不读取 OpenAI Platform API key；
- 请通过插件设置页或 `/codex-login cancel` 取消登录：写入线性化前会正常取消，提交已经开始时会明确提示无法取消并继续等待最终状态；`logout` 始终删除凭据。DSH 当前公共 seam 没有“提交后禁止取消”能力，第三方代码直接调用 `ctx.authorization.cancel()` 会绕过这一协调，不属于 `0.0.1` 支持的交互路径；
- 插件或热重载 flow owner 卸载时，提交选择前的登录会取消，已经进入凭据提交的登录会等待最终写入再完成卸载；不支持类型或结构损坏的已存记录显示为 `invalid`，需要重新登录或退出清除，不会显示为已登录；
- 额度卡只显示请求产生的最近观测，不提供实时余额、百分比或主动账户查询；
- DSH 的 Web search 使用它自己的 provider 和凭据，不复用 ChatGPT OAuth；
- `0.0.1` 不提供图片生成或编辑；
- 会话压缩继续使用 DSH 自带的自动压缩和 `/compact`。
