import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function exportFile(page: Page, format: string) {
  if (!await page.locator('#modal').evaluate((el: HTMLDialogElement) => el.open)) await page.locator('[data-action="export-options"]').click();
  const downloading = page.waitForEvent('download');
  await page.locator(`[data-action="export-${format}"]`).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  return (await download.path())!;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.device-card')).toHaveCount(8);
});

test('SVG 和 PNG 导出全部节点和连线，编辑选择与筛选不影响图片或拓扑', async ({ page }) => {
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="srv-01"]').click();
  await page.evaluate(() => window.stationPrototype.graph.getCellById('ant-01').position(-900, 250));
  await page.locator('[data-filter="rf"]').click();
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  const svg = await readFile(await exportFile(page, 'svg'), 'utf8');
  const dimensions = svg.match(/width="(\d+)" height="(\d+)"/)!;
  expect(svg.match(/data-node-id=/g)).toHaveLength(8);
  expect(svg.match(/data-edge-id=/g)).toHaveLength(8);
  expect(svg).toContain('translate(-900 250)');
  expect(svg).not.toMatch(/foreignObject|x6-port|selected|<image/);
  const png = await readFile(await exportFile(page, 'png'));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(Number(dimensions[1]) * 2);
  expect(png.readUInt32BE(20)).toBe(Number(dimensions[2]) * 2);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
});

test('HTML 下载后完全离线打开，初始参数与状态保留且可以由宿主更新', async ({ page, context }) => {
  await page.locator('[data-action="pause"]').click();
  const value = await page.locator('[data-device-node="ant-01"] [data-metric="azimuth"]').textContent();
  await page.locator('[data-action="outage"]').click();
  const path = await exportFile(page, 'html');
  const html = await readFile(path, 'utf8');
  expect(html).not.toMatch(/<script\s+src=|<link\b/);
  const networkRequests: string[] = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url())) networkRequests.push(request.url()); });
  await context.setOffline(true);
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('.device-card')).toHaveCount(8);
  await expect(page.locator('[data-device-node="srv-01"]')).toHaveClass(/offline/);
  await expect(page.locator('[data-device-node="ant-01"] [data-metric="azimuth"]')).toHaveText(value!);
  await page.evaluate(() => {
    const doc = window.topologyViewer.getDefinition();
    const node = doc.topology.nodes.find((n) => n.id === 'ant-01')!;
    window.topologyViewer.updateData({ [node.data.binding!.source]: { azimuth: 88.8, status: 'normal' } });
  });
  await expect(page.locator('[data-device-node="ant-01"] [data-metric="azimuth"]')).toContainText('88.8');
  await expect(page.locator('#data-status')).toContainText('数据更新');
  expect(networkRequests).toEqual([]);
});
