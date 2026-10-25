import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerStore } from './store';
import { ApiFailure } from './store';

const SESSION_MS = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'topology_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
interface Credentials { username: string; password: string }
export interface AuthOptions { dataDir: string; username?: string; password?: string }
async function readJson(path: string) {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function createAuthentication(store: ServerStore, options: AuthOptions) {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const path = join(options.dataDir, 'admin-credentials.json');
  const existing = await readJson(path) as Credentials | null;
  if (existing && (typeof existing.username !== 'string' || typeof existing.password !== 'string')) throw new Error('管理员凭据文件不合法');
  const credentials: Credentials = {
    username: options.username ?? existing?.username ?? 'admin',
    password: options.password ?? existing?.password ?? randomBytes(24).toString('base64url'),
  };
  if (!credentials.username.trim() || credentials.username.length > 100 || credentials.password.length < 12 || credentials.password.length > 1024) throw new Error('管理员用户名需为 1–100 字符，密码需为 12–1024 字符');
  if (!existing || existing.username !== credentials.username || existing.password !== credentials.password) {
    await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    store.database.exec('DELETE FROM sessions');
  }
  await chmod(path, 0o600);
  const hashPath = join(options.dataDir, 'admin-auth.json');
  const saved = await readJson(hashPath) as { username: string; passwordHash: string } | null;
  let passwordHash = saved?.username === credentials.username && typeof saved?.passwordHash === 'string' && await Bun.password.verify(credentials.password, saved.passwordHash) ? saved.passwordHash : '';
  if (!passwordHash) {
    passwordHash = await Bun.password.hash(credentials.password, { algorithm: 'argon2id' });
    await writeFile(hashPath, `${JSON.stringify({ username: credentials.username, passwordHash })}\n`, { mode: 0o600 });
    // Editing the persistent credentials file is also a password rotation.
    store.database.exec('DELETE FROM sessions');
  }
  await chmod(hashPath, 0o600);
  const failures = new Map<string, { count: number; until: number }>();
  const token = (request: Request) => {
    const value = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  };
  return {
    username: credentials.username,
    session(request: Request) {
      const value = token(request); if (!value) return null;
      const row = store.database.query('SELECT username,expires_at FROM sessions WHERE token_hash=?').get(digest(value)) as { username: string; expires_at: number } | null;
      if (!row || row.expires_at <= Date.now() || row.username !== credentials.username) return null;
      return row.username;
    },
    async login(username: string, password: string, address: string) {
      const now = Date.now();
      for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
      const attempt = failures.get(address);
      if ((attempt?.count ?? 0) >= 8) throw new ApiFailure(429, 'RATE_LIMITED', '登录尝试过多，请 15 分钟后重试');
      // Count before the asynchronous password check so parallel attempts cannot bypass the limit.
      failures.set(address, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + 15 * 60 * 1000 });
      if (failures.size > 10000) failures.delete(failures.keys().next().value!);
      const correct = await Bun.password.verify(password, passwordHash);
      if (username !== credentials.username || !correct) throw new ApiFailure(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      failures.delete(address);
      store.database.query('DELETE FROM sessions WHERE expires_at<=?').run(now);
      const value = randomBytes(32).toString('hex');
      store.database.query('INSERT INTO sessions (token_hash,username,expires_at) VALUES (?,?,?)').run(digest(value), credentials.username, now + SESSION_MS);
      return value;
    },
    logout(request: Request) {
      const value = token(request);
      if (value) store.database.query('DELETE FROM sessions WHERE token_hash=?').run(digest(value));
    },
  };
}

export function sessionCookie(value: string, secure: boolean) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? SESSION_MS / 1000 : 0}${secure ? '; Secure' : ''}`;
}
