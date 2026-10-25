import { resolve } from 'node:path';

const port = process.env.TOPOLOGY_PORT || '3001';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('TOPOLOGY_PORT 必须是 1–65535 之间的整数');
const origin = `http://127.0.0.1:${port}`;
const environment = { ...process.env, TOPOLOGY_HOST: '127.0.0.1', TOPOLOGY_PORT: port, TOPOLOGY_DATA_DIR: resolve(process.env.TOPOLOGY_DATA_DIR || 'data') };
// Refuse an occupied API port, rather than accidentally proxying another
// developer process while Bun's watch process waits after a bind failure.
try { Bun.listen({ hostname: '127.0.0.1', port: Number(port), socket: { data() {} } }).stop(true); }
catch { throw new Error(`后端端口 ${port} 已被占用，请停止原开发服务或设置 TOPOLOGY_PORT。`); }
const backend = Bun.spawn([process.execPath, '--watch', 'server/index.ts'], { env: environment, stdout: 'inherit', stderr: 'inherit' });
let frontend: ReturnType<typeof Bun.spawn> | undefined;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  backend.kill();
  frontend?.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
backend.exited.then(code => { if (!stopping) stop(code || 1); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).storage === 'sqlite') { ready = true; break; }
    } catch { /* Wait for the backend to finish opening its database. */ }
    await Bun.sleep(150);
  }
  if (!ready || stopping) throw new Error(`后端未能在 ${origin} 启动，请检查端口和上方错误。`);
  console.log(`服务器数据目录：${environment.TOPOLOGY_DATA_DIR}`);
  console.log(`首次登录信息：${resolve(environment.TOPOLOGY_DATA_DIR, 'admin-credentials.json')}（请勿提交此文件）`);
  frontend = Bun.spawn([process.execPath, 'node_modules/vite/bin/vite.js', '--host', '0.0.0.0', ...process.argv.slice(2)], {
    env: { ...environment, TOPOLOGY_STORAGE_MODE: 'server', TOPOLOGY_API_ORIGIN: origin }, stdout: 'inherit', stderr: 'inherit',
  });
  const code = await frontend.exited;
  stop(code);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
