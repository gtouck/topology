import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { createServer } from '../server/index';
import { sampleDocument, type TopologyDocument } from '../src/document';
import type { WorkspaceResponse } from '../shared/api';

// This is an actual Safari application check. WebKit automation is covered by
// the separate server browser suite. Every resource here belongs to a fresh
// test origin, database, Chrome context or Safari automation tab.
if (process.platform !== 'darwin') throw new Error('实际 Safari 检查需要 macOS、Safari 27 及已开启的远程自动化');
const output = resolve('test-results/server-safari');
await mkdir(output, { recursive: true });
await readFile(resolve('dist/index.html'));
const dataDir = await mkdtemp(join(tmpdir(), 'topology-server-safari-'));
const credentials = { username: 'safari-check', password: `isolated-${crypto.randomUUID()}` };
const proof: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString(), platform: process.platform, checks: [], limitations: '仅验证数据保存、会话及跨浏览器读取；不验证隐藏自动化页面的前台动画。' };
const checks = proof.checks as string[];
let application: Awaited<ReturnType<typeof createServer>> | undefined;
let chrome: Browser | undefined;
let safari: ChildProcessWithoutNullStreams | undefined;
let tab: string | undefined;
let origin = '', buffer = '', sequence = 0;
const diagnostics: string[] = [];
const waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();

function attachSafari(child: ChildProcessWithoutNullStreams) {
  child.stderr.on('data', data => diagnostics.push(String(data)));
  child.on('error', error => { for (const request of waiting.values()) request.reject(error); });
  child.on('exit', () => { for (const request of waiting.values()) request.reject(new Error('Safari MCP 已退出，请确认 Safari 27 及远程自动化设置')); });
  child.stdout.on('data', data => {
    buffer += data;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const result = JSON.parse(line); waiting.get(result.id)?.resolve(result); } catch { /* Diagnostic line, not a response. */ }
    }
  });
}

async function rpc(method: string, params: unknown) {
  assert(safari, 'Safari MCP 尚未启动');
  const id = ++sequence;
  try {
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} 超过 30 秒未响应`)), 30_000);
      waiting.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      safari!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  } finally { waiting.delete(id); }
}

async function tool(name: string, args: unknown) {
  const response = await rpc('tools/call', { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(`${name}: ${JSON.stringify(response.error || response.result)}`);
  return response.result;
}

function decode(result: any): any {
  let value = result.content?.find((item: any) => item.type === 'text')?.text;
  // Safari MCP JSON-encodes evaluate_javascript return values; a returned JSON
  // string can consequently arrive with two or three encoding layers.
  for (let attempt = 0; attempt < 4 && typeof value === 'string'; attempt++) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}

async function evaluate(body: string) {
  assert(tab, 'Safari 专用标签页尚未建立');
  await tool('switch_tab', { handle: tab });
  const result = await tool('evaluate_javascript', { expression: `return (async()=>{
    if(location.origin!==${JSON.stringify(origin)})throw new Error('测试已离开专用页面');
    ${body}
  })();` });
  const value = decode(result);
  if (value === undefined) throw new Error(`Safari 未返回可读取结果：${JSON.stringify(result)}`);
  return value;
}

async function safariCheck(label: string, body: string) {
  const result = await evaluate(`${body}; return ${JSON.stringify('PASS ' + label)};`);
  assert.equal(result, 'PASS ' + label, JSON.stringify(result));
  checks.push(label); console.log(`Safari PASS: ${label}`);
}

const poll = `async function waitFor(check,label){const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error(label+' 超时');}`;
const geometry = (document: TopologyDocument) => ({
  nodes: document.topology.nodes.map(node => ({ id: node.id, x: node.x, y: node.y })),
  edges: document.topology.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, vertices: edge.vertices ?? [] })),
});

try {
  application = await createServer({ dataDir, siteDir: resolve('dist'), hostname: '127.0.0.1', port: 0, adminUsername: credentials.username, adminPassword: credentials.password });
  origin = `http://127.0.0.1:${application.server.port}`; proof.origin = origin;
  const loginResponse = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(credentials) });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie')!.split(';')[0];
  assert(cookie, '夹具会话未建立');
  async function state(): Promise<WorkspaceResponse> {
    const response = await fetch(`${origin}/api/workspace`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200); return response.json();
  }
  const seed = sampleDocument('ground-station'); seed.name = 'Chrome 与实际 Safari 存储验收'; proof.documentId = seed.id;
  const initial = await state();
  const seeded = await fetch(`${origin}/api/workspace/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
    body: JSON.stringify({ expectedRevision: initial.revision, requestId: crypto.randomUUID(), command: { type: 'updateLibrary', library: { version: 1, activeId: seed.id, documents: [seed] } } }),
  });
  assert.equal(seeded.status, 200, await seeded.text());
  const baseline = (await state()).workspace.documents.find(document => document.id === seed.id)!;
  const chromeTitle = 'Chrome 保存后由 Safari 读取', safariTitle = 'Safari 保存后由 Chrome 读取';
  async function waitSaved(title: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const result = await state();
      const saved = result.workspace.documents.find(document => document.id === seed.id)!;
      if (saved.topology.nodes.find(node => node.id === 'ant-01')?.data.title === title) {
        assert.deepEqual(geometry(saved), geometry(baseline), '保存不得改变节点坐标和手工走线');
        return result.revision;
      }
      await Bun.sleep(200);
    }
    throw new Error(`服务器未确认保存：${title}`);
  }

  chrome = await chromium.launch({ channel: 'chrome' });
  const context = await chrome.newContext({ baseURL: origin, viewport: { width: 1600, height: 1050 } });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  const chromeErrors: string[] = []; page.on('pageerror', error => chromeErrors.push(error.message));
  await page.goto('/'); await page.locator('#server-username').fill(credentials.username); await page.locator('#server-password').fill(credentials.password);
  await page.locator('#server-login-form button[type="submit"]').click();
  await page.locator(`body[data-document-id="${seed.id}"]`).waitFor();
  await page.locator('.mode-switch [data-action="edit"]').click();
  await page.locator('[data-device-node="ant-01"]').click();
  await page.locator('#device-title').fill(chromeTitle); await page.locator('[data-action="apply-device"]').click();
  await page.locator('[data-action="save"]').click();
  proof.chromeRevision = await waitSaved(chromeTitle);
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent?.includes('布局已保存到服务器'));
  const chromeCookies = await context.cookies();
  assert(chromeCookies.some(item => item.httpOnly && item.sameSite !== 'None'), 'Chrome 会话 Cookie 未使用 HttpOnly/SameSite');
  proof.chrome = { version: chrome.version(), userAgent: await page.evaluate(() => navigator.userAgent), httpOnlySession: true };
  checks.push('Chrome 通过登录与属性表单保存，服务器确认且几何保持');
  console.log('Chrome PASS: 通过登录与属性表单保存到服务器');
  await page.screenshot({ path: resolve(output, 'chrome-saved.png'), fullPage: true });

  safari = spawn('/usr/bin/safaridriver', ['--mcp'], { stdio: ['pipe', 'pipe', 'pipe'] }); attachSafari(safari);
  const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'topology-server-safari-check', version: '1.0' } });
  assert(initialized.result, JSON.stringify(initialized));
  safari.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const created = decode(await tool('create_tab', { url: origin }));
  tab = created?.handle; assert(tab, 'Safari 未建立专用测试标签页');
  await safariCheck('实际 Safari 登录表单和新会话', `${poll}
    if(!/Version\\/.*Safari\\//.test(navigator.userAgent)||/Chrome|Chromium|Edg\\//.test(navigator.userAgent))throw new Error('当前浏览器不是实际Safari');
    window.__serverSafariErrors=[];addEventListener('error',event=>window.__serverSafariErrors.push(event.message));
    await waitFor(()=>document.querySelector('#server-login-form'),'登录表单');
    const before=await(await fetch('/api/session')).json();if(before.authenticated)throw new Error('新测试来源意外继承了登录');
    document.querySelector('#server-username').value=${JSON.stringify(credentials.username)};
    document.querySelector('#server-password').value=${JSON.stringify(credentials.password)};
    document.querySelector('#server-login-form').requestSubmit();
    await waitFor(()=>document.body.dataset.documentId===${JSON.stringify(seed.id)},'登录后加载拓扑');
    const session=await(await fetch('/api/session')).json();
    if(!session.authenticated||session.username!==${JSON.stringify(credentials.username)})throw new Error('Safari Cookie会话未建立');
    if(document.cookie.includes('topology_session='))throw new Error('会话Cookie暴露给JavaScript');
  `);
  proof.safari = await evaluate('return JSON.stringify({userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],devicePixelRatio,visibility:document.visibilityState,sessionAuthenticated:(await(await fetch("/api/session")).json()).authenticated});');
  await safariCheck('Safari 从服务器读回 Chrome 保存结果', `${poll}
    await waitFor(()=>document.querySelector('[data-device-node="ant-01"]')?.textContent.includes(${JSON.stringify(chromeTitle)}),'Chrome保存后的节点');
    const response=await fetch('/api/workspace');if(!response.ok)throw new Error('Safari读取API失败');
    const data=await response.json(),doc=data.workspace.documents.find(item=>item.id===${JSON.stringify(seed.id)});
    if(doc?.topology.nodes.find(node=>node.id==='ant-01')?.data.title!==${JSON.stringify(chromeTitle)})throw new Error('SafariAPI数据不一致');
    if(localStorage.getItem('topology-workspace-v1')!==null)throw new Error('服务器库错误写入本地旧库');
  `);
  await tool('screenshot', { savePath: resolve(output, 'safari-read-chrome.png'), full_page: true });

  await safariCheck('Safari 通过属性表单保存并收到服务器确认', `${poll}
    document.querySelector('.mode-switch [data-action="edit"]').click();
    window.stationPrototype.graph.resetSelection(['ant-01']);
    await waitFor(()=>document.querySelector('#device-title'),'节点属性表单');
    document.querySelector('#device-title').value=${JSON.stringify(safariTitle)};
    document.querySelector('#device-title').dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="apply-device"]').click();
    document.querySelector('[data-action="save"]').click();
    await waitFor(async()=>{const response=await fetch('/api/workspace');if(!response.ok)throw new Error('Safari读取服务器确认失败');const data=await response.json();return data.workspace.documents.find(doc=>doc.id===${JSON.stringify(seed.id)})?.topology.nodes.find(node=>node.id==='ant-01')?.data.title===${JSON.stringify(safariTitle)};},'Safari服务器确认');
    await waitFor(()=>document.querySelector('#save-status')?.textContent.includes('布局已保存到服务器'),'Safari保存状态');
    if(window.__serverSafariErrors.length)throw new Error(window.__serverSafariErrors.join(';'));
  `);
  proof.safariRevision = await waitSaved(safariTitle);
  await tool('screenshot', { savePath: resolve(output, 'safari-saved.png'), full_page: true });

  await page.reload(); await page.locator(`body[data-document-id="${seed.id}"]`).waitFor();
  await page.waitForFunction(title => document.querySelector('[data-device-node="ant-01"]')?.textContent?.includes(title), safariTitle);
  assert.equal(await page.locator('#server-login-form').count(), 0, 'Chrome 刷新应保留服务器会话');
  assert.deepEqual(chromeErrors, [], 'Chrome 页面存在脚本错误');
  checks.push('Chrome 刷新后读回 Safari 保存结果，登录会话保留');
  console.log('Chrome PASS: 刷新读回实际 Safari 保存结果');
  await page.screenshot({ path: resolve(output, 'chrome-read-safari.png'), fullPage: true });
  proof.status = 'passed';
  console.log(`实际 Safari 与 Chrome 双向存储检查通过，证据：${output}`);
} catch (error) {
  proof.status = 'failed'; proof.error = error instanceof Error ? error.message : String(error);
  console.error(`实际 Safari 存储检查失败：${proof.error}`); process.exitCode = 1;
  await chrome?.contexts()[0]?.pages()[0]?.screenshot({ path: resolve(output, 'chrome-failure.png'), fullPage: true }).catch(() => {});
  if (tab && safari) await tool('screenshot', { savePath: resolve(output, 'safari-failure.png'), full_page: true }).catch(() => {});
} finally {
  if (tab && safari) await tool('close_tab', { handle: tab }).catch(error => { diagnostics.push(`关闭专用测试标签页失败：${error}`); });
  safari?.kill();
  await chrome?.close();
  await application?.close();
  await rm(dataDir, { recursive: true, force: true });
  proof.finishedAt = new Date().toISOString();
  proof.diagnostics = diagnostics;
  await writeFile(resolve(output, 'result.json'), JSON.stringify(proof, null, 2));
}
