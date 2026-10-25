# Radish OIDC 登录

P3-4 已接入服务端 `openid-client@6.8.8` 和 Web 登录 / 绑定入口。本地合成发行方的协议与浏览器结果见 [实施记录](../records/2026-10-25-server-oidc.md)；真实 Radish 发行方尚未联调。当前服务仍只监听 loopback，Compose、HTTPS 入口和正式部署属于 P4。

## 配置与可信边界

先按 [本地账号说明](server-http.md#初始化与恢复) 初始化管理员；仅 OIDC 部署同样需要这条受控恢复路径。服务不自动读取 `.env`，部署配置必须显式传入，参考 [示例](../../apps/server/.env.example)。

| 变量                                | 默认与要求                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `RADISHINK_PASSWORD_LOGIN`          | `true`，仅接受 `true` / `false`                                                       |
| `RADISHINK_OIDC_ENABLED`            | `false`，启用后必须提供 issuer、client ID、密钥文件                                   |
| `RADISHINK_OIDC_ISSUER`             | 发现文档的精确 HTTPS issuer，保留路径与末尾斜杠，不填发现文档 URL                     |
| `RADISHINK_OIDC_CLIENT_ID`          | Radish 侧独立 confidential client 的 ID                                               |
| `RADISHINK_OIDC_CLIENT_SECRET_FILE` | 服务可读的普通文件，禁止符号链接和组 / 其他用户权限；最多 4096 字节，可有一个末尾换行 |
| `RADISHINK_OIDC_CLIENT_AUTH`        | `client_secret_basic`；也支持明确配置 `client_secret_post`                            |
| `RADISHINK_OIDC_ADMISSION`          | `approval`；显式 `auto` 才允许新外部身份直接作为普通用户登录                          |
| `RADISHINK_BASE_PATH`               | `/`；子路径如 `/nested/`，与 Web runtime config、公开路由一致                         |

至少启用一种登录方式；禁用 OIDC 时残留 OIDC 配置也会拒绝启动。生产环境的 issuer / 协议端点必须 HTTPS；只有非生产 loopback 合成环境允许 `http://127.0.0.1`。客户端密钥不放入 `VITE_*`、前端 JSON 或 Git。

回调固定为 `RADISHINK_ORIGIN + RADISHINK_BASE_PATH + api/v1/auth/oidc/radish/callback`。须在真实 Radish 侧精确注册；没有任意 `returnTo`。反代应保留查询参数并把公开 API 路径映射到后端 `/api/v1`。发行方需支持 Code、PKCE S256、RS256、配置的客户端认证方式以及 `max_age=0` / `auth_time`；不满足时明确失败。当前不支持其他算法或隐式降级。

## 升级旧卷

新卷为 schema 3。原 schema 1 / 2 的 SQL 和摘要不改写；HTTP 只使用 schema 3。旧卷先停服务，用显式命令逐级升级：

```bash
# 仅 schema 1 需要先执行这一条；每次使用新的卷外备份目录。
mise exec -- node apps/server/dist/auth/account-cli.js upgrade-auth --data-dir /absolute/path/data --backup-dir /absolute/path/before-auth
# schema 2 → 3，必须先完成上一阶段或原本已为 schema 2。
mise exec -- node apps/server/dist/auth/account-cli.js upgrade-oidc --data-dir /absolute/path/data --backup-dir /absolute/path/before-oidc
```

升级持有独占卷锁，先复制数据库及完整 `users` / `staging` 文件并逐项重读校验摘要，再事务拆分用户档案与密码凭据、增加外部身份和授权尝试表。保留内部用户 ID、口令摘要、角色、文章归属和部署身份；撤销全部旧会话，要求重新登录。备份失败不开始迁移，未知 schema / 漂移拒绝升级，不自动降级。此次只验证合成旧卷，未迁移真实数据。备份清单与完整恢复的当前边界见 [持久化说明](server-storage.md)。

## 登录、绑定与准入

双登录部署在登录页同时显示密码与 Radish 按钮；仅 OIDC 部署隐藏密码入口。跳转前保存当前稿件，授权请求完成后再次确认稿件与工作区未变化；保存失败或切换时停止跳转。取消授权后保留本地存储选择与已保存稿件。

本站外部身份只按精确 `(issuer, subject)` 关联内部用户 ID，不使用邮箱、昵称或上游角色合并账号 / 授予管理员。新身份默认生成 `radish-UUID` 用户名并等待批准，不创建密码，不具有文章权限。部署管理员停服务后执行：

```bash
mise exec -- node apps/server/dist/auth/account-cli.js list-oidc --data-dir /absolute/path/data
mise exec -- node apps/server/dist/auth/account-cli.js approve-oidc --data-dir /absolute/path/data --username radish-UUID
mise exec -- node apps/server/dist/auth/account-cli.js revoke-sessions --data-dir /absolute/path/data --username radish-UUID
```

`list-oidc` 输出内部用户名、ID、准入、启用状态和外部 issuer / subject，供管理员核对身份；不要将真实输出上传到 Git 或公开日志。批准后用户重新登录。`enable` 不能绕过待批准状态。禁用、恢复密码与撤销命令延续 [本地账号操作](server-http.md)，不会转移文章。

已有本地账号在“账号登录方式”内重新验证本站密码，再走新的 Radish 授权来绑定。绑定前后保留内部用户和文章；冲突不会合并。绑定和解绑撤销该账号旧会话，其他标签立即清理私有视图并重新验证。解绑必须确认且有启用的本地密码登录方式；仅 OIDC 账号不能解除唯一登录方式。只有管理员通过明确的 `reset-password` 恢复流程才能为其设置本地密码。

“保存并退出”只退出 RadishInk，取消本浏览器未完成的授权尝试，不调用上游 EndSession。会话空闲 30 分钟、绝对 12 小时；上游禁用不承诺即时联动，下一次登录要求上游重新认证。本地管理员禁用则即时撤销本站会话。

## 密钥轮换、故障与恢复

密钥文件在启动时读取。轮换客户端密钥需协调 Radish 注册值与本地文件，然后重启；旧配置发起的授权尝试因配置摘要变化失败，用户重新发起即可。换 issuer / client ID 不是账号自动迁移，不按同邮箱补绑。JWKS 由库缓存与重新获取，公钥轮换可能在缓存冷却窗口内先失败，之后可重试；本地测试推进缓存逻辑时钟验证重新获取，不能替代真实轮换窗口验收。

上游发现、Token、JWKS、UserInfo 每个完整响应限制 5 秒 / 1 MiB，禁止重定向；失败不影响已启用的本地密码入口，不降级为共享访问。默认准入的仅 OIDC 部署仍需离线批准。上游不可用时，部署管理员停服务、通过 TTY `reset-password` 恢复既有管理员，必要时 `enable`，显式启用 `RADISHINK_PASSWORD_LOGIN=true` 后重启；配置整体错误时应修正或完整禁用 OIDC 及其字段。没有网络免密恢复接口。

授权使用一次性 5 分钟 state / nonce / PKCE，浏览器绑定 Cookie 为 HttpOnly、SameSite=Lax，生产强制 Secure / `__Host-`。回调先持久化消费，再换码验签与校验 claims；失败不可重用，退出或禁用能撤销在途尝试。授权码仅出现在协议回调，立即 303 到固定应用路径；业务页只接收固定结果并清理参数。Token 不进入 SQLite、浏览器持久存储、业务 URL 或日志，Refresh Token 不保留。实际反代日志也应避免记录回调查询串。

## 验证入口与未验证项

```bash
mise exec -- pnpm validate:server
mise exec -- pnpm validate:web
# 独立查看真实编译产物的协议用例：
mise exec -- node --test apps/server/test/oidc-protocol.cjs
# 浏览器使用正式构建；只启动本机合成实例：
mise exec -- node scripts/browser/server-oidc-server.cjs
```

浏览器脚本在 4194 提供双登录 / 默认准入，在 4195 提供仅 OIDC / 显式自动准入，均使用 `/nested/`；另有临时 loopback API 与合成发行方端口，启动输出 PID 和临时卷。使用 Playwright CLI 执行 `run-code --filename scripts/browser/server-oidc-checks.js`；Ctrl-C 关闭服务和 worker 并清理合成卷。截图保存在忽略的 `output/playwright/`。不要将该脚本用作部署服务。

真实 Radish 侧注册独立客户端、实际 issuer / HTTPS 回调、账号准入与禁用、登录 / 本站退出、真实 JWKS / client secret 轮换和上游故障仍待联调；需提供已授权的客户端配置和测试身份，秘密通过受控文件交付。当前没有修改兄弟项目或远程设置，未进行真实用户迁移、远程 CI、手机真机或公众号验收。
