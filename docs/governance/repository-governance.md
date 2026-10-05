# 仓库治理

本规则吸收 Radish 家族的通用协作经验，并按本项目的 Web 工作区重新设计。分支决策见 [ADR 0001](../adr/0001-branch-and-pr-governance.md)，执行状态见 [当前状态](../status/current.md)。

## 基础规范

- 自有文本使用 UTF-8、LF、末尾换行和两空格缩进；Markdown 允许两个空格的显式换行。Windows 批处理使用 CRLF。
- 依赖由 pnpm 管理，提交 `pnpm-lock.yaml`；工具由 `mise.toml` 选择，根 `package.json` 声明 Node / pnpm 约束。
- 凭据、本地环境、缓存、构建产物和真实用户文章不进入版本控制；示例配置仅包含占位内容。
- 不全仓机械格式化上游代码。新文件和改动文件逐步符合规范，上游原有格式债务不靠海量无关 diff 修复。
- 提交标题使用 `type(scope): 中文说明` 或 `type: 中文说明`；类型为 feat、fix、docs、refactor、test、chore、ci、build、perf、revert。破坏性变更使用 `!` 并解释迁移。
- 真实 merge commit 保留；历史上游提交不重写。新增普通提交由 PR commit range 检查，后续导入上游仅豁免可证明属于导入的 WeMD 历史。
- PR 说明问题、变更、实际验证、数据 / 外部请求 / 许可影响及回滚方式。紧急修复也不绕过真实证据。

## 版本与镜像

历史 tag 保留，新增 tag 使用 Radish 日历版本与 `dev / test / release` 轨道，Docker 固定标签与完整 Git tag 一致。格式、别名、只读检查和首次发布前的准备统一见 [版本与镜像规则](versioning.md)。本地命名检查不改变远程 tag 保护，也不启用发布工作流。

## CI 契约

`.github/workflows/ci.yml` 只在目标为 `main` / `dev` 的 PR 和手动运行时执行，普通 push 不触发。主线唯一 required context 为 **Candidate Quality**，聚合下面两项：

| 组件         | 执行内容                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Repo Hygiene | 治理文件、文档链接、配置解析、工具链、工作流 / Ruleset 契约、新增或改动文本、PR 路由、提交范围及门禁自身测试 |
| Web Quality  | Web ESLint、core 与 Web 测试、Web TypeScript / Vite / PWA 构建                                               |

聚合 job 使用 `if: always()`，只有全部组件为 `success` 才通过；失败、取消、跳过都不放行。工作流无路径过滤，避免必需检查因只改文档而永远等待。默认测试 GitHub PR 合并结果，提交范围单独使用 base / head SHA 检查。

PR CI 不发布镜像、Release 或站点，只使用只读仓库权限，不读取生产凭据。`apps/server`、`apps/electron` 仍可定向检查，但不是当前前端产品的 required baseline；触及这些模块时须额外执行它们的验证。

`yaml` 是检查器直接依赖，沿用上游锁文件已存在的版本，不进入浏览器运行代码。CI 与本地检查通过同一组 package scripts 执行，不能只维护其中一边。

## GitHub 目标设置

- 默认稳定分支：`main`；日常开发：`dev`。
- Merge commits 和 Rebase merging 开启；Squash merging 关闭。阶段 PR 优先 merge commit。
- 自动删除 PR head 分支关闭，防止删除长期 `dev`；临时主题分支在确认合并与回流后手工清理。
- `main` Ruleset 要求 PR、会话解决、最新 Candidate Quality，禁止删除和 force push。
- 单人阶段审批数为 0，不设置虚假的 CODEOWNERS 或最后推送者之外审批；多人阶段再提高。
- 管理员 bypass 只允许在 PR 内使用，是需记录原因的应急能力，不作为常规忽略失败检查的方式。
- 不要求线性历史，避免与 merge commit 冲突；签名提交、标签保护及自动发布待真实发布方案形成后再制定。

这些是**目标设置**，JSON 文件不会改变 GitHub。可审阅模板和后续启用顺序在 [Rulesets](../../.github/rulesets/README.md)。

## 变更同步

| 变更                     | 同步位置                                      |
| ------------------------ | --------------------------------------------- |
| 分支 / 合并方式          | ADR、Ruleset、仓库设置模板、PR 模板、检查器   |
| required check / CI 组件 | 工作流、Ruleset、检查器与测试、验证基线       |
| 工具链 / 依赖            | mise、package.json、锁文件、CI、开发文档      |
| tag / 镜像命名           | 版本规则、元数据脚本与测试、停用模板、Compose |
| 协作约束                 | AGENTS、CLAUDE、协作专题                      |
| 当前范围 / 已验证状态    | 当前状态、必要的验证记录                      |
| 来源 / 许可 / 外部服务   | 上游维护、产品与部署文档、相关用户界面        |
