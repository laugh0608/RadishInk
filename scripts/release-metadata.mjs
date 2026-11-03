import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";

export const IMAGE_NAME = "ghcr.io/laugh0608/radishink-web";
export const SERVER_IMAGE_NAME = "ghcr.io/laugh0608/radishink-server";
const tagPattern =
  /^v(?<productVersion>[0-9]{2}\.(?:[1-9]|1[0-2])\.[1-9][0-9]*)(?:\.(?<build>(?:0[1-9]|[12][0-9]|3[01])(?:0[1-9]|[1-9][0-9])))?-(?<track>dev|test|release)$/;

export function releaseMetadata(tag, component = "web", revision) {
  if (!["web", "server"].includes(component))
    throw new Error("component 只支持 web 或 server");
  if (revision !== undefined && !/^[a-f0-9]{40}$/.test(revision))
    throw new Error("revision 必须为完整小写 Git SHA");
  const match = typeof tag === "string" && tag.match(tagPattern);
  if (!match || match[0] !== tag || tag.length > 128) {
    throw new Error(
      "新 tag 必须为 vYY.M.RELEASE-(dev|test|release) 或 vYY.M.RELEASE.DDXX-(dev|test|release)；月份与发布序号不补零，DD=01-31，XX=01-99，最长 128 字符",
    );
  }
  const { productVersion, build, track } = match.groups;
  const image = component === "web" ? IMAGE_NAME : SERVER_IMAGE_NAME;
  const aliases = [`${track}-latest`];
  if (track === "release") aliases.push("latest");
  return {
    tag,
    productVersion,
    build: build ?? null,
    track,
    image,
    aliases,
    tags: [tag, ...aliases].map((value) => `${image}:${value}`),
    labels: {
      "org.opencontainers.image.version": tag,
      "org.opencontainers.image.source":
        "https://github.com/laugh0608/RadishInk",
      ...(revision ? { "org.opencontainers.image.revision": revision } : {}),
    },
  };
}

export function githubOutput(metadata) {
  return [
    `tag=${metadata.tag}`,
    `product-version=${metadata.productVersion}`,
    `track=${metadata.track}`,
    "tags<<RADISHINK_TAGS",
    ...metadata.tags,
    "RADISHINK_TAGS",
    "labels<<RADISHINK_LABELS",
    ...Object.entries(metadata.labels).map(([key, value]) => `${key}=${value}`),
    "RADISHINK_LABELS",
    "",
  ].join("\n");
}

function main() {
  const { values } = parseArgs({
    options: {
      tag: { type: "string" },
      component: { type: "string", default: "web" },
      revision: { type: "string" },
      "source-version": { type: "string" },
      format: { type: "string", default: "json" },
    },
  });
  if (!["json", "github"].includes(values.format)) {
    throw new Error("format 只支持 json 或 github");
  }
  const metadata = releaseMetadata(
    values.tag,
    values.component,
    values.revision,
  );
  if (values["source-version"]) {
    const source = JSON.parse(readFileSync(values["source-version"], "utf8"));
    if (
      metadata.productVersion !== source.version ||
      metadata.track !== source.track
    )
      throw new Error("tag 与源码 version.json 的版本或轨道不一致");
  }
  process.stdout.write(
    values.format === "github"
      ? githubOutput(metadata)
      : `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
