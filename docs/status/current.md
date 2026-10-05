# 当前状态

更新时间：2026-10-05。

## 当前范围

首轮 Web 品牌整理与推送前审阅已通过 [PR #1](https://github.com/laugh0608/RadishInk/pull/1) 合入 `main`。未来能力规划与 CI 验证记录已通过 [PR #2](https://github.com/laugh0608/RadishInk/pull/2) 合入，合并提交为 `1f8ad27`，并已快进回流到 `dev`。远程 main Ruleset 已为 `active`；依据用户提供的 Actions 未启用页面明确启用仓库后，自动 PR CI 已恢复，缺少检查与组件失败的合并阻断已验证。现有 Vercel Hobby 项目已按用户确认部署 `dev / a3c45e8`，`ink.radishx.com` 可访问；真实公众号验收尚未执行。

## 已准备

- `origin` 指向 RadishInk，`upstream` 指向 WeMD，完整历史保留。
- 本地与远程 `main` 已更新至 PR #2 合并提交 `1f8ad27`，`main` 跟踪 `origin/main`；`dev` 已快进回流该提交并跟踪 `origin/dev`，合并记录继续在 `dev` 维护。品牌提交 `4d096cd`、审阅修复 `fc4bd2f` 及相关记录已通过 PR #1 集成。
- `.idea/` 与 JetBrains 项目文件已忽略，本地已有文件保留。
- 逐份对照五个兄弟项目的 AGENTS / CLAUDE，补齐通用执行、实现、验证和交付规则，两份正文同步。
- 新 tag 与 Docker 标签采用 Radish 日历版本 / 轨道规则，已有 39 个 tag 的名称与目标全部保持不变。
- Docker / 桌面发布工作流仍在停用目录；Docker 命名模板已调整，首次正式发布的版本同步和发布门禁尚待准备。
- 远程默认分支为 `main`，仓库 Actions 已显式启用并产生自动 `pull_request` 运行；[main Ruleset 24501729](https://github.com/laugh0608/RadishInk/rules/24501729) 要求来自 GitHub Actions 的 `Candidate Quality`。`dev` 不受规则约束，仓库合并设置模板本次未应用。
- 项目 mise 选择 Node 22 / pnpm 9.0.2，Vercel 构建配置已准备。
- Web 入口、欢迎页、默认文章、图标和 PWA 已统一为 RadishInk / 萝卜墨笺，新增本站帮助与关于页面，保留 WeMD 来源和许可。
- 已移除 Google Analytics 与隐式上游图床；新用户默认不上传，用户显式配置的服务和既有草稿继续保留。
- 已逐项核对原 9 项依赖声明待办；缺失文本计数为 0，补充文件保留来源、补录方式及摘要。当前 Web 实际打包其中 5 项，另外 4 项未进入应用模块产物。
- Web 四个预览 / 复制入口已清理原生 HTML 活动内容，复制主题 CSS 改为文本节点写入；草稿原文保留。DOMPurify 直接依赖及 Mermaid 所用版本统一到 `3.4.16`。

## 验证状态

初始化已通过仓库检查、原 23 项治理测试、64 项 core 测试、749 项 Web 测试及 Web 构建；Web Lint 为 0 错误、12 条既有警告。浏览器编辑、预览、草稿恢复与复制 HTML 已检查，详见 [初始化记录](../records/2026-10-05-bootstrap.md)。

本次治理扩充通过仓库检查、31 项治理 / 版本测试、Compose 配置解析及 `git diff --check`；未改动 Web 运行代码，因此未重复执行完整 Web 基线。历史 tag 引用与 IDEA 忽略已核对，详见 [治理扩充记录](../records/2026-10-05-governance-followup.md)。

Web 品牌整理通过 31 项治理测试、64 项 core 测试、785 项 Web 测试与构建，Lint 仍为 0 错误、12 条既有警告。真实浏览器已验证默认请求、设置切换、草稿恢复、复制 HTML 内容、本地图片与公式字体加载；实际公众号粘贴尚未验证，详见 [本轮记录](../records/2026-10-05-web-brand-and-services.md)。

依赖声明复核新增 8 项负向 / 生成测试，治理测试合计 39 项通过；正常 Web 构建与模块清单导出通过。复核工具对 181 个应用 JS chunk 的最终字节摘要逐一校验，逐项结论见 [依赖分发复核记录](../records/2026-10-05-web-license-review.md)。本轮未修改 Web 运行逻辑或依赖版本。

随后推送前审阅复现并修复原生 HTML 事件执行，增加 12 项回归；完整基线为 39 项治理、64 项 core、797 项 Web 测试与构建通过，Lint 0 错误 / 12 条既有警告。生产浏览器确认危险草稿刷新不执行且原文保留，正常排版、公式、图表、草稿与复制仍可用。依赖升级后重新生成声明并核对 181 个应用 chunk。完整范围与限制见 [推送前审阅记录](../records/2026-10-05-pre-push-review.md)。

首次推送后已核对远程 main / dev 提交、默认分支及无远程标签，本地跟踪关系一致。[手动 CI 运行](https://github.com/laugh0608/RadishInk/actions/runs/37304433429) 在 `73a5b28` 上三个作业全部通过，但当时自动运行未产生，PR #1 合并前的检查列表为空。用户明确授权先合并，已采用 merge commit 并将 `main` 快进回流到 `dev`。手动运行不替代 PR 门禁。

Ruleset 启用前已保存远程配置，启用后 API 回读确认 `main` 生效四项规则、必需检查来源为 GitHub Actions、管理员仅可在 PR 内 bypass，`dev` 无规则。配置记录见 [远程配置记录](../records/2026-10-05-remote-pr-initialization.md)。

PR #2 复测发现 API 虽报告 `enabled: true`，用户 Actions 页面却明确显示仓库未启用。显式启用并重新打开 PR 后，[首次自动运行](https://github.com/laugh0608/RadishInk/actions/runs/37312984798) 三个作业全部通过；随后故意失效的文档链接使 [负向运行](https://github.com/laugh0608/RadishInk/actions/runs/37313504793) 的 `Repo Hygiene` 与 `Candidate Quality` 失败，PR 保持 `BLOCKED`。修复提交 `b112b83` 的 [自动运行](https://github.com/laugh0608/RadishInk/actions/runs/37314313058) 三项检查全部通过，PR 恢复 `CLEAN`，随后依用户授权正常合并；会话解决和管理员 bypass 未做行为测试。规划、本地完整基线与排查经过见 [PR CI 验证记录](../records/2026-10-05-pr-ci-validation.md)。

## 后续顺序

Vercel 本地准备已通过完整 Web 基线（39 项治理、64 项 core、797 项 Web、构建；Lint 0 错误 / 12 条既有警告）及 181 个应用 chunk 的许可摘要核对。生产浏览器已核对合成样例、草稿恢复、两种复制、默认／黑金奢华主题和表格换行。已准备 [公众号验收步骤](../deployment/wechat-acceptance.md) 与样例，详见 [本轮证据](../records/2026-10-05-vercel-acceptance-preparation.md)。用户随后确认在已有 `laugh0608s-projects/radish-ink`（Hobby）部署 `dev / a3c45e8`；部署 Ready，用户已绑定的 `ink.radishx.com` 首页、图片及 MathJax 匿名请求通过，见 [远程部署证据](../records/2026-10-05-vercel-dev-deployment.md)。真实公众号粘贴、转存、保存重开及手机明暗效果均未验证。

1. 后续开发从已回流的 `dev` 开始；每次 PR 以最新提交实际检查作为合并依据，不使用历史成功或管理员 bypass 代替。
2. 仓库级合并设置模板按对应授权另行应用；会话解决与管理员 PR-only bypass 保留单独验收边界。Ruleset 用于约束合并，不是 `pull_request` 工作流触发的前置条件。
3. 下一项开发按 [关于与帮助弹窗重构](../planning/information-dialogs.md) 推进；本次仅确认计划，现有侧栏仍打开独立页面。明日具体顺序见下节。
4. 按 [公众号验收步骤](../deployment/wechat-acceptance.md) 在现有域名检查粘贴、图片转存、公式、表格和保存重开。只使用现有项目，保持免费计划；用户已自行绑定域名。Ignored Build Step 仍为 Automatic，尚未限制其他分支，后续推送 dev 可能自动部署；收尾文档只作本地提交，未再次推送。
5. 需要 Git / Docker 发布时，按 [版本规则](../governance/versioning.md) 建立产品版本来源与发布前置条件后再恢复工作流。

## 明日事项（2026-10-06）

1. **首项开发：关于与帮助弹窗。** 从 `dev` 开始，复用现有 Modal，将左下角两个入口改为弹窗；一并处理语法帮助入口、许可链接、旧 URL 兼容、明暗主题和移动宽度，具体范围见 [重构计划](../planning/information-dialogs.md)。完成实现后运行相关测试、Lint、Web 构建与浏览器检查。
2. **真实公众号验收。** 使用已有合成样例，在 `ink.radishx.com` 检查粘贴、图片转存、公式／表格、保存重开和手机明暗效果；需要用户实际公众号会话参与，保留未验证状态直到取得证据。
3. **远程收尾。** 本地文档提交尚未推送；后续推送须按实际授权范围执行，并留意 Vercel 会跟踪 `dev`。仓库合并设置模板尚未应用、Vercel 分支过滤仍为 Automatic，后续按需要处理，不重复启用已生效的 Actions / Ruleset。
4. **后续功能。** 弹窗重构与核心体验验证后，优先明确 Markdown 单文件导入导出的首轮交互与往返契约；通用插件系统排在其后。本站 canonical／分享元数据目前仍未补充，可在品牌入口后续维护时处理。

以上为工作交接清单，不表示已安排自动执行。今天的提交回顾、文档修正与验证范围见 [收尾记录](../records/2026-10-05-day-review.md)。

## 未来能力规划

- [Markdown 文件导入导出](../planning/markdown-file-import-export.md)：先规划浏览器单文件导入与当前文章导出，复用现有工作区和元数据能力，再评估批量及附件归档。
- [插件系统](../planning/plugin-system.md)：先以实际内置扩展验证执行与生命周期契约，再评估公共 API、第三方隔离及分发。

两项均尚未进入实现和验收；建议文件进出先于通用插件平台。远程 PR 自动检查与正常合并流程已验证，功能实施仍需另行确定范围，不因建立专题而提前增加运行时代码或产品承诺。

当前不进行包名批量替换、桌面 / 服务端裁剪、账号云同步或 tag / Release 发布。页面品牌、默认统计与上传端点和本轮依赖声明待办已整理；Web 已部署可访问，真实公众号效果仍未验收，不将部署成功等同于产品验收完成。
