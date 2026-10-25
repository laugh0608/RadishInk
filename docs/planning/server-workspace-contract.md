# P3 服务器工作区实施契约

状态：2026-10-25，P3 技术方案与验证计划；以下为待实现协议 v1，不是当前线上能力。架构取舍见 [ADR 0002](../adr/0002-server-workspace-and-identity.md)，部署与账号产品范围见 [自托管专题](self-hosted-storage.md)。

## 模块与启用

`apps/server` 内按配置 / 数据库迁移、身份会话、文章仓储、HTTP 接口划分职责。文件与数据库协议放在文章仓储，Controller 只做协议解析和调用；鉴权必须覆盖所有入口，不能只在 Controller 列表过滤。首轮单个 Node 服务进程，启动持有数据卷独占锁；第二实例拒绝启动，不能依靠 SQLite 写锁代替文件发布与清理互斥。

正式启用前停止挂载旧 `UploadModule` 和匿名 `/uploads/`，移除宽泛 CORS；遗留上传文件保持原样，不进入新文章库。新后端无配置 / 无管理员时不开放文章接口，初始化命令从交互输入读取密码，日志和命令参数不含秘密。

前端提供随构建的公开运行时配置，静态默认 `{ deployment: "static" }`；Compose 在容器启动时生成 `{ deployment: "server", apiBase: "/api/v1" }`。使用受部署 base path 约束的同源地址，不接受用户任意 API URL；配置损坏明确报错。P4 再接镜像启动生成，P3 本地以合成同源配置测试。

仅 `server` 请求能力，响应必须为 JSON 且 `protocolVersion` 为 1；HTML fallback、错误版本、超时、维护中分别报告。能力返回随机持久化的 `deploymentId`、恢复时轮换的 `workspaceEpoch`、账号模式、登录方式、限制和 ready 状态，不含用户身份、内部路径、密钥或具体数据库错误。后端尚不可用不切换当前存储。

## 数据布局与模型

```text
/data/
├── metadata.sqlite                     # 连同 WAL 纳入一致备份
├── staging/<operation-uuid>/            # 未发布的正文 / 资源
└── users/<internal-user-uuid>/articles/<article-uuid>/
    ├── objects/<sha256>                 # 仅本文章复用，不可变资源字节
    └── generations/<generation-uuid>/
        ├── index.md                    # 原始 UTF-8 字节，保留 BOM / CRLF
        ├── article.json                # HistorySnapshot 中除 markdown 的字段
        └── manifest.json               # 格式、身份、revision、摘要、全部资源映射
```

服务器内部布局不伪装为可直接编辑的目录工作区；磁盘只由服务端操作。标准可移植文章仍是 ZIP 中 `index.md` + `asset/`，导出按 manifest 重建相对路径；不导出内部用户、Cookie、操作记录或绝对路径。未知 frontmatter / 元数据字段继续保留，客户端字段中的 `ownerId` 等不得成为授权来源。

| 表                                 | 关键约束与职责                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `schema_migrations` / `deployment` | 版本与迁移摘要、账号模式、部署 ID、工作区 epoch；未来 schema 拒绝启动                   |
| `users`                            | 随机内部 ID、状态、本站角色；规范化用户名唯一，口令摘要可空                             |
| `external_identities`              | `(issuer, subject)` 唯一、关联用户；不可按邮箱补配                                      |
| `sessions`                         | 仅保存随机会话 ID 的摘要、用户、认证方式、创建 / 最近活动 / 到期时间                    |
| `oidc_attempts`                    | state 摘要、浏览器绑定、nonce、verifier、用途、过期 / 消费状态；短时秘密不进日志        |
| `login_limits`                     | 账号 / 来源的有界失败窗口与到期时间；定期删除过期计数，不保存口令或原始请求             |
| `articles`                         | 全局 UUID、所有者、当前 revision / generation / manifest 摘要、删除状态、派生标题与时间 |
| `commit_receipts`                  | `(ownerId, operationId)` 唯一、请求摘要、文章 ID、结果版本与操作类型                    |
| `usage`                            | 所有者逻辑用量及物理保留量；与成功提交 / 删除同步更新，启动可核对                       |

所有外键启用；读 / 写语句显式含所有者条件。暂存、快照、资源路径由服务端验证的 UUID / 摘要生成，不直接拼接标题、历史 `filePath` 或用户上传名。资源逻辑路径沿用 [文章路径规则](../development/article-storage-contract.md#文章与资源契约)，只允许 `asset/` 下单文件，拒绝路径编码、符号链接、大小写 / Unicode 冲突。任何文件缺失、非普通文件或摘要不匹配都报告损坏，不回退成空文或旧版。

## 保存协议

客户端固定工作区身份和文章 ID，创建时 `expectedRevision: null`，已存在文章提交已读非负安全整数；首版 revision 为 0。每次业务提交生成新的随机 `operationId`，网络重试复用原 ID 和内容，编辑变化不能复用 ID。

`PUT /articles/:id` 使用有界 multipart：一个 `manifest` JSON 部分，一个原始 `markdown` 文件部分，以及按 manifest 中独立 part ID 指定的新资源文件。manifest 包含 `operationId`、`expectedRevision`、文章元数据和**全部保留资源**的 `{path, sha256, size, partId?}`。无 part ID 的资源必须已存在于当前文章已提交清单且摘要 / 字节数一致；不能引用其他文章对象、暂存对象或只根据猜到的摘要认领图片。新字节必须重新计算摘要，不能信任声明。

已保存路径不可变、不可隐式移除；减少清单、同路径不同字节均拒绝。正文保存无需重新上传未变图片；新增资源仍先完成完整提交，再由现有编辑锚点逻辑插入相对路径。重命名通过相同完整提交更新标题，不改文章 ID。

保存步骤遵循 ADR 的文件先持久化、事务最后发布。事务内重新检查账号 / 会话仍有效、归属、版本、完整资源约束、幂等回执和配额；事务外的预检不构成最终授权。相同操作已提交且请求摘要一致时返回原结果，摘要不同返回冲突。摘要覆盖协议版本、方法、文章 ID、预期版本、正文摘要、规范化元数据与按路径排序的资源清单，不受 multipart 边界或属性排列影响。

幂等回执保留到文章永久清理；删除保留 ID 墓碑，禁止同 ID 重建。重试先鉴权；文章已删除或用户禁用不能用旧回执重新访问内容。回执仅证明该操作当时成功，返回 `committedRevision` 不表示仍是最新版本；前端若发现远端已更新，保留本地编辑并显示冲突，不重读最新版本后强写。

首轮不做在线孤儿回收。部署者停写、排空请求后运行检查 / 清理：标记所有当前快照及其资源，校验后列出未引用暂存、旧快照与对象，确认范围后删除；保留提交回执和 ID 墓碑。清理不得与读取 / 提交并发，也不自动删未能识别的目录。物理用量达到限额时先拒绝新写并提示维护，不伪造成功。

## API v1 边界

以下路径均以 `/api/v1` 为前缀。不实现尚无调用方的搜索、服务端 ZIP 解压或独立公共上传接口。

| 方法与路径                                  | 输入 / 输出与授权                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /capabilities`                         | 公共能力；不含私有数据，`no-store`                                                       |
| `GET /health/live`、`GET /health/ready`     | 存活 / 已完成迁移和一致性检查；失败仅返回通用状态，运维原因留脱敏日志                    |
| `GET /auth/session`                         | 已登录用户、工作区身份、CSRF token；未登录返回 401；共享模式返回明确共享身份             |
| `GET /auth/csrf`                            | 登录前建立短时浏览器绑定 Cookie，返回对应 CSRF token；同源、no-store，不授予文章权限     |
| `POST /auth/login`                          | 用户名 / 密码，校验 Origin、限速；成功轮换 Cookie，返回会话                              |
| `POST /auth/logout`                         | CSRF 保护，撤销本站会话并清 Cookie；幂等，不自动退出 Radish                              |
| `POST /auth/oidc/radish/start`              | 来源 / CSRF（含登录前浏览器绑定）校验后建立短时尝试，返回受信任授权 URL                  |
| `GET /auth/oidc/radish/callback`            | 精确注册 URI；state / 浏览器绑定 / nonce / PKCE 与 Token 校验后建立会话                  |
| `GET /articles`                             | 当前所有者的有界分页列表，不含资源和正文；默认 50、最多 100 条                           |
| `GET /articles/:id`                         | 完整元数据、原字符串 Markdown、revision 与资源路径 / 摘要清单；无权限统一 404            |
| `PUT /articles/:id`                         | 完整快照提交；创建 201、更新 / 同操作重试 200，返回 `operationId` 与 `committedRevision` |
| `GET /articles/:id/assets/:name?revision=N` | 当前所有者且当前版本匹配才读；版本变化返回 409，不能混合不同快照资源                     |
| `DELETE /articles/:id`                      | JSON 含 operationId / expectedRevision；事务标记删除并保留回执，列表 / 读图立即不可见    |

元数据 API 的 Markdown 为 JSON 字符串，不重新生成 frontmatter；资产读取必须设置准确 MIME、`nosniff` 和 `Cache-Control: no-store`。只接受当前支持的 PNG / JPEG / WebP / GIF，不开放 SVG / HTML 可执行文件。只有显式 ZIP 下载才形成用户下载文件。

客户端读取文章后按同一 revision 获取资源；过程中版本变化则整体读取失败并提示重试，不能拼接新旧快照。导出复用前端 ZIP worker 与既有校验；导入在前端验证后以新 UUID 提交。标题、时间与列表排序等派生值不得替换原始正文。

错误 JSON 固定 `{ error: { code, message, requestId, retryable } }`；可选已授权目标的当前 revision，不含正文、磁盘路径、SQL 或秘密。401 会话失效；403 来源 / CSRF 不符或账号未准入；404 不存在 / 他人对象；409 版本或幂等冲突；413 请求 / 文章过大；422 格式、资源清单或路径非法；429 限速 / 并发忙；503 数据库忙或维护；507 磁盘 / 容量不足。失败保持客户端编辑，不能统一返回空列表。

## 限额与并发

服务器策略和公开能力使用同一配置源；前端仅提前提示，后端逐字节限制，不能只信任 Content-Length。初始默认值如下，部署者只能在后续验证过的范围内调整：

- 主 Markdown 5 MiB；元数据 JSON（含未知字段 / CSS）1 MiB；资源 125 个、单图 10 MiB / 1600 万像素，正文与资源总量 64 MiB，沿用 P2 ZIP 内容边界。ZIP 自身头部仍可能导致导出超过 64 MiB，沿用既有明确失败，不能宣称所有满额文章必能导出。
- multipart 请求体 66 MiB，并单独限制 manifest、part 数量、字段长度和请求时间；反代值与服务端一致。图片检测至少验证头部、尺寸与完整解码，具体解码库和内存用量在 P3-2 验证后锁定，不能仅信 MIME。
- 每用户 1000 篇、当前逻辑正文 / 资源总量 1 GiB；物理数据（含历史和暂存）2 GiB，预留新快照容量，临界时先拒绝写入。全卷剩余空间同时检查，检查后仍可能发生 ENOSPC，必须原样传播失败。
- 每用户最多一个进行中的提交，服务端最多四个；超限明确重试，不开无限等待队列。文件 / 图片处理不占用数据库写事务；同文章最终由事务版本比较裁决，单请求超时 60 秒。

这些是服务器初始策略，不改变浏览器 30 篇限制或本地目录行为。具体峰值内存 / CPU 和磁盘放大率属于实施验收，不能只靠文档数字判断容量达标。

## 会话、密码与 OIDC

生产 Cookie 采用 `__Host-radishink-session`，`HttpOnly; Secure; SameSite=Lax; Path=/`，不设置 Domain；本地 HTTP 开发用单独非前缀 Cookie，生产配置不允许关闭 Secure。随机会话 ID 至少 256 bit，数据库保存摘要，空闲 30 分钟、绝对 12 小时；活动不延长绝对期限。登录 / 重新认证轮换会话，退出、禁用、密码重置撤销；请求提交事务前再检查撤销状态。

所有写入验证明确配置的公开 Origin 与 CSRF token，登录前也绑定浏览器；OIDC callback 通过一次性流程验证，不能要求普通写入 CSRF token。仅信任配置的反代地址，不直接信任任意转发头。登录每账号 15 分钟最多 5 次失败、每来源 15 分钟最多 30 次；账号不存在与口令错误给同一响应，限制持久化，重启不能清零绕过；Argon2 并发单独限制为 2。

Argon2id 起点为 `m=19456 KiB, t=2, p=1`，每次独立随机盐；在目标容器测量延迟与资源后只向更强方向调节。参数来自 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，本轮没有进行口令库性能验证。

OIDC 采用 confidential client、Authorization Code + PKCE S256，默认 `openid profile`，不保存 Refresh Token。每次尝试 5 分钟、一次性 state / nonce / verifier，绑定发起浏览器和登录 / 绑定用途；回调消费尝试后失败也不恢复重用。固定可信 issuer 与回调，发现 / Token 请求设超时；返回目标只允许应用 base path 下的相对路由。验签、iss / aud / azp、有效期、nonce 和 UserInfo sub 必须按标准检查，使用库 API 而非自行解析 JWT 即接受。[OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)

新 OIDC 身份默认建立无文章权限的待准入记录，由本机管理员批准后启用；不按第一位登录者授予管理员，不自动归并邮箱。绑定现有账号需 5 分钟内重新认证并走全新 OIDC 流程；解除绑定必须保留可用登录方式。首轮账号管理 / 恢复 / 准入走本机命令，Web 管理面板不前置。

本站会话最多 12 小时后重新走上游认证；请求 `max_age=0` 并验证 `auth_time`，真实 Radish 若不满足则 OIDC 验收不通过，不悄悄取消此要求。上游禁用生效延迟最多受本站剩余会话时间影响，前提是下一次真实上游认证确实拒绝该用户；尚未验证 Back-Channel Logout，不能承诺立即联动退出。

## 前端适配与私有状态

`ServerStorageAdapter` 映射虚拟文章路径到固定 UUID，不允许任意文件系统路径。`ServerArticleStore` 固定部署 ID、epoch、内部用户 ID 和 articleId，资产只通过授权读取派生 Blob URL；已读版本由实例保留，不能保存前取最新 revision 绕过冲突。第一轮不提供服务器文件夹树 / 目录移动 / 通用文件 API。

账号切换先处理未保存编辑和上传；用户选择保存、导出或明确放弃后再切换。身份变化递增前端 generation、取消请求、清除旧正文 / 资源 / Blob URL 与内存索引；迟到结果即使请求未取消也不能写入新用户界面。不得把服务器私有正文持久化到通用 `historyStore` / IndexedDB / localStorage。

Service Worker 禁止缓存整个 API 前缀；私有响应统一 `no-store`。登出广播到同源标签页；页面重新可见、pageshow（含 BFCache）和恢复联网时先遮蔽旧私有视图并重新验证会话。服务器断线保留当前编辑供抢救，离线不声称保存；主动登出则清理私有视图，二者不能混为一谈。验证后退、旧标签、离线及换账号均不展示前用户内容。

## 迁移、备份与恢复

- 浏览器 / 本地目录不改 schema、键名和数据；迁入服务器只通过显式单篇 ZIP 导入为新 ID，源文章保持不变。
- 旧 `uploads`、COS 路径和上游服务没有可靠所有者元数据，不自动迁移或公开；以后若需导入，必须有独立映射与备份步骤。
- 空卷初始化 schema 与账号模式；已有卷启动核对模式和 schema。共享转账号必须停写、备份、指定有效接收用户；多用户转共享默认拒绝，先显式完成导出和归属处置。配置错误不自动迁移。
- 迁移先获取独占启动锁、校验备份与摘要，再事务执行；未知版本、失败、SQLite integrity / foreign key 检查失败均退出且不 ready。索引重建仅访问数据库确认的快照，不收编孤儿。
- 首轮备份走停服务离线复制完整数据卷及受控配置；在持有独占维护锁后检查、checkpoint 并关闭数据库，再复制，拒绝复制运行中的主 `.sqlite` 文件冒充备份。恢复到空目录校验清单、schema、用户 / 文章归属及全部资源摘要，撤销会话和 OIDC 尝试，轮换 workspace epoch 后启用。恢复不会因旧版本镜像而自动降级 schema。

## 实施顺序与验收

| 切片                | 交付与必要证据                                                                                                                    | 可开放范围                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| P3-1 持久化基础     | 接入锁定驱动与 SQL 迁移、独占锁、不可变快照、版本 / 幂等、配额和维护检查；使用正式仓储复跑故障矩阵，核对依赖许可与 Linux 原生构建 | 本地合成数据；无公开文章入口                |
| P3-2 本地账号与 API | Argon2、初始化 / 恢复命令、Cookie / CSRF / 限速、CRUD 与资源读取、真实 HTTP 集成测试；停用旧公开路由；图片解码与容量实测          | 先 loopback；越权负向用例通过才开放受控网络 |
| P3-3 Web 闭环       | runtime config、能力发现、真实适配、图片 / ZIP / 冲突 / 断网、退出多标签与缓存；完整 Web 基线、静态无 API 请求回归                | 本地端到端测试，不宣称多端同步              |
| P3-4 Radish OIDC    | 库接入、准入 / 绑定 / 撤销、协议负向测试，然后实际 issuer / 独立客户端真实往返                                                    | 真实配置与联调另确认；替身不能标记已联通    |
| P4 Compose          | 双服务构建、版本 / health / 配置 / 同源反代、全新安装、重建、备份恢复到新实例、amd64 / arm64 验证                                 | 镜像 / 部署发布需对应授权                   |

服务端新增独立验证命令，包含无自动修复的 Lint、类型 / build、迁移与存储单测、HTTP 集成及两用户越权矩阵；在 P3-1 实施时落地，不把尚不存在的脚本写成当前门禁。既有 `validate:web` 保持原含义，P3 阶段 PR 同时运行 Web 与服务端检查。

关键负向验收：A 猜到 B 的文章 / 图片 ID 时不能列表、读取、保存、删除、打包或重试成功；路径穿越 / 编码 / 符号链接；旧 revision、重复 operation 异值、提交后丢响应、各发布阶段崩溃、数据库忙、真实磁盘满、资源缺失 / 篡改、恢复旧备份后的旧标签；CSRF / 会话撤销 / OIDC 重放和同邮箱误合并。每组写明自动化替身、真实进程、文件系统或真实上游的证据类别。
