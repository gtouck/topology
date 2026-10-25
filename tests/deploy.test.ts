import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup } from '../scripts/backup';

test('运行中的 WAL 数据库能备份为独立一致快照，并保留权限受限的登录配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'topology-backup-'));
  const db = new Database(join(root, 'workspace.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE documents (name TEXT); INSERT INTO documents VALUES (\'first\')');
    writeFileSync(join(root, 'admin-auth.json'), '{"passwordHash":"test-only"}');
    const backup = createBackup(root);
    db.exec('INSERT INTO documents VALUES (\'later\')');
    const snapshot = new Database(join(backup, 'workspace.sqlite'), { readonly: true });
    try {
      expect(snapshot.query('SELECT name FROM documents').all()).toEqual([{ name: 'first' }]);
      expect(snapshot.query('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    } finally { snapshot.close(); }
    expect(readFileSync(join(backup, 'admin-auth.json'), 'utf8')).toBe('{"passwordHash":"test-only"}');
    expect(existsSync(join(backup, 'workspace.sqlite-wal'))).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(join(backup, 'workspace.sqlite')).mode & 0o777).toBe(0o600);
      expect(statSync(join(backup, 'admin-auth.json')).mode & 0o777).toBe(0o600);
    }
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('数据库不存在时备份明确失败，不创建空数据库', () => {
  const root = mkdtempSync(join(tmpdir(), 'topology-backup-'));
  try {
    expect(() => createBackup(root)).toThrow('数据库不存在');
    expect(existsSync(join(root, 'workspace.sqlite'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
