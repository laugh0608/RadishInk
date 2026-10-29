import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StorageError, sha256 } from './storage-contract';

function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** 数据卷只允许本机普通文件 / 目录。外部进程改写不属于支持的操作方式。 */
export class StorageFiles {
  readonly root: string;

  constructor(directory: string, initialize: boolean) {
    if (!isAbsolute(directory))
      throw new StorageError('invalid', '数据目录必须为绝对路径');
    const requested = resolve(directory);
    if (!existsSync(requested)) {
      if (!initialize)
        throw new StorageError('not-found', '数据目录尚未初始化');
      // 要求部署者先准备父目录，不递归认领陌生路径。
      mkdirSync(requested, { mode: 0o700 });
      syncDirectory(dirname(requested));
    }
    const info = lstatSync(requested);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new StorageError('invalid', '数据根目录不能是符号链接');
    this.root = realpathSync(requested);
    // 只接受首轮支持的本机文件系统，未知类型不会被当作安全的本地卷。
    const filesystem = statfsSync(this.root).type >>> 0;
    const supported =
      process.platform === 'darwin'
        ? [26]
        : process.platform === 'linux'
          ? [0xef53, 0x9123683e, 0x58465342, 0x01021994, 0x794c7630]
          : [];
    if (!supported.includes(filesystem)) {
      throw new StorageError(
        'invalid',
        '数据卷文件系统不在首轮支持范围，不能使用网络卷',
      );
    }
  }

  path(name: string): string {
    if (
      isAbsolute(name) ||
      name
        .split('/')
        .some(
          (part) =>
            !part || part === '.' || part === '..' || part.includes('\\'),
        )
    ) {
      throw new StorageError('invalid', '内部文件路径无效');
    }
    const target = join(this.root, ...name.split('/'));
    const rel = relative(this.root, target);
    if (rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new StorageError('invalid', '文件路径越界');
    let cursor = this.root;
    for (const part of name.split('/')) {
      cursor = join(cursor, part);
      try {
        const stat = lstatSync(cursor);
        if (
          stat.isSymbolicLink() ||
          (!stat.isDirectory() && !stat.isFile()) ||
          (stat.isFile() && stat.nlink !== 1)
        ) {
          throw new StorageError('corrupt', '数据目录含链接或非普通文件');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        break;
      }
    }
    return target;
  }

  exists(name: string): boolean {
    try {
      lstatSync(this.path(name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  mkdir(name: string): void {
    const parts = name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = this.path(parts.slice(0, i).join('/'));
      if (existsSync(path)) {
        if (!lstatSync(path).isDirectory())
          throw new StorageError('corrupt', '数据目录位置被文件占用');
      } else {
        mkdirSync(path, { mode: 0o700 });
        syncDirectory(dirname(path));
      }
    }
  }

  writeNew(name: string, bytes: Uint8Array): void {
    const path = this.path(name);
    const fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(dirname(path));
  }

  read(name: string, maximum: number): Buffer {
    const fd = openSync(
      this.path(name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum)
        throw new StorageError('corrupt', '数据文件类型或大小不符');
      const bytes = readFileSync(fd);
      if (bytes.length !== stat.size || bytes.length > maximum)
        throw new StorageError('corrupt', '读取期间文件大小变化');
      return bytes;
    } finally {
      closeSync(fd);
    }
  }

  verify(name: string, digest: string, size: number): Buffer {
    const bytes = this.read(name, size);
    if (bytes.length !== size || sha256(bytes) !== digest)
      throw new StorageError('corrupt', '数据文件完整性校验失败');
    return bytes;
  }

  publishObject(
    staged: string,
    target: string,
    digest: string,
    size: number,
  ): void {
    if (this.exists(target)) {
      this.verify(target, digest, size);
    } else {
      // 独占卷锁 + 同进程串行写入保证检查到 rename 之间无其他受支持写者。
      // 外部进程修改数据卷不受该协议保护；既有对象只校验，绝不替换。
      renameSync(this.path(staged), this.path(target));
      syncDirectory(dirname(join(this.root, staged)));
      syncDirectory(dirname(join(this.root, target)));
    }
  }

  publishDirectory(staged: string, target: string): void {
    if (this.exists(target))
      throw new StorageError('conflict', '快照目标已存在');
    const from = this.path(staged);
    const to = this.path(target);
    renameSync(from, to);
    syncDirectory(dirname(from));
    syncDirectory(dirname(to));
  }

  list(name?: string): string[] {
    return readdirSync(name ? this.path(name) : this.root).sort();
  }

  /** 不跟随链接；用于容量核对与维护报告，路径均以数据根为相对基准。 */
  inventory(name: string): { path: string; size: number }[] {
    if (!this.exists(name)) return [];
    const path = this.path(name);
    const stat = lstatSync(path);
    if (stat.isFile()) return [{ path: name, size: stat.size }];
    return this.list(name).flatMap((child) =>
      this.inventory(`${name}/${child}`),
    );
  }

  assertFreeSpace(bytes: number, reserve: number): void {
    const stat = statfsSync(this.root, { bigint: true });
    if (stat.bavail * stat.bsize < BigInt(bytes) + BigInt(reserve))
      throw new StorageError('capacity', '数据卷剩余空间不足');
  }

  removeFile(name: string): void {
    const path = this.path(name);
    if (!lstatSync(path).isFile())
      throw new StorageError('corrupt', '维护只删除已确认的普通文件');
    unlinkSync(path);
    syncDirectory(dirname(path));
  }

  removeEmptyDirectory(name: string): void {
    const path = this.path(name);
    rmdirSync(path);
    syncDirectory(dirname(path));
  }
}
