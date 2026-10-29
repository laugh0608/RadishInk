# 2026-10-29 P4-2 备份恢复与 epoch 轮换

范围：用户明确继续 P4-2，真实 Radish 联调延期。本轮在 `dev` 接着 P4-1 的本地未提交修改开发；开始时暂存区为空、HEAD / 本地跟踪分支为 `f3141f1`，未覆盖前轮文件或改写历史。没有接触真实用户数据、外部 OIDC 注册或远程部署。

## 实现

- `storage-cli backup / restore --data-dir ... --mode ... --backup-dir ...`：离线一致备份与空目录恢复。数据源、备份和目标必须分离；复用卷独占锁，不接受运行中复制或覆盖恢复。
- 源卷通过完整性、schema、快照、资源和派生索引校验后，checkpoint 并关闭内容数据库，继续持锁复制。新备份清单包含格式、schema、部署身份和逐文件摘要；不复制进程锁或 WAL / SHM。
- 恢复使用隔离暂存目录与未完成标记，完整校验后撤销全部会话 / OIDC 尝试并随机轮换 epoch。保留部署 ID、内部用户 / 文章归属、口令 / OIDC 绑定、正文 / 原图、元数据、revision、墓碑、幂等回执及登录限速窗口。
- 失败现场保留且拒绝启动；备份源不被修改。兼容旧 schema 升级备份，恢复保留 schema，升级仍显式逐步执行。
- [操作说明](../deployment/backup-restore.md)覆盖 Compose、新卷恢复、配置与秘密配套、失败排查、旧版本回退和旧页面重新连接。无新依赖、schema、存储键或公开恢复 API。

## 实际验证

沿用本机 mise Node 22.23.3 / pnpm 9.0.2、Docker / Compose 与 P4-1 固定 digest 的服务端镜像；只使用合成用户和临时目录 / 卷。

| 命令 / 入口                                                                                                                            | 结果                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise exec -- pnpm validate:server`                                                                                                    | Lint / build 通过，8 个 suite、105 项测试通过；含正式构建产物 / SQLite / worker / HTTP                                                                          |
| `mise exec -- pnpm validate:web`                                                                                                       | 治理 59、core 64、Web 798 项通过，生产构建通过；12 条既有 Lint 警告、既有大 chunk 与 baseline-browser-mapping 提示保留                                          |
| `BUILDX_CONFIG=/tmp/radishink-p4-buildx RADISHINK_ORIGIN=https://ink.example.invalid docker compose -p radishink-p4-test build server` | 最终功能源码的 Linux arm64 镜像构建通过，未修改全局 Docker 配置或上传镜像                                                                                       |
| `mise exec -- node scripts/deployment/compose-smoke.mjs --recovery --serve`                                                            | 原 P4-1 9 组容器检查及独立备份卷 → 空命名卷恢复通过；非 root、只读根、原图 / 归属 / 部署 ID 保留、epoch 变化、旧 Cookie 401 与新 Cookie + 旧 CSRF 403           |
| `scripts/deployment/recovery-faults.cjs`（最终镜像、64 MiB 源 tmpfs + 1 MiB 目标 tmpfs）                                               | 真实 ENOSPC 返回非零及系统错误码；失败目标不能打开，原备份在新目录恢复成功；schema 2→3 CLI 升级、无效备份目标拒绝且旧 schema 保留、旧升级备份恢复及再次升级通过 |

浏览器 `scripts/browser/compose-recovery-checks.js` 最终整轮通过：生产 HTTPS / Nginx / Nest 下，备份后先保存更新版本，再恢复旧备份；旧页真实保存收到 401 并清除正文与 Blob 原图。按提示重新连接、登录后，正文 / 元数据 / revision / 原图清单恢复到备份版本，原图逐字节一致，合法新保存推进一个 revision。40 个 API 响应全部 `no-store`，SW 缓存没有 API，localStorage 没有合成正文，pageerror 为 0。截图 `output/playwright/p4-recovery.png` 被 Git 忽略。未用合成 visibility 事件冒充真实后台切换，也未改产品失效门禁。

存储测试覆盖普通备份往返、重复恢复新 epoch、原备份字节不变、口令可用、绑定保留、会话 / OIDC 尝试清空、墓碑 / 回执保留、锁冲突、关闭数据库仍持锁、源目标别名 / 嵌套、非空目标、模式不符、路径穿越、重复路径、缺失 / 额外文件、损坏字节、软 / 硬链接、未来 schema、摘要重算后的错误外键 / 当前资源、复制故障、复制中与发布阶段真实子进程 SIGKILL、旧 schema 1 / 2 恢复与逐级升级、共享仓储模式保持。SIGKILL 验证进程中断，不等于主机断电。

HTTP 用例先备份 revision 0，再保存 revision 1，随后恢复旧备份到新目录。原会话 401；重新登录保留原用户 ID，Bob 仍不能读取 Alice；旧页面 CSRF 配合新 Cookie 也不能覆盖，正文 / 原图恢复到备份版本，合法新保存通过。Web 原有 epoch 实例失效测试继续通过。

## 验证中发现与修正

- 旧升级备份的只读 SQLite 检查会留下零长度 WAL / 派生 SHM。恢复只为旧格式接受并忽略无提交数据的附属文件；非空 WAL 拒绝，新备份不产生这些文件。
- HTTP 测试的更新最初遗漏已保存资源清单，按既有“不能隐式删除资源”契约收到 422；修正合成请求，未放宽保存规则。
- 沙箱无法启动 Chrome 的 Crashpad / 系统通信，经受控执行启动独立临时 Chrome；不修改用户 Chrome 配置或系统证书信任。npm 缓存写入受限时复用本机已有 Playwright CLI 0.1.22，没有安装或修改全局工具。
- 浏览器自动化的 `bringToFront` 下两个测试页均报告 visible，不能当作真实切后台证据；本轮改测恢复后旧页实际保存返回 401。恢复后旧 capabilities 会让登录明确要求“重新连接”，夹具按产品提示操作。登录后需等待默认文章加载完成再选择目标，避免测试抢先点击；已选文章不一定再次请求，改为核对实际选择与内容。

## 尚未覆盖与后续

真实 Radish 联调按用户要求延期。未迁移真实数据、未做异地备份上传 / 加密、未测试真实持久卷断电或最终 amd64 / arm64 全部署矩阵；本轮 Linux 容器为 arm64，不能用本机 Jest 或旧双架构 smoke 替代最终镜像证据。共享 HTTP / Web 与显式归属转换属于 P4-3，服务器 PWA 全矩阵、容量和阶段集成属于 P4-4。

P4-1 / P4-2 仍为本地未提交修改，未推送、创建 PR、tag / Release、发布镜像或部署远程服务。阶段 PR 的远程 CI 与 Ruleset 状态未作新声明。

## 最终收尾

最终 Compose recovery smoke 再执行退出码为 0；修正测试夹具在切换恢复卷后遗漏清理原合成卷的问题，并验证退出时原卷、恢复卷和备份卷全部清理。Chrome 临时会话已关闭，测试容器与命名卷为空，4184–4186 无监听；保留本机构建缓存 / 验证镜像、被 Git 忽略的合成截图和临时日志，未停止其他项目服务。

最终仓库检查与 `git diff --check` 通过，新增部署 / 浏览器脚本语法检查通过。工作区共 48 个变更文件，包含前轮 P4-1 的 39 个文件与本轮增量；暂存区为空，`dev` HEAD 仍为 `f3141f1`。没有创建提交、推送或发布。
