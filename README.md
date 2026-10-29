# RadishInk · 萝卜墨笺

**专注写作，轻松排版。** 基于 [WeMD](https://github.com/tenngoxars/WeMD) 二次开发的 Markdown 写作与微信公众号排版工具。

当前提供 Markdown 编辑、主题预览、公众号富文本复制，以及浏览器 / 本地文件夹两种文章工作区。支持 Markdown 单文件进出、正文与本地图片组成的文章包、ZIP 下载与回导、旧数据备份恢复和 PWA 保存后安全更新；Web 图床上传与 AI 功能已移除。`v26.10.2-dev` 为开发预发布，手机真机与真实公众号整体验收按用户安排延后，不代表完整发布验收通过。版本范围见 [发布记录](docs/records/2026-10-25-v26.10.2-dev.md)，远程状态及后续开发见 [当前状态](docs/status/current.md)。

## 开发

项目通过 mise 选择 Node 22 和 pnpm 9.0.2，不改变全局 Node 版本：

```bash
mise trust
mise install node@22 pnpm@9.0.2
ELECTRON_SKIP_BINARY_DOWNLOAD=1 mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev:web --host 127.0.0.1 --port 5173 --strictPort
```

访问 `http://127.0.0.1:5173`。安装示例跳过暂不需要的 Electron 二进制；其他说明见 [本地开发](docs/development/local-development.md)。

```bash
mise exec -- pnpm validate:web
```

上述基线覆盖仓库规范、Web Lint、core / Web 测试和 Web 构建。服务端通过 `mise exec -- pnpm validate:server` 单独检查；桌面端未纳入当前发布基线。

P3-3 服务器 Web 工作区已在本地实现并通过浏览器验证，提供本地账号登录、文章 / 图片 / ZIP、冲突与退出保护；公开站点仍使用静态模式。运行时配置及合成验收见 [服务器 Web 工作区](docs/development/server-web.md)，P3-4 OIDC 已完成本地合成验证，配置、准入与升级见 [OIDC 操作说明](docs/development/server-oidc.md)；真实 Radish 联调与 Compose 尚待完成。

## 协作与部署

- 日常开发使用 `dev`；稳定主线为 `main`，通过 PR 合入后回流 `dev`。
- [贡献指南](CONTRIBUTING.md) · [文档索引](docs/README.md) · [仓库治理](docs/governance/repository-governance.md)
- [Vercel 部署配置](docs/deployment/vercel.md) · [GitHub Rulesets 模板](.github/rulesets/README.md)

Vercel 从仓库根构建 `apps/web/dist`，当前站点为 [ink.radishx.com](https://ink.radishx.com)，实际部署提交与验证边界见 [部署说明](docs/deployment/vercel.md)。上游 Docker / 桌面发布工作流已暂停；Compose 已提供本地构建的前后端服务与持久卷，初始化和同源配置见 [Compose 说明](docs/deployment/compose.md)；本地构建不代表镜像已发布；[离线备份恢复](docs/deployment/backup-restore.md) 与 [显式共享 / 归属转换](docs/deployment/shared-workspace.md) 已提供本地实现，完整部署矩阵仍待验收。

浏览器模式的草稿保存在当前站点的浏览器本地；当前部署不提供账号或跨设备同步。当前 Web 代码不再提供图床上传与 AI，旧配置保留但不启用；应用代码不加载统计脚本。当前请求与旧配置行为见 [Web 品牌与外部服务](docs/development/web-brand-and-services.md)。当前构建的依赖分发声明已复核，后续发布仍须按实际产物复核；真实公众号整体验收仍未完成。

## 来源与许可

本项目采用分范围许可：RadishInk 在许可切换后有权授权的原创新增内容采用 [RadishInk Source-Available License](LICENSE)，允许查看学习；软件修改、再分发、自行部署或作为商业产品提供等用途需另行书面授权。官方或获授权站点的正常写作、排版、文章发布（包括商业文章）及支持的排版输出使用不受该限制。

WeMD 导入基线为 `70835e141aa94c0296c78c0f6adf67f636475f38`，保留完整 Git 历史及 [MIT 原文](LICENSES/WeMD-MIT.txt)，上游版权为 `Copyright (c) 2025 WeMD Team`。切换前历史内容保留原有许可，第三方组件沿用各自许可；新条款不追溯收回已授予的权利，也不覆盖混合文件中的既有部分。

这是源码可见项目，不将自定义限制称为开源许可。详细切换基线、适用边界、贡献与分发要求见 [上游维护](docs/governance/upstream.md)。感谢 WeMD 及其依赖项目；当前声明覆盖不代表所有分发方式均已完成许可审计。
