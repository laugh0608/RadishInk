# 离线备份、恢复与工作区 epoch

P4-2 提供 `storage-cli backup / restore`，支持当前 schema 1–3；生产 HTTP 要求 schema 3；`accounts` 模式要求有效管理员，`shared` 模式使用显式共享初始化。Compose 基础配置见 [部署说明](compose.md)，存储与维护职责见 [持久化说明](../development/server-storage.md)。本轮使用合成数据，真实 Radish 联调按用户要求延期。

## 备份内容与一致性

备份包含 checkpoint 后的 `metadata.sqlite`、`users/` 和 `staging/` 下全部普通文件，以及 `backup-manifest.json`。数据库保存部署身份、模式、用户、口令哈希、OIDC 身份映射、文章归属 / 版本 / 墓碑 / 回执和派生用量；文件保存正文、元数据和原图。不会只扫描目录推断“最新文章”，不会提升孤儿快照，也不会在备份时清理历史文件。

先停止前端入口与后端。命令取得与服务相同的独占卷锁，校验 schema、迁移摘要、数据库完整性 / 外键、当前快照、资源和派生索引；未知文件或损坏会阻止备份。成功 checkpoint 并关闭内容数据库后才复制，卷锁一直保持到复制与逐文件摘要校验结束。`process-lock.sqlite` 和 WAL / SHM 不进入新备份。数据库摘要采用分块读取，不把整个数据库载入内存。

新清单 `formatVersion: 1` 记录 schema、部署 ID、epoch、账号模式及每个文件的规范相对路径、大小、SHA-256。清单上限 16 MiB；清单最后写入，完成标记移除并同步目录后才报告成功。清单用于发现损坏，不是数字签名；备份介质必须可信、受权限保护，不能接受来源不明的备份。

备份与恢复目的地必须为新建或空目录，父目录应已存在；源与目标不能相同、相互包含或通过路径别名指回源。拒绝符号链接、硬链接和非普通文件，仅支持存储模块允许的本机文件系统。目标目录设为 `0700`、文件 `0600`；没有覆盖既有工作区的选项。

## 本机命令

以下为占位路径，替换为部署者准备的绝对路径。服务必须已经停机；`backup` 的 `--data-dir` 为源，`restore` 的 `--data-dir` 为新目标。

```bash
mise exec -- pnpm build:server
mise exec -- node apps/server/dist/storage/storage-cli.js backup \
  --data-dir /srv/radishink/workspace --mode accounts \
  --backup-dir /srv/radishink-backups/before-upgrade
mise exec -- node apps/server/dist/storage/storage-cli.js restore \
  --data-dir /srv/radishink-restored/workspace --mode accounts \
  --backup-dir /srv/radishink-backups/before-upgrade
mise exec -- node apps/server/dist/storage/storage-cli.js check \
  --data-dir /srv/radishink-restored/workspace --mode accounts
```

成功输出 JSON 摘要，不打印文章、口令、Cookie 或秘密。错误以非零退出码和错误分类返回；IO / SQLite 错误保留可用系统错误码。所有复制、校验和同步结束前，不把输出目录当作可恢复备份。

## Compose 操作

准备独立于工作区卷的本机备份目录，并确保容器 UID/GID `1000:1000` 能读写；Linux bind mount 由部署者预先设置所有权和权限，维护容器不递归 `chown`。下例假设 `/srv/radishink-backups` 已准备好。日常启动仍使用原 Compose；备份目录只挂到临时维护容器，不挂到 Web。

```bash
# 沿用现有项目名和配置；启用 OIDC overlay 时继续携带相同的两个 -f 参数。
docker compose -p radishink stop web server
docker compose -p radishink run --rm -T --no-deps \
  --volume /srv/radishink-backups:/backups \
  server node dist/storage/storage-cli.js backup \
  --data-dir /data/workspace --mode accounts \
  --backup-dir /backups/before-upgrade

# 恢复使用一个尚未安装的新项目名，产生新的工作区卷；不要先 init-admin。
docker compose -p radishink-restored run --rm -T --no-deps \
  --volume /srv/radishink-backups:/backups:ro \
  server node dist/storage/storage-cli.js restore \
  --data-dir /data/workspace --mode accounts \
  --backup-dir /backups/before-upgrade
docker compose -p radishink-restored run --rm -T --no-deps server \
  node dist/storage/storage-cli.js check --data-dir /data/workspace --mode accounts
docker compose -p radishink-restored up -d --build --wait --wait-timeout 90
```

新项目名必须确实未被使用；非空目标会拒绝。`run` / `up` 使用经过验证、支持备份 schema 的同一版本代码构建；恢复成功后若需把名字固定为原项目名，应由部署者明确配置卷映射，不能把项目名变化误当作数据迁移。原项目入口保持停止，避免两个实例同时以同一个公开 Origin 提供不同数据。

在启用入口前核对配置与备份时间点；恢复后登录检查两个用户隔离、文章数、正文、原图和合法新保存。确认后再切换实际 HTTPS 入口。保留原卷和原配置用于排查；不使用 `down --volumes` 清空原数据。单机备份目录只保护逻辑故障，部署者还应把**已完成且静止的整份备份**复制到独立介质，并定期在新目录试恢复；本命令不执行上传、异地复制或加密。

## 配置与秘密配套

数据备份不自动读取卷外配置或秘密。与每份备份一起受控保存：

- 源码提交 / 镜像 digest、Compose 文件与 overlay、公开 Origin / base path、账号模式、卷映射和容器 UID/GID。
- OIDC issuer、独立 client ID、注册的精确回调、登录开关，以及对应的秘密文件与轮换记录。秘密与公开清单分开保存，权限保持 `0400` / `0600`；不放进 Git、前端或日志。
- HTTPS 入口 / 证书的恢复方式和备份时间点；不要把容器临时目录当作配置归档。

本地口令哈希和 OIDC 身份映射在数据库中保留；数据库没有长期 Refresh Token。进程内登录前 CSRF 签名密钥重新生成，恢复不要求导出它。OIDC 客户端秘密仍须与发行方当前配置一致；恢复旧秘密不会撤销上游已经发生的轮换。真实发行方连通性没有因本地恢复而得到验证。

## 恢复后的身份与旧页面

恢复先在目标的 `restore-staging/` 中复制并校验，不打开或改写备份源。清单大小 / 摘要、实际文件集合、schema 与部署身份、SQLite 完整性 / 外键、当前文章 / 资源和派生索引均必须一致。`accounts` 与 `shared` 不能通过恢复参数互换；共享卷恢复后可按[共享工作区说明](shared-workspace.md)启动共享 HTTP；恢复不会隐式转换归属。

验证通过后，在事务中撤销全部会话和 OIDC 尝试，并随机生成新的 `workspaceEpoch`。`deploymentId`、内部用户 ID、角色 / 准入 / 禁用状态、密码哈希、OIDC 绑定、文章 ID / revision / 归属、墓碑和幂等回执保留；登录限速窗口也保留，不通过恢复绕过它。每次从同一备份恢复都会产生不同 epoch。

旧 Cookie 无效；同源另一标签重新登录后，旧标签内存中的 CSRF 仍无法配合新 Cookie 写入。前端会话重验发现 epoch 改变时，清除旧适配器快照与实例；收到 401 也清理私有视图。持续停留且尚未发起请求的页面不会收到服务端推送，不能承诺恢复瞬间主动清屏。恢复前通知使用者保存 / 导出，恢复后关闭旧页并重新登录；若保留旧页，先点“重新连接”核对新 epoch，再登录；本功能不保留未确认的浏览器内服务器草稿。

## 失败与旧版本回退

恢复全程持有目标卷锁，并保留 `maintenance-incomplete` 标记。复制、校验、事务、发布或清理任一步失败，或进程中止，目标保持非空且不能启动服务；原卷与备份源不被覆盖。先保留失败现场，检查退出码、权限、空间与备份，再选择**另一个空目录**重试。不要手动删除标记、拼接文件或用 `init` 将半成品开放为工作区。

恢复支持 P3 旧升级清单 `{schema, files}`。旧校验可能遗留的零长度 WAL 和至多 1 MiB 的派生 SHM 仅校验普通文件后忽略；非空 WAL 必须拒绝，不能从中猜测缺失提交。新备份不生成这些附属文件。未知格式、未来 schema、实际 schema 漂移、错误归属或资源摘要均拒绝。

恢复保留备份的 schema，不自动升级。schema 1 先运行 [upgrade-auth](../development/server-http.md#初始化与恢复)，schema 2 再运行 [upgrade-oidc](../development/server-oidc.md#升级旧卷)，每步使用新的卷外备份目录。升级失败时不启动 HTTP；重新核对实际 schema 和备份后继续处理。schema 1 没有登录资料，恢复不会猜测文章接收账号；归属转换属于 P4-3，不能承诺初始化新管理员就继承旧用户文章。

回退数据时用支持该 schema 的工具恢复升级前备份到新目录，再选择经验证兼容的服务版本；不能仅换旧镜像强行写入较新的数据库。恢复会丢弃备份时间点之后的服务器提交，先停写并另存当前完整备份，避免把回退当作无损操作。

## 验证入口

```bash
mise exec -- pnpm validate:server
mise exec -- pnpm validate:web
RADISHINK_ORIGIN=https://ink.example.invalid docker compose -p radishink-p4-test build
mise exec -- node scripts/deployment/compose-smoke.mjs --recovery
# 独立 tmpfs：真实 ENOSPC 与旧 schema 升级 / 恢复，不使用已有数据卷。
docker run --rm --read-only \
  --tmpfs /data:uid=1000,gid=1000,mode=0700,size=64m \
  --tmpfs /restore:uid=1000,gid=1000,mode=0700,size=1m \
  -i radishink-p4-test-server node < scripts/deployment/recovery-faults.cjs
# 浏览器恢复验收：下行保留本机合成入口，完成后 Ctrl-C 清理。
mise exec -- node scripts/deployment/compose-smoke.mjs --recovery --serve
```

浏览器入口 `scripts/browser/compose-recovery-checks.js` 使用 Playwright CLI；端口与临时 HTTPS 规则沿用 [Compose 验证入口](compose.md#验证入口)。脚本的备份 / 恢复端点只存在于本机合成夹具，不进入生产镜像。实际结果及剩余边界见 [P4-2 记录](../records/2026-10-29-backup-restore-p4-2.md)。

P4-3 双向归属转换复用本流程的空目标、完整校验与 epoch 轮换，另见 [共享工作区](shared-workspace.md)。普通 restore 仍保持原模式。
