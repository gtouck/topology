import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';

/** DOM bounds can be correct while WebKit paints foreignObject content at SVG (0,0). */
async function expectPaintAtNode(page: Page, id: string) {
  const node = page.locator(`[data-device-node="${id}"]`);
  const rect = (await node.boundingBox())!;
  const style = await node.evaluate(el => {
    const css = getComputedStyle(el);
    const ports = [...(el.closest('.x6-node')?.querySelectorAll('.x6-port circle') || [])].map(port => port.getBoundingClientRect().toJSON());
    return { color: css.getPropertyValue('--device-state-color').trim(), width: el.clientWidth + 2, ports };
  });
  const scale = rect.width / style.width;
  const png = (await page.screenshot()).toString('base64');
  const painted = await page.evaluate(async ({ png, rect, scale, color, ports }) => {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
    image.src = `data:image/png;base64,${png}`; await loaded;
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    let matches = 0, sampled = 0;
    // Sample the painted status rail at the node's expected canvas position.
    for (let y = Math.ceil(rect.y + 12 * scale); y < rect.y + rect.height - 12 * scale; y++) {
      // Edit handles cover the rail at connection points; sample its exposed rows.
      if (ports.some(port => port.x < rect.x + 5 * scale && port.x + port.width > rect.x && y >= port.y - 2 * scale && y <= port.y + port.height + 2 * scale)) continue;
      sampled++;
      let matched = false;
      for (let x = Math.ceil(rect.x + scale); x < rect.x + 5 * scale; x++) {
        const data = ctx.getImageData(x, y, 1, 1).data;
        if (rgb.every((v, i) => Math.abs(v - data[i]) < 18)) matched = true;
      }
      if (matched) matches++;
    }
    return { matches, sampled };
  }, { png, rect, scale, color: style.color, ports: style.ports });
  expect(painted.sampled, `${id}: enough unobstructed rail must be visible`).toBeGreaterThan((rect.height - 24 * scale) * .3);
  expect(painted.matches, `${id}: status rail must paint at the model position`).toBeGreaterThan(painted.sampled * .7);
}

test('节点绘制位置：状态变化、锁定、移动、平移及缩放后图形仍对齐模型与连线', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('[data-action="pause"]').click();
  await expectPaintAtNode(page, 'ant-01');
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('[data-action="lock-selected"]').click();
  await expect(page.locator('[data-device-node="ant-01"] .device-lock-indicator')).toBeVisible();
  await expectPaintAtNode(page, 'ant-01');
  await page.locator('[data-action="unlock-selected"]').click();
  await page.keyboard.press('ArrowRight');
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.evaluate(() => {
    const graph = window.stationPrototype.graph;
    graph.zoomTo(.65); graph.centerContent(); graph.translateBy(15, -10);
    const nodes = window.stationPrototype.snapshot().nodes;
    ['normal', 'warning', 'offline'].forEach((status, i) => window.stationPrototype.updateTelemetry(nodes[i].data.deviceId, {}, status as 'normal' | 'warning' | 'offline'));
  });
  for (const id of ['ant-01', 'lnb-01', 'hpa-01', 'bb-rx']) await expectPaintAtNode(page, id);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
});

test('节点绘制位置：独立展示与离线 HTML 中节点绘制在连线端点处', async ({ page }, testInfo) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('[data-action="save"]').click();
  const id = await page.locator('body[data-document-id]').getAttribute('data-document-id');
  await page.goto(`/viewer.html?document=${id}`);
  await expect(page.locator('.device-card')).toHaveCount(8);
  await expectPaintAtNode(page, 'ant-01');
  await page.evaluate(() => {
    const node = window.topologyViewer.getDefinition().topology.nodes.find(n => n.id === 'ant-01')!;
    window.topologyViewer.updateData({ [node.data.binding?.source || node.data.deviceId]: { status: 'warning' } });
  });
  await expectPaintAtNode(page, 'ant-01');
  await page.goto('/');
  await page.locator('[data-action="export-options"]').click();
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="export-html"]').click();
  const path = testInfo.outputPath('node-position.html'); await (await downloading).saveAs(path);
  await page.context().setOffline(true); await page.goto(pathToFileURL(path).href);
  await expect(page.locator('.device-card')).toHaveCount(8);
  await expectPaintAtNode(page, 'ant-01');
});

test('节点绘制位置：长标题、零参数与密集端口在字体回退时保持显示和布局', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="sw-01"]').click();
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('[data-port-action="fill-48"]').click();
  await page.locator('[data-action="apply-ports"]').click();
  // The enlarged card would otherwise be partly covered by the example server.
  await page.evaluate(() => window.stationPrototype.graph.getCellById('sw-01').position(1150, 190));
  await page.locator('[data-device-node="ant-01"]').click();
  const title = '主用天线设备 ANTENNA-01 主备切换与射频链路连接节点';
  await page.locator('#device-title').fill(title);
  for (const checkbox of await page.locator('input[name="visible-metric"]').all()) await checkbox.uncheck();
  await page.locator('[data-action="apply-device"]').click();
  await page.locator('.canvas-controls [data-action="fit"]').click();
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  for (const font of ['Arial, sans-serif', '"PingFang SC", sans-serif', '"Missing Test Font", monospace']) {
    await page.locator('.device-card').evaluateAll((cards, family) => cards.forEach(card => (card as HTMLElement).style.fontFamily = family), font);
    await expectPaintAtNode(page, 'ant-01'); await expectPaintAtNode(page, 'sw-01');
    const bounds = await page.locator('[data-device-node="ant-01"]').evaluate(card => {
      const heading = card.querySelector('.device-card-heading')!.getBoundingClientRect();
      const footer = card.querySelector('.device-bottom')!.getBoundingClientRect();
      const text = card.querySelector('strong')!.getBoundingClientRect();
      return { overflow: card.scrollWidth > card.clientWidth, overlap: heading.bottom > footer.top, textRight: text.right, cardRight: card.getBoundingClientRect().right };
    });
    expect(bounds.overflow).toBe(false); expect(bounds.overlap).toBe(false);
    expect(bounds.textRight).toBeLessThan(bounds.cardRight);
    expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
  }
  await expect(page.locator('[data-device-node="ant-01"] strong')).toHaveAttribute('title', title);
  await expect(page.locator('[data-device-node="ant-01"] .device-metrics')).toHaveCount(0);
  await expect(page.locator('.x6-node[data-cell-id="sw-01"] .x6-port')).toHaveCount(48);
});
