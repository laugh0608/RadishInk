# 服务端持久化与本机维护

状态：2026-10-29，P4-2 已增加[离线备份恢复与 epoch 轮换](../deployment/backup-restore.md)；P3-1 持久化与 P3-2 本地账号 / 文章 HTTP 已实现并经本地验证。仓储源码在 `apps/server/src/storage/`；账号初始化、显式 schema 升级、loopback 启动与 HTTP 限制见 [本地账号与 API](server-http.md)。P3-3 Web 已完成本地接入，配置与验收见 [服务器 Web 工作区](server-web.md)；旧匿名上传已撤下挂载，尚未对外部署。HTTP 契约见 [P3 规划](../planning/server-workspace-contract.md)，决策见 [ADR 0002](../adr/0002-server-workspace-and-identity.md)。

## 职责与使用条件

- `StorageDatabase`：数据卷独占、有版本事务迁移、实际 schema / 迁移摘要 / 账号模式校验、数据库完整性与外键检查。`registerOwner()` 仅供可信内部存储调用，不创建密码、管理员或可登录账号。
- `ArticleRepository`：完整快照提交、CAS 版本、操作回执、资源读取、分页、删除墓碑及容量。所有操作按内部所有者查询；没有接受浏览器 ownerId 的 HTTP 接口。
- `StorageFiles` / `SnapshotFiles`：路径、普通文件约束、不可变对象、文件同步与完整性检查；正文保留 BOM / CRLF 和未知 frontmatter，元数据保留未知 JSON 字段。
- `storage-backup` / `StorageVolumeLock`：离线完整备份、空目录恢复、摘要与归属校验、恢复后撤销会话及 epoch 轮换；与服务使用同一卷锁，失败目标不开放。
- `StorageMaintenance`：校验当前快照与派生索引、列出未引用文件，显式清理 / 重建派生索引；不从孤儿快照恢复归属或最新版本。

仓储仍为同步本机实现；P3-2 把它放入有界 worker，文件 IO 不在 HTTP 主线程，图片在 worker 中完整解码。可信内部仓储只验证资源字节与清单；HTTP 保存必须先通过图片验证，并提供事务内会话复核。执行限额见 [HTTP 边界](server-http.md#文章图片与执行边界)。

仅支持本机数据卷。首轮文件系统类型范围为 macOS APFS，以及 Linux ext、Btrfs、XFS、tmpfs、OverlayFS；NFS / SMB / CIFS 和未知类型拒绝。tmpfs 仅用于临时验证，不能当作持久存储；类型探测也不代替部署者确认卷的真实来源。数据目录只能由服务 / 维护进程管理，外部编辑器写入不受保存协议保护。目录内符号链接、硬链接和非普通文件明确失败。

## 依赖与验证命令

服务端固定 `better-sqlite3@13.0.3`、类型包 `@types/better-sqlite3@9.6.0`，本轮实际 SQLite 为 3.53.4。pnpm 9 会对有 `binding.gyp` 的该版本误触发安装期编译，尽管包声明 `gypfile: false` 且自带预编译文件；根 `pnpm.neverBuiltDependencies` **仅列此包**。运行时仍必须实际加载并通过测试，缺少平台二进制不能视为安装成功。上游问题见 [安装脚本检测](https://github.com/WiseLibs/better-sqlite3/issues/1516)。升级驱动或 pnpm 时重新验证，问题解决后删除此例外；不禁用其他依赖脚本。

```bash
mise exec -- pnpm validate:server
mise exec -- pnpm build:server
mise exec -- node apps/server/test/storage-runtime.cjs
```

`validate:server` 先运行无自动修复的 ESLint，再由 `test:server` 构建 Nest / TypeScript 并运行 Jest；真实中断子进程加载最新编译产物。独立 runtime smoke 验证编译后仓储，不依赖 Jest 的平台专用解析器。所有测试使用临时合成目录；P3-2 HTTP 测试会启动临时 loopback 服务并在结束时关闭。

CI 增加 `Server Quality` 的 Linux x64 / arm64 矩阵，`Candidate Quality` 必须等待仓库、Web、服务端全部成功。此配置已随 P3 推送到 `dev`，P3 / P4 代码候选的原生双架构远程结果已在 [P4-4 记录](../records/2026-10-29-deployment-p4-4.md#已推送与远程证据)核验通过；不能用历史 Web CI 结果替代当前候选检查。Ruleset context 名称不变，当前证据见 [当前状态](../status/current.md)。验证证据与警告见 [P3-1 记录](../records/2026-10-25-server-storage-foundation.md)。

## 初始化与检查

先准备目标目录的父目录，用独立空目录初始化，不指向旧上传目录或其他项目数据。以下路径是示例，执行前替换为部署者选定的绝对路径：

```bash
mise exec -- pnpm build:server
mise exec -- node apps/server/dist/storage/storage-cli.js init --data-dir /absolute/path/radishink-data --mode accounts
mise exec -- node apps/server/dist/storage/storage-cli.js check --data-dir /absolute/path/radishink-data --mode accounts
```

`accounts` 初始化空用户表，尚不能登录；`shared` 创建固定内部共享所有者。已有卷的模式变化会失败，即使带 `init` 也不覆盖。非空陌生目录、缺失数据库但有文章文件、未来 schema、迁移摘要或实际表结构漂移都不会自动修复 / 清库。

数据布局沿用 P3 契约，并增加 `process-lock.sqlite`。该独立 SQLite 连接在运行 / 维护期间持有 `BEGIN EXCLUSIVE`，不锁住业务数据库的短事务；另一个服务或维护实例立即拒绝。正常退出和进程中止后由系统释放锁，没有按时间“抢占”活锁，也不删除锁文件模拟解锁。

首版 schema 1 的 SQL / 摘要保留；当前新卷初始化 schema 3，在同一事务创建表、部署身份和模式。schema 1 / 2 可继续运行本机存储检查；HTTP 需要先经 [账号升级](server-http.md#初始化与恢复) 和 [OIDC 升级](server-oidc.md#升级旧卷) 到 schema 3，各步先完整备份再迁移，不自动升级。CLI 关闭数据库和卷锁后才退出；错误输出稳定分类与可用的系统错误码，不输出正文、SQL 或秘密。

## 写入、容量与删除

保存先验证归属、版本、全资源清单和限额；捕获正文 / 元数据 / 字节副本，写入暂存后同步并发布不可变对象与快照，重读校验完整内容，最后短事务发布版本指针、派生索引、计量与回执。事务内再次检查所有者启用状态、版本和逻辑配额；HTTP 的授权回调在同一事务再次复核会话。

同一操作 ID、相同逻辑内容的重试返回原提交版本，后续已有新版本也不回退；相同 ID 携带异值失败。资源路径不得同名换字节或从完整清单隐式移除；不带新字节的引用必须属于本文章当前提交。请求不能凭猜到的摘要引用其他文章或未提交对象。

数量与容量默认沿用 P3 契约；逻辑用量由事务计量，保留文件用量每次扫描该所有者的文章 / 暂存文件长度，包含旧快照和孤儿。文件用量不含 SQLite、WAL、目录项与文件系统分配开销；全卷另保留 16 MiB 余量，IO 期间真实 ENOSPC 仍传播失败。文件扫描与完整资源校验的本机测量见 [P3-2 容量记录](../records/2026-10-25-server-local-api.md#容量实测)，不能据此承诺任意规模高并发性能。

删除先按版本校验，事务写入不可复用的 ID 墓碑并扣除逻辑用量，读取 / 列表 / 资源立即不可见；磁盘字节由显式维护清理。保存旧回执不能复活文章，删除回执可重试；清理后仍保留墓碑和回执。此行为不提供用户版本历史或撤销删除入口。

## 清理与索引重建

服务进程必须先停止；维护命令使用同一卷锁，不能与服务并发。先运行 `check`，核对 `candidates`、`reclaimableBytes`、`unknownPaths` 和 `planDigest`。确认需要清理且备份可用后，提供该次预览摘要：

```bash
mise exec -- node apps/server/dist/storage/storage-cli.js cleanup --data-dir /absolute/path/radishink-data --mode accounts --apply --plan <check返回的planDigest>
```

不加 `--apply` 只返回检查报告。执行前重新检查当前快照、全部候选文件摘要及清单；状态变化使预览过期。只删除已确认的非当前内部文件和由此产生的空快照 / 暂存目录，不递归清空目录。未知文件保留并列出；损坏的当前快照、链接或数据库错误停止清理。中途删除失败保留已执行结果，重新检查后再确认，不把部分清理报告为成功。

标题 / 时间或 `owner_usage` 汇总索引漂移时，可从数据库明确指向的完整快照重建这些派生字段：

```bash
mise exec -- node apps/server/dist/storage/storage-cli.js reindex --data-dir /absolute/path/radishink-data --mode accounts --apply
```

该命令不修复正文 / 图片损坏、不恢复丢失数据库、不更改归属 / 版本 / 删除状态、不提升孤儿。完整备份恢复与 epoch 轮换见 [P4-2 操作说明](../deployment/backup-restore.md)，共享 / 账号模式迁移见 [P4-3 说明](../deployment/shared-workspace.md)；本轮没有迁移用户真实数据。
