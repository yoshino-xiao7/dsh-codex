# 贡献指南

[简体中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

感谢你帮助维护 `dsh-codex-community`。项目优先保证凭据安全、协议准确、失败可恢复和跨平台可维护性。

## 提交 Issue

Bug 报告请提供：

- 插件、DSH、Node.js 的精确版本；
- 操作系统与架构；
- 最小复现、预期与实际结果；
- 脱敏错误 code、reset/request ID 或必要 stack；
- 是否涉及图片历史、工具调用、部分回复或 profile 覆盖。

不要提交 token、OAuth code、cookie、凭据文件、完整原始响应、私人提示词、工具参数、原图或未经检查的诊断包。安全问题遵循 [SECURITY.md](SECURITY.md)。

## 开发流程

1. 阅读 [贡献来源与许可](docs/contribution-sources.md) 和相关架构、兼容性文档；
2. 从最新 `main` 创建名称清晰、范围单一的分支；
3. 先加入能复现问题的失败测试，再实现最小修复；
4. 同步维护中文、英文文档和 CHANGELOG；
5. 运行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --dir test/fixtures/dsh-runtime install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run verify:release
```

全量测试会从冻结夹具加载精确 DSH runtime、AgentLoop 与 Retry 插件，因此必须先安装夹具依赖；不要让测试隐式使用机器上已有的 DSH 安装。

## 贡献许可

有意提交到本仓库的贡献将按本项目的 Apache-2.0 许可证提供，除非提交时明确书面说明并由维护者接受其他条款。提交贡献即表示你有权提交该内容，并有权按上述许可授予使用权；这不构成版权转让，也不要求额外 CLA。

## PR 检查表

- [ ] 变更范围单一，没有无关重构或格式噪音；
- [ ] 行为通过公开 DSH/pi-ai/OpenAI 合同或可复现黑盒观察推导；
- [ ] 变更由本人编写，或来自明确列出的公开接口与规范；
- [ ] 我有权提交全部内容，并同意该贡献按 Apache-2.0 许可提供；
- [ ] 没有提交来源不明或许可不清晰的代码、测试、文档或媒体；
- [ ] 新行为有回归，失败路径为有界或失败关闭；
- [ ] 没有秘密、账号数据、真实私有响应或机器专属路径 fixture；
- [ ] 新依赖说明了必要性、体积、license 与供应链影响；
- [ ] 中英文 README/docs/CHANGELOG 已同步；
- [ ] `pnpm run check` 通过，且说明真实网络/平台验收边界。

PR 合并不等于发布授权。tag、npm publish、GitHub Release 和社区收录由维护者按发布文档单独执行。
