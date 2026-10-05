# RadishInk 安全策略

RadishInk 当前处于初始化阶段，尚未承诺发布周期、支持版本或响应 SLA。

## 私下报告

请发送邮件至维护者 `luobo@radishx.com`，主题包含 `[RadishInk Security]`。若仓库后续启用了 GitHub Private Vulnerability Reporting，也可通过仓库 Security 页面报告；本文件不代表该功能已经启用。

不要在公开 Issue / PR 放未修复漏洞的可利用细节。报告提供受影响提交、浏览器 / 系统、脱敏最小 Markdown、复现步骤及安全影响；不要附真实文章、上传凭据、token 或个人信息。需要敏感材料时先协调传输方式。

## 关注范围

- 不可信 Markdown、HTML、CSS、SVG 或导入文件导致脚本执行、凭据 / 草稿泄漏。
- 草稿读写、迁移、导入导出造成越权、可利用的数据破坏或跨源泄漏。
- 图床、AI、统计请求把内容或凭据发送到非预期目标。
- 依赖、CI、构建和发布链路被利用执行未授权代码或替换产物。
- 可稳定触发且具有安全影响的资源耗尽。

普通排版差异、无安全影响的性能问题和使用咨询走常规 Issue。维护者尽力复现、修复并协调披露；修复仍需验证和主线 PR 流程，真实秘密不得成为测试 fixture。

## Web 渲染边界

原生 HTML 是 Markdown 排版能力的一部分。Web 实时预览、主题预览、复制 HTML 与公众号复制在内容进入 DOM 前使用 `sanitizeRenderedHtml` 清理活动内容；公众号复制还需在离屏计数器 / 样式容器之前清理，不能只处理最终剪贴板。保留正常 HTML、行内样式、SVG 静态图形和 MathML；移除脚本、事件处理器、危险链接、原生样式标签及表单 / 嵌入页面等内容。草稿原文不会因此改写或删除。

主题 CSS 通过独立 style 节点的 `textContent` 写入。此边界防止 HTML 脚本注入，不是 CSS 隔离或外部资源禁用器：文章图片、行内 CSS 和用户主题仍可能引用外部资源；处理器与下游插件升级后必须重新验证。`@wemd/core` 返回排版 HTML，不承诺单独提供 DOM 安全边界；新增消费者必须在实际 DOM 入口清理。

Web 显式依赖 DOMPurify，并用工作区 override 让 Mermaid 使用同一版本。更新时核对 [官方说明](https://github.com/cure53/DOMPurify)、[安全公告](https://github.com/cure53/DOMPurify/security/advisories)及锁文件，重跑渲染 / 复制回归与真实浏览器验证；不能依赖易被插件修改的单次早期清理。
