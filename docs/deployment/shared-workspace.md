# 共享工作区与归属转换

P4-3 提供显式 `accounts` / `shared` 模式。共享模式没有用户隔离：任何能够访问入口的人都可读取、修改、删除全部共享文章。仅建议本机或可信私网；Compose 默认绑定 `127.0.0.1`，生产仍要求 HTTPS。浏览器草稿和本地目录不会自动上传。

## 启用新共享卷

设置部署环境：

```dotenv
RADISHINK_ACCOUNT_MODE=shared
RADISHINK_PASSWORD_LOGIN=false
```

不叠加 OIDC overlay，不配置 OIDC 登录。`accounts` 是默认模式；关闭全部登录方法仍会报错，不会自动转成共享。`shared` 同时启用任一登录方法也会报错。

按 [Compose 说明](compose.md) 构建后，首次使用空卷执行：

```sh
docker compose run --rm --no-deps server node dist/storage/storage-cli.js init --data-dir /data/workspace --mode shared
docker compose up -d --wait
```

已有 `accounts` 卷不能通过改环境变量或再次 `init` 开放。已有卷的模式、schema、快照与派生索引不一致时启动失败。

## HTTP 与 Web 行为

- 能力响应明确 `accountMode: shared`、`loginMethods: []`；共享 ready 不依赖管理员。
- `GET /auth/session` 返回固定工作区上下文：固定内部 owner `00000000-0000-4000-8000-000000000001`、`role: shared`、部署 ID、epoch、CSRF。它不是登录认证；其他账号、密码、OIDC 路由全部关闭。
- 所有共享文章和资源请求必须携带 `X-RadishInk-Workspace: <deploymentId>/<workspaceEpoch>`。缺失或过期返回 `409 workspace-changed`，不能只凭文章 ID 重放旧请求。账号模式在正常鉴权后验证存在的该头，保留旧协议客户端兼容。
- 写入继续要求精确 Origin 与 CSRF。共享 Cookie 使用 `HttpOnly` / `SameSite=Lax` / 生产 `Secure`，签名绑定部署、epoch、进程密钥，12 小时过期；它只防跨站请求，不代表用户权限。有效 Cookie 在同一浏览器多个标签间复用。服务重启后旧令牌失效，写入返回 `401 shared-session-expired`，需重新连接。
- Web 持续显示“共享服务器工作区 · 无用户隔离”和读写删除提示；不展示登录、退出和账号绑定。沿用新建、资源、ZIP、版本冲突、正文抢救和显式放弃流程。
- 401 或工作区变化使前端沿用既有隐私边界清除旧响应、Blob 和编辑视图，不保留跨身份草稿；维护前必须先保存或下载当前正文。断网时身份未失效的稿件仍可通过现有抢救入口导出，不自动把旧页面内容重放到转换后的工作区。API 保持 `no-store`，PWA 不缓存文章响应。

## 离线转换

先停写并停止 `web` / `server`。以下命令在维护容器或项目构建产物中运行；绝对路径须位于受控挂载目录，源、备份和目标不能互相包含。备份及目标都必须是新建或空目录。命令自动完成完整备份与校验后才转换；**转换仅写新目标，原卷保留原模式和原 epoch**。停机后执行，成功前不要让任何目标接管正式流量。

单一账号卷转共享：

```sh
node dist/storage/storage-cli.js convert-mode \
  --data-dir /data/workspace --mode accounts \
  --target-dir /data/shared-new --target-mode shared \
  --backup-dir /backups/before-shared \
  --owner-id <唯一账号的内部-UUID> --confirm-shared
```

仅允许一个真实用户（包括未批准、禁用和无文章用户的总数）；指定账号须启用且已批准。多用户卷直接拒绝，先按用户导出文章并在另建工作区显式导入，不自动合并或公开。`--confirm-shared` 明确确认所有访问者获得共享文章权限。

共享转账号前，离线准备接收账号；全新共享卷可使用：

```sh
node dist/auth/account-cli.js init-admin --data-dir /data/workspace --mode shared --username recipient
```

该命令要求真实 TTY、交互式无回显密码，不从命令行或环境变量读取密码。返回的内部 `userId` 用于下一步；共享 HTTP 不开放该账号。若是从账号模式转换而来的共享卷，原用户、密码、角色和 OIDC 绑定仍保留，可直接选用符合条件的原账号，也可按账号维护说明离线恢复。不得重新创建同名身份来代替原 ID。

```sh
node dist/storage/storage-cli.js convert-mode \
  --data-dir /data/workspace --mode shared \
  --target-dir /data/accounts-new --target-mode accounts \
  --backup-dir /backups/before-accounts \
  --owner-id <接收账号的内部-UUID>
```

接收者必须存在、启用且已批准，卷内还必须有有效管理员。转换需要 schema 3；旧卷先按既有逐版本升级流程操作。不存在、禁用、待批准的接收者或其他所有者的文章 / 文件都会拒绝。

转换保留文章 ID、正文、用户元数据、原图、revision、删除状态及幂等回执；仅重写协议清单归属及其摘要、移动所有者目录、更新数据库归属和用量。保留快照与暂存清单也转换；无效残留清单要求先检查并显式清理。用户元数据中的同名 `ownerId` 不参与授权，也不会被改写。

成功时撤销全部旧会话与 OIDC 尝试，保持部署 ID，生成新 epoch。新目标经完整校验后发布；失败目标保留 `maintenance-incomplete`，禁止启动，源卷和已完成备份仍可用。检查失败原因后使用另一个空目标重试；不要删除保护标记或扫描孤儿数据猜测成功版本。普通 `restore` 仍不转换模式。

核对命令报告后，把服务的 `RADISHINK_DATA_DIR` 改为新目标并配置对应模式和登录方法；通过 ready 后再恢复入口。先完成已知测试文章、原图和保存验证，再按保留策略处理旧卷。转换回退同样通过 [备份恢复](backup-restore.md) 到新空目标并轮换 epoch，不启动可能与旧页面相冲突的陈旧副本。

## 验证入口

Linux arm64 / amd64 的最终服务端镜像使用合成 tmpfs 执行 `scripts/deployment/shared-storage-checks.cjs`，具体 `docker run` 参数见脚本首部。该检查覆盖实际维护 CLI 的双向转换与多用户拒绝，不替代最终双架构全部署矩阵。

- `mise exec -- pnpm validate:server`：真实 worker HTTP、双向转换、归属 / 备份 / 失败阻断。
- `mise exec -- pnpm validate:web`：能力契约、epoch 请求、失效清理与既有编辑 / ZIP / 缓存回归。
- `mise exec -- node scripts/deployment/shared-smoke.mjs --serve`：使用本地 `radishink-p4-test-server/web` 镜像，临时 Compose 项目和 4184 / 4185 端口；Playwright CLI 执行 `scripts/browser/shared-workspace-checks.js`。Ctrl-C 清理本脚本容器、卷与临时 TLS。

实际结果与未验证项见 [P4-3 验证记录](../records/2026-10-29-shared-workspace-p4-3.md)。
