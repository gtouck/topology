import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import budgets from './artifact-budgets.json';
import { version } from '../package.json';

const pkg = JSON.parse(readFileSync('dist-viewer/package.json', 'utf8'));
assert.equal(pkg.version, version, '工作台与组件版本必须一致');
assert.equal(pkg.name, '@topology-kit/viewer');
for (const path of [pkg.module, pkg.types, pkg.unpkg, ...Object.values(pkg.exports).filter(v => typeof v === 'string')]) assert(existsSync(resolve('dist-viewer', path as string)), `组件缺少 ${path}`);
assert.equal(JSON.parse(readFileSync('dist-viewer/topology-v3.schema.json', 'utf8')).properties.version.const, 3);

function check(path: string, budget: { bytes: number; gzipBytes: number }) {
  const data = readFileSync(path), gzip = gzipSync(data).length;
  assert(data.length <= budget.bytes, `${path} 超过原始体积预算 ${budget.bytes}`);
  assert(gzip <= budget.gzipBytes, `${path} 超过 gzip 预算 ${budget.gzipBytes}`);
  return { path, bytes: data.length, gzipBytes: gzip };
}
const sizes = [check('dist-viewer/topology-viewer.js', budgets.viewerEsm), check('dist-viewer/topology-viewer.umd.js', budgets.viewerUmd)];
for (const name of readdirSync('dist/assets').filter(name => name.endsWith('.js'))) sizes.push(check(join('dist/assets', name), budgets.editorChunk));

// Compile a consumer outside this repository so missing type dependencies cannot
// be accidentally supplied by the workbench's node_modules or skipLibCheck.
const directory = mkdtempSync(join(tmpdir(), 'topology-sdk-consumer-'));
try {
  const destination = join(directory, 'node_modules/@topology-kit/viewer'); mkdirSync(dirname(destination), { recursive: true }); cpSync('dist-viewer', destination, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', types: [], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['consumer.ts'] }));
  writeFileSync(join(directory, 'consumer.ts'), `import { TopologyViewer, createDocument, type PublicationRepository } from '@topology-kit/viewer';
const view = new TopologyViewer(document.createElement('div'), { definition: createDocument('类型检查'), onNavigate: event => { const id: string = event.documentId; console.log(id); } });
view.updateData({ device: { status: 'normal', value: 42 } }); view.updateLinkData({ cable: { status: 'up' } });
view.search('节点'); view.focus('node'); view.configureFreshness({ staleAfterMs: 1000 }); view.setConnectionState('connected'); view.destroy();
const repository: PublicationRepository | undefined = undefined; console.log(repository);
`);
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')], { stdio: 'pipe' });
} catch (error) {
  if (error && typeof error === 'object' && 'stdout' in error) console.error(String(error.stdout));
  throw error;
} finally { rmSync(directory, { recursive: true, force: true }); }
mkdirSync('artifacts/package', { recursive: true });
writeFileSync('artifacts/package/sizes.json', JSON.stringify({ version, budgets, sizes }, null, 2));
console.log(`组件 ${version}：声明独立消费、入口、Schema 和 ${sizes.length} 个 JS 体积预算通过`);
console.log(JSON.stringify(sizes));
