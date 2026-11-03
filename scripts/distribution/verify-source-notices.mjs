import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { catalog, checked, digest, inside } from "./materials.mjs";

const normalize = (bytes) =>
  `${bytes
    .toString("utf8")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .trimEnd()
        .replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, "        ")),
    )
    .join("\n")
    .trim()}\n`;

export function verifySourceNotices(root, sources, write = false) {
  const native = catalog(root, { checkNotices: !write });
  let count = 0;
  const generated = [];
  for (const source of native.sources) {
    checked(sources, source.file, source.sha256);
    for (const notice of source.notices ?? []) {
      const parts = [];
      for (const member of notice.members) {
        if (
          member.path.startsWith("-") ||
          member.path.split("/").some((part) => part === "..") ||
          path.isAbsolute(member.path)
        )
          throw new Error(`Invalid source archive member: ${member.path}`);
        const bytes = execFileSync(
          "tar",
          ["-xOf", inside(sources, source.file), member.path],
          { maxBuffer: 32 * 1024 * 1024 },
        );
        if (digest(bytes) !== member.sha256)
          throw new Error(
            `Source notice evidence changed: ${source.id}/${member.path}`,
          );
        // Eleven source archives omit standalone license files.
        // Preserve the reviewed metadata notice rather than invent upstream text.
        if (!member.metadataOnly)
          parts.push(`--- ${member.path} ---\n${normalize(bytes)}`);
        else
          parts.push(
            `No standalone license file was published in this archive.\nPublished package attribution and license declaration from Cargo.toml:\n${JSON.stringify(notice.publishedMetadata, null, 2)}\nFull standard terms are included in native-notices.txt. No copyright year or ownership is inferred.\n`,
          );
        count++;
      }
      const bytes = Buffer.from(parts.join("\n"));
      if (digest(bytes) !== notice.sha256)
        throw new Error(`Extracted source notice drift: ${source.id}`);
      if (write) generated.push([inside(root, notice.file), bytes]);
      else if (!bytes.equals(checked(root, notice.file, notice.sha256)))
        throw new Error(`Source notice file drift: ${source.id}`);
    }
  }
  for (const [file, bytes] of generated) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return count;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string", default: "." },
        sources: { type: "string", default: "output/distribution/sources" },
        write: { type: "boolean" },
      },
    });
    console.log(
      `Verified ${verifySourceNotices(values.root, values.sources, values.write)} source notice members`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
