# 2026-10-05 PR CI 阻断验证

此提交用于一次受控的负向验证：下面的文档链接故意指向不存在的文件，预期 `Repo Hygiene` 和 `Candidate Quality` 失败，PR 保持阻断。

[缺失的验证目标](__pr-ci-validation-missing__.md)

确认远程失败传播后立即修复本记录，不合并失败提交，不修改检查器或放宽 Ruleset。首次正常自动运行已在 `e67185e` 通过，见 [运行 37312984798](https://github.com/laugh0608/RadishInk/actions/runs/37312984798)。
