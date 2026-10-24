import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LIBRARY_KEY } from '../../src/library';

async function edit(page: Page) { await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click(); }
async function rename(page: Page, value: string) { await page.locator('[data-device-node="ant-01"]').click(); await page.locator('#device-title').fill(value); await page.locator('[data-action="apply-device"]').click(); }
async function publish(page: Page, note = '') {
  await page.locator('[data-action="publication"]').click(); await page.locator('#publication-note').fill(note);
  await page.locator('[data-action="publish-current"]').click();
}
const close = (page: Page) => page.locator('.modal-footer [data-action="close-modal"]').click();
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
const snap = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());

test('S09 显式发布切换展示，草稿保存隔离，固定历史与回滚可追溯', async ({ page, context }) => {
  await edit(page); await expect(page.locator('#publication-label')).toHaveText('未发布');
  await rename(page, '正式版一'); await page.locator('[data-action="save"]').click();
  expect((await stored(page)).publishing?.entries ?? []).toEqual([]);
  await page.evaluate(() => window.stationPrototype.updateTelemetry('DEV-001', { azimuth: 99.9 }, 'warning'));
  await publish(page, '<script>首版说明</script>');
  await expect(page.locator('.publication-entry').first()).toContainText('<script>首版说明</script>');
  await expect(page.locator('#publication-label')).toHaveText('r1');
  const state = await stored(page), first = state.publishing.entries[0], id = first.documentId;
  expect(first.document.topology.nodes[0].data.status).toBe('normal'); expect(JSON.stringify(first.document)).not.toContain('receivedAt');
  const following = await context.newPage(), fixed = await context.newPage();
  await following.goto(`/viewer.html?published=${id}`); await fixed.goto(`/viewer.html?published=${id}&revision=1&publication=${first.id}`);
  await expect(following.locator('body[data-published]')).toHaveAttribute('data-publication-revision', '1');
  await expect(following.locator('[data-device-node="ant-01"]')).toContainText('正式版一');
  await close(page); await rename(page, '待发布版二'); await page.locator('[data-action="save"]').click();
  await expect(following.locator('[data-device-node="ant-01"]')).toContainText('正式版一');
  await publish(page, '第二版'); await expect(following.locator('body[data-published]')).toHaveAttribute('data-publication-revision', '2');
  await expect(following.locator('[data-device-node="ant-01"]')).toContainText('待发布版二');
  await expect(fixed.locator('body[data-published]')).toHaveAttribute('data-publication-revision', '1');
  await expect(fixed.locator('[data-device-node="ant-01"]')).toContainText('正式版一');
  const before = await snap(page);
  await page.locator(`.publication-entry[data-publication-id="${first.id}"] [data-publication-action="rollback"]`).click();
  await expect(page.locator('#publication-label')).toHaveText('r3'); await expect(following.locator('body[data-published]')).toHaveAttribute('data-publication-revision', '3');
  await expect(following.locator('[data-device-node="ant-01"]')).toContainText('正式版一');
  expect(await snap(page)).toEqual(before); expect((await stored(page)).publishing.entries[0].rollbackOf).toBe(first.id);
  await close(page); await page.locator('[data-action="undo"]').click();
  expect((await snap(page)).nodes[0].data.title).toBe('正式版一');
  expect((await stored(page)).publishing.entries[0].revision).toBe(3);
});

test('S09 发布配置导出使用发布快照，重新导入为独立未发布拓扑', async ({ page }) => {
  await edit(page); await rename(page, '发布配置'); await publish(page, '可复用版本'); await close(page);
  await rename(page, '未发布修改'); await page.locator('[data-action="publication"]').click();
  const download = page.waitForEvent('download'); await page.locator('[data-action="export-published"]').click();
  const file = await download, buffer = await readFile((await file.path())!); const document = JSON.parse(buffer.toString('utf8'));
  expect(file.suggestedFilename()).toContain('r1'); expect(document.version).toBe(3); expect(document.topology.nodes[0].data.title).toBe('发布配置');
  expect(JSON.stringify(document)).not.toContain('receivedAt'); expect(document.publishing).toBeUndefined();
  await close(page); await page.locator('#import-file').setInputFiles({ name: 'published.topology.json', mimeType: 'application/json', buffer });
  await expect(page.locator('#publication-label')).toHaveText('未发布'); await expect(page.locator('[data-device-node="ant-01"]')).toContainText('发布配置');
  const state = await stored(page); expect(state.documents).toHaveLength(2); expect(state.publishing.entries).toHaveLength(1);
  expect(state.activeId).not.toBe(state.publishing.entries[0].documentId);
});

test('S09 发布配额失败及过期版本不推进发布，说明保留可重试', async ({ page }) => {
  await edit(page); await page.locator('[data-action="publication"]').click(); await page.locator('#publication-note').fill('失败后保留的说明');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restorePublicationStorage: () => void }).restorePublicationStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(k, value) {
      if (k === key && JSON.parse(value).publishing?.entries.length) throw new DOMException('发布容量不足', 'QuotaExceededError');
      original.call(this, k, value);
    };
  }, LIBRARY_KEY);
  await page.locator('[data-action="publish-current"]').click(); await expect(page.locator('#publication-note-error')).toContainText('容量不足');
  await expect(page.locator('#publication-note')).toHaveValue('失败后保留的说明'); expect((await stored(page)).publishing?.entries ?? []).toEqual([]);
  await page.evaluate(() => (window as unknown as { restorePublicationStorage: () => void }).restorePublicationStorage());
  await page.locator('[data-action="publish-current"]').click(); await expect(page.locator('#publication-label')).toHaveText('r1');
  await page.locator('#publication-expected-revision').evaluate((input: HTMLInputElement) => { input.value = '0'; });
  await page.locator('#publication-note').fill('不会覆盖新发布'); await page.locator('[data-action="publish-current"]').click();
  await expect(page.locator('#publication-note-error')).toContainText('已发布版本已变化');
  expect((await stored(page)).publishing.entries).toHaveLength(1);
});

test('S09 缺失发布不回退草稿，删除图后跟随页清除旧发布', async ({ page, context }) => {
  await edit(page); const id = (await stored(page)).activeId;
  const following = await context.newPage(); await following.goto(`/viewer.html?published=${id}`);
  await expect(following.locator('#publication-error')).toBeVisible(); await expect(following.locator('.device-card')).toHaveCount(0);
  await publish(page); await expect(following.locator('body[data-published]')).toHaveAttribute('data-publication-revision', '1');
  await expect(following.locator('.device-card')).toHaveCount(8);
  const missingFixed = await context.newPage(); await missingFixed.goto(`/viewer.html?published=${id}&revision=1&publication=missing`);
  await expect(missingFixed.locator('#publication-error')).toBeVisible(); await expect(missingFixed.locator('.device-card')).toHaveCount(0); await missingFixed.close();
  await close(page); await page.locator('.heading-actions [data-action="library"]').click(); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('保留图'); await page.locator('[data-action="create-document"]').click();
  await page.locator('.heading-actions [data-action="library"]').click(); await page.locator(`[data-document-id="${id}"][data-document-action="delete"]`).click();
  await page.locator('[data-document-action="confirm-delete"]').click();
  await expect(following.locator('.device-card')).toHaveCount(0); await expect(following.locator('#publication-error')).toBeVisible();
  await expect(following.locator('#viewer-title')).toHaveText('发布版本不可用');
  expect((await stored(page)).publishing?.entries ?? []).toEqual([]);
});
