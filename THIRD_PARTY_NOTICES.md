# 第三方声明 / Third-party notices

本项目的运行时组合依赖下列独立发布包。每次发布附带的 CycloneDX SBOM 是从已提交 lockfile 与 package manifest 离线生成的锁定参考依赖图，不代表某次安装实际得到的完整传递依赖树。发布证据会另存精确 DSH runtime 与隔离安装的实际依赖树；许可证仍以各依赖发布包内的 manifest 与许可证文件为准。

This project composes the following independently published packages. Each release's CycloneDX SBOM is a locked reference dependency graph generated offline from the committed lockfile and package manifest; it is not a claim about the complete transitive tree produced by a particular installation. Release evidence separately records the actual trees installed with the exact DSH runtime and in the isolated import environment. Each published dependency's manifest and license files remain authoritative for its license terms.

| Package | Role | License |
| --- | --- | --- |
| `@deepseek-ai/cordis` | Plugin runtime | MIT |
| `@deepseek-ai/dsh-authorization` | OAuth flow registry and interaction seam | MIT |
| `@deepseek-ai/dsh-client-connection` | Web client connection injection | MIT |
| `@deepseek-ai/dsh-client-locale` | Web client locale service | MIT |
| `@deepseek-ai/dsh-client-runtime` | Web client plugin runtime | MIT |
| `@deepseek-ai/dsh-client-ui-conversation` | Conversation composer slot integration | MIT |
| `@deepseek-ai/dsh-client-ui-model-selection` | Current-session model directory integration | MIT |
| `@deepseek-ai/dsh-client-ui-sidebar` | Sidebar footer slot integration | MIT |
| `@deepseek-ai/dsh-client-ui-settings` | Web settings-page integration | MIT |
| `@deepseek-ai/dsh-commands` | Harness command registration | MIT |
| `@deepseek-ai/dsh-credentials` | Credential-store contracts | MIT |
| `@deepseek-ai/dsh-llm` | Harness LLM contracts | MIT |
| `@deepseek-ai/dsh-llm-pi-ai` | Published DSH/pi-ai adapter | MIT |
| `@deepseek-ai/dsh-settings` | Harness settings service | MIT |
| `@deepseek-ai/schemastery` | Plugin configuration schema | MIT |
| `@earendil-works/pi-ai` | Public Codex provider, OAuth, model catalog, transport | MIT |

项目使用这些公开依赖不表示其作者对本项目背书。任何依赖 license、版本或来源变化都必须更新锁文件、SBOM、本文件和发布证据。

Use of these public dependencies does not imply endorsement by their authors. Any dependency license, version, or source change requires an updated lockfile, SBOM, this notice, and release evidence.
