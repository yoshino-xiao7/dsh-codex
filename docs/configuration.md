# 配置参考

[简体中文](configuration.md) | [English](configuration.en.md)

`dsh-codex` bundle 的生产配置位于 `codex-community.patch.yml` 的 `dsh-codex.config`。正常安装已经写入安全默认值；`models` 由设置页面按需保存，因此默认 bundle 不包含该键。

## Bundle 默认配置

```yaml
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

## 校验与生效

- 省略或写成 `null` 的布尔值、枚举、超时和图片限制会回填各自默认值；`models: null` 不表示默认目录，应省略 `models`。
- 类型错误、未知枚举、超出范围的普通数值、图片限制的小数，以及模型的未知或重复 ID 会在插件加载或设置保存时被拒绝；被拒绝的更新不会替换最后一次有效配置。
- 只应使用上表列出的有限 JSON/YAML 数值。`NaN`、无穷值和未列出的字段不属于受支持的配置接口。
- 配置更新从下一次适配器操作生效；正在进行的操作继续使用启动时捕获的不可变配置快照。
- `/codex` 的 Fast 与传输偏好是当前进程、当前会话的临时状态，不是 bundle 配置键。
