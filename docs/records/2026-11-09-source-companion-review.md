# 2026-11-09 基础源码伴随包本地验收

## Alpine 组合通知

将 `alpine-base@3.24.3-r0` 和 `alpine-keys@2.6-r0` 保留在 128 项计划中。以先前复核的已签名 APK、固定 APKBUILD 和公钥为版本与内容证据。随包保留各自改用 MIT 时的上游 APKBUILD 原件，包含公开的署名字段和 MIT 声明，并附上 SPDX v3.27.0 的 MIT 标准全文。原件中的署名按原义保留，标准文本的占位符保持原样。组合通知沿用项目已有的处理方式。[APK 与 Git 历史证据](2026-11-09-alpine-mit-review.md) · [项目既有做法](../deployment/image-distribution.md#范围与输入) · [SPDX 固定正文](https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MIT.txt)

原始 APKBUILD 和公钥继续单独按固定 SHA-256 校验，公钥另外匹配配方的 SHA-512。采用同一份 SPDX 原件，SHA-256 为 `b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5`。五批已复核清单原样合并，加入上述两项后形成全量 `base-provision.json`。[全量清单](../../LICENSES/distribution/base-provision.json)

## 归档与核验

以真实缓存和现有 391 个 native 原件离线运行 `mise exec -- pnpm prepare:source-bundle`，生成目录及 `output/distribution/radishink-sources-local-review-20261109.tar.gz`。生成器的目录与流式归档校验通过。再次运行 `prepare:source-bundle --check` 和 `verifySourceArchive` 复验，标准 `tar -tzf` 可读取全部 3,592 个成员。

- 基础源码覆盖 128 项、2,796 个去重原件，另含 391 个 native 原件与许可材料。
- `bundle.json` SHA-256 为 `5875386e95e02119bb5bfbd521d71600d94e49f90cca73998ce9252b8f6d05be`。
- `.tar.gz` 大小为 1,395,886,527 字节，SHA-256 为 `74253c7d764dfb6dc434f975d423ddd724936ae29e74dfbaaa011ac81e0e1c02`。

门禁负向复查分别从临时清单移除两项 Alpine 条目、移除 `alpine-base` 的通知、移除 `alpine-keys` 的一个公钥，原有工具均拒绝输入。两种架构的四个现有最终镜像通过 `check:base-image-plan` 与 `check:image-distribution`，其中 amd64 在本机模拟执行。133 项治理测试、仓库检查和格式检查通过。

本地验收完成后，按发布候选提交取得原生 CI，复核分发材料，继续核验远端标签保护及成对发布条件。归档留在本地忽略目录，供后续候选复核。[发布顺序](../governance/versioning.md#首次发布前的准备)

## 原生 CI 接续

- `ea3c051` 的两个架构均在 `check:image-distribution` 失败。校验目录为 `0700`，非 root 容器用户无法读取 `/review` 的脚本。`379947d` 让容器用户可读取这份公开材料，并保留只读挂载。[首次运行](https://github.com/laugh0608/RadishInk/actions/runs/42620006333)
- `379947d` 的镜像分发与基础清单校验均通过。两台 runner 在 `test:deployment` 缺少 manifest `Descriptor`，停在测试镜像准备阶段。[第二次运行](https://github.com/laugh0608/RadishInk/actions/runs/42622231633)
- `a378aa31fb2632b7c3507af608f2469e2baa9295` 在两台临时 runner 启用并核验 containerd 镜像存储，固定测试镜像的 OCI manifest 格式。受控部署在恢复 Web 前另读 server 容器的 `healthy` 状态，覆盖 Compose 超时后仍返回成功的情形。amd64 和 arm64 均通过分发、基础清单与部署测试，`Repo Hygiene`、`Web Quality` 和 `Candidate Quality` 通过。[通过的原生 CI](https://github.com/laugh0608/RadishInk/actions/runs/42623260650)

本地四镜像核验、两架构部署测试及 135 项治理测试通过，本地 amd64 为模拟执行。重新运行 `prepare:source-bundle --check` 并计算归档 SHA-256，两项摘要均与上文一致。远端只读查询列出 `main` 分支 Ruleset 24501729，Git tag 保护、镜像标签不可覆盖和实际成对发布材料仍待验收。[现有 Ruleset](https://github.com/laugh0608/RadishInk/rules/24501729)

## 发布保护只读核对

GitHub 当前仅列出 `main` 分支规则。两个历史源码预发布 tag `v26.10.1-dev` 和 `v26.10.2-dev` 均在拟议规则覆盖范围内。`radishink-web` 与 `radishink-server` 的 GitHub Packages 查询均返回 `404`，本次未取得包配置或标签拒写证据。仓库默认工作流权限为 `read`，活动工作流仅有 CI。[拟议规则及验收](../../.github/rulesets/README.md#发布-tag-规则) · [镜像写入验收](../deployment/release-materials.md#远端写入验收)

本地归档重新核验通过，大小低于 GitHub Release 单文件 2 GiB 上限。实际版本、固定公开 URL 与匿名下载仍需验证。[Release 附件限制](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)

## Git tag 规则启用

按用户授权先启用更新、删除保护，再启用仅仓库管理员可绕过的创建限制。回读确认两条规则为 `active`，匹配相同的三个版本轨道，保护规则无 bypass。前后 `git ls-remote --tags origin` 的四条引用一致，包含两个附注 tag 对象及各自的目标提交。写入拒绝的行为测试留待隔离仓库验收。[保护规则 26854813](https://github.com/laugh0608/RadishInk/rules/26854813) · [创建规则 26854833](https://github.com/laugh0608/RadishInk/rules/26854833)

## 归档体积构成

按 `bundle.json` 的文件字节数统计，外层 gzip 前原件合计 1,408,715,822 字节。运行时工具链占 641,158,544 字节，其中 npm、Corepack、Yarn 的 2,153 个锁定 Registry 归档占 364,247,551 字节。Alpine 与 Debian 基础源码合计 530,428,424 字节，Sharp / libvips 原生依赖占 216,872,843 字节，其余是 Nginx 供应商源码、清单与通知。较大的单件包括 Alpine GCC 15 源码（约 101 MB）和 Debian GCC 12 源码（约 87 MB）。大量原件本身已经压缩，因此外层归档只比原件合计小约 13 MB。[运行时输入复核](2026-11-09-runtime-source-review.md) · [源码包范围](../deployment/release-materials.md#基础系统的源码提供方式)
