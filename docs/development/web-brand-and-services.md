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

| 场景                | 行为                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| 新用户打开编辑器    | 不加载统计、广告或默认上传服务；内置字体、公式引擎、示例图由本站提供             |
| 默认图床            | `none`，不上传；粘贴、拖入或选图时明确提示先配置图床                             |
| 已配置对象存储      | 用户启用后直接上传到对应服务；连接测试可能写入并删除测试文件                     |
| 自定义上传接口      | 必须填写完整 HTTP / HTTPS 地址，显式启用；启用只检查地址格式，不代表远程连接成功 |
| AI                  | 新用户默认关闭；执行写作操作、测试连接、打开或刷新模型列表时按用户配置连接服务商 |
| 文章外链图片        | 预览仍会请求图片所在网站；不擅自改写已有文章或替换用户图片                       |
| 外部帮助 / 仓库链接 | 用户点击后导航；本地帮助、关于、许可无需访问上游站点                             |

上表描述应用代码行为。当前公网首页检查另发现 Cloudflare `challenge-platform` 脚本注入，见 [部署记录](../records/2026-10-05-vercel-dev-deployment.md)；不能据此把本地应用请求检查当作线上完整请求清单。

自定义上传接口沿用旧 `official` 类型和 `OfficialUploader` 类名以兼容存储；协议为 `POST <serverUrl>/upload`、multipart 文件字段 `file`，成功返回含完整 HTTP / HTTPS `url` 的 JSON。不存在隐式默认 `serverUrl`。不支持在服务地址里放用户名、密码、查询参数或锚点；服务须允许浏览器跨域。图床凭据与 AI Key 仍保存在当前浏览器，不宣称加密保管。

Mac Bar 装饰图改为随站点分发的 `images/mac-sign.svg`，复制时解析为当前站点绝对 URL；默认文章和主题预览使用本地 `images/writing.svg`。公众号不能抓取本机或受保护的 Preview 地址，正式验收须使用公众号可访问的域名，并检查转存和保存后的结果。

复制服务通过 Vite 的 `?inline` 导入 KaTeX CSS，保留样式字符串并由构建解析字体地址，避免原始 CSS 的相对路径误指向站点根目录。字体加载须在生产构建的真实浏览器中验证；当前 jsdom 测试环境默认不处理外部 CSS，不能据此证明字体资源可用。

## 旧配置与草稿

- 保留 IndexedDB、localStorage、主题、历史、AI 等既有键和 schema；不迁移或删除草稿。
- 旧 `official` 配置缺少显式 `serverUrl` 时按关闭上传处理。读取不重写原值，设置中显示“不上传”；选择并启用自己的服务后才保存新的选择。
- 已有显式自定义地址和七牛云 / OSS / COS / S3 配置继续读取；关闭上传保留全部图床配置。
- 兼容只有 `imageHostConfig` 或只有 `imageHostConfigs` 的记录。打开设置不自动落盘，明确修改后同步两个既有键；写入失败恢复旧值并显示错误。
- 配置损坏时停止上传并显示错误，保留原始字符串，不改用任何默认远程服务。
- 不改写旧文章中的 WeMD 文案或图片地址。换域名前先在旧站点逐篇复制并保存 Markdown 源文；使用目录工作区时另行备份原目录。确认副本可读后再迁移，不能将尚在规划的单文件导入导出当成现有备份入口，也不承诺这些操作会迁移全部历史与配置。

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
