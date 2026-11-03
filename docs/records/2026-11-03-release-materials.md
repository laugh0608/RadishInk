# 2026-11-03 源码伴随包、成对镜像记录与标签检查

## 范围与提交

用户要求提交当前工作区，再补齐基础系统源码提供方式、双镜像成对发布记录和标签不可覆盖检查。开始时复查分支、跟踪关系、暂存区和全部更改；当前编排批以 `2cf53de feat(deploy): 增加固定版本 Compose 与受控维护编排` 本地提交，接续此前的 `4d04bdb`。没有 amend、推送、创建 / 移动 tag、Release、镜像上传或部署；本次接续实现保留为工作区更改。

操作契约统一见[发布材料](../deployment/release-materials.md)，本文只记录实际证据与限制。

## 本地实现与材料

- 使用前轮四个最终本地镜像 `radishink-p4-next-{server,web}-{amd64,arm64}:20261103` 采集基础清单，每架构 server 88 个 Debian 安装包、Web 71 个 APK 安装包。去重得到 128 项源码需求；保留固定 runtime base digest、精确 source version / aports commit、APK 许可、Node 与附带 npm/Corepack/Yarn 的版本和原始通知摘要，以及两种上游容器的启动脚本摘要。生成结果为 `LICENSES/distribution/base-image-plan.json`。
- 明确以公开、永久 HTTPS 下载的完整源码伴随包提供基础源码。生成器验证全量需求、原始文件摘要和大小、Debian `.dsc` 源码集、Alpine 字面 SHA-512 源码 / 补丁集、原始保留通知 / 脚本，以及已有 native 源码目录；材料不齐拒绝写入。可显式使用复核目录下载固定输入，共用原有缓存与失败清理逻辑。
- 伴随包生成内部逐文件清单及可复现的 ustar/gzip 归档，流式验证归档，不解包执行。源代码、配方、补丁、通知、重建说明与各自许可分别保留。
- 成对收集器从 Registry 只读取得两 index、四个平台 manifest / config，核对内容 digest、descriptor 大小与类型、平台、非 root 用户、同 tag / revision / source，以及相同 config 的本地最终镜像基础清单。源码目录与归档通过后才生成成对记录和两个平台的部署 lock。 Docker containerd 的 `inspect.Id` 可能是 index digest，不能直接当作 config digest；现代存储以平台 manifest Descriptor 绑定，经典存储核对 config ID 与精确 RepoDigest，两者均比较 RootFS diff IDs 和平台。
- 成对记录 CLI 另检查已有 Git tag 的实际提交、当前 HEAD、提交内版本 / 轨道及工作区干净；annotated tag 先解引用到 commit，不创建或移动 tag。实际 `v26.10.2-dev` 指向历史代码，与本轮 HEAD 不同，不能借 Registry 缺失同名镜像复用该标识。
- 完整 tag 检查区分明确缺失、相同 digest 复用与冲突。权限、网络、tag 查询重定向、代理 404、限流及畸形响应均失败；重试重新检查两个仓库。发布前入口另核验公开源码包的实际下载字节。工具没有 Registry 写接口。
- 停用 Docker 模板移除 GHCR 登录、写权限与直接 push，仅导出 OCI 候选。活动 CI 新增实际基础清单检查，仓库治理与负向用例约束相同入口；发布工作流白名单不变。

采集容器均只读、无网络、无业务端口、无数据卷；没有启动后台服务。未安装工具、更新项目依赖或基础镜像。研究文件和生成缓存仅在忽略的 `output/distribution/base/`，无凭据或真实文章进入 Git。

## 验证

- `mise exec -- pnpm validate:web`：通过；core 64、Web 802 项，构建通过。保留既有 12 条 ESLint warning、Baseline 数据陈旧、highlight.js 弃用及 Vite 混合导入 / chunk 提示。
- `mise exec -- pnpm validate:server`：通过；10 个 suite / 116 项，含最新编译产物。没有业务源码变更。
- `mise exec -- pnpm test:governance`：132 项通过，含新增 22 项发布材料 / Registry 用例与 3 项治理负向变异。
- `check:source-notices` 再次核验 760 个真实归档通知成员；两个架构分别重跑 `check:image-distribution`，每个 server 核对 207 个实际物理包和 391 个源码输入，基础通知及 Sharp / SQLite / Argon2 smoke 通过。
- 实际仓库以历史 `v26.10.2-dev` 与本轮 HEAD 调用记录 CLI，先报 Git tag / revision 不同，stdout 为空，未访问 Registry 或输出记录。
- 对实际 128 项计划传入空 provision，明确报缺少 128 项，未输出发布伴随包；不将现有 native 输入当作基础系统源码已经齐备。
- 两个架构分别运行 `check:base-image-plan --server ... --web ...`：与复核清单一致。amd64 在本机模拟执行；不冒充原生远程 CI。
- 当前工作区重建 `radishink-p4-materials-{server,web}-{amd64,arm64}:20261103` 四个候选均通过；两个架构再次运行最终镜像分发核验与基础清单比较，均通过。没有发布这些本地候选；完整部署 smoke 仍沿用前轮证据，本批没有修改业务 / Compose 编排。
- 另构建无 provenance 的临时单平台 Web 包装镜像，从 Docker save 取得真实 manifest / config 字节并核对内容 digest，使用默认采集器验证真实本地 Descriptor、RootFS 与源码清单绑定；故意用 index 代替平台 manifest 被拒绝。该临时镜像和导出目录已删除，未接触远端仓库。
- 源码包合成完整输入实际生成目录及两份归档，SHA-256 相同；标准 `tar -tzf` 可读取。损坏、截断、越界成员、软链接类型、额外目录文件和修改后的源文件均拒绝。
- 通过实际 loopback HTTP Registry V2 夹具串联两 index / 四 config 收集与 tag 检查；另验证 401/403/429/500、重定向、代理 404、响应内容 / header digest 错误。另验证 config blob 的限定域跳转及不转发认证头；夹具为合成材料，不是真实 GHCR 已发布记录。

## 尚未取得的证据与接续

128 项基础系统需求的完整 `base-provision.json` 与源码文件尚未收齐；本轮没有生成可用于实际镜像发布的完整伴随包或正式 `release-pair.json`。生成器的正向证据使用合成输入；实际清单仅证明识别了当前需求。下一步逐项收齐并复核 Debian / Alpine / Nginx 供应商和 Node 附带工具的完整源码集、嵌入依赖、配方与通知，再生成实际归档并验证公开下载。

远端不可覆盖、受限写权限与串行发布边界尚未配置或实测。只读检查与写入之间存在竞态；它不能保证跨仓库原子发布，也不能替代服务端保护。成对发布接线必须先处理这些条件，复核两完整 tag 后才更新别名、宣布版本可用。

没有运行本轮远程 CI、真实 GHCR 候选 / 公开源码地址、浏览器、真实 OIDC、公众号、手机、物理断电或跨物理设备验收。上述事项与本地基线、生成器测试分开记录；本轮工具与模板准备不授权外部发布。
