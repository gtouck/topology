import { expect, test, type Page } from '@playwright/test';
import { sampleDocument } from '../../src/document';
import { LIBRARY_KEY } from '../../src/library';

const activeId = (page: Page) => page.locator('body[data-document-id]').getAttribute('data-document-id');
const library = (page: Page) => page.locator('.heading-actions [data-action="library"]').click();
const close = (page: Page) => page.locator('.modal-footer [data-action="close-modal"]').click();
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
async function importFromButton(page: Page, definition: unknown) {
  const chooser = page.waitForEvent('filechooser'); await page.locator('.demo-button').click();
  await (await chooser).setFiles({ name: 'topology.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)) });
}

test('探索审计：子图预览导入另一文件后清理旧来源、返回按钮与节点点击信息', async ({ page }) => {
  const parent = sampleDocument('ground-station'), child = sampleDocument('datacenter');
  parent.topology.nodes[0].data.childTopologyId = child.id;
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); }, { key: LIBRARY_KEY, value: { version: 1, activeId: parent.id, documents: [parent, child] } });
  await page.goto(`/viewer.html?document=${parent.id}&draft=1`);
  await page.locator('[data-device-node="ant-01"]').click(); await page.locator('.tv-open-child').click();
  await expect(page.locator('#viewer-title')).toHaveText(child.name);
  await page.locator('[data-device-node]').first().click(); await expect(page.locator('#viewer-selection')).toContainText('核心路由器');
  const childUrl = page.url();
  await importFromButton(page, { format: 'topology-document', version: 99 });
  await expect(page.locator('#viewer-error')).toContainText('版本');
  expect(page.url()).toBe(childUrl); await expect(page.locator('#viewer-back')).toBeVisible();
  expect(await page.evaluate(() => window.topologyViewer.getDefinition())).toEqual(child);
  const imported = sampleDocument('satellite', '独立导入的卫星文件');
  await importFromButton(page, imported);
  await expect(page.locator('#viewer-title')).toHaveText(imported.name);
  await expect(page.locator('#viewer-back')).toHaveCount(0);
  await expect(page).not.toHaveURL(/document=|draft=|from=/);
  await expect(page.locator('#viewer-selection')).toHaveText('点击节点查看回调内容');
  await expect(page.locator('#viewer-error')).toBeEmpty();
  await expect(page.locator('#viewer-data')).toHaveValue('{}');
  expect(await page.evaluate(() => window.topologyViewer.getDefinition())).toEqual(imported);
  await page.goBack(); await expect(page.locator('[data-device-node="ant-01"]')).toBeVisible();
  expect(await page.evaluate(() => window.topologyViewer.getDefinition().id)).toBe(parent.id);
});

test('探索审计：独立展示清空无效输入后清除错误，能再次填入示例并更新', async ({ page }) => {
  await page.goto('/viewer.html');
  await page.locator('[data-device-node]').first().click();
  await page.locator('#viewer-data').fill('bad json'); await page.locator('#apply-viewer-data').click();
  await expect(page.locator('#viewer-error')).not.toBeEmpty();
  await page.locator('#clear-viewer-data').click();
  await expect(page.locator('#viewer-error')).toBeEmpty();
  await expect(page.locator('#viewer-data')).toHaveValue('{}'); await expect(page.locator('#viewer-link-data')).toHaveValue('{}');
  await expect(page.locator('#viewer-selection')).toHaveText('点击节点查看回调内容');
  await page.locator('#sample-viewer-data').click(); await page.locator('#apply-viewer-data').click();
  await expect(page.locator('#viewer-error')).toBeEmpty(); await expect(page.locator('.device-card').first().locator('[data-metric]').first()).toContainText('20.5');
});

test('探索审计：新建错误修正、取消、空白图复制与最后一图删除保护', async ({ page }) => {
  await page.goto('/'); const original = await activeId(page);
  await library(page); await expect(page.locator('[data-document-action="delete"]')).toBeDisabled();
  await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('   '); await page.locator('[data-action="create-document"]').click();
  await expect(page.locator('#new-document-name-error')).toContainText('请填写');
  await page.locator('#new-document-name').fill('空白业务图'); await page.locator('#new-document-kind').selectOption('general');
  await close(page); expect(await activeId(page)).toBe(original); expect((await stored(page)).documents).toHaveLength(1);
  await library(page); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('空白业务图'); await page.locator('#new-document-kind').selectOption('general'); await page.locator('[data-action="create-document"]').click();
  const blank = await activeId(page); await expect(page.locator('.device-card')).toHaveCount(0);
  await library(page); await page.locator(`[data-document-action="copy"][data-document-id="${blank}"]`).click();
  const copy = await activeId(page); expect(copy).not.toBe(blank); await expect(page.locator('.device-card')).toHaveCount(0);
  await page.locator(`[data-document-action="delete"][data-document-id="${blank}"]`).click(); await close(page);
  expect((await stored(page)).documents).toHaveLength(3);
  await library(page); await page.locator(`[data-document-action="delete"][data-document-id="${blank}"]`).click(); await page.locator('[data-document-action="confirm-delete"]').click();
  await page.locator(`[data-document-action="delete"][data-document-id="${original}"]`).click(); await page.locator('[data-document-action="confirm-delete"]').click();
  await expect(page.locator('[data-document-action="delete"]')).toBeDisabled(); expect((await stored(page)).documents).toHaveLength(1);
  await close(page); await page.reload(); expect(await activeId(page)).toBe(copy); await expect(page.locator('.device-card')).toHaveCount(0);
});

test('探索审计：跨图改信息和撤销不丢当前草稿，复制发布图形成独立未发布图', async ({ page }) => {
  await page.goto('/'); const first = await activeId(page);
  await library(page); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('原始空白图'); await page.locator('#new-document-kind').selectOption('general'); await page.locator('[data-action="create-document"]').click();
  const second = await activeId(page);
  await library(page); await page.locator(`[data-document-action="open"][data-document-id="${first}"]`).click();
  await page.locator('[data-device-node="srv-01"]').click(); await page.locator('#device-title').fill('跨图保留的草稿节点'); await page.locator('[data-action="apply-device"]').click();
  await library(page); await page.locator(`[data-document-action="rename"][data-document-id="${second}"]`).click();
  await page.locator('#metadata-name').fill('另一个图的信息修改'); await page.locator('#metadata-category').fill('业务自定义'); await page.locator('[data-action="apply-document-info"]').click();
  await page.locator(`[data-document-action="open"][data-document-id="${second}"]`).click();
  await expect(page.locator('#crumb-document')).toHaveText('另一个图的信息修改');
  await page.locator('[data-action="undo"]').click(); await expect(page.locator('#crumb-document')).toHaveText('原始空白图');
  await page.locator('[data-action="redo"]').click(); await expect(page.locator('#crumb-document')).toHaveText('另一个图的信息修改');
  await library(page); await page.locator(`[data-document-action="open"][data-document-id="${first}"]`).click();
  await expect(page.locator('[data-device-node="srv-01"]')).toContainText('跨图保留的草稿节点');
  await page.locator('[data-action="publication"]').click(); await page.locator('[data-action="publish-current"]').click(); await close(page);
  await library(page); await page.locator(`[data-document-action="copy"][data-document-id="${first}"]`).click();
  const copy = await activeId(page); expect(copy).not.toBe(first);
  await expect(page.locator('#publication-label')).toHaveText('未发布');
  await close(page); await expect(page.locator('[data-device-node="srv-01"]')).toContainText('跨图保留的草稿节点');
  await page.reload(); expect(await activeId(page)).toBe(copy); await expect(page.locator('[data-device-node="srv-01"]')).toContainText('跨图保留的草稿节点');
  expect((await stored(page)).publishing.entries).toHaveLength(1);
  await library(page); await page.locator(`[data-document-action="delete"][data-document-id="${copy}"]`).click(); await page.locator('[data-document-action="confirm-delete"]').click(); await close(page);
  expect(await activeId(page)).toBe(first); await expect(page.locator('[data-device-node="srv-01"]')).toContainText('跨图保留的草稿节点'); await expect(page.locator('#publication-label')).toHaveText('r1');
});
