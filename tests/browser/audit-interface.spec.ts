import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('交互审计：调整层次与锁定节点保留未应用的属性和新增映射，各自可撤销', async ({ page }) => {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="ant-01"]').click();
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.locator('#device-title').fill('还未提交的节点名');
  await page.locator('.binding-fields summary').click(); await page.locator('[data-binding-action="add"]').click();
  await page.getByLabel('业务状态值', { exact: true }).fill('FAULT');
  await page.getByLabel('映射设备状态', { exact: true }).selectOption('offline');
  await page.locator('#layer-command').selectOption('front');
  await expect(page.locator('#device-title')).toHaveValue('还未提交的节点名');
  const layered = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.locator('[data-action="toggle-node-lock"]').click();
  await expect(page.locator('#device-title')).toHaveValue('还未提交的节点名');
  await expect(page.getByLabel('业务状态值', { exact: true })).toHaveValue('FAULT');
  const locked = await page.evaluate(() => window.stationPrototype.snapshot());
  expect(locked.nodes[0].data.title).toBe(before.nodes[0].data.title); expect(locked.nodes[0].data.locked).toBe(true);
  await page.locator('[data-action="apply-device"]').click();
  expect((await page.evaluate(() => window.stationPrototype.snapshot())).nodes[0].data).toMatchObject({ locked: true, title: '还未提交的节点名', binding: { statusMap: { FAULT: 'offline' } } });
  await page.locator('[data-action="undo"]').click(); expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(locked);
  await page.locator('[data-action="undo"]').click(); expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(layered);
  await page.locator('[data-action="undo"]').click(); expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
});

test('交互审计：窄屏的小地图与属性栏开关分别可点击，不互相遮挡', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/');
  const map = page.locator('.gn-map-toggle'), inspector = page.locator('[data-action="toggle-inspector"]');
  await expect(map).toBeEnabled();
  const a = (await map.boundingBox())!, b = (await inspector.boundingBox())!;
  expect(Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)), '导航与属性栏开关不可覆盖').toBe(0);
  await map.click(); await expect(map).toHaveAttribute('aria-pressed', 'false');
  await expect(inspector).toHaveAttribute('aria-expanded', 'true');
  await inspector.click(); await expect(inspector).toHaveAttribute('aria-expanded', 'false');
  await map.click(); await expect(map).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gn-map')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('交互审计：锁定注释保留文字草稿但仍禁用尺寸修改，解锁后可继续应用', async ({ page }) => {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-action="add-note"]').click();
  await page.locator('#diagram-title').fill('待应用的注释名'); await page.locator('#diagram-text').fill('待应用的说明');
  await page.locator('#diagram-width').fill('400');
  await page.locator('#layer-command').selectOption('back');
  await expect(page.locator('#diagram-title')).toHaveValue('待应用的注释名'); await expect(page.locator('#diagram-text')).toHaveValue('待应用的说明');
  await page.locator('[data-action="toggle-diagram-lock"]').click();
  await expect(page.locator('#diagram-title')).toHaveValue('待应用的注释名'); await expect(page.locator('#diagram-text')).toHaveValue('待应用的说明');
  await expect(page.locator('#diagram-width')).toBeDisabled();
  await page.locator('[data-action="toggle-diagram-lock"]').click(); await expect(page.locator('#diagram-width')).toBeEnabled();
  await expect(page.locator('#diagram-width')).toHaveValue('400'); await page.locator('[data-action="apply-diagram"]').click();
  expect((await page.evaluate(() => window.stationPrototype.snapshot())).elements![0]).toMatchObject({ title: '待应用的注释名', text: '待应用的说明', width: 400 });
});

test('交互审计：仅图面注释也能导出图片；HTML 首次加载失败后可重试离线打开', async ({ page, context }, testInfo) => {
  await page.goto('/');
  await page.locator('.heading-actions [data-action="library"]').click();
  await page.locator('[data-action="new-document"]').click(); await page.locator('#new-document-name').fill('只有图面注释');
  await page.locator('#new-document-kind').selectOption('general'); await page.locator('[data-action="create-document"]').click();
  await page.locator('[data-action="add-note"]').click();
  await page.locator('[data-action="export-options"]').click();
  const downloading = page.waitForEvent('download'); await page.locator('[data-action="export-svg"]').click();
  const svg = await readFile((await (await downloading).path())!, 'utf8'); expect(svg).toContain('data-element-kind="note"'); expect(svg).not.toContain('Infinity');
  await page.route('**/topology-viewer.umd.js*', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('[data-action="export-html"]').click(); await expect(page.locator('#export-status')).toHaveClass('error');
  await expect(page.locator('[data-action="export-html"]')).toBeEnabled();
  await page.unroute('**/topology-viewer.umd.js*');
  const retry = page.waitForEvent('download'); await page.locator('[data-action="export-html"]').click();
  const path = testInfo.outputPath('note-only.html'); await (await retry).saveAs(path);
  await context.setOffline(true); await page.goto(pathToFileURL(path).href);
  await expect(page.locator('[data-diagram-element]')).toHaveCount(1);
  await expect(page.locator('#error')).toBeHidden();
});

test('交互审计：全屏仍可操作导出弹窗，取消和退出保持文档', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.locator('[data-action="fullscreen"]').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.locator('[data-action="export-options"]').click();
  await expect(page.locator('#modal-title')).toHaveText('导出拓扑');
  await page.locator('.modal-heading [data-action="close-modal"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.locator('[data-action="fullscreen"]').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
});
