# 验证基线

本地使用 `mise exec -- pnpm <命令>`；CI 已配置 Node 与 pnpm，可直接用 `pnpm`。

| 阶段 / 改动           | 最低验证                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| 文档与仓库基础文件    | `pnpm check:repo`、`git diff --check`                                                     |
| 可执行治理与 CI       | 上述检查、`pnpm test:governance`，核对 Ruleset 与聚合失败传播                             |
| Web / core 功能       | 对应测试与 Lint；涉及类型、依赖或构建时增加 Web build                                     |
| 服务端持久化 / API    | `pnpm validate:server`；补充对应故障、HTTP 与身份边界；存储 / 原生驱动需 Linux 双架构验证 |
| 合入 `main` 的阶段 PR | `pnpm validate:web`、`pnpm validate:server`，说明真实浏览器与公众号验收情况               |
| 部署 / 发布           | 完整基线、浏览器 smoke、真实公众号粘贴、许可与外部请求检查                                |

`pnpm check:release-tag --tag <候选标签>` 只读验证未来 Git / Docker 命名并输出元数据；`test:governance` 同时覆盖格式边界、轨道别名和停用 Docker 模板的实际元数据命令。历史 tag 不纳入新格式检查，详情见 [版本规则](../governance/versioning.md)。

`validate:web` 顺序运行仓库检查、治理负向测试、Web Lint、core 与 Web 测试及 Web 构建。桌面端 / 服务端未纳入此命令；修改它们时另行检查对应包，不得声称整个 monorepo 已验收。

`validate:server` 运行服务端无自动修复 Lint，再由 `test:server` 构建最新编译产物并运行 Jest；子进程故障测试实际加载该产物。CI 的 `Server Quality` 在 Linux x64 / arm64 安装依赖并运行这些检查，`Candidate Quality` 只在仓库、Web、服务端全部成功时通过。代码与本机维护入口见 [服务端持久化](server-storage.md)，当前证据及远程未执行项见 [P3-1 记录](../records/2026-10-25-server-storage-foundation.md)。

`test:governance` 包含声明生成回归，覆盖双许可独立分发、上游原文保留、分发副本漂移、缺失 / 空白许可文本、来源摘要变更、路径越界和可重复输出；正常 `build:web` 会在构建前重新生成依赖声明。核对真实应用打包范围时另运行 `mise exec -- node scripts/audit-web-bundle.mjs`，说明输出适用的锁文件和构建状态。

`test:governance` 还覆盖 Vercel 部署过滤与内容去重：真实 Git 合并回流、实际变更、上次成功部署基线、首次部署、缺失历史及 Git 错误。跳过构建的退出码约定与手动重建方式见 [部署规则](../deployment/vercel.md#自动部署与重复构建)。

## 仓库检查的范围

`check:repo` 总是检查必需文件、文档相对链接、工具版本约束、配置解析、发布暂停状态及 CI / Ruleset 契约。文本卫生默认覆盖本地已改动和未跟踪文件；CI 提供 `--base-ref <SHA> --head-ref <SHA>` 后覆盖 PR 文件与提交范围。

导入的 WeMD 基线及真实 merge commit 不要求重写标题。后续上游同步需要显式 `--upstream-ref <SHA>` 并经维护者核实来源；常规 PR 不自动接受来源豁免。该检查不是秘密扫描器、许可证审计或完整 GitHub 执行器。

## 浏览器与公众号

使用临时浏览器数据，准备含标题、列表、引用、代码、表格、公式、Mermaid 和图片的文章，分别记录：

1. 编辑和预览是否正常，控制台是否出现新错误。
2. 草稿刷新恢复及主题切换是否正常；Markdown 单文件导入、编辑后立即下载、重新导入及未知 frontmatter 往返是否成立。目录 API 替身与真实目录授权、触屏模拟与真机分别记录。
3. 复制是否写入所需 HTML，失败提示是否明确。
4. 在真实公众号编辑器中粘贴后的效果，包括深色模式、公式与表格。
5. 渲染 / HTML 处理链路改动时，使用仅设置临时内存标记的合成原生 HTML 验证事件属性、危险 URL 和嵌入内容不会执行；检查普通排版、公式、图表与两种复制仍可用，原始草稿刷新后仍保留。

Safari / Firefox 桌面的原生选择器、图片、ZIP、刷新恢复及更新验证见 [桌面验收记录](../records/2026-10-25-desktop-browser-acceptance.md)。图表预览另检查明暗模式、主题预览 iframe 与显式 Mermaid 配色，避免文章段落样式覆盖图表标签；该结果不替代手机真机或公众号后台验收。

不要为自动化方便清空用户已有浏览器数据、授予生产账号权限或上传真实文章。浏览器 smoke 不代替公众号后台验收，后者没有执行就记录“未验证”。

使用 [公众号验收步骤与判据](../deployment/wechat-acceptance.md) 及其合成样例，分别核对粘贴后、保存重开后与手机明暗效果。

结构警告调查按 [公众号编辑器参考渠道](wechat-editor-references.md) 固定官方检测器版本，并区分导出 DOM、剪贴板及粘贴后的 HTML；官方工具是辅助证据，不替代真实公众号验收。

## PWA 更新

修改 Worker 注册、激活、缓存或资源加载失败处理时，除相关测试和完整 Web 基线外，必须使用固定生产构建验证旧版到新版。覆盖延后、未保存正文、图片 / ZIP 进行中、保存失败、多个页面、接管失败与重试、浏览器文章 / 目录包及原图恢复。相对部署、离线已缓存升级和目录缺权后的重新授权也需记录。

历史版本首次关闭重开迁入，与具备安全更新提示后的后续升级是两组证据；OPFS 权限替身、系统目录授权和手机真机分别标注。实施契约与复现入口见 [PWA 安全更新](pwa-updates.md)，本轮结果见 [更新记录](../records/2026-10-25-pwa-safe-update.md)。

## 工作区演进的验证入口

[工作区演进计划](../planning/writing-workspace-roadmap.md) 的 P1 已在本地实施，实际命令与浏览器结果见 [P1 验证记录](../records/2026-10-14-editor-interface-p1.md)。P2a 已完成存储契约与迁移恢复原型的合成检查，命令、原生 IndexedDB / OPFS 证据和未验证项见 [原型验证记录](../records/2026-10-14-article-storage-prototype.md)。浏览器备份升级入口与实际读写已完成本地验证，命令与边界见 [接入验证记录](../records/2026-10-14-browser-article-storage.md)。目录包与旧 JSON 恢复的验证见 [目录接入记录](../records/2026-10-14-directory-article-storage.md)，其中注入目录选择器的 OPFS 产品流程仍不是系统目录授权证据。系统目录真实权限和图片入口证据见 [权限与图片记录](../records/2026-10-19-article-images.md)，进程重启 / 系统恢复补测及 ZIP / 跨存储往返见 [P2b 记录](../records/2026-10-19-article-zip.md)。下表继续维护完整阶段验收要求，不能把浏览器接入当作完整 P2a 或 P2b / P3 / P4 已完成：

| 阶段    | 验证重点与单一详细来源                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1      | [界面验收](../planning/editor-interface.md#验收)：图床 / AI 无可触达调用、文件菜单复用、按容器宽度渐进收纳、浮层实际可见、键盘与触屏                           |
| P2a     | [资源验收](../planning/article-assets.md#验收重点)：两种存储持久化、图片预览、迁移中断、配额 / 权限、文章归属与资源生命周期                                    |
| P2b     | [ZIP 验收](../planning/markdown-file-import-export.md#验收)：正文与资源跨存储往返、缺失资源、最新快照、恶意 / 损坏包、浏览器下载；公众号图片转存另测           |
| P3 / P4 | [自托管验收](../planning/self-hosted-storage.md#验证与发布条件)：后端集成、多用户负向测试、会话 / 缓存、冲突、Compose 与备份恢复；新增后端验证命令在该阶段落地 |

仅文档规划仍按文档检查执行。P3-1 已新增独立服务端检查并同步 CI / 聚合负向测试；Compose、HTTP 身份隔离和 OIDC 未完成，不能把上表要求当作全部机器门禁已生效。

P3 技术决策原型可用 `mise exec -- node --test scripts/prototypes/server-commit-probe.mjs` 复现，覆盖真实子进程中止、版本竞争与幂等重试；结果及其缩小模型见 [决策验证记录](../records/2026-10-25-p3-design-probe.md)。它使用实验性 `node:sqlite`，不是生产后端测试，不纳入 `validate:web`；正式服务端切片与新增门禁见 [P3 验证计划](../planning/server-workspace-contract.md#实施顺序与验收)。

P3 的 Radish OIDC 另覆盖真实发行方往返、账号关联与准入、相同邮箱不误合并、回调 / Token 校验与重放、退出范围、公钥 / 客户端密钥轮换及上游故障；详见 [OIDC 实施与验收](../planning/self-hosted-storage.md#实施与验收)。协议替身和本地密码登录不能替代该证据。

## 失败与记录

记录命令、版本、结果及必要错误摘要。构建警告与失败区分，既有问题与本次回归区分；不得用 `continue-on-error`、空测试或忽略退出码掩盖失败。

初始化证据见 [2026-10-05 记录](../records/2026-10-05-bootstrap.md)。GitHub 自动 PR 运行、缺少必需检查和组件失败的阻断证据见 [PR CI 验证记录](../records/2026-10-05-pr-ci-validation.md)；后续每个 PR 仍需核对最新提交的检查，不能沿用历史成功作为放行依据。
