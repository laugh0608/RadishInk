import { createHash } from "node:crypto";
import https from "node:https";
import http from "node:http";

export const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];
export const MANIFEST_TYPES = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
];
export const contentDigest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export function validDigest(value) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value) || /^sha256:0+$/.test(value))
    throw new Error("Invalid content digest");
  return value;
}

// Read-only Registry V2 client. Tag redirects fail; blob redirects drop credentials.
export function registryClient({
  origin = "https://ghcr.io",
  username,
  password,
  allowLoopback = false,
} = {}) {
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(
        allowLoopback &&
        base.protocol === "http:" &&
        base.hostname === "127.0.0.1"
      ))
  )
    throw new Error(
      "Registry requires HTTPS (explicit loopback fixtures only)",
    );
  if ((username && !password) || (!username && password))
    throw new Error("Both GHCR credential fields are required");
  const tokens = new Map();
  const request = (url, headers = {}) =>
    new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const req = transport.get(
        url,
        { headers, signal: AbortSignal.timeout(30_000) },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024)
              res.destroy(new Error("Registry response too large"));
            else chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              bytes: Buffer.concat(chunks),
            }),
          );
          res.on("error", () => reject(new Error("Registry response failed")));
        },
      );
      req.on("error", () =>
        reject(new Error("Registry request failed or timed out")),
      );
    });
  async function get(repository, kind, reference, { absent = false } = {}) {
    if (!/^laugh0608\/radishink-(web|server)$/.test(repository))
      throw new Error("Unexpected registry repository");
    if (kind === "blobs") validDigest(reference);
    else if (!/^(?:sha256:[a-f0-9]{64}|v[0-9A-Za-z.-]+)$/.test(reference))
      throw new Error("Invalid manifest reference");
    const url = new URL(`/v2/${repository}/${kind}/${reference}`, base);
    const headers = { Accept: [...INDEX_TYPES, ...MANIFEST_TYPES].join(", ") };
    if (tokens.has(repository))
      headers.Authorization = `Bearer ${tokens.get(repository)}`;
    let response = await request(url, headers);
    if (response.status === 401 && base.origin === "https://ghcr.io") {
      const challenge = response.headers["www-authenticate"] ?? "";
      if (
        !/^Bearer\s/i.test(challenge) ||
        !/realm="https:\/\/ghcr\.io\/token"/.test(challenge)
      )
        throw new Error("Unexpected GHCR authentication challenge");
      const tokenUrl = new URL("https://ghcr.io/token");
      tokenUrl.search = new URLSearchParams({
        service: "ghcr.io",
        scope: `repository:${repository}:pull`,
      });
      const auth = username
        ? {
            Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          }
        : {};
      const tokenResponse = await request(tokenUrl, auth);
      if (tokenResponse.status !== 200)
        throw new Error(`Registry token HTTP ${tokenResponse.status}`);
      let token;
      try {
        token = JSON.parse(tokenResponse.bytes).token;
      } catch {
        throw new Error("Malformed registry token response");
      }
      if (typeof token !== "string" || !token || /[\r\n]/.test(token))
        throw new Error("Missing registry token");
      tokens.set(repository, token);
      headers.Authorization = `Bearer ${token}`;
      response = await request(url, headers);
    }
    if (kind === "blobs") {
      let current = url;
      for (
        let redirects = 0;
        [302, 307].includes(response.status);
        redirects++
      ) {
        if (redirects >= 5 || !response.headers.location)
          throw new Error("Excessive or missing blob redirect");
        let next;
        try {
          next = new URL(response.headers.location, current);
        } catch {
          throw new Error("Invalid blob redirect");
        }
        const production =
          next.protocol === "https:" &&
          (next.hostname === "ghcr.io" ||
            next.hostname === "pkg-containers.githubusercontent.com");
        const fixture = allowLoopback && next.origin === base.origin;
        if (
          (!production && !fixture) ||
          next.username ||
          next.password ||
          next.hash
        )
          throw new Error("Untrusted blob redirect");
        current = next;
        response = await request(current, { Accept: "application/json" });
      }
    }
    if (response.status === 404 && absent) {
      // A reverse proxy's generic 404 must never authorize a tag write.
      let body;
      try {
        body = JSON.parse(response.bytes);
      } catch {
        throw new Error("Unconfirmed registry absence");
      }
      if (
        !Array.isArray(body.errors) ||
        !body.errors.length ||
        !body.errors.every((error) => error.code === "MANIFEST_UNKNOWN") ||
        response.headers["docker-distribution-api-version"] !== "registry/2.0"
      )
        throw new Error("Unconfirmed registry absence");
      return null;
    }
    if (response.status !== 200)
      throw new Error(`Registry ${kind} HTTP ${response.status}`);
    const digest = contentDigest(response.bytes);
    if (reference.startsWith("sha256:") && digest !== reference)
      throw new Error("Registry response digest mismatch");
    const declared = response.headers["docker-content-digest"];
    if (declared && declared !== digest)
      throw new Error("Registry content header mismatch");
    let json;
    try {
      json = JSON.parse(response.bytes);
    } catch {
      throw new Error("Malformed registry JSON");
    }
    if (kind === "manifests") {
      if (
        json.schemaVersion !== 2 ||
        ![...INDEX_TYPES, ...MANIFEST_TYPES].includes(json.mediaType) ||
        response.headers["content-type"]?.split(";")[0] !== json.mediaType
      )
        throw new Error("Unsupported registry manifest media type");
    }
    return { digest, json, size: response.bytes.length };
  }
  return {
    manifest: (repo, ref, options) => get(repo, "manifests", ref, options),
    blob: (repo, ref) => get(repo, "blobs", ref),
  };
}

export async function immutableTagCheck(client, { tag, images }) {
  const results = [];
  // Check both repositories, including on a resumed partial publication.
  for (const component of ["web", "server"]) {
    const expected = images[component];
    validDigest(expected.digest);
    const repository = `laugh0608/radishink-${component}`;
    const existing = await client.manifest(repository, tag, { absent: true });
    if (existing && existing.digest !== expected.digest)
      throw new Error(
        `Full tag conflict: ${component}:${tag}; overwrite forbidden`,
      );
    results.push({
      component,
      tag,
      digest: expected.digest,
      state: existing ? "reuse" : "absent",
    });
  }
  return results;
}
