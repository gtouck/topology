import { expect, test, type Page } from '@playwright/test';
import { readFile, copyFile } from 'node:fs/promises';
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

test('SVG 和 PNG 导出全部节点和连线，编辑选择与筛选不影响图片或拓扑', async ({ page, context }, testInfo) => {
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="srv-01"]').click();
  await page.evaluate(() => window.stationPrototype.graph.getCellById('ant-01').position(-900, 250));
  await page.locator('[data-filter="rf"]').click();
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  const svgPath = testInfo.outputPath('topology.svg');
  await copyFile(await exportFile(page, 'svg'), svgPath);
  const svg = await readFile(svgPath, 'utf8');
  const dimensions = svg.match(/width="(\d+)" height="(\d+)"/)!;
  expect(svg.match(/data-node-id=/g)).toHaveLength(8);
  expect(svg.match(/data-edge-id=/g)).toHaveLength(8);
  expect(svg).toContain('translate(-900 250)');
  expect(svg).not.toMatch(/foreignObject|x6-port|selected|<image/);
  const png = await readFile(await exportFile(page, 'png'));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(Number(dimensions[1]) * 2);
  expect(png.readUInt32BE(20)).toBe(Number(dimensions[2]) * 2);
  const decoded = await page.evaluate(async (data) => {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
    image.src = `data:image/png;base64,${data}`; await loaded;
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 64) {
      if (pixels[i + 3] > 200 && (Math.abs(pixels[i] - pixels[i + 1]) > 10 || Math.abs(pixels[i + 2] - pixels[i + 1]) > 10)) colored++;
    }
    return { width: image.naturalWidth, height: image.naturalHeight, colored };
  }, png.toString('base64'));
  expect(decoded.width).toBe(Number(dimensions[1]) * 2);
  expect(decoded.height).toBe(Number(dimensions[2]) * 2);
  expect(decoded.colored, 'decoded PNG must contain the rendered topology').toBeGreaterThan(100);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
  // Open the vector file as its own document, independent of the editor and network.
  await context.setOffline(true);
  const vectorPage = await context.newPage();
  await vectorPage.goto(pathToFileURL(svgPath).href);
  await expect(vectorPage.locator('parsererror')).toHaveCount(0);
  await expect(vectorPage.locator('g[data-node-id]')).toHaveCount(8);
  await expect(vectorPage.locator('g[data-edge-id]')).toHaveCount(8);
  const root = vectorPage.locator('svg').first();
  await expect(root).toBeVisible();
  expect(await root.evaluate(el => el.getBoundingClientRect().width)).toBe(Number(dimensions[1]));
  // SVG is an XML document without HTML body; use a viewport capture.
  await vectorPage.screenshot({ path: testInfo.outputPath('svg-opened.png') });
});

test('HTML 下载后完全离线打开，初始参数与状态保留且可以由宿主更新', async ({ page, context }, testInfo) => {
  await page.locator('[data-action="pause"]').click();
  const value = await page.locator('[data-device-node="ant-01"] [data-metric="azimuth"]').textContent();
  await page.locator('[data-action="outage"]').click();
  const path = testInfo.outputPath('topology.html');
  await copyFile(await exportFile(page, 'html'), path);
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
