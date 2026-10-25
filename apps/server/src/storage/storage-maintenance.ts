import {
  ArticleManifest,
  ArticleSnapshot,
  StorageError,
  canonicalJson,
  articleIndex,
  sha256,
} from './storage-contract';
import { ArticleRepository } from './article-repository';
import { ArticleRow } from './storage-database';
import { articleDirectory, snapshotDirectory } from './storage-snapshots';

interface Candidate {
  path: string;
  size: number;
  sha256: string;
}
export interface MaintenanceReport {
  deploymentId: string;
  workspaceEpoch: string;
  articles: number;
  physicalBytes: number;
  reclaimableBytes: number;
  candidates: Candidate[];
  unknownPaths: string[];
  planDigest: string;
}
const uuid =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const objectPath = new RegExp(
  `^users/(${uuid})/articles/(${uuid})/objects/([0-9a-f]{64})$`,
);
const generationPath = new RegExp(
  `^users/(${uuid})/articles/(${uuid})/generations/(${uuid})/(index\\.md|article\\.json|manifest\\.json)$`,
);
const stagingPath = new RegExp(
  `^staging/(${uuid})/(${uuid})/(index\\.md|article\\.json|manifest\\.json|[0-9a-f]{64}\\.object)$`,
);

/** 与服务启动使用同一独占卷锁；默认报告，显式摘要确认后才删除。 */
export class StorageMaintenance {
  constructor(readonly repository: ArticleRepository) {}

  private currentSnapshots(): {
    row: ArticleRow;
    manifest: ArticleManifest;
    snapshot: ArticleSnapshot;
  }[] {
    const db = this.repository.database;
    db.checkIntegrity();
    db.verifySchema();
    return db.connection
      .prepare<[], ArticleRow>(
        'SELECT * FROM articles WHERE deleted = 0 ORDER BY owner_id, id',
      )
      .all()
      .map((row) => ({ row, ...this.repository.snapshots.read(row) }));
  }

  inspect(): MaintenanceReport {
    const { database, limits } = this.repository;
    const files = database.files;
    const current = this.currentSnapshots();
    const live = new Set<string>();
    const usage = new Map<string, { count: number; bytes: number }>();
    for (const { row, manifest, snapshot } of current) {
      const index = articleIndex(snapshot.metadata);
      if (row.title !== index.title || row.saved_at !== index.savedAt) {
        throw new StorageError('corrupt', '派生文章索引不一致，请显式重建索引');
      }
      const directory = snapshotDirectory(row);
      live.add(`${directory}/index.md`);
      live.add(`${directory}/article.json`);
      live.add(`${directory}/manifest.json`);
      for (const asset of manifest.assets)
        live.add(
          `${articleDirectory(row.owner_id, row.id)}/objects/${asset.sha256}`,
        );
      const previous = usage.get(row.owner_id) ?? { count: 0, bytes: 0 };
      usage.set(row.owner_id, {
        count: previous.count + 1,
        bytes: previous.bytes + row.logical_bytes,
      });
    }
    const owners = database.connection
      .prepare<
        [],
        { id: string; articles: number; logical_bytes: number }
      >('SELECT users.id, owner_usage.articles, owner_usage.logical_bytes FROM users LEFT JOIN owner_usage ON users.id = owner_usage.owner_id')
      .all();
    for (const owner of owners) {
      const actual = usage.get(owner.id) ?? { count: 0, bytes: 0 };
      if (
        owner.articles !== actual.count ||
        owner.logical_bytes !== actual.bytes
      )
        throw new StorageError(
          'corrupt',
          '派生用量索引不一致，请先检查并显式重建索引',
        );
    }
    const ownerIds = new Set(owners.map((owner) => owner.id));
    const inventory = [
      ...files.inventory('users'),
      ...files.inventory('staging'),
    ].sort((a, b) => (a.path < b.path ? -1 : 1));
    const candidates: Candidate[] = [];
    const unknownPaths: string[] = [];
    for (const entry of inventory) {
      if (live.has(entry.path)) continue;
      const object = objectPath.exec(entry.path);
      const generation = generationPath.exec(entry.path);
      const staging = stagingPath.exec(entry.path);
      const match = object ?? generation ?? staging;
      // 只有本库已知所有者下的保留内部格式才进入明确的清理预览。
      if (
        !match ||
        !ownerIds.has(match[1]) ||
        entry.size >
          Math.max(
            limits.assetBytes,
            limits.markdownBytes,
            limits.metadataBytes,
            1024 * 1024,
          )
      ) {
        unknownPaths.push(entry.path);
        continue;
      }
      const digest = sha256(files.read(entry.path, entry.size));
      if (object && digest !== object[3]) {
        unknownPaths.push(entry.path);
        continue;
      }
      candidates.push({ ...entry, sha256: digest });
    }
    const state = {
      deployment: database.deployment,
      heads: current.map(({ row }) => row),
      inventory,
      candidates,
      unknownPaths,
    };
    return {
      ...database.deployment,
      articles: current.length,
      physicalBytes: inventory.reduce((sum, file) => sum + file.size, 0),
      reclaimableBytes: candidates.reduce((sum, file) => sum + file.size, 0),
      candidates,
      unknownPaths,
      planDigest: sha256(canonicalJson(state)),
    };
  }

  cleanup(expectedPlanDigest: string): {
    filesRemoved: number;
    bytesRemoved: number;
    unknownPaths: string[];
  } {
    const plan = this.inspect();
    if (plan.planDigest !== expectedPlanDigest)
      throw new StorageError('conflict', '清理预览已过期，请重新检查并确认');
    const files = this.repository.database.files;
    const directories = new Set<string>();
    for (const candidate of plan.candidates) {
      files.verify(candidate.path, candidate.sha256, candidate.size);
      files.removeFile(candidate.path);
      if (
        generationPath.test(candidate.path) ||
        stagingPath.test(candidate.path)
      ) {
        directories.add(
          candidate.path.slice(0, candidate.path.lastIndexOf('/')),
        );
      }
    }
    for (const directory of directories) {
      if (!files.list(directory).length) files.removeEmptyDirectory(directory);
    }
    return {
      filesRemoved: plan.candidates.length,
      bytesRemoved: plan.reclaimableBytes,
      unknownPaths: plan.unknownPaths,
    };
  }

  rebuildDerivedIndexes(): void {
    const current = this.currentSnapshots();
    const db = this.repository.database.connection;
    // 仅从数据库明确指向的完整快照重建；不提升孤儿，不更改归属、版本、墓碑或回执。
    const snapshots = current.map(({ row, snapshot }) => ({
      row,
      value: snapshot,
    }));
    db.transaction(() => {
      db.prepare('DELETE FROM owner_usage').run();
      db.prepare(
        `INSERT INTO owner_usage SELECT users.id,
        COUNT(articles.id), COALESCE(SUM(articles.logical_bytes), 0)
        FROM users LEFT JOIN articles ON users.id = articles.owner_id AND articles.deleted = 0 GROUP BY users.id`,
      ).run();
      for (const { row, value } of snapshots) {
        const index = articleIndex(value.metadata);
        db.prepare(
          'UPDATE articles SET title = ?, saved_at = ? WHERE id = ? AND owner_id = ?',
        ).run(index.title, index.savedAt, row.id, row.owner_id);
      }
    }).immediate();
  }
}
