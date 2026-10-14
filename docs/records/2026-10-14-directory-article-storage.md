# P2a 目录文章包与旧备份恢复接入

日期：2026-10-14。

## 范围与基线

用户要求提交上一轮工作区并继续下一步，沿用“不推送或发布”和合成数据验证边界。先在 `dev` 精确提交 31 个上一轮文件，得到 `0c7ced2 feat(storage): 接入浏览器文章备份升级与实际读写`；提交钩子通过，提交后工作区干净，本地跟踪引用 ahead 3。没有 fetch、推送、tag、Release、部署或远程设置变更。

随后本地接入目录文章包、写入恢复与冲突副本、整包移动 / 删除 / 日志清理，以及浏览器旧 JSON 缺失文章恢复。详细格式和停止线统一见 [文章存储契约](../development/article-storage-contract.md)，阶段见 [当前状态](../status/current.md)。目录接入代码尚未提交；本记录及相关文档纳入当日收尾文档提交，见 [收尾记录](2026-10-14-day-review.md)。

## 实现与用户行为

- 目录新建与 Markdown 导入形成 `文章--ID摘要/index.md`、`asset/` 和包内控制记录。列表按一篇文章展示，自动 / 手动保存沿用版本、正文和资源校验；标题修改保持 ID / 目录不变。
- 旧散落 `.md` 原位保留，可显式复制为新包；原件、相邻文章和图片不自动移动。`.wemd/themes.json` 沿用既有工作区主题路径。
- 维护入口列出文章写入和整包操作。故障后显式恢复；当前编辑可下载、确认重读，或另存副本继续写作，保留原包。不会用外部改写覆盖当前编辑，也不会用旧编辑静默覆盖磁盘。
- 整包移动 / 删除先保存并校验包含资源及隐藏记录的恢复副本；未完成操作暂停原包写入，可显式继续。陌生文件、未登记资源、外部改动或坏日志停止操作。已完成恢复副本与旧提交日志仅由用户显式清理。
- 浏览器旧 JSON 恢复先预览新增 / 跳过数量，确认后在同一事务添加缺失 ID，保留现有同 ID 文章。保留旧文原始字段及超出 30 篇的旧记录，不切换当前编辑；预览过期或配额失败整笔回滚。
- 修复启动并发恢复两次适配器的问题：StrictMode 重入复用同一初始化，不关闭刚启用的目录句柄；目录初始化取消后不继续打开旧工作区文章。

## 验证

工具链沿用 Node 22.23.3、pnpm 9.0.2、Vite 6.4.1；无新依赖或工具安装。合成句柄使用 close 后提交的模型，另由隔离 Chromium 使用原生 IndexedDB、OPFS、Web Locks 验证。产品目录测试向 `showDirectoryPicker` 注入原生 OPFS 句柄，**不是系统目录选择器授权证据**。

新增目录单元测试 17 项，覆盖标准包、旧文保留、双实例版本、外部编辑、三个失败阶段、权限错误、整包移动 / 删除、未完成操作重试、陌生文件拒绝、日志清理、冲突副本资源保留、主题路径和能力缺失；并发初始化新增 1 项、工作区切换期间的改名 / 删除归属新增 2 项回归，共新增 20 项。原型 19 项目录测试及相关原有回归继续保留。

浏览器脚本：

```sh
mise exec -- pnpm dev:web --host 127.0.0.1 --port 5173 --strictPort
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-directory open http://127.0.0.1:5173
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-directory run-code --filename scripts/browser/article-directory-native-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-directory run-code --filename scripts/browser/article-directory-entry-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-directory run-code --filename scripts/browser/article-backup-restore-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-directory run-code --filename scripts/browser/article-prototype-checks.js
/Users/luobo/.codex/skills/playwright/scripts/playwright_cli.sh --session radishink-p2a-directory close
mise exec -- pnpm validate:web
```

最终完整 Web 基线通过：治理 53、core 64、Web 652 项（93 个文件），Lint 0 错误 / 12 项既有警告，类型检查和生产构建通过。最终日志为 `/private/tmp/radishink-directory-portal-final-validate.log`。

七个浏览器脚本共 34 组通过：目录产品流程 6 组、原生目录二进制 / 生命周期 3 组、旧 JSON 恢复 2 组、既有浏览器入口 / 故障 / 新建导入 11 组、原型原生回归 12 组。最终日志为 `/private/tmp/radishink-final-article-*.log`。后三个旧产品脚本的动态 import 等待已改为显式异步轮询。目录产品检查包含真实新建、快捷键保存、持久化句柄重开、文件选择器导入、恢复界面、改标题、移动后保存、外部编辑冲突、另存副本和删除确认；选择目录这一环节仍为注入 OPFS 句柄。所有测试只操作随机命名的合成 OPFS 根目录或隔离上下文中的数据库。截图保存在 Git 忽略的 `output/playwright/`，不提交合成下载、浏览器缓存或个人数据。

## 诊断记录

- 第一轮相关旧测试暴露改名时先保存再发现目标冲突的副作用，调整为先检查目标；原有不覆盖断言保留。
- 浏览器启动曾出现列表可见但正文未打开，定位到 StrictMode 并发初始化关闭旧适配器，补充去重与取消检查，并添加回归。
- 维护操作进行中关闭按钮曾可点击但被回调忽略；现在明确禁用关闭，浏览器验证等待完成后关闭。
- 当前 Playwright CLI 的 `waitForFunction(async () => false)` 在探针中立即放行。将涉及动态 import 的等待改为显式 `evaluate` 并轮询返回结果，保留超时失败；同时修正上一轮三个产品脚本并重新运行。未把时序抢跑产生的“通过”作为最终证据，也没有删除断言。此前组合检查中的未完成保存、句柄失效由提前进行后续操作触发。
- 原生二进制检查进一步暴露真实缺陷：`new Blob([File])` 仍可能依赖原磁盘条目，整包移动后保存资源报 `NotFoundError`。读取资源改为从 `arrayBuffer()` 构造独立 Blob 快照，并用原生移动后保存与冲突副本验证，替身测试本身不能揭示此差异。
- 最后补充异步归属回归：改名目标检查期间切换工作区会停止后续写入；删除完成时工作区已变化，不清空新工作区编辑器。截图发现旧备份恢复弹窗受侧栏容器宽度限制，改为 Portal 到页面层并重新验证。
- 首次完整基线在文档链接检查处停止：新契约引用的本记录尚未写入。补齐记录后重新执行，不跳过文档检查。

## 边界

没有迁移用户数据，没有系统目录授权 / 撤权、真实磁盘满 / 断电、Safari / Firefox、手机真机或公众号后台验收。配额 / close 失败为注入；OPFS 不等同用户磁盘目录。外部编辑器与本应用之间没有原子 CAS，最终校验与写入 / 删除之间仍有竞争窗口。部分递归删除或无法识别的暂存须保留副本人工检查，不能自动清空。

图片粘贴 / 选图、预览资源解析、孤立图片清理、ZIP 及公众号图片复制继续后续实施。本轮日志与恢复副本清理不等于图片垃圾回收；纯 Markdown 和 v2 JSON 均不是包含资源的完整备份。

本次启动的 Vite 服务及隔离 Chromium 会话已关闭。功能验证结束时暂存区为空；目录接入代码未提交，随后只提交收尾文档，未推送或发布。既有警告包括 highlight.js 旧 API、Browserslist / baseline-browser-mapping 数据陈旧和构建大 chunk 提示，未放宽门禁。

## 收尾后的追加提交

用户随后要求提交工作区其余更改。核对剩余 35 个代码、测试和浏览器脚本文件，与上述完整基线验证后的摘要全部一致，无新功能改动；连同当前状态与本记录的提交状态说明一并本地提交。真实目录权限等未验证项不因提交而消除，未推送或发布。
