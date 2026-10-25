import { Database } from 'bun:sqlite';
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** VACUUM INTO takes a consistent SQLite snapshot, including committed WAL data. */
export function createBackup(dataDirectory: string, backupRoot = resolve(dataDirectory, 'backups')): string {
  const source = resolve(dataDirectory, 'workspace.sqlite');
  if (!existsSync(source)) throw new Error(`数据库不存在：${source}`);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const temporary = resolve(backupRoot, `.${name}`);
  const target = resolve(backupRoot, name);
  mkdirSync(temporary, { mode: 0o700 });
  const db = new Database(source, { readonly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const snapshot = resolve(temporary, 'workspace.sqlite');
    db.query('VACUUM INTO ?').run(snapshot);
    chmodSync(snapshot, 0o600);
    const validation = new Database(snapshot, { readonly: true });
    try {
      const result = validation.query('PRAGMA quick_check').get() as { quick_check: string };
      if (result.quick_check !== 'ok') throw new Error('数据库备份完整性检查失败');
    } finally { validation.close(); }
    for (const name of ['admin-auth.json', 'admin-credentials.json']) {
      if (!existsSync(resolve(dataDirectory, name))) continue;
      const destination = resolve(temporary, name);
      copyFileSync(resolve(dataDirectory, name), destination);
      chmodSync(destination, 0o600);
    }
    writeFileSync(resolve(temporary, 'backup.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), database: 'workspace.sqlite' }, null, 2), { mode: 0o600 });
    renameSync(temporary, target);
    return target;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  } finally { db.close(); }
}

if (import.meta.main) {
  try {
    console.log(`备份完成：${createBackup(resolve(process.argv[2] || process.env.TOPOLOGY_DATA_DIR || 'data'), process.argv[3] && resolve(process.argv[3]))}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
