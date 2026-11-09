# 2026-11-09 Debian 基础源码首批复核

## 首批材料

按实际 Server 镜像的 Debian 源码包身份收集，首批复核 `acl`、`adduser`、`attr`、`base-files`、`bzip2`、`dash` 和 `zlib`，共 7 项、21 个原始文件、3,467,799 字节。清单固定逐文件下载地址、大小和 SHA-256，并记录每项材料用途、版权通知和重建入口。[镜像复核计划](../../LICENSES/distribution/base-image-plan.json) · [首批复核清单](2026-11-09-debian-source-provision.json)

逐项比对 Debian Snapshot 的源码包版本及文件身份，保留带签名的原始 `.dsc`、其 SHA-256 清单列出的全部文件，以及 `acl`、`attr` 的独立上游签名。读取归档中的 `debian/copyright`、`debian/rules` 和 `debian/patches/series`，确认五个 quilt 包列出的 41 项补丁均在原归档。保留 `zlib` 的 Debian DFSG 重打包原件及其中的 `contrib/minizip` 源码。加入 `base-files` 是为了保留 `adduser` 版权文件引用的 GPL-2 全文，其原始归档的 `licenses/GPL-2` 随包提供。[Debian Snapshot](https://snapshot.debian.org/) · [Debian 源码包工具](https://manpages.debian.org/bookworm/dpkg-dev/dpkg-source.1.en.html)

## 扩大收集

按 Snapshot 的精确包版本索引和 `.dsc` 收齐 63 项 Debian 输入，共 203 个原始文件、262,775,648 字节。按完整版本匹配 epoch，按 Debian 归档实际名称下载，逐项核对 `.dsc` 的源码身份和文件清单，再离线复查缓存的 SHA-256 与大小。缓存位于 Git 忽略的 `output/distribution/base/sources/debian/`，逐包索引和收集元数据分别位于 `output/distribution/base/research/debian/snapshot/` 和 `output/distribution/base/research/debian/collected/`。

`gcc-12` 的 87,090,343 字节原始归档在批量收集的 40 秒单文件时限内未完成。改用 Debian 镜像的同名归档延长下载时限，核对 Snapshot 文件身份、`.dsc` 的 SHA-256 和文件大小后入缓存。[GCC 原始归档](https://deb.debian.org/debian/pool/main/g/gcc-12/gcc-12_12.2.0.orig.tar.gz)

其余 56 项 Debian 输入已完成文件校验，版权、补丁、配方、嵌入依赖和重建入口待逐项复核。另有 65 项 Alpine / Nginx 供应商、Node 附带工具和启动配方待收集与复核。完整 `base-provision.json` 和真实伴随包仍是后续验收项。

## 验证

用项目现有的固定源码下载器在空临时目录重取首批 21 个文件，逐文件核对 SHA-256，并复核总字节数。在项目根目录可用下列命令按首批清单重取或核对本地缓存。

```sh
mise exec -- node --use-env-proxy --input-type=module <<'JS'
import fs from "node:fs";
import { fetchPinnedSources } from "./scripts/distribution/materials.mjs";

const provision = JSON.parse(fs.readFileSync("docs/records/2026-11-09-debian-source-provision.json"));
const files = provision.entries.flatMap((entry) =>
  entry.files.map((file) => ({ ...file, id: file.file })),
);
const directory = "output/distribution/base/sources";
await fetchPinnedSources(files, directory);
for (const file of files) {
  if (fs.statSync(`${directory}/${file.file}`).size !== file.size)
    throw new Error(`Source size mismatch: ${file.file}`);
}
console.log(`Verified ${files.length} files`);
JS
```

- 用 `mise exec -- pnpm prepare:source-bundle` 读取实际 128 项计划与首批清单，检查完七项后明确报告缺少 121 项，目录与归档均未生成。
- 在临时副本上分别缺失 `acl` 上游签名、缺失 `bzip2` 补丁归档、修改 `.dsc` 字节，现有检查分别拒绝缺件和 SHA-256 不符。
- `mise exec -- pnpm test:governance` 通过 132 项测试，`mise exec -- pnpm check:repo`、首批清单与记录的 Prettier 检查及 `git diff --check` 通过。
- 签名原件保留，签名信任链和实际重建待验证。本轮读取归档成员和构建配方，未执行第三方构建脚本。

## 远端与工作区

开工时 `dev` 工作区和暂存区干净。只读查询确认 `origin/dev` 在 `ff74515`，包含 11 月 3 日的三批提交，`origin/main` 仍在 PR #5 的合并提交 `ddd838a`。按 `ff74515` 查询 GitHub Actions 返回空列表，最近一次成功的 `dev` 检查对应 PR #5 候选 `458d539`。本轮写入首批清单、复核记录及相关文档，保留在本地工作区。[PR #5 的成功运行](https://github.com/laugh0608/RadishInk/actions/runs/40884995442)
