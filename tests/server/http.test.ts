import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ServerOptions } from '../../server/index';
import type { WorkspaceResponse } from '../../shared/api';

const username = 'test-admin', password = 'test-password-with-sufficient-length';
const resources: { application: Awaited<ReturnType<typeof createServer>>; directory: string; options: ServerOptions }[] = [];
async function start(options: Partial<ServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'topology-http-')), siteDir = join(directory, 'site');
  await mkdir(siteDir); await writeFile(join(siteDir, 'index.html'), '<!doctype html><html><head><title>Tool</title></head><body>工具</body></html>');
  await writeFile(join(siteDir, 'viewer.html'), '<html><head></head><body>展示</body></html>');
  const config: ServerOptions = { dataDir: join(directory, 'data'), siteDir, hostname: '127.0.0.1', port: 0, adminUsername: username, adminPassword: password, ...options };
  const application = await createServer(config), resource = { application, directory, options: config }; resources.push(resource);
  const origin = () => `http://127.0.0.1:${resource.application.server.port}`;
  const request = (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => fetch(`${origin()}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', origin: origin() }), ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = async () => {
    const response = await request('/api/login', { username, password }); expect(response.status).toBe(200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  return { resource, origin, request, login };
}
afterEach(async () => {
  for (const resource of resources.splice(0)) { await resource.application.close(); await rm(resource.directory, { recursive: true, force: true }); }
});

describe('HTTP server and authentication', () => {
  test('requires login for all workspace reads/writes; HttpOnly session persists on restart and logout invalidates it', async () => {
    const app = await start();
    expect((await app.request('/api/health')).status).toBe(200);
    expect(await (await app.request('/api/session')).json()).toEqual({ authenticated: false });
    expect((await app.request('/api/workspace')).status).toBe(401);
    expect((await app.request('/api/workspace/commands', {})).status).toBe(401);
    const response = await app.request('/api/login', { username, password });
    expect(response.headers.get('set-cookie')).toContain('HttpOnly'); expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const before = await (await app.request('/api/workspace', undefined, cookie)).json() as WorkspaceResponse;
    const document = { ...before.workspace.documents[0], name: '重启后仍可读' };
    const write = await app.request('/api/workspace/commands', { expectedRevision: before.revision, requestId: 'request-persistent', command: { type: 'saveDocument', document } }, cookie);
    expect(write.status).toBe(200);
    await app.resource.application.close(); app.resource.application = await createServer(app.resource.options);
    expect(await (await app.request('/api/session', undefined, cookie)).json()).toEqual({ authenticated: true, username });
    expect((await (await app.request('/api/workspace', undefined, cookie)).json() as WorkspaceResponse).workspace.documents[0].name).toBe(document.name);
    expect((await app.request('/api/logout', {}, cookie)).status).toBe(200);
    expect((await app.request('/api/workspace', undefined, cookie)).status).toBe(401);
  });

  test('two independent sessions see committed data and stale revision writes receive 409', async () => {
    const app = await start(), a = await app.login(), b = await app.login();
    const state = await (await app.request('/api/workspace', undefined, a)).json() as WorkspaceResponse;
    const first = { expectedRevision: state.revision, requestId: 'first-browser-write', command: { type: 'saveDraft', document: { ...state.workspace.documents[0], name: '浏览器 A 草稿' } } };
    expect((await app.request('/api/workspace/commands', first, a)).status).toBe(200);
    const failed = await app.request('/api/workspace/commands', { ...first, requestId: 'second-browser-write' }, b);
    expect(failed.status).toBe(409); expect((await failed.json()).error.code).toBe('WORKSPACE_CONFLICT');
    const other = await (await app.request('/api/workspace', undefined, b)).json() as WorkspaceResponse;
    expect(other.workspace.editing.drafts[0].document.name).toBe('浏览器 A 草稿');
  });

  test('rejects cross-origin writes, malformed JSON, unknown fields and oversized bodies without leaking server errors', async () => {
    const app = await start({ maxBodyBytes: 4096 }), cookie = await app.login();
    const originResponse = await app.request('/api/logout', {}, cookie, { origin: 'https://untrusted.example' });
    expect(originResponse.status).toBe(403); expect((await originResponse.json()).error.code).toBe('ORIGIN_REJECTED');
    expect((await app.request('/api/login', { username, password, extra: true })).status).toBe(422);
    const malformed = await fetch(`${app.origin()}/api/workspace/commands`, { method: 'POST', headers: { cookie, origin: app.origin(), 'content-type': 'application/json' }, body: '{broken' });
    expect(malformed.status).toBe(422);
    const large = await app.request('/api/workspace/commands', { text: 'x'.repeat(5000) }, cookie);
    expect(large.status).toBe(413); expect((await large.json()).error.code).toBe('BODY_TOO_LARGE');
    expect((await app.request('/api/workspace', undefined, cookie)).status).toBe(200);
  });

  test('serves no-store HTML with server marker, falls back only to older assets and never exposes data or symlinks outside site', async () => {
    const releasesDir = await mkdtemp(join(tmpdir(), 'topology-releases-'));
    try {
      await mkdir(join(releasesDir, '20250101', 'site', 'assets'), { recursive: true });
      await writeFile(join(releasesDir, '20250101', 'site', 'assets', 'old-ABCDEF123.js'), 'export const old = true;');
      await writeFile(join(releasesDir, '20250101', 'site', 'old.html'), '<html>old</html>');
      const app = await start({ releasesDir });
      const page = await app.request('/'); expect(page.headers.get('cache-control')).toBe('no-store');
      expect(await page.text()).toContain('<meta name="topology-storage" content="server">');
      expect(await (await app.request('/viewer.html')).text()).toContain('topology-storage');
      const asset = await app.request('/assets/old-ABCDEF123.js'); expect(asset.status).toBe(200); expect(asset.headers.get('cache-control')).toContain('immutable');
      expect((await app.request('/old.html')).status).toBe(404);
      expect((await app.request('/data/admin-credentials.json')).status).toBe(404);
      expect((await app.request('/%2e%2e/data/admin-credentials.json')).status).toBe(404);
      try {
        await symlink(join(app.resource.options.dataDir!, 'admin-credentials.json'), join(app.resource.options.siteDir!, 'credentials.json'));
        expect((await app.request('/credentials.json')).status).toBe(404);
      } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        console.warn('SKIP: Windows account cannot create symlinks; path and authentication checks still ran');
      }
      expect((await app.request('/api/health')).headers.get('cache-control')).toBe('no-store');
    } finally { await rm(releasesDir, { recursive: true, force: true }); }
  });

  test('persistent credentials are private and manual password rotation revokes existing sessions', async () => {
    const app = await start(), cookie = await app.login(), path = join(app.resource.options.dataDir!, 'admin-credentials.json');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ username, password });
    await app.resource.application.close();
    const nextPassword = 'rotated-password-with-sufficient-length';
    await writeFile(path, JSON.stringify({ username, password: nextPassword }));
    app.resource.options.adminPassword = undefined; app.resource.application = await createServer(app.resource.options);
    expect((await app.request('/api/workspace', undefined, cookie)).status).toBe(401);
    expect((await app.request('/api/login', { username, password })).status).toBe(401);
    expect((await app.request('/api/login', { username, password: nextPassword })).status).toBe(200);
  });

  test('failed login attempts are limited while successful logins clear the failure counter', async () => {
    const app = await start();
    for (let index = 0; index < 2; index++) expect((await app.request('/api/login', { username, password: 'incorrect' })).status).toBe(401);
    expect((await app.request('/api/login', { username, password })).status).toBe(200);
    for (let index = 0; index < 8; index++) expect((await app.request('/api/login', { username, password: 'incorrect' })).status).toBe(401);
    const blocked = await app.request('/api/login', { username, password: 'incorrect' });
    expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('900');
  });

  test('generates persistent credentials only once when no credentials are provided', async () => {
    const app = await start({ adminUsername: undefined, adminPassword: undefined });
    const path = join(app.resource.options.dataDir!, 'admin-credentials.json'), first = JSON.parse(await readFile(path, 'utf8'));
    expect(first.username).toBe('admin'); expect(first.password.length).toBeGreaterThanOrEqual(24);
    await app.resource.application.close(); app.resource.application = await createServer(app.resource.options);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(first);
    expect((await app.request('/api/login', first)).status).toBe(200);
  });
});
