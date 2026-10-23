import { expect, test, type Page } from '@playwright/test';
import { createDocument, sampleDocument } from '../../src/document';
import { LIBRARY_KEY } from '../../src/library';
import { UI_PREFERENCES_KEY } from '../../src/workbench-layout';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const edit = (page: Page) => page.locator('.mode-switch [data-action="edit"]').click();
const openLibrary = (page: Page) => page.locator('.heading-actions [data-action="library"]').click();

test('S05 侧栏调宽和折叠可记忆，界面调整不改变文档及画布视口', async ({ page }) => {
  await page.goto('/'); await edit(page);
  const before = await snapshot(page);
  const viewport = await page.evaluate(() => ({ zoom: window.stationPrototype.graph.zoom(), pan: window.stationPrototype.graph.translate() }));
  const stored = await page.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY);
  const left = page.locator('#sidebar-resizer'), box = (await left.boundingBox())!;
  await page.mouse.move(box.x + 3, 120); await page.mouse.down(); await page.mouse.move(box.x + 43, 120, { steps: 6 }); await page.mouse.up();
  await expect(left).toHaveAttribute('aria-valuenow', '248');
  await left.focus(); await page.keyboard.press('ArrowRight'); await expect(left).toHaveAttribute('aria-valuenow', '258');
  const right = page.locator('#inspector-resizer'); await right.focus(); await page.keyboard.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuenow', '290');
  await page.locator('[data-action="toggle-inspector"]').click();
  await page.locator('.topbar [data-action="toggle-sidebar"]').click();
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(page.locator('#sidebar')).toHaveCSS('width', '56px');
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => ({ zoom: window.stationPrototype.graph.zoom(), pan: window.stationPrototype.graph.translate() }))).toEqual(viewport);
  expect(await page.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY)).toBe(stored);
  await page.reload();
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(page.locator('#sidebar')).toHaveCSS('width', '56px');
  await page.locator('.topbar [data-action="toggle-sidebar"]').click(); await page.locator('[data-action="toggle-inspector"]').click();
  await expect(page.locator('#sidebar')).toHaveCSS('width', '258px');
  await expect(page.locator('#inspector')).toHaveCSS('width', '290px');
});

test('S05 分区开关在换节点和刷新后保留，错误自动展开并聚焦且保留输入', async ({ page }) => {
  await page.goto('/'); await edit(page); await page.locator('[data-device-node="ant-01"]').click();
  const before = await snapshot(page), basic = page.locator('[data-property-section="basic"]'), metrics = page.locator('[data-property-section="metrics"]');
  await metrics.locator('summary').click();
  await page.locator('#device-title').fill('');
  await basic.locator('summary').click();
  await page.locator('[data-action="apply-device"]').click();
  await expect(basic).toHaveAttribute('open', '');
  await expect(page.locator('#device-title')).toBeFocused();
  await expect(page.locator('#device-title-error')).toHaveText('请填写节点名称');
  await expect(page.locator('#device-title')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#device-title').fill('手工输入的天线名称');
  const binding = page.locator('.binding-fields'); await binding.locator('summary').click();
  const original = await page.locator('#binding-fields').inputValue();
  await page.locator('#binding-fields').fill('{'); await binding.locator('summary').click();
  await page.locator('[data-action="apply-device"]').click();
  await expect(binding).toHaveAttribute('open', '');
  await expect(page.locator('#binding-fields')).toBeFocused();
  await expect(page.locator('#binding-fields-error')).toContainText('JSON');
  await expect(page.locator('#device-title')).toHaveValue('手工输入的天线名称');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#binding-fields').fill(original); await page.locator('[data-action="apply-device"]').click();
  await expect(page.locator('#device-title-error, #binding-fields-error')).toHaveCount(0);
  expect((await snapshot(page)).nodes.find((node) => node.id === 'ant-01')!.data.title).toBe('手工输入的天线名称');
  await expect(metrics).not.toHaveAttribute('open', '');
  await page.locator('[data-device-node="lnb-01"]').click(); await expect(metrics).not.toHaveAttribute('open', '');
  await page.locator('[data-action="save"]').click(); await page.reload(); await edit(page); await page.locator('[data-device-node="ant-01"]').click();
  await expect(metrics).not.toHaveAttribute('open', '');
});

test('S05 新建拓扑与模板错误显示在字段旁，不丢失其余输入', async ({ page }) => {
  await page.goto('/'); await openLibrary(page); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-kind').selectOption('satellite');
  await page.locator('[data-action="create-document"]').click();
  await expect(page.locator('#new-document-name-error')).toBeVisible();
  await expect(page.locator('#new-document-name')).toBeFocused();
  await expect(page.locator('#new-document-kind')).toHaveValue('satellite');
  await page.locator('#new-document-name').fill('卫星控制图'); await page.locator('[data-action="create-document"]').click();
  await openLibrary(page);
  await page.locator('.document-card.current [data-document-action="rename"]').click();
  await page.locator('#metadata-name').fill(''); await page.locator('#metadata-description').fill('保留这段说明');
  await page.locator('[data-action="apply-document-info"]').click();
  await expect(page.locator('#metadata-name-error')).toBeVisible(); await expect(page.locator('#metadata-name')).toBeFocused();
  await expect(page.locator('#metadata-description')).toHaveValue('保留这段说明');
  await page.locator('#metadata-name').fill('卫星控制图'); await page.locator('[data-action="apply-document-info"]').click();
  await page.locator('[data-action="close-modal"]').first().click();
  await page.locator('[data-action="new-template"]').click();
  await page.locator('#template-name').fill('控制模块');
  await page.locator('#template-metrics').fill('voltage,电压,V,9');
  await page.locator('[data-action="create-template"]').click();
  await expect(page.locator('#template-metrics-error')).toBeVisible();
  await expect(page.locator('#template-metrics')).toBeFocused();
  await expect(page.locator('#template-name')).toHaveValue('控制模块');
  await page.locator('#template-metrics').fill('a,参数一,V,1\nb,参数二,V,1\nc,参数三,V,1');
  await page.locator('[data-action="create-template"]').click();
  await page.locator('.library-item', { hasText: '控制模块' }).click();
  await page.locator('input[name="visible-metric"][value="c"]').check();
  await page.locator('[data-action="apply-device"]').click();
  await expect(page.locator('#visible-metrics-error')).toContainText('最多展示 2 项');
});

test('S05 拓扑库搜索分类排序与无结果提示，缩略图使用有效草稿且不改布局', async ({ page }) => {
  const first = sampleDocument('ground-station', 'A 地面站'); first.updatedAt = '2026-01-01T00:00:00.000Z'; first.description = '主控传输链路';
  const second = sampleDocument('satellite', 'C 卫星'); second.updatedAt = '2026-03-01T00:00:00.000Z';
  const third = createDocument('B 机房', 'datacenter'); third.updatedAt = '2026-02-01T00:00:00.000Z';
  await page.addInitScript(({ key, documents }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: documents[0].id, documents }));
  }, { key: LIBRARY_KEY, documents: [first, second, third] });
  await page.goto('/'); await edit(page);
  await page.evaluate(() => { const node = window.stationPrototype.graph.getCellById('ant-01'); if (node.isNode()) node.position(-180, 340); });
  const before = await snapshot(page);
  await openLibrary(page);
  await expect(page.locator('.document-card')).toHaveCount(3);
  await expect(page.locator('.document-card').first()).toHaveAttribute('data-library-document', first.id);
  const rect = page.locator(`[data-library-document="${first.id}"] [data-thumbnail-node="ant-01"]>rect`).first();
  await expect(rect).toHaveAttribute('x', '-180'); await expect(rect).toHaveAttribute('y', '340');
  await expect(page.locator(`[data-library-document="${third.id}"] .document-thumbnail`)).toContainText('空白画布');
  await expect(page.locator('.document-card h3')).toHaveText(['A 地面站', 'C 卫星', 'B 机房']);
  await page.locator('#library-sort').selectOption('name');
  await expect(page.locator('.document-card h3')).toHaveText(['A 地面站', 'B 机房', 'C 卫星']);
  await page.locator('#library-search').fill('主控 地面站');
  await expect(page.locator('.document-card')).toHaveCount(1); await expect(page.locator('#library-search')).toBeFocused();
  await page.locator('#library-category').selectOption('satellite');
  await expect(page.locator('.library-empty')).toContainText('未找到匹配的拓扑');
  await page.locator('[data-action="clear-library-filters"]').click();
  await expect(page.locator('.document-card')).toHaveCount(3);
  expect(await snapshot(page)).toEqual(before);
  await page.screenshot({ path: '/private/tmp/station-device-draw-s05-library.png' });
  await page.locator(`[data-preview-document="${second.id}"]`).click();
  await expect(page.locator('#page-title')).toHaveText('C 卫星');
});

test('S05 窄屏仍可打开节点库并添加节点，关闭抽屉后不遮挡画布', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await edit(page);
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.locator('.topbar [data-action="toggle-sidebar"]').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.locator('[data-device="module"]').click();
  await expect(page.locator('.device-card')).toHaveCount(9); await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#sidebar-backdrop')).toBeHidden();
  await expect(page.locator('#inspector')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/station-device-draw-s05-mobile.png', fullPage: true });
});

test('S05 界面偏好损坏或写入失败不影响制图存档', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, '{broken');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) { if (k === key) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, k, value); };
  }, UI_PREFERENCES_KEY);
  await page.goto('/'); await edit(page); await page.locator('[data-action="toggle-inspector"]').click();
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('界面偏好无法保存');
  await page.locator('[data-device="module"]').click(); await page.locator('[data-action="save"]').click();
  await expect(page.locator('#save-status')).not.toHaveClass(/error/);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).documents[0].topology.nodes.length, LIBRARY_KEY)).toBe(9);
});
