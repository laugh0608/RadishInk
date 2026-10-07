# RadishInk · 萝卜墨笺

**专注写作，轻松排版。** 基于 [WeMD](https://github.com/tenngoxars/WeMD) 二次开发的 Markdown 写作与微信公众号排版工具。

当前提供浏览器编辑、主题预览、本地草稿、已有目录工作区读写、Markdown 单文件导入导出和公众号富文本复制。文件菜单与工具栏整理、文章图片目录 / ZIP、Docker 前后端与账号存储见 [工作区演进计划](docs/planning/writing-workspace-roadmap.md)，这些后续能力尚未实施。Web 已部署到 Vercel 供验收；实际部署、远程 CI、Ruleset 与后续进度见 [当前状态](docs/status/current.md)。

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

上述基线覆盖仓库规范、Web Lint、core / Web 测试和 Web 构建。桌面端、图片服务目录保留，但不属于当前 Web 发布基线。

## 协作与部署

- 日常开发使用 `dev`；稳定主线为 `main`，通过 PR 合入后回流 `dev`。
- [贡献指南](CONTRIBUTING.md) · [文档索引](docs/README.md) · [仓库治理](docs/governance/repository-governance.md)
- [Vercel 部署配置](docs/deployment/vercel.md) · [GitHub Rulesets 模板](.github/rulesets/README.md)

Vercel 从仓库根构建 `apps/web/dist`，当前站点为 [ink.radishx.com](https://ink.radishx.com)，实际部署提交与验证边界见 [部署说明](docs/deployment/vercel.md)。上游 Docker / 桌面发布工作流已暂停；Compose 已指向未来 RadishInk 镜像命名，需要显式填写实际发布的完整版本标签，目前不能据此认为镜像已发布。

浏览器模式的草稿保存在当前站点的浏览器本地；当前部署不提供账号或跨设备同步。现有代码默认关闭图床上传与 AI，应用代码不加载统计脚本；图床 / AI 将按新规划移除，尚未实施。当前请求与旧配置行为见 [Web 品牌与外部服务](docs/development/web-brand-and-services.md)。当前构建的依赖分发声明已复核，后续发布仍须按实际产物复核；真实公众号整体验收仍未完成。

## 来源与许可

本项目采用分范围许可：RadishInk 在许可切换后有权授权的原创新增内容采用 [RadishInk Source-Available License](LICENSE)，允许查看学习；软件修改、再分发、自行部署或作为商业产品提供等用途需另行书面授权。官方或获授权站点的正常写作、排版、文章发布（包括商业文章）及支持的排版输出使用不受该限制。

WeMD 导入基线为 `70835e141aa94c0296c78c0f6adf67f636475f38`，保留完整 Git 历史及 [MIT 原文](LICENSES/WeMD-MIT.txt)，上游版权为 `Copyright (c) 2025 WeMD Team`。切换前历史内容保留原有许可，第三方组件沿用各自许可；新条款不追溯收回已授予的权利，也不覆盖混合文件中的既有部分。

这是源码可见项目，不将自定义限制称为开源许可。详细切换基线、适用边界、贡献与分发要求见 [上游维护](docs/governance/upstream.md)。感谢 WeMD 及其依赖项目；当前声明覆盖不代表所有分发方式均已完成许可审计。
