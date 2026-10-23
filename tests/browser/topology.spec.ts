import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/topology';

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => window.stationPrototype.snapshot());
const edit = (page: Page) => page.locator('.mode-switch [data-action="edit"]').click();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.device-card')).toHaveCount(8);
});

test('首页可显示参数，实时刷新不改变布局或存档', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const before = await snapshot(page);
  await page.locator('[data-device-node="hpa-01"]').click();
  await expect(page.locator('#inspector h3')).toHaveText('功放 HPA-01');
  const value = await page.locator('[data-device-node="hpa-01"] [data-metric="power"]').textContent();
  await expect.poll(() => page.locator('[data-device-node="hpa-01"] [data-metric="power"]').textContent()).not.toBe(value);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#save-status')).toHaveText('布局已保存');
  expect(errors).toEqual([]);
});

test('首页锁定节点，编辑模式可拖动且能保存恢复', async ({ page }) => {
  const node = page.locator('[data-device-node="lnb-01"]');
  const drag = async () => {
    const box = (await node.boundingBox())!;
    await page.mouse.move(box.x + 45, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 85, box.y + 45, { steps: 10 });
    await page.mouse.up();
  };
  const original = await snapshot(page);
  await drag();
  expect(await snapshot(page)).toEqual(original);
  await edit(page);
  await drag();
  await expect.poll(async () => (await snapshot(page)).nodes.find((n) => n.id === 'lnb-01')?.x).not.toBe(original.nodes.find((n) => n.id === 'lnb-01')?.x);
  const moved = await snapshot(page);
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await snapshot(page)).toEqual(moved);
});

test('离线演示更新状态与链路，不写入拓扑配置', async ({ page }) => {
  const before = await snapshot(page);
  await page.locator('[data-action="outage"]').click();
  await expect(page.locator('[data-device-node="srv-01"]')).toHaveClass(/offline/);
  await expect(page.locator('#stat-total')).toHaveText('8');
  await expect(page.locator('#stat-alarms')).toHaveText('2');
  await expect(page.locator('[data-device-node="srv-01"] [data-metric="cpu"]')).toHaveText('—');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="outage"]').click();
  await expect(page.locator('[data-device-node="srv-01"]')).toHaveClass(/normal/);
});

test('设备属性可编辑，删除可撤销、重做', async ({ page }) => {
  await edit(page);
  await page.locator('[data-device="server"]').click();
  await expect(page.locator('.device-card')).toHaveCount(9);
  await page.locator('#device-title').fill('新业务服务器');
  await page.locator('[data-action="apply-device"]').click();
  await expect(page.locator('.device-card-heading strong', { hasText: '新业务服务器' })).toHaveCount(1);
  await page.locator('[data-action="delete"]').first().click();
  await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('.device-card')).toHaveCount(9);
  await page.locator('[data-action="redo"]').click();
  await expect(page.locator('.device-card')).toHaveCount(8);
});

test('取消参数后节点收紧，连接点跟随，撤销与刷新保持正确布局', async ({ page }) => {
  await edit(page);
  const card = page.locator('[data-device-node="sw-01"]');
  const height = () => card.evaluate((el) => el.getBoundingClientRect().height);
  const fullHeight = await height();
  const before = await snapshot(page);
  await card.click();
  for (const checkbox of await page.locator('input[name="visible-metric"]').all()) await checkbox.uncheck();
  await page.locator('[data-action="apply-device"]').click();
  await expect(card).toHaveAttribute('data-metric-count', '0');
  await expect(card.locator('.device-metrics')).toHaveCount(0);
  expect(await height()).toBeLessThan(fullHeight * .75);
  const compact = await snapshot(page);
  expect(compact.edges).toEqual(before.edges);
  expect(compact.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(before.nodes.map(({ id, x, y }) => ({ id, x, y })));
  expect(await page.evaluate(() => {
    const node = window.stationPrototype.graph.getCellById('sw-01');
    if (!node.isNode()) throw new Error('missing node');
    return { bottom: node.getPortProp('mgmt', 'args/y'), height: node.getSize().height };
  })).toEqual({ bottom: 90, height: 90 });
  // The footer stays inside the smaller card, rather than being clipped.
  expect(await card.evaluate((el) => el.querySelector('.device-bottom')!.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom)).toBe(true);
  await page.locator('[data-action="undo"]').click();
  await expect(card).toHaveAttribute('data-metric-count', '2');
  await expect.poll(height).toBeCloseTo(fullHeight, 0);
  await page.locator('[data-action="redo"]').click();
  await expect(card).toHaveAttribute('data-metric-count', '0');
  await card.click();
  await page.locator('input[name="visible-metric"]').first().check();
  await page.locator('[data-action="apply-device"]').click();
  await expect(card).toHaveAttribute('data-metric-count', '1');
  await expect(card.locator('.device-metrics>div')).toHaveCSS('display', 'flex');
  expect(await height()).toBeLessThan(fullHeight);
  await page.locator('input[name="visible-metric"]').first().uncheck();
  await page.locator('[data-action="apply-device"]').click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(card).toHaveAttribute('data-metric-count', '0');
  await expect(card.locator('.device-metrics')).toHaveCount(0);
  const documentId = await page.locator('body[data-document-id]').getAttribute('data-document-id');
  await page.goto(`/viewer.html?document=${documentId}`);
  const displayed = page.locator('#standalone-viewer [data-device-node="sw-01"]');
  await expect(displayed).toHaveAttribute('data-metric-count', '0');
  await expect(displayed.locator('.device-metrics')).toHaveCount(0);
  await expect(displayed).toHaveCSS('height', '90px');
});

test('手动走线路径保存后保持一致', async ({ page }) => {
  await edit(page);
  await page.evaluate(() => {
    window.stationPrototype.graph.getCellById('link-rx-rf').isEdge() &&
      window.stationPrototype.graph.getEdges().find((e) => e.id === 'link-rx-rf')!.setVertices([{ x: 260, y: 292 }, { x: 260, y: 156 }]);
  });
  const before = await snapshot(page);
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await snapshot(page)).toEqual(before);
});

test('导入错误文件不会破坏当前画布', async ({ page }) => {
  const before = await snapshot(page);
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 9, topology: {} })) });
  await expect(page.locator('#toast')).toContainText('不支持');
  expect(await snapshot(page)).toEqual(before);
});

test('导出与导入保留整个拓扑，并支持恢复空画布', async ({ page }) => {
  const before = await snapshot(page);
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="export-options"]').click();
  await page.locator('[data-action="export"]').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('北京地面站.topology.json');
  const path = await download.path();
  await page.locator('[data-action="close-modal"]').first().click();
  await page.locator('#import-file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: '空图', savedAt: '', topology: { nodes: [], edges: [] } })) });
  await expect(page.locator('.device-card')).toHaveCount(0);
  await expect(page.locator('#canvas-empty')).toBeVisible();
  await page.locator('#import-file').setInputFiles(path!);
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await snapshot(page)).toEqual(before);
});

test('小屏可查看详情，界面不产生横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('首页隐藏端口，编辑显示，切回首页移除走线手柄且端点不漂移', async ({ page }) => {
  const port = page.locator('#graph .x6-port').first();
  const geometry = () => page.evaluate(() => window.stationPrototype.graph.getEdges().map((edge) => ({ source: edge.getSourcePoint().toJSON(), target: edge.getTargetPoint().toJSON() })));
  const before = await geometry();
  await expect(port).toHaveCSS('opacity', '0');
  await expect(port).toHaveCSS('pointer-events', 'none');
  await page.locator('[data-device-node="lnb-01"]').hover();
  await expect(port).toHaveCSS('opacity', '0');
  await page.locator('[data-device-node="lnb-01"]').click();
  await page.locator('[data-select-cell="link-rx-rf"]').click();
  await edit(page);
  await expect(port).toHaveCSS('opacity', '1');
  await expect(page.locator('.x6-edge-tool-vertices')).toHaveCount(1);
  await page.locator('.mode-switch [data-action="monitor"]').click();
  await expect(port).toHaveCSS('opacity', '0');
  await expect(page.locator('.x6-edge-tool-vertices')).toHaveCount(0);
  expect(await geometry()).toEqual(before);
});

test('线缆样式、粗细、颜色和箭头可保存，离线与恢复保留配置', async ({ page }) => {
  await page.locator('[data-device-node="srv-01"]').click();
  await page.locator('[data-select-cell="link-server"]').click();
  await edit(page);
  await page.locator('#edge-cable-style').selectOption('braided');
  await page.locator('#edge-cable-width').evaluate((el: HTMLInputElement) => { el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#edge-cable-color').evaluate((el: HTMLInputElement) => { el.value = '#465566'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#edge-cable-arrows').uncheck();
  await expect(page.locator('#edge-cable-width-value')).toHaveText('10 px');
  await page.locator('[data-action="apply-edge"]').click();
  const styled = await snapshot(page);
  expect(styled.edges.find((edge) => edge.id === 'link-server')?.appearance).toEqual({ style: 'braided', width: 10, color: '#465566', arrows: false });
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await snapshot(page)).toEqual(styled);
  const cable = page.locator('.x6-edge[data-cell-id="link-server"]');
  await expect(cable.locator('.cable-line')).toHaveAttribute('stroke-width', '10');
  await expect(cable.locator('.cable-texture')).toHaveAttribute('opacity', '0.7');
  await page.locator('[data-action="outage"]').click();
  await expect(cable.locator('.cable-texture')).toHaveAttribute('opacity', '0');
  await expect(cable.locator('.cable-line')).toHaveAttribute('stroke-dasharray', '6 5');
  expect(await snapshot(page)).toEqual(styled);
  await page.locator('[data-action="outage"]').click();
  await expect(cable.locator('.cable-texture')).toHaveAttribute('opacity', '0.7');
  await expect(cable.locator('.cable-line')).toHaveAttribute('stroke-dasharray', '');
  expect(await snapshot(page)).toEqual(styled);
});

test('交换机批量配置 48 口，保留原有接线且取消草稿不修改布局', async ({ page }) => {
  await edit(page);
  await page.locator('[data-device-node="sw-01"]').click();
  const before = await snapshot(page);
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('[data-port-action="fill-48"]').click();
  await expect(page.locator('.port-editor-row')).toHaveCount(48);
  const connected = page.locator('.port-editor-row[data-port-id="ge1"]');
  await expect(connected.locator('[data-port-field="kind"]')).toBeDisabled();
  await expect(connected.locator('[data-port-action="remove"]')).toBeDisabled();
  await connected.locator('[data-port-field="label"]').fill('业务 GE1');
  await page.locator('[data-action="apply-ports"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const configured = await snapshot(page);
  expect(configured.nodes.find((n) => n.id === 'sw-01')?.data.ports).toHaveLength(48);
  expect(configured.edges).toEqual(before.edges);
  const ports = page.locator('.x6-node[data-cell-id="sw-01"] .x6-port');
  await expect(ports).toHaveCount(48);
  expect(await page.evaluate(() => window.stationPrototype.graph.getNodes().find((n) => n.id === 'sw-01')!.getSize())).toEqual({ width: 312, height: 312 });
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('[data-port-action="add-one"]').click();
  await expect(page.locator('.port-editor-row')).toHaveCount(49);
  await page.locator('.modal-footer [data-action="close-modal"]').click();
  expect(await snapshot(page)).toEqual(configured);
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await snapshot(page)).toEqual(configured);
  await expect(ports).toHaveCount(48);
  await expect(ports.first()).toHaveCSS('opacity', '0');
});
