import { expect, test, type Page } from '@playwright/test';
import { LIBRARY_KEY } from '../../src/library';

const edit = (page: Page) => page.locator('.mode-switch [data-action="edit"]').click();
async function renameServer(page: Page, title: string) {
  await page.locator('[data-device-node="srv-01"]').click();
  await page.locator('#device-title').fill(title);
  await page.locator('[data-action="apply-device"]').click();
}
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
});

test('S02 自动草稿合并频繁移动，刷新恢复且模拟数据不触发存储', async ({ page }) => {
  await edit(page);
  await page.evaluate(() => {
    const node = window.stationPrototype.graph.getCellById('srv-01');
    if (!node.isNode()) throw new Error('missing node');
    for (let i = 0; i < 10; i++) node.position(900 + i * 10, 400);
  });
  await expect(page.locator('#save-status')).toContainText('草稿已自动保存');
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  const state = await stored(page);
  expect(state.editing.revision).toBe(1);
  expect(state.editing.drafts[0].document.topology).toEqual(before);
  expect(state.documents[0].topology).not.toEqual(before);
  await page.reload();
  await expect(page.locator('.device-card')).toHaveCount(8);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
  await expect(page.locator('#save-status')).toContainText('草稿已自动保存');
  const revision = (await stored(page)).editing.revision;
  await page.waitForTimeout(2300);
  expect((await stored(page)).editing.revision).toBe(revision);
});

test('S02 恢复旧版本前备份当前图，撤销恢复节点与自定义模板', async ({ page }) => {
  await edit(page);
  await renameServer(page, '已保存的服务器');
  await page.locator('[data-action="save"]').click();
  await page.locator('[data-action="new-template"]').click();
  await page.locator('#template-name').fill('恢复测试模块');
  await page.locator('[data-action="create-template"]').click();
  await page.locator('.library-item', { hasText: '恢复测试模块' }).click();
  await expect(page.locator('.device-card')).toHaveCount(9);
  const current = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.locator('[data-action="draft-history"]').click();
  await page.locator('.history-list .history-entry', { hasText: '原保存版本' }).locator('[data-restore-version]').click();
  await expect(page.locator('.device-card')).toHaveCount(8);
  await expect(page.locator('[data-device-node="srv-01"]')).toContainText('业务服务器 SRV-01');
  await expect(page.locator('.library-item', { hasText: '恢复测试模块' })).toHaveCount(0);
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('.device-card')).toHaveCount(9);
  await expect(page.locator('.library-item', { hasText: '恢复测试模块' })).toHaveCount(1);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(current);
  const state = await stored(page);
  expect(state.documents[0].topology.nodes.find((n: { id: string }) => n.id === 'srv-01').data.title).toBe('已保存的服务器');
  expect(state.editing.history.some((entry: { reason: string }) => entry.reason === 'before-restore')).toBe(true);
});

test('S02 配额不足显示失败，仍能导出，并可在恢复存储后重试', async ({ page }) => {
  await edit(page);
  const original = await stored(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as Window & { failStorage?: boolean }).failStorage = true;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && (window as Window & { failStorage?: boolean }).failStorage) throw new DOMException('Storage full', 'QuotaExceededError');
      original.call(this, name, value);
    };
  }, LIBRARY_KEY);
  await renameServer(page, '未保存也可导出的服务器');
  await expect(page.locator('#draft-notice')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveText('草稿保存失败');
  expect(await stored(page)).toEqual(original);
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="export-current-backup"]').click();
  const file = await downloading;
  const fs = await import('node:fs/promises');
  const exported = JSON.parse(await fs.readFile((await file.path())!, 'utf8'));
  expect(exported.topology.nodes.find((n: { id: string }) => n.id === 'srv-01').data.title).toBe('未保存也可导出的服务器');
  await page.evaluate(() => { (window as Window & { failStorage?: boolean }).failStorage = false; });
  await page.locator('[data-action="retry-draft"]').click();
  await expect(page.locator('#draft-notice')).toBeHidden();
  await expect(page.locator('#save-status')).toContainText('草稿已自动保存');
  await page.reload();
  await expect(page.locator('[data-device-node="srv-01"]')).toContainText('未保存也可导出的服务器');
});

test('S02 另一个标签页更新后暂停保存，不覆盖另一页的草稿', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/'); await expect(other.locator('.device-card')).toHaveCount(8);
  await edit(page); await renameServer(page, '标签页 A');
  await expect(page.locator('#save-status')).toContainText('草稿已自动保存');
  await expect(other.locator('#draft-notice')).toContainText('其他标签页');
  await edit(other); await renameServer(other, '标签页 B');
  await other.locator('[data-action="save"]').click();
  await expect(other.locator('#save-status')).toHaveText('草稿保存失败');
  const state = await stored(page);
  expect(state.editing.drafts[0].document.topology.nodes.find((n: { id: string }) => n.id === 'srv-01').data.title).toBe('标签页 A');
  await other.close();
});

test('S02 损坏的草稿元数据在刷新后保留原值并提示恢复', async ({ page }) => {
  const raw = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.editing = { version: 1, revision: -1, drafts: [], history: [] };
    const raw = JSON.stringify(state); localStorage.setItem(key, raw); return raw;
  }, LIBRARY_KEY);
  await page.reload();
  await expect(page.locator('#draft-notice')).toContainText('存档无法读取');
  await expect(page.locator('.device-card')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY)).toBe(raw);
});
