# RadishInk Web

`apps/web` 是 RadishInk 的 React + Vite 前端应用，承载 Markdown 编辑、预览、复制到公众号、主题管理、图床设置、历史记录和文件系统模式等核心体验。

## 目录结构

```
apps/web/src/
├── components/       # React 组件
├── store/            # Zustand 状态
├── storage/          # IndexedDB 与文件系统存储适配
├── hooks/            # 可复用 Hook
├── services/         # 复制、上传、渲染兼容等业务服务
├── utils/            # 通用工具
├── lib/              # 平台适配
├── config/           # 静态配置
├── styles/           # 全局样式
├── bootstrap/        # 启动初始化逻辑
├── types/            # 全局类型
└── __tests__/        # 单元测试与集成测试
```

## 常用命令

推荐从仓库根目录运行：

```bash
pnpm dev:web
pnpm --filter @wemd/web lint
pnpm --filter @wemd/web test
pnpm --filter @wemd/web build
```

## 开发注意

- 复制到公众号是高风险链路，涉及 `services/wechatCopyService.ts`、`wechatCopyNormalizer.ts`、`wechatMermaidRenderer.ts` 和公式兼容逻辑，改动时需要补充测试。
- 文件系统副作用只应在 `App.tsx` 单点启用，避免多个 hook 实例重复监听或自动保存。
- UI 改动应复用现有组件、样式变量和交互模式，不要把服务逻辑写进组件。
- PWA 由 `vite.config.ts` 的 `vite-plugin-pwa` 配置（manifest、Workbox 预缓存、autoUpdate 更新策略），仅在 `build` 产物中生效（`dev` 模式无 Service Worker）。改动 PWA 配置后必须重新 `pnpm --filter @wemd/web build` 并检查 `dist/` 下 `sw.js`、`manifest.webmanifest`、`registerSW.js` 三个产物；部署侧的 `nginx.conf` 已对 `sw.js`/`registerSW.js` 放行 `no-cache`，新部署环境需保持，否则 Service Worker 无法更新。PWA 图标真源为 `public/favicon-*.{svg,png}` 的居中变体，改图标时需同步 `public/pwa/*.png`。

品牌、默认外部服务、存储兼容和资源生成见 [Web 品牌与外部服务](../../docs/development/web-brand-and-services.md)。
