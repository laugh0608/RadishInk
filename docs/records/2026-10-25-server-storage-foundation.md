# P3-1 服务端持久化基础

日期：2026-10-25。用户要求先提交工作区，再推进下一步。前轮方案与原型已提交为 `7914b63`；本轮在 `dev` 实施 P3-1，没有推送、创建 PR、启用真实服务、改动外部账号或发布镜像。本文对应本地实施结果，操作说明以 [服务端持久化](../development/server-storage.md) 为准。

## 实现

- 接入 `better-sqlite3@13.0.3` 与 `@types/better-sqlite3@9.6.0`。迁移 schema 1 带版本 / SQL 摘要 / 实际结构校验，启动核对完整性、外键和账号模式；独立 SQLite 锁连接保护整个文件卷，进程退出后释放。
- 正式文章仓储支持内部所有者隔离、分页、完整快照、资源读取、版本冲突、规范化幂等回执、逻辑 / 保留文件容量，以及删除墓碑。文件先持久化，数据库最后发布指针；不覆盖已提交资源，不收编孤儿快照。
- 本机 CLI 提供 init / check、预览摘要保护的 cleanup、派生索引 reindex；未认领文件保留，缺失数据库不会重建归属。
- 新增独立服务端验证入口，Lint 不自动修复；测试先构建，再运行正式仓储及编译产物的真实中断子进程。CI 增加 Linux x64 / arm64 服务端矩阵，并同步聚合、仓库检查器、负向用例和文档。

`AppModule` 未接入文章模块；旧上传路由未当作新功能开放，Web 存储模式、IndexedDB schema、目录数据与发布流程均未改变。本轮没有登录、Cookie / CSRF、图片实际解码或 OIDC，所有者检查是仓储证据，不能冒充 HTTP 鉴权验收。

## 依赖与安装

原服务端 Lint、1 项测试和 Nest build 先通过。首次安装驱动时，pnpm 9 误触发默认 `node-gyp rebuild`，因无 node-gyp 命令而失败；检查安装包确认 `gypfile: false`、无 install script 且带各平台 N-API 预编译文件，直接加载实际 SQLite 成功。根配置仅对 `better-sqlite3` 使用 `neverBuiltDependencies`，其余安装脚本保留；退出条件见开发文档与 [上游问题](https://github.com/WiseLibs/better-sqlite3/issues/1516)。最终 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=true mise exec -- pnpm install --frozen-lockfile --offline` 通过，分辨“初次安装失败”与“最终可重复安装”。

锁文件由 pnpm 9.0.2 生成，新增两个服务端直接依赖及 `node-addon-api@8.9.2`；已有直接依赖版本未更改。pnpm 同时把少量传递引用归并到锁内已有版本，并刷新已有包的弃用元数据；本轮未手工编辑锁文件或升级这些包的版本集合，完整 Web 基线回归通过。网络查询曾受沙箱 / 代理限制，获授权后完成；离线重新解析缺少元数据的失败不属于产品测试失败。

核对已安装 `better-sqlite3/LICENSE`、`node-addon-api/LICENSE.md`、`@types/better-sqlite3/LICENSE` 的 MIT 文本，SQLite 原始源码保留在驱动 `deps/sqlite3/`。未把二进制或第三方源码复制进 Git；P4 镜像分发仍需打包对应声明与完整许可。上述依赖只由服务端引用，Web bundle 不导入原生驱动。

## 验证

| 验证                                | 实际结果                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise exec -- pnpm validate:server` | Lint 0 错误 / 警告；TypeScript / Nest build；46 项测试通过（含既有 controller 测试）                                                         |
| 本机 CLI smoke                      | 独立进程执行 init / check / cleanup / reindex 成功，模式不符返回非零退出码与可识别错误                                                       |
| 原生故障覆盖                        | 更新的五个 SIGKILL 阶段、首次创建失败、数据库忙、注入 IO 故障、资源损坏 / 链接、版本竞争、账号禁用、越权、清理过期、删除后重试和墓碑均有检查 |
| 治理负向测试                        | 59 项通过；实际 shell 遍历三个组件各五种结果，失败 / 取消 / 跳过 / 缺失都不放行；删服务端 job 依赖、测试、架构或伪造结果均被拒绝             |
| `mise exec -- pnpm validate:web`    | 治理 59、core 64、Web 748 通过；生产构建通过；12 条既有 Lint 警告与既有大 chunk / 浏览器映射提示                                             |
| Linux arm64 / x64 编译产物 smoke    | Node 22.23.3、SQLite 3.53.4；两种架构均完成原字节读写、卷锁、五个进程中止、重试 / 冲突、显式清理与删除墓碑                                   |
| 真实磁盘满                          | 两种 Linux 架构的独立 1 MiB tmpfs 在预检后被测试填满，正式保存抛出 ENOSPC；释放合成填充后旧正文 / 版本仍可读，完整性检查通过                 |
| 格式与仓库检查                      | 定向 Prettier、`pnpm check:repo`、`git diff --check` 通过                                                                                    |

完整 Web 日志：`/private/tmp/radishink-p3-1-web-validation.log`；服务端日志：`/private/tmp/radishink-p3-1-server-validation.log`。脚本是仓库内可复现来源，临时日志不进入 Git。

Linux 使用 `node:22.23.3-bookworm-slim`，镜像索引 digest 为 `sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9`；仓库只读挂载，非 root、禁网、不开放端口，合成数据使用容器 tmpfs。宿主为 arm64，x64 通过本机容器兼容层执行；不能声称已在独立 x64 物理机验收。所有测试容器 `--rm` 自动删除，镜像保留在 Docker 缓存，未修改用户已有容器。

直接在 Linux 容器复用 macOS `node_modules` 跑 Jest 时，平台专用 `unrs-resolver` 缺失，禁网 / 只读设置阻止其自动补装；该次没有跑到产品测试。随后用标准库的 [runtime smoke](../../apps/server/test/storage-runtime.cjs) 直接加载编译仓储完成上述验证。远程 CI 将在各自 Linux runner 安装依赖并跑完整 Jest；本轮未推送，因此远程矩阵仍未验证。

## 剩余边界

P3-1 是本机持久化基础，不是服务器可部署闭环。P3-2 接下来完成初始化管理员 / 本地密码、会话与撤销、CSRF / 限速、图片真实检查、请求资源约束和 HTTP 越权测试，并在启用前撤下旧公开上传路径。同步仓储 IO 的执行位置、较大工作区扫描成本与并发限制也需在该阶段验证。

当前首版仅包含 schema 初始化；未来升级、完整备份恢复和模式迁移、Compose 启动 / 镜像分发、OIDC 真实上游仍未验收。SIGKILL / tmpfs ENOSPC 不代表断电、损坏设备或真实容器持久卷恢复已通过。P1 / P2 手机真机与真实公众号验收继续按用户要求延后。
