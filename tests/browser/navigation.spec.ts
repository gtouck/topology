import { expect, test, type Page } from '@playwright/test';
import { copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sampleDocument } from '../../src/document';
import type { TopologyViewer } from '../../src/viewer';
import { WorkspaceStore } from '../../src/workspace';
import { LIBRARY_KEY } from '../../src/library';
import { newPublication } from '../../src/publication';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const card = (page: Page, id = 'ant-01') => page.locator(`[data-device-node="${id}"]`);
async function edit(page: Page) { await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click(); }

test('S10 搜索键盘定位与一跳聚焦，不改变布局或拐点', async ({ page }) => {
  await page.goto('/'); const before = await snapshot(page);
  await page.keyboard.press('/'); await expect(page.getByRole('searchbox', { name: '查找图形' })).toBeFocused();
  await page.getByRole('searchbox', { name: '查找图形' }).fill('DEV-001');
  await expect(page.locator('.gn-result')).toHaveCount(1); await page.keyboard.press('Enter');
  await expect(page.locator('#inspector')).toContainText('天线 ANT-01');
  await page.locator('.gn-related').click();
  await expect(page.locator('.x6-node[data-cell-id="srv-01"]')).toHaveCSS('opacity', '0.16');
  await expect(page.locator('.x6-node[data-cell-id="lnb-01"]')).toHaveCSS('opacity', '1');
  await page.locator('.gn-clear').click(); await expect(page.locator('.x6-node[data-cell-id="srv-01"]')).toHaveCSS('opacity', '1');
  await page.getByRole('searchbox', { name: '查找图形' }).fill('Ku-band · 接收'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#inspector')).toContainText('链路详情');
  expect(await page.evaluate(() => window.stationPrototype.focus('missing'))).toBe(false);
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('searchbox', { name: '查找图形' }).fill('没有这样的节点'); await expect(page.locator('.gn-results')).toContainText('没有匹配');
  await page.keyboard.press('Escape'); await expect(page.locator('.gn-results')).toBeHidden();
  const viewport = await page.evaluate(() => window.stationPrototype.graph.translate()); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.stationPrototype.graph.translate())).toEqual(viewport);
});

test('S10 小地图点击拖动键盘与节点变化同步，折叠不改配置', async ({ page }) => {
  await edit(page); const before = await snapshot(page), map = page.locator('.gn-map'); await expect(map).toBeVisible();
  const original = await page.evaluate(() => window.stationPrototype.graph.translate());
  await map.click({ position: { x: 20, y: 20 } });
  await expect.poll(() => page.evaluate(() => window.stationPrototype.graph.translate())).not.toEqual(original);
  const bounds = (await map.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 30); await page.mouse.down(); await page.mouse.move(bounds.x + 130, bounds.y + 80, { steps: 5 }); await page.mouse.up();
  await page.evaluate(() => window.stationPrototype.graph.resetSelection(['ant-01']));
  await map.focus(); await page.keyboard.press('ArrowRight'); expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => window.stationPrototype.graph.getCellById('ant-01').position(-400, 250));
  await expect(page.locator('[data-gn-node="ant-01"]')).toHaveAttribute('x', '-400');
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('[data-gn-node="ant-01"]')).toHaveAttribute('x', '30');
  await page.getByRole('button', { name: '切换小地图' }).click(); await expect(map).toBeHidden(); expect(await snapshot(page)).toEqual(before);
});

test('S10 子图表单、进入返回保留父图视口，导航不占用撤销', async ({ page }) => {
  await edit(page); const parent = await page.locator('body[data-document-id]').getAttribute('data-document-id');
  await page.locator('.heading-actions [data-action="library"]').click(); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('机房子图'); await page.locator('#new-document-kind').selectOption('datacenter'); await page.locator('[data-action="create-document"]').click();
  const child = await page.locator('body[data-document-id]').getAttribute('data-document-id');
  await page.locator('.heading-actions [data-action="library"]').click(); await page.locator(`[data-document-id="${parent}"][data-document-action="open"]`).click();
  await card(page).click(); await page.locator('#child-topology-id').selectOption(child!); await page.locator('[data-action="apply-device"]').click();
  const before = await snapshot(page); expect(before.nodes[0].data.childTopologyId).toBe(child);
  await page.locator('.mode-switch [data-action="monitor"]').click();
  await page.evaluate(() => { window.stationPrototype.graph.zoomTo(.75); window.stationPrototype.graph.translate(120, 90); });
  await page.locator('[data-action="open-child-topology"]').click(); await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', child!);
  await expect(page.locator('.device-card')).toHaveCount(4); await expect(page.locator('#navigation-trail')).toBeVisible();
  await page.locator('[data-action="navigation-back"]').click(); await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', parent!);
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.stationPrototype.graph.zoom())).toBeCloseTo(.75);
  const translation = await page.evaluate(() => window.stationPrototype.graph.translate()); expect(translation.tx).toBeCloseTo(120); expect(translation.ty).toBeCloseTo(90);
  await page.locator('.mode-switch [data-action="edit"]').click(); await page.locator('[data-action="undo"]').click(); expect((await snapshot(page)).nodes[0].data.childTopologyId).toBeUndefined();
});

test('S10 缺失子图明确提示，组件 API 隔离且支持关闭导航', async ({ page }) => {
  await page.goto('/viewer.html');
  const definition = sampleDocument('ground-station'); definition.topology.nodes[0].data.childTopologyId = 'external-child';
  await page.locator('#viewer-file').setInputFiles({ name: 'child.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)) });
  await card(page).click(); await page.locator('.tv-open-child').click(); await expect(page.locator('#viewer-error')).toContainText('子拓扑');
  expect(await page.evaluate(() => window.topologyViewer.getDefinition())).toEqual(definition);
  const results = await page.evaluate(async definition => {
    const root = document.createElement('div'); root.id = 'isolated-navigation'; root.style.cssText = 'width:700px;height:200px'; document.body.appendChild(root);
    const Viewer = window.topologyViewer.constructor as typeof TopologyViewer;
    const events: { documentId: string; fromDocumentId: string }[] = [];
    const second = new Viewer(root, { definition, navigation: false, onNavigate: event => { events.push(event); event.node.data.title = '外部修改'; } });
    const focused = second.focus('ant-01', true), found = second.search('DEV-001'); second.navigateToChild('ant-01');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const graph = root.querySelector<HTMLElement>('.tv-canvas')!.getBoundingClientRect(), card = root.querySelector<HTMLElement>('[data-device-node="ant-01"]')!.getBoundingClientRect();
    const value = { focused, found, events, unchanged: second.getDefinition().topology.nodes[0].data.title, hidden: root.querySelector<HTMLElement>('.graph-navigation')!.hidden, centerX: card.x + card.width / 2 - graph.x - graph.width / 2, centerY: card.y + card.height / 2 - graph.y - graph.height / 2 };
    second.destroy(); return value;
  }, definition);
  expect(results.focused).toBe(true); expect(results.found[0].id).toBe('ant-01'); expect(results.events[0].documentId).toBe('external-child'); expect(results.events[0].fromDocumentId).toBe(definition.id);
  expect(results.unchanged).toBe(definition.topology.nodes[0].data.title); expect(results.hidden).toBe(true); await expect(page.locator('#isolated-navigation .topology-viewer')).toHaveCount(0);
  expect(Math.abs(results.centerX)).toBeLessThan(2); expect(Math.abs(results.centerY)).toBeLessThan(2);
});

test('S10 草稿及发布预览进入同来源子图，浏览器返回可恢复展示', async ({ page }) => {
  const parent = sampleDocument('ground-station'), child = sampleDocument('datacenter'); parent.topology.nodes[0].data.childTopologyId = child.id;
  const map = new Map<string, string>(); const store = new WorkspaceStore({ getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); } });
  store.updateLibrary({ version: 1, activeId: parent.id, documents: [parent, child] }); store.saveDraft({ ...child, name: '子图未发布草稿' }); store.publish(parent, 0);
  await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state)); }, { key: LIBRARY_KEY, state: store.snapshot() });
  await page.goto(`/viewer.html?document=${parent.id}&draft=1`); await card(page).click(); await page.locator('.tv-open-child').click();
  await expect(page.locator('#viewer-title')).toHaveText('子图未发布草稿'); await page.locator('#viewer-back').click(); await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => window.topologyViewer.getDefinition().id)).toBe(parent.id);
  await page.goto(`/viewer.html?published=${parent.id}`); await card(page).click(); await page.locator('.tv-open-child').click(); await expect(page.locator('#publication-error')).toContainText('尚未发布');
  const publication = newPublication(child, 1, new Date().toISOString());
  await page.evaluate(({ key, publication }) => { const state = JSON.parse(localStorage.getItem(key)!); state.publishing.entries.unshift(publication); state.editing.revision++; localStorage.setItem(key, JSON.stringify(state)); }, { key: LIBRARY_KEY, publication });
  await page.locator('.tv-open-child').click(); await expect(page.locator('#viewer-title')).toHaveText(child.name);
  expect(await page.evaluate(() => window.topologyViewer.getDefinition().name)).not.toBe('子图未发布草稿');
  await page.locator('#viewer-back').click(); await expect(card(page)).toBeVisible(); expect(await page.evaluate(() => window.topologyViewer.getDefinition().id)).toBe(parent.id);
});

test('S10 HTML 断网搜索与子图导航事件保留引用，窄屏小图可用', async ({ page, context }, testInfo) => {
  await page.goto('/'); const definition = sampleDocument('ground-station'); definition.topology.nodes[0].data.childTopologyId = 'external-child';
  await page.locator('#import-file').setInputFiles({ name: 'child.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)) });
  await page.locator('[data-action="export-options"]').click(); const download = page.waitForEvent('download'); await page.locator('[data-action="export-html"]').click();
  const path = testInfo.outputPath('child.html'); await copyFile((await (await download).path())!, path);
  await context.setOffline(true); await page.goto(pathToFileURL(path).href); await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.addEventListener('topology:navigate', event => { (window as unknown as { navigationEvent: unknown }).navigationEvent = (event as CustomEvent).detail; }));
  await page.getByRole('searchbox', { name: '查找图形' }).fill('DEV-001'); await page.keyboard.press('Enter'); await page.locator('.tv-open-child').click();
  const event = await page.evaluate(() => (window as unknown as { navigationEvent: { documentId: string } }).navigationEvent); expect(event.documentId).toBe('external-child');
  await expect(page.locator('.gn-map')).toBeVisible();
  expect(await page.evaluate(() => window.topologyViewer.getDefinition().topology.nodes[0].data.childTopologyId)).toBe('external-child');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
