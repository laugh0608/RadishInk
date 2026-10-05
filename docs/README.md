# RadishInk 文档

正式文档放在本目录，代码行为以实现与验证证据共同确认；过期文档不能覆盖真实结果。

| 需要了解的内容               | 文档                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| 当前进度、停止线、下一步     | [当前状态](status/current.md)                                    |
| 产品定位及模块范围           | [产品范围](product-scope.md)                                     |
| mise、依赖、开发服务器       | [本地开发](development/local-development.md)                     |
| Web 品牌、外部请求与旧配置   | [Web 品牌与外部服务](development/web-brand-and-services.md)      |
| 本地 / PR / 发布的检查粒度   | [验证基线](development/validation.md)                            |
| 协作与文档维护               | [协作细则](governance/agent-collaboration.md)                    |
| 仓库规范与 CI 契约           | [仓库治理](governance/repository-governance.md)                  |
| 分支与合并决策               | [ADR 0001](adr/0001-branch-and-pr-governance.md)                 |
| 版本、Git tag 与 Docker 标签 | [版本规则](governance/versioning.md)                             |
| 来源、许可和上游更新         | [上游维护](governance/upstream.md)                               |
| Vercel 配置及上线前检查      | [部署说明](deployment/vercel.md)                                 |
| GitHub 保护模板的启用步骤    | [Rulesets](../.github/rulesets/README.md)                        |
| Web 品牌与默认请求整理结果   | [Web 品牌整理记录](records/2026-10-05-web-brand-and-services.md) |
| 协作约定对照与版本规则调整   | [治理扩充记录](records/2026-10-05-governance-followup.md)        |
| 本轮初始化验证               | [初始化记录](records/2026-10-05-bootstrap.md)                    |

入口文件提供导航；长期规则放治理文档和 ADR；正在做的事放 `status/`；已完成的过程和证据放 `records/`。按任务读取，避免默认加载所有历史。
