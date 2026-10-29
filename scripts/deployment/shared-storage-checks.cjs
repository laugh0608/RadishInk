// 最终服务端镜像双架构执行；合成 tmpfs，不使用真实数据。
// docker run --rm --read-only --tmpfs /data:uid=1000,gid=1000,mode=0700,size=128m \
//   -i <image> node < scripts/deployment/shared-storage-checks.cjs
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  StorageDatabase,
  SHARED_OWNER,
} = require("/app/dist/storage/storage-database");
const { ArticleRepository } = require("/app/dist/storage/article-repository");
const { manageAccount } = require("/app/dist/auth/local-auth");
const { issueSession } = require("/app/dist/auth/auth-sessions");
const cli = (args) => {
  const result = spawnSync(
    process.execPath,
    ["/app/dist/storage/storage-cli.js", ...args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
(async () => {
  let db = new StorageDatabase({
    directory: "/data/accounts",
    mode: "accounts",
    initialize: true,
  });
  const owner = (
    await manageAccount(
      db.connection,
      "init-admin",
      "alice",
      "synthetic-conversion-password",
    )
  ).userId;
  const id = randomUUID(),
    operationId = randomUUID(),
    image = Buffer.from([0, 255, 10, 13, 21]);
  const input = {
    ownerId: owner,
    articleId: id,
    operationId,
    expectedRevision: null,
    markdown: "\ufeff---\r\nunknown: 保留\r\n---\r\n# Linux 双架构转换",
    metadata: {
      id,
      title: "合成转换",
      savedAt: "2026-10-29T00:00:00Z",
      theme: "",
      themeName: "",
      customCSS: "",
      ownerId: "opaque",
    },
    assets: [
      {
        path: "asset/原图.png",
        bytes: image,
        size: image.length,
        sha256: createHash("sha256").update(image).digest("hex"),
      },
    ],
  };
  const repo = new ArticleRepository(db),
    receipt = repo.commit(input),
    snapshot = repo.read(owner, id);
  const identity = { ...db.deployment };
  issueSession(db.connection, owner, "password");
  db.close();
  const shared = cli([
    "convert-mode",
    "--data-dir",
    "/data/accounts",
    "--mode",
    "accounts",
    "--target-mode",
    "shared",
    "--owner-id",
    owner,
    "--confirm-shared",
    "--backup-dir",
    "/data/backup1",
    "--target-dir",
    "/data/shared",
  ]);
  assert.equal(shared.deploymentId, identity.deploymentId);
  assert.notEqual(shared.workspaceEpoch, identity.workspaceEpoch);
  db = new StorageDatabase({ directory: "/data/shared", mode: "shared" });
  assert.deepEqual(new ArticleRepository(db).read(SHARED_OWNER, id), snapshot);
  assert.deepEqual(
    new ArticleRepository(db).commit({ ...input, ownerId: SHARED_OWNER }),
    receipt,
  );
  assert.equal(
    db.connection.prepare("SELECT COUNT(*) n FROM sessions").get().n,
    0,
  );
  db.close();
  const accounts = cli([
    "convert-mode",
    "--data-dir",
    "/data/shared",
    "--mode",
    "shared",
    "--target-mode",
    "accounts",
    "--owner-id",
    owner,
    "--backup-dir",
    "/data/backup2",
    "--target-dir",
    "/data/restored",
  ]);
  assert.notEqual(accounts.workspaceEpoch, shared.workspaceEpoch);
  db = new StorageDatabase({ directory: "/data/restored", mode: "accounts" });
  assert.deepEqual(new ArticleRepository(db).read(owner, id), snapshot);
  assert.deepEqual(
    new ArticleRepository(db).readAsset(owner, id, "asset/原图.png", 0),
    image,
  );
  await manageAccount(
    db.connection,
    "create-user",
    "bob",
    "synthetic-conversion-password",
  );
  db.close();
  const denied = spawnSync(
    process.execPath,
    [
      "/app/dist/storage/storage-cli.js",
      "convert-mode",
      "--data-dir",
      "/data/restored",
      "--mode",
      "accounts",
      "--target-mode",
      "shared",
      "--owner-id",
      owner,
      "--confirm-shared",
      "--backup-dir",
      "/data/denied-backup",
      "--target-dir",
      "/data/denied",
    ],
    { encoding: "utf8" },
  );
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /多用户/);
  db = new StorageDatabase({ directory: "/data/accounts", mode: "accounts" });
  assert.equal(db.deployment.workspaceEpoch, identity.workspaceEpoch);
  assert.deepEqual(new ArticleRepository(db).read(owner, id), snapshot);
  db.close();
  console.log(
    `PASS ${process.platform}/${process.arch}: actual CLI bidirectional conversion, byte preservation, receipt replay, epoch rotation, original volume intact, multi-user rejection`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
