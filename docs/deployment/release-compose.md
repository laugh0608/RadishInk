# 固定版本 Compose 与受控维护

本文提供独立于[本地构建 Compose](compose.md)的拉取式配置和维护工具。镜像尚未实际发布，示例 tag / SHA 均为不可直接部署的占位值；实际发布状态见[当前状态](../status/current.md)，本轮本地证据见[实施记录](../records/2026-11-03-release-compose.md)。不启用发布工作流，不把本地合成部署写作远程上线。

## 固定版本与配置

[release lock 示例](../../deploy/release-lock.example.json)记录一份部署的完整 Git tag、40 位 source revision、`linux/arm64` 或 `linux/amd64` 及两份平台镜像 digest。工具派生 `ghcr.io/laugh0608/radishink-{web,server}:<完整 tag>@sha256:<平台 digest>`；不接受浮动别名、其他仓库、零值占位或单独一份镜像。两份镜像的 OCI 来源、revision、版本、实际平台和非 root 用户必须匹配，digest 必须对应单平台 image manifest，不能以多平台 index 冒充平台 digest。当前工具要求 Docker 的 image inspect 提供 Descriptor 信息，缺失时明确拒绝。

[公开配置](../../deploy/release.env.example)仅允许已知的 `RADISHINK_*` 键，重复键、未知键和多行值会失败。生产 Origin 必须为无路径、尾斜线和用户信息的精确 HTTPS；开发 HTTP 只接受 `127.0.0.1`。子路径和登录模式复用服务端约束。OIDC 开启时仍使用 `RADISHINK_SECRETS_DIR` 与既有 [OIDC overlay](../../deploy/compose.oidc.yml)，实际 secret 只由容器以 UID 1000 从只读秘密目录读取并核验权限，不写入公开配置、命令或部署记录。

[拉取式 Compose](../../deploy/compose.release.yml)保留两服务的只读根文件系统、非 root、同源反代、健康依赖和后端无宿主端口。没有 build，使用 `pull_policy: never`，工作区卷为显式 external 卷，不为名称错误自动创建空库。维护备份卷只挂给一次性维护容器，不挂载给 Web 或常驻 server。

维护工具隔离父进程的 `RADISHINK_*` 和 `COMPOSE_*`，只用显式公开配置与 release lock 派生的镜像引用；不读取默认 `.env` 或用户的其他 Compose 文件。Docker 本身的连接 / 凭据配置仍由操作员控制，不修改全局设置。

## 首次准备

以下仅在镜像已按对应授权发布、分发条件通过之后用于实际环境。先拉取并核对两份固定引用；不从本例猜测真实 digest。保留原有部署的项目名与卷名，显式准备独立备份卷及当前操作员拥有、权限 `0700` 的状态目录；路径及其父目录不能经过符号链接。工作区和备份卷必须为两个已存在、无挂载选项的普通 local 命名卷，不支持借 local driver 选项挂入网络目录。

新安装才显式创建空卷；已有数据直接沿用旧卷，不能执行初始化替代迁移。新备份卷首次以最终 server 镜像的 `/data` 目录挂载，使 Docker 初始化 UID/GID `1000:1000`、权限 `0700`，不递归认领旧文件：

```sh
# <server 固定引用> 必须来自已核对的 release lock；以下不会发布镜像。
docker volume create radishink-backups
docker run --pull never --rm --read-only --network none \
  --mount type=volume,source=radishink-backups,target=/data \
  '<server 固定引用>' node -e ''
```

新账号工作区通过既有 `account-cli init-admin` 在真实交互终端初始化，口令不通过参数、管道或环境变量输入；共享工作区则显式调用 `storage-cli init --mode shared`。数据卷均挂到 `/data`，工作区为 `/data/workspace`。原有命令、恢复与模式转换边界见[本地部署](compose.md)、[离线备份恢复](backup-restore.md)和[共享工作区](shared-workspace.md)。本工具不初始化管理员、不自动转换归属、不将账号错误降级为共享模式。

示例工作路径由部署者准备，配置文件与 release lock 使用实际值：

```sh
mise exec -- pnpm deploy:release preflight \
  --release /srv/radishink/release-lock.json \
  --env-file /srv/radishink/public.env \
  --project radishink --state-dir /srv/radishink/deployment-state

mise exec -- pnpm deploy:release apply \
  --release /srv/radishink/release-lock.json \
  --env-file /srv/radishink/public.env \
  --project radishink --state-dir /srv/radishink/deployment-state
```

## 只读预检

`preflight` 不拉镜像、不创建状态文件、工作区或备份目录，不停机。镜像未准备、卷未初始化、模式不符、无有效管理员、秘密文件不合约或旧 schema 缺少 `--upgrade` 时拒绝。它检查最终镜像和解析后的 Compose 映射，核对已有项目的 server 确实使用指定工作区；同名项目包含其他服务或另一数据卷会失败。

探针容器没有网络，两个卷均只读挂载，根文件系统只读，只有 `/tmp` 为 64 MiB tmpfs。正常 `StorageDatabase` 构造器会取得写锁并开启 WAL，因此探针不调用它：运行中的数据库读取已存在的 WAL 只读视图；已检查点且不存在 WAL 的数据库复制到探针 tmpfs 后查询，避免 SQLite 为只读源创建 SHM。复制期间文件变化或出现 WAL 时拒绝，副本不写回。输出标记 `sourceView`；临时空间不足或无法取得可读一致视图明确失败，不使用忽略 WAL 的 immutable 模式。

预检是当时可读的身份 / schema 与配置检查，不是完整备份、磁盘健康或未来不会变化的证明。停机后再次核对部署 ID、epoch 与 schema，再由现有 CLI 完整检查、备份和独立恢复校验。

## apply 顺序与记录

1. 先取得状态目录的独占锁，记录新 run；拉取两份固定引用并做完整预检。`--no-pull` 只用于明确的离线准备 / 本地验证，仍核验已载入镜像和 digest，不改用其他镜像。
2. 为工作区创建 Docker daemon 范围内唯一命名的维护锁容器，同一卷不能被两个本工具实例并行部署；锁容器不启动业务服务。
3. 停止 Web 入口，再停止 server；静止后复核工作区身份。备份至独立卷 `/backups/<runId>/snapshot`，不覆盖已有备份。
4. 将备份恢复到新的独立临时卷，复用 `storage-cli restore` 的完整校验，并确认 schema、部署 ID 和 epoch 轮换。成功后删除这个临时验证卷；失败则在记录中保留其名称，供操作员检查，不将半成品挂给应用。
5. 源 schema 为 1 / 2 时必须显式 `--upgrade`，逐次执行现有 `upgrade-auth` / `upgrade-oidc`，各自使用独立备份目录。schema 3 不伪造升级步骤。schema 1 的账号库没有可恢复的有效管理员时，预检要求按已有离线恢复流程人工处理，不猜测管理员或归属。
6. 独立执行 `storage-cli check`，有未知路径或身份 / schema 不符即停止；然后仅启动 server 并等待 ready，再恢复 Web。
7. 从公开同源 Origin / 子路径请求 capabilities，核对协议、模式、ready、部署 ID 和 epoch，才记录 `ready`。真实部署的登录、正文、原图和保存继续作为操作员 / 浏览器验收，不能由公共能力响应替代；合成环境已在该外部入口实测这些流程。

`--ready-timeout` 默认 90 秒，允许 1–300 秒；单条 Docker 命令上限 300 秒，超时按当前阶段失败处理。状态目录保存每个 run 的私有 JSON 与 `latest.json`，记录固定镜像、配置摘要、备份位置、前后身份、阶段、失败位置与恢复依据；每次写入先 fsync 再替换。不会保存配置全文、客户端 secret、Cookie、Token、文章正文或原始 Docker 输出；只保留命令类别、退出类别和受控错误码。

## 失败、取消与恢复

镜像不可用或预检失败发生在停机前，原入口保持原状。开始停机后任何受控失败都会尝试停止 Web / server，并记录是否成功；如果停止本身失败，记录 `stopFailed`，需要操作员立即处理，不能宣称入口已经关闭。备份、失败恢复卷及源数据保留，不自动覆盖原卷或用旧镜像强写新 schema。

在升级命令执行前，以及 server 启动前，先持久记录 `dataMayHaveChanged=true`。随后失败或中断，工具拒绝直接对同一工作区再次 apply，且保留原失败记录；不能删除 `latest.json` 或锁来冒充已恢复。SIGINT / SIGTERM 会取消未完成命令并执行受控清理；SIGKILL / 断电不能保证清理动作已执行，须检查最后持久阶段、容器与实际数据，不把进程终止当作物理断电验收。

恢复时先停旧入口，核对记录及备份，通过现有 restore 恢复到显式的新空卷并轮换 epoch。旧服务容器仍引用原卷时，先用原配置 `down` 保留卷，再将公开配置改为已验证的新目标，并重新预检 / apply；不自动拆掉另一数据卷的容器。旧源卷、失败现场和备份保留，旧 Cookie / epoch 必须拒写。数据尚未变更且兼容性已经独立确认时，可由操作员按原配置恢复此前实例，本工具不自动选择回退版本。

维护锁容器名和 run 标识可从记录追溯。异常退出留下的锁只能在确认没有维护进程、核对对应记录和容器标签后显式清理；不自动根据 PID 或超时抢锁。若锁清理失败，即使应用已 ready 也会返回需要处理的错误，并在记录中保留锁容器 ID。

## 验证入口与尚未启用的发布

```sh
mise exec -- pnpm test:governance
mise exec -- pnpm test:deployment --server <最终 server 本地镜像> --web <最终 web 本地镜像>
```

smoke 使用独有项目 / 卷、本机 `4294` 临时 HTTP 入口、合成文章与 PNG，并输出 PID；支持正常结束和信号后的资源清理，不终止其他项目。它构建只在本机存在的 `v99.12.*-test` 标签和 OCI 元数据夹具，使用真实单平台 digest，不 push，不将它们写作实际来源或发布版本。覆盖当前 schema 安装、固定版本再次部署、只读预检、错误 / 缺失镜像、备份权限 / 损坏、存储异常、readiness 失败、取消升级、独立新卷恢复、旧 epoch 和 schema 2→3。取消升级在迁移命令启动边界触发，不冒充迁移事务中途 SIGKILL 或断电。

CI 原生 x64 / arm64 任务在最终镜像材料校验后执行该 smoke，失败传递给 Candidate Quality。停用 Docker 模板已准备 Web / server 双组件、双架构和相同 tag / revision / OCI 来源，发布前先校验根 `version.json` 的版本及轨道；模板仍停用，标签不可覆盖、成对发布记录 / digest 收集、基础系统源码提供方式以及正式发布授权仍是独立条件，不因这些本地验证而启用上传。
