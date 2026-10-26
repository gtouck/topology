import { expect, test, type Page } from '@playwright/test';
import { LIBRARY_KEY } from '../../src/library';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
const library = (page: Page) => page.locator('.heading-actions [data-action="library"]').click();
const close = (page: Page) => page.locator('#modal .modal-footer [data-action="close-modal"]').click();
async function footer(page: Page, title: string, labels: string[]) {
  await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('#modal .modal-footer button')).toHaveText(labels);
  await expect(page.locator('#modal [data-action="close-modal"]')).toHaveCount(1);
  await expect(page.locator('#modal')).not.toContainText('知道了');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8);
  await page.locator('.mode-switch [data-action="edit"]').click();
});

test('弹窗：说明和管理窗口只有一个关闭入口，重复打开不会残留确认操作', async ({ page }) => {
  for (const [selector, title] of [
    ['.topbar [data-action="help"]', '使用指南'],
    ['.heading-actions [data-action="library"]', '拓扑库'],
    ['[data-action="draft-history"]', '草稿与历史'],
    ['[data-action="export-options"]', '导出拓扑'],
    ['[data-action="manage-templates"]', '管理节点模板'],
  ]) {
    await page.locator(selector).click(); await footer(page, title, ['关闭']); await close(page);
    await expect(page.locator('#modal')).not.toBeVisible();
  }
  await page.locator('[data-action="data-settings"]').click(); await footer(page, '数据接入设置', ['取消', '确定']);
  await page.keyboard.press('Escape');
  await library(page); await footer(page, '拓扑库', ['关闭']);
  await expect(page.locator('#modal [data-action="apply-data-settings"]')).toHaveCount(0);
});

test('弹窗：表单取消和 Esc 不写入新建、信息、参数、端口、模板、发布或间距修改', async ({ page }) => {
  const before = await snapshot(page), original = await stored(page);
  await library(page); await page.locator('[data-action="new-document"]').click();
  await footer(page, '新建拓扑', ['取消', '确定']);
  await page.locator('#new-document-name').fill('不应创建的图'); await close(page);
  expect((await stored(page)).documents).toEqual(original.documents);

  await library(page); await page.locator('.document-card.current [data-document-action="rename"]').click();
  await footer(page, '拓扑信息', ['取消', '确定']);
  await page.locator('#metadata-name').fill('不应保存的信息'); await page.keyboard.press('Escape');
  expect((await stored(page)).documents).toEqual(original.documents);

  await page.locator('[data-action="data-settings"]').click(); await footer(page, '数据接入设置', ['取消', '确定']);
  await page.locator('#freshness-seconds').fill('88'); await close(page);
  expect(await page.evaluate(() => window.stationPrototype.getDataStatus().staleAfterMs)).toBe(15000);

  await page.locator('[data-device-node="ant-01"]').click(); await page.locator('[data-action="configure-ports"]').click();
  await footer(page, '配置端口 · 天线 ANT-01', ['取消', '确定']);
  await page.getByLabel('端口名称', { exact: true }).first().fill('不应保存的端口'); await close(page);
  expect(await snapshot(page)).toEqual(before);

  await page.locator('[data-action="new-template"]').click(); await footer(page, '新建节点模板', ['取消', '确定']);
  await page.locator('#template-name').fill('不应创建的模板'); await page.keyboard.press('Escape');
  expect((await stored(page)).documents).toEqual(original.documents);

  await page.locator('[data-action="publication"]').click(); await footer(page, '发布与版本', ['取消', '确定']);
  await page.locator('#publication-note').fill('不应发布的说明'); await close(page);
  expect((await stored(page)).publishing).toEqual(original.publishing);

  await page.evaluate(() => window.stationPrototype.graph.resetSelection(['ant-01', 'lnb-01']));
  await page.locator('#distribute-command').selectOption('gap'); await footer(page, '指定节点间距', ['取消', '确定']);
  await page.locator('#layout-gap').fill('90'); await close(page);
  expect(await snapshot(page)).toEqual(before);
});

test('弹窗：确定执行原操作并保留校验，删除与重新读取可以取消', async ({ page }) => {
  const before = await snapshot(page), originalId = (await stored(page)).activeId;
  await library(page); await page.locator('[data-action="new-document"]').click();
  await page.locator('#modal .modal-footer').getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('#new-document-name-error')).toBeVisible();
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#new-document-name').fill('弹窗确认测试'); await page.locator('#new-document-kind').selectOption('general');
  await page.locator('#modal .modal-footer').getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible(); await expect(page.locator('.device-card')).toHaveCount(0);
  const createdId = (await stored(page)).activeId;

  await library(page); await page.locator('.document-card.current [data-document-action="rename"]').click();
  await page.locator('#metadata-name').fill('确认已保存的信息'); await page.locator('#modal .modal-footer').getByRole('button', { name: '确定', exact: true }).click();
  await footer(page, '拓扑库', ['关闭']); await expect(page.locator('#page-title')).toHaveText('确认已保存的信息');
  await page.locator(`[data-document-action="delete"][data-document-id="${createdId}"]`).click();
  await footer(page, '删除拓扑', ['取消', '确定']); await close(page);
  expect((await stored(page)).documents).toHaveLength(2);

  await library(page); await page.locator(`[data-document-action="delete"][data-document-id="${createdId}"]`).click();
  await page.locator('#modal .modal-footer').getByRole('button', { name: '确定', exact: true }).click();
  await footer(page, '拓扑库', ['关闭']); await close(page);
  expect((await stored(page)).documents).toHaveLength(1);
  expect((await stored(page)).activeId).toBe(originalId); expect(await snapshot(page)).toEqual(before);

  await page.evaluate(() => {
    (window as unknown as { dialogSentinel: string }).dialogSentinel = 'keep current page';
    const button = document.querySelector<HTMLButtonElement>('[data-action="storage-reload"]')!; button.click();
  });
  await footer(page, '重新读取拓扑库', ['取消', '确定']);
  await expect(page.locator('#modal [data-action="export-reload-backup"]')).toBeVisible(); await close(page);
  expect(await page.evaluate(() => (window as unknown as { dialogSentinel: string }).dialogSentinel)).toBe('keep current page');
  expect(await snapshot(page)).toEqual(before);
});

test('弹窗：窄屏滚动端口表单时确定与取消始终可用，确定只应用端口修改', async ({ page }) => {
  await page.locator('[data-device-node="ant-01"]').click(); const before = await snapshot(page);
  await page.locator('[data-action="configure-ports"]').click(); await page.setViewportSize({ width: 390, height: 640 });
  await footer(page, '配置端口 · 天线 ANT-01', ['取消', '确定']);
  const confirm = page.locator('#modal .modal-footer').getByRole('button', { name: '确定', exact: true });
  await expect(confirm).toBeInViewport();
  await page.getByLabel('端口名称', { exact: true }).first().fill('确认生效的端口');
  await page.locator('#modal-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(confirm).toBeInViewport(); await expect(page.locator('#modal .modal-footer [data-action="close-modal"]')).toBeInViewport();
  await confirm.click(); await expect(page.locator('#modal')).not.toBeVisible();
  const after = await snapshot(page);
  expect(after.nodes.find(node => node.id === 'ant-01')!.data.ports?.some(port => port.label === '确认生效的端口')).toBe(true);
  expect(after.nodes.map(node => [node.id, node.x, node.y])).toEqual(before.nodes.map(node => [node.id, node.x, node.y]));
  expect(after.edges).toEqual(before.edges);
});

test('弹窗：恢复示例须确认，取消保留修改，确认后仍可撤销', async ({ page }) => {
  await page.locator('[data-device-node="ant-01"]').click(); await page.locator('#device-title').fill('恢复前的手工节点');
  await page.locator('[data-action="apply-device"]').click(); const before = await snapshot(page);
  await page.locator('.topbar [data-action="help"]').click(); await page.locator('[data-action="reset"]').click();
  await footer(page, '恢复示例拓扑', ['取消', '确定']); await close(page);
  expect(await snapshot(page)).toEqual(before);
  await page.locator('.topbar [data-action="help"]').click(); await page.locator('[data-action="reset"]').click();
  await page.locator('#modal .modal-footer').getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('[data-device-node="ant-01"]')).not.toContainText('恢复前的手工节点');
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
});
