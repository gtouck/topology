import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { TopologyDocument } from '../../src/document';
import { templateFile } from '../../src/template-commands';

async function edit(page: Page) { await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click(); }
async function manage(page: Page, id?: string) {
  await page.locator('[data-action="manage-templates"]').click();
  if (id) await page.locator(`[data-template-id="${id}"][data-template-command="edit"]`).click();
}
async function exportDocument(page: Page): Promise<TopologyDocument> {
  await page.locator('[data-action="export-options"]').click(); const download = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click(); const file = await download;
  const doc = JSON.parse(await readFile((await file.path())!, 'utf8'));
  await page.locator('[data-action="close-modal"]').first().click(); return doc;
}
const snap = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());

test('S07 模板修改同步参数清理，保留布局和实时值，保存撤销重做', async ({ page }) => {
  await edit(page); const before = await snap(page);
  await page.evaluate(() => window.stationPrototype.updateTelemetry('DEV-001', { elevation: 55.55 }, 'warning'));
  await manage(page, 'antenna');
  await page.locator('#template-name').fill('通用跟踪天线');
  await page.locator('.template-metric-row').first().getByLabel('移除参数', { exact: true }).click();
  await page.locator('[data-action="create-template"]').click();
  const after = await snap(page);
  expect(after.nodes[0].data.visibleMetrics).toEqual(['elevation']);
  expect(after.nodes[0].data.binding?.fields.azimuth).toBeUndefined();
  expect(after.nodes.map(n => [n.id, n.x, n.y])).toEqual(before.nodes.map(n => [n.id, n.x, n.y]));
  expect(after.edges).toEqual(before.edges);
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText('55.5');
  await page.locator('[data-action="undo"]').click(); expect(await snap(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snap(page)).toEqual(after);
  await page.locator('[data-action="save"]').click(); await page.reload(); expect(await snap(page)).toEqual(after);
  await page.locator('.mode-switch [data-action="edit"]').click();
  await expect(page.locator('[data-device="antenna"]')).toContainText('通用跟踪天线');
});

test('S07 模板端口表单保护已连端点，新增同侧端口不重叠且不改手工路径', async ({ page }) => {
  await edit(page); const before = await snap(page); await manage(page, 'antenna');
  await page.locator('.template-ports summary').click();
  await expect(page.locator('#port-spacing')).toHaveCount(0);
  await expect(page.locator('.modal-footer [data-action="create-template"]')).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.modal-footer [data-action="create-template"]')).toBeInViewport();
  await page.setViewportSize({ width: 1600, height: 1050 });
  const used = page.locator('[data-port-id="rf-rx"]');
  await expect(used.getByLabel('删除端口', { exact: true })).toBeDisabled();
  await expect(used.getByLabel('端口类型', { exact: true })).toBeDisabled();
  await page.locator('#port-count').fill('5'); await page.locator('#port-distribution').selectOption('left');
  await page.locator('[data-port-action="add-batch"]').click();
  await page.locator('[data-action="create-template"]').click();
  expect((await snap(page)).edges).toEqual(before.edges);
  const positions = await page.locator('.x6-node[data-cell-id="ant-01"] .x6-port').evaluateAll(ports => ports.map(p => p.getAttribute('transform')));
  expect(new Set(positions).size).toBe(8);
  await page.locator('[data-action="undo"]').click(); expect(await snap(page)).toEqual(before);
});

test('S07 模板导出、重复导入与跨图复用，导入可撤销且错误不改图', async ({ page }) => {
  await edit(page); const before = await exportDocument(page); await manage(page);
  const download = page.waitForEvent('download');
  await page.locator('[data-template-id="antenna"][data-template-command="export"]').click();
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(exported).toEqual(templateFile(before.templates.find(t => t.id === 'antenna')!));
  await page.locator('#template-import-file').setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.locator('[data-action="create-template"]').click();
  expect((await exportDocument(page)).templates.length).toBe(before.templates.length + 1);
  await page.locator('[data-action="undo"]').click(); expect((await exportDocument(page)).templates).toEqual(before.templates);
  await manage(page); await page.locator('#template-import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.locator('#template-import-error')).toContainText('不支持');
  await page.locator('[data-action="close-modal"]').first().click();
  await page.locator('.heading-actions [data-action="library"]').click(); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('模板复用图'); await page.locator('[data-action="create-document"]').click();
  await manage(page); await page.locator('#template-import-file').setInputFiles({ name: 'reuse.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.locator('[data-action="create-template"]').click();
  const imported = (await exportDocument(page)).templates.find(t => t.label === '天线' && t.id !== 'antenna')!;
  await page.locator(`[data-device="${imported.id}"]`).click(); await expect(page.locator('.device-card')).toHaveCount(1);
  expect((await snap(page)).nodes[0].data.kind).toBe(imported.id);
});

test('S07 字段及状态映射表单校验、保存与独立展示生效', async ({ page }) => {
  await edit(page); await page.locator('[data-device-node="ant-01"]').click(); await page.locator('.binding-fields summary').click();
  const before = await snap(page); await page.locator('#binding-source').fill('ground.antenna');
  await page.locator('#binding-path-0').fill('sensors.angle'); await page.locator('#binding-status').fill('health.code');
  await page.locator('[data-binding-action="add"]').click(); await page.getByLabel('业务状态值', { exact: true }).fill('2');
  await page.getByLabel('映射设备状态', { exact: true }).selectOption('warning');
  await page.locator('[data-binding-action="add"]').click(); await page.getByLabel('业务状态值', { exact: true }).last().fill('2');
  await page.locator('[data-action="apply-device"]').click(); await expect(page.locator('[data-field-error]')).toContainText('不能重复');
  expect(await snap(page)).toEqual(before);
  await page.locator('.binding-status-row').last().getByLabel('删除状态映射', { exact: true }).click();
  await page.locator('[data-action="apply-device"]').click();
  const definition = await exportDocument(page);
  expect(definition.topology.nodes[0].data.binding).toMatchObject({ source: 'ground.antenna', fields: { azimuth: 'sensors.angle' }, statusField: 'health.code', statusMap: { '2': 'warning' } });
  await page.goto('/viewer.html'); await page.locator('#viewer-file').setInputFiles({ name: 'binding.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)) });
  await page.evaluate(() => window.topologyViewer.setData({ 'ground.antenna': { sensors: { angle: 22.34 }, health: { code: 2 } } }));
  await expect(page.locator('[data-device-node="ant-01"]')).toHaveAttribute('data-status', 'warning');
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText('22.3');
});
