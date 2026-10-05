# Web 依赖分发待办复核

日期：2026-10-05。基于 `dev` 的 `4d096cd`，承接 [Web 品牌整理](2026-10-05-web-brand-and-services.md) 留下的 9 项声明待办。以下记录该阶段验证时的依赖与构建；相关改动与后续 [推送前审阅](2026-10-05-pre-push-review.md) 一并提交，后者另有 DOMPurify 升级和新构建证据。未推送、创建 PR、修改远程设置或部署。

## 范围与结论

逐项核对锁定版本、包内文件、上游公开来源和真实 Vite 产物。9 项均已有可追溯的声明处理方式：1 项使用包内独立文件，2 项提取 README 原文，3 项补录上游文件，3 项依据已发布 MIT 声明组合归属信息与标准条款。组合文本在生成声明和来源索引中明确标记，没有伪称原包存在独立 LICENSE。

当前生成器涵盖 443 个已安装 Web / core 生产及 peer 依赖和 4 组静态资产，缺失文本计数为 0。该数字仅反映声明文本覆盖，不代表这 443 个包全部进入浏览器，也不是对所有分发情形的法律结论。

| 包与锁定版本               | 当前应用打包情况               | 声明处理与来源                                                                                                                                                                                                |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `juice@5.2.0`              | 主应用 chunk                   | 提取 npm 包 `README.md` 的 License 和第三方归属章节，保留原版权信息；固定原 README 摘要                                                                                                                       |
| `cheerio@0.22.0`           | 主应用 chunk                   | 原版本声明 MIT；补录上游 [添加缺失 LICENSE 的提交](https://github.com/cheeriojs/cheerio/commit/beae4b9aafb5ba270a96e132f47523df7a994200)，明确其为后续补充文本                                                |
| `boolbase@1.0.0`           | 主应用 chunk                   | 补录上游 [ISC 正文](https://github.com/fb55/boolbase/blob/be0bcd8a4e917a0a5895e95b523fbbed05a64871/LICENSE)；该提交中的 `index.js` 与已安装 1.0.0 字节一致                                                    |
| `slick@1.12.2`             | 主应用 chunk                   | 根据 [发布提交的 MIT 声明](https://github.com/kamicane/slick/blob/6eb8da55711e3b0ca81777b96cf45da868af382f/package.json)，保留 Valerio Proietti 作者信息及 `parser.js` 中 Thomas Aylott 归属，附标准 MIT 条款 |
| `qiniu-js@3.4.3`           | 动态加载的 QiniuUploader chunk | 根据 [发布提交的 README 许可声明](https://github.com/qiniu/js-sdk/blob/a98e9b8238e8c1b5e69c2c47870300058e2d1a28/README.md#license)，保留 `Copyright (c) 2018 qiniu.com`，附标准 MIT 条款                      |
| `datauri@2.0.0`            | 未出现在本次应用模块清单中     | 从 [v2.0.0 对应提交](https://github.com/data-uri/datauri/blob/a292eae3be3ac42af3eed17aaf0666f6d862eef4/MIT-LICENSE.txt) 补录 npm 包遗漏的 MIT 文件                                                            |
| `mimer@1.1.1`              | 未出现在本次应用模块清单中     | 已安装包自带 `MIT-LICENSE.txt`；修正文件名识别，无需下载或重写条款                                                                                                                                            |
| `assert-plus@1.0.0`        | 未出现在本次应用模块清单中     | 从 npm 包 `README.md` 提取完整 MIT 原文，固定原文件摘要                                                                                                                                                       |
| `markdown-it-imsize@2.0.1` | 未出现在本次应用模块清单中     | 根据 [发布提交的 MIT 声明](https://github.com/tatsy/markdown-it-imsize/blob/798b452a8e9b741e93930e4778b623758e08c1eb/package.json)，保留已发布作者 `tatsy`，附标准 MIT 条款                                   |

三份组合文本使用 [SPDX license-list-data v3.27.0 的 MIT 正文](https://github.com/spdx/license-list-data/blob/v3.27.0/text/MIT.txt)，逐字保留授权条款和免责声明；归属部分只使用包内已有信息，不猜测版权年份或权利人。`slick` 的历史 `mootools.net/license.txt` 链接本次不可用，未将其当作成功取得的原文来源。

补录文件与摘要在 [来源索引](../../apps/web/public/licenses/package-sources/sources.json)，完整分发声明由 [生成脚本](../../scripts/generate-web-notices.mjs) 生成。原始 WeMD `LICENSE`、依赖版本和锁文件均未更改。

## 实际构建证据

[模块复核脚本](../../scripts/audit-web-bundle.mjs) 使用现有 Web Vite 配置，在 Rollup `writeBundle` 阶段读取模块归属，避免在 Vite 完成预加载引用重写前记录错误摘要。构建结束后对输出文件再次核对 SHA-256；报告保存为忽略文件 `.tmp/web-bundle-audit.json`。

- 工具链：Node 22、pnpm 9.0.2、Vite 6.4.1、Rollup 4.53.3。
- 锁文件 SHA-256：`74bb281f6fee3ccf86d5e157bc8c61a9d44b76468622f2fc1c1151bb18abeef2`。
- 清单记录 244 个包的模块归属条目和 181 个应用 JS chunk；模块存在与 `renderedLength` 一起用于区分实际输出和被裁剪的条目。
- 上述 5 项打包依赖的 `renderedLength` 均大于 0；其余 4 项没有模块条目。这是本次应用构建的结论，不推广到桌面、服务端或未来构建。
- 主应用 `assets/index-DySchXpT.js`：`c6dc85c81d5db0fdc09534d0a045217b1e9264d81df62aa5567306fdfa16317e`。
- QiniuUploader `assets/QiniuUploader-DRu_aXNI.js`：`dfd146c97e0e890d2888b6cfaf0cce15f7b93da59b29d5ea4ce0c3affef1cfab`。

该清单针对应用 Rollup 模块；public 资产和 PWA 等独立生成文件不因该清单而获得来源豁免。未打包的四项仍保留声明，避免未来使用时丢失已核对的归属信息。

## 验证与后续

- `pnpm test:governance`：39 项通过，其中 8 项为新增声明生成测试，覆盖带前缀文件名、原文 / 来源保留、可重复输出、缺失文本、空文本、摘要漂移及路径越界。
- `pnpm build:web`：声明生成、TypeScript、Vite 与 PWA 均通过，261 项预缓存。保留既有大 chunk 和浏览器数据过期告警。
- `node scripts/audit-web-bundle.mjs`：通过，181 个 chunk 摘要与磁盘产物一致。
- 仓库检查与 `git diff --check` 通过；本轮没有修改 Web 运行逻辑，没有重复执行此前已通过的 64 项 core / 785 项 Web 功能测试和浏览器流程。

下一步是提交本轮改动，再按授权推进远程 main / dev、PR CI 与分支保护，随后准备公众号可访问的 Vercel 验收地址。实际公众号粘贴与上线验收仍须独立执行。
