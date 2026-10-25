# 服务器 Web 工作区

P3-3 在既有 Web 中增加服务器存储，账号、文章和图片由 [HTTP v1](server-http.md) 提供。使用同一编辑器、图片插入和 ZIP worker；浏览器存储及本地文件夹的数据、schema 和存储键保持原样。实现与验证范围见 [P3-3 记录](../records/2026-10-25-server-web-workspace.md)。

## 运行时配置

`apps/web/index.html` 包含公开 JSON 节点 `radishink-runtime-config`，默认内容为：

```json
{ "deployment": "static" }
```

静态模式不发起能力或身份 API 探测，也不显示服务器选项。显式配置为服务器模式时，根路径部署使用：

```json
{ "deployment": "server", "apiBase": "/api/v1" }
```

部署在 `/nested/` 时必须使用 `/nested/api/v1`。配置只接受所在部署目录下的同源规范路径，拒绝任意主机、编码路径、查询参数和其他协议版本。缺失或损坏配置在编辑器启动前报告，不悄悄退回浏览器模式。配置不含账号、密码或密钥。P4 再实现容器启动时生成配置与同源反代；当前 Docker / Vercel 配置没有启用此功能。

服务器模式首次使用默认显示登录；已有明确选择的浏览器 / 目录模式继续保留，可从“存储模式”连接服务器。能力、协议版本、ready 和会话均校验成功后才允许文章操作；连接失败不会拆除当前本地存储。管理员在服务器初始化账号，Web 不提供注册或管理后台。P3-4 新增能力驱动的 Radish 登录、保存后跳转、重新验证密码后的绑定 / 解绑；仅 OIDC 部署隐藏密码入口，准入与配置见 [OIDC 操作说明](server-oidc.md)。

## 编辑、失败与退出

- 先新建或打开服务器文章；未关联文章时显示入口提示，不接受无法保存的游离正文。桌面侧栏与手机端“文章列表”提供列表、搜索、改名和删除，不提供目录树、移动或文件夹操作。
- `ServerStorageAdapter` 使用 UUID 虚拟路径，`ServerArticleStore` 固定部署 ID、epoch、用户 ID 和文章 ID。保存使用已经读取的 revision；完整元数据、原始正文和资源一起提交。未知元数据、frontmatter、BOM / CRLF 沿用原有文章契约。
- 已提交图片只发送保留清单，新图发送字节；读取核对同一 revision、MIME、长度和 SHA-256，不拼接不同版本的资源。预览使用可释放的 Blob URL。ZIP 导入分配新 ID，导出使用当前编辑与完整已读资源快照。
- 同页未知提交结果保留原 operationId、时间、内容与 multipart；重试先确认原提交，再处理新输入。明确拒绝的请求允许修正内容后重新提交。回执落后于远端时显示冲突，不取最新版本强写。
- 冲突提供重试、另存完整资源副本、下载正文，以及明确确认后重新读取远端。删除提示不承诺本地目录恢复功能；服务器删除保留后端墓碑，页面没有撤销入口。
- 断线或超时遮蔽私有视图，保留当前页面内存供纯 Markdown 抢救；抢救文件不含图片。重新验证同一身份后保留编辑并可重试保存。切换存储先保存；退出可选择保存后退出，或先导出 / 明确放弃。正在读写、上传或导入时不允许切换 / 退出。
- 服务器正文、资源和待确认提交不写入 `historyStore`、IndexedDB 或 localStorage。关闭 / 刷新会丢失尚未确认的本页状态，应先导出并在重开后检查服务器列表，不能承诺离线恢复或后台同步。

## 私有状态与缓存

会话失效或身份变化会递增 generation，取消请求并清除正文、资源、索引及活动文件；旧编辑器实例随之销毁，撤销历史与 Blob URL 不跨账号保留。切回本地模式前同步清理服务器正文，避免浏览器历史管理器首次挂载捕获私有内容。

主动退出及重新登录通过 BroadcastChannel 和无私有内容的 storage 事件通知其他标签；收到通知先清除旧私有状态，再请求会话，因此断网旧标签也不会保留旧账号的抢救入口。隐藏 / pagehide 时遮蔽，重新可见、pageshow（含 persisted）和 online 时重新验证。单纯网络中断与明确会话撤销分别处理。

所有 API fetch 使用同源凭据、`cache: no-store`、禁止重定向和有界超时；常规请求 15 秒，PUT 65 秒，覆盖完整响应体。JSON 响应上限为 32 MiB，以容纳 5 MiB 原始正文的 JSON 转义放大；图片响应为 10 MiB。服务端原始文章 / 请求限额不变。Service Worker 对整个 `/api/` 路径段使用 NetworkOnly，并禁止导航回退为 HTML。

## 本地合成验收

使用项目已有工具链和依赖，不需要安装额外库：

```bash
mise exec -- pnpm build:web
mise exec -- pnpm build:server
mise exec -- node scripts/browser/server-workspace-server.cjs
```

脚本仅监听 `127.0.0.1:4193`，将正式编译后的 Nest API 代理到同源；`/nested/` 验证服务器子路径，`/static/` 验证静态模式。它在系统临时目录创建 `radishink-p3-web-*` 合成卷和 `alice` / `bob` 测试账号，测试口令只用于该脚本。Ctrl-C 会关闭本脚本的 HTTP 与 worker，并删除其合成卷；不要将脚本用作部署服务。

使用独立 Playwright CLI 会话打开该端口，再执行 `run-code --filename`：

- `scripts/browser/server-workspace-checks.js`：静态无 API、账号、图片、ZIP、冲突、丢响应、私有状态与多标签。
- `scripts/browser/server-workspace-privacy-checks.js`：改名 / 删除、断网旧标签、撤销、历史后退、persisted pageshow 事件及生产 SW API 边界。
- `scripts/browser/server-workspace-bfcache-checks.js`：使用已安装 Chrome，移除 Playwright 默认禁用 BFCache 的参数，确认实际 `persisted: true` 恢复瞬间已遮蔽，随后撤销检查清除旧编辑器。公共静态外壳使用 `Cache-Control: no-cache`，所有 API 仍为 `no-store`；脚本要求真实命中，不能用注入事件替代。

输出落入已忽略的 `output/playwright/`；只包含合成文章、图片和截图。上述浏览器操作不包含远程部署、真实用户迁移、真实 Radish OIDC、手机真机或公众号验收。
