# 2026-10-05 未来规划与 PR CI 验证

## 规划与本地验证

用户要求为 Markdown 文件导入导出、插件系统分别建立未来规划，提交后继续测试 PR。已在 `e67185e` 提交两份 [文件进出专题](../planning/markdown-file-import-export.md) 和 [插件专题](../planning/plugin-system.md)，同步产品范围、文档索引及当前状态；没有实现运行时代码、引入依赖或变更用户存储。

提交前 `mise exec -- pnpm validate:web` 通过：39 项治理测试、64 项 core 测试、797 项 Web 测试及 TypeScript / Vite / PWA 构建通过，Lint 0 错误 / 12 条既有警告。保留现有构建体积和浏览器数据提示；本轮文档变更没有重复浏览器或真实公众号验收。

已推送 `dev` 并创建 [PR #2](https://github.com/laugh0608/RadishInk/pull/2)，同时集成 PR #1 合并回流和 Ruleset 启用的既有文档记录。初始授权用于提交、推送与 PR 验证；用户在验证通过后另行授权合并、回流 `dev` 和推送，执行结果见下文。

## 自动触发问题与纠正

PR #2 初建时仍未产生 `pull_request` 运行。GitHub API 返回合并无冲突、检查列表为空、合并状态 `BLOCKED`；用户提供的 PR 页面显示 `Candidate Quality` 为 `Expected — Waiting for status to be reported`，合并按钮不可用。这个状态证明必需检查缺失时会阻断正常合并，不是工作流已开始执行。

此前已核对以下信息：

- PR #1 的 opened / reopened 和 PR #2 的 opened 事件真实存在，创建者是仓库所有者；`gh` 使用用户 OAuth，环境没有 `GH_TOKEN` / `GITHUB_TOKEN` 覆盖。
- 初始 `main`、当前 `main` 和 `dev` 上工作流字节一致，目标分支和事件正确，没有路径过滤或跳过 CI 的提交指令。
- 仓库 Actions 权限 API 返回 `enabled: true`，工作流为 `active`，事件策略为空，手动运行成功。

**这些 API 和手动运行证据不足以证明仓库自动工作流已启用。** 用户随后提供 Actions 页面截图，明确显示 `GitHub Actions is not currently enabled on this repository`，并提供 `Enable Actions on this repository` 按钮。此前依据 API 宣称 Actions 已启用的判断需要据此纠正。

执行 `gh api --method PUT repos/laugh0608/RadishInk/actions/permissions -F enabled=true` 明确启用仓库 Actions，保留现有工作流只读权限、允许的 actions 和 Ruleset；请求前后权限 API 均仍返回 `enabled: true`。随后关闭并重新打开 PR #2，生成了真正的自动 `pull_request` 运行。操作前后原始结果保存在本地忽略目录；未把 API 与页面差异解释成未经验证的 GitHub 内部实现细节。

可确认的结论是：页面显示的仓库未启用状态是有效阻断线索，显式启用并重发 PR 事件后自动运行恢复。Ruleset 控制合并条件，不是此次工作流触发的修复点。

## 正常、失败与修复验证

| 阶段             | 提交与远程证据                                                                                                      | 结果                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 缺少必需检查     | PR #2 初始 `e67185e`，API 与用户页面                                                                                | `Candidate Quality` 未上报，PR 为 `BLOCKED`                                     |
| 首次正常自动运行 | `e67185e`，[运行 37312984798](https://github.com/laugh0608/RadishInk/actions/runs/37312984798)，事件 `pull_request` | `Repo Hygiene`、`Web Quality`、`Candidate Quality` 全部成功，PR 为 `CLEAN`      |
| 受控文档错误     | `4e53f6e`，[运行 37313504793](https://github.com/laugh0608/RadishInk/actions/runs/37313504793)，事件 `pull_request` | `Web Quality` 成功，`Repo Hygiene` 与 `Candidate Quality` 失败，PR 为 `BLOCKED` |
| 修复             | `b112b83`，[运行 37314313058](https://github.com/laugh0608/RadishInk/actions/runs/37314313058)，事件 `pull_request` | 三项检查全部成功，PR 恢复 `CLEAN`，工作流和规则未放宽                           |

负向测试只添加一条指向不存在文档的链接。本地 `pnpm check:repo` 先以退出码 1 报出该链接不存在；远程失败日志再次确认同一原因。等聚合运行结束并读取 PR 阻断状态后才推送修复，没有取消运行来代替失败证据。

没有删除检查断言、忽略失败退出码、放宽 required context 或使用管理员 bypass。修复后以最新提交实际生成的检查作为合并依据，历史成功不能替代最新检查。

## PR 合并与分支回流

用户明确要求合并、回灌 `dev` 并推送。合并前再次核对 PR #2 的 head 为 `b112b836722778cc5cc70ddbeca4646cc74aa4bb`，三个检查均为 `SUCCESS`，状态为 `CLEAN` / `MERGEABLE`；远程允许 merge commit，自动删除 head 分支关闭。

使用 `gh pr merge --merge --match-head-commit` 正常合并，未使用 `--admin` 或删除长期分支。PR 于 `2026-10-05T13:14:13Z` 合入，merge commit 为 `1f8ad27e4f37ca6992a5cb5f18131bf9e4d9b30b`。随后获取远程结果，将本地 `main` 快进到 `origin/main`，再将 `dev` 快进到 `main`；无冲突、无历史重写。合并记录在 `dev` 维护并随分支回流推送。

## 验收边界与后续

- 本轮证明自动 PR 运行恢复，以及缺少检查、组件失败会阻断正常合并；没有通过 API 真正尝试合并失败 PR。
- 管理员 PR-only bypass 和会话解决已回读配置，但未执行 bypass 或构造未解决会话；不把这两项行为测试声称为已完成。
- 仓库级 squash 开关仍未按设置模板关闭，受保护的 `main` 已由 Ruleset 限制为 merge / rebase；该设置与此次触发问题分开处理。
- PR #2 已经正常合并并回流 `dev`。未创建 tag / Release、启用停用的发布工作流、连接 Vercel 或部署。
