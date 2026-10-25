import { parseArgs } from 'node:util';
import { stdin, stdout } from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { StorageDatabase } from '../storage/storage-database';
import { manageAccount } from './local-auth';
import { ApiError, publicError, ERROR_MESSAGES } from '../http/api-error';

/** 必须是真实 TTY，关闭回显，不从 argv / 环境变量 / 管道读取口令。 */
export function readPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new ApiError(422, 'tty-required');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const decoder = new StringDecoder('utf8');
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (bytes: Buffer) => {
      for (const char of decoder.write(bytes)) {
        if (char === '\u0003' || char === '\u0004')
          return finish(new ApiError(422, 'cancelled'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ') {
          value += char;
          if (Buffer.byteLength(value) > 1024)
            return finish(new ApiError(422, 'password-too-long'));
        }
      }
    };
    stdin.on('data', onData);
  });
}
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string' },
      username: { type: 'string' },
      'backup-dir': { type: 'string' },
    },
  });
  const command = positionals[0];
  const commands = [
    'init-admin',
    'create-user',
    'reset-password',
    'disable',
    'enable',
    'upgrade-auth',
  ];
  if (
    positionals.length !== 1 ||
    !commands.includes(command) ||
    !values['data-dir'] ||
    (command === 'upgrade-auth'
      ? !values['backup-dir'] || !!values.username
      : !values.username || !!values['backup-dir'])
  )
    throw new ApiError(422, 'invalid-command');
  const db = new StorageDatabase({
    directory: values['data-dir'],
    mode: 'accounts',
    initialize: command === 'init-admin',
    authBackupDirectory: values['backup-dir'],
  });
  try {
    if (command === 'upgrade-auth') {
      stdout.write('账号 schema 升级与备份校验成功\n');
      return;
    }
    if (db.connection.pragma('user_version', { simple: true }) !== 2)
      throw new ApiError(503, 'upgrade-required');
    let password: string | undefined;
    if (['init-admin', 'create-user', 'reset-password'].includes(command)) {
      password = await readPassword('密码（至少 12 字符，不回显）：');
      if (password !== (await readPassword('再次输入密码：')))
        throw new ApiError(422, 'password-mismatch');
    }
    const result = await manageAccount(
      db.connection,
      command as Parameters<typeof manageAccount>[1],
      values.username!,
      password,
    );
    stdout.write(JSON.stringify(result) + '\n');
  } finally {
    db.close();
  }
}
if (require.main === module)
  void main().catch((error: unknown) => {
    const safe = publicError(error);
    process.stderr.write(`${safe.code}: ${ERROR_MESSAGES[safe.status]}\n`);
    process.exitCode = 1;
  });
