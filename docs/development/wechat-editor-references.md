# 微信公众号编辑器参考渠道

本页汇总公众号排版、复制、主题扩展和兼容修复的外部参考入口。核对日期：2026-10-06。优先阅读订阅号官方规范与 `wechatjs` 仓库的实际代码、测试和变更记录；引用仓库不表示本项目已安装或启用该工具。

## 规范与主要仓库

| 入口                                                                                                     | 主要用途                                                   | 使用边界                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [订阅号编辑器开发规范](https://developers.weixin.qq.com/doc/subscription/guide/product/plugin_spec.html) | CSS、文章结构、字体和明暗显示的官方规则                    | 使用 `subscription` 入口；不混用服务号文档。                                             |
| [wechatjs/verify-article-structure-spec](https://github.com/wechatjs/verify-article-structure-spec)      | 结构规范、违规与合规样例、真实浏览器检测 CLI、规则问题反馈 | 判断行高、宽度、嵌套等问题的首要参考；本地工具的版本不代表公众号线上部署版本。           |
| [wechatjs/mp-darkmode](https://github.com/wechatjs/mp-darkmode)                                          | 微信公众平台 Dark Mode 转换算法                            | 用于文字、背景、渐变和对比度问题；编辑器 UI 的暗色模式不能替代公众号正文的暗色转换验证。 |
| [wechatjs 官方组织](https://github.com/wechatjs)                                                         | 发现相关项目和后续维护入口                                 | 逐项核对 README、适用范围和维护状态，不因同属组织就加入项目依赖。                        |

结构检测仓库的常用入口：

- [规范定义](https://github.com/wechatjs/verify-article-structure-spec/blob/main/verify_article_structure.md)、[CLI 用法](https://github.com/wechatjs/verify-article-structure-spec/blob/main/cli/README.md)。
- [检测实现](https://github.com/wechatjs/verify-article-structure-spec/tree/main/cli/engine)、[回归样例](https://github.com/wechatjs/verify-article-structure-spec/tree/main/__tests__/fixtures)。
- [Issues](https://github.com/wechatjs/verify-article-structure-spec/issues) 与 [提交历史](https://github.com/wechatjs/verify-article-structure-spec/commits/main/)：先查已知问题与修复，再判断是否需要本项目适配。

## 辅助调试仓库

以下同属 `wechatjs`，提供通用网页诊断能力，不是公众号编辑器的结构规范或检测规则来源：

| 仓库                                                        | 用途                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [wechatjs/mprdev](https://github.com/wechatjs/mprdev)       | Web 远程调试工具，供移动端差异和难复现问题调查时评估。 |
| [wechatjs/vdebugger](https://github.com/wechatjs/vdebugger) | 前端 JavaScript 调试器，供脚本执行问题调查时评估。     |
| [wechatjs/mplogd](https://github.com/wechatjs/mplogd)       | 基于 IndexedDB 的前端日志存储，供诊断日志方案参考。    |

本页仅保存参考链接，不自动注入调试脚本、收集用户日志或连接远程调试服务。实际采用时仍按项目的依赖、隐私、外部请求和许可要求单独评估。

## 维护与复现方法

1. 记录应用提交、主题、浏览器、复制入口、警告位置和复测结果；先确认相关上游修复是否已包含在当前代码中。
2. 分别保留复制前的导出 DOM、原生剪贴板 `text/html` 和公众号粘贴后的正文 HTML。三者可能不同，不能用“复制 HTML”的纯文本结果代替“复制到公众号”的富文本载荷。
3. 官方检测器固定到准确提交，记录其 package 版本、依赖锁文件和浏览器版本。在临时目录独立运行合成样例；未经对应任务确认，不纳入产品依赖或默认 CI。
4. 先用官方合规、违规样例确认工具可执行，再检测应用输出；区分检测到问题的退出码与工具执行异常。比较规则修复前后时保留原始输入和两份结果，不修改检测器制造通过。
5. 即使当前公开检测器通过，也须按 [公众号验收步骤](../deployment/wechat-acceptance.md) 检查真实粘贴、保存重开和手机显示。公开源码已修复不等于公众号线上已同步；没有最终 HTML 或线上版本证据时保留不确定性。
6. 反馈外部 Issue 前准备仅含合成内容的最小样例，记录参考提交与证据；发送反馈仍需用户明确授权，不附带账号信息、凭据或真实文章。

已确认的外部问题与本项目调查结果放在 `docs/records/`，本页只维护渠道和通用方法。WeMD 是本项目的第三方上游，来源、许可及同步流程另见 [上游维护](../governance/upstream.md)，不将其修复等同于微信官方实现。
