# 本地账号与文章 HTTP API

状态：2026-10-25，P3-2 已本地实现并验证，实际证据见 [实施记录](../records/2026-10-25-server-local-api.md)。默认监听 `127.0.0.1`，P4-1 增加显式容器监听，见 [Compose 说明](../deployment/compose.md)；后续 P3-3 已接入 [Web 工作区](server-web.md)，P3-4 OIDC 已本地实现，真实发行方联调仍待完成，见 [OIDC 操作说明](server-oidc.md)。存储维护见 [持久化说明](server-storage.md)，API 形状与字段以 [服务器契约](../planning/server-workspace-contract.md) 为准。

## 初始化与恢复

先构建，使用专用空目录；不要指向旧 `uploads`、浏览器导出目录或真实数据。本机账号命令持有与服务相同的卷锁，运行前必须停服务。口令从真实 TTY 读取两次且不回显，不接受命令参数、环境变量或管道口令。

```bash
mise exec -- pnpm build:server
mise exec -- node apps/server/dist/auth/account-cli.js init-admin --data-dir /absolute/path/radishink-data --username admin
mise exec -- node apps/server/dist/auth/account-cli.js create-user --data-dir /absolute/path/radishink-data --username writer
mise exec -- node apps/server/dist/auth/account-cli.js reset-password --data-dir /absolute/path/radishink-data --username admin
mise exec -- node apps/server/dist/auth/account-cli.js disable --data-dir /absolute/path/radishink-data --username writer
mise exec -- node apps/server/dist/auth/account-cli.js enable --data-dir /absolute/path/radishink-data --username writer
```

用户名为 3–64 位 ASCII 字母、数字、`_`、`.`、`-`，首位为字母或数字，规范化为小写且唯一。口令至少 12 个 UTF-16 单元、最多 1024 UTF-8 字节；不截断、不修剪。首个管理员只经 `init-admin` 创建，已有管理员时不能再次初始化；普通本地密码账号经 `create-user` 创建；外部身份的首次准入见 [OIDC 说明](server-oidc.md#登录绑定与准入)。没有公开注册、账号枚举或 Web 管理接口。

`reset-password` 保留原内部用户 ID、角色、文章归属，撤销该用户全部会话并清除该账号的登录失败窗口；来源窗口仍保留。`disable` / `enable` 都撤销该用户全部旧会话；被禁用管理员恢复需要显式 `enable`。恢复口令不会创建新用户或转移文章。无启用管理员时 ready 为 503、capabilities 的 `ready` 为 false，文章接口不开放。

新卷直接初始化 schema 3，schema 1 / 2 原有 SQL / 摘要不重写。旧卷可继续运行存储检查，但 HTTP 和普通账号命令要求 schema 3。schema 1 先执行以下升级到 schema 2，再按 [OIDC 升级说明](server-oidc.md#升级旧卷) 执行 `upgrade-oidc`，各步使用新的卷外备份目录：

```bash
mise exec -- node apps/server/dist/auth/account-cli.js upgrade-auth --data-dir /absolute/path/radishink-data --backup-dir /absolute/path/radishink-before-auth
```

升级持有卷锁，校验 schema / 模式 / 数据库完整性，checkpoint 后把数据库与 `users` / `staging` 全部普通文件复制到卷外新空目录，逐文件重读校验摘要并写 `backup-manifest.json`，然后事务增加账号、会话及限速表。拒绝卷内目标（含路径别名）、非空目标、未知版本及漂移；复制或事务失败不自动清理备份。此清单不是可直接挂载的卷文件；P4-2 的[恢复命令](../deployment/backup-restore.md)已支持该旧清单并轮换 epoch，模式迁移仍属于 P4-3。此次只升级合成 schema 1 测试卷，未迁移真实数据。

## 本地启动与退出

环境必须显式提供数据目录与精确公开 Origin。开发 HTTP 仅接受 `http://127.0.0.1:公开端口`，公开 Origin 与内部监听端口独立；生产环境强制 HTTPS Origin，不能关闭 Secure。默认仅监听 loopback；容器显式设置 `RADISHINK_HOST=0.0.0.0`，部署者负责 HTTPS 终止，见 [Compose 配置](../deployment/compose.md)。

```bash
RADISHINK_DATA_DIR=/absolute/path/radishink-data RADISHINK_ORIGIN=http://127.0.0.1:4000 PORT=4000 mise exec -- node apps/server/dist/main.js
```

服务输出监听地址；在原终端 `Ctrl-C` 退出，关闭身份连接和 worker，释放卷锁。没有配置或 schema 不兼容时启动失败。程序不自动加载 `.env`；[示例](../../apps/server/.env.example) 供终端或服务管理器显式设置。HTTP 启动验证当前快照与派生索引，发现损坏不 ready；故障不会降级为匿名或共享访问。P3-2 的 HTTP 只接受 `accounts` 卷，`shared` 仍限内部存储 / 本机 CLI，未来共享 HTTP 需独立验收。

旧 `UploadModule`、公开 `/uploads/` 与宽泛 CORS 已撤下挂载。原上传文件和上游源码保留，COS 配置不进入新服务启动链路。

## Cookie、来源与会话

- `GET /api/v1/auth/csrf` 建立 10 分钟签名浏览器绑定 Cookie，返回 `csrfToken`；登录 POST 带 Cookie、`Origin` 和 `X-CSRF-Token`，JSON 仅含 `username` / `password`。
- 登录成功轮换旧会话并清登录前 Cookie，返回当前用户、部署身份、epoch 与会话 CSRF token。生产为 `__Host-radishink-session; HttpOnly; Secure; SameSite=Lax; Path=/`；本地 HTTP 使用 `radishink-dev-session`，不设置 Domain。
- 会话随机 32 字节，SQLite 仅存 SHA-256 摘要；空闲 30 分钟、绝对 12 小时。会话活动更新不延长绝对期限。每用户最多保留 20 个会话，全库最多 10000 个，登录时清理过期记录，容量不足拒绝登录。
- 所有写入，包括登录前，都校验精确 Origin 和绑定的 CSRF token；同时核对 Host / Fetch Metadata，拒绝重复 Cookie。完全忽略 `X-Forwarded-*`，本切片不配置受信任代理，来源限速使用直接 socket 地址。
- `POST /auth/logout` 使用会话 CSRF；同一旧 Cookie 再退出幂等。无会话 Cookie 的客户端先取登录前 CSRF，再退出；不会清其他设备会话。禁用 / 密码恢复撤销全部本站会话。
- 登录失败窗口持久化：每账号 15 分钟 5 次、每来源 30 次。校验前预占次数，成功仅扣除本次占用；不存在账号执行相同参数的虚拟摘要校验并返回同一 401。限速键仅存摘要，过期清理，全表 10000 条封顶，达到容量明确 429。
- Argon2id 固定 `m=19456 KiB, t=2, p=1`、独立随机盐；原生口令计算最多同时 2 次，没有无限等待队列。重置与口令校验竞争时，建立会话前复核启用状态和口令摘要。

## 文章、图片与执行边界

全部文章接口从有效会话取得所有者，管理员没有读取他人文章的特权；客户端不能提交顶层 `ownerId`。未知元数据仍保留，但其中的身份字段没有授权效果。分页默认 50、最多 100，`after` 为上一条 UUID；无权限目标统一 404。创建 201，更新及相同提交重试 200；回执中的版本仅证明当次提交，不表示当前最新版。删除保留墓碑，旧回执不能复活正文。

PUT 为 multipart，一个 `manifest` 字段、一个 `markdown` 文件、若干 manifest `partId` 对应的新资源文件；文件名及声明 MIME 不作为路径或格式依据。完整 manifest 的形状、缺省字节的复用约束及版本字段见 [保存协议](../planning/server-workspace-contract.md#保存协议)。多余 / 重复 / 缺失 part、路径编码、无效 UTF-8、正文 / 清单 / 元数据 / 文件 / 总量超限明确失败；chunked 请求同样逐字节计量。

PNG / JPEG / WebP / GIF 先检查魔数、扩展名和尾部完整性，再用固定 `sharp@0.35.5`（libvips 8.18.7）读取尺寸并完整消费所有帧的解码输出。单图最多 10 MiB，动画累计帧像素也不能超过 1600 万；损坏压缩数据、截断、格式伪装和 SVG 均拒绝。禁用 Sharp 缓存、单图片解码串行、每张解码超时 15 秒。保存与读回保持原始字节；资源响应按实际格式设置 MIME、`nosniff`、`no-store`。

同步文件 / SQLite 仓储在单个 worker 内串行运行。HTTP 主线程只做有界协议解析与短身份 SQL；接受中的提交每用户最多 1 个、全服务最多 4 个（含正在上传的请求），总存储任务最多 8 个，API 请求最多 32 个、socket 最多 64 个。超额立即 429。默认请求 60 秒、请求头 10 秒；到期或客户端断开设置共享取消标志，worker 在处理、提交事务及回复前复核。到期的在途工作仍占槽位，直到 worker 实际结束；不能靠超时反复扩张队列。同步内核 IO 不保证可即时中断，worker 失效时服务明确 503。

保存和删除事务内再次检查会话撤销、账号、版本与配额；删除的完整文件校验位于事务外。回复私有内容前再验会话。客户端若在事务完成后丢失响应，需要使用原 operationId 重试确认；不将超时解释为一定未提交。正文、逻辑 / 保留容量、全卷余量与孤儿维护沿用 [持久化规则](server-storage.md#写入容量与删除)，公开能力与解析器使用同一限额源。

四个近 64 MiB 提交的资源实测见 [容量记录](../records/2026-10-25-server-local-api.md#容量实测)。峰值不是部署内存上限；现阶段不承诺小内存容器、高并发、网络卷或任意规模历史快照的性能。

## 验证入口

```bash
mise exec -- pnpm validate:server
mise exec -- node apps/server/test/http-runtime.cjs
mise exec -- node apps/server/test/http-runtime.cjs --capacity
```

常规基线包括真实 loopback HTTP、实际 SQLite / worker、两用户越权、Argon2、撤销、限速重启、事务竞态、图片解码与有界请求测试。`--capacity` 是额外资源探针，会在临时卷生成 999 篇小文，并用四个账号各提交约 63 MiB 的合成文章；只监听临时 loopback 端口，退出清理进程和数据。另有 [原生存储故障 smoke](../../apps/server/test/storage-runtime.cjs)。Web 适配和真实浏览器 Cookie / CSRF 证据见 [Web 记录](../records/2026-10-25-server-web-workspace.md)，OIDC 见 [本地合成记录](../records/2026-10-25-server-oidc.md)；远程 CI 和真实发行方仍需各自证据。
