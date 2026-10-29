# Compose 本地构建与同源部署

P4-1 提供 `web` + `server` 两个应用服务；从本仓库构建，不依赖尚未发布的 RadishInk 镜像。镜像上传与远程部署工作流仍停用。实际验证及未验证项见 [P4-1 记录](../records/2026-10-29-compose-p4-1.md)，备份恢复见 [P4-2 操作说明](backup-restore.md)，共享模式与离线转换见 [P4-3 操作说明](shared-workspace.md)。

## 边界与配置

- 前端 Nginx 监听容器 `8080`，默认只发布 `127.0.0.1:8080`；后端只在 Compose 网络监听 `4000`，没有宿主机端口。外部 HTTPS 由部署者的反代终止，并保留原始 `Host`、`Origin` 和完整子路径。
- 后端 `RADISHINK_HOST` 默认 `127.0.0.1`，Compose 显式设置 `0.0.0.0`。公开 Origin 与内部监听端口独立；生产只接受精确 HTTPS Origin，无路径或末尾 `/`。HTTP 仅供 `development` 下的 `http://127.0.0.1:端口`，不支持以 HTTP 暴露私网或公网。
- 根目录 `.env` 来自 [配置示例](../../deploy/.env.example)，仅含公开配置。`RADISHINK_BASE_PATH` 为 `/` 或 `/nested/` 这样的规范目录；前后端必须一致。运行时生成首页 JSON 和 Nginx 路由，同一镜像可换域名或子路径，无需重建。
- 服务端不信任 `X-Forwarded-*` / `Forwarded`；Nginx 清除这些头并保留 `Host`，Cookie 的 `Secure` 只依据显式 Origin。当前来源限速看到的是前端容器地址，属于保守的共享来源限额；不宣称已提供按外部 IP 的限速。
- 前端只有部署形态和相对 API 路径，不含账号或秘密。API 优先于静态资源规则，所有版本 API 均不进入 SPA 回退、PWA 或公开图片缓存；反代不重试写请求，请求上限与后端一致为 66 MiB。
- HTTP 显式支持 `accounts` / `shared` 卷；模式必须与卷一致，详见 [共享说明](shared-workspace.md)。关闭账号模式下所有登录方式会失败，不能据此开放共享区。服务器存储不会自动搬迁浏览器或本地目录中的文章。

## 全新安装

在仓库根目录执行。示例项目名固定后应持续沿用；修改项目名会生成另一个卷，不代表原数据丢失。

```bash
cp deploy/.env.example .env
# 编辑 .env：填写真实公开 Origin、子路径与本机入口端口。
docker compose -p radishink build
# 必须在交互终端运行，口令不回显、不从环境变量或命令参数读取。
docker compose -p radishink run --rm --no-deps server \
  node dist/auth/account-cli.js init-admin --data-dir /data/workspace --username admin
docker compose -p radishink up -d --wait --wait-timeout 90
docker compose -p radishink ps
```

本机 HTTP 验证时设置 `RADISHINK_ENV=development`、`RADISHINK_ORIGIN=http://127.0.0.1:8080`；浏览器也必须使用这个地址，不能用 `localhost` 替代。生产保留 `RADISHINK_ENV=production`，通过自己的 HTTPS 入口访问；入口若位于另一容器，需要明确配置其到 Web 的网络路径，不能把容器内的 loopback 当作宿主机。

新命名卷从镜像获得 UID/GID `1000:1000` 的 `/data` 目录，权限 `0700`；管理员初始化在其中创建 `/data/workspace`。服务端进程与维护命令均以 `node` 运行，前端以 `nginx` 运行，根文件系统只读。不会用启动时递归 `chown` 接管既有数据。自定义 bind mount 必须由部署者预先准备受支持的本机文件系统和 UID/GID / 权限；错误权限、符号链接或不兼容 schema 会失败，不能回退为空库。

Web 仅在后端 readiness 成功后启动。空卷不会自动初始化管理员，旧 schema 不会自动升级；账号模式无有效管理员时 readiness 返回失败；共享模式需显式初始化共享卷，见[共享工作区](shared-workspace.md)。健康检查不是备份或数据恢复证明。Compose 启停依赖语义见 [Docker 文档](https://docs.docker.com/compose/how-tos/startup-order/)，卷的持久化与首次复制语义见 [Docker 卷文档](https://docs.docker.com/engine/storage/volumes/)。

## 维护与停机

卷锁禁止运行中的服务和维护命令并发打开同一个工作区。先停止入口，再停止后端；两者均有 75 秒退出宽限期。

```bash
docker compose -p radishink stop web server
docker compose -p radishink run --rm --no-deps server \
  node dist/storage/storage-cli.js check --data-dir /data/workspace --mode accounts
docker compose -p radishink run --rm --no-deps server \
  node dist/auth/account-cli.js reset-password --data-dir /data/workspace --username admin
docker compose -p radishink up -d --wait
```

账号创建、禁用、启用和撤销会话沿用 [账号 CLI](../development/server-http.md#初始化与恢复)。仅 OIDC 部署可由部署者停机后重设原管理员本地口令，再显式启用本地登录恢复管理权，不创建隐藏网络入口。

`docker compose down` 删除容器和网络，保留命名卷；日常停机不用 `down --volumes`。容器重建保留数据只证明卷仍在，不证明备份有效。P4-2 已交付[离线备份恢复 / epoch 轮换](backup-restore.md)，操作前准备独立备份介质与配套配置，并实测恢复。旧 schema 迁移须按 [HTTP](../development/server-http.md#初始化与恢复) / [OIDC](../development/server-oidc.md#升级旧卷) 文档先停机、备份，再显式执行，不能换旧镜像强行降级数据库。

后端日志只包含监听地址或错误分类；前端关闭请求 access log 与可能附带请求 URL 的 server error log（Nginx 配置 / 启动诊断仍输出 stderr），避免 OIDC code、查询串与文章路径落入日志。排错先检查容器退出码、健康状态和 `docker compose logs`，不打印环境秘密或正文。Web 的临时产物和 Nginx 临时文件在容器 `/tmp`，停止后重新生成；数据卷不挂载到 Web。

## OIDC 秘密文件

本地账号部署不需要 OIDC 配置。已注册独立客户端并有实际配置时，合并 [OIDC overlay](../../deploy/compose.oidc.yml)：

```bash
docker compose -p radishink -f docker-compose.yml -f deploy/compose.oidc.yml up -d --wait
```

所有后续停机、维护和重建命令均使用相同的两个 `-f` 参数。设置 `RADISHINK_OIDC_ISSUER`、`RADISHINK_OIDC_CLIENT_ID` 和绝对路径 `RADISHINK_SECRETS_DIR`；后者是只读挂载的秘密目录。目录内 `client-secret` 必须是容器 UID 1000 可读的普通文件，权限 `0400` 或 `0600`，禁止组 / 其他用户权限和符号链接。Linux 上由部署者准备目录与文件所有权；Docker Desktop 的宿主机映射规则可能不同，须实际验证容器可读且权限仍满足校验。目录挂载允许部署者原子替换文件后重建 server 读取新值，不要求把秘密写入 `.env`、镜像或 Git。

精确回调为 `Origin + BASE_PATH + api/v1/auth/oidc/radish/callback`。仅在对应授权具备后注册真实客户端；此入口不代表真实 Radish 已联通。密钥轮换、准入、绑定与仅 OIDC 恢复说明见 [OIDC 专题](../development/server-oidc.md)。

## 静态形态与升级边界

Vercel 仍直接构建 `apps/web/dist`，首页默认 `static`，不使用容器启动脚本，不探测 API。前端镜像单独启动默认也为 `static`，可不带后端；Compose 明确传入 `server`。运行时改写首页时同步计算 Workbox `index.html` revision，确保配置变化产生新的 Worker；已有安全更新流程仍要求用户确认，不清库或强制激活。

旧根 Compose 是静态镜像模板，没有服务器卷；新根 Compose 改为本地构建的两个服务。`RADISHINK_IMAGE_TAG` 不再用于本地构建，端口变量改为 `RADISHINK_PORT`（原模板为 `WEMD_PORT`）。已自行使用旧模板的部署者应先保留原配置与浏览器备份，再显式采用新配置，不能直接视为自动迁移。未来正式镜像仍遵循 [完整版本标签](../governance/versioning.md)，本地项目镜像名不是发布版本。

## 验证入口

```bash
RADISHINK_ORIGIN=https://ink.example.invalid docker compose -p radishink-p4-test build
mise exec -- node scripts/deployment/compose-smoke.mjs
# 需要浏览器继续验收时使用 --serve；Ctrl-C 清理该脚本独有的容器、卷与临时证书。
mise exec -- node scripts/deployment/compose-smoke.mjs --serve
```

脚本固定本机 `4184`（Nginx）、`4185`（合成 HTTPS 入口）与 `4186`（静态镜像），占用时明确失败，不终止其他服务；使用独立随机项目名、合成账号 / 文章和临时自签名证书。`--serve` 用于 Playwright 的临时上下文；测试 Chrome 通过独立进程参数 `--ignore-certificate-errors` 允许合成证书的 Service Worker，不修改系统证书信任。`scripts/browser/compose-checks.js` 验证文章闭环（另需在 4187 启动正式 Web dist 预览），`scripts/browser/compose-update-checks.js` 验证运行时配置变化的安全更新。后者只调用 smoke 进程的本机测试端点重建该进程独有项目的 Web，生产镜像不含此端点。完整阶段检查仍需 `mise exec -- pnpm validate:web` 和 `mise exec -- pnpm validate:server`；独立卷恢复与旧页验证见 [P4-2 记录](../records/2026-10-29-backup-restore-p4-2.md)；双架构、服务器 PWA 升级全矩阵和远程 CI 在 P4 后续分别补齐。
