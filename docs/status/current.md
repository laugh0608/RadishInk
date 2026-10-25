# 当前状态

更新时间：2026-10-25。

**`v26.10.2-dev` 已完成主线集成、附注 tag 与 GitHub 源码 Pre-release 发布。** [PR #4](https://github.com/laugh0608/RadishInk/pull/4) 通过远程必需检查后合入 `main`，合并提交为 `89b5cc2`，已快进回流并推送 `dev`；[Release](https://github.com/laugh0608/RadishInk/releases/tag/v26.10.2-dev) 为非 Latest 的开发预发布。Vercel 已部署候选代码，公网版本与静态资源检查通过，详细证据见 [发布记录](../records/2026-10-25-v26.10.2-dev.md#实际发布结果)。

P1 / P2 的手机真机与真实公众号验收按用户要求延后至有时间或开发稳定后，仍为未验证项。P3 方案与原型已提交为 `7914b63`；**P3-1 持久化与 P3-2 本地账号 / 文章 API 已实现并本地验证**。P3-1 基线为 `4a354e9`；P3-2 已复查并纳入 `dev` 本地提交，仅经 loopback 验证，见 [账号与 API 操作说明](../development/server-http.md) 与 [实施记录](../records/2026-10-25-server-local-api.md)。P3-3 Web 工作区已在本地实现并通过正式构建浏览器验证，已按后续授权纳入 `dev` 本地提交，见 [Web 操作说明](../development/server-web.md) 与 [实施记录](../records/2026-10-25-server-web-workspace.md)。下一步为 P3-4 OIDC，尚未对外部署。

## 实际基线

- 主线与 tag 指向 `89b5cc2`，内容与已验证候选 `317d8b7` 完全一致；`dev` 已完成回流。本次发布结果补记作为后续文档提交保留在 `dev`，不移动已发布 tag。PWA 与桌面修复分别为 `8dadd46`、`ffc2a47`。
- 浏览器文章使用现有 `wemd-history` v3；v2 仍先下载备份并确认升级。超过 30 篇的旧文保留，上限仅拒绝新增，失败不清库、不伪造已保存。
- 目录新建 / 导入形成 `index.md` + `asset/`，旧文本保留原位；显式复制、整包移动 / 删除、冲突副本、日志恢复与缺失 ID 的旧 JSON 恢复延续前轮实现。
- 系统目录启动只查询权限，缺权保留模式并提供重新授权 / 重选入口；维护界面可重新授权原目录。专用浏览器完整进程重启后恢复、真实目录移动和冲突副本已有补测。无热更新的系统文件权限拒写 → 保留输入 → 恢复权限 → 保存通过；Chrome 网站开关与已有句柄授权的差异单独记录。
- 图片粘贴 / 选择已接入浏览器和目录文章包；保存原始字节，正文使用相对路径，预览派生并释放 Blob URL。旧单文件需显式复制为文章目录，外链不自动下载。
- 图片资源提交后才插入编辑锚点；失败不插入引用，切换 / 取消 / 撤销阻止迟到插入，删除引用不自动删资源。格式和限额见存储契约。
- 文件菜单默认导出文章 ZIP，支持导入为新文章及两种存储往返；缺图、非法包和资源读取错误明确失败。纯 Markdown 仍为仅文本抢救入口。
- 含本地图片时，HTML / 公众号复制仍明确停止，提供 ZIP 解压后手工插图的路径；拖图与孤立资源清理未开放。
- PWA 新版安装后只提示；用户确认后先保存，再检查同作用域其他页面并激活、重载。忙碌、保存失败、权限不足和超时会停止流程并保留输入。历史版首次迁入需保存、关闭全部页面后重开；不清库、不注销 Worker。
- Safari 27.0.1 / Firefox 158.0.1 的浏览器存储、图片预览、ZIP 下载与回导、刷新恢复及安全更新通过桌面实测。Mermaid 预览使用与现有公众号 PNG 一致的白色画布，标签继承图表配色，修复暗色模式文字与箭头低对比问题；不改变用户显式图表配置。
- 上一版本 `v26.10.1-dev` 保留，见 [历史记录](../records/2026-10-06-v26.10.1-dev.md)。本轮仅发布源码，Docker / 桌面发布工作流仍停用。

## 分期与下一步

| 顺序 | 目标                                                                                  | 当前状态                                           |
| ---- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| P1   | [界面与工具栏](../planning/editor-interface.md)                                       | 已合入开发预发布；真实使用环境验收延后             |
| P2a  | [文章目录与资源](../planning/article-assets.md)                                       | 存储、恢复、图片、预览与系统补测修正已合入         |
| P2b  | [可移植文件闭环](../planning/markdown-file-import-export.md#下一阶段文章包与文件菜单) | ZIP 与跨存储往返已合入并验证；公众号与手机实测延后 |
| P3   | [服务器工作区契约](../planning/server-workspace-contract.md)                          | P3-3 Web / 账号 / API 已本地验证；OIDC 待实施      |
| P4   | [自托管与账号](../planning/self-hosted-storage.md)                                    | Compose 交付待 P3；未启用真实部署配置              |

完整依赖见 [工作区演进计划](../planning/writing-workspace-roadmap.md)。P2a / P2b 共同满足后才宣称“图片随文且可移植”，本地图片转存到公众号另需实际证据。

## 接下来的事项

阶段集成与本次开发预发布已完成，后续按用户安排推进：

1. **P3-3 本地收尾与后续 P3-4。** P3-2 已提交 `7476a45`；P3-3 已实施 runtime config、能力发现、服务器适配、图片 / ZIP / 冲突 / 断网、手机端文章入口和多标签退出 / BFCache 私有缓存保护，已按后续授权纳入 `dev` 本地提交。本轮未推送、部署。后续按 [实施顺序](../planning/server-workspace-contract.md#实施顺序与验收) 推进 P3-4 OIDC，再进入 P4 Compose；真实发行方配置和联调需对应授权。
2. **P1 / P2 真实使用环境验收延后。** 用户有时间或开发进展稳定后，再补手机真机的存储入口、图片、ZIP 下载回导，以及 [公众号验收](../deployment/wechat-acceptance.md) 的粘贴、保存重开、手机明暗、行高、公式和解包后手工插图。桌面证据不能代替这些结果，本地图片自动转存仍不承诺。

## 当前产品与停止线

- 前轮方案已按要求提交 `7914b63`；P3-1 已纳入 `dev` 本地提交 `4a354e9`，P3-2 已复查纳入本地提交 `7476a45`，P3-3 已按后续授权纳入 `dev` 本地提交；均未推送或发布。新增服务端 CI 矩阵尚无远程运行结果，Ruleset context 保持不变；后续部署、镜像发布及跨仓库 OIDC 配置需要对应授权。
- 不迁移真实用户数据；旧文、配置、未知 frontmatter 和目录原件保留，不为升级清库、降级或静默覆盖。
- 升级前 JSON 不含后续资源，纯 Markdown 也不含图片；浏览器逻辑包不自动写回源文件旁边，目录应备份完整文章包。
- Docker 为自托管服务器工作区，不自动同步；通用插件、桌面启用、公共图床、官方云、计费和实时协作不在当前范围。

## 验证状态

P3-2 服务端 Lint / build 与 78 项测试通过，完整 Web 基线通过；真实 TTY 管理员初始化 / 恢复、loopback HTTP 越权与撤销、图片完整解码、Linux 双架构原生 smoke 均通过。四账号各约 63 MiB 的容量探针在 macOS 与 Linux arm64 通过，服务峰值 RSS 约 1154 / 894 MiB；精确范围和限制见 [P3-2 验证记录](../records/2026-10-25-server-local-api.md)。P3-3 已补齐正式 Web 构建 + Nest API 的本机 Chrome 闭环：静态无 API、子路径、图片 / ZIP、409、丢响应幂等重试、断网与多标签退出、私有弹窗遮蔽、实际 BFCache 恢复和生产 SW API 边界。完整基线为治理 59、core 64、Web 785、服务端 78 项通过，Lint 仅保留 12 条既有警告；详见 [P3-3 验证记录](../records/2026-10-25-server-web-workspace.md)。远程 CI 仍未执行。

P3-1 正式驱动与仓储验证通过：服务端 Lint / build / 测试，完整 Web 基线及治理负向检查通过；Linux arm64 / x64 均验证编译产物、五个 SIGKILL 阶段及独立 tmpfs 真实 ENOSPC，详见 [P3-1 验证](../records/2026-10-25-server-storage-foundation.md#验证)。这些存储故障证据不替代真实持久卷断电恢复、Compose 或 Radish 登录验收。前轮 13 项标准库实验仍保留在 [技术收敛记录](../records/2026-10-25-p3-design-probe.md)。

`v26.10.2-dev` 候选完整 Web 基线通过：治理 53、core 64、Web 748 项；Lint 0 错误、12 条既有警告，生产构建、打包依赖审计、版本与 tag 一致性、浏览器 smoke 通过，详见 [发布验证](../records/2026-10-25-v26.10.2-dev.md#验证与延期事项)。[远程 CI](https://github.com/laugh0608/RadishInk/actions/runs/40168787085) 的 Repo Hygiene、Web Quality、Candidate Quality 全部成功后已合并；本轮未使用管理员 bypass。

Safari / Firefox 原生结果见 [桌面验收](../records/2026-10-25-desktop-browser-acceptance.md)；历史迁入、后续离线升级、失败保护、相对部署与目录恢复见 [PWA 验证](../records/2026-10-25-pwa-safe-update.md#验证)；ZIP 与跨存储往返见 [P2b 验证](../records/2026-10-19-article-zip.md#验证)。真实系统权限、OPFS 替身、响应式模拟与手机真机分别标注；延期项目不互相替代。

## 既有记录入口

- [目录文章接入](../records/2026-10-14-directory-article-storage.md)、[浏览器文章接入](../records/2026-10-14-browser-article-storage.md)、[P2a 存储原型](../records/2026-10-14-article-storage-prototype.md)、[P1 实现](../records/2026-10-14-editor-interface-p1.md)、[前轮收尾](../records/2026-10-14-day-review.md)。
- [Markdown 单文件](../records/2026-10-06-markdown-file-import-export.md)、[关于与帮助](../records/2026-10-06-information-dialogs.md)、[许可切换](../records/2026-10-06-license-transition.md)、[依赖分发复核](../records/2026-10-05-web-license-review.md)。
- [公众号行高修复](../records/2026-10-06-wechat-line-height.md)、[官方检测器对照](../records/2026-10-06-wechat-official-check.md)、[公众号验收步骤](../deployment/wechat-acceptance.md)。
- [远程 PR 初始化](../records/2026-10-05-remote-pr-initialization.md)、[PR CI 验证](../records/2026-10-05-pr-ci-validation.md)、[Vercel 部署证据](../records/2026-10-05-vercel-dev-deployment.md)、[推送前审阅](../records/2026-10-05-pre-push-review.md)。

历史记录保留当时事实，其旧停止线不覆盖本页与后续用户明确要求。
