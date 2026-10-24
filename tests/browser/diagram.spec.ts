import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sampleDocument } from '../../src/document';
import { addDiagramElement } from '../../src/diagram-commands';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const edit = (page: Page) => page.locator('.mode-switch [data-action="edit"]').click();
const select = (page: Page, ids: string[]) => page.evaluate((ids) => window.stationPrototype.graph.resetSelection(ids), ids);
async function group(page: Page) {
  await select(page, ['ant-01', 'lnb-01']); await page.locator('[data-action="add-group"]').click();
  const region = (await snapshot(page)).elements!.at(-1)!;
  await expect(page.locator(`[data-diagram-element="${region.id}"]`)).toBeVisible(); return region;
}
async function importDocument(page: Page, document: unknown) {
  await page.locator('#import-file').setInputFiles({ name: 'diagram.topology.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('.device-card')).toHaveCount(8); await edit(page); });

test('S06 区域标题拖动带走成员和内部拐点，一步撤销恢复，解散保留节点', async ({ page }) => {
  const region = await group(page), before = await snapshot(page);
  await expect(page.locator('#stat-total')).toHaveText('8');
  const header = page.locator(`[data-diagram-element="${region.id}"] .diagram-drag-header`), bounds = (await header.boundingBox())!;
  await page.mouse.move(bounds.x + 60, bounds.y + 14); await page.mouse.down();
  await page.mouse.move(bounds.x + 105, bounds.y + 45, { steps: 8 }); await page.mouse.up();
  const moved = await snapshot(page), newRegion = moved.elements!.find((e) => e.id === region.id)!;
  const dx = newRegion.x - region.x, dy = newRegion.y - region.y; expect(dx).not.toBe(0);
  for (const id of ['ant-01', 'lnb-01']) {
    const old = before.nodes.find((n) => n.id === id)!, next = moved.nodes.find((n) => n.id === id)!;
    expect(next.x).toBeCloseTo(old.x + dx); expect(next.y).toBeCloseTo(old.y + dy);
  }
  const internal = before.edges.find((e) => e.source.cell === 'ant-01' && e.target.cell === 'lnb-01')!;
  expect(moved.edges.find((e) => e.id === internal.id)!.vertices).toEqual(internal.vertices.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  const outside = before.edges.find((e) => e.source.cell === 'lnb-01' && e.target.cell === 'bb-rx')!;
  expect(moved.edges.find((e) => e.id === outside.id)!.vertices).toEqual(outside.vertices);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await select(page, [region.id]); await page.locator('.diagram-actions [data-action="delete"]').click();
  const dissolved = await snapshot(page); expect(dissolved.nodes).toEqual(before.nodes); expect(dissolved.edges).toEqual(before.edges);
  await expect(page.locator('.diagram-element')).toHaveCount(0);
});

test('S06 分组缩放只改边框，锁定区域保护成员，成员单独锁定阻止整组移动', async ({ page }) => {
  const region = await group(page), before = await snapshot(page);
  const handle = page.locator('.x6-widget-transform [data-position="bottom-right"]'); await expect(handle).toBeVisible();
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + 50, bounds.y + 35, { steps: 6 }); await page.mouse.up();
  const resized = await snapshot(page); expect(resized.nodes).toEqual(before.nodes); expect(resized.edges).toEqual(before.edges);
  expect(resized.elements![0].width).toBeGreaterThan(before.elements![0].width);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await select(page, [region.id]); await page.locator('[data-action="toggle-diagram-lock"]').click();
  const locked = await snapshot(page); await select(page, ['ant-01']); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Delete');
  expect(await snapshot(page)).toEqual(locked);
  await select(page, [region.id]); await page.locator('[data-action="toggle-diagram-lock"]').click();
  await select(page, ['ant-01']); await page.locator('[data-action="lock-selected"]').click();
  await select(page, [region.id]); const memberLocked = await snapshot(page); await page.keyboard.press('ArrowRight');
  expect(await snapshot(page)).toEqual(memberLocked); await expect(page.locator('#toast')).toContainText('跳过');
});

test('S06 成员显式配置及节点归属，适应边界不移动节点，跨图复制保留独立分组', async ({ page }) => {
  await page.locator('[data-action="add-group"]').click();
  const region = (await snapshot(page)).elements![0];
  await page.locator('#diagram-title').fill('网络设备区');
  await page.locator('input[name="group-member"][value="sw-01"]').check();
  await page.locator('input[name="group-member"][value="srv-01"]').check();
  const beforeNodes = (await snapshot(page)).nodes;
  await page.locator('[data-action="apply-diagram"]').click(); await page.locator('[data-action="fit-group"]').click();
  expect((await snapshot(page)).nodes).toEqual(beforeNodes);
  await select(page, ['srv-01']); await expect(page.locator('#node-group')).toHaveValue(region.id);
  await page.locator('#node-group').selectOption(''); await page.locator('[data-action="apply-device"]').click();
  expect((await snapshot(page)).elements![0]).toMatchObject({ members: ['sw-01'] });
  await select(page, [region.id]); await page.locator('[data-action="copy"]').click();
  await page.locator('.heading-actions [data-action="library"]').click(); await page.locator('[data-action="new-document"]').click();
  await page.locator('#new-document-name').fill('分组副本图'); await page.locator('[data-action="create-document"]').click();
  await page.locator('[data-action="paste"]').click();
  const pasted = await snapshot(page); expect(pasted.nodes).toHaveLength(1); expect(pasted.elements).toHaveLength(1);
  expect(pasted.elements![0].id).not.toBe(region.id); expect(pasted.elements![0]).toMatchObject({ members: [pasted.nodes[0].id] });
});

test('S06 注释与图例可编辑且不采样，层次和图面通过刷新、JSON 与独立展示保留', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('[data-action="add-note"]').click(); const note = (await snapshot(page)).elements![0];
  await page.locator('#diagram-title').fill('运行说明'); await page.locator('#diagram-text').fill('<script>alert(1)</script>\n切换备机前先确认链路');
  await page.locator('#diagram-width').fill('1'); const before = await snapshot(page); await page.locator('[data-action="apply-diagram"]').click();
  await expect(page.locator('#diagram-width-error')).toBeVisible(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#diagram-width').fill('360'); await page.locator('[data-action="apply-diagram"]').click();
  await expect(page.locator(`[data-diagram-element="${note.id}"]`)).toContainText('<script>alert(1)</script>');
  await expect(page.locator(`[data-diagram-element="${note.id}"] script`)).toHaveCount(0);
  await page.locator('#layer-command').selectOption('back'); expect((await snapshot(page)).order![0]).toBe(note.id);
  await page.locator('[data-action="add-legend"]').click();
  await expect(page.locator('.diagram-legend')).toContainText('以太网');
  await expect(page.locator('#stat-total')).toHaveText('8');
  await page.evaluate((id) => { const node = window.stationPrototype.graph.getCellById(id); if (node.isNode()) node.position(-380, -150); }, note.id);
  await page.locator('[data-action="save"]').click(); const expected = await snapshot(page);
  await page.reload(); expect(await snapshot(page)).toEqual(expected);
  await expect(page.locator('.x6-widget-transform')).toHaveCount(0);
  const id = await page.locator('body[data-document-id]').getAttribute('data-document-id');
  await page.goto(`/viewer.html?document=${id}`); await expect(page.locator('.device-card')).toHaveCount(8); await expect(page.locator('.diagram-element')).toHaveCount(2);
  const beforeCallback = await page.locator('#viewer-selection').textContent();
  await page.locator('.diagram-note').click(); await expect(page.locator('#viewer-selection')).toHaveText(beforeCallback!);
  expect(await page.evaluate(() => window.topologyViewer.getDefinition().version)).toBe(3); expect(errors).toEqual([]);
});

test('S06 纯注释图可导出 PNG、SVG 与离线 HTML，展示不需要业务节点', async ({ page, context }, testInfo) => {
  const doc = addDiagramElement(sampleDocument('general', '纯注释图'), 'note', new Set(), { x: -150, y: 80 }).document;
  if (doc.topology.elements![0].kind === 'note') doc.topology.elements![0].text = '请核对备用链路\n维护时间：周日';
  await importDocument(page, doc); await expect(page.locator('.device-card')).toHaveCount(0); await expect(page.locator('.diagram-note')).toHaveCount(1);
  await page.locator('[data-action="export-options"]').click();
  for (const format of ['json', 'svg', 'png', 'html']) {
    const promise = page.waitForEvent('download'); await page.locator(`[data-action="${format === 'json' ? 'export' : `export-${format}`}"]`).click();
    const download = await promise, path = testInfo.outputPath(`diagram.${format}`); await download.saveAs(path);
    if (format === 'json') { const value = JSON.parse(await readFile(path, 'utf8')); expect(value.version).toBe(3); expect(value.topology.elements).toEqual(doc.topology.elements); }
    if (format === 'svg') { const svg = await readFile(path, 'utf8'); expect(svg).toContain('请核对备用链路'); expect(svg).not.toContain('foreignObject'); }
    if (format === 'png') expect((await readFile(path)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (format === 'html') {
      await context.setOffline(true); await page.goto(pathToFileURL(path).href);
      await expect(page.locator('.diagram-note')).toHaveCount(1); await expect(page.locator('.diagram-note')).toContainText('维护时间：周日');
      await expect(page.locator('#error')).toBeHidden();
    }
  }
});

test('S06 新增节点、置顶置底与保存顺序一致，层次操作可一步撤销', async ({ page }) => {
  await page.locator('[data-action="add-note"]').click();
  const note = (await snapshot(page)).elements![0];
  await page.locator('[data-device="module"]').click();
  const withNode = await snapshot(page), added = withNode.nodes.at(-1)!;
  const z = (id: string) => page.evaluate((id) => window.stationPrototype.graph.getCellById(id).getZIndex(), id);
  expect(await z(added.id)).toBeGreaterThan((await z(note.id))!);
  expect(withNode.order!.at(-1)).toBe(added.id);
  await select(page, [note.id]); await page.locator('#layer-command').selectOption('front');
  const before = await snapshot(page); expect(before.order!.at(-1)).toBe(note.id);
  expect(await z(note.id)).toBeGreaterThan((await z(added.id))!);
  await select(page, [added.id]); await page.locator('#layer-command').selectOption('back');
  const after = await snapshot(page); expect(after.order![0]).toBe(added.id);
  expect(await z(added.id)).toBeLessThan((await z(note.id))!);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(after);
});
