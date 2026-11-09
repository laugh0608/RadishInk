import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  releaseLock,
  publicConfiguration,
  directory,
  verifyImage,
  sha256,
} from "./release-config.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const safeName = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export class Docker {
  constructor(env, signal) {
    this.env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("RADISHINK_") && !key.startsWith("COMPOSE_"),
      ),
    );
    Object.assign(this.env, env);
    this.signal = signal;
  }
  async run(args, { cleanup = false, json = false } = {}) {
    try {
      const result = await exec("docker", args, {
        env: this.env,
        signal: cleanup ? undefined : this.signal,
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return json ? JSON.parse(result.stdout) : result.stdout.trim();
    } catch (error) {
      // Docker and upstream errors may contain configuration or registry details.
      // Keep the action and exit category; do not persist raw output or argv.
      let diagnostic = "";
      try {
        const detail = JSON.parse(String(error.stderr).trim());
        const code =
          typeof detail.error === "string" ? detail.error : detail.error?.code;
        if (
          typeof code === "string" &&
          /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)
        )
          diagnostic = `; ${code}`;
      } catch {
        /* Raw Docker output remains private to the error cause. */
      }
      throw new Error(
        `docker ${args[0]} failed (${error.code ?? error.name}${diagnostic})`,
        { cause: error },
      );
    }
  }
}

export function deploymentContext({
  release,
  configuration,
  project,
  stateDir,
  upgrade = false,
  readyTimeout = 90,
  noPull = false,
}) {
  if (!safeName.test(project)) throw new Error("Invalid Compose project name");
  if (!Number.isInteger(readyTimeout) || readyTimeout < 1 || readyTimeout > 300)
    throw new Error("Readiness timeout must be 1–300 seconds");
  directory(stateDir);
  if (fs.statSync(stateDir).uid !== process.getuid())
    throw new Error("State directory must belong to the current operator");
  fs.accessSync(stateDir, fs.constants.W_OK | fs.constants.X_OK);
  const lock = releaseLock(release);
  const config = publicConfiguration(configuration);
  if (config.oidc) directory(config.env.RADISHINK_SECRETS_DIR);
  const env = {
    ...config.env,
    RADISHINK_WEB_IMAGE: lock.references.web,
    RADISHINK_SERVER_IMAGE: lock.references.server,
  };
  const composeArgs = [
    "compose",
    "--project-directory",
    root,
    "--env-file",
    "/dev/null",
    "-p",
    project,
    "-f",
    path.join(root, "deploy/compose.release.yml"),
  ];
  if (config.oidc)
    composeArgs.push("-f", path.join(root, "deploy/compose.oidc.yml"));
  return {
    lock,
    config,
    env,
    composeArgs,
    project,
    stateDir,
    upgrade,
    readyTimeout,
    noPull,
  };
}

function mounts(
  context,
  backupReadOnly = false,
  volume = context.env.RADISHINK_WORKSPACE_VOLUME,
) {
  const args = [
    "--mount",
    `type=volume,source=${volume},target=/data`,
    "--mount",
    `type=volume,source=${context.env.RADISHINK_BACKUP_VOLUME},target=/backups${backupReadOnly ? ",readonly" : ""}`,
  ];
  if (context.config.oidc)
    args.push(
      "--mount",
      `type=bind,source=${context.env.RADISHINK_SECRETS_DIR},target=/run/radishink-secrets,readonly`,
    );
  return args;
}

export function maintenanceArgs(
  context,
  command,
  { volume, readonly = false, backupReadOnly = false } = {},
) {
  const env = {
    NODE_ENV: context.env.RADISHINK_ENV,
    RADISHINK_DATA_DIR: "/data/workspace",
    RADISHINK_ORIGIN: context.env.RADISHINK_ORIGIN,
    RADISHINK_BASE_PATH: context.env.RADISHINK_BASE_PATH,
    RADISHINK_ACCOUNT_MODE: context.env.RADISHINK_ACCOUNT_MODE,
    RADISHINK_PASSWORD_LOGIN: context.env.RADISHINK_PASSWORD_LOGIN,
  };
  if (context.config.oidc)
    Object.assign(env, {
      RADISHINK_OIDC_ENABLED: "true",
      RADISHINK_OIDC_ISSUER: context.env.RADISHINK_OIDC_ISSUER,
      RADISHINK_OIDC_CLIENT_ID: context.env.RADISHINK_OIDC_CLIENT_ID,
      RADISHINK_OIDC_CLIENT_SECRET_FILE: "/run/radishink-secrets/client-secret",
      RADISHINK_OIDC_CLIENT_AUTH:
        context.env.RADISHINK_OIDC_CLIENT_AUTH ?? "client_secret_basic",
      RADISHINK_OIDC_ADMISSION:
        context.env.RADISHINK_OIDC_ADMISSION ?? "approval",
    });
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--platform",
    context.lock.platform,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    ...mounts(context, backupReadOnly, volume),
  ];
  if (readonly) {
    // Replace only the workspace mount; backups already use read-only above.
    const index = args.findIndex(
      (value) =>
        value.startsWith("type=volume,") && value.includes("target=/data"),
    );
    args[index] += ",readonly";
  }
  for (const [key, value] of Object.entries(env))
    args.push("-e", `${key}=${value}`);
  return [...args, context.lock.references.server, "node", ...command];
}

export async function preflight(context, docker) {
  for (const component of ["web", "server"]) {
    const metadata = await docker.run(
      ["image", "inspect", context.lock.references[component]],
      { json: true },
    );
    if (metadata.length !== 1) throw new Error("Image identity is ambiguous");
    verifyImage(metadata[0], context.lock, component);
  }
  for (const name of [
    context.env.RADISHINK_WORKSPACE_VOLUME,
    context.env.RADISHINK_BACKUP_VOLUME,
  ]) {
    const volumes = await docker.run(["volume", "inspect", name], {
      json: true,
    });
    if (
      volumes.length !== 1 ||
      volumes[0].Name !== name ||
      volumes[0].Driver !== "local" ||
      Object.keys(volumes[0].Options ?? {}).length
    )
      throw new Error("Only existing plain local named volumes are supported");
  }
  const composed = await docker.run(
    [...context.composeArgs, "config", "--format", "json"],
    { json: true },
  );
  if (
    composed.volumes?.workspace?.name !==
      context.env.RADISHINK_WORKSPACE_VOLUME ||
    !composed.volumes?.workspace?.external ||
    composed.services.server.image !== context.lock.references.server ||
    composed.services.web.image !== context.lock.references.web ||
    composed.services.server.ports?.length
  )
    throw new Error(
      "Resolved Compose image or volume mapping differs from the deployment lock",
    );
  const ids = await docker.run([
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${context.project}`,
  ]);
  const previous = [];
  if (ids) {
    for (const container of await docker.run(["inspect", ...ids.split(/\s+/)], {
      json: true,
    })) {
      const service = container.Config?.Labels?.["com.docker.compose.service"];
      if (!["web", "server"].includes(service))
        throw new Error("Compose project includes unrelated services");
      if (
        service === "server" &&
        !container.Mounts?.some(
          (mount) =>
            mount.Destination === "/data" &&
            mount.Name === context.env.RADISHINK_WORKSPACE_VOLUME,
        )
      )
        throw new Error("Existing server uses another workspace volume");
      previous.push({
        service,
        imageId: container.Image,
        containerId: container.Id,
      });
    }
  }
  const workspace = await docker.run(
    maintenanceArgs(context, ["inspect-workspace.cjs"], {
      readonly: true,
      backupReadOnly: true,
    }),
    { json: true },
  );
  if (
    ![1, 2, 3].includes(workspace.schema) ||
    workspace.accountMode !== context.env.RADISHINK_ACCOUNT_MODE
  )
    throw new Error("Invalid workspace inspection result");
  if (workspace.schema < 3 && !context.upgrade)
    throw new Error(
      "Schema upgrade requires explicit --upgrade before stopping services",
    );
  return {
    workspace,
    previous,
    configurationDigest: context.config.configurationDigest,
    tag: context.lock.tag,
    platform: context.lock.platform,
  };
}

function atomicRecord(filename, record) {
  const temporary = `${filename}.${record.runId}.partial`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filename);
  const parent = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}

export async function verifyEntry(context, workspace) {
  const url = new URL(
    `${context.env.RADISHINK_BASE_PATH}api/v1/capabilities`,
    context.env.RADISHINK_ORIGIN,
  );
  // Standard HTTPS validation remains enabled. Synthetic tests use loopback HTTP.
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Public same-origin entry is not ready");
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error("Public entry did not return capabilities JSON");
  }
  if (
    value.protocolVersion !== 1 ||
    value.ready !== true ||
    value.accountMode !== workspace.accountMode ||
    value.deploymentId !== workspace.deploymentId ||
    value.workspaceEpoch !== workspace.workspaceEpoch
  )
    throw new Error(
      "Public entry workspace identity differs from the inspected volume",
    );
}

export async function applyDeployment(
  context,
  docker,
  entryCheck = verifyEntry,
  report = () => {},
) {
  const runId = randomUUID();
  const name = path.join(context.stateDir, `${runId}.json`);
  const latest = path.join(context.stateDir, "latest.json");
  const record = {
    formatVersion: 1,
    runId,
    project: context.project,
    workspaceVolume: context.env.RADISHINK_WORKSPACE_VOLUME,
    backupVolume: context.env.RADISHINK_BACKUP_VOLUME,
    release: context.lock,
    configurationDigest: context.config.configurationDigest,
    stage: "preparing",
    status: "running",
    dataMayHaveChanged: false,
    history: [],
  };
  const lockFile = path.join(context.stateDir, ".deployment-lock");
  const lockFd = fs.openSync(lockFile, "wx", 0o600);
  fs.writeFileSync(
    lockFd,
    JSON.stringify({
      runId,
      pid: process.pid,
      project: context.project,
      workspaceVolume: record.workspaceVolume,
    }),
  );
  fs.fsyncSync(lockFd);
  let containerLock,
    verificationVolume,
    stopped = false,
    started = false;
  const save = (stage) => {
    started = true;
    record.stage = stage;
    record.history.push({ stage, at: new Date().toISOString() });
    atomicRecord(name, record);
    atomicRecord(latest, record);
    report(stage);
  };
  try {
    if (fs.existsSync(latest)) {
      const info = fs.lstatSync(latest);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("Invalid previous deployment record");
      let previous;
      try {
        previous = JSON.parse(fs.readFileSync(latest, "utf8"));
      } catch {
        throw new Error("Invalid previous deployment record");
      }
      if (
        previous.formatVersion !== 1 ||
        typeof previous.workspaceVolume !== "string" ||
        !["running", "succeeded", "failed"].includes(previous.status) ||
        typeof previous.dataMayHaveChanged !== "boolean"
      )
        throw new Error("Invalid previous deployment record");
      if (previous.project !== context.project)
        throw new Error("State directory belongs to another deployment");
      if (
        previous.workspaceVolume === record.workspaceVolume &&
        previous.status !== "succeeded" &&
        previous.dataMayHaveChanged
      )
        throw new Error(
          "Previous deployment may have changed data; recover and inspect an independent target before retrying",
        );
    }
    save("preparing-images");
    if (!context.noPull) {
      for (const component of ["server", "web"])
        await docker.run([
          "pull",
          "--platform",
          context.lock.platform,
          context.lock.references[component],
        ]);
    }
    save("preflight");
    const before = await preflight(context, docker);
    record.before = before;
    const lockName = `radishink-maintenance-${sha256(record.workspaceVolume).slice(0, 24)}`;
    containerLock = await docker.run([
      "create",
      "--name",
      lockName,
      "--label",
      `radishink.maintenance.run=${runId}`,
      "--network",
      "none",
      context.lock.references.server,
      "node",
      "-e",
      "",
    ]);
    save("stopping-entry");
    // Set before stop: a partially failed stop must still keep the entry closed.
    stopped = true;
    await docker.run([...context.composeArgs, "stop", "web"]);
    save("stopping-server");
    await docker.run([...context.composeArgs, "stop", "server"]);
    // Recheck identity after quiescing; active SQLite snapshots can change before stop.
    const quiet = await docker.run(
      maintenanceArgs(context, ["inspect-workspace.cjs"], {
        readonly: true,
        backupReadOnly: true,
      }),
      { json: true },
    );
    if (
      quiet.deploymentId !== before.workspace.deploymentId ||
      quiet.workspaceEpoch !== before.workspace.workspaceEpoch ||
      quiet.schema !== before.workspace.schema
    )
      throw new Error(
        "Workspace changed during preflight; inspect before retrying",
      );
    save("backing-up");
    await docker.run(
      maintenanceArgs(context, [
        "-e",
        "require('node:fs').mkdirSync(process.argv[1], {mode:0o700})",
        `/backups/${runId}`,
      ]),
    );
    const backupPath = `/backups/${runId}/snapshot`;
    record.backupPath = backupPath;
    const mode = context.env.RADISHINK_ACCOUNT_MODE;
    const backup = await docker.run(
      maintenanceArgs(context, [
        "dist/storage/storage-cli.js",
        "backup",
        "--data-dir",
        "/data/workspace",
        "--mode",
        mode,
        "--backup-dir",
        backupPath,
      ]),
      { json: true },
    );
    record.backup = {
      schema: backup.schema,
      files: backup.files,
      bytes: backup.bytes,
      deploymentId: backup.deploymentId,
      workspaceEpoch: backup.workspaceEpoch,
    };
    save("verifying-backup");
    verificationVolume = `radishink-backup-check-${runId}`;
    await docker.run(["volume", "create", verificationVolume]);
    const restored = await docker.run(
      maintenanceArgs(
        context,
        [
          "dist/storage/storage-cli.js",
          "restore",
          "--data-dir",
          "/data/checked",
          "--mode",
          mode,
          "--backup-dir",
          backupPath,
        ],
        { volume: verificationVolume, backupReadOnly: true },
      ),
      { json: true },
    );
    if (
      restored.schema !== backup.schema ||
      restored.deploymentId !== backup.deploymentId ||
      restored.workspaceEpoch === backup.workspaceEpoch
    )
      throw new Error(
        "Independent backup restore identity verification failed",
      );
    await docker.run(["volume", "rm", verificationVolume]);
    verificationVolume = undefined;
    let schema = backup.schema;
    if (schema < 3) {
      record.dataMayHaveChanged = true;
      save("upgrading-schema");
      for (; schema < 3; schema++)
        await docker.run(
          maintenanceArgs(context, [
            "dist/auth/account-cli.js",
            schema === 1 ? "upgrade-auth" : "upgrade-oidc",
            "--data-dir",
            "/data/workspace",
            "--mode",
            mode,
            "--backup-dir",
            `/backups/${runId}/upgrade-${schema}`,
          ]),
        );
    }
    save("checking-storage");
    const checked = await docker.run(
      maintenanceArgs(context, [
        "dist/storage/storage-cli.js",
        "check",
        "--data-dir",
        "/data/workspace",
        "--mode",
        mode,
      ]),
      { json: true },
    );
    if (checked.unknownPaths?.length)
      throw new Error("Storage inspection found unknown files");
    const after = await docker.run(
      maintenanceArgs(context, ["inspect-workspace.cjs"], {
        readonly: true,
        backupReadOnly: true,
      }),
      { json: true },
    );
    if (after.schema !== 3 || after.deploymentId !== backup.deploymentId)
      throw new Error("Storage schema or identity differs after maintenance");
    record.after = after;
    record.dataMayHaveChanged = true;
    save("starting-server");
    const up = [
      "up",
      "-d",
      "--no-build",
      "--pull",
      "never",
      "--wait",
      "--wait-timeout",
      String(context.readyTimeout),
    ];
    await docker.run([...context.composeArgs, ...up, "server"]);
    const serverHealth = await docker.run([
      ...context.composeArgs,
      "ps",
      "--status",
      "running",
      "--format",
      "{{.Health}}",
      "server",
    ]);
    if (serverHealth !== "healthy")
      throw new Error("Server did not report healthy after Compose wait");
    save("restoring-entry");
    await docker.run([...context.composeArgs, ...up, "web"]);
    save("verifying-entry");
    if (docker.signal?.aborted) throw new Error("Deployment interrupted");
    await entryCheck(context, after);
    if (docker.signal?.aborted) throw new Error("Deployment interrupted");
    record.status = "succeeded";
    save("ready");
    return record;
  } catch (error) {
    if (!started) throw error;
    record.status = "failed";
    record.failedStage = record.stage;
    record.error = error.message;
    if (stopped) {
      try {
        await docker.run([...context.composeArgs, "stop", "web", "server"], {
          cleanup: true,
        });
        record.entryStopped = true;
      } catch {
        record.entryStopped = false;
        record.stopFailed = true;
      }
    }
    save(record.failedStage);
    throw new Error(
      `Deployment failed at ${record.failedStage}; record: ${name}`,
      { cause: error },
    );
  } finally {
    if (verificationVolume) {
      // An incomplete independent restore is evidence. It is never mounted by
      // the application or reused automatically; the operator inspects/removes it.
      record.verificationVolumeRetained = verificationVolume;
      atomicRecord(name, record);
      atomicRecord(latest, record);
    }
    try {
      if (containerLock) {
        try {
          await docker.run(["rm", containerLock], { cleanup: true });
        } catch {
          record.maintenanceLockRetained = containerLock;
          atomicRecord(name, record);
          atomicRecord(latest, record);
          throw new Error(
            `Maintenance lock cleanup failed; inspect record: ${name}`,
          );
        }
      }
    } finally {
      fs.closeSync(lockFd);
      fs.unlinkSync(lockFile);
    }
  }
}
