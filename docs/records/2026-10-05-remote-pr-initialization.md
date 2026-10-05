# 2026-10-05 远程分支与首个 PR

## 授权与执行

用户明确要求推送并创建 PR。执行前工作区干净，`dev` 为已审阅提交 `fc4bd2f`；只读查询确认目标为公开仓库 `laugh0608/RadishInk`、远程为空且无默认分支，`46cf893` 为 `dev` 祖先。

以 `git push --atomic --no-follow-tags origin 46cf893:refs/heads/main dev:refs/heads/dev` 一次创建两个分支；未使用强推、全量镜像或标签推送。结果逐项核对：

- 远程 `main`：`46cf89313a881bbbbd2017137a209b0ce197d0a8`，包含关闭旧发布工作流的治理基线。
- 首次远程 `dev`：`fc4bd2f32cc9f052309ae791ec8eb79b55902618`；后续本任务文档 / CI 修正继续通过该分支进入 PR。
- 远程默认分支自动为 `main`；远程无标签，本地历史标签保留。
- 本地 `main` 通过 fast-forward 更新至 `origin/main`，跟踪关系从 `upstream/main` 改为 `origin/main`；本地 `dev` 跟踪 `origin/dev`，当前仍在 `dev`。

已创建 [PR #1：建立萝卜墨笺首个 Web 集成版本](https://github.com/laugh0608/RadishInk/pull/1)，来源 `dev`、目标 `main`，正文说明变更、验证、数据与许可影响，以及真实公众号和部署的未验收范围。

## Actions 与验收边界

远程 API 确认 Actions `enabled: true`，唯一工作流 `PR Checks` 为 `active`，默认 token 权限为只读，Actions 事件策略列表为空。PR 无合并冲突，最新提交消息没有跳过 CI 指令，但 `opened`、文档提交的 `synchronize` 和一次关闭后重新打开均未产生 `pull_request` 运行。根因尚未确定；未通过放宽权限、开启发布或改用 `pull_request_target` 绕过。

为区分触发与执行问题，手动对 `dev` 触发 [运行 37304433429](https://github.com/laugh0608/RadishInk/actions/runs/37304433429)，对应 `73a5b28d1a6c431216e136949306e92f0d3c8427`，事件为 `workflow_dispatch`。`Repo Hygiene`、`Web Quality` 和聚合 `Candidate Quality` 均为 `success`；此后仅补充当前验证事实的文档。本地 PR 范围检查亦通过。

**手动运行成功不等于 PR 门禁通过。** PR 检查列表为空；手动事件也不会执行工作流中依赖 PR 上下文的分支 / 提交范围检查。GitHub 对工作流作业的 required status checks 有事件要求，不能用手动运行替代 PR 检查，[官方说明](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)。当时将恢复自动 PR 检查列为合并前待办；下文记录用户随后明确授权先合并的实际执行，触发与门禁验收仍未完成。

本地完整 Web 验证与生产浏览器证据见 [推送前审阅](2026-10-05-pre-push-review.md)。首次推送与创建 PR 阶段没有修改仓库合并设置、启用 Ruleset、合并 PR、创建 tag / Release、连接 Vercel 或部署。

## PR 合并与分支回流

2026-10-05，用户在知晓上述检查状态后明确要求先合并。执行前重新核对 PR 为 `OPEN` / `MERGEABLE`、无冲突，源提交为 `a47d641f530cfe64dcd5d6bea2c65a2b48be7a8b`，检查列表仍为空；仓库允许 merge commit，自动删除源分支关闭。

使用 `gh pr merge 1 --merge --match-head-commit a47d641f530cfe64dcd5d6bea2c65a2b48be7a8b` 合并已核对提交，未使用管理员绕过选项或删除 `dev`。GitHub 确认 PR 为 `MERGED`，时间为 `2026-10-05T11:59:16Z`，合并提交为 `7fed7ce4a55ec3b84b176b3215582ec666c81cb7`。随后抓取远程引用，将本地 `main` 快进到 `origin/main`，再将 `dev` 快进到 `main`，保留共享历史；本次状态文档在 `dev` 提交并随回流推送。

未配置 Ruleset 不会阻止 `pull_request` 工作流触发：工作流的 `on` 定义触发事件，Ruleset 约束分支更新与合并条件，见 [工作流触发](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) 与 [Ruleset 说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)。本次合并没有解决自动触发问题，也不构成远程门禁验收。后续应在新的 PR 验证自动运行，按对应授权应用规则并检查失败阻断。

此次合并与回流未改变工作流、仓库设置或 Ruleset，未创建 tag / Release、连接 Vercel 或部署；真实公众号验收仍待进行。

## main Ruleset 启用

2026-10-05，用户明确要求先启用 Rulesets，并询问能否使用 `gh`。执行前工作区干净，位于 `dev` / `6ce0c92`；远程为公开仓库、当前账号具有管理员权限，Ruleset 列表和 `main` 生效规则均为空。先将远程仓库配置与 Ruleset JSON 保存到本地忽略目录 `.tmp/ruleset-enablement/`，再以 `gh api --method POST repos/laugh0608/RadishInk/rulesets --input .tmp/ruleset-enablement/main-protection.request.json` 创建规则。

请求内容来自 `.github/rulesets/main-protection.json`，唯一环境补充是必需检查的 `integration_id: 15368`。该 ID 从已有 `Candidate Quality` 检查实际返回的 `github-actions` App 读取，未将环境 ID 写入通用模板。

- 规则：[RadishInk main via PR](https://github.com/laugh0608/RadishInk/rules/24501729)，ID `24501729`，状态 `active`，仅匹配 `refs/heads/main`。
- 规则要求 PR、所有会话解决、分支与主线同步，以及 GitHub Actions 的 `Candidate Quality` 成功；禁止删除与 force push；允许 merge / rebase，审批数为 0。
- 管理员角色仅允许 `pull_request` bypass，未开放直接 push bypass；配置回读中完整保留此边界。
- 创建后重新读取规则 ID、仓库规则列表和 `main` / `dev` 实际生效规则，逐字段断言匹配请求：仓库仅有这一条 Ruleset，`main` 生效四项规则，`dev` 返回空列表。
- GitHub 回包另带 `required_reviewers: []` 和 `require_extra_approval_for_unattributed_changes: true` 默认字段；请求中的审批数仍为 0，未修改这些服务端默认值。
- `pnpm test:governance` 的 39 项测试通过，包括 required context、管理员 bypass、匹配分支和聚合失败行为的负向用例；仓库文档检查与差异检查通过。

这次已验证远程配置处于启用状态，未创建临时失败 PR，也未验证真实合并按钮阻断、会话解决或管理员 bypass 行为；自动 PR 检查未触发的原因仍待排查。未用手动 CI 成功替代这些验收，也未修改工作流或放宽检查。

本次仅应用 Ruleset，没有应用 `.github/repository-settings.json`。仓库级 squash 开关仍开启，但受本规则保护的 `main` 仅允许 merge / rebase；仓库级设置同步仍单独待办。未创建 tag / Release、连接 Vercel 或部署。
