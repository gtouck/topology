import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const snapshot = (page: Page) => page.evaluate(() => window.stationPrototype.snapshot());
async function edit(page: Page) {
  await page.goto('/');
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="ant-01"]').click();
}

test('表单审计：端口配置未修改直接应用保留原端点位置，且不产生撤销步骤', async ({ page }) => {
  await edit(page); const before = await snapshot(page);
  const ports = page.locator('.x6-node[data-cell-id="ant-01"] .x6-port');
  const positions = await ports.evaluateAll(elements => elements.map(element => element.getAttribute('transform')));
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('[data-action="apply-ports"]').click();
  expect(await snapshot(page)).toEqual(before);
  expect(await ports.evaluateAll(elements => elements.map(element => element.getAttribute('transform')))).toEqual(positions);
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();
});

test('表单审计：应用端口配置保留未应用的名称、参数和绑定输入，分开提交与撤销', async ({ page }) => {
  await edit(page); const before = await snapshot(page);
  await page.locator('#device-title').fill('尚未应用的天线名称');
  await page.locator('#device-address').fill('10.20.30.40');
  await page.locator('#device-status').selectOption('warning');
  await page.locator('input[name="visible-metric"][value="azimuth"]').uncheck();
  await page.locator('.binding-fields summary').click();
  await page.locator('#binding-source').fill('pending.antenna');
  await page.locator('[data-binding-action="add"]').click();
  await page.getByLabel('业务状态值', { exact: true }).fill('FAULT');
  await page.getByLabel('映射设备状态', { exact: true }).selectOption('warning');
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('[data-port-action="add-one"]').click();
  await page.locator('[data-action="apply-ports"]').click();
  await expect(page.locator('#device-title')).toHaveValue('尚未应用的天线名称');
  await expect(page.locator('#device-address')).toHaveValue('10.20.30.40');
  await expect(page.locator('#device-status')).toHaveValue('warning');
  await expect(page.locator('input[name="visible-metric"][value="azimuth"]')).not.toBeChecked();
  await expect(page.locator('#binding-source')).toHaveValue('pending.antenna');
  await expect(page.getByLabel('业务状态值', { exact: true })).toHaveValue('FAULT');
  await expect(page.getByLabel('映射设备状态', { exact: true })).toHaveValue('warning');
  await expect(page.locator('[data-property-section="ports"] summary')).toContainText('4 个');
  const portsApplied = await snapshot(page);
  expect(portsApplied.nodes[0].data.title).toBe(before.nodes[0].data.title);
  expect(portsApplied.nodes[0].data.binding).toEqual(before.nodes[0].data.binding);
  expect(portsApplied.edges).toEqual(before.edges);
  await page.locator('[data-action="apply-device"]').click();
  expect((await snapshot(page)).nodes[0].data).toMatchObject({ title: '尚未应用的天线名称', address: '10.20.30.40', status: 'warning', visibleMetrics: ['elevation'], binding: { source: 'pending.antenna', statusMap: { FAULT: 'warning' } } });
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(portsApplied);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
});

test('表单审计：模板端口错误展开正确分区并聚焦无效端口，修正后可应用', async ({ page }) => {
  await edit(page); const before = await snapshot(page);
  await page.locator('[data-action="manage-templates"]').click();
  await page.locator('[data-template-id="antenna"][data-template-command="edit"]').click();
  await page.locator('#template-name').fill('保留模板名称输入');
  await page.locator('.template-ports summary').click();
  await page.getByLabel('端口名称', { exact: true }).first().fill('');
  await page.locator('.template-ports summary').click();
  await page.locator('[data-action="create-template"]').click();
  await expect(page.locator('.template-ports')).toHaveAttribute('open', '');
  await expect(page.getByLabel('端口名称', { exact: true }).first()).toBeFocused();
  await expect(page.locator('#port-label-0-error')).toContainText('端口名称');
  const fieldBox = (await page.getByLabel('端口名称', { exact: true }).first().boundingBox())!;
  const errorBox = (await page.locator('#port-label-0-error').boundingBox())!;
  const footerBox = (await page.locator('.modal-footer').boundingBox())!;
  expect(fieldBox.y + fieldBox.height).toBeLessThan(footerBox.y);
  expect(errorBox.y + errorBox.height).toBeLessThan(footerBox.y);
  expect(await page.getByLabel('端口名称', { exact: true }).first().evaluate(input => {
    const rect = input.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
  })).toBe(true);
  await expect(page.locator('#template-metrics-error')).toHaveCount(0);
  await expect(page.locator('#template-name')).toHaveValue('保留模板名称输入');
  expect(await snapshot(page)).toEqual(before);
  await page.getByLabel('端口名称', { exact: true }).first().fill('RF 接收');
  await page.locator('[data-action="create-template"]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
});

test('表单审计：端口排布重开显示实际设置，追加沿用当前侧，自定义不会被误标为均分', async ({ page }) => {
  await edit(page);
  await page.locator('[data-action="configure-ports"]').click();
  await page.locator('#port-distribution').selectOption('left');
  await page.locator('[data-action="apply-ports"]').click();
  await page.locator('[data-action="configure-ports"]').click();
  await expect(page.locator('#port-distribution')).toHaveValue('left');
  await page.locator('[data-port-action="add-one"]').click();
  expect(await page.locator('[data-port-field="side"]').evaluateAll(inputs => inputs.map(input => (input as HTMLSelectElement).value))).toEqual(['left', 'left', 'left', 'left']);
  await page.locator('[data-port-field="side"]').last().selectOption('top');
  await expect(page.locator('#port-distribution')).toHaveValue('custom');
  await page.locator('[data-port-action="add-one"]').click();
  expect(await page.locator('[data-port-field="side"]').evaluateAll(inputs => inputs.map(input => (input as HTMLSelectElement).value))).toEqual(['left', 'left', 'left', 'top', 'top']);
  await page.locator('[data-action="apply-ports"]').click();
  await page.locator('[data-action="save"]').click(); await page.reload();
  await page.locator('.mode-switch [data-action="edit"]').click(); await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('[data-action="configure-ports"]').click();
  await expect(page.locator('#port-distribution')).toHaveValue('custom');
  await expect(page.locator('[data-port-action="balance"]')).toBeDisabled();
  await page.locator('#port-distribution').selectOption('vertical');
  await expect(page.locator('[data-port-action="balance"]')).toBeEnabled();
  await page.locator('[data-port-action="balance"]').click();
  expect(await page.locator('[data-port-field="side"]').evaluateAll(inputs => inputs.map(input => (input as HTMLSelectElement).value))).toEqual(['left', 'right', 'left', 'right', 'left']);
});

test('表单审计：空端口选择上下均分后连续逐个添加，保持用户选择而不收敛到单边', async ({ page }) => {
  await edit(page); await page.locator('[data-action="new-template"]').click();
  await page.locator('.template-ports summary').click();
  while (await page.getByLabel('删除端口', { exact: true }).count()) await page.getByLabel('删除端口', { exact: true }).first().click();
  await page.locator('#port-distribution').selectOption('horizontal');
  for (let count = 1; count <= 4; count++) {
    await page.locator('[data-port-action="add-one"]').click();
    await expect(page.locator('#port-distribution')).toHaveValue('horizontal');
  }
  expect(await page.locator('[data-port-field="side"]').evaluateAll(inputs => inputs.map(input => (input as HTMLSelectElement).value))).toEqual(['top', 'bottom', 'top', 'bottom']);
});

test('表单审计：仅改端口名称保持原端点与预览，保存、SVG和独立展示走线一致', async ({ page }) => {
  await edit(page); await page.locator('[data-action="pause"]').click();
  const before = await snapshot(page);
  const positions = () => page.locator('.x6-node[data-cell-id="ant-01"] .x6-port').evaluateAll(elements => elements.map(element => element.getAttribute('transform')));
  const original = await positions();
  const exported = async (format: 'svg' | 'json') => {
    await page.locator('[data-action="export-options"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator(`[data-action="${format === 'json' ? 'export' : 'export-svg'}"]`).click();
    const file = await readFile((await (await downloading).path())!, 'utf8');
    await page.locator('.modal-footer [data-action="close-modal"]').click(); return file;
  };
  const paths = (svg: string) => page.evaluate(source => [...new DOMParser().parseFromString(source, 'image/svg+xml').querySelectorAll('[data-edge-id] path')].map(path => path.getAttribute('d')), svg);
  const originalPaths = await paths(await exported('svg'));
  await page.locator('[data-action="configure-ports"]').click();
  const preview = () => page.locator('#port-layout-preview circle').evaluateAll(elements => elements.map(element => [Number(element.getAttribute('cx')), Number(element.getAttribute('cy'))]));
  expect(await preview()).toEqual([[210, 42], [210, 99], [105, 132]]);
  await page.getByLabel('端口名称', { exact: true }).first().fill('RF 接收改名');
  expect(await preview()).toEqual([[210, 42], [210, 99], [105, 132]]);
  await page.locator('[data-action="apply-ports"]').click();
  expect(await positions()).toEqual(original); expect((await snapshot(page)).edges).toEqual(before.edges);
  await page.locator('[data-action="undo"]').click(); expect(await snapshot(page)).toEqual(before);
  await page.locator('[data-action="redo"]').click(); expect(await positions()).toEqual(original);
  await page.locator('[data-action="save"]').click(); await page.reload();
  expect(await positions()).toEqual(original);
  expect(await paths(await exported('svg'))).toEqual(originalPaths);
  const definition = await exported('json');
  await page.goto('/viewer.html');
  await page.locator('#viewer-file').setInputFiles({ name: 'renamed-port.topology.json', mimeType: 'application/json', buffer: Buffer.from(definition) });
  await expect(page.locator('[data-device-node="ant-01"]')).toBeVisible();
  expect(await positions()).toEqual(original);
});

test('表单审计：模板端口仅改名称保留偏移，明确整理才均分连接点', async ({ page }) => {
  await edit(page); const before = await snapshot(page);
  const positions = () => page.locator('.x6-node[data-cell-id="ant-01"] .x6-port').evaluateAll(elements => elements.map(element => element.getAttribute('transform')));
  const original = await positions();
  const template = async () => {
    await page.locator('[data-action="manage-templates"]').click();
    await page.locator('[data-template-id="antenna"][data-template-command="edit"]').click();
    await page.locator('.template-ports summary').click();
  };
  await template(); await page.getByLabel('端口名称', { exact: true }).first().fill('模板 RF 接收');
  await page.locator('[data-action="create-template"]').click();
  expect(await positions()).toEqual(original); expect((await snapshot(page)).edges).toEqual(before.edges);
  await template(); await page.locator('#port-distribution').selectOption('right');
  await page.locator('[data-action="create-template"]').click();
  expect(await positions()).not.toEqual(original);
  await page.locator('[data-action="undo"]').click(); expect(await positions()).toEqual(original);
});
