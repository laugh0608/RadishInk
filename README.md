# RadishInk · 萝卜墨笺

**专注写作，轻松排版。** 基于 [WeMD](https://github.com/tenngoxars/WeMD) 二次开发的 Markdown 写作与微信公众号排版工具。

第一阶段提供浏览器编辑、主题预览、本地草稿、Markdown 导入导出和公众号富文本复制，目标部署到 Vercel。当前已完成本地初始化与首轮 Web 品牌、默认外部请求整理；远程 CI、Ruleset 与生产部署的实际进度见 [当前状态](docs/status/current.md)。

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

Vercel 从仓库根构建 `apps/web/dist`；本项目暂未部署。上游 Docker / 桌面发布工作流已暂停；Compose 已指向未来 RadishInk 镜像命名，需要显式填写实际发布的完整版本标签，目前不能据此认为镜像已发布。

草稿保存在当前站点的浏览器本地，部署不提供账号或跨设备同步。新用户默认关闭图床上传与 AI，不加载统计脚本；使用自己的图床或 AI 前，在设置中确认配置与数据去向。详见 [Web 品牌与外部服务](docs/development/web-brand-and-services.md)。上线前仍需完成第三方分发许可复核与真实公众号粘贴验收。

## 来源与许可

导入基线为 WeMD 提交 `70835e141aa94c0296c78c0f6adf67f636475f38`，保留完整 Git 历史和原 [MIT 许可证](LICENSE)，其中上游版权为 `Copyright (c) 2025 WeMD Team`。

感谢 WeMD 及其依赖项目。详细来源、许可边界和同步流程见 [上游维护](docs/governance/upstream.md)。本轮不改变上游许可，也不宣称完成所有依赖的许可审计。
