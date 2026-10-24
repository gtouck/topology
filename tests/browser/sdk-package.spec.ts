import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleDocument } from '../../src/document';
import type * as Kit from '../../src/viewer-index';

for (const format of ['umd', 'esm']) test(`S12 ${format} 构建包独立宿主加载，无存储访问或工作台依赖`, async ({ page }) => {
  await page.route('**/sdk-host.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="viewer" style="height:500px;width:900px"></div></body></html>' }));
  const bundle = await readFile(format === 'umd' ? 'dist-viewer/topology-viewer.umd.js' : 'dist-viewer/topology-viewer.js', 'utf8');
  await page.route('**/standalone-bundle.js', route => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: bundle }));
  await page.goto('/sdk-host.html');
  await page.evaluate(() => { (window as unknown as { storageAttempts: number }).storageAttempts = 0; Object.defineProperty(window, 'localStorage', { get() { (window as unknown as { storageAttempts: number }).storageAttempts++; throw new Error('宿主禁止存储'); } }); });
  if (format === 'umd') await page.addScriptTag({ url: '/standalone-bundle.js' });
  const definition = sampleDocument('ground-station');
  const result = await page.evaluate(async ({ definition, format }) => {
    const kit = format === 'umd' ? (window as unknown as { TopologyKit: typeof Kit }).TopologyKit : await import(/* @vite-ignore */ '/standalone-bundle.js') as typeof Kit;
    const viewer = new kit.TopologyViewer(document.querySelector<HTMLElement>('#viewer')!, { definition, freshness: { staleAfterMs: 0 } });
    const parsed = kit.parseDocument(viewer.getDefinition());
    viewer.updateData({ 'DEV-001': { status: 'warning', azimuth: 22.2 } }); viewer.updateLinkData({ 'link-rx-rf': { status: 'up' } });
    viewer.focus('ant-01'); const results = viewer.search('DEV-001');
    const count = document.querySelectorAll('.device-card').length, status = document.querySelector('[data-device-node="ant-01"]')!.getAttribute('data-status');
    viewer.setConnectionState('disconnected'); const connection = viewer.getDataStatus().connection;
    viewer.destroy();
    return { count, status, connection, results, parsed, attempts: (window as unknown as { storageAttempts: number }).storageAttempts, roots: document.querySelectorAll('.topology-viewer').length };
  }, { definition, format });
  expect(result.count).toBe(8); expect(result.status).toBe('warning'); expect(result.parsed).toEqual(definition);
  expect(result.results[0].id).toBe('ant-01'); expect(result.connection).toBe('disconnected'); expect(result.attempts).toBe(0); expect(result.roots).toBe(0);
});
