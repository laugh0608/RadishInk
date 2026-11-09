# 当前状态

2026-11-09 更新。128 项基础源码已复核 114 项，其中 Debian 63 项、aports 51 项。Server 两架构各 88 个安装包的版权摘要已比对，固定 libyuv 归档已按上游内容摘要和 Git 树复核。[Debian 复核](../records/2026-11-09-debian-source-completion.md) · [aports 复核](../records/2026-11-09-aports-source-review.md)

P1 / P2 与 PWA 已进入开发预发布；P3 / P4 源码已通过 PR #5 集成并回流，P4 阶段尚未关闭。镜像声明与锁定 native 源码、固定版本 Compose 与受控维护、基础源码伴随包及双镜像记录工具均已本地实现并验证，证据分别见[分发记录](../records/2026-11-03-image-distribution.md)、[编排记录](../records/2026-11-03-release-compose.md)和[发布材料记录](../records/2026-11-03-release-materials.md)。128 项基础源码尚未收齐，真实伴随包与成对发布、远端保护及新增 CI 仍待取得证据；真实 OIDC、手机 / 公众号及真实环境延期项继续保留。

从[能力专题地图](../planning/topics.md#当前接续工作的追踪方式)定位以下工作的主要归属、任务和验收来源；本页维护实际阶段与接续状态，地图不另建进度表。

## 实际基线

- Git 集成与发布的历史提交、tag 和远程观察见[原记录快照](../records/planning-sources-before-alignment-2026-11-01.md#实际基线)；本页不将历史分支位置作为实时工作区状态。
- 浏览器文章使用现有 `wemd-history` v3；v2 仍先下载备份并确认升级。超过 30 篇的旧文保留，上限仅拒绝新增，失败不清库、不伪造已保存。
- 目录新建 / 导入形成 `index.md` + `asset/`，旧文本保留原位；显式复制、整包移动 / 删除、冲突副本、日志恢复与缺失 ID 的旧 JSON 恢复延续前轮实现。
- 系统目录启动只查询权限，缺权保留模式并提供重新授权 / 重选入口；维护界面可重新授权原目录。专用浏览器完整进程重启后恢复、真实目录移动和冲突副本已有补测。无热更新的系统文件权限拒写 → 保留输入 → 恢复权限 → 保存通过；Chrome 网站开关与已有句柄授权的差异单独记录。
- 图片粘贴 / 选择已接入浏览器和目录文章包；保存原始字节，正文使用相对路径，预览派生并释放 Blob URL。旧单文件需显式复制为文章目录，外链不自动下载。
- 图片资源提交后才插入编辑锚点；失败不插入引用，切换 / 取消 / 撤销阻止迟到插入，删除引用不自动删资源。格式和限额见存储契约。
- 文件菜单默认导出文章 ZIP，支持导入为新文章及两种存储往返；缺图、非法包和资源读取错误明确失败。纯 Markdown 仍为仅文本抢救入口。
- 含本地图片时，HTML / 公众号复制仍明确停止，提供 ZIP 解压后手工插图的路径；拖图与孤立资源清理未开放。
- PWA 新版安装后只提示；用户确认后先保存，再检查同作用域其他页面并激活、重载。忙碌、保存失败、权限不足和超时会停止流程并保留输入。历史版首次迁入需保存、关闭全部页面后重开；不清库、不注销 Worker。
- Safari 27.0.1 / Firefox 158.0.1 的浏览器存储、图片预览、ZIP 下载与回导、刷新恢复及安全更新通过桌面实测。Mermaid 预览使用与现有公众号 PNG 一致的白色画布，标签继承图表配色，修复暗色模式文字与箭头低对比问题；不改变用户显式图表配置。
- 历史源码预发布 `v26.10.1-dev` 与 `v26.10.2-dev` 保留，分别见[10 月 6 日记录](../records/2026-10-06-v26.10.1-dev.md)和[10 月 25 日记录](../records/2026-10-25-v26.10.2-dev.md)。今天没有创建新版本或发布镜像，Docker / 桌面发布工作流仍停用。

## 分期与下一步

| 顺序 | 目标                                                                                  | 当前状态                                                       |
| ---- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P1   | [界面与工具栏](../planning/editor-interface.md)                                       | 已合入开发预发布；真实使用环境验收延后                         |
| P2a  | [文章目录与资源](../planning/article-assets.md)                                       | 存储、恢复、图片、预览与系统补测修正已合入                     |
| P2b  | [可移植文件闭环](../planning/markdown-file-import-export.md#下一阶段文章包与文件菜单) | ZIP 与跨存储往返已合入并验证；公众号与手机实测延后             |
| P3   | [服务器工作区契约](../planning/server-workspace-contract.md)                          | P3-4 OIDC 本地合成验证通过；真实发行方待联调                   |
| P4   | [自托管与账号](../planning/self-hosted-storage.md)                                    | PR #5 已合入并回流；分发与编排本地验证，正式发布及真实环境待验 |

完整依赖见 [工作区演进计划](../planning/writing-workspace-roadmap.md)。P2a / P2b 共同满足后才宣称“图片随文且可移植”，本地图片转存到公众号另需实际证据。

## 接下来的事项

P4-1 至 P4-3 交付范围与证据见[专题地图](../planning/topics.md#子专题归属与验收入口)；下一轮按以下顺序推进，详细职责和验收条件统一见 [P4 开发顺序](../planning/self-hosted-storage.md#下一轮开发顺序)：

1. **先收齐并复核基础系统的 128 项源码输入。** 剩余 14 项包括 `alpine-base` 与 `alpine-keys` 的 MIT 通知、6 个 Nginx 供应商包、Node 与附带工具及两类容器启动配方。全部齐备后形成 `LICENSES/distribution/base-provision.json`。原始归档缓存留在忽略的 `output/distribution/`。[复核计划](../../LICENSES/distribution/base-image-plan.json) · [源码提供规则](../deployment/release-materials.md#基础系统的源码提供方式)
2. **再取得真实伴随包与最终镜像的本地闭包证据。** 对实际输入运行源码目录、归档和四个最终镜像的材料 / 基础清单检查，保留 SHA-256、大小和失败证据。当前正向打包与 Registry 记录证据仍是合成夹具，正式 `release-pair.json`、公开源码下载和远端 tag 待验收。固定版本编排已有本地双架构证据，继续复用[受控维护入口](../deployment/release-compose.md)。
3. **随后收敛发布候选与远程保护，按对应授权推进。** 先取得新增原生 CI 的实际结果，再核实并配置完整标签不可覆盖、受限写权限和串行发布边界。实际发布须分配新标识，不复用已有 `v26.10.2-dev`；从干净的对应提交 / tag 构建候选，再绑定公开源码包、两个 index 与四个平台 digest，派生部署 lock。发布材料记录在构建后产出，不回写或移动候选 tag；成对发布接线、上传与部署仍按[发布规则](../governance/versioning.md#首次发布前的准备)分别授权。
4. **修正已发现的远程治理偏差。** 已只读发现远端 `allow_squash_merge=true` 与仓库禁用 Squash 的规范不一致，应在获准修改远程设置后关闭并核验；PR #5 使用 merge commit，本次未修改设置。
5. **真实 Radish 联调按用户要求延期。** 未来实际 issuer、独立客户端、HTTPS 回调和测试身份具备对应授权后，与部署环境一起验证准入、绑定、禁用、本站退出和密钥轮换。配置未就绪时继续不依赖它的 P4 本地工作，不把合成发行方通过当作真实联通。物理断电与跨物理设备仍未验证。
6. **P1 / P2 真实使用环境验收继续延后。** 用户有时间或开发稳定后，再补手机真机的存储、图片、ZIP 下载回导，以及[公众号验收](../deployment/wechat-acceptance.md)的粘贴、保存重开、手机明暗、行高、公式和解包后手工插图。桌面证据不替代这些结果，本地图片自动转存仍不承诺。

## 当前产品与停止线

- P3 / P4 已通过 PR #5 合入 `main` 并回流 `dev`，未创建新 tag / Release 或发布服务端镜像。11 月 3 日的分发、编排和伴随包提交已在 `origin/dev`。11 月 9 日只读查询时，远端 `dev` 为 `ff74515`，该 SHA 尚无 Actions 运行，最近成功的 `dev` 检查仍是 PR #5 的候选。[远端核对记录](../records/2026-11-09-debian-source-review.md#远端与工作区)
- 既有 Vercel 集成此前报告自动预览成功，合并后的自动部署与公网页面待另行验收。镜像发布、服务端部署和跨仓库 OIDC 配置需要对应授权。
- 不迁移真实用户数据；旧文、配置、未知 frontmatter 和目录原件保留，不为升级清库、降级或静默覆盖。
- 升级前 JSON 不含后续资源，纯 Markdown 也不含图片；浏览器逻辑包不自动写回源文件旁边，目录应备份完整文章包。
- Docker 为自托管服务器工作区，不自动同步；通用插件、桌面启用、公共图床、官方云、计费和实时协作不在当前范围。

## 验证状态

历史命令、计数、环境与已执行范围见[整理前验证摘要](../records/planning-sources-before-alignment-2026-11-01.md#验证状态)及其链接的原记录。11 月 3 日的 Web / server 基线、镜像分发与部署编排检查见[全日回顾](../records/2026-11-03-day-review.md)。11 月 9 日验证了 Debian、aports 的真实输入和仓库门禁。[全量 Debian 验证](../records/2026-11-09-debian-source-completion.md#验证) · [aports 验证](../records/2026-11-09-aports-source-review.md#验证与接续)

| 范围                        | 证据与未覆盖面                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 / P2、桌面与 PWA         | [验证基线](../development/validation.md#工作区演进的验证入口)、[桌面证据](../records/2026-10-25-desktop-browser-acceptance.md)、[PWA 记录](../records/2026-10-25-pwa-safe-update.md)；手机真机、公众号仍延期                                                                                                                                                                                                             |
| P3 持久化、API、Web 与 OIDC | [P3 切片入口](../planning/topics.md#子专题归属与验收入口)及对应原记录；合成发行方不是实际 Radish 联通，故障测试不替代物理断电                                                                                                                                                                                                                                                                                            |
| P4 本地部署与最终候选 CI    | [P4-4 记录](../records/2026-10-29-deployment-p4-4.md)与[部署验收](../deployment/acceptance.md)；本地 amd64 模拟执行与远程原生 CI 分列，分发材料和受控编排的新增证据见[分发记录](../records/2026-11-03-image-distribution.md)、[编排记录](../records/2026-11-03-release-compose.md)，源码提供方式与本地门禁见[接续记录](../records/2026-11-03-release-materials.md)；实际完整伴随包、远端保护、正式分发及真实环境仍未关闭 |

本地实现、已合入源码、源码预发布、静态站点部署、镜像发布和服务端部署分别记录，不互相替代；当前六项接续与停止线仍按上文执行。

## 既有记录入口

- [2026-11-09 aports 源码收集与复核](../records/2026-11-09-aports-source-review.md)

- [2026-11-09 Debian 基础源码剩余项复核](../records/2026-11-09-debian-source-completion.md)

- [2026-11-09 Debian 基础源码首批复核](../records/2026-11-09-debian-source-review.md)

- [2026-11-03 全日回顾与收尾](../records/2026-11-03-day-review.md)：三批 P4 实现、验证边界、文档核对与接续依据。

- [2026-10-29 全日提交与文档回顾](../records/2026-10-29-day-review.md)：P4 实施、验收、主线集成及 Radish 部署参考。

- [目录文章接入](../records/2026-10-14-directory-article-storage.md)、[浏览器文章接入](../records/2026-10-14-browser-article-storage.md)、[P2a 存储原型](../records/2026-10-14-article-storage-prototype.md)、[P1 实现](../records/2026-10-14-editor-interface-p1.md)、[前轮收尾](../records/2026-10-14-day-review.md)。
- [Markdown 单文件](../records/2026-10-06-markdown-file-import-export.md)、[关于与帮助](../records/2026-10-06-information-dialogs.md)、[许可切换](../records/2026-10-06-license-transition.md)、[依赖分发复核](../records/2026-10-05-web-license-review.md)。
- [公众号行高修复](../records/2026-10-06-wechat-line-height.md)、[官方检测器对照](../records/2026-10-06-wechat-official-check.md)、[公众号验收步骤](../deployment/wechat-acceptance.md)。
- [远程 PR 初始化](../records/2026-10-05-remote-pr-initialization.md)、[PR CI 验证](../records/2026-10-05-pr-ci-validation.md)、[Vercel 部署证据](../records/2026-10-05-vercel-dev-deployment.md)、[推送前审阅](../records/2026-10-05-pre-push-review.md)。

历史记录保留当时事实，其旧停止线不覆盖本页与后续用户明确要求。
