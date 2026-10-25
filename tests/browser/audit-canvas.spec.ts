import { expect, test, type Page } from '@playwright/test';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
async function edit(page: Page) {
  await page.goto('/');
  await page.locator('.mode-switch [data-action="edit"]').click();
}
async function pair(page: Page) {
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('[data-device-node="lnb-01"]').click({ modifiers: ['Control'] });
}

test('交互审计：节点置顶后复制粘贴保留副本之间的遮挡顺序', async ({ page }) => {
  await edit(page);
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('#layer-command').selectOption('front');
  const before = await snapshot(page);
  expect(before.order!.indexOf('ant-01')).toBeGreaterThan(before.order!.indexOf('lnb-01'));
  await pair(page);
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="paste"]').click();
  const after = await snapshot(page);
  const copies = after.nodes.filter(node => !before.nodes.some(old => old.id === node.id));
  const antenna = copies.find(node => node.data.kind === 'antenna')!, lnb = copies.find(node => node.data.kind === 'lnb')!;
  expect(after.order!.indexOf(antenna.id)).toBeGreaterThan(after.order!.indexOf(lnb.id));
  const order = await page.evaluate(({ a, b }) => ({ a: window.stationPrototype.graph.getCellById(a).getZIndex(), b: window.stationPrototype.graph.getCellById(b).getZIndex() }), { a: antenna.id, b: lnb.id });
  expect(order.a).toBeGreaterThan(order.b!);
  await page.locator('[data-action="undo"]').click();
  expect(await snapshot(page)).toEqual(before);
});

test('交互审计：筛掉链路后搜索定位应恢复链路可见性并同步筛选按钮', async ({ page }) => {
  await page.goto('/');
  const before = await snapshot(page);
  await page.locator('[data-filter="rf"]').click();
  const edge = page.locator('.x6-edge[data-cell-id="link-rx-rf"]');
  await expect(edge).toBeHidden();
  await page.getByRole('searchbox', { name: '查找图形' }).fill('link-rx-rf');
  await page.keyboard.press('Enter');
  await expect(edge).toBeVisible();
  await expect(page.locator('[data-filter="rf"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toEqual(before);
});

test('交互审计：混合图面与节点复制保留层次，撤销重做和刷新一致', async ({ page }) => {
  await edit(page);
  await page.locator('[data-action="add-note"]').click();
  await page.locator('#diagram-title').fill('设备下方的注释');
  await page.locator('[data-action="apply-diagram"]').click();
  const note = (await snapshot(page)).elements![0];
  await page.locator('#layer-command').selectOption('back');
  await page.locator('[data-device-node="ant-01"]').click({ modifiers: ['Control'] });
  await expect(page.locator('#selection-count')).toContainText('1 节点 / 1 图面');
  const before = await snapshot(page);
  await page.locator('[data-action="duplicate"]').click();
  const after = await snapshot(page), copiedNote = after.elements!.find(element => element.id !== note.id)!;
  const copiedNode = after.nodes.find(node => !before.nodes.some(old => old.id === node.id))!;
  expect(after.order!.indexOf(copiedNote.id)).toBeLessThan(after.order!.indexOf(copiedNode.id));
  expect(copiedNote.x).toBe(note.x + 40); expect(copiedNote.y).toBe(note.y + 40);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(after);
  await page.locator('[data-action="save"]').click(); await page.reload(); expect(await snapshot(page)).toEqual(after);
});

test('交互审计：同时选择区域及成员只移动复制一次，解散及撤销保留连接', async ({ page }) => {
  await edit(page); await pair(page);
  await page.locator('[data-action="add-group"]').click();
  const region = (await snapshot(page)).elements![0];
  await page.locator('[data-device-node="ant-01"]').click({ modifiers: ['Control'] });
  await expect(page.locator('#selection-count')).toContainText('1 节点 / 1 图面');
  const before = await snapshot(page);
  await page.keyboard.press('ArrowRight');
  const moved = await snapshot(page);
  for (const id of ['ant-01', 'lnb-01']) expect(moved.nodes.find(node => node.id === id)!.x).toBe(before.nodes.find(node => node.id === id)!.x + 10);
  expect(moved.elements![0].x).toBe(region.x + 10);
  expect(moved.edges.find(edge => edge.id === 'link-rx-rf')!.vertices).toEqual(before.edges.find(edge => edge.id === 'link-rx-rf')!.vertices.map(point => ({ x: point.x + 10, y: point.y })));
  await page.locator('[data-action="copy"]').click(); await page.locator('[data-action="paste"]').click();
  const pasted = await snapshot(page);
  expect(pasted.nodes).toHaveLength(10); expect(pasted.elements).toHaveLength(2); expect(pasted.edges).toHaveLength(9);
  expect(pasted.elements![1].kind === 'group' && pasted.elements![1].members).toHaveLength(2);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(moved);
  await page.locator(`[data-diagram-element="${region.id}"] .diagram-drag-header`).click({ position: { x: 60, y: 15 } });
  await page.locator('.diagram-actions [data-action="delete"]').click();
  const dissolved = await snapshot(page); expect(dissolved.nodes).toEqual(moved.nodes); expect(dissolved.edges).toEqual(moved.edges); expect(dissolved.elements).toEqual([]);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(moved);
});

test('交互审计：锁定区域仍可修改标题，成员快捷键与查看模式均不改布局', async ({ page }) => {
  await edit(page); await pair(page);
  await page.locator('[data-action="add-group"]').click();
  await page.locator('[data-action="toggle-diagram-lock"]').click();
  const before = await snapshot(page);
  await page.locator('#diagram-title').fill('锁定的接收区域'); await page.locator('[data-action="apply-diagram"]').click();
  const titled = await snapshot(page);
  expect(titled.nodes).toEqual(before.nodes); expect(titled.edges).toEqual(before.edges);
  expect(titled.elements![0]).toMatchObject({ title: '锁定的接收区域', locked: true });
  await page.locator('[data-device-node="ant-01"]').click();
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Backspace'); expect(await snapshot(page)).toEqual(titled);
  await page.locator('.mode-switch [data-action="monitor"]').click();
  for (const key of ['ArrowRight', 'Delete', 'Control+z', 'Control+v', 'Control+d']) await page.keyboard.press(key);
  expect(await snapshot(page)).toEqual(titled);
});

test('交互审计：长时间拖动手工拐点仍是一次撤销操作', async ({ page }) => {
  await edit(page);
  await page.getByRole('searchbox', { name: '查找图形' }).fill('link-rx-rf'); await page.keyboard.press('Enter');
  const before = await snapshot(page);
  const handle = page.locator('.x6-edge-tool-vertices circle').first(), box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(x - 12 * step, y + 9 * step, { steps: 3 });
    await page.waitForTimeout(350);
  }
  await page.mouse.up();
  const moved = await snapshot(page); expect(moved.edges).not.toEqual(before.edges);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(moved);
});

test('交互审计：线段调整、添加和删除拐点均可独立撤销且不吞后续操作', async ({ page }) => {
  await edit(page);
  const selectLink = async () => { await page.getByRole('searchbox', { name: '查找图形' }).fill('link-rx-rf'); await page.keyboard.press('Enter'); };
  await selectLink();
  const before = await snapshot(page), segment = page.locator('.x6-edge-tool-segment').first(), box = (await segment.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let step = 1; step <= 3; step++) { await page.mouse.move(x + step * 15, y + step * 12, { steps: 3 }); await page.waitForTimeout(350); }
  await page.mouse.up();
  const segmented = await snapshot(page); expect(segmented.edges).not.toEqual(before.edges);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await selectLink();
  const point = await page.locator('.x6-edge-tool-vertex-path').evaluate((element: SVGPathElement) => {
    const p = element.getPointAtLength(element.getTotalLength() * .65), screen = new DOMPoint(p.x, p.y).matrixTransform(element.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  for (let step = 1; step <= 3; step++) { await page.mouse.move(point.x + step * 15, point.y + step * 12, { steps: 3 }); await page.waitForTimeout(350); }
  await page.mouse.up();
  const added = await snapshot(page); expect(added.edges.find(edge => edge.id === 'link-rx-rf')!.vertices.length).toBeGreaterThan(before.edges.find(edge => edge.id === 'link-rx-rf')!.vertices.length);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(added);
  await selectLink(); await page.locator('.x6-edge-tool-vertex').first().dblclick();
  const deleted = await snapshot(page); expect(deleted.edges).not.toEqual(added.edges);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(added);
  await page.locator('[data-action="add-note"]').click();
  const withNote = await snapshot(page); expect(withNote.elements).toHaveLength(1);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(added);
});
