import { copyFileSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Use explicit ESM specifiers so declarations also work with NodeNext consumers.
function patchDeclarations(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) patchDeclarations(path);
    else if (path.endsWith('.d.ts')) writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, before, value, after) => `${before}${value.endsWith('.js') ? value : `${value}.js`}${after}`));
  }
}
patchDeclarations('dist-viewer/types');
writeFileSync('dist-viewer/package.json', JSON.stringify({
  name: '@topology-kit/viewer', version: '0.1.0', private: true, type: 'module',
  module: './topology-viewer.js', types: './types/viewer-index.d.ts', unpkg: './topology-viewer.umd.js',
  exports: { '.': { types: './types/viewer-index.d.ts', import: './topology-viewer.js', default: './topology-viewer.js' }, './schema': './topology-v2.schema.json' },
}, null, 2));
copyFileSync('schema/topology-v2.schema.json', 'dist-viewer/topology-v2.schema.json');
copyFileSync('docs/integration.md', 'dist-viewer/README.md');
