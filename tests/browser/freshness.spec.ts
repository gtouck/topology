import { expect, test, type Page } from '@playwright/test';
import { readFile, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sampleDocument } from '../../src/document';

const node = (page: Page, id = 'ant-01') => page.locator(`[data-device-node="${id}"]`);
const link = (page: Page) => page.locator('.x6-edge[data-cell-id="link-rx-rf"]');
const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
async function viewer(page: Page, two = false) {
  await page.goto('/viewer.html' + (two ? '?instances=2' : ''));
  await page.locator('#viewer-file').setInputFiles({ name: 'freshness.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleDocument('ground-station'))) });
}

test('S08 编辑器超时自动停止、时间显示与恢复，不污染编辑输入和文档', async ({ page }) => {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click();
  await node(page).click(); await page.locator('#device-title').fill('尚未应用的标题');
  const before = await snapshot(page);
  await page.locator('[data-action="data-settings"]').click(); await page.locator('#freshness-seconds').fill('');
  await page.locator('[data-action="apply-data-settings"]').click(); await expect(page.locator('#freshness-seconds-error')).toContainText('请填写');
  expect(await page.evaluate(() => window.stationPrototype.getDataStatus().staleAfterMs)).toBe(15000);
  await page.locator('#freshness-seconds').fill('0.5');
  await page.locator('[data-action="apply-data-settings"]').click();
  await page.evaluate(() => {
    window.stationPrototype.updateTelemetry('DEV-001', { azimuth: 66.6 }, 'warning');
    window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up');
  });
  await expect(node(page)).toHaveAttribute('data-status', 'warning');
  await expect(page.locator('#detail-received')).toContainText('接收于');
  await expect(node(page)).toHaveAttribute('data-status', 'stale');
  await expect(node(page).locator('[data-metric="azimuth"]')).toHaveText('—');
  await expect(link(page)).toHaveAttribute('data-link-status', 'unknown');
  await expect(link(page)).toHaveAttribute('data-link-playing', 'false');
  await expect(page.locator('#device-title')).toHaveValue('尚未应用的标题');
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => window.stationPrototype.configureFreshness({ staleAfterMs: 2000 }));
  await page.evaluate(() => {
    window.stationPrototype.updateTelemetry('DEV-001', { azimuth: 44.4 }, 'normal');
    window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up');
  });
  await expect(node(page)).toHaveAttribute('data-status', 'normal');
  await page.locator('.mode-switch [data-action="monitor"]').click(); await expect(link(page)).toHaveAttribute('data-link-playing', 'true');
  expect(await snapshot(page)).toEqual(before);
});

test('S08 局部、空及非法更新不延长其他对象寿命，节点与链路分别计时', async ({ page }) => {
  await page.clock.install(); await viewer(page);
  await page.evaluate(() => {
    window.topologyViewer.configureFreshness({ staleAfterMs: 1000 });
    window.topologyViewer.setData({ 'DEV-001': { status: 'normal', azimuth: 10 }, 'DEV-002': { status: 'normal', gain: 20 } });
    window.topologyViewer.setLinkData({ 'link-rx-rf': { status: 'up' } });
  });
  const original = await page.evaluate(() => window.topologyViewer.getDefinition());
  await page.clock.runFor(600);
  await page.evaluate(() => window.topologyViewer.updateData({ 'DEV-001': { azimuth: 11 } }));
  const receipt = await page.evaluate(() => window.topologyViewer.getDataStatus());
  expect(receipt.nodes['ant-01'].receivedAt).toBeGreaterThan(receipt.nodes['lnb-01'].receivedAt!);
  expect(await page.evaluate(() => {
    try { window.topologyViewer.updateData({ 'DEV-001': { azimuth: 99 }, bad: null as never }); return false; } catch { return true; }
  })).toBe(true);
  await page.evaluate(() => { window.topologyViewer.updateData({}); window.topologyViewer.updateData({ 'DEV-001': {} }); window.topologyViewer.updateLinkData({ 'link-rx-rf': {} }); });
  expect(await page.evaluate(() => window.topologyViewer.getDataStatus().nodes['ant-01'].receivedAt)).toBe(receipt.nodes['ant-01'].receivedAt);
  await page.clock.runFor(500);
  await expect(node(page)).toHaveAttribute('data-status', 'normal'); await expect(node(page, 'lnb-01')).toHaveAttribute('data-status', 'stale');
  await expect(link(page)).toHaveAttribute('data-link-status', 'unknown');
  await page.evaluate(() => window.topologyViewer.updateLinkData({ 'link-rx-rf': { status: 'up' } }));
  await expect(link(page)).toHaveAttribute('data-link-status', 'unknown');
  await expect(link(page).locator('title')).toContainText('端点数据已过期');
  await page.evaluate(() => window.topologyViewer.updateData({ 'DEV-002': { status: 'normal', gain: 33 } }));
  await expect(link(page)).toHaveAttribute('data-link-playing', 'true');
  expect(await page.evaluate(() => window.topologyViewer.getDefinition())).toEqual(original);
});

test('S08 连接中断、重连和实际离线分别呈现，必须收到新数据才恢复', async ({ page }) => {
  await viewer(page);
  await page.evaluate(() => {
    window.topologyViewer.setData({ 'DEV-001': { status: 'normal', azimuth: 12 } });
    window.topologyViewer.setLinkData({ 'link-rx-rf': { status: 'up' } });
    window.topologyViewer.setConnectionState('disconnected');
  });
  await expect(node(page)).toHaveAttribute('data-status', 'disconnected'); await expect(link(page)).toHaveAttribute('data-link-playing', 'false');
  await page.evaluate(() => window.topologyViewer.setConnectionState('connected'));
  await expect(node(page)).toHaveAttribute('data-status', 'stale'); await expect(link(page)).toHaveAttribute('data-link-status', 'unknown');
  await page.evaluate(() => window.topologyViewer.updateData({ 'DEV-001': { status: 'offline' } }));
  await expect(node(page)).toHaveAttribute('data-status', 'offline'); await expect(link(page)).toHaveAttribute('data-link-status', 'down');
  await page.evaluate(() => window.topologyViewer.updateData({ 'DEV-001': { status: 'normal' } }));
  await expect(link(page)).toHaveAttribute('data-link-status', 'unknown');
  await page.evaluate(() => window.topologyViewer.updateLinkData({ 'link-rx-rf': { status: 'up' } }));
  await expect(link(page)).toHaveAttribute('data-link-playing', 'true');
  await node(page).click(); await expect(page.locator('.tv-data-status')).toContainText('接收于');
  await page.evaluate(() => window.topologyViewer.setData({})); await expect(node(page)).toHaveAttribute('data-status', 'pending');
});

test('S08 实例超时互不影响，可关闭超时，切定义清空，销毁清理计时器', async ({ page }) => {
  await page.clock.install(); await viewer(page, true);
  await page.locator('#viewer-timeout').fill('1'); await page.locator('#apply-viewer-freshness').click();
  await page.evaluate(() => {
    window.secondTopologyViewer!.configureFreshness({ staleAfterMs: 0 });
    const data = { 'DEV-001': { status: 'normal', azimuth: 10 } };
    window.topologyViewer.setData(data); window.secondTopologyViewer!.setData(data);
  });
  await page.clock.runFor(1100);
  await expect(page.locator('#standalone-viewer [data-device-node="ant-01"]')).toHaveAttribute('data-status', 'stale');
  await expect(page.locator('#second-viewer [data-device-node="ant-01"]')).toHaveAttribute('data-status', 'normal');
  expect(await page.evaluate(() => { try { window.topologyViewer.configureFreshness({ staleAfterMs: -1 }); return false; } catch { return true; } })).toBe(true);
  expect(await page.evaluate(() => window.topologyViewer.getDataStatus().staleAfterMs)).toBe(1000);
  await page.evaluate(() => window.topologyViewer.setDefinition(window.topologyViewer.getDefinition()));
  await expect(page.locator('#standalone-viewer [data-device-node="ant-01"]')).toHaveAttribute('data-status', 'pending');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const pending = await page.evaluate(() => {
    const ids = new Set<number>(), originalSet = window.setTimeout.bind(window), originalClear = window.clearTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = originalSet(() => { ids.delete(id); if (typeof callback === 'function') callback(...args); }, delay);
      ids.add(id); return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = id => { if (id !== undefined) ids.delete(id); originalClear(id); };
    window.topologyViewer.setData({ 'DEV-001': { status: 'normal' } });
    const before = ids.size;
    window.topologyViewer.destroy(); window.topologyViewer.destroy();
    return { before, after: ids.size };
  });
  expect(pending.before).toBeGreaterThan(0); expect(pending.after).toBe(0);
  await page.clock.runFor(2000); expect(errors).toEqual([]);
  await expect(page.locator('#standalone-viewer .topology-viewer')).toHaveCount(0);
  await expect(page.locator('#second-viewer [data-device-node="ant-01"]')).toHaveAttribute('data-status', 'normal');
});

test('S08 过期静态导出及离线 HTML 快照冻结，宿主更新进入实时生命周期', async ({ page, context }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => { window.stationPrototype.configureFreshness({ staleAfterMs: 200 }); window.stationPrototype.updateTelemetry('DEV-001', { azimuth: 99.9 }, 'normal'); window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up'); });
  await expect(node(page)).toHaveAttribute('data-status', 'stale');
  const before = await snapshot(page); await page.locator('[data-action="export-options"]').click();
  const svgDownload = page.waitForEvent('download'); await page.locator('[data-action="export-svg"]').click();
  const svg = await readFile((await (await svgDownload).path())!, 'utf8');
  expect(svg).toContain('data-node-id="ant-01" data-status="stale"'); expect(svg).toContain('数据已过期'); expect(svg).not.toContain('99.9');
  const htmlDownload = page.waitForEvent('download'); await page.locator('[data-action="export-html"]').click();
  const html = await htmlDownload, path = testInfo.outputPath('expired.html');
  await copyFile((await html.path())!, path);
  expect(await snapshot(page)).toEqual(before);
  await context.setOffline(true);
  await page.goto(pathToFileURL(path).href); await expect(node(page)).toHaveAttribute('data-status', 'stale');
  expect(await page.evaluate(() => window.topologyViewer.getDataStatus().mode)).toBe('snapshot');
  await page.clock.install(); await page.clock.runFor(2000); await expect(node(page)).toHaveAttribute('data-status', 'stale');
  expect(await page.evaluate(() => window.topologyViewer.getDataStatus().staleAfterMs)).toBe(200);
  await page.evaluate(() => { window.topologyViewer.updateData({ 'DEV-001': { status: 'normal', azimuth: 22.2 } }); window.topologyViewer.updateLinkData({ 'link-rx-rf': { status: 'up' } }); });
  expect(await page.evaluate(() => window.topologyViewer.getDataStatus().mode)).toBe('live');
  await expect(node(page)).toHaveAttribute('data-status', 'normal'); await expect(link(page)).toHaveAttribute('data-link-playing', 'true');
  await page.clock.runFor(210); await expect(node(page)).toHaveAttribute('data-status', 'stale'); await expect(link(page)).toHaveAttribute('data-link-playing', 'false');
});

test('S08 编辑器接收状态跨撤销保留，切模式和切图清理', async ({ page }) => {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click();
  await page.evaluate(() => { window.stationPrototype.configureFreshness({ staleAfterMs: 10000 }); window.stationPrototype.updateTelemetry('DEV-001', { azimuth: 30 }, 'normal'); });
  const receipt = await page.evaluate(() => window.stationPrototype.getDataStatus().nodes['ant-01'].receivedAt);
  await node(page).click(); await page.locator('#device-title').fill('时间保留测试'); await page.locator('[data-action="apply-device"]').click();
  await page.locator('[data-action="undo"]').click();
  expect(await page.evaluate(() => window.stationPrototype.getDataStatus().nodes['ant-01'].receivedAt)).toBe(receipt);
  await page.locator('#data-mode').selectOption('simulation'); await page.locator('#data-mode').selectOption('external');
  expect(await page.evaluate(() => window.stationPrototype.getDataStatus().nodes['ant-01'])).toEqual({ phase: 'waiting', receivedAt: null });
  await page.evaluate(() => window.stationPrototype.updateTelemetry('DEV-001', { azimuth: 30 }, 'normal'));
  await page.locator('.heading-actions [data-action="library"]').click(); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('无运行数据的新图'); await page.locator('#new-document-kind').selectOption('datacenter'); await page.locator('[data-action="create-document"]').click();
  const status = await page.evaluate(() => window.stationPrototype.getDataStatus());
  expect(Object.values(status.nodes).every(state => state.phase === 'waiting' && state.receivedAt === null)).toBe(true);
  expect(Object.values(status.links).every(state => state.phase === 'waiting')).toBe(true);
});
