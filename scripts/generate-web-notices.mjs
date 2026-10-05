import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "apps/web/public");
const seen = new Set();
const packages = new Map();
const supplementalSources = JSON.parse(
  fs.readFileSync(
    path.join(publicDir, "licenses/package-sources/sources.json"),
    "utf8",
  ),
);

function resolvePackage(from, name) {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return fs.realpathSync(candidate);
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function visit(directory) {
  if (seen.has(directory)) return;
  seen.add(directory);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  if (directory.includes(`${path.sep}node_modules${path.sep}`)) {
    const files = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (file) =>
          file.isFile() &&
          /^(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(file.name),
      )
      .map((file) => file.name)
      .sort();
    packages.set(`${metadata.name}@${metadata.version}`, {
      metadata,
      directory,
      files,
    });
  }
  const dependencies = {
    ...metadata.dependencies,
    ...metadata.optionalDependencies,
    ...metadata.peerDependencies,
  };
  for (const name of Object.keys(dependencies).sort()) {
    const dependency = resolvePackage(directory, name);
    if (dependency) visit(dependency);
    else if (
      metadata.dependencies?.[name] &&
      !metadata.optionalDependencies?.[name]
    ) {
      throw new Error(
        `Missing installed dependency: ${metadata.name} -> ${name}`,
      );
    }
  }
}

visit(path.join(root, "apps/web"));
visit(path.join(root, "packages/core"));
const sortedPackages = [...packages.values()].sort((a, b) =>
  `${a.metadata.name}@${a.metadata.version}`.localeCompare(
    `${b.metadata.name}@${b.metadata.version}`,
    "en",
  ),
);
const text = [
  "RadishInk Web — third-party notices",
  "Generated from installed Web/core production dependencies and their installed peers.",
  "This is a distribution notice inventory, not a declaration that every dependency is bundled.",
  "Packages without a standalone license text are explicitly listed for release review; this inventory is not a completed license audit.",
  "Regenerate after dependency changes: node scripts/generate-web-notices.mjs",
  "",
];
const review = [];
for (const { metadata, directory, files } of sortedPackages) {
  text.push(
    "=".repeat(72),
    `${metadata.name}@${metadata.version}`,
    `License: ${metadata.license || "See text below"}`,
    "",
  );
  const source =
    supplementalSources.packages[`${metadata.name}@${metadata.version}`];
  if (files.length === 0 && source) {
    const licenseText = fs.readFileSync(
      path.join(publicDir, "licenses/package-sources", source.file),
    );
    if (
      createHash("sha256").update(licenseText).digest("hex") !== source.sha256
    ) {
      throw new Error(`Supplemental license hash mismatch: ${source.file}`);
    }
    text.push(`Source: ${source.url}`, licenseText.toString("utf8").trim(), "");
  } else if (files.length === 0) {
    review.push(`${metadata.name}@${metadata.version}`);
    text.push(
      "No standalone license file in the installed package. Review before distribution.",
      `Published author metadata: ${JSON.stringify(metadata.author ?? metadata.contributors ?? "Not provided")}`,
      `Repository: ${JSON.stringify(metadata.repository ?? "Not provided")}`,
      "",
    );
    const readme = fs
      .readdirSync(directory)
      .find((file) => /^readme(?:\.|$)/i.test(file));
    if (readme)
      text.push(
        `--- Published ${readme} ---`,
        fs.readFileSync(path.join(directory, readme), "utf8").trim(),
        "",
      );
  }
  for (const file of files) {
    text.push(
      `--- ${file} ---`,
      fs.readFileSync(path.join(directory, file), "utf8").trim(),
      "",
    );
  }
}
text.push(
  "=".repeat(72),
  "Standalone license text still requiring release review:",
  ...review,
  "",
);
for (const [label, file] of [
  ["Maple Mono", "fonts/maple-mono/LICENSE"],
  ["Space Grotesk", "fonts/space-grotesk/OFL.txt"],
  ["JetBrains Mono", "fonts/jetbrains-mono/OFL.txt"],
  ["MathJax 3.2.2", "libs/mathjax/LICENSE"],
]) {
  text.push(
    "=".repeat(72),
    label,
    "",
    fs.readFileSync(path.join(publicDir, file), "utf8").trim(),
    "",
  );
}
fs.mkdirSync(path.join(publicDir, "licenses"), { recursive: true });
fs.copyFileSync(
  path.join(root, "LICENSE"),
  path.join(publicDir, "licenses/WeMD-LICENSE.txt"),
);
fs.writeFileSync(
  path.join(publicDir, "licenses/third-party-notices.txt"),
  `${text
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+$/gm, "")
    .trim()}\n`,
);
console.log(
  `Generated Web notices for ${packages.size} installed packages and 4 bundled assets; ${review.length} packages require license text review before distribution.`,
);
