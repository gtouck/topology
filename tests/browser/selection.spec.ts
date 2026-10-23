import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/topology';

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => window.stationPrototype.snapshot());
async function selectPair(page: Page) {
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('[data-device-node="lnb-01"]').click({ modifiers: ['Control'] });
  await expect(page.locator('.device-card.selected')).toHaveCount(2);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('.mode-switch [data-action="edit"]').click();
});

test('S03 框选和组合键多选，查看模式清理选择框并锁定布局', async ({ page }) => {
  await page.locator('[data-action="tool-select"]').click();
  const a = (await page.locator('[data-device-node="lnb-01"]').boundingBox())!;
  const b = (await page.locator('[data-device-node="bb-rx"]').boundingBox())!;
  await page.mouse.move(a.x - 12, a.y - 12); await page.mouse.down();
  await page.mouse.move(b.x + b.width + 12, Math.max(a.y + a.height, b.y + b.height) + 12, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.device-card.selected')).toHaveCount(2);
  await expect(page.locator('#inspector')).toContainText('2 个节点');
  const before = await snapshot(page);
  await page.locator('[data-device-node="ant-01"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('.device-card.selected')).toHaveCount(3);
  await page.locator('.mode-switch [data-action="monitor"]').click();
  await expect(page.locator('#edit-tools')).toBeHidden();
  await expect(page.locator('#graph .x6-widget-selection')).toBeHidden();
  await page.keyboard.press('Control+v');
  expect(await snapshot(page)).toEqual(before);
});

test('S03 复制内部连线及端口，粘贴和批量删除分别一步撤销', async ({ page }) => {
  const original = await snapshot(page);
  await selectPair(page);
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="paste"]').click();
  await expect(page.locator('.device-card')).toHaveCount(10);
  await expect(page.locator('#stat-total')).toHaveText('10');
  await expect(page.locator('#stat-links')).toHaveText('9');
  const pasted = await snapshot(page);
  const copies = pasted.nodes.filter((node) => !original.nodes.some((old) => old.id === node.id));
  expect(copies).toHaveLength(2);
  expect(copies.every((node) => node.data.binding!.source === node.data.deviceId)).toBe(true);
  await page.locator('[data-action="undo"]').click();
  expect(await snapshot(page)).toEqual(original);
  await page.locator('[data-action="redo"]').click();
  expect(await snapshot(page)).toEqual(pasted);
  await page.evaluate((ids) => window.stationPrototype.graph.resetSelection(ids), copies.map((node) => node.id));
  await page.keyboard.press('Delete');
  expect(await snapshot(page)).toEqual(original);
  await page.locator('[data-action="undo"]').click();
  expect(await snapshot(page)).toEqual(pasted);
});

test('S03 长时间整组拖动保留对外拐点并只生成一步撤销', async ({ page }) => {
  await selectPair(page);
  const before = await snapshot(page);
  const box = (await page.locator('[data-device-node="lnb-01"]').boundingBox())!;
  const x = box.x + 35, y = box.y + 20;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(x + step * 12, y + step * 9, { steps: 3 });
    await page.waitForTimeout(350);
  }
  await page.mouse.up();
  const moved = await snapshot(page);
  const antenna = moved.nodes.find((node) => node.id === 'ant-01')!;
  const originalAntenna = before.nodes.find((node) => node.id === 'ant-01')!;
  const dx = antenna.x - originalAntenna.x, dy = antenna.y - originalAntenna.y;
  expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  const lnb = moved.nodes.find((node) => node.id === 'lnb-01')!, originalLnb = before.nodes.find((node) => node.id === 'lnb-01')!;
  expect(lnb.x - originalLnb.x).toBeCloseTo(dx); expect(lnb.y - originalLnb.y).toBeCloseTo(dy);
  expect(moved.edges.find((edge) => edge.id === 'link-rx-rf')!.vertices).toEqual(before.edges.find((edge) => edge.id === 'link-rx-rf')!.vertices.map((point) => ({ x: point.x + dx, y: point.y + dy })));
  expect(moved.edges.find((edge) => edge.id === 'link-tx-rf')!.vertices).toEqual(before.edges.find((edge) => edge.id === 'link-tx-rf')!.vertices);
  await page.locator('[data-action="undo"]').click();
  expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click();
  expect(await snapshot(page)).toEqual(moved);
});

test('S03 输入框保留文本快捷键，跨图粘贴导入所需节点模板', async ({ page }) => {
  await page.locator('[data-action="new-template"]').click();
  await page.locator('#template-name').fill('可复制模块');
  await page.locator('[data-action="create-template"]').click();
  await page.locator('.library-item', { hasText: '可复制模块' }).click();
  await page.locator('#device-title').focus();
  await page.keyboard.press('Control+a');
  expect(await page.evaluate(() => window.stationPrototype.graph.getSelectedCellCount())).toBe(1);
  await page.locator('[data-action="copy"]').click();
  await page.locator('.heading-actions [data-action="library"]').click();
  await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('接收副本');
  await page.locator('[data-action="create-document"]').click();
  await page.locator('[data-action="paste"]').click();
  await expect(page.locator('.device-card')).toHaveCount(1);
  await expect(page.locator('.device-card')).toContainText('可复制模块');
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(1);
  await expect(page.locator('.device-card')).toContainText('可复制模块');
});

test('S03 紧凑工具界面无统计卡片，画布使用剩余高度且计数实时更新', async ({ page }) => {
  await expect(page.locator('.stats, .stat')).toHaveCount(0);
  await expect(page.locator('.workspace-summary')).toContainText('8 节点');
  await expect(page.locator('.workspace-summary')).toContainText('8 链路');
  const height = await page.locator('#canvas-wrap').evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(650);
  await page.locator('[data-action="select-all"]').click();
  await expect(page.locator('.device-card.selected')).toHaveCount(8);
  await page.locator('[data-action="delete"]').first().click();
  await expect(page.locator('#stat-total')).toHaveText('0');
  await expect(page.locator('#stat-links')).toHaveText('0');
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('#stat-total')).toHaveText('8');
  await expect(page.locator('#stat-links')).toHaveText('8');
});
