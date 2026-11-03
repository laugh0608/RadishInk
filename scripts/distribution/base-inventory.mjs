import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { digest } from "./materials.mjs";
import { MANIFEST_TYPES } from "./registry.mjs";

const order = (a, b) => a.id.localeCompare(b.id, "en");
function runtimeBases() {
  return Object.fromEntries(
    [
      ["server", "../../apps/server/Dockerfile"],
      ["web", "../../Dockerfile"],
    ].map(([component, file]) => {
      const base = /^FROM (\S+) AS runtime$/m.exec(
        fs.readFileSync(new URL(file, import.meta.url), "utf8"),
      )?.[1];
      if (!base || !/@sha256:[a-f0-9]{64}$/.test(base))
        throw new Error(`Pinned runtime base required: ${component}`);
      return [component, base];
    }),
  );
}
export function sourceRequirements(inventories) {
  const found = new Map();
  const add = (item) => {
    const previous = found.get(item.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item))
      throw new Error(`Conflicting base source identity: ${item.id}`);
    found.set(item.id, item);
  };
  for (const inventory of inventories) {
    if (inventory.component === "server") {
      for (const pkg of inventory.components.packages) {
        if (!pkg.source || !pkg.sourceVersion)
          throw new Error(`Missing Debian source identity: ${pkg.name}`);
        add({
          id: `debian:${pkg.source}@${pkg.sourceVersion}`,
          ecosystem: "debian",
          name: pkg.source,
          version: pkg.sourceVersion,
          lookup: pkg.sourceIndex,
        });
      }
      for (const pkg of inventory.components.bundled) add(pkg);
    } else if (inventory.component === "web") {
      for (const pkg of inventory.components.packages) {
        if (!pkg.origin || !pkg.version)
          throw new Error(`Missing APK source identity: ${pkg.name}`);
        if (pkg.commit && !/^[a-f0-9]{40}$/.test(pkg.commit))
          throw new Error(`Invalid APK recipe commit: ${pkg.name}`);
        if (
          !pkg.commit &&
          ![
            "nginx",
            "nginx-module-geoip",
            "nginx-module-image-filter",
            "nginx-module-xslt",
            "nginx-module-acme",
            "nginx-module-njs",
          ].includes(pkg.origin)
        )
          throw new Error(`Unreviewed APK without recipe commit: ${pkg.name}`);
        add({
          id: `apk:${pkg.origin}@${pkg.version}${pkg.commit ? `#${pkg.commit}` : ""}`,
          ecosystem: pkg.commit ? "aports" : "nginx-vendor",
          name: pkg.origin,
          version: pkg.version,
          ...(pkg.commit ? { recipeRevision: pkg.commit } : {}),
          lookup: pkg.commit
            ? `https://github.com/alpinelinux/aports/tree/${pkg.commit}`
            : "https://github.com/nginx/pkg-oss",
        });
      }
      add({
        id: "docker-nginx:entrypoints",
        ecosystem: "container-recipe",
        name: "docker-nginx",
        version: "retained-files",
        lookup: "https://github.com/nginx/docker-nginx",
      });
    } else throw new Error("Invalid inventory component");
  }
  return [...found.values()].sort(order);
}

export function apkPackages(database) {
  const result = database
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const fields = {};
      for (const line of block.split("\n")) {
        if (/^[PVoLc]:/.test(line)) fields[line[0]] = line.slice(2);
      }
      if (!fields.P || !fields.V || !fields.o)
        throw new Error("Incomplete installed APK identity");
      return {
        name: fields.P,
        version: fields.V,
        origin: fields.o,
        commit: fields.c ?? null,
        license: fields.L ?? null,
      };
    });
  if (
    !result.length ||
    new Set(result.map((pkg) => pkg.name)).size !== result.length
  )
    throw new Error("Empty or duplicate APK inventory");
  return result.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const serverProbe = String.raw`
const fs = require('node:fs');
const crypto = require('node:crypto');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result = JSON.parse(fs.readFileSync('/app/base-distribution/components.json'));
if (result.node.version !== process.version) throw Error('Stale Node base inventory');
const actual = require('node:child_process').execFileSync('dpkg-query', ['-W','-f='+'$'+'{Package}\t'+'$'+'{Version}\t'+'$'+'{source:Package}\t'+'$'+'{source:Version}\n'], {encoding:'utf8'}).trim().split('\n');
if (actual.join('\n') !== result.packages.map(p => [p.name,p.version,p.source,p.sourceVersion].join('\t')).join('\n')) throw Error('Stale Debian base inventory');
const bundled = [];
const yarnDirectories = fs.readdirSync('/opt').filter(n => n.startsWith('yarn-v'));
if (yarnDirectories.length !== 1) throw Error('Unexpected Yarn installation');
for (const [name, location, ecosystem, lookup] of [
 ['npm','/usr/local/lib/node_modules/npm','npm','https://github.com/npm/cli'],
 ['corepack','/usr/local/lib/node_modules/corepack','npm','https://github.com/nodejs/corepack'],
 ['yarn','/opt/'+yarnDirectories[0],'npm','https://github.com/yarnpkg/yarn'],
]) {
 const pkg = JSON.parse(fs.readFileSync(location + '/package.json'));
 if (pkg.name !== name || !pkg.version) throw Error('Unexpected bundled package');
 const licenses = fs.readdirSync(location).filter(n => /^(LICENSE|COPYING)(\.|$)/i.test(n));
 if (!licenses.length) throw Error('Missing bundled license: ' + name);
 bundled.push({id: ecosystem + ':' + name + '@' + pkg.version, ecosystem, name, version: pkg.version, lookup});
 result[name] = {version: pkg.version, licenses: Object.fromEntries(licenses.map(n => [n,hash(location+'/'+n)]))};
}
bundled.push({id:'node:'+result.node.version,ecosystem:'node',name:'node',version:result.node.version,lookup:result.node.source});
bundled.push({id:'docker-node:entrypoint',ecosystem:'container-recipe',name:'docker-node',version:'retained-files',lookup:'https://github.com/nodejs/docker-node'});
result.entrypointSha256 = hash('/usr/local/bin/docker-entrypoint.sh');
result.bundled = bundled;
process.stdout.write(JSON.stringify(result));
`;
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
export function verifyLocalBinding(inspected, image, expected) {
  if (inspected.Descriptor) {
    if (
      !MANIFEST_TYPES.includes(inspected.Descriptor.mediaType) ||
      inspected.Descriptor.digest !== expected.manifest.digest
    )
      throw new Error("Local platform manifest differs from registry");
  } else if (
    inspected.Id !== expected.config.digest ||
    !inspected.RepoDigests?.includes(image)
  ) {
    throw new Error(
      "Local classic image config/reference differs from registry",
    );
  }
  const config = expected.config.json;
  if (
    config.rootfs?.type !== "layers" ||
    !Array.isArray(config.rootfs.diff_ids) ||
    JSON.stringify(inspected.RootFS?.Layers) !==
      JSON.stringify(config.rootfs.diff_ids) ||
    inspected.Os !== config.os ||
    inspected.Architecture !== config.architecture
  )
    throw new Error("Local image rootfs/platform differs from registry config");
}

export function collectInventory(component, image, expected) {
  if (
    typeof image !== "string" ||
    image.length > 512 ||
    !/^[a-z0-9][a-zA-Z0-9_./:@-]*$/.test(image)
  )
    throw new Error("Invalid local image reference");
  const inspected = JSON.parse(docker(["image", "inspect", image]))[0];
  if (expected) verifyLocalBinding(inspected, image, expected);
  const platform = `${inspected.Os}/${inspected.Architecture}`;
  if (!["linux/amd64", "linux/arm64"].includes(platform))
    throw new Error(`Unsupported inventory platform: ${platform}`);
  const run = [
    "run",
    "--rm",
    "--pull=never",
    "--network",
    "none",
    "--read-only",
  ];
  let components;
  if (component === "server") {
    components = JSON.parse(
      docker([...run, "--entrypoint", "node", image, "-e", serverProbe]),
    );
  } else if (component === "web") {
    const database = docker([
      ...run,
      "--entrypoint",
      "cat",
      image,
      "/lib/apk/db/installed",
    ]);
    const entrypoints = docker([
      ...run,
      "--entrypoint",
      "sh",
      image,
      "-ec",
      "sha256sum /docker-entrypoint.sh /docker-entrypoint.d/*",
    ]);
    components = {
      packages: apkPackages(database),
      apkDatabaseSha256: digest(database),
      entrypoints,
    };
  } else throw new Error("Invalid inventory component");
  return { component, platform, components };
}

export function inventoryPlan(inventories) {
  if (
    inventories.length !== 4 ||
    new Set(inventories.map((i) => `${i.component}/${i.platform}`)).size !== 4
  )
    throw new Error("Require Web/server inventories on both amd64 and arm64");
  for (const component of ["server", "web"])
    for (const platform of ["linux/amd64", "linux/arm64"])
      if (
        !inventories.some(
          (i) => i.component === component && i.platform === platform,
        )
      )
        throw new Error(`Missing base inventory: ${component}/${platform}`);
  return {
    formatVersion: 1,
    baseImages: runtimeBases(),
    inventories: [...inventories].sort((a, b) =>
      `${a.component}/${a.platform}`.localeCompare(
        `${b.component}/${b.platform}`,
        "en",
      ),
    ),
    requirements: sourceRequirements(inventories),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "server-amd64": { type: "string" },
        "server-arm64": { type: "string" },
        "web-amd64": { type: "string" },
        "web-arm64": { type: "string" },
        output: { type: "string" },
      },
    });
    const items = [];
    for (const component of ["server", "web"])
      for (const arch of ["amd64", "arm64"]) {
        const image = values[`${component}-${arch}`];
        if (!image) throw new Error(`Missing --${component}-${arch}`);
        const inventory = collectInventory(component, image);
        if (inventory.platform !== `linux/${arch}`)
          throw new Error(`Image architecture mismatch: ${component}/${arch}`);
        items.push(inventory);
      }
    if (!values.output) throw new Error("--output is required");
    fs.writeFileSync(
      values.output,
      JSON.stringify(inventoryPlan(items), null, 2) + "\n",
      { flag: "wx" },
    );
    console.log("Four final-image base inventories captured");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
