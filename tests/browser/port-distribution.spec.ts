import { expect, test, type Page } from '@playwright/test';
import { devicePorts } from '../../src/topology';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
const distributions = {
  left: ['left'], right: ['right'], top: ['top'], bottom: ['bottom'],
  vertical: ['left', 'right'], horizontal: ['top', 'bottom'], around: ['left', 'right', 'top', 'bottom'],
};
async function edit(page: Page) {
  await page.goto('/'); await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="sw-01"]').click();
}
const sideCounts = (page: Page) => page.locator('.port-editor-row [data-port-field="side"]').evaluateAll(selects => selects.reduce((counts, select) => {
  const side = (select as HTMLSelectElement).value; counts[side] = (counts[side] ?? 0) + 1; return counts;
}, {} as Record<string, number>));

test('端口排布：补齐 24/48 口后切换七种排布即时预览，整理沿用选项且取消不改文档', async ({ page }) => {
  await edit(page); const before = await snapshot(page);
  for (const count of [24, 48]) {
    await page.locator('[data-action="configure-ports"]').click();
    await page.locator(`[data-port-action="fill-${count}"]`).click();
    const ids = await page.locator('.port-editor-row').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.portId));
    await page.locator('[data-port-id="ge1"] [data-port-field="label"]').fill('保留业务 GE1');
    for (const [distribution, sides] of Object.entries(distributions)) {
      await page.locator('#port-distribution').selectOption(distribution);
      const expected = Object.fromEntries(sides.map(side => [side, count / sides.length]));
      expect(await sideCounts(page)).toEqual(expected);
      await page.locator('[data-port-action="balance"]').click(); expect(await sideCounts(page)).toEqual(expected);
      const preview = await page.locator('#port-layout-preview svg').evaluate(svg => {
        const box = svg.querySelector('rect')!, width = Number(box.getAttribute('width')), height = Number(box.getAttribute('height'));
        return [...svg.querySelectorAll('circle')].map(circle => { const x = Number(circle.getAttribute('cx')), y = Number(circle.getAttribute('cy')); return x === 0 ? 'left' : x === width ? 'right' : y === 0 ? 'top' : y === height ? 'bottom' : 'invalid'; });
      });
      expect(preview.reduce((counts, side) => { counts[side] = (counts[side] ?? 0) + 1; return counts; }, {} as Record<string, number>)).toEqual(expected);
      expect(await page.locator('.port-editor-row').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.portId))).toEqual(ids);
      await expect(page.locator('[data-port-id="ge1"] [data-port-field="label"]')).toHaveValue('保留业务 GE1');
      await expect(page.locator('[data-port-id="ge1"] [data-port-field="kind"]')).toBeDisabled();
      expect(await snapshot(page)).toEqual(before);
    }
    await page.locator('.modal-footer [data-action="close-modal"]').click(); expect(await snapshot(page)).toEqual(before);
  }
});

test('端口排布：先选再补齐、应用、撤销及刷新保留排布、端口 ID 和手工路径', async ({ page }) => {
  await edit(page); const before = await snapshot(page), original = devicePorts(before.nodes.find(node => node.id === 'sw-01')!.data);
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('#port-distribution').selectOption('horizontal'); await page.locator('[data-port-action="fill-24"]').click();
  expect(await sideCounts(page)).toEqual({ top: 12, bottom: 12 });
  await page.locator('[data-action="apply-ports"]').click(); const applied = await snapshot(page);
  const ports = applied.nodes.find(node => node.id === 'sw-01')!.data.ports!;
  expect(ports).toHaveLength(24); expect(ports.filter(port => port.side === 'top')).toHaveLength(12);
  for (const old of original) expect(ports.find(port => port.id === old.id)).toMatchObject({ id: old.id, kind: old.kind, label: old.label });
  expect(applied.edges).toEqual(before.edges); expect(applied.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(before.nodes.map(({ id, x, y }) => ({ id, x, y })));
  await expect(page.locator('.x6-node[data-cell-id="sw-01"] .x6-port')).toHaveCount(24);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await snapshot(page)).toEqual(applied);
  await page.locator('[data-action="save"]').click(); await page.reload(); expect(await snapshot(page)).toEqual(applied);
});

test('端口排布：模板连接点补齐后可重排，模板应用与撤销保留连线', async ({ page }) => {
  await edit(page); const before = await snapshot(page);
  await page.locator('[data-action="manage-templates"]').click();
  await page.locator('[data-template-id="switch"][data-template-command="edit"]').click(); await page.locator('.template-ports summary').click();
  await page.locator('[data-port-action="fill-24"]').click(); await page.locator('#port-distribution').selectOption('vertical');
  expect(await sideCounts(page)).toEqual({ left: 12, right: 12 });
  await page.locator('[data-action="create-template"]').click(); expect((await snapshot(page)).edges).toEqual(before.edges);
  const sides = await page.evaluate(() => window.stationPrototype.graph.getCellById('sw-01').getPorts().map(port => port.args?.x));
  expect(sides.filter(x => x === 0)).toHaveLength(12);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
});
