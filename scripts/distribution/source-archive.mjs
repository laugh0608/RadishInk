import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { inside, checked } from "./materials.mjs";

function header(name, size) {
  const output = Buffer.alloc(512);
  let base = name,
    prefix = "";
  if (Buffer.byteLength(base) > 100) {
    const split = name.lastIndexOf("/");
    prefix = name.slice(0, split);
    base = name.slice(split + 1);
  }
  if (
    Buffer.byteLength(base) > 100 ||
    Buffer.byteLength(prefix) > 155 ||
    size >= 8 ** 11
  )
    throw new Error(`Source archive member exceeds ustar limits: ${name}`);
  output.write(base, 0, 100);
  const octal = (value, offset, length) =>
    output.write(
      value.toString(8).padStart(length - 1, "0") + "\0",
      offset,
      length,
      "ascii",
    );
  octal(0o644, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(0, 136, 12);
  output.fill(32, 148, 156);
  output.write("0", 156);
  output.write("ustar\0", 257, 6);
  output.write("00", 263, 2);
  output.write(prefix, 345, 155);
  output.write(
    [...output]
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
    8,
  );
  return output;
}
async function hashFile(file) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const bytes of fs.createReadStream(file)) {
    hash.update(bytes);
    size += bytes.length;
  }
  return { sha256: hash.digest("hex"), size };
}

export async function archiveSources(directory, output) {
  const manifest = JSON.parse(
    fs.readFileSync(inside(directory, "bundle.json")),
  );
  const files = [
    "bundle.json",
    ...manifest.files.map((item) => item.file),
  ].sort();
  async function* chunks() {
    for (const file of files) {
      const target = inside(directory, file),
        stat = fs.lstatSync(target);
      if (!stat.isFile())
        throw new Error(`Non-regular archive member: ${file}`);
      yield header(file, stat.size);
      yield* fs.createReadStream(target);
      if (stat.size % 512) yield Buffer.alloc(512 - (stat.size % 512));
    }
    yield Buffer.alloc(1024);
  }
  if (fs.existsSync(output))
    throw new Error("Source archive output already exists");
  try {
    await pipeline(
      Readable.from(chunks()),
      createGzip({ level: 9 }),
      fs.createWriteStream(output, { flags: "wx" }),
    );
    return await verifySourceArchive(directory, output);
  } catch (error) {
    fs.rmSync(output, { force: true });
    throw error;
  }
}

// Stream verification avoids extracting potentially hostile archive paths.
export async function verifySourceArchive(directory, archive) {
  const bytes = fs.readFileSync(inside(directory, "bundle.json"));
  const manifest = JSON.parse(bytes);
  const expected = new Map(
    [
      ...manifest.files,
      {
        file: "bundle.json",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
      },
    ].map((item) => [item.file, item]),
  );
  let buffer = Buffer.alloc(0),
    current = null,
    padding = 0,
    ended = false,
    endBytes = 0;
  const seen = new Set();
  const input = fs.createReadStream(archive),
    unzip = createGunzip();
  input.on("error", (error) => unzip.destroy(error));
  input.pipe(unzip);
  try {
    for await (const chunk of unzip) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        if (ended) {
          if (buffer.some((byte) => byte !== 0))
            throw new Error("Trailing source archive content");
          endBytes += buffer.length;
          if (endBytes > 1024) throw new Error("Excess source archive padding");
          buffer = Buffer.alloc(0);
          break;
        }
        if (current) {
          const length = Math.min(buffer.length, current.remaining);
          current.hash.update(buffer.subarray(0, length));
          buffer = buffer.subarray(length);
          current.remaining -= length;
          if (current.remaining) break;
          if (current.hash.digest("hex") !== current.expected.sha256)
            throw new Error(
              `Archive source digest mismatch: ${current.expected.file}`,
            );
          current = null;
        }
        if (padding) {
          const length = Math.min(buffer.length, padding);
          if (buffer.subarray(0, length).some((byte) => byte !== 0))
            throw new Error("Nonzero source archive padding");
          padding -= length;
          buffer = buffer.subarray(length);
          if (padding) break;
        }
        if (buffer.length < 512) break;
        const block = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (block.every((byte) => byte === 0)) {
          ended = true;
          endBytes = 512;
          continue;
        }
        const text = (start, length) =>
          block
            .subarray(start, start + length)
            .toString("utf8")
            .split("\0")[0];
        const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
        inside(directory, name);
        const sizeField = text(124, 12).trim(),
          checksumField = text(148, 8).trim();
        if (!/^[0-7]+$/.test(sizeField) || !/^[0-7]+$/.test(checksumField))
          throw new Error("Invalid ustar numeric field");
        const sum = [...block].reduce(
          (total, value, index) =>
            total + (index >= 148 && index < 156 ? 32 : value),
          0,
        );
        if (
          sum !== parseInt(checksumField, 8) ||
          text(257, 6) !== "ustar" ||
          text(156, 1) !== "0"
        )
          throw new Error("Unsupported or corrupt source archive header");
        const item = expected.get(name),
          size = parseInt(sizeField, 8);
        if (!item || seen.has(name) || item.size !== size)
          throw new Error(`Unexpected/missing source archive member: ${name}`);
        checked(directory, name, item.sha256);
        seen.add(name);
        padding = (512 - (size % 512)) % 512;
        current = {
          expected: item,
          remaining: size,
          hash: createHash("sha256"),
        };
      }
    }
    if (
      !ended ||
      endBytes < 1024 ||
      buffer.length ||
      current ||
      padding ||
      seen.size !== expected.size
    )
      throw new Error("Truncated or incomplete source archive");
  } finally {
    input.destroy();
    unzip.destroy();
  }
  return { file: path.basename(archive), ...(await hashFile(archive)) };
}
