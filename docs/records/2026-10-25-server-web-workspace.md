# P3-3 Web 服务器工作区实施记录

日期：2026-10-25。用户要求先复查并提交 P3-2 到 `dev`，不推送、不部署，再直接实施与验证 P3-3。

## 提交与范围

P3-2 提交为 `7476a45`（`feat(server): 实现 P3-2 本地账号与文章 API`）。提交前修正 multipart 精确资源数量 / 单文件大小边界及超限流清理，服务端 78 项测试与仓库检查通过，见 [P3-2 记录](2026-10-25-server-local-api.md)。提交后工作区干净，`dev` 比已有 `origin/dev` 跟踪点领先 3 个提交；没有推送或部署。

P3-3 在同一 `dev` 工作区继续实现，完成验证后按用户后续要求纳入本地提交。本轮没有新增依赖、修改锁文件、创建分支 / worktree 或使用子代理。静态部署保持默认，真实用户数据、OIDC、共享模式 HTTP 和 Compose 未启用。

## 实现

操作与边界的详细来源为 [服务器 Web 工作区](../development/server-web.md)：

- 启动前校验公开运行时配置；服务器能力与会话均通过协议检查，错误配置、HTML fallback、版本不兼容、维护与超时明确失败。
- 独立服务器适配器 / 文章 Store，固定四元身份与 revision；完整快照、保留图片清单、校验资源字节、原 operationId 重试及明确拒绝后的修正提交。
- 复用侧栏、图片、Markdown / ZIP 导入导出与保存入口；服务器不支持目录操作。提供冲突副本、重新读取和正文抢救，未关联文章不开放编辑输入。
- 私有数据只在内存；身份变更取消请求并销毁旧编辑器，跨标签通知先清理后验证，恢复可见 / pageshow / online 先遮蔽。Service Worker 排除整个 API 路径段。

## 验证

使用项目 Node 22 / pnpm 9.0.2 工具链，完整基线与收尾复验通过：

| 检查                                 | 实际结果                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `mise exec -- pnpm validate:web`     | 仓库检查、治理 59、core 64、Web 785 项通过；Lint 0 错误、12 条既有警告；正式生产构建通过                                                   |
| `mise exec -- pnpm validate:server`  | 无自动修复 Lint、正式产物构建、4 组共 78 项测试通过                                                                                        |
| `server-workspace-checks.js`         | 8 组生产浏览器闭环通过；50 个私有 API 响应均为 no-store，CacheStorage 无 API，页面运行错误为 0                                             |
| `server-workspace-privacy-checks.js` | 6 组负向 / 生命周期检查通过；覆盖私有弹窗遮蔽、断网标签撤销、注入 persisted 事件、真实导航后退、改名 / 删除与受控生产 SW，页面运行错误为 0 |
| `server-workspace-bfcache-checks.js` | 已安装 Chrome 实际命中 BFCache，`persisted: true` 时遮蔽标记已存在，随后失效会话清除旧编辑器                                               |

浏览器使用正式 `apps/web/dist` 与编译后的 Nest API，包含静态无 API、子路径同源登录 / 新建 / 保存、真实图片选择与 Blob 预览、生产 ZIP Worker 导出 / 新 ID 回导、409 保留本地 / 远端与完整资源副本、提交成功后人为丢响应再复用同 operationId、多标签退出与切换账号；并检查正文未进入 IndexedDB / localStorage。390px 触屏模拟能通过“文章列表”新建文章、返回编辑，截图已目视检查无横向溢出。

普通 Playwright 默认关闭 BFCache，其历史后退证据没有命中；独立探针只移除该禁用参数，明确检查真实 `persisted`。初次探针的公共 HTML `no-store` 阻止 BFCache，合成服务改为公开应用壳 `no-cache` 后命中；API 始终保持 `no-store`。注入事件、导航重载和实际 BFCache 三种证据分别记录。

临时日志为 `/private/tmp/radishink-p3-3-{web-validation,server-validation,browser,browser-privacy,browser-bfcache}.log`。可复现浏览器入口保存在 `scripts/browser/`，输出的 ZIP、纯正文抢救及截图保存在忽略目录 `output/playwright/`，均为合成数据。

关键修正来自实际复查与负向验证：

- 原始正文的 JSON 转义可能扩大传输体积，客户端 JSON 响应上限按最坏转义设置，不将 5 MiB 原始正文误判为超限；后端文章限额不变。
- 确定被拒绝的上传允许修正后提交；未知结果继续保留原请求。新建丢响应后可重试，或从列表打开确认后解除待确认状态。
- 新建工作区显示名称会同步更新，列表异步结果不能因这个正常初始化被误判为过期；仍通过适配器身份与请求代次阻止旧工作区结果进入新界面。
- 恢复文章期间退出入口必须禁用；空服务器工作区不提供无法关联到文章的编辑器。
- 退出广播先清理内存，不能依赖断网标签完成身份请求；服务器删除文案不承诺本地目录恢复副本。
- 手机布局原先隐藏桌面侧栏，补充“文章列表”弹窗以完成新建 / 打开；私有遮蔽使用整个子树 `display: none`，覆盖 body Portal，避免子元素自身 `visibility: visible` 使确认按钮露出。新增浏览器负向检查确认修正。

合成验收服务为 `scripts/browser/server-workspace-server.cjs`，仅绑定 `127.0.0.1:4193`，数据卷为系统临时目录 `radishink-p3-web-*`。Playwright 使用独立浏览器上下文，输出在忽略目录 `output/playwright/`。启动过程中沙箱曾拒绝 loopback 监听，随后按批准权限启动；未将环境失败记为通过。

收尾已关闭专用 Playwright 会话及合成服务，清理成功启动的临时卷与首次监听失败留下的合成卷，复查无本轮服务进程或 `radishink-p3-web-*` 目录残留。`git diff --check` 与文档同步后的 `pnpm check:repo` 通过；工作区 49 个变更文件均属本轮 P3-3，暂存区为空，`dev` 仍只比 `origin/dev` 跟踪点领先原有 3 个提交。

## 未验证与后续

- P3-4 的 `openid-client`、实际 Radish issuer、准入 / 绑定 / 撤销与 P4 Compose 尚待实施；真实配置、联调、镜像发布或部署需要对应授权。
- 本轮浏览器证据是本机 Chromium，390px 触屏布局属于模拟；P1 / P2 的手机真机及真实公众号验收继续按用户要求延期。Safari / Firefox 前轮本地存储证据不替代新服务器模式验收。
- 不承诺服务器断网后刷新恢复未保存编辑、离线同步或全量本地文章自动迁移；迁入服务器仍需用户显式导入 ZIP。
- CI 与远程 Ruleset 本轮没有改动或远程执行；本地通过不等于已发布。
