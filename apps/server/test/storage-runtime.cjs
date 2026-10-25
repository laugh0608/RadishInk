// Linux / macOS 运行编译产物的独立 smoke，不依赖 Jest 的平台专用解析器。
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  StorageDatabase,
  SHARED_OWNER,
} = require('../dist/storage/storage-database');
const { ArticleRepository } = require('../dist/storage/article-repository');
const { StorageMaintenance } = require('../dist/storage/storage-maintenance');
const { sha256 } = require('../dist/storage/storage-contract');

const temporary = mkdtempSync(join(tmpdir(), 'radishink-runtime-'));
const directory = join(temporary, 'data');
const id = randomUUID();
const bytes = Buffer.from([0, 255, 13, 10, 42]);
const request = {
  ownerId: SHARED_OWNER,
  articleId: id,
  operationId: randomUUID(),
  expectedRevision: null,
  markdown: '\uFEFF---\r\ncustom: keep\r\n---\r\n# smoke\r\n',
  metadata: {
    id,
    title: '合成文章',
    savedAt: '2026-10-25T00:00:00.000Z',
    theme: 'default',
    themeName: '默认',
    customCSS: '',
    unknown: true,
  },
  assets: [
    {
      path: 'asset/test.png',
      bytes,
      sha256: sha256(bytes),
      size: bytes.length,
    },
  ],
};
let db;
try {
  db = new StorageDatabase({ directory, mode: 'shared', initialize: true });
  let store = new ArticleRepository(db);
  store.commit(request);
  assert.equal(store.read(SHARED_OWNER, id).markdown, request.markdown);
  assert.deepEqual(
    store.readAsset(SHARED_OWNER, id, 'asset/test.png', 0),
    bytes,
  );
  assert.throws(() => new StorageDatabase({ directory, mode: 'shared' }), {
    code: 'locked',
  });
  const sqliteVersion = db.connection
    .prepare('SELECT sqlite_version() AS version')
    .get().version;
  for (const stage of [
    'body-written',
    'objects-published',
    'snapshot-published',
    'transaction-written',
    'committed',
  ]) {
    const before = store.read(SHARED_OWNER, id);
    const update = {
      ...request,
      operationId: randomUUID(),
      expectedRevision: before.revision,
      markdown: `after ${stage}`,
      assets: request.assets.map(({ path, sha256: digest, size }) => ({
        path,
        sha256: digest,
        size,
      })),
    };
    const fixture = join(temporary, 'request.json');
    writeFileSync(fixture, JSON.stringify(update));
    db.close();
    const result = spawnSync(
      process.execPath,
      [
        join(__dirname, 'storage-crash-child.cjs'),
        directory,
        fixture,
        stage,
        'shared',
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    assert.equal(result.signal, 'SIGKILL', result.stderr);
    db = new StorageDatabase({ directory, mode: 'shared' });
    store = new ArticleRepository(db);
    assert.equal(
      store.read(SHARED_OWNER, id).revision,
      stage === 'committed' ? before.revision + 1 : before.revision,
    );
    assert.equal(store.commit(update).committedRevision, before.revision + 1);
    assert.throws(
      () => store.commit({ ...update, operationId: randomUUID() }),
      { code: 'conflict' },
    );
    assert.deepEqual(
      store.readAsset(SHARED_OWNER, id, 'asset/test.png', before.revision + 1),
      bytes,
    );
  }
  const maintenance = new StorageMaintenance(store);
  const plan = maintenance.inspect();
  assert.ok(plan.reclaimableBytes > 0);
  maintenance.cleanup(plan.planDigest);
  assert.equal(maintenance.inspect().reclaimableBytes, 0);
  const revision = store.read(SHARED_OWNER, id).revision;
  const deletion = randomUUID();
  store.delete(SHARED_OWNER, id, revision, deletion);
  maintenance.cleanup(maintenance.inspect().planDigest);
  assert.equal(
    store.delete(SHARED_OWNER, id, revision, deletion).kind,
    'delete',
  );
  assert.throws(() => store.commit(request), { code: 'not-found' });
  db.close();

  let realEnospc = false;
  if (process.env.RADISHINK_TEST_FULL_VOLUME) {
    const volume = process.env.RADISHINK_TEST_FULL_VOLUME;
    // 只能在显式提供的小型 Linux tmpfs 中填满空间，绝不填充宿主磁盘。
    assert.equal(process.platform, 'linux');
    assert.equal(volume, '/full-volume');
    const filesystem = statfsSync(volume);
    assert.equal(filesystem.type, 0x01021994);
    assert.ok(filesystem.blocks * filesystem.bsize <= 2 * 1024 * 1024);
    const fullDirectory = join(volume, 'data');
    db = new StorageDatabase({
      directory: fullDirectory,
      mode: 'shared',
      initialize: true,
    });
    store = new ArticleRepository(db, { limits: { minimumFreeBytes: 0 } });
    store.commit(request);
    const filler = join(volume, 'filler');
    const failing = new ArticleRepository(db, {
      limits: { minimumFreeBytes: 0 },
      checkpoint(stage) {
        if (stage !== 'body-written') return;
        const fd = openSync(filler, 'wx');
        try {
          const chunk = Buffer.alloc(4096);
          for (;;) writeSync(fd, chunk);
        } catch (error) {
          assert.equal(error.code, 'ENOSPC');
        } finally {
          closeSync(fd);
        }
      },
    });
    assert.throws(
      () =>
        failing.commit({
          ...request,
          operationId: randomUUID(),
          expectedRevision: 0,
          markdown: 'must not save',
        }),
      { code: 'ENOSPC' },
    );
    unlinkSync(filler);
    assert.equal(store.read(SHARED_OWNER, id).revision, 0);
    assert.equal(store.read(SHARED_OWNER, id).markdown, request.markdown);
    new StorageMaintenance(store).inspect();
    realEnospc = true;
  }
  process.stdout.write(
    `${JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, sqliteVersion, crashStages: 5, realEnospc, status: 'passed' })}\n`,
  );
} finally {
  db?.close();
  rmSync(temporary, { recursive: true, force: true });
}
