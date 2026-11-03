# 镜像分发材料与构建门禁

本文定义本地生成、核验和随镜像交付的材料。实际执行结果见 [2026-11-03 记录](../records/2026-11-03-image-distribution.md)，阶段顺位与停止线以 [当前状态](../status/current.md) 为准。构建成功不代表镜像已发布，也不替代基础镜像再分发复核或真实环境验收。

## 范围与输入

- 服务端以 `pnpm deploy --prod` 实际复制的物理目录为边界，包含未加载的可选包及嵌套打包的依赖；不按运行时可达性排除旧上传 / COS 依赖。
- 根 `LICENSE`、WeMD MIT 原文与 [服务端来源说明](../../LICENSES/distribution/server-scope.txt) 分别保留。服务端包元数据指向根许可；这不把上游、过渡基线前内容或混合文件整体转换成 RadishInk 原创。
- [npm 补充来源](../../LICENSES/distribution/npm-sources.json) 固定包版本、已发布 README / 元数据摘要和补充文本摘要。`@tokenizer/token` 与 `assert-plus` 使用已发布的完整许可段落；`@epic-web/invariant` 保留已发布作者署名与 MIT 声明，另附 SPDX 固定版本的 MIT 授权及免责原文，明确标作组合声明，不伪称上游提供了 LICENSE 文件，不推定版权年份或新授权。
- [原生源码目录](../../LICENSES/distribution/native-sources.json) 固定 Sharp/libvips 的组件版本、归档 URL / SHA-256、构建配方、补丁，以及 librsvg 锁文件中的 Rust 包 checksum。通知副本记录其原始归档成员和原文摘要；只统一 UTF-8、LF、展示缩进、尾空白和末尾换行，完整归档保留原字节及源码头部署名。
- 源码采用保守的超集，包含部分构建、测试及其他平台依赖。通知出现不表示该组件一定链接进最终二进制。少数 Rust 源码包没有独立许可文件，保留发布的 `Cargo.toml` 署名 / 许可声明和完整源码，另附标准条款，不制造上游版权声明。

## 生成和核验

使用项目 Node / pnpm，无新增项目依赖。显式下载约 207 MiB 的固定源码归档至 Git 忽略的 `output/distribution/sources/`：

```sh
mise exec -- pnpm prepare:image-sources
mise exec -- pnpm check:source-notices
```

第一条只接受目录中摘要正确的缓存或下载结果；缓存损坏直接失败，不自动覆盖或换来源。并发下载有超时，失败清理半成品并等待其他请求退出。第二条使用系统 `tar` 对照归档成员的原始 SHA-256 并重新派生通知；不执行归档里的代码。`mise exec -- pnpm check:source-notices --write` 可从同一输入重新生成通知副本；全部原文及派生摘要通过后才写入。

下载入口使用 Node 22.21+ 的 `--use-env-proxy`，按已有 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 访问网络，不打印代理值或修改全局设置。Docker 构建在需要代理时使用其标准代理 build args，不将代理写入镜像环境或源码；没有代理时按正常网络访问。该开关及兼容范围见 [Node 官方说明](https://nodejs.org/learn/http/enterprise-network-configuration)。Node 22 可能报告代理实现的实验性警告，保留该警告。

服务端 Dockerfile 自动执行相同的源码下载校验和声明生成，使用 BuildKit 的 `radishink-native-sources` 缓存，不要求预先准备宿主目录。归档获取失败、许可缺失 / 空白、补充证据漂移、原生组件版本变化或锁定源码不齐均使构建失败。Web 继续使用既有声明生成器，并保留基础镜像材料。

```sh
docker buildx build --platform linux/arm64 --load -f apps/server/Dockerfile -t radishink-server-review .
docker buildx build --platform linux/arm64 --load -f Dockerfile -t radishink-web-review .
mise exec -- pnpm check:image-distribution --server radishink-server-review --web radishink-web-review
```

amd64 使用独立镜像名重复构建和核验。最终核验以无网络、只读容器读取实际文件；仅挂载明确列出的公开校验输入，不挂载整个工作区。服务端重新生成预期声明并逐字节比较，同时检查物理包内容摘要、缺件和多余文件。基础通知与最终系统文件另行比较。检查不启动业务服务、监听端口或接触用户卷。

## 镜像内布局

| 位置                                | 内容                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| server `/app/distribution/`         | 项目 / WeMD 许可、服务端来源边界、npm 完整声明、原生通知、源码目录、物理包内容摘要与 `checksums.json` |
| server `/app/distribution/sources/` | 固定原始源码归档、上游构建配方归档和补丁；可离线从镜像提取                                            |
| server `/app/base-distribution/`    | Node 原始 LICENSE、Debian 各安装包版权文本、公共许可全文和精确 source package / version 查询入口      |
| web `/opt/radishink-web/licenses/`  | 既有项目、上游及 Web / core / 静态资产声明                                                            |
| web `/opt/radishink-base/`          | 原始 Nginx / 模块通知、APK 安装库、系统信息、Nginx 构建参数及校验和                                   |

从未启动的临时容器用 `docker cp` 提取 `sources/` 即可得到服务端随附源码；提取后按 `native-sources.json` 校验。提取不启动服务或挂载数据卷，用毕删除自己的临时容器。

## 原生库修改与重建

Sharp addon 动态加载独立的 libvips 共享库。源码归档、组件版本及所有下载补丁同时提供；解开 `sharp-libvips-build.tar.gz`，可查看上游 `build.sh`、`build/posix.sh` 和各平台 Dockerfile。上游入口为 `./build.sh linux-x64` 或 `./build.sh linux-arm64v8`；另有 musl 平台配方，对应镜像中物理存在的可选包。使用修改后的库时保留兼容的共享库名称和 ABI，再验证实际 Sharp 解码 / 编码。

这些是原始构建配方与来源材料，不承诺二进制逐位复现。上游配方使用浮动系统工具和 Rust nightly，并从网络读取部分输入；本轮没有重编整套原生库或验证任意修改版本的 ABI。复用归档时须将上游下载映射到目录中的校验输入，不用当前 `main` 或新的 patch 内容替代已记录版本。第三方库的修改、调试及再分发权利按其自己的许可保留，RadishInk 新许可不限制这些独立权利。

## 基础镜像与发布边界

两份 Dockerfile 继续固定原有基础镜像 digest，不升级系统或依赖。Node 原文包含 Node 及其内置第三方声明；Debian 元数据给出精确源码包版本和 snapshot 查询入口。Nginx 镜像保留供应商原文及 APK 的 origin / commit / 项目地址，可据此追溯 Alpine aports 与供应商配方。**基础材料记录和来源入口不等于已经镜像了所有基础系统源码，也不是源码提供承诺或整个镜像的再分发法律结论。** 正式发布前仍须复核基础系统 / 供应商的对应源码获取与提供方式，并确认镜像中可提取的材料和发布位置满足最终分发方式；不能以 npm 缺件为零替代这一步。

PR 的两个 `Server Quality` 原生架构任务分别构建并核验 Web / server 最终镜像，任何失败传递给 `Candidate Quality`。仓库检查与负向用例同时约束构建接线、最终 COPY、校验步骤和许可元数据。源码通知的归档成员核验另由 `check:source-notices` 执行，需下载缓存和宿主 `tar`，不伪称普通单元测试覆盖了实际归档。

本任务不启用停用的发布工作流，不上传镜像、创建 tag / Release、修改 Ruleset 或部署。下一批的固定版本拉取式 Compose 与部署编排另按 [自托管计划](../planning/self-hosted-storage.md#镜像分发与部署编排) 推进；真实 OIDC、跨物理设备、手机与公众号验收仍单列。
