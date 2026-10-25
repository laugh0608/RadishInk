# RadishInk Server

`apps/server` 保留 WeMD 的 NestJS 上传代码，并开始承载 RadishInk P3 服务端能力。当前已实现文章持久化基础与本机维护 CLI，尚未接入登录、文章 HTTP API 或 Web 服务器模式。不要把旧匿名上传服务作为新服务器工作区部署。

## 目录结构

```
apps/server/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── services/        # 腾讯 COS 等服务封装
│   ├── upload/          # 上游上传代码，正式 P3 启用前停用
│   └── storage/         # 数据库、文章快照、容量与维护命令
├── test/                # e2e、真实中断子进程与编译产物 smoke
└── package.json
```

## 常用命令

```bash
mise exec -- pnpm validate:server
mise exec -- pnpm build:server
mise exec -- node apps/server/test/storage-runtime.cjs
```

## 开发注意

- 上传能力涉及云服务密钥，示例、测试和文档中不要提交真实密钥。
- 数据卷必须独立、位于本机，并由单个服务 / 维护进程独占；测试只使用合成目录。
- 初始化、检查、显式清理、依赖原生包与剩余边界见 [服务端持久化](../../docs/development/server-storage.md)，设计见 [P3 契约](../../docs/planning/server-workspace-contract.md)。
