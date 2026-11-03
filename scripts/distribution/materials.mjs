import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import https from "node:https";
import { pipeline } from "node:stream/promises";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function inside(base, filename) {
  if (typeof filename !== "string" || !filename || path.isAbsolute(filename))
    throw new Error(`Invalid material path: ${filename}`);
  const target = path.resolve(base, filename);
  if (!target.startsWith(path.resolve(base) + path.sep))
    throw new Error(`Material path escapes directory: ${filename}`);
  // Also reject symlinks in existing ancestors, including the final file.
  let current = path.resolve(base);
  for (const part of path.relative(current, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Symlink in material path: ${filename}`);
  }
  return target;
}

export function checked(base, filename, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected))
    throw new Error(`Invalid SHA-256: ${filename}`);
  const bytes = fs.readFileSync(inside(base, filename));
  if (!bytes.length || digest(bytes) !== expected)
    throw new Error(`Material SHA-256 mismatch: ${filename}`);
  return bytes;
}

export function catalog(root, { checkNotices = true } = {}) {
  const result = JSON.parse(
    fs.readFileSync(
      path.join(root, "LICENSES/distribution/native-sources.json"),
    ),
  );
  if (result.schemaVersion !== 1 || !result.sources?.length)
    throw new Error("Invalid native source catalog");
  if (!Object.keys(result.versions ?? {}).length)
    throw new Error("Missing native component versions");
  const ids = new Set(),
    files = new Set();
  for (const source of result.sources) {
    if (ids.has(source.id) || files.has(source.file))
      throw new Error(`Duplicate source: ${source.id}`);
    ids.add(source.id);
    files.add(source.file);
    if (!source.id || !source.version || !/^https:\/\//.test(source.url))
      throw new Error(`Incomplete source identity: ${source.id}`);
    inside(root, source.file);
    if (!/^[a-f0-9]{64}$/.test(source.sha256))
      throw new Error(`Invalid source SHA-256: ${source.id}`);
    for (const notice of source.notices ?? []) {
      if (
        checkNotices &&
        !checked(root, notice.file, notice.sha256).toString("utf8").trim()
      )
        throw new Error(`Empty source notice: ${notice.file}`);
    }
  }
  for (const source of result.extraNotices ?? []) {
    if (!checked(root, source.file, source.sha256).toString("utf8").trim())
      throw new Error(`Empty standard notice: ${source.file}`);
  }
  for (const [component, version] of Object.entries(result.versions ?? {})) {
    if (
      !result.sources.some(
        (source) => source.id === component && source.version === version,
      )
    )
      throw new Error(
        `Missing native component source: ${component}@${version}`,
      );
  }
  if (
    !result.sources.some(
      (source) =>
        source.id === "sharp-libvips-build" &&
        source.version === result.packageVersion,
    )
  )
    throw new Error("Missing Sharp/libvips build recipe");
  const lock = checked(
    root,
    result.rustLock.file,
    result.rustLock.sha256,
  ).toString("utf8");
  for (const block of lock.split("[[package]]").slice(1)) {
    const fields = Object.fromEntries(
      [...block.matchAll(/^(name|version|source|checksum) = "([^"]+)"$/gm)].map(
        (match) => [match[1], match[2]],
      ),
    );
    if (!fields.source) continue;
    if (!fields.source.startsWith("registry+"))
      throw new Error(`Unreviewed Rust source: ${fields.name}`);
    if (
      !result.sources.some(
        (source) =>
          source.id === `rust-${fields.name}-${fields.version}` &&
          source.sha256 === fields.checksum,
      )
    )
      throw new Error(
        `Missing locked Rust source: ${fields.name}@${fields.version}`,
      );
  }
  return result;
}

// Fetching is explicit. Normal generation/checking never accesses the network.
function sourceResponse(url, signal, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal }, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.destroy();
        let next;
        try {
          next = new URL(response.headers.location, url);
        } catch {
          reject(new Error("Invalid or excessive source redirect"));
          return;
        }
        if (next.protocol !== "https:" || redirects >= 5) {
          reject(new Error("Invalid or excessive source redirect"));
          return;
        }
        sourceResponse(next, signal, redirects + 1).then(resolve, reject);
      } else if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error(`HTTP ${response.statusCode}`));
      } else resolve(response);
    });
    request.on("error", reject);
  });
}

export async function fetchSources(root, directory) {
  const sources = catalog(root).sources;
  fs.mkdirSync(directory, { recursive: true });
  let index = 0;
  const abort = new AbortController();
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (index < sources.length) {
        if (abort.signal.aborted) throw abort.signal.reason;
        const source = sources[index++];
        const target = inside(directory, source.file);
        const temporary = `${target}.${randomUUID()}.partial`;
        try {
          if (fs.existsSync(target)) {
            checked(directory, source.file, source.sha256);
            continue;
          }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const response = await sourceResponse(
            source.url,
            AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
          );
          await pipeline(
            response,
            fs.createWriteStream(temporary, { flags: "wx" }),
          );
          if (digest(fs.readFileSync(temporary)) !== source.sha256)
            throw new Error("Downloaded SHA-256 mismatch");
          fs.renameSync(temporary, target);
        } catch (error) {
          const reason =
            error.code ??
            (/^(HTTP \d{3}|Downloaded SHA-256 mismatch|Invalid or excessive source redirect|Material SHA-256 mismatch: .+)$/.test(
              error.message,
            )
              ? error.message
              : error.name);
          if (!abort.signal.aborted)
            abort.abort(
              new Error(`Source download failed: ${source.id}: ${reason}`, {
                cause: error,
              }),
            );
          throw abort.signal.reason;
        } finally {
          fs.rmSync(temporary, { force: true });
        }
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return sources.length;
}
