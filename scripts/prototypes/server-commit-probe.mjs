// P3 决策实验；不被 apps/server 导入，不处理真实文章或 HTTP 请求。
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const script = fileURLToPath(import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = "\uFEFF---\r\nunknown: keep\r\n---\r\n# 合成文章\r\n";
const imageBytes = Buffer.from([0, 255, 13, 10, 42]);

function syncPath(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function durableFile(path, bytes) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function openDatabase(root) {
  const db = new DatabaseSync(join(root, "metadata.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 100;
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL,
      generation TEXT NOT NULL, manifest_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commits (
      owner TEXT NOT NULL, operation TEXT NOT NULL, digest TEXT NOT NULL,
      article TEXT NOT NULL REFERENCES articles(id), revision INTEGER NOT NULL,
      PRIMARY KEY(owner, operation)
    );
  `);
  return db;
}

function current(db, owner, id) {
  return db
    .prepare("SELECT * FROM articles WHERE owner = ? AND id = ?")
    .get(owner, id);
}

function checkTarget(db, owner, id, expected) {
  const row = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (row && row.owner !== owner) throw new Error("NOT_FOUND");
  if ((row?.revision ?? null) !== expected)
    throw new Error("REVISION_CONFLICT");
}

function read(root, db, owner, id) {
  const row = current(db, owner, id);
  if (!row) throw new Error("NOT_FOUND");
  const dir = join(root, "generations", row.generation);
  const manifestBytes = readFileSync(join(dir, "manifest.json"));
  if (hash(manifestBytes) !== row.manifest_hash) throw new Error("CORRUPT");
  const manifest = JSON.parse(manifestBytes);
  const markdown = readFileSync(join(dir, "index.md"));
  const asset = readFileSync(join(root, "objects", manifest.asset));
  if (
    manifest.owner !== owner ||
    manifest.id !== id ||
    manifest.revision !== row.revision ||
    hash(markdown) !== manifest.markdown ||
    hash(asset) !== manifest.asset
  )
    throw new Error("CORRUPT");
  return { revision: row.revision, markdown: markdown.toString("utf8"), asset };
}

// 阶段钩子只用于子进程强制结束和 IO 错误实验；并非正式恢复 API。
function commit(root, db, request, checkpoint = () => {}) {
  const { owner, id, operation, expected, markdown } = request;
  const digest = hash(JSON.stringify(request));
  const previous = db
    .prepare("SELECT * FROM commits WHERE owner = ? AND operation = ?")
    .get(owner, operation);
  if (previous) {
    if (previous.digest !== digest) throw new Error("IDEMPOTENCY_MISMATCH");
    if (!current(db, owner, id)) throw new Error("NOT_FOUND");
    return previous.revision;
  }
  checkTarget(db, owner, id, expected);
  const revision = expected === null ? 0 : expected + 1;
  const generation = randomUUID();
  const stage = join(root, "staging", generation);
  mkdirSync(stage, { recursive: true });
  durableFile(join(stage, "index.md"), markdown);
  checkpoint("partial");
  const object = join(root, "objects", hash(imageBytes));
  if (existsSync(object)) {
    if (hash(readFileSync(object)) !== hash(imageBytes))
      throw new Error("CORRUPT");
  } else {
    const temporaryObject = join(stage, "object");
    durableFile(temporaryObject, imageBytes);
    renameSync(temporaryObject, object);
    syncPath(join(root, "objects"));
  }
  const manifest = JSON.stringify({
    owner,
    id,
    revision,
    markdown: hash(markdown),
    asset: hash(imageBytes),
  });
  durableFile(join(stage, "manifest.json"), manifest);
  syncPath(stage);
  checkpoint("staged");
  renameSync(stage, join(root, "generations", generation));
  syncPath(join(root, "staging"));
  syncPath(join(root, "generations"));
  checkpoint("published");
  db.exec("BEGIN IMMEDIATE");
  try {
    // 文件 IO 之后再次比较版本；事务期间不做异步文件写入。
    checkTarget(db, owner, id, expected);
    db.prepare(
      `INSERT INTO articles VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision,
      generation = excluded.generation, manifest_hash = excluded.manifest_hash`,
    ).run(id, owner, revision, generation, hash(manifest));
    db.prepare("INSERT INTO commits VALUES (?, ?, ?, ?, ?)").run(
      owner,
      operation,
      digest,
      id,
      revision,
    );
    checkpoint("transaction");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  checkpoint("committed");
  return revision;
}

function request(overrides = {}) {
  return {
    owner: "user-a",
    id: "article-a",
    operation: "create-a",
    expected: null,
    markdown: source,
    ...overrides,
  };
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "radishink-p3-probe-"));
  mkdirSync(join(root, "staging"));
  mkdirSync(join(root, "generations"));
  mkdirSync(join(root, "objects"));
  const db = openDatabase(root);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true });
  });
  return { root, db };
}

if (process.argv[2] === "--crash-child") {
  const root = resolve(process.argv[3]);
  assert.equal(resolve(root, ".."), resolve(tmpdir()));
  assert.ok(basename(root).startsWith("radishink-p3-probe-"));
  assert.ok(existsSync(join(root, "metadata.sqlite")));
  const db = openDatabase(root);
  commit(
    root,
    db,
    request({
      operation: "update-a",
      expected: 0,
      markdown: `${source}updated`,
    }),
    (stage) => {
      if (stage === process.argv[4]) process.kill(process.pid, "SIGKILL");
    },
  );
  throw new Error("故障阶段没有触发");
} else {
  test("正文 BOM / CRLF / 未知字段和资源原字节往返", (t) => {
    const { root, db } = fixture(t);
    assert.equal(commit(root, db, request()), 0);
    assert.deepEqual(read(root, db, "user-a", "article-a"), {
      revision: 0,
      markdown: source,
      asset: imageBytes,
    });
  });

  for (const stage of [
    "partial",
    "staged",
    "published",
    "transaction",
    "committed",
  ]) {
    test(`SIGKILL at ${stage}：重开只读完整已提交快照`, (t) => {
      const { root, db } = fixture(t);
      commit(root, db, request());
      const result = spawnSync(
        process.execPath,
        [script, "--crash-child", root, stage],
        { encoding: "utf8" },
      );
      assert.equal(result.signal, "SIGKILL", result.stderr);
      const reopened = openDatabase(root);
      try {
        const value = read(root, reopened, "user-a", "article-a");
        const committed = stage === "committed";
        assert.equal(value.revision, committed ? 1 : 0);
        assert.equal(value.markdown, committed ? `${source}updated` : source);
        assert.deepEqual(value.asset, imageBytes);
        assert.equal(
          commit(
            root,
            reopened,
            request({
              operation: "update-a",
              expected: 0,
              markdown: `${source}updated`,
            }),
          ),
          1,
        );
        assert.equal(read(root, reopened, "user-a", "article-a").revision, 1);
      } finally {
        reopened.close();
      }
    });
  }

  test("两个数据库连接读取同版本后，第二次保存拒绝覆盖", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    const other = openDatabase(root);
    try {
      assert.equal(read(root, other, "user-a", "article-a").revision, 0);
      commit(
        root,
        db,
        request({ operation: "first", expected: 0, markdown: "first" }),
      );
      assert.throws(
        () =>
          commit(
            root,
            other,
            request({ operation: "second", expected: 0, markdown: "second" }),
          ),
        /REVISION_CONFLICT/,
      );
      assert.equal(read(root, other, "user-a", "article-a").markdown, "first");
    } finally {
      other.close();
    }
  });

  test("文件完成后版本变化，事务内复核拒绝迟到写入", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    const other = openDatabase(root);
    try {
      assert.throws(
        () =>
          commit(
            root,
            db,
            request({ operation: "late", expected: 0, markdown: "late" }),
            (stage) => {
              if (stage === "published")
                commit(
                  root,
                  other,
                  request({
                    operation: "winner",
                    expected: 0,
                    markdown: "winner",
                  }),
                );
            },
          ),
        /REVISION_CONFLICT/,
      );
      assert.equal(read(root, db, "user-a", "article-a").markdown, "winner");
    } finally {
      other.close();
    }
  });

  test("重试返回原提交版本，异值重用操作 ID 失败", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    commit(
      root,
      db,
      request({ operation: "newer", expected: 0, markdown: "newer" }),
    );
    assert.equal(commit(root, db, request()), 0);
    assert.equal(read(root, db, "user-a", "article-a").revision, 1);
    assert.equal(readdirSync(join(root, "objects")).length, 1);
    assert.throws(
      () => commit(root, db, request({ markdown: "changed" })),
      /IDEMPOTENCY_MISMATCH/,
    );
  });

  test("其他所有者不能读取或使用已知 ID 覆盖", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    assert.throws(() => read(root, db, "user-b", "article-a"), /NOT_FOUND/);
    assert.throws(
      () => commit(root, db, request({ owner: "user-b", expected: 0 })),
      /NOT_FOUND/,
    );
    assert.equal(read(root, db, "user-a", "article-a").revision, 0);
  });

  test("暂存 IO 故障不推进数据库或掩盖错误", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    assert.throws(
      () =>
        commit(
          root,
          db,
          request({ operation: "full", expected: 0 }),
          (stage) => {
            if (stage === "partial")
              throw Object.assign(new Error("synthetic disk full"), {
                code: "ENOSPC",
              });
          },
        ),
      { code: "ENOSPC" },
    );
    assert.equal(read(root, db, "user-a", "article-a").revision, 0);
  });

  test("数据库写锁冲突不推进可见版本", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    const locker = openDatabase(root);
    try {
      locker.exec("BEGIN IMMEDIATE");
      assert.throws(
        () => commit(root, db, request({ operation: "busy", expected: 0 })),
        /locked/,
      );
      assert.equal(read(root, db, "user-a", "article-a").revision, 0);
      locker.exec("ROLLBACK");
    } finally {
      locker.close();
    }
  });

  test("孤儿快照不提升；当前资源损坏明确失败", (t) => {
    const { root, db } = fixture(t);
    commit(root, db, request());
    assert.throws(
      () =>
        commit(
          root,
          db,
          request({ operation: "orphan", expected: 0, markdown: "orphan" }),
          (stage) => {
            if (stage === "published") throw new Error("stop before database");
          },
        ),
      /stop before database/,
    );
    assert.equal(readdirSync(join(root, "generations")).length, 2);
    assert.equal(read(root, db, "user-a", "article-a").markdown, source);
    writeFileSync(join(root, "objects", hash(imageBytes)), "tampered");
    assert.throws(() => read(root, db, "user-a", "article-a"), /CORRUPT/);
  });
}
