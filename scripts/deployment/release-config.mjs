import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { releaseMetadata } from "../release-metadata.mjs";

export const SOURCE = "https://github.com/laugh0608/RadishInk";
export const REPOSITORIES = Object.freeze({
  web: "ghcr.io/laugh0608/radishink-web",
  server: "ghcr.io/laugh0608/radishink-server",
});
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export function object(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error(`${label}: invalid fields`);
  return value;
}

export function releaseLock(value) {
  object(
    value,
    ["formatVersion", "tag", "revision", "platform", "images"],
    "release lock",
  );
  if (
    value.formatVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(value.revision) ||
    /^0+$/.test(value.revision) ||
    !["linux/amd64", "linux/arm64"].includes(value.platform)
  )
    throw new Error("Invalid release identity or platform");
  releaseMetadata(value.tag);
  object(value.images, ["web", "server"], "release images");
  const images = {};
  for (const component of ["web", "server"]) {
    const item = object(value.images[component], ["digest"], component);
    if (
      !/^sha256:[a-f0-9]{64}$/.test(item.digest) ||
      /^sha256:0+$/.test(item.digest)
    )
      throw new Error(`Invalid ${component} platform digest`);
    images[component] =
      `${REPOSITORIES[component]}:${value.tag}@${item.digest}`;
  }
  return { ...value, references: images };
}

const publicKeys = [
  "RADISHINK_ORIGIN",
  "RADISHINK_BASE_PATH",
  "RADISHINK_BIND",
  "RADISHINK_PORT",
  "RADISHINK_ENV",
  "RADISHINK_ACCOUNT_MODE",
  "RADISHINK_PASSWORD_LOGIN",
  "RADISHINK_WORKSPACE_VOLUME",
  "RADISHINK_BACKUP_VOLUME",
  "RADISHINK_OIDC_ENABLED",
  "RADISHINK_OIDC_ISSUER",
  "RADISHINK_OIDC_CLIENT_ID",
  "RADISHINK_OIDC_CLIENT_AUTH",
  "RADISHINK_OIDC_ADMISSION",
  "RADISHINK_SECRETS_DIR",
];
export function publicConfiguration(text) {
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(line)) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || seen.has(match[1]))
      throw new Error("Public configuration has an invalid or duplicate key");
    seen.add(match[1]);
  }
  const supplied = parseEnv(text);
  for (const [key, value] of Object.entries(supplied)) {
    if (!publicKeys.includes(key) || /[\r\n\x00]/.test(value))
      throw new Error(`Unsupported public configuration key: ${key}`);
  }
  const env = {
    RADISHINK_BASE_PATH: "/",
    RADISHINK_BIND: "127.0.0.1",
    RADISHINK_PORT: "8080",
    RADISHINK_ENV: "production",
    RADISHINK_ACCOUNT_MODE: "accounts",
    RADISHINK_PASSWORD_LOGIN: "true",
    ...supplied,
  };
  let origin;
  try {
    origin = new URL(env.RADISHINK_ORIGIN);
  } catch {
    throw new Error("Invalid public Origin");
  }
  if (
    origin.origin !== env.RADISHINK_ORIGIN ||
    origin.username ||
    origin.password ||
    !["https:", "http:"].includes(origin.protocol) ||
    (origin.protocol === "http:" &&
      (env.RADISHINK_ENV !== "development" || origin.hostname !== "127.0.0.1"))
  )
    throw new Error(
      "Public Origin must be exact HTTPS; loopback HTTP requires development",
    );
  if (
    !["production", "development"].includes(env.RADISHINK_ENV) ||
    !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(env.RADISHINK_BASE_PATH) ||
    env.RADISHINK_BASE_PATH.length > 200
  )
    throw new Error("Invalid environment or base path");
  if (
    !/^[1-9][0-9]{0,4}$/.test(env.RADISHINK_PORT) ||
    Number(env.RADISHINK_PORT) > 65535 ||
    !["127.0.0.1", "0.0.0.0"].includes(env.RADISHINK_BIND)
  )
    throw new Error("Invalid bind address or port");
  if (
    !["accounts", "shared"].includes(env.RADISHINK_ACCOUNT_MODE) ||
    !["true", "false"].includes(env.RADISHINK_PASSWORD_LOGIN) ||
    ![undefined, "true", "false"].includes(env.RADISHINK_OIDC_ENABLED)
  )
    throw new Error("Invalid account or login mode");
  const oidc = env.RADISHINK_OIDC_ENABLED === "true";
  if (
    env.RADISHINK_ACCOUNT_MODE === "shared" &&
    (oidc || env.RADISHINK_PASSWORD_LOGIN !== "false")
  )
    throw new Error("Shared mode cannot enable login");
  if (
    env.RADISHINK_ACCOUNT_MODE === "accounts" &&
    !oidc &&
    env.RADISHINK_PASSWORD_LOGIN !== "true"
  )
    throw new Error("Accounts mode needs a login method");
  if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(env.RADISHINK_WORKSPACE_VOLUME ?? ""))
    throw new Error("An explicit workspace volume is required");
  if (
    !/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(env.RADISHINK_BACKUP_VOLUME ?? "") ||
    env.RADISHINK_BACKUP_VOLUME === env.RADISHINK_WORKSPACE_VOLUME
  )
    throw new Error("An independent existing backup volume is required");
  if (oidc) {
    if (
      !env.RADISHINK_OIDC_ISSUER ||
      !env.RADISHINK_OIDC_CLIENT_ID ||
      !path.isAbsolute(env.RADISHINK_SECRETS_DIR ?? "") ||
      /[,\r\n]/.test(env.RADISHINK_SECRETS_DIR)
    )
      throw new Error(
        "OIDC needs an issuer, client and absolute private secrets directory",
      );
  } else if (
    Object.keys(supplied).some(
      (key) =>
        key.startsWith("RADISHINK_OIDC_") && key !== "RADISHINK_OIDC_ENABLED",
    ) ||
    supplied.RADISHINK_SECRETS_DIR
  )
    throw new Error("Disabled OIDC must not have active OIDC configuration");
  return {
    env,
    oidc,
    configurationDigest: sha256(JSON.stringify(Object.entries(env).sort())),
  };
}

export function directory(filename, privateMode = true) {
  if (!path.isAbsolute(filename) || /[,\r\n]/.test(filename))
    throw new Error("Maintenance paths must be absolute and mount-safe");
  let current = path.parse(filename).root;
  for (const part of path
    .resolve(filename)
    .slice(current.length)
    .split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error("Symlink in maintenance path");
  }
  const info = fs.statSync(filename);
  if (!info.isDirectory() || (privateMode && info.mode & 0o077))
    throw new Error("Maintenance directory must be private (0700)");
  return filename;
}

export function verifyImage(metadata, lock, component) {
  const labels = metadata.Config?.Labels ?? {};
  if (
    `${metadata.Os}/${metadata.Architecture}` !== lock.platform ||
    labels["org.opencontainers.image.version"] !== lock.tag ||
    labels["org.opencontainers.image.revision"] !== lock.revision ||
    labels["org.opencontainers.image.source"] !== SOURCE ||
    metadata.Descriptor?.digest !== lock.images[component].digest ||
    ![
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].includes(metadata.Descriptor?.mediaType) ||
    !{
      server: ["node", "1000", "1000:1000"],
      web: ["nginx", "101", "101:101"],
    }[component].includes(metadata.Config?.User)
  )
    throw new Error(
      `${component} image platform or OCI source/revision/version mismatch`,
    );
}
