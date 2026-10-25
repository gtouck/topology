import { chmod, mkdir, readdir, realpath } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import { ApiFailure, ServerStore, parseCommandRequest, strictObject } from './store';
import { createAuthentication, sessionCookie } from './auth';
import type { ApiErrorResponse } from '../shared/api';

export interface ServerOptions {
  dataDir?: string; siteDir?: string; releasesDir?: string; hostname?: string; port?: number;
  adminUsername?: string; adminPassword?: string; allowedOrigins?: string[]; cookieSecure?: boolean; maxBodyBytes?: number;
}
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
async function jsonBody(request: Request, limit: number) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new ApiFailure(422, 'INVALID_INPUT', '请使用 application/json 请求');
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) > limit) throw new ApiFailure(413, 'BODY_TOO_LARGE', '请求超过容量限制');
  const reader = request.body?.getReader(); if (!reader) throw new ApiFailure(422, 'INVALID_INPUT', '缺少请求内容');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiFailure(413, 'BODY_TOO_LARGE', '请求超过容量限制'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) { if (error instanceof ApiFailure) throw error; throw new ApiFailure(422, 'INVALID_INPUT', 'JSON 格式不合法'); }
  finally { reader.releaseLock(); }
}
async function fileInside(directory: string, pathname: string) {
  try {
    const root = await realpath(directory), candidate = await realpath(resolve(root, `.${pathname}`));
    if (!candidate.startsWith(root + sep)) return null;
    const file = Bun.file(candidate); return await file.exists() ? file : null;
  } catch { return null; }
}
async function serveStatic(pathname: string, siteDir: string, releasesDir?: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return json({ error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) return json({ error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
  const target = decoded === '/' ? '/index.html' : decoded;
  let file = await fileInside(siteDir, target);
  // Only immutable asset paths may fall back to an older deployment. HTML and APIs never do.
  if (!file && releasesDir && /^\/(?:assets|viewer-assets)\/[\w./-]+$/.test(target)) {
    try {
      const releases = (await readdir(releasesDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse().slice(0, 30);
      for (const release of releases) { file = await fileInside(join(releasesDir, release, 'site'), target); if (file) break; }
    } catch { /* No earlier deployments are available. */ }
  }
  if (!file) return json({ error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
  if (extname(target).toLowerCase() === '.html') {
    const html = (await file.text()).replace(/<meta\s+name=["']topology-storage["'][^>]*>/gi, '');
    return new Response(html.replace(/<head([^>]*)>/i, '<head$1><meta name="topology-storage" content="server">'), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return new Response(file, { headers: { 'Cache-Control': /^\/(?:assets|viewer-assets)\//.test(target) ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
}

export async function createServer(options: ServerOptions = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.TOPOLOGY_DATA_DIR ?? './data');
  const siteDir = resolve(options.siteDir ?? process.env.TOPOLOGY_SITE_DIR ?? './dist');
  if (dataDir === siteDir || dataDir.startsWith(siteDir + sep)) throw new Error('数据目录必须位于静态站点目录之外');
  const releasesDir = options.releasesDir ?? process.env.TOPOLOGY_RELEASES_DIR;
  const port = options.port ?? Number(process.env.TOPOLOGY_PORT ?? 3001), hostname = options.hostname ?? process.env.TOPOLOGY_HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('TOPOLOGY_PORT 不合法');
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) throw new Error('请求容量限制不合法');
  const allowedOrigins = options.allowedOrigins ?? (process.env.TOPOLOGY_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new ServerStore(join(dataDir, 'workspace.sqlite'));
  await chmod(join(dataDir, 'workspace.sqlite'), 0o600);
  try {
    const authentication = await createAuthentication(store, { dataDir, username: options.adminUsername ?? process.env.TOPOLOGY_ADMIN_USERNAME, password: options.adminPassword ?? process.env.TOPOLOGY_ADMIN_PASSWORD });
    const server = Bun.serve({
      hostname, port, maxRequestBodySize: Math.max(maxBodyBytes * 2, 1024 * 1024),
      async fetch(request, listener) {
        const url = new URL(request.url), path = url.pathname;
        try {
          if (!path.startsWith('/api/')) {
            if (request.method !== 'GET' && request.method !== 'HEAD') throw new ApiFailure(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
            const response = await serveStatic(path, siteDir, releasesDir);
            return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            const origin = request.headers.get('origin');
            if ((origin && origin !== url.origin && !allowedOrigins.includes(origin)) || (!origin && request.headers.get('sec-fetch-site') === 'cross-site')) throw new ApiFailure(403, 'ORIGIN_REJECTED', '请求来源不被允许');
          }
          const secure = options.cookieSecure ?? (process.env.TOPOLOGY_COOKIE_SECURE === 'true' || url.protocol === 'https:');
          if (path === '/api/health' && request.method === 'GET') { store.database.query('SELECT 1 FROM workspace WHERE id=1').get(); return json({ status: 'ok', storage: 'sqlite' }); }
          if (path === '/api/session' && request.method === 'GET') {
            const username = authentication.session(request); return json(username ? { authenticated: true, username } : { authenticated: false });
          }
          if (path === '/api/login' && request.method === 'POST') {
            const input = strictObject(await jsonBody(request, Math.min(maxBodyBytes, 4096)), ['username', 'password']);
            if (typeof input.username !== 'string' || !input.username || input.username.length > 100 || typeof input.password !== 'string' || input.password.length > 1024) throw new ApiFailure(422, 'INVALID_INPUT', '用户名或密码格式不合法');
            const token = await authentication.login(input.username, input.password, listener.requestIP(request)?.address ?? 'unknown');
            return json({ authenticated: true, username: authentication.username }, 200, { 'Set-Cookie': sessionCookie(token, secure) });
          }
          if (path === '/api/logout' && request.method === 'POST') { authentication.logout(request); return json({ authenticated: false }, 200, { 'Set-Cookie': sessionCookie('', secure) }); }
          if (!authentication.session(request)) throw new ApiFailure(401, 'AUTH_REQUIRED', '请先登录拓扑制作工具');
          if (path === '/api/workspace' && request.method === 'GET') return json(store.read());
          if (path === '/api/workspace/commands' && request.method === 'POST') return json(store.execute(parseCommandRequest(await jsonBody(request, maxBodyBytes))));
          if (['/api/workspace', '/api/workspace/commands', '/api/session', '/api/login', '/api/logout', '/api/health'].includes(path)) throw new ApiFailure(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
          throw new ApiFailure(404, 'NOT_FOUND', '接口不存在');
        } catch (error) {
          const failure = error instanceof ApiFailure ? error : new ApiFailure(500, 'INTERNAL_ERROR', '服务器暂时无法完成请求，请保留当前内容并重试');
          const body: ApiErrorResponse = { error: { code: failure.code, message: failure.message, ...failure.details } };
          return json(body, failure.status, failure.status === 429 ? { 'Retry-After': '900' } : {});
        }
      },
    });
    return { server, async close() { await server.stop(true); store.close(); } };
  } catch (error) { store.close(); throw error; }
}

if (import.meta.main) {
  const application = await createServer();
  console.log(`Topology server listening on ${application.server.hostname}:${application.server.port}`);
  const stop = async () => { await application.close(); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
