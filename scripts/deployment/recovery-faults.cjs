// 在最终服务端镜像中运行：独立 tmpfs 模拟真实 ENOSPC，同时验证旧 schema 升级/恢复。
// docker run --rm --read-only --tmpfs /data:uid=1000,gid=1000,mode=0700,size=64m \
//   --tmpfs /restore:uid=1000,gid=1000,mode=0700,size=1m \
//   -i radishink-p4-test-server node < scripts/deployment/recovery-faults.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { StorageDatabase } = require("/app/dist/storage/storage-database");
const { ArticleRepository } = require("/app/dist/storage/article-repository");
const {
  backupStorage,
  restoreStorage,
} = require("/app/dist/storage/storage-backup");
const { AUTH_MIGRATION } = require("/app/dist/storage/storage-auth-schema");
const { LocalAuth, manageAccount } = require("/app/dist/auth/local-auth");
const cli = (args, success = true) => {
  const result = spawnSync(
    process.execPath,
    ["/app/dist/storage/storage-cli.js", ...args],
    { encoding: "utf8" },
  );
  if (success) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0);
  return result;
};
(async () => {
  let db = new StorageDatabase({
    directory: "/data/source",
    mode: "accounts",
    initialize: true,
  });
  const user = await manageAccount(
    db.connection,
    "init-admin",
    "alice",
    "synthetic-recovery-password",
  );
  const article = randomUUID(),
    markdown = "x".repeat(3 * 1024 * 1024);
  new ArticleRepository(db).commit({
    ownerId: user.userId,
    articleId: article,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown,
    metadata: {
      id: article,
      title: "synthetic ENOSPC",
      savedAt: "2026-10-29T00:00:00Z",
      theme: "",
      themeName: "",
      customCSS: "",
    },
    assets: [],
  });
  const oldIdentity = db.deployment;
  db.close();
  cli([
    "backup",
    "--data-dir",
    "/data/source",
    "--mode",
    "accounts",
    "--backup-dir",
    "/data/backup",
  ]);
  const failed = cli(
    [
      "restore",
      "--data-dir",
      "/restore/destination",
      "--mode",
      "accounts",
      "--backup-dir",
      "/data/backup",
    ],
    false,
  );
  assert.equal(JSON.parse(failed.stderr).error.systemCode, "ENOSPC");
  assert(fs.existsSync("/restore/destination/maintenance-incomplete"));
  assert.throws(
    () =>
      new StorageDatabase({
        directory: "/restore/destination",
        mode: "accounts",
      }),
  );
  cli([
    "restore",
    "--data-dir",
    "/data/restored",
    "--mode",
    "accounts",
    "--backup-dir",
    "/data/backup",
  ]);
  db = new StorageDatabase({ directory: "/data/restored", mode: "accounts" });
  assert.equal(
    new ArticleRepository(db).read(user.userId, article).markdown,
    markdown,
  );
  assert.notEqual(db.deployment.workspaceEpoch, oldIdentity.workspaceEpoch);
  console.log(
    "PASS 最终 Linux 镜像真实 tmpfs ENOSPC 拒绝，半成品不能启动，原备份在新目录恢复成功",
  );
  // 从实际 schema 3 合成历史 schema 2；保留当年的迁移 SQL/摘要，不降级实际用户数据。
  const passwordHash = db.connection
    .prepare("SELECT password_hash FROM password_credentials WHERE user_id=?")
    .get(user.userId).password_hash;
  db.connection.exec(
    "DROP TABLE oidc_attempts; DROP TABLE oidc_identities; DROP TABLE password_credentials; DROP TABLE account_profiles; DROP TABLE sessions; DROP TABLE login_limits; DELETE FROM schema_migrations WHERE version=3; PRAGMA user_version=2",
  );
  db.connection.exec(AUTH_MIGRATION);
  db.connection
    .prepare("INSERT INTO local_accounts VALUES (?,?,?,?)")
    .run(user.userId, "alice", passwordHash, "admin");
  db.verifySchema();
  db.close();
  const refused = spawnSync(
    process.execPath,
    [
      "/app/dist/auth/account-cli.js",
      "upgrade-oidc",
      "--data-dir",
      "/data/restored",
      "--backup-dir",
      "/data/restored/invalid-backup",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(refused.status, 0);
  const unchanged = new StorageDatabase({
    directory: "/data/restored",
    mode: "accounts",
  });
  try {
    assert.equal(
      unchanged.connection.pragma("user_version", { simple: true }),
      2,
    );
    assert.equal(
      new ArticleRepository(unchanged).read(user.userId, article).markdown,
      markdown,
    );
  } finally {
    unchanged.close();
  }
  const upgrade = spawnSync(
    process.execPath,
    [
      "/app/dist/auth/account-cli.js",
      "upgrade-oidc",
      "--data-dir",
      "/data/restored",
      "--backup-dir",
      "/data/before-v3",
    ],
    { encoding: "utf8" },
  );
  assert.equal(upgrade.status, 0, upgrade.stderr);
  db = new StorageDatabase({ directory: "/data/restored", mode: "accounts" });
  try {
    const auth = new LocalAuth(db.connection);
    await auth.initialize();
    assert.equal(
      (await auth.login("alice", "synthetic-recovery-password", "test"))
        .identity.userId,
      user.userId,
    );
    assert.equal(
      new ArticleRepository(db).read(user.userId, article).markdown,
      markdown,
    );
  } finally {
    db.close();
  }
  const legacy = restoreStorage(
    "/data/legacy-restored",
    "/data/before-v3",
    "accounts",
  );
  assert.equal(legacy.schema, 2);
  const next = new StorageDatabase({
    directory: "/data/legacy-restored",
    mode: "accounts",
    oidcBackupDirectory: "/data/before-v3-again",
  });
  try {
    assert.equal(
      new ArticleRepository(next).read(user.userId, article).markdown,
      markdown,
    );
  } finally {
    next.close();
  }
  // 通用备份同样能在最终镜像运行；不用测试替身替换正式 SQLite。
  assert.equal(
    backupStorage("/data/legacy-restored", "/data/final-backup", "accounts")
      .articles,
    1,
  );
  console.log(
    "PASS 最终 Linux 镜像 schema 2→3 CLI 升级、口令/归属/正文保留，旧升级备份恢复与再次升级",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
