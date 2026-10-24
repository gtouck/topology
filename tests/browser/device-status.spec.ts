import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sampleDocument } from '../../src/document';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const card = (page: Page, id: string) => page.locator(`[data-device-node="${id}"]`);

test('设备状态与主题：移除告警和底部说明，工作台与拓扑保持独立配色', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await expect(page.locator('[data-action="alarms"], #nav-alarms, #stat-alarms, #summary-status, #data-source-note, .bottom-note')).toHaveCount(0);
  await expect(page.locator('#sidebar')).toHaveCSS('background-color', 'rgb(29, 40, 60)');
  await expect(page.locator('[data-action="save"]')).toHaveCSS('background-color', 'rgb(73, 105, 177)');
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'normal');
  await expect(card(page, 'ant-01')).toHaveCSS('border-top-color', 'rgb(186, 215, 201)');
  await expect(card(page, 'hpa-01')).toHaveAttribute('data-status', 'warning');
  await expect(card(page, 'ant-01').locator('.device-status-dot svg')).toHaveCount(1);
  expect(await page.evaluate(() => window.stationPrototype.graph.options.background?.color)).toBe('#f9fbfa');
  await page.screenshot({ path: '/private/tmp/station-device-draw-status-theme.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.topbar [data-action="toggle-sidebar"]').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#sidebar')).toHaveCSS('background-color', 'rgb(29, 40, 60)');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('设备状态与主题：等待、告警、离线、正常动态切换，编辑中保留输入和文档', async ({ page }) => {
  await page.goto('/'); const before = await snapshot(page), source = before.nodes.find((n) => n.id === 'ant-01')!.data.deviceId;
  await page.locator('#data-mode').selectOption('external');
  await expect(page.locator('.device-card[data-status="pending"]')).toHaveCount(8);
  await expect(card(page, 'ant-01')).toHaveCSS('border-top-style', 'dotted');
  await page.locator('#data-mode').selectOption('simulation');
  await page.locator('.mode-switch [data-action="edit"]').click(); await card(page, 'ant-01').click();
  await page.locator('#device-title').fill('尚未应用的名称');
  await page.evaluate((source) => window.stationPrototype.updateTelemetry(source, { azimuth: 37.2 }, 'warning'), source);
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'warning');
  await expect(page.locator('#detail-status')).toHaveAttribute('data-status', 'warning');
  await expect(page.locator('#device-title')).toHaveValue('尚未应用的名称');
  await expect(page.locator('#data-mode')).toHaveValue('external');
  await page.locator('#data-mode').selectOption('simulation'); await page.locator('#data-mode').selectOption('external');
  await expect(page.locator('#device-title')).toHaveValue('尚未应用的名称');
  await page.evaluate((source) => window.stationPrototype.updateTelemetry(source, {}, 'offline'), source);
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'offline');
  await expect(card(page, 'ant-01')).toHaveCSS('border-top-style', 'dashed');
  await page.evaluate((source) => window.stationPrototype.updateTelemetry(source, { azimuth: 88.8 }, 'normal'), source);
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'normal');
  await expect(card(page, 'ant-01')).toHaveCSS('border-top-style', 'solid');
  await expect(page.locator('#detail-status')).toHaveText('运行正常');
  await page.waitForTimeout(2300);
  await expect(card(page, 'ant-01').locator('[data-metric="azimuth"]')).toContainText('88.8');
  expect(await snapshot(page)).toEqual(before);
});

test('设备状态与主题：初始状态配置可撤销并保存，状态外观不增加卡片留白', async ({ page }) => {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click(); await card(page, 'ant-01').click();
  const before = await snapshot(page), box = (await card(page, 'ant-01').boundingBox())!;
  await page.locator('#device-status').selectOption('offline'); await page.locator('[data-action="apply-device"]').click();
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'offline');
  const after = await snapshot(page); expect((await card(page, 'ant-01').boundingBox())!.height).toBe(box.height);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(after);
  await page.locator('[data-action="save"]').click(); await page.reload();
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'offline');
});

test('设备状态与主题：SVG、PNG、离线 HTML 保留四种状态，工作台主题不进入图片', async ({ page, context }, testInfo) => {
  await page.goto('/'); const before = await snapshot(page);
  const ids = ['ant-01', 'lnb-01', 'hpa-01'];
  await page.evaluate((sources) => sources.forEach((source, i) => window.stationPrototype.updateTelemetry(source, {}, (['normal', 'warning', 'offline'] as const)[i])), ids.map((id) => before.nodes.find((n) => n.id === id)!.data.deviceId));
  await expect(page.locator('.device-card[data-status="pending"]')).toHaveCount(5);
  await page.locator('[data-action="export-options"]').click();
  for (const format of ['svg', 'png', 'html']) {
    const promise = page.waitForEvent('download'); await page.locator(`[data-action="export-${format}"]`).click();
    const download = await promise, path = testInfo.outputPath(`status.${format}`); await download.saveAs(path);
    if (format === 'svg') {
      const svg = await readFile(path, 'utf8');
      for (const tone of ['normal', 'warning', 'offline', 'pending']) expect(svg).toContain(`data-status="${tone}"`);
      expect(svg).toContain('等待数据'); expect(svg).not.toContain('--ui-accent'); expect(svg).not.toContain('foreignObject');
    }
    if (format === 'png') expect((await readFile(path)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (format === 'html') {
      await context.setOffline(true); await page.goto(pathToFileURL(path).href);
      await expect(page.locator('.device-card')).toHaveCount(8);
      await expect(page.locator('.device-card[data-status="pending"]')).toHaveCount(5);
      for (const tone of ['normal', 'warning', 'offline']) await expect(page.locator(`.device-card[data-status="${tone}"]`)).toHaveCount(1);
      await expect(page.locator('#error')).toBeHidden();
    }
  }
});

test('设备状态与主题：独立组件更新状态和清空数据时恢复等待外观', async ({ page }) => {
  const doc = sampleDocument('ground-station'); await page.goto('/viewer.html');
  await page.locator('#viewer-file').setInputFiles({ name: 'status.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('.device-card[data-status="pending"]')).toHaveCount(8);
  const source = doc.topology.nodes[0].data.binding!.source;
  await page.evaluate((source) => window.topologyViewer.updateData({ [source]: { status: 'warning', azimuth: 66.6 } }), source);
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'warning');
  await page.evaluate((source) => window.topologyViewer.updateData({ [source]: { status: 'offline' } }), source);
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'offline');
  await page.evaluate(() => window.topologyViewer.setData({}));
  await expect(card(page, 'ant-01')).toHaveAttribute('data-status', 'pending');
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'graph';
    const probe = document.createElement('div'); probe.className = 'device-card'; probe.dataset.status = 'normal'; probe.style.setProperty('--device-state-surface', '#ff0000');
    host.appendChild(probe); document.body.appendChild(host);
  });
  await expect(page.locator('#graph>.device-card')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => window.topologyViewer.getDefinition())).toEqual(doc);
});
