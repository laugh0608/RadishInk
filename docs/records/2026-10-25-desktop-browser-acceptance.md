# Safari / Firefox 桌面验收与图表预览修复

日期：2026-10-25。范围：按用户要求先提交工作区，再推进下一步桌面验收；手机真机与真实公众号明确留待后续。

## 提交与环境

前轮 PWA 的 33 个文件已精确提交为 `8dadd46`（`feat(pwa): 实现安全更新与文章保存保护`），提交钩子的 Lint / 格式检查通过；随后工作区与暂存区均为空。本轮继续使用 `dev`，未创建分支、改写历史、推送或发布。`origin/dev` 为本地跟踪引用，本轮未 fetch。

- macOS `27.0.1`（`26A434`），Safari `27.0.1`，Firefox `158.0.1`。
- 初始生产构建为 `8dadd46`，本地 `vite preview` 监听 `127.0.0.1:4184`；无 HMR。修复后重新构建，通过产品“保存并更新”切换版本，未清空存储或注销 Worker。
- Safari 使用本轮新建的测试标签页；保留原起始页。Firefox 从 Mozilla 官方下载入口取得，应用和专用 profile 仅位于 `/private/tmp/radishink-cross-browser/`，未安装到全局 Applications。用户确认条款并完成首次设置，随后明确要求保留全局诊断设置；测试只使用合成内容，未登录账号。
- Playwright 专用 Chromium 会话用于读取图表实际计算样式和安全边界回归，不替代 Safari / Firefox 原生操作证据。

## 原生浏览器结果

合成文章含中文、Emoji、粗体、表格、公式、Mermaid、未知 frontmatter `customFlag` 与末尾标记；原图为本地生成的 320 × 180 双色 PNG。未使用真实文章或个人图片。

| 场景           | Safari                                                        | Firefox                                      |
| -------------- | ------------------------------------------------------------- | -------------------------------------------- |
| 存储入口       | 浏览器存储可用；本地文件夹入口明确标为不支持                  | 同左                                         |
| 文件输入       | 原生选择器导入 Markdown 为新文章，选择 PNG 后插入相对资源引用 | 原生选择器导入 Safari 导出的文章 ZIP         |
| 预览           | 中文、表格、公式、图表与本地图片显示                          | 同左                                         |
| 最新内容导出   | 追加 `SAFARI-LATEST-UNSAVED` 后立即导出 ZIP                   | 追加 `FIREFOX-LATEST-UNSAVED` 后立即导出 ZIP |
| 真实下载校验   | 下载包含最新正文、未知 frontmatter、原始 PNG 字节             | 同左，并包含 Safari 和 Firefox 两个末尾标记  |
| ZIP 回导       | 导入为新文章，图片与正文恢复                                  | 导入自己导出的 ZIP 为新文章，图片与正文恢复  |
| 刷新与明暗切换 | 回导文章和图片保留，明暗模式正常                              | 同左                                         |
| 本地图片复制   | 明确停止并提示 ZIP 保存原图、公众号手工插图                   | 同左                                         |
| 安全更新       | 新版提示 → 保存并更新 → 正文、图片与暗色状态保留              | 同左                                         |

使用 Python `zipfile` 对实际下载文件核对：包内文章目录下有 `index.md` 和 PNG，最新标记及未知 frontmatter 存在；解包 PNG 与输入文件逐字节相同。Safari → Firefox 的跨浏览器迁入通过；未声称额外完成 Firefox → Safari 往返。

Safari 无本地图片时，公众号复制显示成功及公式保真处理提示；这只是产品调用结果，本轮未读取 Safari / Firefox 剪贴板 HTML，也未粘贴到公众号后台。含本地图片的拦截结果不能当作公众号转存成功。

## 发现与修复

暗色文章段落 CSS 将 Mermaid HTML 标签中的 `p` 文字改为浅灰；图表画布透明，黑色箭头落到深色背景上，两者均降低可读性。该问题在 Safari、Firefox 及 Chromium 中复现，属于公共预览样式问题。

新增 `mermaidPreview.css`，由文章预览及主题预览 iframe 共用：SVG 使用白色画布，与现有公众号图表 PNG 的白底一致；标签段落继承图表自身颜色，并消除文章段落间距与缩进的影响。作用域限定在 `#wemd .mermaid svg`，不修改文章内容、图表配置、存储 schema、依赖或复制服务。

修复后在 Safari / Firefox 明暗模式目视确认文字、箭头与图片。Chromium 读取实际计算样式：明暗模式下标签均为 `rgb(51, 51, 51)`，画布为白色，箭头为 `rgb(11, 11, 11)`；主题预览 iframe 的明暗模式结果一致。显式 `init` 的文字 `#123456`、箭头 `#654321` 与节点填充 `#ffeecc` 保留。

同时验证表格和公式继续渲染；合成原生 HTML 的事件属性、危险链接与 iframe 不进入活动预览，临时内存探针未执行。刷新后原始源码仍保留。计算样式脚本未观察到页面脚本异常；未将此结论扩大为 Safari / Firefox 控制台全面审计。

## 验证与证据

- `mise exec -- pnpm build:web`：初始生产构建通过。
- `mise exec -- pnpm validate:web`：修复后通过；治理 53 项、core 64 项、Web 748 项；Lint 0 错误、12 条既有警告。生产构建通过，既有大 chunk 警告保留。
- 文档收尾执行 `mise exec -- pnpm check:repo` 与 `git diff --check`，均通过；共 8 个本轮文件，暂存区为空。
- 本轮未改变依赖或导出链路，依赖分发审计沿用 [PWA 记录](2026-10-25-pwa-safe-update.md) 的实际证据。

本地临时证据不提交到 Git：

- `/private/tmp/radishink-desktop-validation.log`：完整基线。
- `/private/tmp/radishink-cross-browser/desktop-acceptance.md`、`test-image.png`、`safari-roundtrip.zip`、`firefox-roundtrip.zip`：合成输入与实际下载副本。
- 同目录的 `mermaid-before.log`、`mermaid-after.log`、`mermaid-custom.log` 及验证脚本：修复前后计算样式、显式配置与安全边界结果。
- `output/playwright/mermaid-dark-before.png`、`mermaid-dark-after.png`：辅助截图。原生 Safari / Firefox 通过桌面截图和可访问性状态目视复核；这些证据来源彼此区分。

复现时重新生成合成文章和双色 PNG，在固定生产构建中分别导入、编辑立即导出、解包比对、回导刷新并切换明暗模式；图表配置及色值见上文。临时文件可能由系统清理，不能作为长期唯一复现入口。

## 清理与交付边界

本轮预览服务 PID `86025` 已停止，`4184` 已无监听；Playwright `radishink-cross-check` 会话与独立 Firefox 已退出，Safari 仅关闭本轮测试标签页。Firefox 退出时有子进程终止警告；预览服务退出码 143 来自主动停止，不是构建或产品失败。临时浏览器、profile、合成数据和下载副本保留用于追溯，未清理用户浏览器存储或更改全局设置。

PWA 已本地提交；用户随后要求提交剩余工作区更改，本轮图表修复与文档随本次提交纳入本地历史。手机真机、真实公众号粘贴 / 保存重开 / 手工插图及线上环境仍未验证。P3 / P4、推送、合入、部署、tag 和 Release 均未开展；下一步以 [当前状态](../status/current.md) 为准。
