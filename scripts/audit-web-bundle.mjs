import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  build,
  version as viteVersion,
  rollupVersion,
} from "../apps/web/node_modules/vite/dist/node/index.js";
import { generateWebNotices } from "./generate-web-notices.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".tmp/web-bundle-audit.json");
generateWebNotices(root);
const packageCache = new Map();
function owner(id) {
  const file = id.replace(/^\0/, "").split("?")[0];
  if (!path.isAbsolute(file) || !file.includes("/node_modules/")) return null;
  let directory = path.dirname(file);
  if (packageCache.has(directory)) return packageCache.get(directory);
  const initial = directory;
  while (directory !== path.dirname(directory)) {
    const metadataPath = path.join(directory, "package.json");
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata.name && metadata.version) {
        const result = { name: metadata.name, version: metadata.version };
        packageCache.set(initial, result);
        return result;
      }
    }
    directory = path.dirname(directory);
  }
  packageCache.set(initial, null);
  return null;
}
let report;
await build({
  root: path.join(root, "apps/web"),
  configFile: path.join(root, "apps/web/vite.config.ts"),
  plugins: [
    {
      name: "radishink-license-review-evidence",
      // Vite 在 generateBundle 阶段还会重写预加载引用；在写入阶段记录最终结果。
      writeBundle(_, bundle) {
        const packages = {};
        const chunks = {};
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          chunks[output.fileName] = createHash("sha256")
            .update(output.code)
            .digest("hex");
          for (const [id, module] of Object.entries(output.modules)) {
            const metadata = owner(id);
            if (!metadata) continue;
            const key = `${metadata.name}@${metadata.version}`;
            const entry = (packages[key] ??= {
              renderedLength: 0,
              modules: [],
            });
            entry.renderedLength += module.renderedLength;
            entry.modules.push({
              id: id.replace(root + "/", ""),
              chunk: output.fileName,
              renderedLength: module.renderedLength,
            });
          }
        }
        report = {
          engines: { vite: viteVersion, rollup: rollupVersion },
          lockfileSha256: createHash("sha256")
            .update(fs.readFileSync(path.join(root, "pnpm-lock.yaml")))
            .digest("hex"),
          chunks,
          packages,
        };
      },
    },
  ],
});
if (!report) throw new Error("Build did not produce module evidence");
for (const [file, digest] of Object.entries(report.chunks)) {
  const artifact = fs.readFileSync(path.join(root, "apps/web/dist", file));
  if (createHash("sha256").update(artifact).digest("hex") !== digest) {
    throw new Error(
      `Chunk changed after module evidence was captured: ${file}`,
    );
  }
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  `Recorded ${Object.keys(report.packages).length} package module entries across ${Object.keys(report.chunks).length} verified JS chunks in ${path.relative(root, reportPath)}.`,
);
