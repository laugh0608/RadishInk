# 公众号行高警告：官方检测器对照

日期：2026-10-06。用户在本地开发服务重测后确认，原来的段落和警告仍然存在，并授权对比复制结果与官方检测器，同时整理官方维护渠道。本轮只做诊断及文档维护，没有继续修改排版、剪贴板传输或检测豁免属性。

## 结论与边界

同一次“复制到公众号”产生的导出 DOM 和原生剪贴板 HTML，在当前公开官方检测器上均无违规；在行高误报修复前的官方版本上均触发行高警告。原生剪贴板样本的旧版结果覆盖用户截图的第 3、10、13、14、41、45、49 段，且正文内容对应一致；另报第 57、59 段，不能宣称与线上结果完全一致。

这强烈支持旧版检测算法误报混合行内格式的解释，而不是缺少 WeMD 修复或仅由 Vercel 缓存造成。用户随后提供公众号粘贴后的正文 HTML，新旧两版均通过，行高修正也保留；详见下方补充对照。仍没有公众号线上实际检测器版本和触发时点证据，不能把本次对照写成线上根因已完全确认、公众号警告已消失或保存重开已通过。

## 上游与官方版本

- 用户提供的 [WeMD `26e6fe4`](https://github.com/tenngoxars/WeMD/commit/26e6fe4a8f9c42c8be98ab770b1f98ad2d8a919c) 是导入基线 `70835e1` 的直接父提交，已在本项目祖先链中。其行为是将带显式字号的非根节点无单位行高转成像素；本项目 `a7f1fa2` 在这段逻辑上扩展，并非漏合该修复。
- 当前官方检测器：[`1340988eccbb63181a56141a5c2171d55cd42521`](https://github.com/wechatjs/verify-article-structure-spec/commit/1340988eccbb63181a56141a5c2171d55cd42521)，package `0.2.17`。
- 修复前官方检测器：[`fa69e37341c86bfec4c8c533845910511e534c0c`](https://github.com/wechatjs/verify-article-structure-spec/commit/fa69e37341c86bfec4c8c533845910511e534c0c)，package `0.2.16`。
- 关键官方修复：[`29b4fd8`](https://github.com/wechatjs/verify-article-structure-spec/commit/29b4fd8f8e473aa632813f05cae901013a4f7295)，2026-09-29。旧逻辑把 `Range.getClientRects()` 的片段数量当行数；新逻辑按垂直区间重叠归并同行片段，覆盖加粗、span、上下标和混合字号等情况。

外部仓库及长期使用方法见 [公众号编辑器参考渠道](../development/wechat-editor-references.md)。

## 环境与取样

应用为 `a7f1fa2` 的复制实现，工作区同时保留尚未提交的版本展示及文档修改。使用已经构建的生产预览 `http://127.0.0.1:4173/`；应用入口为 `assets/index-BxMgd3AX.js`。独立浏览器配置加载默认欢迎文章、默认主题，不读取用户已有草稿。

浏览器与检测运行环境：macOS、Chrome `154.0.8037.98`、Playwright CLI `0.1.22`、项目 mise 的 Node 22 / pnpm `9.0.2`。官方工具依赖按自身锁文件安装到 `/tmp/radishink-wechat-checker-1340988/cli`；跳过 Puppeteer 自带 Chromium 下载，使用现有 Chrome。旧版目录为 `/tmp/radishink-wechat-checker-fa69e37/cli`；两版锁文件逐字一致，旧版复用同一份 `node_modules`，未改官方引擎代码。项目 manifest 和锁文件均未新增这些依赖。

在合成文章上点击实际“复制到公众号”：copy 事件中只读克隆选区，得到序列化前的导出 DOM；同一次浏览器调用内回读 `navigator.clipboard.read()` 的 `text/html`，得到原生富文本载荷。只在本轮主动复制后读取剪贴板，不采集用户之前的剪贴板内容。调用间读取曾遇到剪贴板不再包含 `text/html`，该次采样失败；最终采样在同一调用内完整回读后固定到页面临时变量，再保存到忽略目录。

| 样本                         | UTF-8 字节数 | SHA-256                                                            |
| ---------------------------- | ------------ | ------------------------------------------------------------------ |
| 导出 DOM，`source.html`      | 41,772       | `8e3a50336bdc9222da89e01317e5d0c9a79e38681bd0ef0fc2d2ed126c05ea0e` |
| 原生剪贴板，`clipboard.html` | 72,332       | `2d7e0296fa5e41b71a35e1c5bae880aa127c7e9363257e6ecf7102818d96c41d` |

两份 HTML 不同，不能以导出 DOM 代替剪贴板证据；本轮证明它们在新版检测器中均通过，不据此断言微信粘贴后不会再改写。

## 结果

| 输入                                                     | 当前公开版 `1340988`            | 修复前 `fa69e37`                |
| -------------------------------------------------------- | ------------------------------- | ------------------------------- |
| 默认欢迎文章导出 DOM                                     | 退出 0，`isValid: true`，无违规 | 退出 1，仅 `line-height` 类警告 |
| 同次原生剪贴板 HTML                                      | 退出 0，`isValid: true`，无违规 | 退出 1，仅 `line-height` 类警告 |
| 用户提供的公众号粘贴后正文 HTML                          | 退出 0，`isValid: true`，无违规 | 退出 0，`isValid: true`，无违规 |
| 官方合规样例 `line-height-baseline-mixed-fragments.html` | 退出 0，无违规                  | 本轮未执行                      |
| 自建反例：16px 字号、`line-height: 0`、三行文字          | 退出 1，正确检出行高问题        | 本轮未执行                      |

旧版在两份文章样本中各返回 10 条检测条目，涉及 9 个不同段落，其中一段被主路径和兜底路径重复报告。原生剪贴板的 `paragraphIndex` 为零起始；转换为人类段号后：

| 段号 | 内容                                   | 与此前截图的关系       |
| ---- | -------------------------------------- | ---------------------- |
| 3    | 现代化 Markdown 编辑器介绍中的混合加粗 | 对应                   |
| 10   | “这是一个链接”                         | 对应                   |
| 13   | 水的化学式 H₂O                         | 对应                   |
| 14   | 爱因斯坦质能方程上下标                 | 对应                   |
| 41   | 行内代码 `console.log()`               | 对应                   |
| 45   | 行内公式                               | 对应，旧版内部报告两次 |
| 49   | RadishInk 脚注序号                     | 对应                   |
| 57   | “开始编辑吧!” 加粗及 emoji             | 本地旧版额外报告       |
| 59   | 参考资料文字、强调及 URL               | 本地旧版额外报告       |

官方 CLI 的 JSON 格式化会把 `outerHTML` 截到 200 字符；为核对正文，另用其原始 `verifyHtml` 入口保存完整结果，未修改规则或返回值。Puppeteer 输出既有旧 Headless 模式弃用警告；检测正常完成，不把该提示当作执行失败。

## 复现与证据

忽略目录 `.tmp/wechat-official-check/` 保存两份 HTML、采样环境、各版 JSON 结果、完整旧版结果及零行高反例；临时目录不保证长期存在，需复查时重新采集，并记录新的摘要。以下命令从本项目根目录执行，工具和样本需先按上述版本准备：

```bash
PUPPETEER_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  mise exec -- pnpm --dir /tmp/radishink-wechat-checker-1340988/cli exec tsx src/index.ts \
  "$PWD/.tmp/wechat-official-check/clipboard.html" --json

PUPPETEER_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  mise exec -- pnpm --dir /tmp/radishink-wechat-checker-fa69e37/cli exec tsx src/index.ts \
  "$PWD/.tmp/wechat-official-check/clipboard.html" --json
```

退出 1 表示检测到警告，退出 2 表示工具执行异常，不混为同一结果。

文档更新后 `mise exec -- pnpm check:repo` 与 `git diff --check` 通过。本轮采样浏览器已关闭；临时生产预览 PID `59661` 已按 `SIGTERM` 退出（143），4173 端口不再监听。用户此前的 5173 开发服务也已按要求关闭。诊断完成时尚未提交、推送或部署本轮文档修改；用户随后授权将工作区更改作本地提交，未要求推送。

## 用户补充的粘贴后正文

用户提供 `111.html`，75,509 UTF-8 字节，SHA-256 为 `5e1199f5cffb55ef272f1af5160a08f8b40d7d51428a6ea085435343d94ab7a0`。其最外层为编辑器容器 `edui1_iframeholder`，内部唯一的 `.ProseMirror[contenteditable="true"]` 包含完整欢迎文章及内联样式，具有 51 个直接子元素。没有脚本、iframe 或内联事件处理器；本轮只读原文件，没有改写用户文件。

使用 DOM 解析器提取该正文容器的 `innerHTML`，不清理正文节点或样式，结果为 `.tmp/wechat-official-check/wechat-pasted.html`，74,284 UTF-8 字节，SHA-256 为 `78df8d7c8a29ee6ed6db3587715cce7187f6ecf6d0c2acb69faa9595866a9309`。新旧官方 CLI 均退出 0、无违规。另保留正文容器的 `outerHTML` 用旧版复核，也通过，排除仅因移除正文容器自身 padding / min-height 造成结果变化。原文件及提取结果不进入 Git，仓库只保存上述摘要和结论。

七处相关正文段落仍为 `line-height: 28.8px`，上下标 / 脚注为 `12px`，行内代码为 `25.344px`，与之前原生剪贴板样本一致，确认本项目的行高修改进入了公众号。公众号新增了 115 个 `span[leaf]`；所核对段落的普通文字由直接文本节点变为 leaf 包裹节点。旧版检测器的兜底分支只检查含直接文本的块，因此两种结构不一定走同一检测路径。两版对粘贴后正文通过，不表示每种结构获得相同覆盖，也不等同于肉眼及手机验收。

结合“插入前剪贴板样本旧版告警、插入后正文两版通过”，告警可能来自插入前的检测阶段，或线上采用了不同规则版本；这是推断，未通过线上调用时点或运行代码证实。

## 剩余边界与处理方向

公众号页面自动读取此前被工具明确限制，本轮通过用户主动提供的正文文件完成第三段对照，没有改用其他途径自动访问页面。

保留当前实际行高修正，不继续放大全文行高、删除行内语义或添加豁免标记。三阶段样本现已具备，可准备仅含合成内容的最小样例用于官方误报反馈；对外提交仍需明确授权。公众号保存重开、手机明暗和线上检测版本继续分别记录。
