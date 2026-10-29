# RadishInk Server

P3-1 持久化、P3-2 本地账号 / 文章 API、P3-3 Web 接入及 P3-4 OIDC 已实现并完成本地合成验证。默认监听 loopback，P4-1 提供显式容器监听与 [Compose 本地构建](../../docs/deployment/compose.md)；P4-2 已提供[离线备份恢复与 epoch 轮换](../../docs/deployment/backup-restore.md)；真实 Radish 联调按用户要求延期，共享模式 HTTP 仍待后续交付。旧匿名上传与公开 `uploads` 已撤下挂载，旧文件与上游源码保留。

## 目录结构

```text
src/
├── app.module.ts / main.ts  # 显式配置的 Nest 启动入口
├── auth/                   # 本地密码、OIDC、准入、会话与本机账号 CLI
├── http/                   # 来源 / CSRF、请求解析、图片检查与有界 worker
├── storage/                # 数据库、不可变快照、容量与维护命令
├── services/ / upload/     # 保留的上游代码，未挂载
```

## 常用命令

```bash
mise exec -- pnpm validate:server
mise exec -- pnpm build:server
mise exec -- node apps/server/test/storage-runtime.cjs
mise exec -- node apps/server/test/http-runtime.cjs
```

初始化管理员、恢复口令、schema 升级、启动 / 退出与 HTTP 用法见 [本地账号与 API](../../docs/development/server-http.md)。离线检查 / 清理见 [持久化维护](../../docs/development/server-storage.md)，协议见 [P3 契约](../../docs/planning/server-workspace-contract.md)。Web 配置与浏览器证据见 [服务器 Web 工作区](../../docs/development/server-web.md)，OIDC 配置、schema 3 升级、准入 / 绑定与恢复见 [OIDC 操作说明](../../docs/development/server-oidc.md)。测试仅使用合成临时卷，本地通过不代表已部署或真实发行方已联通。
