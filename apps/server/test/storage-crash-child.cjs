// 仅供进程中断测试：加载编译后的正式仓储，不复制保存算法。
const { readFileSync } = require('node:fs');
const { StorageDatabase } = require('../dist/storage/storage-database');
const { ArticleRepository } = require('../dist/storage/article-repository');

const [directory, fixture, target, mode = 'accounts'] = process.argv.slice(2);
const request = JSON.parse(readFileSync(fixture, 'utf8'));
const database = new StorageDatabase({ directory, mode });
const repository = new ArticleRepository(database, {
  checkpoint(stage) {
    if (stage === target) process.kill(process.pid, 'SIGKILL');
  },
});
repository.commit(request);
database.close();
throw new Error('Requested crash checkpoint was not reached');
