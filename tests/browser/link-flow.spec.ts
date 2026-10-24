import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sampleDocument } from '../../src/document';

const id = 'link-rx-rf';
const edge = (page: Page, link = id) => page.locator(`.x6-edge[data-cell-id="${link}"]`);
const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const chooseEdge = (page: Page) => page.evaluate(() => window.stationPrototype.graph.resetSelection(['link-rx-rf']));
const forward = (page: Page) => edge(page).locator('.cable-flow-inner.cable-flow-forward');
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'no-preference' }); });

test('链路流转：材质高光实际移动，停止/恢复不改路径与文档', async ({ page }) => {
  await page.goto('/'); await expect(edge(page)).toHaveAttribute('data-link-playing', 'true');
  const before = await snapshot(page);
  const d = await edge(page).locator('.cable-line').getAttribute('d');
  await expect(forward(page)).toHaveAttribute('d', d!);
  const a = await forward(page).evaluate(el => getComputedStyle(el).strokeDashoffset);
  await expect.poll(() => forward(page).evaluate(el => getComputedStyle(el).strokeDashoffset)).not.toBe(a);
  // Compare pixels along the cable itself, excluding node text and its midpoint label.
  const points = await edge(page).locator('.cable-line').evaluate((el: SVGPathElement) => {
    const length = el.getTotalLength(), matrix = el.getScreenCTM()!;
    return Array.from({ length: 70 }, (_, i) => .1 + i / 100).filter(t => Math.abs(t - .5) > .08).map(t => {
      const p = el.getPointAtLength(length * t).matrixTransform(matrix); return { x: p.x, y: p.y };
    });
  });
  const first = (await page.screenshot()).toString('base64');
  await page.waitForTimeout(270);
  const second = (await page.screenshot()).toString('base64');
  const changed = await page.evaluate(async ({ first, second, points }) => {
    async function pixels(data: string) {
      const image = new Image(), ready = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
      image.src = `data:image/png;base64,${data}`; await ready;
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return points.map(p => Array.from(ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data));
    }
    const a = await pixels(first), b = await pixels(second);
    return a.filter((p, i) => p.some((v, j) => Math.abs(v - b[i][j]) > 15)).length;
  }, { first, second, points });
  expect(changed, 'highlights must actually paint at different positions').toBeGreaterThan(0);
  // Click an actual path point away from the label, which covers the path center.
  await page.mouse.click(points[8].x, points[8].y);
  await page.locator('[data-action="toggle-link-demo"]').click();
  await expect(edge(page)).toHaveAttribute('data-link-status', 'down');
  await page.locator('[data-action="toggle-link-demo"]').click();
  await expect(edge(page)).toHaveAttribute('data-link-playing', 'true');
  await page.evaluate(() => window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'down'));
  await expect(edge(page)).toHaveAttribute('data-link-status', 'down');
  await expect(forward(page)).toHaveCSS('display', 'none');
  await expect(edge(page).locator('.cable-line')).toHaveAttribute('stroke-dasharray', '6 5');
  await page.evaluate(() => window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up'));
  await expect(edge(page)).toHaveAttribute('data-link-playing', 'true');
  expect(await edge(page).locator('.cable-line').getAttribute('d')).toBe(d);
  expect(await snapshot(page)).toEqual(before);
});

test('链路流转：五种材质、双线间隙、方向速度及开关保存并可撤销', async ({ page }, testInfo) => {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click(); await chooseEdge(page);
  const before = await snapshot(page);
  for (const style of ['solid', 'dashed', 'double', 'jacket', 'braided']) {
    await page.locator('#edge-cable-style').selectOption(style);
    await page.locator('#edge-flow-direction').selectOption('both');
    await page.locator('#edge-flow-speed').selectOption('fast');
    await page.locator('[data-action="apply-edge"]').click();
    await expect(edge(page)).toHaveAttribute('data-link-playing', 'false');
    await page.locator('.mode-switch [data-action="monitor"]').click();
    await expect(edge(page)).toHaveAttribute('data-link-playing', 'true');
    const layer = style === 'double' ? 'outer' : 'inner';
    await expect(edge(page).locator(`.cable-flow-${layer}.cable-flow-forward`)).toHaveCSS('display', 'block');
    await expect(edge(page).locator(`.cable-flow-${layer}.cable-flow-reverse`)).toHaveCSS('animation-direction', 'reverse');
    if (style === 'double') {
      expect(await edge(page).evaluate(el => {
        const core = el.querySelector('.cable-core')!, flow = el.querySelector('.cable-flow-outer')!;
        return !!(flow.compareDocumentPosition(core) & Node.DOCUMENT_POSITION_FOLLOWING);
      })).toBe(true);
    }
    await page.locator('.mode-switch [data-action="edit"]').click(); await chooseEdge(page);
  }
  await page.locator('#edge-flow-direction').selectOption('reverse'); await page.locator('#edge-flow-speed').selectOption('slow');
  await page.locator('#edge-status').selectOption('down');
  await page.locator('[data-action="apply-edge"]').click(); const configured = await snapshot(page);
  expect(configured.edges[0]).toMatchObject({ status: 'down', flow: { enabled: true, direction: 'reverse', speed: 'slow' } });
  expect(configured.edges.map(e => e.vertices)).toEqual(before.edges.map(e => e.vertices));
  await page.locator('[data-action="undo"]').click(); expect((await snapshot(page)).edges[0].status).toBe('up');
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(configured);
  await page.locator('[data-action="save"]').click(); await page.reload(); await expect(edge(page)).toHaveAttribute('data-link-status', 'down');
  expect(await snapshot(page)).toEqual(configured);
  await page.locator('.mode-switch [data-action="edit"]').click(); await chooseEdge(page);
  await page.locator('#edge-status').selectOption('up'); await page.locator('#edge-flow-enabled').uncheck();
  await page.locator('[data-action="apply-edge"]').click(); await page.locator('.mode-switch [data-action="monitor"]').click();
  await expect(edge(page)).toHaveAttribute('data-link-status', 'up'); await expect(edge(page)).toHaveAttribute('data-link-playing', 'false');
  await page.screenshot({ path: testInfo.outputPath('link-settings.png') });
});

test('链路流转：宿主更新、空闲、端点离线兜底及模式切换不污染编辑输入', async ({ page }) => {
  await page.goto('/'); const before = await snapshot(page);
  expect(await page.evaluate(() => window.stationPrototype.updateLinkTelemetry('missing', 'down'))).toBe(0);
  await page.locator('.mode-switch [data-action="edit"]').click(); await chooseEdge(page); await page.locator('#edge-label-input').fill('尚未应用的链路名称');
  await page.evaluate(() => window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up'));
  await expect(page.locator('#edge-label-input')).toHaveValue('尚未应用的链路名称');
  await expect(page.locator('#data-mode')).toHaveValue('external'); await expect(page.locator('#edge-runtime-status')).toHaveText('连通');
  await page.locator('.mode-switch [data-action="monitor"]').click();
  await expect(edge(page)).toHaveAttribute('data-link-playing', 'true');
  await page.evaluate(() => window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up', false));
  await expect(edge(page)).toHaveAttribute('data-link-status', 'up'); await expect(edge(page)).toHaveAttribute('data-link-playing', 'false');
  await page.evaluate(() => window.stationPrototype.updateTelemetry('DEV-001', {}, 'offline'));
  await expect(edge(page)).toHaveAttribute('data-link-status', 'down');
  await page.evaluate(() => { window.stationPrototype.updateTelemetry('DEV-001', {}, 'normal'); window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up'); });
  await expect(edge(page)).toHaveAttribute('data-link-playing', 'true');
  await page.waitForTimeout(2300); await expect(edge(page)).toHaveAttribute('data-link-status', 'up');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#data-mode').selectOption('simulation'); await page.locator('#data-mode').selectOption('external');
  await expect(edge(page)).toHaveAttribute('data-link-status', 'unknown'); await expect(edge(page)).toHaveAttribute('data-link-playing', 'false');
  expect(await snapshot(page)).toEqual(before);
});

test('链路流转：独立组件清空、批量校验、实例隔离、关闭动画及减少动态效果', async ({ page }) => {
  await page.goto('/viewer.html?instances=2');
  const doc = sampleDocument('ground-station');
  await page.locator('#viewer-file').setInputFiles({ name: 'links.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  const first = page.locator('#standalone-viewer'), second = page.locator('#second-viewer');
  await expect(first.locator('.x6-edge').first()).toHaveAttribute('data-link-status', 'unknown');
  await page.evaluate(() => window.topologyViewer.setLinkData({ 'link-rx-rf': { status: 'up' } }));
  await expect(first.locator('.x6-edge[data-cell-id="link-rx-rf"]')).toHaveAttribute('data-link-playing', 'true');
  await expect(second.locator('.x6-edge[data-cell-id="link-rx-rf"]')).toHaveAttribute('data-link-status', 'unknown');
  const invalid = await page.evaluate(() => { try { window.topologyViewer.updateLinkData({ 'link-rx-rf': { status: 'down' }, invalid: { status: 'bad' as never } }); return false; } catch { return true; } });
  expect(invalid).toBe(true);
  await expect(first.locator('.x6-edge[data-cell-id="link-rx-rf"]')).toHaveAttribute('data-link-status', 'up');
  await page.evaluate(() => window.topologyViewer.updateLinkData({ 'link-rx-rf': { active: false } }));
  await expect(first.locator('.x6-edge[data-cell-id="link-rx-rf"]')).toHaveAttribute('data-link-playing', 'false');
  await page.evaluate(() => window.topologyViewer.updateLinkData({ 'link-rx-rf': { active: true } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(first.locator('.cable-flow-inner.cable-flow-forward').first()).toHaveCSS('display', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(first.locator('.cable-flow-inner.cable-flow-forward').first()).toHaveCSS('display', 'block');
  await page.evaluate(async () => {
    const { TopologyViewer } = await import('/src/viewer.ts');
    const container = document.createElement('div'); container.id = 'static-links'; container.style.height = '300px'; document.body.appendChild(container);
    const viewer = new TopologyViewer(container, { definition: window.topologyViewer.getDefinition(), animations: false, linkData: { 'link-rx-rf': { status: 'up' } } });
    window.addEventListener('pagehide', () => viewer.destroy(), { once: true });
  });
  await expect(page.locator('#static-links .x6-edge[data-cell-id="link-rx-rf"]')).toHaveAttribute('data-link-playing', 'false');
  await page.evaluate(() => window.topologyViewer.setLinkData({}));
  await expect(first.locator('.x6-edge[data-cell-id="link-rx-rf"]')).toHaveAttribute('data-link-status', 'unknown');
  expect(await page.evaluate(() => window.topologyViewer.getDefinition())).toEqual(doc);
});

test('链路流转：静态 SVG/PNG 与离线 HTML 分别保留状态和动态接口', async ({ page, context }, testInfo) => {
  await page.goto('/'); const before = await snapshot(page);
  await page.evaluate(() => { window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up'); window.stationPrototype.updateLinkTelemetry('link-rx-if', 'down'); window.stationPrototype.updateLinkTelemetry('link-tx-if', 'unknown'); });
  await page.locator('[data-action="export-options"]').click();
  for (const format of ['svg', 'png', 'html']) {
    const downloading = page.waitForEvent('download'); await page.locator(`[data-action="export-${format}"]`).click();
    const path = testInfo.outputPath(`flow.${format}`); await (await downloading).saveAs(path);
    if (format === 'svg') {
      const svg = await readFile(path, 'utf8'); expect(svg).toContain('data-edge-id="link-rx-if" data-link-status="down"');
      expect(svg).toContain('data-edge-id="link-rx-rf" data-link-status="up"'); expect(svg).not.toMatch(/@keyframes|<animate|cable-flow/);
    }
    if (format === 'png') expect((await readFile(path)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (format === 'html') {
      expect(await snapshot(page)).toEqual(before);
      await context.setOffline(true); await page.goto(pathToFileURL(path).href);
      await expect(edge(page)).toHaveAttribute('data-link-playing', 'true'); await expect(edge(page, 'link-rx-if')).toHaveAttribute('data-link-status', 'down');
      const initial = await forward(page).evaluate(el => getComputedStyle(el).strokeDashoffset);
      await expect.poll(() => forward(page).evaluate(el => getComputedStyle(el).strokeDashoffset)).not.toBe(initial);
      await page.evaluate(() => window.topologyViewer.updateLinkData({ 'link-rx-rf': { status: 'down' } }));
      await expect(edge(page)).toHaveAttribute('data-link-playing', 'false'); await expect(page.locator('#data-status')).toContainText('数据更新');
      expect(await page.evaluate(() => window.topologyViewer.getDefinition().topology.edges[0].status)).toBeUndefined();
    }
  }
});

test('链路流转：一千条链路批量更新复用路径，关闭组件后清理动画', async ({ page }, testInfo) => {
  const doc = sampleDocument('ground-station'), template = doc.topology.edges[0];
  doc.topology.edges = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(template), id: `load-${i}` }));
  await page.goto('/viewer.html');
  await page.locator('#viewer-file').setInputFiles({ name: 'large-links.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('.x6-edge')).toHaveCount(1000);
  const timing = await page.evaluate(() => {
    const first = document.querySelector('.x6-edge .cable-line');
    const data = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`load-${i}`, { status: 'up' as const }]));
    const start = performance.now(); window.topologyViewer.setLinkData(data); const updated = performance.now();
    window.topologyViewer.updateLinkData({ 'load-0': { status: 'down' } });
    return { batchMs: updated - start, updateMs: performance.now() - updated, reused: first === document.querySelector('.x6-edge .cable-line') };
  });
  expect(timing.reused).toBe(true); await expect(edge(page, 'load-0')).toHaveAttribute('data-link-status', 'down');
  await expect(edge(page, 'load-999')).toHaveAttribute('data-link-playing', 'true');
  await testInfo.attach('link-update-timing', { body: JSON.stringify(timing), contentType: 'application/json' });
  await page.evaluate(() => window.topologyViewer.destroy()); await expect(page.locator('.x6-edge')).toHaveCount(0);
});
