import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { digest } from "./materials.mjs";

// This records retained upstream base-image notices and source lookup identities.
// It does not replace the separate publication review of base-image redistribution.
const output = process.argv[2];
if (!output || !path.isAbsolute(output))
  throw new Error("An absolute output directory is required");
const packages = execFileSync(
  "dpkg-query",
  ["-W", "-f=${Package}\t${Version}\t${source:Package}\t${source:Version}\n"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .map((line) => {
    const [name, version, source, sourceVersion] = line.split("\t");
    const copyright = fs.readFileSync(`/usr/share/doc/${name}/copyright`);
    if (!copyright.toString("utf8").trim())
      throw new Error(`Missing base copyright: ${name}`);
    fs.mkdirSync(path.join(output, "debian"), { recursive: true });
    fs.writeFileSync(
      path.join(output, "debian", `${name}-copyright`),
      copyright,
    );
    return {
      name,
      version,
      source,
      sourceVersion,
      copyrightSha256: digest(copyright),
      sourceIndex: `https://snapshot.debian.org/package/${encodeURIComponent(source)}/${encodeURIComponent(sourceVersion)}/`,
    };
  });
fs.writeFileSync(
  path.join(output, "node-LICENSE"),
  fs.readFileSync("/usr/local/LICENSE"),
);
fs.cpSync("/usr/share/common-licenses", path.join(output, "common-licenses"), {
  recursive: true,
  dereference: true,
});
fs.writeFileSync(
  path.join(output, "components.json"),
  `${JSON.stringify({ node: { version: process.version, source: `https://nodejs.org/dist/${process.version}/node-${process.version}.tar.xz`, licenseSha256: digest(fs.readFileSync("/usr/local/LICENSE")) }, packages }, null, 2)}\n`,
);
