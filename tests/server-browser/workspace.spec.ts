import { expect, test, webkit, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { sampleDocument, type TopologyDocument } from '../../src/document';
import { LIBRARY_KEY } from '../../src/library';
import { WorkspaceStore, type Workspace } from '../../src/workspace';
import type { WorkspaceCommand, WorkspaceResponse } from '../../shared/api';

const origin = 'http://127.0.0.1:5183';
const credentials = { username: 'browser-admin', password: 'only-for-isolated-browser-tests' };
const headers = { Origin: origin };
let seed: TopologyDocument;

async function state(request: APIRequestContext): Promise<WorkspaceResponse> {
  const response = await request.get('/api/workspace'); expect(response.ok()).toBe(true); return response.json();
}
async function command(request: APIRequestContext, value: WorkspaceCommand): Promise<WorkspaceResponse> {
  const current = await state(request);
  const response = await request.post('/api/workspace/commands', { headers, data: { expectedRevision: current.revision, requestId: randomUUID(), command: value } });
  expect(response.ok(), await response.text()).toBe(true); return response.json();
}
async function login(page: Page, url = '/') {
  await page.goto(url); await expect(page.locator('#server-login-form')).toBeVisible();
  await page.locator('#server-username').fill(credentials.username); await page.locator('#server-password').fill(credentials.password);
  await page.locator('#server-login-form button[type="submit"]').click(); await expect(page.locator('#server-login-form')).toHaveCount(0);
  if (!url.startsWith('/viewer')) await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', seed.id);
}
async function rename(page: Page, title: string) {
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('#device-title').fill(title); await page.locator('[data-action="apply-device"]').click();
}
function title(workspace: Workspace) {
  const document = workspace.documents.find(doc => doc.id === seed.id)!;
  return document.topology.nodes[0].data.title;
}

test.beforeEach(async ({ request }, testInfo) => {
  const response = await request.post('/api/login', { headers, data: credentials }); expect(response.ok()).toBe(true);
  seed = sampleDocument('ground-station'); seed.name = `服务器测试 ${testInfo.project.name}`;
  await command(request, { type: 'updateLibrary', library: { version: 1, activeId: seed.id, documents: [seed] } });
});

test('S14 未登录接口拒绝访问，登录错误可重试，会话使用 HttpOnly Cookie', async ({ page, context }) => {
  const response = await context.request.get('/api/workspace'); expect(response.status()).toBe(401);
  await page.goto('/'); await expect(page.locator('#server-login-form')).toBeVisible();
  await page.locator('#server-username').fill(credentials.username); await page.locator('#server-password').fill('wrong-password-for-test');
  await page.locator('#server-login-form button[type="submit"]').click(); await expect(page.locator('#server-login-error')).not.toBeEmpty();
  await page.locator('#server-password').fill(credentials.password); await page.locator('#server-login-form button[type="submit"]').click();
  await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', seed.id);
  expect((await context.cookies()).some(cookie => cookie.httpOnly && cookie.sameSite !== 'None')).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), LIBRARY_KEY)).toBeNull();
  const session = await context.request.get('/api/session'); expect(await session.json()).toMatchObject({ authenticated: true, username: credentials.username });
});

test('S14 编辑保存经服务器确认后，全新浏览器上下文能够读取', async ({ page, browser, request }) => {
  await login(page); await rename(page, '跨浏览器已保存设备'); await page.locator('[data-action="save"]').click();
  await expect.poll(async () => title((await state(request)).workspace)).toBe('跨浏览器已保存设备');
  await expect(page.locator('#save-status')).toContainText('服务器');
  const otherContext = await browser.newContext({ baseURL: origin });
  try {
    const other = await otherContext.newPage(); await login(other);
    await expect(other.locator('[data-device-node="ant-01"]')).toContainText('跨浏览器已保存设备');
    expect(await other.evaluate(key => localStorage.getItem(key), LIBRARY_KEY)).toBeNull();
  } finally { await otherContext.close(); }
});

test('S14 两个编辑器竞争保存返回冲突，并保留落后编辑器的画布和本机副本', async ({ page, browser, request }) => {
  await login(page);
  const otherContext = await browser.newContext({ baseURL: origin });
  try {
    const other = await otherContext.newPage(); await login(other);
    await rename(page, '服务器保留的版本'); await page.locator('[data-action="save"]').click();
    await expect.poll(async () => title((await state(request)).workspace)).toBe('服务器保留的版本');
    const rejected = other.waitForResponse(response => response.url().endsWith('/api/workspace/commands') && response.status() === 409);
    await rename(other, '冲突时不能丢掉的修改'); await other.locator('[data-action="save"]').click(); await rejected;
    await expect(other.locator('#draft-notice')).toBeVisible();
    await expect(other.locator('[data-device-node="ant-01"]')).toContainText('冲突时不能丢掉的修改');
    expect(title((await state(request)).workspace)).toBe('服务器保留的版本');
    expect(await other.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('topology-server-recovery-v1:')).map(key => localStorage.getItem(key)).join(''))).toContain('冲突时不能丢掉的修改');
  } finally { await otherContext.close(); }
});

test('S14 网络保存失败后刷新仍可把本机修改恢复为新图', async ({ page, request }) => {
  await login(page); const before = title((await state(request)).workspace);
  await page.route('**/api/workspace/commands', route => route.abort('failed'));
  await rename(page, '断网后要恢复的设备'); await page.locator('[data-action="save"]').click();
  await expect(page.locator('#draft-notice')).toBeVisible();
  expect(title((await state(request)).workspace)).toBe(before);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('topology-server-recovery-v1:')).map(key => localStorage.getItem(key)).join(''))).toContain('断网后要恢复的设备');
  await page.unroute('**/api/workspace/commands');
  page.on('dialog', dialog => { void dialog.accept(); }); await page.reload();
  await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', seed.id);
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText(before);
  await page.locator('.topbar [data-action="server-storage"]').click(); await page.locator('[data-recovery-action="copy"]').first().click();
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText('断网后要恢复的设备');
  const current = (await state(request)).workspace;
  expect(title(current)).toBe(before);
  expect(current.documents.some(doc => doc.id !== seed.id && doc.topology.nodes[0]?.data.title === '断网后要恢复的设备')).toBe(true);
});

test('S14 慢响应期间的新编辑不被旧确认覆盖，后续自动保存最新画布', async ({ page, request }) => {
  await login(page);
  let release: (() => void) | undefined; let pending = false;
  await page.route('**/api/workspace/commands', async route => {
    if (!pending) { pending = true; await new Promise<void>(resolve => { release = resolve; }); }
    await route.continue();
  });
  await rename(page, '第一份等待确认的修改'); await page.locator('[data-action="save"]').click();
  await expect.poll(() => pending).toBe(true);
  await rename(page, '保存期间继续输入的新修改'); release!();
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText('保存期间继续输入的新修改');
  await expect.poll(async () => {
    const workspace = (await state(request)).workspace;
    return (workspace.editing.drafts.find(draft => draft.document.id === seed.id)?.document ?? workspace.documents.find(doc => doc.id === seed.id)!).topology.nodes[0].data.title;
  }).toBe('保存期间继续输入的新修改');
});

test('S14 保存未确认时撤销回旧内容并切图，也会同步最终所见的撤销结果', async ({ page, request }) => {
  const second = sampleDocument('satellite'); second.name = '等待切换的另一张图';
  await command(request, { type: 'updateLibrary', library: { version: 1, activeId: seed.id, documents: [seed, second] } });
  await login(page); const originalTitle = seed.topology.nodes[0].data.title;
  let release: (() => void) | undefined; let pending = false;
  await page.route('**/api/workspace/commands', async route => {
    if (!pending) { pending = true; await new Promise<void>(resolve => { release = resolve; }); }
    await route.continue();
  });
  await rename(page, '随后被撤销的待确认内容'); await page.locator('[data-action="save"]').click();
  await expect.poll(() => pending).toBe(true);
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText(originalTitle);
  // Opening the library must flush the undo even though it matches the older ACK.
  await page.locator('.heading-actions [data-action="library"]').click(); release!();
  await page.locator(`[data-document-action="open"][data-document-id="${second.id}"]`).click();
  await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', second.id);
  const current = (await state(request)).workspace;
  const effective = current.editing.drafts.find(draft => draft.document.id === seed.id)?.document ?? current.documents.find(doc => doc.id === seed.id)!;
  expect(effective.topology.nodes[0].data.title).toBe(originalTitle);
  await page.locator('.heading-actions [data-action="library"]').click();
  await page.locator(`[data-document-action="open"][data-document-id="${seed.id}"]`).click();
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText(originalTitle);
});

test('S14 删除已提交但响应丢失时，重试切换剩余图并保留原图恢复副本', async ({ page, request }) => {
  const remaining = sampleDocument('satellite'); remaining.name = '删除后保留的拓扑';
  await command(request, { type: 'updateLibrary', library: { version: 1, activeId: seed.id, documents: [seed, remaining] } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page); let discardedResponse = false;
  await page.route('**/api/workspace/commands', async route => {
    const body = route.request().postDataJSON();
    if (!discardedResponse && body.command.type === 'updateLibrary' && !body.command.library.documents.some((doc: TopologyDocument) => doc.id === seed.id)) {
      discardedResponse = true;
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      // The database commit succeeded, while the editing page receives no ACK.
      await route.abort('failed'); return;
    }
    await route.continue();
  });
  await page.locator('.heading-actions [data-action="library"]').click();
  await page.locator(`[data-document-action="delete"][data-document-id="${seed.id}"]`).click();
  await page.locator('[data-document-action="confirm-delete"]').click();
  await expect(page.locator('#draft-notice')).toBeVisible(); expect(discardedResponse).toBe(true);
  expect((await state(request)).workspace.documents.map(doc => doc.id)).toEqual([remaining.id]);
  await page.locator('.modal-footer [data-action="close-modal"]').click();
  await page.locator('[data-action="retry-draft"]').click();
  await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', remaining.id);
  await expect(page.locator('#draft-notice')).toBeHidden(); await expect(page.locator('.device-card')).toHaveCount(4);
  const copies = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('topology-server-recovery-v1:')).map(key => JSON.parse(localStorage.getItem(key)!)));
  expect(copies.some(copy => copy.document.id === seed.id && copy.document.topology.nodes[0].data.title === seed.topology.nodes[0].data.title)).toBe(true);
  expect((await state(request)).workspace.documents.map(doc => doc.id)).toEqual([remaining.id]); expect(errors).toEqual([]);
});

test('S14 子图导航等待确认期间屏蔽编辑快捷键，保留父图所见内容', async ({ page, request }) => {
  const child = sampleDocument('datacenter'); child.name = '慢保存后的子图';
  seed.topology.nodes[0].data.childTopologyId = child.id;
  await command(request, { type: 'updateLibrary', library: { version: 1, activeId: seed.id, documents: [seed, child] } });
  await login(page); let release: (() => void) | undefined; let pending = false;
  await page.route('**/api/workspace/commands', async route => {
    if (!pending) { pending = true; await new Promise<void>(resolve => { release = resolve; }); }
    await route.continue();
  });
  await rename(page, '导航前要保留的父图修改');
  const before = await page.evaluate(() => window.stationPrototype.snapshot());
  await page.locator('.mode-switch [data-action="monitor"]').click();
  await page.locator('[data-action="open-child-topology"]').click();
  await expect.poll(() => pending).toBe(true); await expect(page.locator('#app')).toHaveAttribute('inert', '');
  // Inert disables pointer targets, so global keyboard handlers must also stop.
  // E must not re-enter editing; undo and arrow movement must not alter the graph.
  await page.keyboard.press('e'); await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
  await expect(page.locator('#crumb-mode')).toHaveText('拓扑查看');
  release!(); await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', child.id);
  const current = (await state(request)).workspace;
  const effective = current.editing.drafts.find(draft => draft.document.id === seed.id)?.document ?? current.documents.find(doc => doc.id === seed.id)!;
  expect(effective.topology).toEqual(before);
  await page.locator('[data-action="navigation-back"]').click();
  await expect(page.locator('body[data-document-id]')).toHaveAttribute('data-document-id', seed.id);
  expect(await page.evaluate(() => window.stationPrototype.snapshot())).toEqual(before);
});

function backupFixture() {
  const values = new Map<string, string>();
  const store = new WorkspaceStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  const parent = sampleDocument('datacenter'), child = sampleDocument('satellite');
  parent.name = '完整备份主图'; child.name = '完整备份子图'; parent.topology.nodes[0].data.childTopologyId = child.id;
  const template = structuredClone(parent.templates[0]); template.id = 'backup-template'; template.label = '本机定制模板'; parent.templates.push(template);
  store.updateLibrary({ version: 1, activeId: parent.id, documents: [parent, child] });
  const saved = structuredClone(parent); saved.topology.nodes[0].data.title = '手动保存旧版本'; store.saveDocument(saved); store.publish(saved, 0, '备份正式发布');
  const draft = structuredClone(saved); draft.topology.nodes[0].data.title = '备份未发布草稿'; store.saveDraft(draft);
  return store.snapshot();
}

test('S14 不读取旧浏览器存档或提示迁移，服务器库保留文件导入与恢复', async ({ page, context, request }) => {
  await context.addInitScript(() => {
    localStorage.setItem('topology-workspace-v1', '{invalid old workspace');
    localStorage.setItem('station-x6-topology-v1', '{invalid old drawing');
  });
  await login(page);
  await expect(page.locator('#server-pending-notice')).toBeHidden();
  await page.locator('.topbar [data-action="server-storage"]').click();
  await expect(page.locator('[data-action="migrate-browser-library"], [data-action="export-browser-library"]')).toHaveCount(0);
  await expect(page.locator('#modal')).not.toContainText('迁移');
  await expect(page.locator('[data-action="import-server-library"]')).toBeVisible();
  await expect(page.locator('#server-storage-error')).toBeEmpty();
  expect((await state(request)).workspace.documents.map(document => document.id)).toEqual([seed.id]);
  expect(await page.evaluate(() => localStorage.getItem('topology-workspace-v1'))).toBe('{invalid old workspace');
});

test('S14 完整库文件导入保留模板、子图、草稿、历史和发布', async ({ page, request }) => {
  const source = backupFixture(), raw = JSON.stringify(source);
  await login(page); await page.locator('.topbar [data-action="server-storage"]').click();
  const choosing = page.waitForEvent('filechooser'); await page.locator('[data-action="import-server-library"]').click();
  await (await choosing).setFiles({ name: 'workspace-backup.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await expect.poll(async () => (await state(request)).workspace.documents.length).toBe(3);
  const imported = (await state(request)).workspace;
  for (const document of source.documents) expect(imported.documents.find(doc => doc.id === document.id)).toEqual(document);
  for (const draft of source.editing.drafts) expect(imported.editing.drafts.find(value => value.document.id === draft.document.id)).toEqual(draft);
  for (const version of source.editing.history) expect(imported.editing.history.find(value => value.id === version.id)).toEqual(version);
  for (const publication of source.publishing.entries) expect(imported.publishing.entries.find(value => value.id === publication.id)).toEqual(publication);
  expect(await page.evaluate(key => localStorage.getItem(key), LIBRARY_KEY)).toBeNull();
});

test('S14 服务器展示跟随当前发布、保留固定版本，断网可恢复，删除不显示旧发布', async ({ page, context, request }) => {
  let document = structuredClone(seed); document.topology.nodes[0].data.title = '服务端发布一';
  let result = await command(request, { type: 'publish', document, expectedPublicationRevision: 0, note: '第一版' });
  const first = result.workspace.publishing.entries.find(publication => publication.documentId === seed.id)!;
  await login(page, `/viewer.html?published=${seed.id}`);
  await expect(page.locator('body[data-published]')).toHaveAttribute('data-publication-revision', '1');
  const fixed = await context.newPage(); await fixed.goto(`/viewer.html?published=${seed.id}&revision=1&publication=${first.id}`);
  await expect(fixed.locator('[data-device-node="ant-01"]')).toContainText('服务端发布一');
  document = structuredClone(document); document.topology.nodes[0].data.title = '暂未发布的草稿';
  await command(request, { type: 'saveDraft', document });
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText('服务端发布一');
  document.topology.nodes[0].data.title = '服务端发布二';
  await command(request, { type: 'publish', document, expectedPublicationRevision: 1, note: '第二版' });
  await expect(page.locator('[data-device-node="ant-01"]')).toContainText('服务端发布二');
  await expect(fixed.locator('[data-device-node="ant-01"]')).toContainText('服务端发布一');
  await page.route('**/api/workspace', route => route.abort('failed'));
  await expect(page.locator('#publication-error')).toBeVisible(); await expect(page.locator('[data-device-node="ant-01"]')).toContainText('服务端发布二');
  await page.unroute('**/api/workspace'); await expect(page.locator('#publication-error')).toBeHidden();
  const replacement = sampleDocument('satellite');
  await command(request, { type: 'updateLibrary', library: { version: 1, activeId: replacement.id, documents: [replacement] } });
  await expect(page.locator('.device-card')).toHaveCount(0); await expect(page.locator('#publication-error')).toBeVisible();
  await expect(page.locator('#viewer-title')).toHaveText('发布版本不可用'); await fixed.close();
});

test('S14 Chrome 制作并保存，独立 WebKit 浏览器登录后读取同一服务器图', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome' || process.platform === 'win32', '跨引擎验收由安装 WebKit 的 macOS/Linux Chrome 项目执行一次');
  await login(page); await rename(page, 'Chrome 保存后由 WebKit 读取'); await page.locator('[data-action="save"]').click();
  await expect.poll(async () => title((await state(request)).workspace)).toBe('Chrome 保存后由 WebKit 读取');
  // Playwright's test runner sets a default channel on its browser types.
  // Clear Chrome's channel explicitly when launching the second engine.
  const engine = await webkit.launch({ channel: undefined });
  try {
    const context = await engine.newContext({ baseURL: origin }); const other = await context.newPage(); await login(other);
    await expect(other.locator('[data-device-node="ant-01"]')).toContainText('Chrome 保存后由 WebKit 读取'); await context.close();
  } finally { await engine.close(); }
});
