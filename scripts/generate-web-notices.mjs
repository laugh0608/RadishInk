import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export function isLicenseFilename(filename) {
  return /^(?:(?:MIT|ISC|BSD|APACHE)[-_.])?(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(
    filename,
  );
}

function checkedFile(base, filename) {
  const resolved = path.resolve(base, filename);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error(
      `License source must stay inside its directory: ${filename}`,
    );
  }
  return resolved;
}

export function generateWebNotices(root) {
  root = path.resolve(root);
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
        .filter((file) => file.isFile() && isLicenseFilename(file.name))
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
    "Includes installed license files and reviewed supplemental notices with explicit provenance.",
    "Unresolved missing texts fail generation; this inventory does not replace review of the actual distribution scope.",
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
      for (const [file, digest] of Object.entries(source.packageFiles ?? {})) {
        const published = fs.readFileSync(checkedFile(directory, file));
        if (createHash("sha256").update(published).digest("hex") !== digest) {
          throw new Error(
            `Published license evidence changed: ${metadata.name}@${metadata.version}/${file}`,
          );
        }
      }
      const licenseText = fs.readFileSync(
        checkedFile(
          path.join(publicDir, "licenses/package-sources"),
          source.file,
        ),
      );
      if (
        createHash("sha256").update(licenseText).digest("hex") !== source.sha256
      ) {
        throw new Error(`Supplemental license hash mismatch: ${source.file}`);
      }
      if (!licenseText.toString("utf8").trim()) {
        throw new Error(`Empty license text: ${source.file}`);
      }
      text.push(`Source: ${source.url}`);
      if (source.provenance) text.push(`Provenance: ${source.provenance}`);
      for (const url of source.evidence ?? [])
        text.push(`Additional evidence: ${url}`);
      for (const [file, digest] of Object.entries(source.packageFiles ?? {})) {
        text.push(`Published file: ${file} (SHA-256 ${digest})`);
      }
      text.push("", licenseText.toString("utf8").trim(), "");
    } else if (files.length === 0) {
      review.push(`${metadata.name}@${metadata.version}`);
    }
    for (const file of files) {
      const licenseText = fs
        .readFileSync(path.join(directory, file), "utf8")
        .trim();
      if (!licenseText)
        throw new Error(`Empty license text: ${metadata.name}/${file}`);
      text.push(`--- ${file} ---`, licenseText, "");
    }
  }
  if (review.length > 0) {
    throw new Error(
      `Missing reviewed license text: ${review.join(", ")}. Add version-specific evidence before distribution.`,
    );
  }
  text.push("=".repeat(72), "Missing license text review items: 0", "");
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
  return { packageCount: packages.size, assetCount: 4 };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const { packageCount, assetCount } = generateWebNotices(root);
    console.log(
      `Generated Web notices for ${packageCount} installed packages and ${assetCount} bundled assets; 0 missing license text review items.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
