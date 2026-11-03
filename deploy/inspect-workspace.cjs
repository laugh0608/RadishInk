// Read-only preflight. Never use StorageDatabase here: its normal constructor
// acquires a writable process lock and enables WAL.
const fs = require("node:fs");
const Database = require("better-sqlite3");
const { serverConfig } = require("./dist/http/server-policy");
try {
  const config = serverConfig(process.env);
  const backup = fs.lstatSync("/backups");
  if (
    !backup.isDirectory() ||
    backup.isSymbolicLink() ||
    backup.uid !== process.getuid() ||
    backup.mode & 0o077 ||
    !(backup.mode & 0o200)
  )
    throw new Error("backup-permissions");
  const root = config.directory;
  for (const file of [root, `${root}/metadata.sqlite`])
    if (
      fs.lstatSync(file).isSymbolicLink() ||
      (file === root
        ? !fs.lstatSync(file).isDirectory()
        : !fs.lstatSync(file).isFile())
    )
      throw new Error("workspace-symlink");
  const wal = `${root}/metadata.sqlite-wal`;
  const shm = `${root}/metadata.sqlite-shm`;
  for (const file of [wal, shm])
    if (
      fs.existsSync(file) &&
      (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
    )
      throw new Error("workspace-symlink");
  let temporary;
  let filename = `${root}/metadata.sqlite`;
  let sourceView = "live-readonly";
  if (!fs.existsSync(wal)) {
    // A closed WAL-mode database can need new SHM files even with readonly=true.
    // Query a checkpointed copy in the probe's tmpfs; never create them on source.
    const before = fs.statSync(filename);
    temporary = fs.mkdtempSync("/tmp/radishink-readonly-");
    const copied = `${temporary}/metadata.sqlite`;
    fs.copyFileSync(filename, copied);
    const after = fs.statSync(filename);
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      fs.existsSync(wal)
    )
      throw new Error("workspace-changed");
    filename = copied;
    sourceView = "checkpointed-copy";
  }
  const db = new Database(filename, {
    readonly: true,
    fileMustExist: true,
    timeout: 1000,
  });
  try {
    const schema = db.pragma("user_version", { simple: true });
    if (![1, 2, 3].includes(schema)) throw new Error("unsupported-schema");
    const state = db
      .prepare(
        "SELECT deployment_id, workspace_epoch, account_mode FROM deployment WHERE singleton = 1",
      )
      .get();
    if (!state || state.account_mode !== config.accountMode)
      throw new Error("workspace-mode-mismatch");
    const table = schema === 2 ? "local_accounts" : "account_profiles";
    const hasAdmin =
      state.account_mode === "accounts" &&
      schema >= 2 &&
      Boolean(
        db
          .prepare(
            `SELECT 1 FROM ${table} a JOIN users u ON a.user_id=u.id WHERE a.role='admin' AND u.enabled=1 ${schema === 3 ? "AND a.admission='approved'" : ""} LIMIT 1`,
          )
          .get(),
      );
    if (state.account_mode === "accounts" && !hasAdmin)
      throw new Error("administrator-recovery-required");
    process.stdout.write(
      JSON.stringify({
        schema,
        deploymentId: state.deployment_id,
        workspaceEpoch: state.workspace_epoch,
        accountMode: state.account_mode,
        sourceView,
      }) + "\n",
    );
  } finally {
    db.close();
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
} catch (error) {
  // Never emit config objects, original IO errors, identity tokens or secrets.
  const allowed = [
    "backup-permissions",
    "workspace-symlink",
    "unsupported-schema",
    "workspace-mode-mismatch",
    "administrator-recovery-required",
    "workspace-changed",
  ];
  const code = allowed.includes(error.message)
    ? error.message
    : typeof error.code === "string"
      ? error.code
      : "preflight-failed";
  process.stderr.write(JSON.stringify({ error: code }) + "\n");
  process.exitCode = 1;
}
