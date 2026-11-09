import fs from "node:fs";
import path from "node:path";
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
import { validatePlan } from "./source-bundle.mjs";

export const platforms = ["linux/amd64", "linux/arm64"];

function pullInventory(component, image, expected) {
  const { os, architecture } = expected.config.json;
  execFileSync(
    "docker",
    ["pull", "--platform", `${os}/${architecture}`, image],
    {
      stdio: ["ignore", process.stderr, process.stderr],
    },
  );
  return collectInventory(component, image, expected);
}

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
  plan,
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
  validatePlan(plan);
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
      const expected = plan.inventories.find(
        (item) => item.component === component && item.platform === platform,
      );
      if (!expected || JSON.stringify(expected) !== JSON.stringify(actual))
        throw new Error(
          `Reviewed base inventory differs from final image: ${component}/${platform}`,
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
        output: { type: "string" },
        "check-tags": { type: "string" },
        pull: { type: "boolean" },
      },
    });
    const client = registryClient({
      username: process.env.RADISHINK_GHCR_USER,
      password: process.env.RADISHINK_GHCR_TOKEN,
    });
    if (values["check-tags"]) {
      if (values.pull) throw new Error("--pull is only for pair collection");
      const record = pairRecord(
        JSON.parse(fs.readFileSync(values["check-tags"])),
      );
      verifyGitSource(
        fileURLToPath(new URL("../../", import.meta.url)),
        record.tag,
        record.revision,
      );
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
        plan: JSON.parse(
          fs.readFileSync(
            new URL(
              "../../LICENSES/distribution/base-image-plan.json",
              import.meta.url,
            ),
          ),
        ),
        client,
        inventory: values.pull ? pullInventory : collectInventory,
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
