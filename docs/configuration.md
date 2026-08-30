# 配置参考

[简体中文](configuration.md) | [English](configuration.en.md)

`dsh-codex` bundle 的生产配置位于 `codex-community.patch.yml` 的 `dsh-codex.config`。正常安装已经写入安全默认值；`models` 由设置页面按需保存，因此默认 bundle 不包含该键。

## Bundle 默认配置

```yaml
defaultFast: false
defaultTransport: auto
defaultTextVerbosity: low
defaultReasoningSummary: auto
partialResponseRecovery: true
cacheRetention: short
streamIdleTimeoutMs: 300000
maxRequestImageBytes: 20971520
requestImagePixelBudget: 4194304
requestImageMaxBytes: 1048576
```

省略 `models` 表示模型选择器显示当前安装目录中的全部 Codex 模型。

## 顶层字段

| 键 | 类型与允许值 | 默认值 | 单位与行为 |
| --- | --- | --- | --- |
| `defaultFast` | 布尔值 | `false` | 无单位。模型支持 Fast 时，为没有显式会话覆盖的请求选择是否使用 priority service tier。 |
| `defaultTransport` | `auto`、`sse`、`websocket` 或 `websocket-cached` | `auto` | 无单位。作为未显式覆盖传输的会话默认值；更改后，这些会话的下一次请求会使用新的 transport generation，不继承旧连接、缓存或回退锁存。在途请求继续使用旧 generation，结束后再清理；显式覆盖传输的会话不受这次全局切换影响。 |
| `defaultTextVerbosity` | `low`、`medium` 或 `high` | `low` | 无单位。没有显式会话覆盖时使用的回复详略。 |
| `defaultReasoningSummary` | `auto`、`concise`、`detailed` 或 `off` | `auto` | 无单位。没有显式会话覆盖时使用的推理摘要形式；`off` 表示不请求摘要。 |
| `partialResponseRecovery` | 布尔值 | `true` | 无单位。开启时，流在安全纯文本之后失败可闭合文本并保存半段回复；关闭时保留错误结果，不把半段回复转换为成功。含未完成工具调用的流始终失败关闭。 |
| `models` | 模型条目数组；也可省略 | 省略 | 无单位。省略时显示全部目录模型；空数组隐藏模型选择器中的全部 Codex 模型；非空数组只显示列出的模型。已保存会话仍可按精确模型 ID 解析目录模型。 |
| `cacheRetention` | `none`、`short` 或 `long` | `short` | 无单位。原样传给 Codex 请求的上下文缓存保留策略；本插件不把这些枚举换算为固定时长。 |
| `streamIdleTimeoutMs` | 数字，`1` 至 `2147483647`（含边界） | `300000` | 毫秒。只限制等待下一段提供方流数据的空闲时间，不限制消费端处理时间；允许范围内的小数。超时产生 `TIMEOUT`。 |
| `maxRequestImageBytes` | 正安全整数，`1` 至 `9007199254740991`（含边界） | `20971520` | 字节。限制一次请求累积的 base64 图片载荷；文本、工具、图片描述和 JSON 结构不计入。超过预算时从最旧图片开始以固定文本替代。 |
| `requestImagePixelBudget` | 正安全整数，`1` 至 `9007199254740991`（含边界） | `4194304` | 像素。每张请求图片的总像素预算，并映射到 attachment 请求的 `maxPixels`。默认值等于 `2048 × 2048`。 |
| `requestImageMaxBytes` | 正安全整数，`1` 至 `9007199254740991`（含边界） | `1048576` | 原始字节。每张请求图片生成版本的字节预算，并映射到 attachment 请求的 `maxBytes`。默认值为 `1 MiB`。 |

## 模型条目

每个 `models` 条目支持以下字段：

| 键 | 必填 | 类型与范围 | 行为 |
| --- | --- | --- | --- |
| `id` | 是 | 字符串 | 必须是当前安装目录中的 Codex 模型 ID；未知或重复 ID 在配置验证时被拒绝。 |
| `name` | 否 | 字符串 | 覆盖模型显示名称；省略时使用目录名称。 |
| `contextWindow` | 否 | 正安全整数，`1` 至 `9007199254740991`（含边界） | 覆盖模型上下文窗口。 |
| `maxTokens` | 否 | 正安全整数，`1` 至 `9007199254740991`（含边界） | 覆盖模型输出上限，并成为未显式指定输出上限时的请求默认值。 |

示例：

```yaml
models:
  - id: gpt-5.4
    name: Codex
    contextWindow: 272000
    maxTokens: 128000
```

模型 ID 与能力随锁定的运行时目录变化。修改前请以设置页面发现的目录为准，不要从示例推断某个 ID 一定可用。

## 模型能力与推理档位

设置页展示的模型名称、上下文窗口和最大输出来自当前安装的 provider catalog，不是账号动态模型目录。Harness 通用 `llm.discoverModels` 提供基础目录字段；输入模态、可选推理档位和 Fast 支持由本插件独立的 loopback-only 只读能力 RPC 提供。能力 RPC 不可用时仍保留基础目录，但不显示无法证实的能力标签。会话模型选择器中的 Low 至 Max 来自当前安装 provider catalog 的实际语义，不沿用 pi-ai 的通用推理档位推断。当前目录投影如下：

| 模型 | 可选推理档位 |
| --- | --- |
| GPT-5.3 Codex Spark | Low、Medium、High、Xhigh |
| GPT-5.4、GPT-5.4 mini、GPT-5.5 | Low、Medium、High、Xhigh |
| GPT-5.6 Luna | Low、Medium、High、Xhigh、Max |
| GPT-5.6 Sol | Low、Medium、High、Xhigh、Max |
| GPT-5.6 Terra | Low、Medium、High、Xhigh、Max |

选择器不再显示并非当前目录可选档位的 `Default`、`Off` 或 `Minimal`。Codex 产品目录中的 `Ultra` 还会开启主动任务委派，并不是可由模型 Provider 单独发送的普通推理档位；本插件尚未接管 Harness 的 Agent 编排，因此不会把 `Ultra` 伪装成 `Max` 或任意 wire value。插件不会虚构或标注 catalog 未提供的默认档位；请求没有显式 effort 时，由当前 Provider 或服务端采用其默认行为。未来新增但目录尚未提供能力语义的模型仍可使用这一默认行为，但不会得到插件推断出来的档位按钮。

模型卡只展示安全能力投影真实提供的文本/图片输入、可选推理范围与 Fast 支持；未知模型不会因为名称相似而获得推理或 Fast 标签。如果旧会话仍保存了 `Off` 或 `Minimal`，输入框旁会显示“修复旧推理档位”。插件不会在打开会话时静默改写选择；只有点击该按钮后，才会移除旧的不支持显式 effort，后续由当前 Provider 或服务端采用其默认行为。修复不会展示、写入或声称一个 catalog 未提供的具体默认档位；该操作仍沿用 Harness 模型选择器的模型保存语义，因此会把当前模型保存为未来新会话的默认模型。

## 全局默认值与会话覆盖

`1.1.0` 从 `dsh-codex` 设置命名空间读取上表四个全局默认字段；设置页修改单个字段时只写回该字段，不覆盖同一命名空间的模型选择或其他配置。这些默认值由 DSH 设置持久化，重启后仍然有效。

会话内存表只保留用户明确修改的字段，解析请求时再与当前全局默认值合并。因此，已对 Fast 做显式选择的会话会保留该选择，但它未覆盖的 Transport、回复详略和推理摘要会跟随后续的全局默认值。`/codex reset` 删除当前会话的显式覆盖，而不是把四项写死为出厂值。进程重启会丢弃会话覆盖，但不丢弃持久化的全局默认值。

## 会话请求偏好

会话模型选择器左侧的闪电按钮与 `/codex set fast on|off` 修改同一份当前会话 Fast 偏好。GPT-5.4、GPT-5.5、GPT-5.6 Luna、Sol 和 Terra 开启后，从下一次请求起使用官方 Fast 的 priority service tier；关闭后，从下一次请求起恢复默认速度。Fast 目标速度为 1.5 倍，并会消耗更多额度。GPT-5.3 Codex Spark 与 GPT-5.4 mini 不会发送 Fast service tier。

相邻的 Transport 按钮与 `/codex set transport auto|sse|websocket|websocket-cached` 共用当前会话传输偏好。图形菜单显示真实当前值并可恢复自动；`auto` 由 Provider 选择，其他三项明确请求对应传输方式。

每次显式选择传输方式都会为当前精确会话切换到新的 transport generation；下一次请求不再继承旧 WebSocket 连接、调试计数与 WebSocket→SSE 回退锁存，也不影响其他会话。旧 generation 上正在进行的请求不会被关闭，而是在请求结束后清理。如果当前已选择 `auto` 但健康状态显示正在回退到 SSE，“恢复自动”仍保持可用，用于让下一次请求建立干净的传输状态。

同一菜单还提供两项真实请求偏好：

- 回复详略：`/codex set verbosity low|medium|high`，默认 `low`；
- 推理摘要：`/codex set summary auto|concise|detailed|off`，默认 `auto`。

这两项直接传给 Provider 请求层，不改写模型推理强度。`verbosity` 影响最终回复的详略；`summary` 只选择推理摘要形式，`off` 表示不请求摘要。它们与 Fast、Transport 一样从下一次请求生效。

四项控件的当前会话覆盖只保存在进程内；没有覆盖的字段使用持久化全局默认值。正在进行的请求不会因切换而改变，也不会因 Fast 失败自动降级重放。菜单底部显示的传输健康只来自当前会话的脱敏进程内统计，包括请求、连接复用、增量上下文与 SSE 回退；它不是账号侧服务状态，也不包含 response ID 或原始 WebSocket 错误。

## 校验与生效

- 省略或写成 `null` 的布尔值、枚举、超时和图片限制会回填各自默认值；`models: null` 不表示默认目录，应省略 `models`。
- 类型错误、未知枚举、超出范围的普通数值、图片限制的小数，以及模型的未知或重复 ID 会在插件加载或设置保存时被拒绝；被拒绝的更新不会替换最后一次有效配置。
- 只应使用上表列出的有限 JSON/YAML 数值。`NaN`、无穷值和未列出的字段不属于受支持的配置接口。
- 配置更新从下一次适配器操作生效；正在进行的操作继续使用启动时捕获的不可变配置快照。
- 全局默认值是 bundle 配置键；模型选择器、相邻会话请求菜单和 `/codex` 修改的是当前进程内的会话覆盖。
