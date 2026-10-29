// Read-only inventory of physically distributed pnpm packages in a final server image.
// docker run --rm -i <image> node < scripts/deployment/image-license-inventory.cjs
// This inventory is evidence, not a license-compliance approval or source offer.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const base = "/app/node_modules/.pnpm";
const packages = [];
const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const entry of fs.readdirSync(base).sort()) {
  const modules = path.join(base, entry, "node_modules");
  if (!fs.existsSync(modules)) continue;
  for (const name of fs.readdirSync(modules).sort()) {
    const directories = name.startsWith("@")
      ? fs
          .readdirSync(path.join(modules, name))
          .sort()
          .map((child) => path.join(modules, name, child))
      : [path.join(modules, name)];
    for (const directory of directories) {
      if (
        fs.lstatSync(directory).isSymbolicLink() ||
        !fs.existsSync(path.join(directory, "package.json"))
      )
        continue;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      );
      const texts = fs
        .readdirSync(directory)
        .sort()
        .filter(
          (file) =>
            /^(?:(?:MIT|ISC|BSD|APACHE)[-_.])?(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(
              file,
            ) && fs.statSync(path.join(directory, file)).isFile(),
        );
      const readme = fs
        .readdirSync(directory)
        .find((file) => /^readme(?:\.md)?$/i.test(file));
      packages.push({
        name: manifest.name,
        version: manifest.version,
        license: manifest.license || null,
        directory,
        texts: texts.map((file) => ({
          file,
          sha256: digest(path.join(directory, file)),
        })),
        readme: readme
          ? { file: readme, sha256: digest(path.join(directory, readme)) }
          : null,
      });
    }
  }
}
if (!packages.length) throw new Error("No distributed packages found");
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      packages,
      needsReview: packages
        .filter((item) => !item.texts.length)
        .map(({ name, version, license, directory, readme }) => ({
          name,
          version,
          license,
          directory,
          readme,
        })),
    },
    null,
    2,
  ),
);
