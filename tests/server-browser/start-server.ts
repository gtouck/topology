import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from '../../server/index';

const dataDir = await mkdtemp(join(tmpdir(), 'topology-server-browser-'));
const app = await createServer({
  dataDir, siteDir: resolve('dist'), hostname: '127.0.0.1', port: 5183,
  adminUsername: 'browser-admin', adminPassword: 'only-for-isolated-browser-tests',
});
console.log(`Isolated server browser fixture listening on ${app.server.port}`);
let stopping = false;
async function close() {
  if (stopping) return; stopping = true;
  await app.close(); await rm(dataDir, { recursive: true, force: true }); process.exit(0);
}
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
