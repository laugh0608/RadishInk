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

远程 API 确认 Actions `enabled: true`，唯一工作流 `PR Checks` 为 `active`。该流程仅 PR / 手动触发，普通 push 不产生独立运行；已有 PR 的同步事件应触发检查。当前提交的实际结论见 [PR 检查页](https://github.com/laugh0608/RadishInk/pull/1/checks)，以 `Repo Hygiene`、`Web Quality` 和聚合 `Candidate Quality` 为准。

本地完整 Web 验证与生产浏览器证据见 [推送前审阅](2026-10-05-pre-push-review.md)。本次只推送和创建 PR，没有修改仓库合并设置、启用 Ruleset、合并 PR、创建 tag / Release、连接 Vercel 或部署。远程规则配置与实际阻断验收、合并后回流 `dev`、真实公众号验收仍须按各自授权推进。
