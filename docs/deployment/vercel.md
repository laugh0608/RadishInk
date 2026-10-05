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
- 核对 RadishInk 名称、PWA 与品牌素材；本地首轮已调整，实际部署仍须检查缓存更新。上游版本号不当作 RadishInk 发布号。
- 默认统计和上传端点已清理，内置图片由本站提供。部署后复查首屏请求、图片链接与自定义服务，详见 [Web 品牌与外部服务](../development/web-brand-and-services.md)。
- 网站已提供“关于与许可”和随构建生成的依赖声明清单；仍需完成清单中缺少独立许可原文条目的发布复核，并核对实际打包范围。
- 固定域名并说明浏览器本地草稿的迁移 / 备份；不承诺跨域名或跨设备自动同步。
- 确定 Vercel Git 自动部署与 Preview 的开启范围；代码推送可能触发部署，首次连接也属于独立外部动作。

## 暂停的发布工作流

上游 `docker-image.yml`、`release.yml` 移到 `.github/workflows-disabled/`，既不自动触发，也不提供手动发布入口。

恢复前需要确认镜像命名空间、仓库凭据、镜像 / 安装包品牌、版本、许可与发布验收；Compose 的未来 RadishInk 镜像名不代表镜像已经发布；桌面工作流里的 WeMD 名称不能直接作为 RadishInk 发布。暂停的文件只供追溯，不视为可直接运行的发布方案。

## 失败与回退

首次上线失败保留构建日志并修复，不跳过类型或测试门禁。已有站点回退应选择经过验收的部署，并考虑 PWA 缓存与本地数据兼容；不能用删除用户存储作为默认回退方案。
