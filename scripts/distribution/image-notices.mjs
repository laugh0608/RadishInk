import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  catalog,
  checked,
  digest,
  fetchSources,
  inside,
} from "./materials.mjs";

const UPSTREAM_SHA256 =
  "a09416d1350a2647d3a9d91859551c7654157b3c38abb2c5009c4003d5a2abf6";
const licenseName =
  /^(?:(?:MIT|ISC|BSD|APACHE)[-_.])?(licen[sc]e|copying|notice|ofl)([.-]|$)/i;

function packageDigest(directory) {
  const entries = [];
  function visit(current, prefix = "") {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name === "node_modules") continue;
      const file = path.join(current, entry.name),
        name = prefix + entry.name;
      if (entry.isDirectory()) visit(file, `${name}/`);
      else if (entry.isSymbolicLink())
        entries.push([name, "symlink", fs.readlinkSync(file)]);
      else if (entry.isFile())
        entries.push([name, digest(fs.readFileSync(file))]);
      else throw new Error(`Unsupported distributed file: ${file}`);
    }
  }
  visit(directory);
  return digest(JSON.stringify(entries));
}

// Inspect physical directories, including inactive optional packages and bundled
// node_modules. Dependency reachability is deliberately not the distribution boundary.
export function distributedPackages(modules) {
  const packages = [];
  function walk(directory) {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      const manifest = path.join(child, "package.json");
      if (fs.existsSync(manifest)) {
        const metadata = JSON.parse(fs.readFileSync(manifest));
        if (!metadata.name || !metadata.version)
          throw new Error(`Invalid package identity: ${manifest}`);
        packages.push({
          directory: child,
          relative: path.relative(modules, child).split(path.sep).join("/"),
          metadata,
        });
        // Other directories inside a package are its source, not other packages.
        if (fs.existsSync(path.join(child, "node_modules")))
          walk(path.join(child, "node_modules"));
      } else walk(child);
    }
  }
  walk(modules);
  if (!packages.length)
    throw new Error("No physically distributed packages found");
  return packages.sort((a, b) => a.relative.localeCompare(b.relative, "en"));
}

export function imageMaterials({ root, modules, sources }) {
  root = path.resolve(root);
  const native = catalog(root);
  const supplementary = JSON.parse(
    fs.readFileSync(path.join(root, "LICENSES/distribution/npm-sources.json")),
  );
  const output = new Map();
  const add = (name, bytes) => {
    if (output.has(name))
      throw new Error(`Duplicate distribution material: ${name}`);
    output.set(name, Buffer.from(bytes));
  };
  const project = fs.readFileSync(path.join(root, "LICENSE"));
  if (!project.toString("utf8").trim())
    throw new Error("Empty project license");
  add("RadishInk-LICENSE.txt", project);
  add(
    "WeMD-LICENSE.txt",
    checked(root, "LICENSES/WeMD-MIT.txt", UPSTREAM_SHA256),
  );
  const scope = fs.readFileSync(
    path.join(root, "LICENSES/distribution/server-scope.txt"),
  );
  if (!scope.toString("utf8").trim())
    throw new Error("Empty server license scope");
  add("server-scope.txt", scope);
  const packages = [];
  let nativePresent = false;
  const text = [
    "RadishInk server — third-party notices",
    "Generated from physically distributed package directories, including inactive optional packages.",
    "Package declarations describe their own material; the RadishInk license does not replace third-party rights.",
    "",
    "Project and historical scope: server-scope.txt",
    "",
  ];
  for (const { directory, relative, metadata } of distributedPackages(
    modules,
  )) {
    const id = `${metadata.name}@${metadata.version}`;
    const files = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && licenseName.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const record = {
      name: metadata.name,
      version: metadata.version,
      directory: relative,
      license: metadata.license ?? null,
      contentsSha256: packageDigest(directory),
      metadataSha256: digest(
        fs.readFileSync(path.join(directory, "package.json")),
      ),
      notices: [],
    };
    text.push(
      "=".repeat(72),
      id,
      `Directory: node_modules/${relative}`,
      `Declared license: ${metadata.license ?? "not declared"}`,
      "",
    );
    for (const file of files) {
      const bytes = fs.readFileSync(inside(directory, file));
      if (!bytes.toString("utf8").trim())
        throw new Error(`Empty installed license: ${id}/${file}`);
      record.notices.push({ file, sha256: digest(bytes) });
      text.push(`--- ${file} ---`, bytes.toString("utf8"), "");
    }
    const source = supplementary.packages[id];
    if (source) {
      if (
        !source.provenance ||
        !/^https:\/\//.test(source.url) ||
        !Object.keys(source.packageFiles ?? {}).length
      )
        throw new Error(`Incomplete supplemental evidence: ${id}`);
      for (const [file, sha] of Object.entries(source.packageFiles))
        checked(directory, file, sha);
      const bytes = checked(root, source.file, source.sha256);
      if (!bytes.toString("utf8").trim())
        throw new Error(`Empty supplemental notice: ${id}`);
      record.supplement = source;
      text.push(
        `Source: ${source.url}`,
        `Provenance: ${source.provenance}`,
        bytes.toString("utf8"),
        "",
      );
      for (const url of source.evidence ?? [])
        text.push(`Additional evidence: ${url}`);
    }
    if (/^@img\/sharp-libvips-/.test(metadata.name)) {
      if (
        !/^@img\/sharp-libvips-linux(?:musl)?-(?:arm64|x64)$/.test(
          metadata.name,
        ) ||
        metadata.version !== native.packageVersion
      )
        throw new Error(`Unreviewed native binary: ${id}`);
      const versions = JSON.parse(
        fs.readFileSync(path.join(directory, "versions.json")),
      );
      if (
        JSON.stringify(Object.entries(versions).sort()) !==
        JSON.stringify(Object.entries(native.versions).sort())
      )
        throw new Error(`Native component versions changed: ${id}`);
      record.nativeSources = "native-sources.json";
      record.versionsSha256 = digest(
        fs.readFileSync(path.join(directory, "versions.json")),
      );
      nativePresent = true;
      text.push(
        "Full component notices: native-notices.txt",
        "Corresponding source archives, build recipe and patches: sources/ and native-sources.json",
        "",
      );
    } else if (!files.length && !source) {
      throw new Error(`Missing reviewed license text: ${id}`);
    }
    packages.push(record);
  }
  if (!nativePresent)
    throw new Error("Expected Sharp/libvips binary packages are missing");
  const nativeText = [
    "Original source notices for the Sharp/libvips distribution",
    "This includes a source superset (including build/test dependencies); a notice's presence does not assert that every source is linked into the binary.",
    "The full unmodified archives retain source-header copyright and additional notices.",
    "",
  ];
  for (const source of native.sources) {
    add(`sources/${source.file}`, checked(sources, source.file, source.sha256));
    nativeText.push(
      "=".repeat(72),
      `${source.id}@${source.version}`,
      `Source: ${source.url}`,
      `Archive SHA-256: ${source.sha256}`,
      "",
    );
    for (const notice of source.notices ?? []) {
      const bytes = checked(root, notice.file, notice.sha256);
      add(`notices/${source.id}/${path.basename(notice.file)}`, bytes);
      nativeText.push(`--- ${notice.path} ---`, bytes.toString("utf8"), "");
    }
  }
  for (const notice of native.extraNotices ?? []) {
    const bytes = checked(root, notice.file, notice.sha256);
    add(`notices/${path.basename(notice.file)}`, bytes);
    nativeText.push(`Source: ${notice.url}`, bytes.toString("utf8"), "");
  }
  add("native-sources.json", `${JSON.stringify(native, null, 2)}\n`);
  add("native-notices.txt", nativeText.join("\n"));
  add("third-party-notices.txt", text.join("\n"));
  add(
    "packages.json",
    `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`,
  );
  const sums = Object.fromEntries(
    [...output]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([file, bytes]) => [file, digest(bytes)]),
  );
  add("checksums.json", `${JSON.stringify(sums, null, 2)}\n`);
  return {
    output,
    packageCount: packages.length,
    sourceCount: native.sources.length,
  };
}

export function generateImageNotices(options) {
  const target = path.resolve(options.output);
  for (const input of [options.root, options.modules, options.sources]) {
    const resolved = path.resolve(input);
    if (
      !options.check &&
      (resolved === target || resolved.startsWith(target + path.sep))
    )
      throw new Error("Output must not replace a material input directory");
  }
  // Validate everything before modifying any previous output.
  const result = imageMaterials(options);
  if (options.check) {
    const expected = new Set(result.output.keys());
    function visit(directory, prefix = "") {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory())
          visit(path.join(directory, entry.name), `${name}/`);
        else if (!entry.isFile() || !expected.delete(name))
          throw new Error(`Unexpected distribution material: ${name}`);
      }
    }
    visit(options.output);
    if (expected.size)
      throw new Error(
        `Missing distribution material: ${[...expected].join(", ")}`,
      );
    for (const [file, bytes] of result.output) {
      if (!fs.readFileSync(inside(options.output, file)).equals(bytes))
        throw new Error(`Distribution material drift: ${file}`);
    }
  } else {
    const temporary = fs.mkdtempSync(
      path.join(path.dirname(target), ".image-notices-"),
    );
    try {
      for (const [file, bytes] of result.output) {
        const destination = inside(temporary, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes);
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  return { packageCount: result.packageCount, sourceCount: result.sourceCount };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string", default: "." },
        modules: { type: "string" },
        sources: { type: "string", default: "output/distribution/sources" },
        output: { type: "string" },
        fetch: { type: "boolean" },
        check: { type: "boolean" },
      },
    });
    if (values.fetch)
      console.log(
        `Verified ${await fetchSources(values.root, values.sources)} source archives`,
      );
    else {
      if (!values.modules || !values.output)
        throw new Error("--modules and --output are required");
      console.log(JSON.stringify(generateImageNotices(values)));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
