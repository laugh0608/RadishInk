# Vercel dev 部署与域名检查

日期：2026-10-05，Asia/Shanghai。

## 用户范围与现场起点

用户报告从 main 改为 dev 后部署未成功，要求查看 Chrome 中现有 Vercel 页面；明确使用 Hobby 免费计划、只保留现有项目，域名已由用户设置为 `ink.radishx.com`。这些最新要求取代早先新建独立验收项目和不绑定正式域名的建议；本轮未新建项目、升级计划或修改域名配置。

现场核对项目 `laugh0608s-projects/radish-ink`：

- 起初只有一条可见部署，来自 `main / 1f8ad27`，状态 Ready，部署 ID `2NcmzSPHWGPDWtdUCHgPdZr2timd`；未发现 dev 的失败构建记录，不能反推用户此前点击失败的具体原因。
- 项目概览提示后续推送 `dev` 更新 Production，创建部署表单解析 `dev` 为 Production，提交为 `a3c45e8f0be2c17d32b9731f7dc5d60bf56c447e`。切换跟踪分支并不代表旧部署已替换。
- Framework 为 Vite，Root Directory 为空（仓库根目录），Node 为 22.x，Output Directory 为 `apps/web/dist`。
- 黄色 Production Overrides 提示中的差异为 Build / Install：现有部署使用仓库的 `pnpm build:web` 与 `pnpm install --frozen-lockfile`，面板未手动覆盖两项。它是配置来源差异，不是构建失败证据。
- Ignored Build Step 为 Automatic；未设置仅构建 dev 的限制。免费计划页面显示 Basic 2 cores / 8 GB，没有本次部署必须升级的提示。

## 执行动作与结果

在表单中准备好目标后，明确说明部署成功会更新 `ink.radishx.com`，用户回复“确认，部署这个 dev 提交”。随后点击 Deploy to Production，未改构建参数、项目设置、计划或保护范围。

| 字段           | 实际值                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| 项目           | `laugh0608s-projects/radish-ink`                                                                               |
| 分支／提交     | `dev / a3c45e8f0be2c17d32b9731f7dc5d60bf56c447e`                                                               |
| 环境           | Production                                                                                                     |
| 部署详情       | [3UL6G122crJtg8zo6BD5qRxZhgWL](https://vercel.com/laugh0608s-projects/radish-ink/3UL6G122crJtg8zo6BD5qRxZhgWL) |
| 部署地址       | `radish-8fl4b0xog-laugh0608s-projects.vercel.app`                                                              |
| 域名           | 部署详情显示 `ink.radishx.com` 已分配                                                                          |
| 完成时间／耗时 | 2026-10-05 22:30:32，48 秒                                                                                     |
| 最终状态       | Ready                                                                                                          |

可见构建日志确认克隆 `dev / a3c45e8`，使用 Vercel CLI 62.1.0，检测到 `ENABLE_EXPERIMENTAL_COREPACK=1` 和 `pnpm@9.0.2`；按锁文件安装，执行 `pnpm build:web`，恢复上一部署的构建缓存。日志末尾明确显示 Build Completed 与 Deployment completed。Node 22.x 来自项目设置，本轮可见日志未输出 Node 精确补丁版；Electron 跳过下载变量未单独回读。

保留既有大 chunk、Browserslist 及 baseline-browser-mapping 数据陈旧提示，未降低门禁或升级依赖。免费计划实际完成本次部署，无需据此警告升级。手动部署成功不代替未来 Git 推送自动触发的行为验证。

## 公网检查

Chrome 已实际打开 `https://ink.radishx.com/`，显示品牌、默认文章、源码与预览、公式、表格、图片及复制入口。未编辑用户原有文章、登录公众号或操作公众号草稿。

用不携带 Cookie 的 curl 经本机既有网络代理请求以下地址，均为 HTTP 200，无 Vercel 登录重定向：

| 路径                       | Content-Type／字节                                    | 内容核对                                                                    |
| -------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`                        | `text/html; charset=utf-8`，3361 字节                 | 应用入口存在；与本地 dist 相比增加 Cloudflare challenge-platform 的脚本注入 |
| `/pwa/icon-192.png`        | `image/png`，3613 字节                                | 与仓库静态文件逐字节一致                                                    |
| `/images/writing.svg`      | `image/svg+xml`，1040 字节                            | 与仓库静态文件逐字节一致                                                    |
| `/images/mac-sign.svg`     | `image/svg+xml`，234 字节                             | 与仓库静态文件逐字节一致                                                    |
| `/libs/mathjax/tex-svg.js` | `application/javascript; charset=utf-8`，2108580 字节 | 与仓库静态文件逐字节一致                                                    |

下载的合成／公开资源保存在 `/private/tmp/radishink-public-*`，未纳入 Git。网页读取工具无法访问该域名，curl 首次被沙箱阻断，获准重跑成功；浏览器初次地址输入漏冒号导致无关地址 503，改用完整 HTTPS 地址后加载成功，这些不记为站点故障。

首页确有 Cloudflare 脚本注入，本轮未更改 Cloudflare 防护；匿名图片成功只证明当前测试网络可读取，不证明微信服务端或手机网络一定可达。真实公众号粘贴、图片转存、公式／表格清洗、保存重开及手机明暗显示仍未验证，继续使用 [验收步骤与样例](../deployment/wechat-acceptance.md)。

## 后续：项目配置对齐

用户随后要求消除黄色配置提示。在现有项目的 Build and Deployment 设置中启用 Build Command 与 Install Command 的 Override，分别保存为 `pnpm build:web` 与 `pnpm install --frozen-lockfile`，与仓库配置及当前 Production 部署一致；Output Directory 保持 `apps/web/dist`。

保存后回读表单并检查页面：两项命令保留正确值，Save 按钮禁用，黄色“Configuration Settings in the current Production deployment differ from your current Project Settings”警告框与 Production Overrides 展开项已消失。Framework Settings 顶部仍显示 `Overridden` 小标签，表示使用自定义配置，不再是上述配置差异警告。本次仅保存项目设置，未重新部署；线上源码仍为 `dev / a3c45e8`。

## 交接状态

- 部署问题本次未复现，目标 dev 部署已 Ready；用户此前未成功创建部署的原因没有足够日志，不归因于免费计划或代码。
- 没有修改远程 Git 设置、squash、tag / Release，也未创建新项目或改系统配置。
- 仓库文档同步实际项目、域名、部署与未验证项；记录随后纳入当日收尾的本地文档提交，未再次推送，因此未触发额外 dev 自动部署。部署源码仍为 `a3c45e8`。
- 未启动本地后台服务。保留用户原 Vercel 标签页及新开的站点标签页，便于继续人工验收。
