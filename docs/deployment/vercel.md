# Vercel 与发布准备

本项目采用仓库根目录构建 Web 的方式。`vercel.json` 只声明构建配置，创建文件不等于已连接 Vercel 或已部署。

| 设置              | 值                                                |
| ----------------- | ------------------------------------------------- |
| Git 仓库          | `laugh0608/RadishInk`                             |
| Root Directory    | 仓库根目录                                        |
| Production Branch | 本轮独立验收项目建议 `dev`；未来正式项目用 `main` |
| Framework         | Vite                                              |
| Node              | 22.x，根 `package.json` 同时声明                  |
| Install Command   | `pnpm install --frozen-lockfile`                  |
| Build Command     | `pnpm build:web`                                  |
| Output Directory  | `apps/web/dist`                                   |
| 环境变量          | `ENABLE_EXPERIMENTAL_COREPACK=1`                  |

Corepack 按 `packageManager` 选择 pnpm 9.0.2；纯 Web 安装可同时设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。所有依赖仍按锁文件安装。首次部署通过日志确认实际 Node / pnpm 版本。[官方构建设置](https://vercel.com/docs/builds/configure-a-build)。

## 首次连接前的确认单

以下信息必须明确后，再确认首次连接和部署；当前配置文件不是外部操作授权。

| 项目     | 待确认内容                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------- |
| 归属     | Vercel 账号／团队 slug；GitHub App 只需访问本仓库                                                   |
| 项目     | 新建或已有项目、准确名称；已有项目先核对用途，避免覆盖                                              |
| 首次部署 | 分支和完整提交 SHA；本地未提交文件不会随 Git 导入部署                                               |
| 访问域名 | 实际分配的 `vercel.app` 验收域名；本轮不绑定正式域名                                                |
| 自动部署 | 本轮建议 Production Branch 为 `dev`，其他分支跳过构建；由用户在验收项目配置                         |
| 匿名访问 | 确认哪些域名允许匿名访问，以支持公众号请求本站图片                                                  |
| 环境变量 | `ENABLE_EXPERIMENTAL_COREPACK=1`；纯 Web 使用 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`，覆盖实际使用的环境 |

Vercel 的 Production 是平台环境名称，使用默认域名做验收不表示产品正式上线。连接 Git 后推送可能自动部署；分支范围可用 [`git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration) 控制，配置应在首次连接前按确认范围落地。当前 `vercel.json` 未限制自动部署分支，不能默认理解成“只有 main”。

部署保护可能要求图片请求也先认证；已登录浏览器看到图片不足以证明公众号能读取。应选择明确允许匿名访问的验收 URL，逐项检查实际图片地址，不能仅靠页面分享链接。参见 [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)。保护范围变更随部署方案一并确认，不擅自关闭其他项目的保护。

首次远程验收先检查构建日志、静态资源和匿名访问，再按 [公众号验收步骤](wechat-acceptance.md) 执行。首次连接和部署、仓库级关闭 squash 是不同外部动作，分别确认；不重复排查已经验收的 Actions 与 Ruleset。

## 本轮由用户部署 dev

用户选择自行连接、部署并回报域名。本轮建议新建独立验收项目（例如 `radishink-dev`），使用默认 `vercel.app` 项目域名；账号／团队与项目名由用户在创建时选择。本仓库不改 GitHub 默认分支，不将远程部署记为已执行。

1. 在 Vercel 的 **Add New → Project** 导入现有 `laugh0608/RadishInk` 仓库。Root Directory 保持仓库根目录，构建参数使用上表；设置 Node 22.x，并添加 `ENABLE_EXPERIMENTAL_COREPACK=1`、`ELECTRON_SKIP_BINARY_DOWNLOAD=1`，覆盖 Production 与 Preview。
2. 如果导入页提供分支选择，选择 `dev`。若只支持默认 `main`，首次导入可能先构建 `main`；创建项目后到 **Settings → Environments → Production → Branch Tracking** 改为 `dev` 并保存，不能把初始 main 构建当作最终验收版本。[官方分支设置](https://vercel.com/docs/git)。
3. 建议在该项目的 **Settings → Build and Deployment → Ignored Build Step** 选择自定义命令 `test "$VERCEL_GIT_COMMIT_REF" != "dev"`，只构建 dev。Vercel 在此处约定退出码 0 跳过、1 继续；它仅选择部署分支，不替代 CI，也不放宽测试失败门禁。不要把命令填入 Build Command。该设置作用于此项目，不影响未来 main 正式项目；其他分支仍可能出现被取消的部署记录。[官方说明](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel)。
4. 在 **Deployments → Create Deployment** 选择 `dev`（可填 `https://github.com/laugh0608/RadishInk/tree/dev`）创建部署；确认详情中的分支及提交对应本轮推送，日志实际使用 Node 22 / pnpm 9.0.2，最终状态为 Ready。
5. 在 Deployment Protection 使用 **Standard Protection**，然后从项目的 Production 默认域名验收；不要使用需要登录的单次部署地址。无痕窗口检查首页、`/pwa/icon-192.png` 与 `/images/writing.svg` 均可访问；若仍需登录，先核对实际域名和保护范围，不把绕过凭据加入图片链接。
6. 回报实际域名、项目归属／名称和部署提交；接着进行公网浏览器及真实公众号验收。每次后续推送 dev 都可能更新验收地址，正式项目日后另行安排。

## 上线前

- 完成 Web 基线和实际公众号粘贴验收。
- 核对 RadishInk 名称、PWA 与品牌素材；本地首轮已调整，实际部署仍须检查缓存更新。上游版本号不当作 RadishInk 发布号。
- 默认统计和上传端点已清理，内置图片由本站提供。部署后复查首屏请求、图片链接与自定义服务，详见 [Web 品牌与外部服务](../development/web-brand-and-services.md)。
- 网站已提供“关于与许可”和随构建生成的依赖声明清单；原 9 项待办已逐项复核，见 [复核记录](../records/2026-10-05-web-license-review.md)。正式部署按当前构建重新核对声明和实际分发范围，生成器遇到新的缺失文本或摘要变化会失败。
- 固定域名并说明浏览器本地草稿的迁移 / 备份；不承诺跨域名或跨设备自动同步。
- 确定 Vercel Git 自动部署与 Preview 的开启范围；代码推送可能触发部署，首次连接也属于独立外部动作。

## 暂停的发布工作流

上游 `docker-image.yml`、`release.yml` 移到 `.github/workflows-disabled/`，既不自动触发，也不提供手动发布入口。

恢复前需要确认镜像命名空间、仓库凭据、镜像 / 安装包品牌、版本、许可与发布验收；Compose 的未来 RadishInk 镜像名不代表镜像已经发布；桌面工作流里的 WeMD 名称不能直接作为 RadishInk 发布。暂停的文件只供追溯，不视为可直接运行的发布方案。

## 失败与回退

首次上线失败保留构建日志并修复，不跳过类型或测试门禁。已有站点回退应选择经过验收的部署，并考虑 PWA 缓存与本地数据兼容；不能用删除用户存储作为默认回退方案。
