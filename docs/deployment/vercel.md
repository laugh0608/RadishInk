# Vercel 与发布准备

本项目采用仓库根目录构建 Web 的方式。`vercel.json` 只声明构建配置，创建文件不等于已连接 Vercel 或已部署。

| 设置              | 值                               |
| ----------------- | -------------------------------- |
| Git 仓库          | `laugh0608/RadishInk`            |
| Root Directory    | 仓库根目录                       |
| Production Branch | `main`                           |
| Framework         | Vite                             |
| Node              | 22.x，根 `package.json` 同时声明 |
| Install Command   | `pnpm install --frozen-lockfile` |
| Build Command     | `pnpm build:web`                 |
| Output Directory  | `apps/web/dist`                  |
| 环境变量          | `ENABLE_EXPERIMENTAL_COREPACK=1` |

Corepack 按 `packageManager` 选择 pnpm 9.0.2；纯 Web 安装可同时设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。所有依赖仍按锁文件安装。首次部署通过日志确认实际 Node / pnpm 版本。[官方构建设置](https://vercel.com/docs/builds/configure-a-build)。

## 上线前

- 完成 Web 基线和实际公众号粘贴验收。
- 修改产品名称、PWA 名称、站点元信息和品牌素材；上游版本号不直接当作 RadishInk 发布号。
- 核对并清理继承的统计和默认外部服务。导入版本的 `apps/web/index.html` 含上游 Google Analytics，官方上传器默认访问 `api.wemd.app`；本轮治理不代表这些运行行为已修改。
- 将上游及实际依赖许可声明纳入网站分发产物；不把只有维护者可读的仓库文件当作网站许可入口。
- 固定域名并说明浏览器本地草稿的迁移 / 备份；不承诺跨域名或跨设备自动同步。
- 确定 Vercel Git 自动部署与 Preview 的开启范围；代码推送可能触发部署，首次连接也属于独立外部动作。

## 暂停的发布工作流

上游 `docker-image.yml`、`release.yml` 移到 `.github/workflows-disabled/`，既不自动触发，也不提供手动发布入口。

恢复前需要确认镜像命名空间、仓库凭据、镜像 / 安装包品牌、版本、许可与发布验收；Docker 配置里的上游镜像和桌面工作流里的 WeMD 名称不能直接作为 RadishInk 发布。暂停的文件只供追溯，不视为可直接运行的发布方案。

## 失败与回退

首次上线失败保留构建日志并修复，不跳过类型或测试门禁。已有站点回退应选择经过验收的部署，并考虑 PWA 缓存与本地数据兼容；不能用删除用户存储作为默认回退方案。
