import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  checked,
  digest,
  inside,
  catalog,
  fetchPinnedSources,
} from "./materials.mjs";
import { inventoryPlan } from "./base-inventory.mjs";
import { archiveSources } from "./source-archive.mjs";

export function validatePlan(plan) {
  if (
    plan.formatVersion !== 1 ||
    JSON.stringify(inventoryPlan(plan.inventories)) !== JSON.stringify(plan)
  )
    throw new Error(
      "Source plan differs from its four final-image inventories",
    );
  return plan;
}
const filename = (file) => path.posix.basename(file);

// Alpine's libyuv recipe checks the unpacked Gitiles files because the gzip bytes vary.
// This exact distfile was verified against all paths, modes and blobs in the pinned Git tree.
const libyuvDistfile = {
  id: "apk:libyuv@0.0.1928-r0#6d055fa770a2fbbd807ee496c4dc8c69d00fbee4",
  recipeSha256:
    "f1ee165c6c826e2666d043347ccea96a882677d1140e10ebbcb360415a202dc6",
  name: "libyuv-0.0.1928.tar.gz",
  url: "https://distfiles.alpinelinux.org/distfiles/v3.24/libyuv-0.0.1928.tar.gz",
  sha256: "2e11ada5992dcce18f2e468573a03f04f6defb203cd7608e52cb38fb7966772e",
};

function checkDebian(entry, files, directory) {
  const descriptors = files.filter((f) => f.file.endsWith(".dsc"));
  if (descriptors.length !== 1)
    throw new Error(`Require one Debian .dsc: ${entry.id}`);
  const text = checked(
    directory,
    descriptors[0].file,
    descriptors[0].sha256,
  ).toString("utf8");
  if (
    !text.includes(`\nSource: ${entry.name}\n`) ||
    !text.includes(`\nVersion: ${entry.version}\n`)
  )
    throw new Error(`Debian source/version mismatch: ${entry.id}`);
  const block = /\nChecksums-Sha256:\n((?: [^\n]+\n)+)/.exec(text)?.[1];
  if (!block)
    throw new Error(`Missing Debian SHA-256 source list: ${entry.id}`);
  for (const line of block.trim().split("\n")) {
    const match = /^([a-f0-9]{64})\s+([1-9][0-9]*)\s+([^/\s]+)$/.exec(
      line.trim(),
    );
    const item = match && files.find((f) => filename(f.file) === match[3]);
    if (!item || item.sha256 !== match[1] || item.size !== Number(match[2]))
      throw new Error(`Incomplete Debian source set: ${entry.id}`);
  }
}
function checkAports(entry, files, directory) {
  const recipes = files.filter((f) => filename(f.file) === "APKBUILD");
  if (recipes.length !== 1)
    throw new Error(`Require pinned APKBUILD: ${entry.id}`);
  const recipe = recipes[0];
  if (!recipe.url.includes(`/aports/${entry.recipeRevision}/`))
    throw new Error(`APKBUILD commit mismatch: ${entry.id}`);
  const text = checked(directory, recipe.file, recipe.sha256).toString("utf8");
  const sumText = /^sha512sums=(["'])([\s\S]*?)\1/m.exec(text)?.[2];
  if ([...text.matchAll(/^\s*sha512sums\+?=/gm)].length > 1)
    throw new Error(`Unreviewed APK checksum reassignment: ${entry.id}`);
  const sums = (sumText?.trim() ? sumText.trim().split("\n") : []).map(
    (line) => {
      const match = /^([a-f0-9]{128})\s+([^/\s]+)$/.exec(line.trim());
      if (!match)
        throw new Error(`Unreviewed APK checksum expression: ${entry.id}`);
      return match;
    },
  );
  // Recipes with no source (meta packages) must still retain the exact recipe.
  if (!sums.length && /\nsource=["']?[^\n"']/.test(text))
    throw new Error(`Cannot establish APK source checksums: ${entry.id}`);
  for (const [, expected, name] of sums) {
    const item = files.find((f) => filename(f.file) === name);
    const matchesLibyuvDistfile =
      entry.id === libyuvDistfile.id &&
      recipe.sha256 === libyuvDistfile.recipeSha256 &&
      name === libyuvDistfile.name &&
      item?.url === libyuvDistfile.url &&
      item.sha256 === libyuvDistfile.sha256;
    if (
      !item ||
      (createHash("sha512")
        .update(checked(directory, item.file, item.sha256))
        .digest("hex") !== expected &&
        !matchesLibyuvDistfile)
    )
      throw new Error(`Incomplete APK source/patch set: ${entry.id}/${name}`);
  }
}

export function sourceCoverage(plan, provision, directory) {
  validatePlan(plan);
  if (provision.formatVersion !== 1 || !Array.isArray(provision.entries))
    throw new Error("Invalid base source provision catalog");
  const required = new Map(plan.requirements.map((item) => [item.id, item]));
  const seen = new Set();
  const allFiles = new Map();
  for (const entry of provision.entries) {
    const requirement = required.get(entry.id);
    if (!requirement || seen.has(entry.id))
      throw new Error(`Unexpected or duplicate source: ${entry.id}`);
    seen.add(entry.id);
    if (
      typeof entry.review !== "string" ||
      entry.review.trim().length < 20 ||
      typeof entry.rebuild !== "string" ||
      entry.rebuild.trim().length < 20 ||
      !entry.files?.length
    )
      throw new Error(
        `Source review/rebuild instructions required: ${entry.id}`,
      );
    for (const role of ["source", "recipe", "notice"])
      if (!entry.files.some((file) => file.roles?.includes(role)))
        throw new Error(`Missing ${role} material: ${entry.id}`);
    for (const file of entry.files) {
      const url = new URL(file.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        !Array.isArray(file.roles) ||
        file.roles.some(
          (role) =>
            !["source", "recipe", "notice", "patch", "signature"].includes(
              role,
            ),
        )
      )
        throw new Error(`Invalid source material: ${entry.id}`);
      const bytes = checked(directory, file.file, file.sha256);
      if (bytes.length !== file.size)
        throw new Error(`Source size mismatch: ${file.file}`);
      if (
        allFiles.has(file.file) &&
        JSON.stringify(allFiles.get(file.file)) !== JSON.stringify(file)
      )
        throw new Error(`Conflicting material path: ${file.file}`);
      allFiles.set(file.file, file);
    }
    const combined = { ...entry, ...requirement };
    if (requirement.ecosystem === "debian")
      checkDebian(combined, entry.files, directory);
    if (requirement.ecosystem === "aports")
      checkAports(combined, entry.files, directory);
  }
  const missing = [...required.keys()].filter((id) => !seen.has(id));
  if (missing.length)
    throw new Error(
      `Missing corresponding base sources (${missing.length}): ${missing.join(", ")}`,
    );
  for (const inventory of plan.inventories) {
    const components = inventory.components;
    const retained =
      inventory.component === "server"
        ? [
            components.entrypointSha256,
            components.node.licenseSha256,
            ...["npm", "corepack", "yarn"].flatMap((name) =>
              Object.values(components[name].licenses),
            ),
          ]
        : components.entrypoints
            .trim()
            .split("\n")
            .map((line) => line.split(/\s+/)[0]);
    for (const hash of retained)
      if (![...allFiles.values()].some((file) => file.sha256 === hash))
        throw new Error(
          `Retained base notice/entrypoint absent from source provision: ${inventory.component}/${hash}`,
        );
  }
  return [...allFiles.values()].sort((a, b) =>
    a.file.localeCompare(b.file, "en"),
  );
}

function filesUnder(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(
    prefix ? inside(directory, prefix) : directory,
    { withFileTypes: true },
  )) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
      throw new Error(`Non-regular source bundle member: ${name}`);
    if (entry.isDirectory()) files.push(...filesUnder(directory, name));
    else files.push(name);
  }
  return files.sort();
}

export function buildSourceBundle({
  root,
  plan,
  provision,
  directory,
  nativeDirectory,
  output,
}) {
  // Validate everything before creating an output; never replace a previous bundle.
  const baseFiles = sourceCoverage(plan, provision, directory);
  const native = catalog(root);
  for (const file of native.sources)
    checked(nativeDirectory, file.file, file.sha256);
  if (fs.existsSync(output))
    throw new Error("Source bundle output already exists");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "radishink-source-bundle-"),
  );
  try {
    const put = (name, bytes) => {
      const target = inside(temporary, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    };
    put("base-plan.json", JSON.stringify(plan, null, 2) + "\n");
    put("base-provision.json", JSON.stringify(provision, null, 2) + "\n");
    for (const file of baseFiles)
      put(`base/${file.file}`, checked(directory, file.file, file.sha256));
    for (const file of native.sources)
      put(
        `native/${file.file}`,
        checked(nativeDirectory, file.file, file.sha256),
      );
    fs.cpSync(path.join(root, "LICENSES"), path.join(temporary, "LICENSES"), {
      recursive: true,
    });
    put("RadishInk-LICENSE", fs.readFileSync(path.join(root, "LICENSE")));
    put(
      "README.txt",
      "RadishInk corresponding-source companion\n\nOriginal third-party sources, patches, notices and recipes retain their respective licenses. RadishInk-LICENSE applies only within its stated original-work scope. See LICENSES/WeMD-MIT.txt and LICENSES/distribution/server-scope.txt.\n\nBase inputs and exact image inventories: base-plan.json. Reviewed source sets and rebuild instructions: base-provision.json. Native sources and upstream rebuild recipes: LICENSES/distribution/native-sources.json and native/. No upstream scripts were executed during collection. This bundle does not assert bit-for-bit reproduction or legal approval.\n",
    );
    const files = filesUnder(temporary).map((file) => {
      const bytes = fs.readFileSync(inside(temporary, file));
      return { file, sha256: digest(bytes), size: bytes.length };
    });
    put(
      "bundle.json",
      JSON.stringify({ formatVersion: 1, files }, null, 2) + "\n",
    );
    fs.cpSync(temporary, output, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return verifySourceBundle(output);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifySourceBundle(directory) {
  const manifestBytes = fs.readFileSync(inside(directory, "bundle.json"));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.formatVersion !== 1 || !manifest.files?.length)
    throw new Error("Invalid source bundle manifest");
  const expected = ["bundle.json"];
  for (const file of manifest.files) {
    if (checked(directory, file.file, file.sha256).length !== file.size)
      throw new Error(`Bundle size mismatch: ${file.file}`);
    expected.push(file.file);
  }
  if (
    new Set(expected).size !== expected.length ||
    JSON.stringify(expected.sort()) !== JSON.stringify(filesUnder(directory))
  )
    throw new Error("Missing, duplicate or extra source bundle members");
  const plan = JSON.parse(fs.readFileSync(inside(directory, "base-plan.json")));
  const provision = JSON.parse(
    fs.readFileSync(inside(directory, "base-provision.json")),
  );
  sourceCoverage(plan, provision, inside(directory, "base"));
  const native = catalog(directory);
  for (const file of native.sources)
    checked(inside(directory, "native"), file.file, file.sha256);
  return { manifestSha256: digest(manifestBytes), plan };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        plan: { type: "string" },
        provision: { type: "string" },
        directory: { type: "string" },
        "native-directory": {
          type: "string",
          default: "output/distribution/sources",
        },
        output: { type: "string" },
        check: { type: "string" },
        archive: { type: "string" },
        fetch: { type: "boolean", default: false },
      },
    });
    if (values.fetch) {
      if (values.check) throw new Error("--fetch cannot accompany --check");
      const provision = JSON.parse(fs.readFileSync(values.provision));
      const files = new Map();
      for (const entry of provision.entries)
        for (const file of entry.files) {
          if (
            files.has(file.file) &&
            JSON.stringify(files.get(file.file)) !== JSON.stringify(file)
          )
            throw new Error(`Conflicting pinned source: ${file.file}`);
          files.set(file.file, file);
        }
      await fetchPinnedSources(
        [...files.values()].map((file) => ({ ...file, id: file.file })),
        values.directory,
      );
    }
    const result = values.check
      ? verifySourceBundle(values.check)
      : buildSourceBundle({
          root: fileURLToPath(new URL("../../", import.meta.url)),
          plan: JSON.parse(fs.readFileSync(values.plan)),
          provision: JSON.parse(fs.readFileSync(values.provision)),
          directory: values.directory,
          nativeDirectory: values["native-directory"],
          output: values.output,
        });
    let archive;
    if (!values.check || values.archive) {
      archive = await archiveSources(
        values.check ?? values.output,
        values.archive ?? `${values.output}.tar.gz`,
      );
    }
    console.log(`Complete source bundle verified: ${result.manifestSha256}`);
    if (archive) console.log(JSON.stringify(archive));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
