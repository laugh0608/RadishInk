# P2a 文章存储契约与迁移恢复原型

日期：2026-10-14。用户授权先完成 P2a 的存储契约、迁移恢复原型、合成数据测试与文档同步，暂不推送或发布。

## 基线与范围

- 开始于 `dev`、HEAD `0dd00a3`，工作区及暂存区干净；本地 `origin/dev` 为 `f32cf23`，未 fetch 或查询线上。
- 实现限于 `apps/web/src/storage/articles/`、对应测试、浏览器检查脚本和文档。没有改动生产入口、`historyDb` 的 v2、`wemd-files`、存储键、依赖清单 / 锁文件、桌面端或后端。
- 只操作显式命名的合成数据库和合成目录，没有迁移用户文章；没有接入图片粘贴、选择、预览或 ZIP。
- 实现验收时保留为未提交修改；随后用户授权提交工作区更改，本记录随 P2a 原型纳入 `dev` 本地提交。未推送、部署、创建 PR、tag / Release 或发布镜像。

## 实现结果

- `ArticleStore` 固定工作区与文章身份，复用 `HistorySnapshot` 完整源文，定义正文、Blob 资源和预期版本的一次提交；路径校验、资源不可隐式覆盖 / 删除、错误分类与命名规则均有可执行实现。
- 浏览器原型在历史库合成副本中保留 `history`，事务性增加版本、资源与迁移记录；升级前独立备份、过期备份中止、blocked 取消、防迟到升级、版本接管关闭、恢复到新 v2 库均可运行。
- 目录原型保留旧散落文件，显式复制为 `index.md` + `asset/`；通过暂存原字节、before / after 日志、身份标记和完成记录恢复部分写入。检测到外部编辑或资源变化时停止并保留文件，不把失败视为空目录。
- 原型采用 30 篇新建上限，超限旧文章全部保留；生产中的旧自动裁剪尚未替换，正式接入是下一步工作。

契约、内部目录结构、恢复状态与正式接入条件统一在 [文章存储契约](../development/article-storage-contract.md)，不把原型通过等同于 P2a 全部完成。

## 自动与原生浏览器验证

使用项目现有 Node `22.23.3`、pnpm `9.0.2`，没有安装或升级依赖。

```bash
mise exec -- pnpm --filter @wemd/web exec vitest run src/__tests__/storage/articleContract.test.ts src/__tests__/storage/directoryArticlePrototype.test.ts
mise exec -- pnpm --filter @wemd/web exec tsc -b
mise exec -- pnpm validate:web
git diff --check
```

最终 `mise exec -- pnpm validate:web` 退出码为 0：仓库检查通过；治理 53 项、core 64 项（9 个文件）、Web 611 项（88 个文件）测试通过，其中本轮新增 32 项定向测试；Lint 为 0 错误、12 项既有警告；TypeScript 与生产构建通过，PWA 生成完成。

保留既有大于 500 kB 的 chunk 提示、Browserslist / baseline-browser-mapping 数据过期提示及开发时的 highlight.js 弃用日志。没有为了消除提示升级依赖或放宽门禁。最终文档检查与 `git diff --check` 通过。

定向用例覆盖路径越界 / 保留名 / Unicode / 大小写冲突、未知元数据与 BOM / CRLF、二进制原字节、复制旧文保留邻居文件、调用期间输入变化、两个实例并发、外部编辑、权限撤回、资源覆盖 / 隐式删除拒绝、无 Web Locks 拒绝以及日志注入。

逐阶段失败注入覆盖暂存资源、归档日志、pending 日志、身份标记、目标资源、正文、完成状态和标记清理。验证失败必须向调用方传播，重开后重试 / 恢复可完成，重复恢复不重复增加版本。

原生浏览器检查通过 Playwright CLI 的独立测试会话执行，并在脚本内新建隔离上下文：

```bash
mise exec -- pnpm dev:web --host 127.0.0.1 --port 5173 --strictPort
playwright-cli --session radishink-p2a open http://127.0.0.1:5173 --headed
playwright-cli --session radishink-p2a run-code --filename scripts/browser/article-prototype-checks.js
playwright-cli --session radishink-p2a close
```

本机通过既有 Playwright 技能的 `~/.codex/skills/playwright/scripts/playwright_cli.sh` 调用上述 CLI；没有向项目添加浏览器驱动依赖。脚本模块为 `articlePrototype.browser.ts`，不被产品入口导入，也不计入 Vitest 用例数量。12 组原生检查已通过：

1. v2 → v3 保留文章 ID、原文、未知字段，v2 客户端收到 `VersionError`。
2. 原生 IndexedDB 保存 / 重开后正文、版本与 Blob 字节一致，跨文章写入拒绝。
3. 两个数据库连接同时保存同一版本，一成功、一冲突。
4. 在资源 put 边界注入配额错误，真实事务回滚正文、资源与版本。
5. 备份后编辑造成升级中止，schema 回到 v2、文章保留；重新备份可重试。
6. 备份恢复到新 v2 库，已有恢复目标拒绝覆盖。
7. 旧连接阻塞时明确拒绝，关闭后没有迟到升级，重新发起可成功。
8. 非法旧文在备份阶段拒绝，不清库或生成空文章。
9. 31 篇旧文全部保留，新建受限但已有文章仍能保存。
10. 收到 `versionchange` 后关闭原型连接并停止写入。
11. 真实 OPFS + Web Locks 完成旧文复制、空资源目录、Blob 保存和重开，原件保留。
12. 原生文件流在正文 close 前注入中断，重新创建实例读取持久化日志后恢复，资源校验一致。

原生脚本只清理本次生成的随机前缀数据库与 OPFS 子目录，并关闭隔离上下文。没有调用系统目录选择器，没有访问用户浏览器草稿或线上账号。

## 发现与修正

- File System Access 创建新文件后写入失败可能留下零字节占位；控制记录不能将其当作已提交状态，恢复需与现有文章及日志共同校验。
- 目录原型增加目标身份标记、日志一致性校验和大小写 / Unicode 冲突检查，避免把已占用的通用目录认作文章包。
- Node 测试 Blob 与 DOM 类型声明不一致，测试环境使用原生 Node Blob / File 的全局替换；生产接口继续使用浏览器类型，没有关闭类型检查。
- 首轮完整基线发现新增的“调用期间输入变化”测试夹具从可变输入读取目标 ID，导致重开时测试自身切换了文章；夹具改为捕获固定身份后重跑。另补充后续保存仍保留旧记录扩展字段的回归。
- Playwright CLI 的 `run-code` 接受函数表达式，初次脚本末尾分号导致解析失败；修正脚本格式后重新执行，不将工具错误计为通过。
- 沙箱阻止本地监听时，经工具审批启动 Vite；没有修改全局配置或新增依赖。

## 边界与后续

- 此轮完成存储与恢复原型，没有启用生产 v3 或迁移真实文章；P2a 的 UI 接入、图片读写、预览和生命周期仍未完成。
- 配额 / 磁盘 / 权限错误为明确注入；未填满用户磁盘、模拟真实断电或撤回系统目录权限。OPFS 不代表系统目录授权流程。
- 未验证 Safari、Firefox、手机真机、真实公众号图片转存；图片解码、体积 / 数量限额和 ZIP 往返不在本轮范围。
- 目录写入不能与外部编辑器形成原子 CAS；可检测冲突会停止，正式接入前仍需用户可见的恢复 / 冲突入口和日志清理策略。
- 下一步先将文章契约接到两条实际持久化路径，完成备份 / 升级 / 旧版拒写提示、文章数量策略、自动保存与恢复界面，再开放粘贴 / 选图及资源预览；P2b 补齐可移植文件闭环。

实现验收收尾已关闭 `radishink-p2a` 浏览器会话和本轮 Vite 进程，确认 `5173` 无监听。当时位于 `dev`、HEAD `0dd00a3`，修改范围为本轮原型、测试和文档，暂存区为空。随后按用户授权复查范围并创建本地提交，没有推送或发布。
