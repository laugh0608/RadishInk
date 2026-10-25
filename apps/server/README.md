# RadishInk Server

P3-1 持久化与 P3-2 本地账号 / 文章 API 已实现并本地验证。当前只监听 loopback，尚未接入 Web 工作区、OIDC 或 Compose。旧匿名上传与公开 `uploads` 已撤下挂载，旧文件与上游源码保留。

## 目录结构

```text
src/
├── app.module.ts / main.ts  # 显式配置的 Nest 启动入口
├── auth/                   # Argon2、会话、限速与本机账号 CLI
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

初始化管理员、恢复口令、schema 升级、启动 / 退出与 HTTP 用法见 [本地账号与 API](../../docs/development/server-http.md)。离线检查 / 清理见 [持久化维护](../../docs/development/server-storage.md)，协议见 [P3 契约](../../docs/planning/server-workspace-contract.md)。测试仅使用合成临时卷，不能将本地通过当作已部署或已完成 Web 验收。
