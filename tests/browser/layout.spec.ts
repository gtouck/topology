import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/topology';

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => window.stationPrototype.snapshot());
const select = (page: Page, ids: string[]) => page.evaluate((ids) => window.stationPrototype.graph.resetSelection(ids), ids);
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('.mode-switch [data-action="edit"]').click();
});

test('S04 对齐识别锁定参照，一次撤销恢复位置及锁定状态', async ({ page }) => {
  await select(page, ['lnb-01']);
  await page.locator('[data-action="lock-selected"]').click();
  await select(page, ['lnb-01', 'ant-01', 'hpa-01']);
  const before = await snapshot(page);
  await page.locator('#align-command').selectOption('left');
  const aligned = await snapshot(page);
  expect(aligned.nodes.filter((node) => ['lnb-01', 'ant-01', 'hpa-01'].includes(node.id)).map((node) => node.x)).toEqual([310, 310, 310]);
  expect(aligned.nodes.find((node) => node.id === 'lnb-01')!.data.locked).toBe(true);
  await expect(page.locator('#toast')).toContainText('跳过 1 个锁定节点');
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(aligned);
});

test('S04 自动等距及指定间距生效，错误间距保持原图', async ({ page }) => {
  await page.evaluate(() => {
    for (const [id, x, y] of [['ant-01', 20, 100], ['lnb-01', 400, 250], ['bb-rx', 900, 400]] as const) {
      const node = window.stationPrototype.graph.getCellById(id); if (node.isNode()) node.position(x, y);
    }
  });
  await select(page, ['ant-01', 'lnb-01', 'bb-rx']);
  await page.locator('#distribute-command').selectOption('horizontal');
  const beforeGap = await snapshot(page);
  expect(['ant-01', 'lnb-01', 'bb-rx'].map((id) => beforeGap.nodes.find((node) => node.id === id)!.x)).toEqual([20, 460, 900]);
  await page.locator('#distribute-command').selectOption('gap');
  await page.locator('#layout-gap').fill('-1');
  await page.locator('[data-action="apply-spacing"]').click();
  await expect(page.locator('#spacing-error')).toContainText('间距必须');
  expect(await snapshot(page)).toEqual(beforeGap);
  await page.locator('#layout-gap').fill('12.5'); await page.locator('#layout-gap').press('Enter');
  await expect(page.locator('#modal')).not.toBeVisible();
  const spaced = await snapshot(page);
  expect(['ant-01', 'lnb-01', 'bb-rx'].map((id) => spaced.nodes.find((node) => node.id === id)!.x)).toEqual([20, 242.5, 465]);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(beforeGap);
});

test('S04 锁定阻止拖动、键盘和删除，刷新及独立展示保留状态', async ({ page }) => {
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('[data-action="lock-selected"]').click();
  const card = page.locator('[data-device-node="ant-01"]');
  await expect(card.locator('.device-lock-indicator')).toBeVisible();
  const locked = await snapshot(page), box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 55, { steps: 8 }); await page.mouse.up();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Delete');
  expect(await snapshot(page)).toEqual(locked);
  await page.locator('[data-action="copy"]').click(); await page.locator('[data-action="paste"]').click();
  const pasted = await snapshot(page);
  expect(pasted.nodes.at(-1)!.data.locked).toBeUndefined();
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await expect(card.locator('.device-lock-indicator')).toBeHidden();
  expect((await snapshot(page)).nodes.find((node) => node.id === 'ant-01')!.data.locked).toBe(true);
  await page.locator('.mode-switch [data-action="edit"]').click();
  await expect(card.locator('.device-lock-indicator')).toBeVisible();
  const documentId = await page.locator('body[data-document-id]').getAttribute('data-document-id');
  await page.goto(`/viewer.html?document=${documentId}`);
  await expect(page.locator('.device-card')).toHaveCount(8);
  await expect(page.locator('.device-lock-indicator')).toHaveCount(0);
  expect(await page.evaluate(() => window.topologyViewer.getDefinition().topology.nodes.find((node) => node.id === 'ant-01')!.data.locked)).toBe(true);
});

test('S04 混合选择移动及删除跳过锁定节点，对外拐点不漂移', async ({ page }) => {
  await select(page, ['lnb-01']); await page.locator('[data-action="lock-selected"]').click();
  await select(page, ['ant-01', 'lnb-01']);
  const before = await snapshot(page);
  await page.keyboard.press('ArrowRight');
  const moved = await snapshot(page);
  expect(moved.nodes.find((node) => node.id === 'ant-01')!.x).toBe(before.nodes.find((node) => node.id === 'ant-01')!.x + 10);
  expect(moved.nodes.find((node) => node.id === 'lnb-01')).toEqual(before.nodes.find((node) => node.id === 'lnb-01'));
  expect(moved.edges[0].vertices).toEqual(before.edges[0].vertices);
  await page.locator('[data-action="delete"]').first().click();
  await expect(page.locator('.device-card')).toHaveCount(7);
  await expect(page.locator('[data-device-node="lnb-01"]')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('跳过 1 个锁定节点');
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(moved);
});

test('S04 右键保留多选，菜单复制和点击位置粘贴正确', async ({ page }) => {
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('[data-device-node="lnb-01"]').click({ modifiers: ['Control'] });
  await page.locator('[data-device-node="lnb-01"]').click({ button: 'right' });
  await expect(page.locator('#canvas-context-menu')).toBeVisible();
  await expect(page.locator('.device-card.selected')).toHaveCount(2);
  await page.locator('[data-context-command="copy"]').click();
  const before = await snapshot(page), graph = (await page.locator('#graph').boundingBox())!;
  const x = graph.x + 10, y = graph.y + graph.height - 45;
  const point = await page.evaluate(({ x, y }) => window.stationPrototype.graph.clientToLocal(x, y).toJSON(), { x, y });
  await page.mouse.click(x, y, { button: 'right' });
  await page.locator('[data-context-command="paste"]').click();
  await expect(page.locator('.device-card')).toHaveCount(10);
  const copies = (await snapshot(page)).nodes.filter((node) => !before.nodes.some((old) => old.id === node.id));
  expect(Math.min(...copies.map((node) => node.x))).toBeCloseTo(Math.round(point.x / 10) * 10);
  expect(Math.min(...copies.map((node) => node.y))).toBeCloseTo(Math.round(point.y / 10) * 10);
});

test('S04 菜单支持键盘、窗口边界及查看模式限制', async ({ page }) => {
  await select(page, ['ant-01', 'lnb-01']);
  await page.locator('#graph').focus(); await page.keyboard.press('Shift+F10');
  const menu = page.locator('#canvas-context-menu'); await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1600); expect(bounds.y + bounds.height).toBeLessThanOrEqual(1050);
  await page.keyboard.press('End');
  await expect(page.locator('[data-context-command="export-options"]')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#modal-title')).toHaveText('导出拓扑');
  await page.locator('[data-action="close-modal"]').first().click();
  await page.locator('.mode-switch [data-action="monitor"]').click();
  const before = await snapshot(page);
  await page.locator('[data-device-node="ant-01"]').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(page.locator('[data-context-command="delete"], [data-context-command="lock-selected"]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
});
