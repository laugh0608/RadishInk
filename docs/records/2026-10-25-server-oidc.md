# P3-4 OIDC 本地实现与验证

日期：2026-10-25。按“提交工作区更改，然后继续推进下一步”的授权，先将 P3-3 提交为 `a019c22 feat(web): 实现 P3-3 服务器工作区`，再在 `dev` 实施 P3-4。P3-4 随后按用户收尾要求提交为 `e1e8b0d feat(auth): 实现 P3-4 OIDC 登录与账号关联`；未推送、部署、改动真实 Radish 注册或迁移真实数据。

## 实现与取舍

- 服务端通过动态 `import()` 接入固定 `openid-client@6.8.8`，保留 `nodenext` 编译；显式启用 ID Token 签名验证。Code + PKCE S256、一次性 5 分钟 state / nonce、浏览器 Cookie 与用途绑定、`max_age=0` / `auth_time`、issuer / audience / azp / UserInfo subject 校验均经实际编译产物运行。
- schema 3 拆分用户资料与密码凭据，精确 issuer / subject 唯一映射内部 ID；不按邮箱合并，不信任上游角色。旧卷显式完整备份和摘要核对后迁移，保留原 ID / 口令摘要 / 文章；旧会话撤销。schema 1 / 2 原迁移 SQL 与摘要不变。
- 本地密码与 OIDC 可并存或仅 OIDC；默认待准入，明确 `auto` 才直接启用普通用户。管理、批准、禁用、会话撤销和密码恢复经本机 CLI。绑定 / 解绑要求新近密码验证并保留可用登录方式，不自动创建 OIDC 用户密码。
- Token 不持久化。每个上游完整响应有 5 秒 / 1 MiB 限制且不跟随重定向；尝试先消费再交换，取消、过期、配置变化、退出和禁用不会复活旧尝试。新客户端密钥重启生效，既有尝试需重发。
- Web 按能力展示入口，跳转前保存并复核当前稿件；回调固定返回应用目录并移除结果参数。绑定保留账号 / 文章，解绑撤销本站会话。仅退出本站，不提供上游 EndSession 或即时 Back-Channel Logout。

配置、升级命令、恢复路径和真实联调条件集中在 [OIDC 操作说明](../development/server-oidc.md)，不在本记录重复配置值。

## 验证证据

| 验证                                | 实际结果与范围                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mise exec -- pnpm validate:web`    | 治理 59、core 64、Web 798 项通过；生产构建成功；Lint 0 错误、12 条既有警告                                                                                                                                         |
| `mise exec -- pnpm validate:server` | 无自动修复 Lint、Nest build、6 个 Jest suite / 83 项通过；其中独立协议子进程额外逐项执行 31 个 `node:test` 用例                                                                                                    |
| schema / CLI                        | 实际合成 schema 2 → 3 全量备份及逐文件摘要核对，口令 / 内部 ID / BOM / CRLF / 元数据与正文保留，旧会话撤销；备份失败与不显式升级拒绝；编译 CLI 升级 / 列出 / 准入通过                                              |
| OIDC 正常与隔离                     | 真实 loopback HTTP + Node RSA 签名 + JWKS + openid-client + SQLite / worker；默认准入、同邮箱不合并、文章隔离、绑定冲突、原用户归属、禁用与密码恢复、仅 OIDC、client_secret_post 与子路径通过                      |
| 协议负向                            | 错误签名 / issuer / audience / azp / nonce、缺 ID Token / nonce / auth_time、过期和过旧 / 未来认证时间、UserInfo subject 不符、浏览器与 state / code 交换 / 重放、过期 / 取消 / 配置变化、服务重启及换码中退出通过 |
| 上游故障与轮换                      | 错误 discovery、缺 S256、重定向、超大响应、无响应、响应头后慢正文均失败且本地密码仍可用；旧 client secret 失败、更新并重启后成功；JWKS 轮换推进 61 秒缓存逻辑时钟后重新获取真实公钥并验签成功                      |
| 生产 Web 浏览器                     | 正式 Web 构建 + Nest API + 本机合成发行方，双登录 / 同账号绑定保留原稿、其他标签重新验证、OIDC 重登、解绑后待准入、本地稿件取消恢复及仅 OIDC 390px 触屏尺寸；不等于真实手机或真实发行方                            |
| 秘密与私有数据                      | 协议测试核对 SQLite 字节不含 client secret / access token / ID Token；浏览器核对 localStorage / IndexedDB 无私有正文或上游凭据，业务 URL 清理。生产包未注入任何真实秘密                                            |

复用项目 Node 22 / pnpm 9.0.2。初次沙箱执行服务端测试出现 loopback `EPERM`，经允许本机监听后完整运行通过，未放宽断言。Web 构建仍有上游 chunk size 与 baseline-browser-mapping 数据提示；测试中的预期错误路径日志不视为静默失败。

测试入口为 `apps/server/test/oidc-protocol.cjs`、`apps/server/src/auth/oidc-migration.spec.ts`、`scripts/browser/server-oidc-server.cjs` 和 `scripts/browser/server-oidc-checks.js`。五组浏览器检查全部通过，页面运行错误为 0；待准入与手机尺寸截图已目视复核。协议使用合成发行方，所有用户名、密钥、文章及图片均为合成数据；浏览器截图仅落已忽略的 `output/playwright/`。交付前已关闭本次专用浏览器与临时服务，确认 4194 / 4195 无监听、合成卷已删除、无本次测试残留进程；暂存区为空，工作区仅保留本轮源码、测试与文档。

## 验证中修正

1. 上游发出响应头后不结束正文时，单独调用 abort 未能可靠覆盖完整读体；改为完整请求 / 读体与 5 秒截止时间竞争，并取消 reader。慢正文负向用例确认约 5 秒结束，不再耗尽整个 HTTP 请求期限。
2. `BroadcastChannel` 的另一个实例会向同一页面投递消息；密码重新验证广播曾让自身工作区重建、打断绑定。通知加入每页来源 ID，当前页忽略自身消息，其他标签及旧版通知仍先清理再验证；单测与浏览器绑定流程复核。
3. 浏览器验收显式等待新文章载入再输入，待准入断言定位可见会话区域；重复运行应重启合成服务以清空前次外部绑定 / 准入状态。

## 依赖与剩余边界

新增服务端依赖 `openid-client@6.8.8`；锁文件仅增加该包和 `jose@6.2.13` / `oauth4webapi@3.8.8`，均核对实际包内 MIT 许可及版权。未更新其他依赖，服务端分发时须保留这些许可；此次未构建或发布容器镜像。官方实现说明见 [openid-client](https://github.com/panva/openid-client)，版本见 [v6.8.8](https://github.com/panva/openid-client/releases/tag/v6.8.8)。

真实 Radish 的 issuer、独立 client、HTTPS 回调、`auth_time` 行为、准入 / 禁用、实际 JWKS / client secret 轮换和故障仍未联调。真实 Cookie / HTTPS 部署、远程 CI、Linux 本轮 OIDC 矩阵、Compose / 恢复演练、手机真机与公众号未验证。本地协议和浏览器结果不能标记为“Radish 已联通”，P3 真实验收仍待对应配置与授权。
