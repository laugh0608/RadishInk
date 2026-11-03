import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { releaseMetadata } from "../release-metadata.mjs";
import {
  releaseLock,
  REPOSITORIES,
  SOURCE,
} from "../deployment/release-config.mjs";
import {
  INDEX_TYPES,
  MANIFEST_TYPES,
  validDigest,
  registryClient,
  immutableTagCheck,
} from "./registry.mjs";
import { collectInventory } from "./base-inventory.mjs";
import { verifySourceBundle } from "./source-bundle.mjs";
import { verifySourceArchive } from "./source-archive.mjs";
import { fetchPinnedSources } from "./materials.mjs";

export const platforms = ["linux/amd64", "linux/arm64"];
export function verifyGitSource(root, tag, revision) {
  const metadata = releaseMetadata(tag, "web", revision);
  if (!revision || /^0+$/.test(revision))
    throw new Error("Full source revision required");
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let target, head, version;
  try {
    target = git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
    head = git(["rev-parse", "HEAD"]);
    version = JSON.parse(git(["show", `${revision}:version.json`]));
  } catch {
    throw new Error(
      "Existing Git tag and committed source version are required; no tag is created",
    );
  }
  if (target !== revision || head !== revision)
    throw new Error(
      "Git tag/checkout differs from candidate revision; moving tags is forbidden",
    );
  if (
    version.version !== metadata.productVersion ||
    version.track !== metadata.track
  )
    throw new Error("Git tag differs from committed product version/track");
  if (git(["status", "--porcelain", "--untracked-files=normal"]))
    throw new Error(
      "Release records require a clean source checkout (ignored material caches are allowed)",
    );
}
export function pairRecord(value) {
  if (
    value.formatVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(value.revision) ||
    /^0+$/.test(value.revision)
  )
    throw new Error("Invalid release pair identity");
  const metadata = releaseMetadata(value.tag);
  if (
    metadata.productVersion !== value.productVersion ||
    metadata.track !== value.track
  )
    throw new Error("Release pair version/track mismatch");
  for (const component of ["web", "server"]) {
    const image = value.images?.[component];
    if (
      !image ||
      image.repository !== REPOSITORIES[component] ||
      Object.keys(image.platforms ?? {})
        .sort()
        .join() !== platforms.join()
    )
      throw new Error(`Incomplete paired image: ${component}`);
    validDigest(image.digest);
    for (const platform of platforms) {
      validDigest(image.platforms[platform].digest);
      validDigest(image.platforms[platform].config);
    }
    if (
      image.platforms[platforms[0]].digest ===
      image.platforms[platforms[1]].digest
    )
      throw new Error("Two architectures cannot share a platform manifest");
  }
  const material = value.sources;
  if (
    !material ||
    !/^[a-f0-9]{64}$/.test(material.manifestSha256) ||
    /^0+$/.test(material.manifestSha256) ||
    material.archive?.file !== `radishink-sources-${value.tag}.tar.gz` ||
    !/^[a-f0-9]{64}$/.test(material.archive?.sha256) ||
    /^0+$/.test(material.archive.sha256) ||
    !Number.isSafeInteger(material.archive.size) ||
    material.archive.size <= 0
  )
    throw new Error("Missing complete source companion identity");
  const sourceUrl = new URL(material.url);
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.search ||
    sourceUrl.hash ||
    decodeURIComponent(sourceUrl.pathname.split("/").at(-1)) !==
      material.archive.file
  )
    throw new Error(
      "Source companion needs a permanent public HTTPS download URL",
    );
  return value;
}

export function deploymentLocks(record) {
  pairRecord(record);
  return Object.fromEntries(
    platforms.map((platform) => {
      const value = {
        formatVersion: 1,
        tag: record.tag,
        revision: record.revision,
        platform,
        images: Object.fromEntries(
          ["web", "server"].map((component) => [
            component,
            { digest: record.images[component].platforms[platform].digest },
          ]),
        ),
      };
      releaseLock(value);
      return [platform.split("/")[1], value];
    }),
  );
}

export async function collectPair({
  tag,
  revision,
  sourceVersion,
  digests,
  sources,
  sourceUrl,
  client,
  inventory = collectInventory,
}) {
  const metadata = releaseMetadata(tag, "web", revision);
  if (
    !revision ||
    /^0+$/.test(revision) ||
    metadata.productVersion !== sourceVersion.version ||
    metadata.track !== sourceVersion.track
  )
    throw new Error("Pair tag/revision differs from source version");
  if (!sources?.plan || !/^[a-f0-9]{64}$/.test(sources.manifestSha256))
    throw new Error("Verified complete source bundle required");
  const images = {};
  for (const component of ["web", "server"]) {
    const repository = `laugh0608/radishink-${component}`;
    const index = await client.manifest(
      repository,
      validDigest(digests[component]),
    );
    if (!INDEX_TYPES.includes(index.json.mediaType))
      throw new Error(`Require multiarch index: ${component}`);
    const manifests = index.json.manifests;
    if (!Array.isArray(manifests)) throw new Error("Invalid index members");
    const children = {};
    for (const descriptor of manifests) {
      const platform = `${descriptor.platform?.os}/${descriptor.platform?.architecture}`;
      // BuildKit attestations are explicitly recognized; other extra platforms fail.
      if (
        platform === "unknown/unknown" &&
        descriptor.annotations?.["vnd.docker.reference.type"] ===
          "attestation-manifest"
      )
        continue;
      if (
        !platforms.includes(platform) ||
        children[platform] ||
        (descriptor.platform.variant &&
          !(platform === "linux/arm64" && descriptor.platform.variant === "v8"))
      )
        throw new Error(
          `Unexpected/duplicate index platform: ${component}/${platform}`,
        );
      const manifest = await client.manifest(
        repository,
        validDigest(descriptor.digest),
      );
      if (
        !MANIFEST_TYPES.includes(manifest.json.mediaType) ||
        descriptor.size !== manifest.size ||
        descriptor.mediaType !== manifest.json.mediaType
      )
        throw new Error("Platform manifest descriptor mismatch");
      const config = await client.blob(
        repository,
        validDigest(manifest.json.config?.digest),
      );
      if (
        config.size !== manifest.json.config.size ||
        `${config.json.os}/${config.json.architecture}` !== platform
      )
        throw new Error("Platform config descriptor mismatch");
      const labels = config.json.config?.Labels ?? {};
      if (
        labels["org.opencontainers.image.version"] !== tag ||
        labels["org.opencontainers.image.revision"] !== revision ||
        labels["org.opencontainers.image.source"] !== SOURCE
      )
        throw new Error(`Mixed release OCI labels: ${component}/${platform}`);
      const user = config.json.config?.User;
      if (
        !(
          component === "server"
            ? ["node", "1000", "1000:1000"]
            : ["nginx", "101", "101:101"]
        ).includes(user)
      )
        throw new Error(`Unexpected image user: ${component}`);
      const actual = await inventory(
        component,
        `${REPOSITORIES[component]}@${manifest.digest}`,
        { manifest, config },
      );
      const expected = sources.plan.inventories.find(
        (item) => item.component === component && item.platform === platform,
      );
      if (!expected || JSON.stringify(expected) !== JSON.stringify(actual))
        throw new Error(
          `Source companion differs from final image: ${component}/${platform}`,
        );
      children[platform] = { digest: manifest.digest, config: config.digest };
    }
    if (Object.keys(children).sort().join() !== platforms.join())
      throw new Error(`Missing architecture: ${component}`);
    images[component] = {
      repository: REPOSITORIES[component],
      digest: index.digest,
      platforms: Object.fromEntries(
        platforms.map((platform) => [platform, children[platform]]),
      ),
    };
  }
  return pairRecord({
    formatVersion: 1,
    tag,
    revision,
    productVersion: metadata.productVersion,
    track: metadata.track,
    images,
    sources: {
      manifestSha256: sources.manifestSha256,
      archive: sources.archive,
      url: sourceUrl,
    },
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        tag: { type: "string" },
        revision: { type: "string" },
        "source-version": { type: "string", default: "version.json" },
        "web-index": { type: "string" },
        "server-index": { type: "string" },
        sources: { type: "string" },
        output: { type: "string" },
        "check-tags": { type: "string" },
        archive: { type: "string" },
        "source-url": { type: "string" },
      },
    });
    const client = registryClient({
      username: process.env.RADISHINK_GHCR_USER,
      password: process.env.RADISHINK_GHCR_TOKEN,
    });
    if (values["check-tags"]) {
      const record = pairRecord(
        JSON.parse(fs.readFileSync(values["check-tags"])),
      );
      verifyGitSource(
        fileURLToPath(new URL("../../", import.meta.url)),
        record.tag,
        record.revision,
      );
      const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "radishink-public-sources-"),
      );
      try {
        await fetchPinnedSources(
          [
            {
              ...record.sources.archive,
              id: "public-source-companion",
              url: record.sources.url,
            },
          ],
          temporary,
        );
        if (
          fs.statSync(path.join(temporary, record.sources.archive.file))
            .size !== record.sources.archive.size
        )
          throw new Error(
            "Published source companion size differs from pair record",
          );
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
      console.log(
        JSON.stringify(await immutableTagCheck(client, record), null, 2),
      );
    } else {
      verifyGitSource(
        fileURLToPath(new URL("../../", import.meta.url)),
        values.tag,
        values.revision,
      );
      const record = await collectPair({
        tag: values.tag,
        revision: values.revision,
        sourceVersion: JSON.parse(fs.readFileSync(values["source-version"])),
        digests: { web: values["web-index"], server: values["server-index"] },
        sources: {
          ...verifySourceBundle(values.sources),
          archive: await verifySourceArchive(values.sources, values.archive),
        },
        sourceUrl: values["source-url"],
        client,
      });
      // Never emit even the first file before both components and the tag guard pass.
      await immutableTagCheck(client, record);
      if (!values.output || fs.existsSync(values.output))
        throw new Error("New --output directory required");
      fs.mkdirSync(values.output);
      fs.writeFileSync(
        path.join(values.output, "release-pair.json"),
        JSON.stringify(record, null, 2) + "\n",
        { flag: "wx" },
      );
      for (const [arch, lock] of Object.entries(deploymentLocks(record)))
        fs.writeFileSync(
          path.join(values.output, `release-lock-${arch}.json`),
          JSON.stringify(lock, null, 2) + "\n",
          { flag: "wx" },
        );
      console.log(
        "Paired release record and two deployment locks verified; no publication performed",
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
