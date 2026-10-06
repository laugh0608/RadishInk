# RadishInk 文档

正式文档放在本目录，代码行为以实现与验证证据共同确认；过期文档不能覆盖真实结果。

首个开发版的范围、验证及发布边界见 [v26.10.1-dev 源码预发布记录](records/2026-10-06-v26.10.1-dev.md)。

| 需要了解的内容                     | 文档                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| 当前进度、停止线、下一步           | [当前状态](status/current.md)                                         |
| 产品定位及模块范围                 | [产品范围](product-scope.md)                                          |
| 关于与帮助弹窗实施及验证           | [弹窗实现记录](records/2026-10-06-information-dialogs.md)             |
| 公众号行高警告修复与复测边界       | [行高修复记录](records/2026-10-06-wechat-line-height.md)              |
| 官方检测器新旧版本及真实剪贴板对照 | [官方检测对照记录](records/2026-10-06-wechat-official-check.md)       |
| 微信官方规范、检测及调试仓库       | [公众号编辑器参考渠道](development/wechat-editor-references.md)       |
| 关于、许可与帮助的弹窗交互         | [信息弹窗重构计划](planning/information-dialogs.md)                   |
| Markdown 文件进出与可移植性        | [Markdown 文件导入导出契约](planning/markdown-file-import-export.md)  |
| Markdown 单文件实现与验证          | [文件进出实现记录](records/2026-10-06-markdown-file-import-export.md) |
| 扩展点、插件生命周期与隔离         | [插件系统规划](planning/plugin-system.md)                             |
| mise、依赖、开发服务器             | [本地开发](development/local-development.md)                          |
| Web 品牌、外部请求与旧配置         | [Web 品牌与外部服务](development/web-brand-and-services.md)           |
| 本地 / PR / 发布的检查粒度         | [验证基线](development/validation.md)                                 |
| 协作与文档维护                     | [协作细则](governance/agent-collaboration.md)                         |
| 仓库规范与 CI 契约                 | [仓库治理](governance/repository-governance.md)                       |
| 分支与合并决策                     | [ADR 0001](adr/0001-branch-and-pr-governance.md)                      |
| 版本、Git tag 与 Docker 标签       | [版本规则](governance/versioning.md)                                  |
| 许可切换与分发验证                 | [许可切换记录](records/2026-10-06-license-transition.md)              |
| 来源、许可和上游更新               | [上游维护](governance/upstream.md)                                    |
| Vercel 配置及上线前检查            | [部署说明](deployment/vercel.md)                                      |
| 公众号合成样例与人工验收步骤       | [公众号验收](deployment/wechat-acceptance.md)                         |
| Vercel 本地准备与未验证项          | [验收准备记录](records/2026-10-05-vercel-acceptance-preparation.md)   |
| dev 远程部署与自定义域名检查       | [部署记录](records/2026-10-05-vercel-dev-deployment.md)               |
| 当日提交回顾、文档核对与收尾       | [2026-10-05 收尾记录](records/2026-10-05-day-review.md)               |
| GitHub 保护模板的启用步骤          | [Rulesets](../.github/rulesets/README.md)                             |
| Web 品牌与默认请求整理结果         | [Web 品牌整理记录](records/2026-10-05-web-brand-and-services.md)      |
| 依赖声明与实际打包范围复核         | [依赖分发复核记录](records/2026-10-05-web-license-review.md)          |
| 推送前审阅、HTML 边界与验证        | [推送前审阅记录](records/2026-10-05-pre-push-review.md)               |
| 远程分支与首个 PR                  | [远程初始化记录](records/2026-10-05-remote-pr-initialization.md)      |
| 未来规划、Actions 启用与 PR 阻断   | [PR CI 验证记录](records/2026-10-05-pr-ci-validation.md)              |
| 协作约定对照与版本规则调整         | [治理扩充记录](records/2026-10-05-governance-followup.md)             |
| 本轮初始化验证                     | [初始化记录](records/2026-10-05-bootstrap.md)                         |

入口文件提供导航；长期规则放治理文档和 ADR；未来能力的专题设计放 `planning/`；正在做的事放 `status/`；已完成的过程和证据放 `records/`。按任务读取，避免默认加载所有历史。
