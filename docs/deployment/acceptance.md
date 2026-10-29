# 自托管部署验收

本文串联本地 P4 验证入口，不替代每次阶段 PR 的远程 CI，也不授权镜像发布。实际结果见 [P4-4 记录](../records/2026-10-29-deployment-p4-4.md)，停止线以[当前状态](../status/current.md)为准。

## 操作顺序

1. 按 [Compose](compose.md)构建同一源码的前后端镜像，在空卷显式初始化账号或共享模式。
2. 检查健康、同源 API、登录 / 共享入口、文章、原图和 ZIP；停止后重建，确认原卷数据保留。
3. 按[备份恢复](backup-restore.md)停机备份，恢复到独立空卷，核对内容、归属和 epoch；旧标签、Cookie 与 CSRF 必须拒写。升级不使用旧镜像强行降级数据库。
4. 需要转换账号模式时，单独按[共享工作区](shared-workspace.md)执行先备份、后转换；配置开关不是迁移工具。
5. 执行下列镜像 / 浏览器验证和完整基线，复核日志与分发材料，再按对应授权推进远程 CI、集成与发布。

所有脚本仅使用合成账号 / 稿件。运行时会创建自己的临时命名卷、容器和临时证书，正常结束或受支持的停止信号会清理；不要指向生产卷。异常终止后仅清理本轮输出中列出的资源。两个 Compose smoke 共用 4184–4186，必须串行执行。

## 双架构最终镜像

从同一工作区分别构建两个架构；基础镜像版本、摘要和 Node / pnpm 以 Dockerfile 及 `mise.toml` 为准。命令只构建 / 加载到本机，不 push：

```sh
docker buildx build --platform linux/arm64 --load -f Dockerfile -t radishink-p4-web-arm64 .
docker buildx build --platform linux/arm64 --load -f apps/server/Dockerfile -t radishink-p4-server-arm64 .
docker buildx build --platform linux/amd64 --load -f Dockerfile -t radishink-p4-web-amd64 .
docker buildx build --platform linux/amd64 --load -f apps/server/Dockerfile -t radishink-p4-server-amd64 .

mise exec -- node scripts/deployment/runtime-matrix.mjs radishink-p4-server-arm64 radishink-p4-server-amd64
```

`runtime-matrix.mjs` 在最终镜像中挂载只读测试入口，使用独立持久命名卷运行五个 SIGKILL 提交阶段及四账号容量探针，再运行受限 tmpfs 的真实 ENOSPC、旧 schema 升级 / 恢复和双向归属转换。复用正式编译产物，不替换 SQLite、Argon2 或 Sharp。容量探针保存约 253 MiB 合成数据，999 篇种子文章逐条持久化，amd64 模拟执行可能显著较慢。进程中止不等于宿主断电，模拟执行时间不代表原生硬件性能。

对每个架构串行运行以下两条命令，把 `arm64` 替换为对应架构：

```sh
DOCKER_DEFAULT_PLATFORM=linux/arm64 RADISHINK_TEST_SERVER_IMAGE=radishink-p4-server-arm64 RADISHINK_TEST_WEB_IMAGE=radishink-p4-web-arm64 mise exec -- node scripts/deployment/compose-smoke.mjs --recovery
DOCKER_DEFAULT_PLATFORM=linux/arm64 RADISHINK_TEST_SERVER_IMAGE=radishink-p4-server-arm64 RADISHINK_TEST_WEB_IMAGE=radishink-p4-web-arm64 mise exec -- node scripts/deployment/shared-smoke.mjs
```

协议检查通过不代表浏览器流程已通过。Compose smoke 的 `--serve` 会保留 HTTPS 入口；输出项目名和 URL 后等待浏览器检查，结束用 Ctrl-C / SIGTERM 清理自身资源。

## 服务器文章的 PWA 更新

```sh
mise exec -- node scripts/browser/pwa-upgrade-builds.mjs output/playwright/p4-pwa-builds
mise exec -- node scripts/deployment/compose-smoke.mjs --recovery --serve --pwa-builds output/playwright/p4-pwa-builds
```

用独立 Playwright Chrome 会话访问输出的 HTTPS 子路径，再通过 `run-code --filename=scripts/browser/server-pwa-update-checks.js` 执行。此入口建立独立浏览器上下文，仅忽略本机合成证书校验，不修改用户浏览器配置。

两份固定 Vite / Workbox 生产构建仅增加测试标记来改变资源摘要；不使用 HMR、清库或注销 Worker。`/__fixture/build/new|next` 只存在于本地 smoke 的 HTTPS 夹具，校验 Host / Origin，并重建前端容器，不进入产品路由。

矩阵包含延后、多标签、图片解码与 ZIP 进行中、保存 503、断网抢救与会话恢复、接管超时、重试后的最新正文 / 合成正文标记 / 原图保留，以及 API 缓存和浏览器文章副本检查。注入的网络 / Worker 门闩只作用于合成上下文；真实停机、恢复和磁盘故障使用上面的独立验证入口。

## 日志与分发材料

Compose smoke 检查 API 响应不会进入 SPA 回退、使用 `no-store`，并验证后端停止时的 503 JSON 与敏感查询串不进入 Nginx 日志。运行结果与部署日志分别留证，不输出真实 Cookie、口令、密钥或文章。

对实际镜像中的包做只读盘点：

```sh
docker run --rm -i radishink-p4-server-arm64 node < scripts/deployment/image-license-inventory.cjs > /tmp/radishink-server-licenses-arm64.json
docker run --rm --platform linux/amd64 -i radishink-p4-server-amd64 node < scripts/deployment/image-license-inventory.cjs > /tmp/radishink-server-licenses-amd64.json
```

清单覆盖实际复制的包目录，包括未被当前架构加载的可选包，记录版本、声明、许可文件与 README 摘要。`needsReview` 仅表示缺少常见许可文件名，不等于无许可或已合规；README 里的许可全文和链接需继续核对。该脚本不是放行门禁，也不替代完整通知、源码提供方式或再分发审查。基础镜像材料仍按其分发条款保留，项目及 WeMD 原始许可已在镜像 `/app/LICENSE` 与 `/app/LICENSES/` 保留。当前发现与镜像发布停止线见 P4-4 记录。

## 阶段集成

执行 `mise exec -- pnpm validate:web`、`mise exec -- pnpm validate:server` 和 `git diff --check`。阶段 PR 须针对最终提交取得 Repo Hygiene、Web Quality、两个 Server Quality 架构及 Candidate Quality 的远程结果。本地 Docker 模拟执行不替代原生 CI。

真实 Radish、手机 / 跨物理设备和公众号验收按用户安排单独记录；模拟视口、独立浏览器上下文及本机 HTTPS 都不能冒充这些证据。镜像发布工作流与 Ruleset 仍沿用仓库现行规则。
