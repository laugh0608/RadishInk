// Local-only synthetic release labels/digests. Never pushes to the named registry.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  Docker,
  deploymentContext,
  maintenanceArgs,
  preflight,
  applyDeployment,
} from "./release-deploy.mjs";
import { SOURCE, REPOSITORIES, sha256 } from "./release-config.mjs";

const { values } = parseArgs({
  options: { server: { type: "string" }, web: { type: "string" } },
});
if (!values.server || !values.web)
  throw new Error("--server and --web final images are required");
const raw = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const temporary = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "radishink-release-smoke-")),
);
const stateDir = path.join(temporary, "state");
fs.mkdirSync(stateDir, { mode: 0o700 });
const project = `radishink-release-${randomUUID().slice(0, 8)}`;
const workspace = `${project}-workspace`,
  backups = `${project}-backups`;
const volumes = new Set(),
  tags = new Set();
const platform = JSON.parse(raw(["image", "inspect", values.server]))[0];
const imagePlatform = `${platform.Os}/${platform.Architecture}`;
const port = 4294;
const revision = "f".repeat(40);
let context;
const deploymentCli = fileURLToPath(new URL("./deploy.mjs", import.meta.url));
function cli(command, release, configuration) {
  const releaseFile = path.join(temporary, "release.json");
  const envFile = path.join(temporary, "public.env");
  fs.writeFileSync(releaseFile, JSON.stringify(release));
  fs.writeFileSync(
    envFile,
    Object.entries(configuration)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
  );
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        deploymentCli,
        command,
        "--release",
        releaseFile,
        "--env-file",
        envFile,
        "--project",
        project,
        "--state-dir",
        stateDir,
        "--no-pull",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 },
    ),
  );
}
const abort = new AbortController();
const cancel = () => abort.abort(new Error("Synthetic deployment interrupted"));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const dockerFor = (target = context) => new Docker(target.env, abort.signal);
console.log(
  `Synthetic release smoke pid=${process.pid} port=${port} platform=${imagePlatform}`,
);
function fixtureImage(component, base, tag, badHealth = false) {
  const dockerfile = path.join(temporary, "Dockerfile");
  fs.writeFileSync(
    dockerfile,
    `FROM ${base}\n${badHealth ? "USER root\nRUN echo 'process.exit(1)' > /app/healthcheck.cjs\nUSER node\n" : ""}`,
  );
  const name = `${REPOSITORIES[component]}:${tag}`;
  raw([
    "buildx",
    "build",
    "--platform",
    imagePlatform,
    "--output",
    "type=docker,oci-mediatypes=true",
    "--provenance=false",
    "--label",
    `org.opencontainers.image.version=${tag}`,
    "--label",
    `org.opencontainers.image.revision=${revision}`,
    "--label",
    `org.opencontainers.image.source=${SOURCE}`,
    "-t",
    name,
    "-f",
    dockerfile,
    temporary,
  ]);
  tags.add(name);
  const metadata = JSON.parse(raw(["image", "inspect", name]))[0];
  assert.ok(
    metadata.Descriptor,
    "Docker image store must expose manifest descriptors",
  );
  assert.equal(
    metadata.Descriptor.mediaType,
    "application/vnd.oci.image.manifest.v1+json",
  );
  return metadata.Descriptor.digest;
}
function buildLock(tag, badHealth = false) {
  return {
    formatVersion: 1,
    tag,
    revision,
    platform: imagePlatform,
    images: {
      server: { digest: fixtureImage("server", values.server, tag, badHealth) },
      web: { digest: fixtureImage("web", values.web, tag) },
    },
  };
}
function makeContext(release, volume = workspace, upgrade = false) {
  return deploymentContext({
    release,
    configuration: `RADISHINK_ORIGIN=http://127.0.0.1:${port}\nRADISHINK_PORT=${port}\nRADISHINK_BASE_PATH=/nested/\nRADISHINK_ENV=development\nRADISHINK_ACCOUNT_MODE=shared\nRADISHINK_PASSWORD_LOGIN=false\nRADISHINK_WORKSPACE_VOLUME=${volume}\nRADISHINK_BACKUP_VOLUME=${backups}\n`,
    project,
    stateDir,
    noPull: true,
    upgrade,
    readyTimeout: 30,
  });
}
function createVolume(name) {
  raw(["volume", "create", name]);
  volumes.add(name);
  // Explicit initial preparation, using the final image's node-owned /data.
  raw([
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--platform",
    imagePlatform,
    "--mount",
    `type=volume,source=${name},target=/data`,
    values.server,
    "node",
    "-e",
    "",
  ]);
}
const readRecord = () =>
  JSON.parse(fs.readFileSync(path.join(stateDir, "latest.json"), "utf8"));
async function offline(code, args = [], target = context) {
  const docker = dockerFor(target);
  return docker.run(maintenanceArgs(target, ["-e", code, ...args]), {
    json: true,
  });
}
const seed = `
  const {randomUUID}=require('node:crypto');
  const {StorageDatabase,SHARED_OWNER}=require('./dist/storage/storage-database');
  const {ArticleRepository}=require('./dist/storage/article-repository');
  const {sha256}=require('./dist/storage/storage-contract');
  const {AUTH_MIGRATION}=require('./dist/storage/storage-auth-schema');
  (async()=>{
    const db=new StorageDatabase({directory:'/data/workspace',mode:'shared',initialize:true});
    const store=new ArticleRepository(db); const id=randomUUID();
    const png=await require('sharp')({create:{width:2,height:3,channels:4,background:'#345678'}}).png().toBuffer();
    store.commit({ownerId:SHARED_OWNER,articleId:id,operationId:randomUUID(),expectedRevision:null,
      markdown:'Synthetic deployment article\\n![pixel](asset/pixel.png)\\n',
      metadata:{id,title:'Synthetic release',savedAt:'2026-11-03T00:00:00.000Z',theme:'',themeName:'',customCSS:''},
      assets:[{path:'asset/pixel.png',bytes:png,sha256:sha256(png),size:png.length}]});
    if(process.argv[1]==='legacy'){
      db.connection.exec('DROP TABLE oidc_attempts; DROP TABLE oidc_identities; DROP TABLE password_credentials; DROP TABLE account_profiles; DROP TABLE sessions; DROP TABLE login_limits; DELETE FROM schema_migrations WHERE version=3; PRAGMA user_version=2');
      db.connection.exec(AUTH_MIGRATION); db.verifySchema();
    }
    const result={id, png:png.toString('base64'), markdown:store.read(SHARED_OWNER,id).markdown};
    db.close(); console.log(JSON.stringify(result));
  })().catch(e=>{console.error(e.code||e.message);process.exitCode=1});
`;
const snapshot = `const {StorageDatabase,SHARED_OWNER}=require('./dist/storage/storage-database');const {ArticleRepository}=require('./dist/storage/article-repository'); const db=new StorageDatabase({directory:'/data/workspace',mode:'shared'});try { console.log(JSON.stringify(new ArticleRepository(db).read(SHARED_OWNER,process.argv[1]))); }finally{db.close()}`;
async function api(pathname, options = {}) {
  const response = await fetch(
    `http://127.0.0.1:${port}/nested/api/v1${pathname}`,
    { ...options, signal: AbortSignal.timeout(10_000) },
  );
  return response;
}
async function articleCheck(seeded, save = false) {
  const cap = await (await api("/capabilities")).json();
  const headers = {
    "X-RadishInk-Workspace": `${cap.deploymentId}/${cap.workspaceEpoch}`,
  };
  const response = await api(`/articles/${seeded.id}`, { headers });
  assert.equal(response.status, 200);
  const article = await response.json();
  assert.equal(article.markdown, seeded.markdown);
  const image = await api(
    `/articles/${seeded.id}/assets/pixel.png?revision=${article.revision}`,
    { headers },
  );
  assert.equal(image.status, 200);
  assert.deepEqual(
    Buffer.from(await image.arrayBuffer()),
    Buffer.from(seeded.png, "base64"),
  );
  if (save) {
    const session = await api("/auth/session");
    const identity = await session.json();
    const form = new FormData();
    form.append(
      "manifest",
      JSON.stringify({
        operationId: randomUUID(),
        expectedRevision: article.revision,
        metadata: article.metadata,
        assets: article.assets,
      }),
    );
    seeded.markdown += "Saved after controlled deployment\n";
    form.append("markdown", new Blob([seeded.markdown]), "index.md");
    const saved = await api(`/articles/${seeded.id}`, {
      method: "PUT",
      headers: {
        ...headers,
        Origin: `http://127.0.0.1:${port}`,
        Cookie: session.headers.getSetCookie()[0].split(";")[0],
        "X-CSRF-Token": identity.csrfToken,
      },
      body: form,
    });
    assert.equal(saved.status, 200, await saved.text());
  }
  return headers;
}
async function assertClosed() {
  await assert.rejects(api("/capabilities"));
}
function mutateVolume(volume, code) {
  raw([
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--platform",
    imagePlatform,
    "--user",
    "root",
    "--mount",
    `type=volume,source=${volume},target=/target`,
    values.server,
    "node",
    "-e",
    code,
  ]);
}
async function clean() {
  for (const file of fs
    .readdirSync(stateDir)
    .filter((name) => name.endsWith(".json"))) {
    const record = JSON.parse(
      fs.readFileSync(path.join(stateDir, file), "utf8"),
    );
    if (
      record.project === project &&
      record.verificationVolumeRetained ===
        `radishink-backup-check-${record.runId}`
    )
      volumes.add(record.verificationVolumeRetained);
  }
  if (context) {
    try {
      await dockerFor().run(
        [...context.composeArgs, "down", "--remove-orphans"],
        { cleanup: true },
      );
    } catch (error) {
      console.error(error.message);
    }
  }
  for (const name of volumes) raw(["volume", "rm", name]);
  for (const name of tags) raw(["image", "rm", name]);
  fs.rmSync(temporary, { recursive: true, force: true });
}
try {
  const release = buildLock(`v99.12.${Date.now()}-test`);
  context = makeContext(release);
  createVolume(workspace);
  createVolume(backups);
  const seeded = await offline(seed);
  const accountVolume = `${project}-accounts-probe`;
  createVolume(accountVolume);
  const accountContext = deploymentContext({
    release,
    configuration: `RADISHINK_ORIGIN=http://127.0.0.1:${port}\nRADISHINK_PORT=${port}\nRADISHINK_ENV=development\nRADISHINK_ACCOUNT_MODE=accounts\nRADISHINK_PASSWORD_LOGIN=true\nRADISHINK_WORKSPACE_VOLUME=${accountVolume}\nRADISHINK_BACKUP_VOLUME=${backups}\n`,
    project: `${project}-accounts`,
    stateDir,
    noPull: true,
  });
  await offline(
    `const {StorageDatabase}=require('./dist/storage/storage-database');const {manageAccount}=require('./dist/auth/local-auth');(async()=>{const db=new StorageDatabase({directory:'/data/workspace',mode:'accounts',initialize:true});try{await manageAccount(db.connection,'init-admin','syntheticadmin','synthetic-deployment-password');console.log('{}')}finally{db.close()}})().catch(()=>{process.exitCode=1})`,
    [],
    accountContext,
  );
  await preflight(accountContext, dockerFor(accountContext));
  const docker = dockerFor();
  const before = await offline(snapshot, [seeded.id]);
  await preflight(context, docker);
  assert.equal(
    cli("preflight", release, context.config.env).workspace.schema,
    3,
  );
  assert.deepEqual(await offline(snapshot, [seeded.id]), before);
  assert.deepEqual(fs.readdirSync(stateDir), []);
  const installed = cli("apply", release, context.config.env);
  assert.equal(installed.stage, "ready");
  await articleCheck(seeded, true);
  const oldHeaders = await articleCheck(seeded);
  console.log(
    `PASS ${imagePlatform}: fixed-image installation, article/image preservation and HTTP save`,
  );
  // A second application of the same fixed images still backs up before restart.
  await applyDeployment(context, docker);
  await assert.rejects(
    applyDeployment(context, docker, undefined, (stage) => {
      if (stage === "verifying-backup") {
        const run = readRecord().runId;
        mutateVolume(
          backups,
          `require('node:fs').writeFileSync('/target/${run}/snapshot/backup-manifest.json','corrupt synthetic backup')`,
        );
      }
    }),
    /verifying-backup/,
  );
  const verificationFailed = readRecord();
  assert.ok(verificationFailed.verificationVolumeRetained);
  volumes.add(verificationFailed.verificationVolumeRetained);
  assert.equal(verificationFailed.dataMayHaveChanged, false);
  await assertClosed();
  assert.equal(
    (await offline(snapshot, [seeded.id])).markdown,
    seeded.markdown,
  );
  await applyDeployment(context, docker);
  await articleCheck(seeded);
  const forged = {
    ...context,
    lock: { ...context.lock, revision: "e".repeat(40) },
  };
  await assert.rejects(preflight(forged, docker), /mismatch/);
  assert.equal((await api("/capabilities")).status, 200);
  const unavailable = structuredClone(context);
  unavailable.lock.references.server = `${REPOSITORIES.server}:${release.tag}@sha256:${"9".repeat(64)}`;
  await assert.rejects(applyDeployment(unavailable, docker), /preflight/);
  assert.equal((await api("/capabilities")).status, 200);
  console.log(
    `PASS ${imagePlatform}: read-only preflight and missing/forged images leave the running entry intact`,
  );
  await assert.rejects(
    applyDeployment(context, docker, undefined, (stage) => {
      if (stage === "backing-up")
        mutateVolume(backups, "require('node:fs').chmodSync('/target',0o500)");
    }),
    /backing-up/,
  );
  assert.equal(readRecord().dataMayHaveChanged, false);
  await assertClosed();
  mutateVolume(backups, "require('node:fs').chmodSync('/target',0o700)");
  assert.equal(
    (await offline(snapshot, [seeded.id])).markdown,
    seeded.markdown,
  );
  await applyDeployment(context, docker);
  await assert.rejects(
    applyDeployment(context, docker, undefined, (stage) => {
      if (stage === "checking-storage")
        mutateVolume(
          workspace,
          "require('node:fs').writeFileSync('/target/workspace/unexpected','synthetic fault')",
        );
    }),
    /checking-storage/,
  );
  assert.equal(readRecord().entryStopped, true);
  await assertClosed();
  mutateVolume(
    workspace,
    "require('node:fs').unlinkSync('/target/workspace/unexpected')",
  );
  assert.equal(
    (await offline(snapshot, [seeded.id])).markdown,
    seeded.markdown,
  );
  console.log(
    `PASS ${imagePlatform}: actual backup permission and storage faults stop the entry and retain the source`,
  );
  const failedRelease = buildLock(`v99.12.${Date.now()}-test`, true);
  context = makeContext(failedRelease);
  context.readyTimeout = 2;
  await assert.rejects(
    applyDeployment(context, dockerFor()),
    /starting-server/,
  );
  const failed = readRecord();
  assert.equal(failed.dataMayHaveChanged, true);
  await assertClosed();
  const bytes = fs.readFileSync(path.join(stateDir, "latest.json"));
  await assert.rejects(
    applyDeployment(context, dockerFor()),
    /Previous deployment/,
  );
  assert.deepEqual(fs.readFileSync(path.join(stateDir, "latest.json")), bytes);
  const recovered = `${project}-recovered`;
  createVolume(recovered);
  const healthy = makeContext(release, recovered);
  await dockerFor(healthy).run(
    maintenanceArgs(
      healthy,
      [
        "dist/storage/storage-cli.js",
        "restore",
        "--data-dir",
        "/data/workspace",
        "--mode",
        "shared",
        "--backup-dir",
        failed.backupPath,
      ],
      { backupReadOnly: true },
    ),
  );
  await dockerFor().run([...context.composeArgs, "down", "--remove-orphans"]);
  context = healthy;
  await applyDeployment(context, dockerFor());
  await articleCheck(seeded);
  assert.equal(
    (await api(`/articles/${seeded.id}`, { headers: oldHeaders })).status,
    409,
  );
  console.log(
    `PASS ${imagePlatform}: real readiness failure, retry guard, independent recovery and old-epoch rejection`,
  );
  // Legacy schema is created only in another synthetic volume.
  await dockerFor().run([...context.composeArgs, "stop", "web", "server"]);
  await dockerFor().run([...context.composeArgs, "down", "--remove-orphans"]);
  const legacy = `${project}-legacy`;
  createVolume(legacy);
  context = makeContext(release, legacy, true);
  const legacyArticle = await offline(seed, ["legacy"]);
  await assert.rejects(
    preflight({ ...context, upgrade: false }, dockerFor()),
    /explicit --upgrade/,
  );
  await applyDeployment(context, dockerFor());
  await articleCheck(legacyArticle);
  assert.equal(readRecord().before.workspace.schema, 2);
  assert.equal(readRecord().after.schema, 3);
  console.log(
    `PASS ${imagePlatform}: explicit schema 2→3 upgrade with backup, independent validation and preserved article/image`,
  );
  await dockerFor().run([...context.composeArgs, "down", "--remove-orphans"]);
  const interrupted = `${project}-interrupted`;
  createVolume(interrupted);
  context = makeContext(release, interrupted, true);
  const interruptedArticle = await offline(seed, ["legacy"]);
  const cancellation = new AbortController();
  await assert.rejects(
    applyDeployment(
      context,
      new Docker(
        context.env,
        AbortSignal.any([abort.signal, cancellation.signal]),
      ),
      undefined,
      (stage) => {
        if (stage === "upgrading-schema") cancellation.abort();
      },
    ),
    /upgrading-schema/,
  );
  const interruptedRecord = readRecord();
  assert.equal(interruptedRecord.dataMayHaveChanged, true);
  assert.equal(interruptedRecord.entryStopped, true);
  await assert.rejects(
    applyDeployment(context, dockerFor()),
    /Previous deployment/,
  );
  const migratedTarget = `${project}-migrated-target`;
  createVolume(migratedTarget);
  await dockerFor().run(
    maintenanceArgs(
      context,
      [
        "dist/storage/storage-cli.js",
        "restore",
        "--data-dir",
        "/data/workspace",
        "--mode",
        "shared",
        "--backup-dir",
        interruptedRecord.backupPath,
      ],
      { volume: migratedTarget, backupReadOnly: true },
    ),
  );
  context = makeContext(release, migratedTarget, true);
  await applyDeployment(context, dockerFor());
  await articleCheck(interruptedArticle);
  console.log(
    `PASS ${imagePlatform}: cancelled upgrade stays closed and recovers through a new volume; corrupt backup retains verification evidence`,
  );
} catch (error) {
  let cause = error;
  for (let depth = 0; depth < 4 && cause; depth++, cause = cause.cause)
    if (cause.stderr) console.error(String(cause.stderr).slice(-1800));
  throw error;
} finally {
  await clean();
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
}
