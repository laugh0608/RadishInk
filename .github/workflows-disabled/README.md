# 暂停的发布工作流

此目录不是 GitHub Actions 的工作流发现目录，文件不会因 push、tag 或 workflow_dispatch 执行。

- `docker-image.yml`：由上游流程改为未来 RadishInk 命名模板。只匹配三个轨道的 tag，在登录前校验完整格式，使用 `ghcr.io/laugh0608/radishink-web` 及轨道别名；仍未启用，完整发布前置条件尚待补齐。
- `release.yml`：原 WeMD 桌面端打包和 Release 文件，保留原文用于来源追溯，其中旧 `v*` 触发器不是未来 RadishInk 发布规则。

原始 Docker 工作流可从上游导入提交 `70835e141aa94c0296c78c0f6adf67f636475f38` 读取。未来恢复任何发布流程都必须遵守 [版本与镜像规则](../../docs/governance/versioning.md)，完成品牌、版本同步、发布记录、质量门禁、凭据与目标检查，再作为独立变更移回活动目录。

当前只允许 `.github/workflows/ci.yml` 作为活动工作流，检查器会检测意外恢复。模板存在或命名检查通过均不代表已经获得发布授权。
