# 源码伴随包与双镜像发布记录

本文接续[镜像分发材料](image-distribution.md)与[固定版本部署](release-compose.md)，定义发布准备的本地工具。阶段和未关闭条件见[当前状态](../status/current.md)，实际证据见[本轮记录](../records/2026-11-03-release-materials.md)。当前不启用发布、上传或部署。`v26.10.2-dev` 已是历史 Git tag，不能用于本批新提交；下面的 `RELEASE_TAG` 表示后续经分配、与 `version.json` 一致的新完整标识，不在本批自动创建或移动。

## 基础系统的源码提供方式

正式镜像采用**同版本、可匿名下载的完整源码伴随包**，名称为 `radishink-sources-<完整 tag>.tar.gz`。发布入口必须同时给出永久 HTTPS 下载地址、归档 SHA-256、大小与 `release-pair.json`；不能只提供上游查询链接，也不采用“联系维护者再获取”的方式。下载位置在实际分发时确定，通过 `--source-url` 写入记录，不隐式创建 GitHub Release。

伴随包保留第三方原始归档、配方、补丁、版权和许可文本，以及对应重建说明。第三方内容按自身许可提供；根 RadishInk 许可和 WeMD MIT 原文分别保留，不将整个包重新标作 RadishInk 原创。工具核验材料及身份关系，分发复核仍须确认输入确实覆盖对应源码、必要生成输入、嵌入依赖及各自的提供义务。

[基础镜像计划](../../LICENSES/distribution/base-image-plan.json)由四个本地最终镜像生成，包含 Web/server × amd64/arm64 的实际安装清单及附带工具。当前共 128 项去重源码需求：63 个 Debian 源码包、59 个 APK origin/version/commit 身份，以及 Node、npm、Corepack、Yarn 和两类容器启动脚本。它是需求清单，**不是已收齐源码的声明**。

```sh
mise exec -- node scripts/distribution/base-inventory.mjs \
  --server-amd64 <本地服务端 amd64 镜像> --server-arm64 <本地服务端 arm64 镜像> \
  --web-amd64 <本地 Web amd64 镜像> --web-arm64 <本地 Web arm64 镜像> \
  --output output/distribution/base/base-plan.json
mise exec -- pnpm check:base-image-plan --server <当前架构服务端镜像> --web <当前架构 Web 镜像>
```

采集使用无网络、只读、`--pull=never` 的临时容器，无业务端口和数据卷。服务端另核对当前 `dpkg-query` 与镜像内旧清单，读取 Node 实际版本、npm/Corepack/Yarn 的版本与原始 LICENSE 摘要、启动脚本摘要；Web 从实际 APK 库读取 origin、commit 和许可，记录原有启动脚本。只有已知 Nginx 供应商包允许缺少 aports commit。CI 每个原生架构构建后比较本架构的两个最终镜像，变更基础系统或附带工具时必须重新复核计划。

### 收集与复核输入

按每项需求准备 `base-provision.json`，结构为 `formatVersion: 1` 和 `entries` 数组。每项包含：

| 字段      | 含义                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| `id`      | 与计划 `requirements[].id` 完全相同                                                 |
| `review`  | 对应版本、完整源码范围、嵌入依赖、许可和配方来源的人工复核结论                      |
| `rebuild` | 解包、应用补丁、生成输入和重建的具体说明；保留上游构建边界                          |
| `files`   | 完整文件集；每项提供相对 `file`、永久 HTTPS `url`、`sha256`、正整数 `size`、`roles` |
| `roles`   | `source`、`recipe`、`notice`，可另含 `patch`、`signature`；同一文件可有多个职责     |

每项必须覆盖 source / recipe / notice。目录必须包含所有需求；不能通过删去计划项、伪造复核或空归档绕过门禁。共享文件只能使用完全相同的描述。下载只接受固定 SHA-256，缓存损坏会失败，保留原件供定位；不执行获取的源码、APKBUILD 或安装脚本。

- **Debian：** 按安装的 source package/version 从 [Debian snapshot](https://snapshot.debian.org/) 获取 `.dsc` 与其 `Checksums-Sha256` 中的全部原始 / Debian 补丁归档，保留签名。工具检查 `.dsc` 的 Source、Version、逐文件大小和 SHA-256，不能拿同名新版替代。`.dsc` 的技术核验不宣称已验证签名信任链。解包与重建使用 Debian 的 `dpkg-source` / 构建配方，见[官方说明](https://wiki.debian.org/BuildingTutorial)。
- **Alpine：** 固定安装库的 aports commit，保留对应目录的 APKBUILD、全部本地文件、安装 / 配置脚本及补丁，并收集所有源码归档。APKBUILD 及本地文件来自同一固定提交；工具核验 APKBUILD 的固定 URL 和全部字面 `sha512sums`，拒绝未知表达式或缺件。还需复核由变量或条件引入的构建输入，工具不执行 shell 配方。配方职责见 [Alpine 官方文档](https://wiki.alpinelinux.org/wiki/APKBUILD_Reference)。
- **Nginx 供应商：** 独立复核 nginx/pkg-oss 的对应版本配方、Nginx、njs、ACME 及模块源码；不能把缺少 commit 的供应商包当作 aports 包。ACME 等涉及的锁定依赖和生成输入也要保留。
- **Node 与附带工具：** 收集精确 Node 版本的源码、其内置依赖及通知，以及对应 npm、Corepack、Yarn 的完整输入和来源。必须保留镜像内原始 LICENSE 与启动脚本的相同字节；版本号、仓库首页和许可名称不能替代这些文件。Node/docker-node 与 Nginx/docker-nginx 的启动配方另行固定并复核。

当前只固定了需求与交付规则，尚未提交上述 128 项的完整 `base-provision.json` 或生成正式伴随包；它们是实际镜像发布前必须收齐的材料。已有 Sharp/libvips 的 391 个固定输入沿用原目录，不能替代系统包输入。

### 生成与检查

将复核后的文件缓存放在 Git 忽略的 `output/distribution/base/sources/`；不升级基础镜像或项目依赖。`--fetch` 显式按复核目录下载固定输入，共用原有 HTTPS、代理、并发、超时、摘要及半成品清理逻辑。下载体积取决于完整目录，运行前根据 `files[].size` 汇总并确认本地空间；这些缓存及归档不进入 Git。

```sh
mise exec -- node --use-env-proxy scripts/distribution/source-bundle.mjs --fetch \
  --plan LICENSES/distribution/base-image-plan.json \
  --provision output/distribution/base/base-provision.json \
  --directory output/distribution/base/sources \
  --native-directory output/distribution/sources \
  --output "output/distribution/radishink-sources-${RELEASE_TAG}"
mise exec -- pnpm prepare:source-bundle --check "output/distribution/radishink-sources-${RELEASE_TAG}"
```

没有 `--fetch` 时完全离线；`--check` 不下载或覆盖。已有完整目录需要重新生成归档时，使用 `--check <目录> --archive <新的归档路径>`。生成器在写入前验证全量覆盖和原生目录，拒绝已有输出目录。包内包含 `base-plan.json`、`base-provision.json`、`base/`、`native/`、`LICENSES/`、来源说明和 `bundle.json`。每个文件记录 SHA-256 与大小，缺件、多件、重复、路径越界或软链接均失败。

生成器另输出同名 `.tar.gz`，采用固定 mtime/UID/GID 的 ustar + gzip，同一输入可重生成同一归档。归档验证流式读取，不解包或执行内容，拒绝非普通文件、重复 / 越界成员、未知成员、截断或摘要漂移。用户下载后可用标准 `tar` 解包，运行 `--check` 核验；涉及源代码修改和重建的权利继续按第三方原许可保留。不承诺上游二进制逐位复现。

## 成对记录与部署 lock

发布准备须先取得**两个组件的候选 multiarch index digest**，每个 index 包含 amd64、arm64 两个运行清单。候选仅按 digest 暂存；在完整记录、源码下载验证与远端保护就绪前，不写完整 tag 或浮动别名。候选上传本身也需要对应授权，本文工具没有写 Registry 的接口。

```sh
mise exec -- pnpm prepare:release-pair \
  --tag "${RELEASE_TAG}" --revision <候选完整 Git SHA> --source-version version.json \
  --web-index sha256:<Web-index> --server-index sha256:<server-index> \
  --sources "output/distribution/radishink-sources-${RELEASE_TAG}" \
  --archive "output/distribution/radishink-sources-${RELEASE_TAG}.tar.gz" \
  --source-url "https://<公开固定下载位置>/radishink-sources-${RELEASE_TAG}.tar.gz" \
  --output "output/distribution/release-${RELEASE_TAG}"
```

执行前须已有完整 Git tag，且其目标提交、当前 HEAD 和 `--revision` 相同，提交内的版本 / 轨道与 tag 一致；工作区与暂存区必须干净，忽略的材料缓存可以保留。工具只读取 Git，不创建或移动 tag，也不会因 Registry 尚无同名镜像而接受另一提交的旧 Git tag。候选构建及材料复核应来自该干净检出；执行前将四个候选平台 digest 拉入本地缓存。工具通过 Registry V2 只读获取 index、平台 manifest 和 config，重新计算响应内容 digest、检查 descriptor 大小 / media type、架构、非 root 用户与 OCI version/source/revision；再以该平台 manifest 绑定的本地最终镜像重采基础清单，与源码伴随包比较。现代 Docker containerd 存储核对平台 Descriptor；经典存储核对 config ID 与精确 RepoDigest，均比较 RootFS diff IDs 和平台，不将 `inspect.Id` 一概当作 config digest。GHCR 私有候选可通过 `RADISHINK_GHCR_USER` / `RADISHINK_GHCR_TOKEN` 提供只读凭据，不写入记录、不使用 Docker 全局凭据文件，不把响应正文或凭据写进诊断。config blob 可按 Registry 规范跳转至 GHCR / 指定 GitHub blob 域，最多 5 次且不携带认证头；tag 查询拒绝重定向，不能把跳转解释成缺失。

两个组件、四个架构、源码目录与归档、源码版本和完整 tag 全部通过后，才输出 `release-pair.json`、`release-lock-amd64.json` 与 `release-lock-arm64.json`。前者保存两 index、四个平台 / config digest 和源码包的固定 URL、SHA-256、大小、内部清单摘要；后两者从同一记录派生，直接用于[固定版本部署预检](release-compose.md)。缺少组件或架构、不同 revision、源码不对应、版本 / 轨道错误均不能生成成功记录。

记录表示材料身份已核验，不表示远端 tag 已发布、CI 已运行或生产部署成功。实际发布另保留上传结果、双 tag 核验、别名更新、验证记录与回退目标。

## 完整 tag 不可覆盖检查与重试

```sh
mise exec -- pnpm prepare:release-pair --check-tags "output/distribution/release-${RELEASE_TAG}/release-pair.json"
```

该命令先匿名重新下载记录中的源码包，比较 SHA-256 / 大小，再检查两个仓库的完整 tag。只有明确的 Registry V2 `404 + MANIFEST_UNKNOWN` 才判定缺失；已有相同 digest 返回 `reuse`，必须跳过写入。不同 digest 拒绝覆盖。401/403、限流、网络故障、tag 查询重定向、普通代理 404、畸形 JSON 或 digest 不符都失败，不能解释成首次发布。

任一组件冲突时整组停止；部分发布后重试，也必须重新核验两个组件。同一 tag 的候选内容变化时分配新完整版本标识，不移动旧 tag。两个 tag 都确认为预期 digest 后，才允许按版本规则更新浮动别名并宣布成对发布可用。

**检查与写入之间存在竞态。** Registry V2 的读取检查不能原子锁住两个仓库，也不等于服务端不可覆盖策略。实际发布前还必须配置并实测远端不可覆盖 / 受限写权限与串行发布边界；重跑检查只能发现变化，不能代替服务端保护。[OCI Distribution 规范](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)不能被解释为默认提供跨仓库原子发布或 full tag 的条件写保证。

因此停用的 Docker 模板已去掉登录和 `push: true`，仅能构建导出 OCI 候选；活动工作流白名单仍只有 CI。后续发布接线必须把以上条件与实际远端能力一同实现并获对应授权，不能简单恢复原来两个 matrix 任务各自更新完整 tag / 别名的方式。
