// Build two real Vite/Workbox versions from the current source. The fixture-only
// entry marker changes the JS hash and precache manifest, without editing source.
// Capture the historical build as <root>/legacy BEFORE implementation changes.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] || "output/playwright/pwa-builds");
const project = process.cwd();
await mkdir(root, { recursive: true });
for (const version of ["new", "next"]) {
  const config = resolve(root, `${version}.config.mjs`);
  await writeFile(
    config,
    `import config from ${JSON.stringify(resolve(project, "apps/web/vite.config.ts"))};
export default { ...config, plugins: [...config.plugins, {
  name: 'pwa-upgrade-fixture',
  transform(code, id) {
    if (id.endsWith('/src/main.tsx')) return { code: 'document.documentElement.dataset.pwaFixture = ${JSON.stringify(version)};\\n' + code, map: null };
  },
}], build: { ...config.build, outDir: ${JSON.stringify(resolve(root, version))} } };
`,
  );
  const result = spawnSync(
    "mise",
    ["exec", "--", "pnpm", "exec", "vite", "build", "--config", config],
    {
      cwd: resolve(project, "apps/web"),
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
