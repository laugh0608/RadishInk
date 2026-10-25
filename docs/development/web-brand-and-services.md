# Web 品牌与外部服务

## 品牌入口

Web 使用 `RadishInk · 萝卜墨笺`，沿用当前界面布局。标题、欢迎页、页脚、PWA、默认文章与主题示例使用本项目名称；反馈和仓库入口指向 RadishInk，使用帮助和许可页面随静态站点提供。

当前部署域名已确定，见 [部署说明](../deployment/vercel.md)；`apps/web/index.html` 仍未设置 canonical、`og:url` 或 `og:image`，尚未补充本站分享图，不再引用上游站点图片。内部包名 `@wemd/*`、CSS 容器 `#wemd`、存储键及 core 的兼容标识保留。根 `LICENSE` 与上游 MIT 的适用范围按 [许可边界](../governance/upstream.md#许可边界) 区分，页脚的“关于与许可”分别提供 RadishInk 源码可见许可、WeMD 原始 MIT 与导入版本说明；不把上游包版本 1.5.3 显示为 RadishInk 发布号。

侧栏的关于 / 帮助按钮与语法速查的完整帮助入口共用编辑器内信息弹窗；旧 `about.html`、`help.html` 与 `help.html#syntax` 在原标签页跳转回编辑器并打开对应内容。正文只在 React 组件中维护，范围、兼容行为与验收见 [信息弹窗重构](../planning/information-dialogs.md)。

品牌图标采用“萝卜叶与笔尖”的 SVG，源文件为 `apps/web/public/favicon-dark.svg` 与 `favicon-light.svg`，不依赖第三方远程图片。PNG 使用本地 SVG 渲染：

```bash
# 保持本地 Web 服务运行；以下命令使用独立 Playwright CLI 会话
playwright-cli --session radishink-assets open http://127.0.0.1:5173
playwright-cli --session radishink-assets run-code --filename scripts/render-web-brand-assets.js
playwright-cli --session radishink-assets close
```

生成 favicon 64×64、PWA 192×192 / 512×512，以及背景不透明、主体位于安全区域的 maskable 512×512。修改 SVG 后重新生成 PNG 并检查浅色、深色与小尺寸显示。浏览器截图证据放在忽略的 `output/playwright/`。

## 默认请求与显式请求

以下为当前 P1 / P2 Web 实现行为；线上状态需以实际部署版本为准。界面与资源验证见 [P1 记录](../records/2026-10-14-editor-interface-p1.md)、[图片记录](../records/2026-10-19-article-images.md) 和 [ZIP 记录](../records/2026-10-19-article-zip.md)。

| 场景                | 行为                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| 新用户打开编辑器    | 不加载统计、广告或默认上传服务；内置字体、公式引擎、示例图由本站提供                                  |
| 图床与 AI           | 已移除 Web 入口、事件监听、挂载及专用请求实现；旧启用配置不会恢复上传、模型列表、连通性测试或生成请求 |
| 图片文件粘贴 / 选择 | 在当前浏览器或本地目录文章包中保存原图，成功后插入相对资源引用；不上传外部服务。拖图尚未开放          |
| 图片链接            | 工具栏可插入 Markdown 图片链接；外链图片不会自动下载为本地资源                                        |
| 文章外链图片        | 预览仍会请求图片所在网站；不改写已有文章或替换用户图片                                                |
| 外部帮助 / 仓库链接 | 用户点击后导航；本地帮助、关于、许可无需访问上游站点                                                  |

上表描述应用代码行为。当前公网首页检查另发现 Cloudflare `challenge-platform` 脚本注入，见 [部署记录](../records/2026-10-05-vercel-dev-deployment.md)；不能据此把本地应用请求检查当作线上完整请求清单。

Mac Bar 装饰图改为随站点分发的 `images/mac-sign.svg`，复制时解析为当前站点绝对 URL；默认文章和主题预览使用本地 `images/writing.svg`。公众号不能抓取本机或受保护的 Preview 地址，正式验收须使用公众号可访问的域名，并检查转存和保存后的结果。

复制服务通过 Vite 的 `?inline` 导入 KaTeX CSS，保留样式字符串并由构建解析字体地址，避免原始 CSS 的相对路径误指向站点根目录。字体加载须在生产构建的真实浏览器中验证；当前 jsdom 测试环境默认不处理外部 CSS，不能据此证明字体资源可用。

## 旧配置与草稿

- 保留已有存储键、主题与配置；浏览器文章升级到 `wemd-history` v3，v2 需先下载备份并确认，不静默清库。目录旧单文件原位保留，迁移细节见 [存储契约](article-storage-contract.md)。
- `imageHostConfig`、`imageHostConfigs` 和 `wemd-ai-config` 原值保留，包括旧启用状态及损坏字符串；当前 Web 不再读取它们来启用功能，也不重写、删除或发送其中配置。
- 旧图床凭据与 AI Key 仍可能留在当前浏览器，本地存储不等于加密保管。此轮停用没有执行凭据迁移或清理。
- 不改写旧文章中的 WeMD 文案或外链图片地址。换域名前先在旧站点逐篇导出文章 ZIP；使用目录工作区时另行备份完整原目录。Markdown 单文件不携带图片，文章 ZIP 也不是全部历史与配置的完整站点备份；确认副本可读后再迁移。

## 分发声明

`AboutContent.tsx` 在关于弹窗中提供来源与许可入口，`about.html` 仅作为旧链接兼容入口。`scripts/generate-web-notices.mjs` 在 Web build 开始时，从当前安装的 Web / core 生产依赖及已安装 peer 读取许可文件，生成 `public/licenses/third-party-notices.txt`，并分别将根 RadishInk 许可及 `LICENSES/WeMD-MIT.txt` 上游原文复制到站点；生成过程不联网，不修改依赖或锁文件。

该清单是依赖闭包的声明汇总，并不意味着每个包都进入最终浏览器产物，也不等于完整许可审计。扫描支持 `MIT-LICENSE.txt` 等文件名；npm 包未附独立文件时，使用按版本复核的 README 节选、上游补充文本，或明确标记的声明组合文本。对于只声明 MIT 的条目，保留已发布作者 / 版权信息，附 SPDX 对应标准条款，不将组合结果称为上游原始 LICENSE 文件。

来源 URL、补录方式、补充文本摘要及相关已发布文件摘要保存在 `licenses/package-sources/sources.json`。生成器离线验证摘要；文本缺失、空白或摘要变化时失败，并保留已有声明文件，不生成假成功结果。首次提供来源时仍需人工核对，不能靠填写一个摘要就视为许可已确认。

使用 `mise exec -- node scripts/audit-web-bundle.mjs` 导出实际打包范围。它重新生成声明并运行现有 Vite 生产配置，在最终写入阶段记录模块归属和 JS chunk 摘要，核对磁盘产物后输出忽略文件 `.tmp/web-bundle-audit.json`。此命令覆盖应用 Rollup 模块，不能替代 public 资产和其他独立生成文件的来源检查，也不替代 TypeScript / 测试检查。

原 9 项待办的逐项结果见 [依赖分发复核记录](../records/2026-10-05-web-license-review.md)。发布前按当时的依赖、构建产物和资产重新核对；当前未打包的包不能获得未来分发的永久豁免。

随站点补齐的文本来源：

- [Space Grotesk OFL](https://raw.githubusercontent.com/floriankarsten/space-grotesk/master/OFL.txt)
- [JetBrains Mono OFL](https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt)
- [MathJax 3.2.2 Apache License](https://raw.githubusercontent.com/mathjax/MathJax/3.2.2/LICENSE)

许可正文仅规范化 UTF-8 / LF、行尾空白和末尾换行，保留版权、来源及条款。新增默认服务、品牌资产或存储迁移时同步本文和对应行为测试；不要全局替换兼容标识。
