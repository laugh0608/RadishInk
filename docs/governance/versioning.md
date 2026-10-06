# 版本、Git tag 与 Docker 镜像规则

本页是 RadishInk 从 2026-10-05 起新增发布标识的规则来源，参考 [Radish 版本治理](https://github.com/laugh0608/Radish/blob/master/Docs/guide/version-governance.md)及其 [Docker 工作流](https://github.com/laugh0608/Radish/blob/master/.github/workflows/docker-images.yml)。当前发布状态见 [当前状态](../status/current.md)。

## 产品版本与 Git tag

产品版本采用日历版本 `YY.M.RELEASE`：

- `YY`：年份后两位。
- `M`：月份 `1-12`，不补零。
- `RELEASE`：当月发布序号，从 `1` 起递增，不补零；月份变化后重新从 `1` 开始。
- 版本数字用于识别发布，不替代数据、存储和接口兼容性说明。

当前产品版本来源为根目录 [version.json](../../version.json)：`version` 保存三段产品版本，`track` 保存发布轨道。用户暂定首个开发版本为 `26.10.1` / `dev`；Web 左下角及「关于」弹窗通过同一模块读取并显示 `v26.10.1-dev`，后续调整只修改该文件。不读取上游 package 版本，也不依赖网络获取版本；源码中的展示标识不表示已创建对应 tag、镜像或 Release。

新增 Git tag 必须带 `v` 前缀和发布轨道：

```text
vYY.M.RELEASE-(dev|test|release)
vYY.M.RELEASE.DDXX-(dev|test|release)
```

可选的 `DDXX` 用于区分候选构建或热更新，`DD=01-31`，`XX=01-99`，均为两位；同一天的区分序号递增。它只扩展 Git / Docker 标识，产品版本仍为三段式。与 Radish 一致，命名检查验证字段范围，不据此推断真实构建日期或发布时间。完整标签长度不超过 Docker 的 128 字符上限。

| 轨道      | 用途     | 示例（非已发布版本） |
| --------- | -------- | -------------------- |
| `dev`     | 开发验证 | `v26.10.1-dev`       |
| `test`    | 测试候选 | `v26.10.1.0501-test` |
| `release` | 正式发布 | `v26.10.1-release`   |

不再新增上游式 `v1.4.7`、无轨道 `v26.10.1`、补零月份 `v26.01.1-test` 或 `beta` / `rc` 等其他轨道。测试晋级正式版时创建新的 `-release` tag，不移动测试 tag 或把原 Pre-release 改写为正式 Release。

## Docker 镜像标识

未来 Web 镜像仓库为 `ghcr.io/laugh0608/radishink-web`。完整版本标签必须与 Git tag 逐字相同，保留 `v`、可选扩展与轨道后缀；OCI 标签 `org.opencontainers.image.version` 也写同一完整 tag。

| Git tag 轨道 | 固定镜像标签         | 成功发布后更新的浮动别名   |
| ------------ | -------------------- | -------------------------- |
| `dev`        | 原样使用完整 Git tag | `dev-latest`               |
| `test`       | 原样使用完整 Git tag | `test-latest`              |
| `release`    | 原样使用完整 Git tag | `release-latest`、`latest` |

例如正式镜像为 `ghcr.io/laugh0608/radishink-web:v26.10.1-release`。只有正式轨道可更新 `latest`，不从普通分支 push 生成 `main`、分支名或 `sha-*` 发布版本，也不把本地 `:local` 构建当成发布产物。SHA 可用作追溯元数据，不能替代完整版本标签。

固定版本标签发布后不得指向其他内容；重试须确认现有产物一致。生产部署固定完整 tag 或 digest，浮动别名只用于发现版本，不用作可复现部署依据。

## 本地检查与停用模板

创建未来 tag 前，在目标提交上运行只读命名检查：

```bash
mise exec -- pnpm check:release-tag --tag v26.10.1.0501-test
```

该命令只输出解析结果、镜像标签与 OCI 版本字段，不创建 tag、不访问网络、不构建或推送镜像。无 tag、旧格式或非法字段退出非零。它不遍历或否定历史 tag，也不宣称已经验证版本序号、日期与实际发布记录一致。

实现为 [release-metadata.mjs](../../scripts/release-metadata.mjs)，测试通过 `pnpm test:governance` 接入现有 Repo Hygiene。停用目录内的 [Docker 模板](../../.github/workflows-disabled/docker-image.yml) 在登录 GHCR 前调用同一脚本，使用它生成的标签与 OCI 字段，不再保留上游分支 / SHA 标签生成逻辑。

[docker-compose.yml](../../docker-compose.yml) 已指向未来 RadishInk 镜像，要求显式设置 `RADISHINK_IMAGE_TAG`，不默认拉取上游 `latest`。未来镜像真实存在后才可使用以下示例：

```bash
export RADISHINK_IMAGE_TAG=v26.10.1-release
mise exec -- pnpm check:release-tag --tag "$RADISHINK_IMAGE_TAG"
docker compose config
# 确认镜像存在且获准启动后，再执行 docker compose up -d
```

原 `WEMD_PORT` 变量暂时保留以兼容本地端口配置。Compose 的环境变量插值仅检查非空，格式由前置命名检查验证；不应传入 `latest`。此处调整不表示镜像已发布，也不启动容器。

## 首次发布前的准备

当前已建立产品版本来源并暂定首个开发版本，尚未分配首个 `release` 轨道版本。源码内继承的 WeMD package 版本不是 RadishInk 发布依据，不批量重写。

实际恢复发布时必须在独立变更中：

1. 根 `version.json` 与 Web 展示已统一；恢复发布前补齐参与发布的包同步规则及 tag 与源码版本、轨道一致性校验，不复制兄弟项目无关的 Flutter、Rust 或后端字段。
2. 为正式 tag 准备随候选提交保存的发布记录，记录完整 Git tag、产品版本、镜像 tag / digest、实际验证和回滚目标，不预写部署成功。
3. 完成产品品牌、来源许可、外部请求、质量门禁、镜像构建与发布权限配置；补齐 tag 不可覆盖及发布重试约束。
4. 若启用 GitHub Release，`test` 为 Pre-release 且不占用 Latest，`release` 为正式 Latest，`dev` 不创建 Release；只能复用已存在 tag，不隐式创建或移动。
5. 获得对应发布授权后再调整活动工作流白名单并恢复工作流；创建 tag、推送、发布与部署分别按已授权范围执行。

当前 `.github/workflows/` 仍只允许 CI。Docker 文件是停用中的命名模板，尚未接入上述完整发布前置条件；桌面发布文件仅为上游归档，恢复时也必须接入本规则。不能把模板移回活动目录就宣称发布流程可用。

## 历史边界

既有 Git tag、提交、已发布镜像与上游归档均保留，不重命名、不删除、不移动其目标。新规则只约束后续创建的发布标识；旧版本格式可用于历史追溯，不继续作为新发布示例。远程 tag 保护、镜像保留规则和发布权限只有实际配置后才生效，本地文档不代表远程已启用。
