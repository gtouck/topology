import { expect, test, type Page } from '@playwright/test';
import { createDocument, sampleDocument } from '../../src/document';
import { builtinDevices, initialTopology } from '../../src/topology';

async function importDocument(page: Page, document: unknown) {
  await page.locator('#import-file').setInputFiles({ name: 'stability.topology.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.device-card')).toHaveCount(8);
});

test('S01 零参数模板可采样、查看详情、编辑和保存恢复', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const node = initialTopology().nodes[0];
  node.data = { ...node.data, kind: 'plain', visibleMetrics: [], binding: { source: 'plain', fields: {}, statusField: 'status' } };
  const doc = createDocument('零参数图', 'general', { nodes: [node], edges: [] }, { plain: { ...builtinDevices.module, metrics: [] } });
  await importDocument(page, doc);
  await expect(page.locator('.device-card')).toHaveCount(1);
  await page.locator('.device-card').click();
  await expect(page.locator('#inspector')).toContainText('此节点未配置参数');
  await expect(page.locator('#trend-line')).toHaveCount(0);
  await page.waitForTimeout(2200);
  await page.locator('.mode-switch [data-action="edit"]').click();
  await expect(page.locator('.metric-options')).toContainText('此模板未配置参数');
  await page.locator('#device-title').fill('无参数模块');
  await page.locator('[data-action="apply-device"]').click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(page.locator('.device-card')).toContainText('无参数模块');
  await page.locator('.device-card').click();
  await expect(page.locator('#inspector')).toContainText('此节点未配置参数');
  expect(errors).toEqual([]);
});

test('S01 模板名称和单位在详情及定时刷新中保持纯文本', async ({ page }) => {
  const doc = sampleDocument('satellite');
  const node = doc.topology.nodes[0];
  const metric = doc.templates.find((t) => t.id === node.data.kind)!.metrics[0];
  metric.label = '<img src=x onerror="p=1">';
  metric.unit = '<svg onload="p=1">';
  await importDocument(page, doc);
  const card = page.locator(`[data-device-node="${node.id}"]`);
  await card.click();
  await expect(page.locator('#inspector .detail-metrics')).toContainText(metric.label);
  await expect(page.locator('#inspector .detail-metrics')).toContainText(metric.unit);
  await page.waitForTimeout(2200);
  await expect(card.locator(`[data-metric="${metric.key}"] small`)).toHaveText(metric.unit);
  await expect(page.locator('#inspector img, #inspector small svg')).toHaveCount(0);
  await expect(card.locator('small svg')).toHaveCount(0);
  await page.locator('.mode-switch [data-action="edit"]').click();
  await expect(page.locator('.metric-options')).toContainText(metric.label);
  expect(await page.evaluate(() => (window as Window & { p?: unknown }).p)).toBeUndefined();
});

test('S01 宿主数据跨模拟周期及撤销保持不变，可以主动切回模拟', async ({ page }) => {
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  const server = before.nodes.find((n) => n.id === 'srv-01')!;
  expect(await page.evaluate((id) => window.stationPrototype.updateTelemetry(id, { cpu: 87.3 }, 'warning'), server.data.deviceId)).toBe(1);
  const value = page.locator('[data-device-node="srv-01"] [data-metric="cpu"]');
  await expect(page.locator('#data-mode')).toHaveValue('external');
  await expect(page.locator('[data-action="pause"]')).toBeDisabled();
  await expect(page.locator('[data-action="outage"]')).toBeDisabled();
  await expect(value).toContainText('87.3');
  await expect(page.locator('[data-device-node="ant-01"] .device-status-text')).toHaveText('等待数据');
  await page.waitForTimeout(4500);
  await expect(value).toContainText('87.3');
  await expect(page.locator('[data-device-node="srv-01"]')).toHaveClass(/warning/);
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device="module"]').click();
  await page.locator('[data-action="undo"]').click();
  await expect(value).toContainText('87.3');
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
  await page.locator('#data-mode').selectOption('simulation');
  await expect(page.locator('[data-action="pause"]')).toBeEnabled();
  await expect(value).not.toContainText('87.3');
  expect(await page.evaluate(() => window.stationPrototype.getDataMode())).toBe('simulation');
});
