# P2a 浏览器备份升级与实际文章读写

日期：2026-10-14。按用户要求在存储原型之后推进备份升级入口和实际文章读写，使用合成数据完成测试 / 浏览器验证，并同步文档；暂不推送或发布。本轮开始于 `dev`、HEAD `b87cab2`，工作区与暂存区干净，本地跟踪引用显示 ahead 2；未 fetch，不能据此宣称重新核对过远程。

## 本地实现范围

- 提取 `browserArticleDatabase` 为正式浏览器存储实现，`historyDb` 接入同一个 `wemd-history`，不使用 `wemd-files` 另建文章库。新库直接初始化 v3，旧 v2 先保持不变，下载备份并确认后原位升级。
- 备份入口导出旧库原始文章 JSON，提示保存确认、备份范围和旧版本不能读取升级后数据库。过期备份中止升级；占用失败取消请求，关闭旧标签后也不会迟到升级；初始化错误可重试，不清库重建。
- 实际文章列表、新建、Markdown 导入、10 秒自动保存、`Ctrl/Meta+S`、改名、删除与清空使用版本化文章存储。保存等待事务提交，保留未知元数据与原有二进制资源；删除正文 / 资源 / 版本在同一事务内完成。
- 同页写入串行，跨标签保存 / 删除 / 清空使用已读版本比较；清空同时检查文章集合。移除所有自动裁剪，超过 30 篇的旧文完整保留，上限只阻止新增。
- 读取失败不会当作空列表或创建示例文章。切换 / 新建等待保存后再次检查当前正文，迟到结果不会覆盖等待期间的新输入；显式清空不会立即自动补建示例。
- 保存状态栏改用实际已提交快照，不再在输入两秒后自行显示已保存；有错误显示未保存。保留独立下载当前正文的抢救入口，页面关闭不再把异步保存当作可靠完成保证。

目录文章包仍是合成原型；既有目录文本读写保持原状。图片粘贴 / 选图、预览资源解析、ZIP、目录恢复 UI、JSON 恢复 / 合并 UI 和服务器均未开放。详细契约只在 [文章存储](../development/article-storage-contract.md) 维护。

## 执行与结果

运行时沿用 `mise.toml` 的 Node 22.23.3、pnpm 9.0.2，开发服务使用仓库 Vite 6.4.1。未安装或更新依赖、工具或资产，未改系统配置。Vite 仅监听 `127.0.0.1:5173`；沙箱首次启动返回 `EPERM`，经执行授权在沙箱外启动。

| 检查                       | 本轮结果                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| 存储适配与失败传播定向测试 | 8 项通过；提交等待、资源 / 已读版本保留、读取失败、连接重试、删除失败与未就绪拒写                         |
| 文章 store 定向测试        | 4 项通过；读取重试、超限旧文、串行保存绑定文章及删除冲突                                                  |
| HistoryManager 定向测试    | 5 项通过；读取失败保护、重挂载自动保存、清空不补建、先加载空列表后初始化及初始保存期间编辑保护            |
| 侧栏定向测试               | 3 项通过；点击当前文章不回滚、等待保存时编辑取消切换、迟到新建留在列表                                    |
| 保存状态定向测试           | 3 项通过；计时器不伪造成功、失败保持未保存、目录状态保持独立                                              |
| 完整 Web 基线              | 通过：53 项治理、64 项 core、632 项 Web（92 个文件）；Lint 0 错误 / 12 项既有警告，类型检查与生产构建通过 |
| 原型原生存储回归           | 既有 12 组 Chromium IndexedDB / OPFS / Web Locks 检查通过                                                 |
| 实际浏览器入口             | 5 组通过；备份确认、31 篇保留、手动 / 自动保存、刷新恢复、双标签冲突与资源生命周期                        |
| 升级 / 写入故障入口        | 4 组通过；占用取消、备份过期中止重试、事务配额异常、未来 v4 拒写                                          |
| 新工作区 / 导入入口        | 2 组通过；新库初始化、新建、真实文件选择器导入 / 刷新，以及 390px 触屏模拟布局                            |

完整命令：

```sh
mise exec -- pnpm validate:web
# 另开终端启动本地验证服务
mise exec -- pnpm dev:web --host 127.0.0.1
# 使用 Playwright skill 提供的 CLI，会话与用户浏览器隔离
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-entry open http://127.0.0.1:5173 --headed
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-entry run-code --filename scripts/browser/article-storage-entry-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-entry run-code --filename scripts/browser/article-storage-failure-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-entry run-code --filename scripts/browser/article-storage-new-import-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-entry run-code --filename scripts/browser/article-prototype-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-entry close
```

浏览器检查前应停止修改源码，并从新启动的 Vite 服务运行，避免热更新后的模块查询参数使脚本动态导入到另一份 store。每个浏览器脚本新建临时上下文，并在 `finally` 关闭。合成旧库包含 31 篇文章、BOM / CRLF、未知字段和自定义 frontmatter；模拟图片使用固定字节，无真实文章或账号。实际下载的 JSON 文件另行解析，确认 31 条原文及未知字段完整。原生事务检查与替身测试分别记数，不把模拟配额错误称作真实填满磁盘。

本地证据保留于 Git 忽略的 `output/playwright/`：`p2a-upgrade-entry.png`、`p2a-conflict-preserved.png`、`p2a-synthetic-v2-backup.json`，新导入流程另有 `p2a-mobile-import.png` 触屏模拟截图。截图等待动画结束，静态检查显示提示与操作可见；不将这些文件提交到仓库。

## 检查中发现与修正

- 原事务 mock 测试随实际入口改用文章仓库边界；真实事务中止 / 回滚仍由原生浏览器脚本验证，没有删除失败断言。
- 新增排队保存测试最初把完整源文误断言为裸正文；改为同时断言解析后的正文、原有未知 frontmatter 与新标题，保持元数据保真要求。
- 列表加载改为幂等后，新安装场景暴露懒加载管理器晚于空列表完成时未创建初始文章。将初始创建与编辑追踪分离，并增加先加载空列表再挂载的回归。
- 新安装验证同时发现既有保存状态栏以两秒计时器模拟保存；改为依据真实快照与错误状态，并增加计时器不伪造成功的负向检查。
- 新增 store 状态字段后，已有 ThemePanel fixture 同步结构；保存状态栏读取存储模式后，EditorDisabledServices fixture 提供相应上下文，没有放宽类型检查。
- 最终故障脚本一度读到空的模块内 store，而页面已显示一篇文章和真实保存成功。源码热更新后的带时间戳模块与脚本直接导入路径产生不同实例；停止源码修改并重启 Vite 后，三个入口脚本串行复核全部通过，未修改失败断言。后续应沿用上述冷启动方式。
- 最初仅缩小桌面视口的截图并非移动布局。依据项目粗指针判据改用 `hasTouch: true`，明确等待 `data-layout-mode="mobile"` 并核对编辑区边界；最终截图为触屏模拟，仍不作为真机证据。

完整基线最终日志为 `/private/tmp/radishink-p2a-entry-final-validate.log`，退出码 0；三个入口复核日志为 `/private/tmp/radishink-p2a-final-{entry,failure,new-import}.log`，均成功。原型 12 组回归日志为 `/private/tmp/radishink-p2a-entry-prototype.log`。本轮定向共 23 项，通过的原生浏览器分组共 23 组（产品入口 11 组、原型 12 组），两者不是同一种证据。

既有警告包括 12 项 Lint warning、highlight.js 旧调用提示、baseline-browser-mapping / Browserslist 数据陈旧及大 chunk 提示；没有通过升级依赖、放宽阈值或跳过检查消除它们。

## 未验证项与交付边界

- 本次只迁移临时上下文中的合成库，没有读取或迁移日常浏览器的用户数据。旧版界面不能自动获得新版兼容提示，旧客户端 `VersionError` 不代表原库为空。
- JSON 备份不包含升级后的新增更改或资源；产品恢复 / 合并入口待后续。本轮可安全下载当前正文处理冲突，不提供自动覆盖或合并。
- 没有系统目录授权、真实磁盘满 / 断电、Safari / Firefox、手机真机或真实公众号粘贴验收。390px 模拟宽度不代替真机；OPFS 不代替用户目录。
- 本轮按用户要求本地提交，未推送、部署、创建 tag / Release，未改变远程规则。本次 Vite 服务已停止；隔离浏览器会话已关闭。
