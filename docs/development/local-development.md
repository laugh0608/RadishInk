# 本地开发与 mise

## Node 22 与全局 Node 24 共存

`mise.toml` 只在本仓库及子目录生效，选择 Node `22` 和 pnpm `9.0.2`。全局 `~/.config/mise/config.toml` 保持原值；不要执行 `mise use --global node@22`，也不要覆盖全局 pnpm。

在仓库根目录：

```bash
mise trust
mise install node@22 pnpm@9.0.2
mise exec -- node --version
mise exec -- pnpm --version
```

这会安装 Node 22 系列当前可用补丁版，以及指定 pnpm。`package.json` 的 `engines` 与 CI 使用同一版本范围；版本升级需同步配置和验证记录。

已在 shell 中启用 `mise activate zsh` 时，进入项目后自动切换工具；离开项目后恢复父级 / 全局配置。无需为本项目重复修改 shell 配置。脚本和 IDE 使用 `mise exec -- ...` 可避免依赖交互 shell 的切换时机。

在没有本项目配置的目录运行 `mise current node`，即可确认原来的全局选择仍在。工具按版本分别安装在 mise 用户目录，安装 22 不卸载 24。[mise 配置优先级](https://mise.jdx.dev/configuration.html)、[Node 支持](https://mise.jdx.dev/lang/node.html)。

## 安装与运行

```bash
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev:web --host 127.0.0.1 --port 5173 --strictPort
```

浏览器访问 `http://127.0.0.1:5173`。端口被占用时先查明已有服务，不终止无关进程；需要换端口则同步说明。用 Ctrl-C 退出自己启动的服务。

工作区完整安装包含保留的 Electron / server 开发依赖，Electron 可能下载二进制；纯 Web 验证可使用 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 mise exec -- pnpm install --frozen-lockfile` 跳过这一下载。以后开发桌面端时需要补齐 Electron，不能把此模式视为桌面环境已就绪。

```bash
mise exec -- pnpm validate:web
mise exec -- pnpm --filter @wemd/web run preview --host 127.0.0.1 --port 4173 --strictPort
```

第二条命令服务已有 `apps/web/dist`，不重新构建。Web 不需要启动数据库或 `apps/server`。

## 包管理约定

- 安装使用 `--frozen-lockfile`，若报锁不一致先检查原因，不删除锁文件或改用 npm 掩盖问题。
- 必须修改依赖时同步 manifest 和锁文件，审阅变更范围；不要顺手升级整套依赖。
- `corepack enable` 不是本地必需步骤，mise 已提供项目 pnpm；Vercel 的 Corepack 配置见部署文档。
- `.env`、`.env.*` 不提交，脱敏 `.env.example` 可以提交；所有发送到浏览器的变量都应视为用户可见。
