import type { ConnectionState } from './data-freshness';
import { TopologyViewer, type TopologyNavigateEvent } from './viewer';
import { createDocument, parseDocument, sampleDocument, type TopologyDocument } from './document';
import { LIBRARY_KEY } from './library';
import { parseWorkspace, effectiveDocument, type Workspace } from './workspace';
import { latestPublication, type TopologyPublication } from './publication';
import type { TelemetryData } from './runtime-data';
import { parseLinkData } from './link-state';
import { ensureServerSession, isServerMode, serverFetch, showServerError } from './server-session';
import './viewer-demo.css';

async function startViewerDemo() {
document.querySelector('#viewer-demo')!.innerHTML = `<header><a href="./index.html">topology.</a><div><strong>独立拓扑展示</strong><span>与编辑器分离 · 可嵌入其他软件</span></div><label class="demo-button">导入拓扑文件<input id="viewer-file" type="file" accept=".json" hidden/></label></header><main><div class="demo-title"><div><small>TOPOLOGY VIEWER</small><h1 id="viewer-title"></h1><p id="viewer-description"></p></div><span id="viewer-data-status">等待宿主数据</span></div><div class="demo-layout"><section><div id="standalone-viewer"></div><div id="second-viewer" hidden></div><div class="viewer-demo-note">展示组件只加载文件与宿主传入的数据，不包含编辑器、存储或模拟计时器。</div></section><aside><h2>接收时效</h2><div class="freshness-demo-controls"><label>超时秒数（0 关闭）<input id="viewer-timeout" type="number" min="0" max="86400" step="0.1" value="15"/></label><label>数据连接<select id="viewer-connection"><option value="connected">已连接</option><option value="disconnected">已中断</option></select></label></div><button class="demo-freshness-apply" id="apply-viewer-freshness">应用接收设置</button><h2>宿主数据</h2><p>按业务对象 ID 提供参数和状态。编辑器中可配置字段映射。</p><textarea id="viewer-data" aria-label="宿主实时数据" spellcheck="false">{}</textarea><h2 class="link-demo-heading">链路状态</h2><p>按链路 ID 提供 status：up / down / unknown，可用 active 控制连通后的流转。</p><textarea id="viewer-link-data" aria-label="链路实时状态" spellcheck="false">{}</textarea><div class="demo-actions"><button id="apply-viewer-data">更新数据</button><button id="sample-viewer-data">填入示例数据</button><button id="clear-viewer-data">清空</button></div><p id="viewer-error" role="alert"></p><div class="demo-selection"><h2>节点点击事件</h2><pre id="viewer-selection">点击节点查看回调内容</pre></div><details><summary>JavaScript 接入</summary><pre>const viewer = new TopologyViewer(container, { definition });
viewer.setData(data);
viewer.updateData(patch);
viewer.destroy();</pre></details></aside></div></main>`;
const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let definition: TopologyDocument;
let publication: TopologyPublication | undefined;
let publishedId = new URLSearchParams(location.search).get('published');
let fixedRevision = new URLSearchParams(location.search).get('revision');
let fixedPublication = new URLSearchParams(location.search).get('publication');
let fixedVersion = fixedRevision !== null || fixedPublication !== null;
const remote = isServerMode();
let serverWorkspace: Workspace | undefined;
el('.demo-layout').insertAdjacentHTML('beforebegin', '<p id="publication-error" role="alert" hidden></p>');
async function loadServerWorkspace() {
  const response = await serverFetch('/api/workspace');
  if (!response.ok) throw new Error('无法读取服务器拓扑库，请稍后重试');
  const result = await response.json();
  serverWorkspace = parseWorkspace(result.workspace);
  return serverWorkspace;
}
function readWorkspace() {
  if (!remote) {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw === null) throw new Error('当前浏览器中没有拓扑库，请导入拓扑文件');
    return parseWorkspace(JSON.parse(raw));
  }
  if (!serverWorkspace) throw new Error('服务器拓扑库尚未加载');
  return serverWorkspace;
}
function readPublished(state = readWorkspace()) {
  const found = !fixedVersion ? latestPublication(state.publishing.entries, publishedId!) : state.publishing.entries.find(p => p.documentId === publishedId && (fixedRevision === null || String(p.revision) === fixedRevision) && (fixedPublication === null || p.id === fixedPublication));
  if (!found) throw new Error('发布版本不存在或已被清理，请在制作工具中显式发布');
  return found;
}
try {
  if (remote) { await ensureServerSession(); await loadServerWorkspace(); }
  const id = new URLSearchParams(location.search).get('document');
  if (publishedId) {
    document.body.dataset.published = 'true'; publication = readPublished(); definition = publication.document;
  } else if (id) {
    const state = readWorkspace();
    let found = state.documents.find((d) => d.id === id);
    if (!found) throw new Error(remote ? '服务器中没有这张拓扑，请检查地址或重新导入' : '当前浏览器中没有这张拓扑，请导入导出的文件');
    if (new URLSearchParams(location.search).get('draft') === '1') {
      const recovery = effectiveDocument(state, id);
      if (recovery.draft && !recovery.stale) found = recovery.draft.document;
    }
    definition = found;
  } else definition = sampleDocument('datacenter');
} catch (error) {
  definition = createDocument(publishedId ? '发布版本不可用' : remote ? '服务器拓扑暂不可用' : '请导入拓扑文件');
  const message = error instanceof Error ? error.message : '读取失败'; el('#viewer-error').textContent = message;
  if (publishedId || remote) { el('#publication-error').hidden = false; el('#publication-error').textContent = message; }
  if (remote) {
    const retry = document.createElement('button'); retry.id = 'viewer-retry'; retry.textContent = '重新读取服务器'; retry.onclick = () => location.reload();
    el('#publication-error').append(' ', retry);
  }
}
const viewer = new TopologyViewer(el('#standalone-viewer'), { definition, onNodeClick: ({ node, source }) => { el('#viewer-selection').textContent = JSON.stringify({ nodeId: node.id, title: node.data.title, source }, null, 2); }, onNavigate: navigateTopology });
async function navigateTopology(event: TopologyNavigateEvent) {
  try {
    if (!remote && localStorage.getItem(LIBRARY_KEY) === null) throw new Error('当前浏览器中没有子拓扑，请由宿主提供目标配置');
    const state = remote ? await loadServerWorkspace() : readWorkspace();
    const target = state.documents.find(document => document.id === event.documentId);
    if (!target) throw new Error('子拓扑不存在，请导入目标配置或重新绑定');
    if (publishedId && !latestPublication(state.publishing.entries, event.documentId)) throw new Error('子拓扑尚未发布，请先在制作工具中发布');
    const url = new URL(location.href); url.search = '';
    url.searchParams.set(publishedId ? 'published' : 'document', event.documentId);
    if (!publishedId && new URLSearchParams(location.search).get('draft') === '1') url.searchParams.set('draft', '1');
    url.searchParams.set('from', event.fromDocumentId);
    if (fixedRevision) url.searchParams.set('parentRevision', fixedRevision);
    if (fixedPublication) url.searchParams.set('parentPublication', fixedPublication);
    location.assign(url.href);
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法打开子拓扑'; el('#viewer-error').textContent = message;
    if (publishedId) { el('#publication-error').hidden = false; el('#publication-error').textContent = message; }
  }
}
const parentDocument = new URLSearchParams(location.search).get('from');
if (parentDocument) {
  document.body.dataset.childNavigation = 'true';
  const button = document.createElement('button'); button.className = 'demo-back'; button.textContent = '‹ 返回上级'; button.id = 'viewer-back';
  button.onclick = () => {
    if (document.referrer.startsWith(location.origin + '/') && history.length > 1) { history.back(); return; }
    const url = new URL(location.href); url.search = ''; url.searchParams.set(publishedId ? 'published' : 'document', parentDocument);
    const params = new URLSearchParams(location.search);
    if (params.get('parentRevision')) url.searchParams.set('revision', params.get('parentRevision')!);
    if (params.get('parentPublication')) url.searchParams.set('publication', params.get('parentPublication')!);
    if (!publishedId && params.get('draft') === '1') url.searchParams.set('draft', '1');
    location.assign(url.href);
  };
  el('header').insertBefore(button, el('.demo-button'));
}
let second: TopologyViewer | undefined;
if (new URLSearchParams(location.search).get('instances') === '2') { el('#second-viewer').hidden = false; second = new TopologyViewer(el('#second-viewer'), { definition }); }
function updateMetadata() {
  el('#viewer-title').textContent = definition.name;
  el('#viewer-description').textContent = publication ? `${!fixedVersion ? '当前发布' : '固定历史版本'} r${publication.revision} · ${new Date(publication.publishedAt).toLocaleString('zh-CN')} · ${publication.note || '无发布说明'}` : definition.description || `${definition.topology.nodes.length} 个节点 · ${definition.topology.edges.length} 条连接 · Topology v3`;
  if (publication) document.body.dataset.publicationRevision = String(publication.revision);
  else delete document.body.dataset.publicationRevision;
}
function resetDataControls() {
  el<HTMLTextAreaElement>('#viewer-data').value = '{}';
  el<HTMLTextAreaElement>('#viewer-link-data').value = '{}';
  el('#viewer-selection').textContent = '点击节点查看回调内容';
  el('#viewer-error').textContent = '';
  el('#viewer-data-status').textContent = '等待宿主数据';
}
function leaveDocumentSource() {
  publishedId = fixedRevision = fixedPublication = null; fixedVersion = false; publication = undefined;
  delete document.body.dataset.published; delete document.body.dataset.childNavigation;
  el('#publication-error').hidden = true; el('#publication-error').textContent = '';
  document.querySelector('#viewer-back')?.remove();
  const url = new URL(location.href);
  for (const key of ['published', 'revision', 'publication', 'document', 'draft', 'from', 'parentRevision', 'parentPublication']) url.searchParams.delete(key);
  history.replaceState(null, '', url.href);
}
updateMetadata();
function refreshPublished() {
  if (!publishedId || fixedVersion) return;
  try {
    const next = readPublished();
    if (next.id !== publication?.id) { viewer.setDefinition(next.document); second?.setDefinition(next.document); definition = next.document; publication = next; updateMetadata(); resetDataControls(); }
    el('#publication-error').hidden = true; el('#publication-error').textContent = '';
  } catch (error) {
    // A deleted publication must not continue masquerading as the current release.
    definition = createDocument('发布版本不可用'); viewer.setDefinition(definition); second?.setDefinition(definition); publication = undefined;
    delete document.body.dataset.publicationRevision; updateMetadata();
    el('#viewer-data-status').textContent = '发布版本不可用'; el('#viewer-error').textContent = error instanceof Error ? error.message : '读取发布失败';
    el('#publication-error').hidden = false; el('#publication-error').textContent = el('#viewer-error').textContent;
  }
}
const onStorage = (event: StorageEvent) => {
  if (event.key === LIBRARY_KEY || event.key === null) refreshPublished();
};
let refreshPending = false;
const pollPublished = async () => {
  if (!publishedId || fixedVersion || refreshPending) return;
  refreshPending = true; const sourceId = publishedId;
  try {
    await loadServerWorkspace();
    if (sourceId === publishedId && !fixedVersion) refreshPublished();
  } catch {
    if (sourceId === publishedId) {
      el('#publication-error').hidden = false;
      el('#publication-error').textContent = '服务器暂时无法连接，当前显示的是上次读取的发布版本。恢复连接后将自动更新。';
    }
  } finally { refreshPending = false; }
};
// Network/storage belong to this host page. TopologyViewer itself stays independent.
const refreshTimer = remote ? window.setInterval(() => { void pollPublished(); }, 5000) : undefined;
if (!remote) window.addEventListener('storage', onStorage);
el('#apply-viewer-freshness').onclick = () => {
  try {
    const timeout = el<HTMLInputElement>('#viewer-timeout').value;
    if (!timeout.trim()) throw new Error('请填写超时秒数，0 表示关闭');
    viewer.configureFreshness({ staleAfterMs: Number(timeout) * 1000 });
    const connection = el<HTMLSelectElement>('#viewer-connection').value as ConnectionState;
    if (connection !== viewer.getDataStatus().connection) viewer.setConnectionState(connection);
    el('#viewer-error').textContent = '';
  } catch (error) { el('#viewer-error').textContent = error instanceof Error ? error.message : '设置不合法'; }
};
el('#apply-viewer-data').onclick = () => {
  try { const data = JSON.parse(el<HTMLTextAreaElement>('#viewer-data').value); const links = parseLinkData(JSON.parse(el<HTMLTextAreaElement>('#viewer-link-data').value)); viewer.setData(data); viewer.setLinkData(links); el('#viewer-error').textContent = ''; el('#viewer-data-status').textContent = `宿主更新 · ${new Date().toLocaleTimeString()}`; }
  catch (error) { el('#viewer-error').textContent = error instanceof Error ? error.message : '数据不合法'; }
};
function put(record: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.'); let target = record;
  parts.slice(0, -1).forEach((key) => { if (!target[key] || typeof target[key] !== 'object') target[key] = {}; target = target[key] as Record<string, unknown>; });
  target[parts.at(-1)!] = value;
}
el('#sample-viewer-data').onclick = () => {
  const data: TelemetryData = {};
  definition.topology.nodes.forEach((node, i) => {
    const binding = node.data.binding;
    const source = binding?.source || node.data.deviceId;
    if (!Object.hasOwn(data, source)) Object.defineProperty(data, source, { value: {}, enumerable: true });
    const metrics = definition.templates.find((t) => t.id === node.data.kind)!.metrics;
    metrics.forEach((m, j) => put(data[source], binding?.fields[m.key] || m.key, 20 + i * 3 + j + .5));
    const key = Object.entries(binding?.statusMap || {}).find(([, value]) => value === 'normal')?.[0] || 'normal';
    put(data[source], binding?.statusField || 'status', key);
  });
  el<HTMLTextAreaElement>('#viewer-data').value = JSON.stringify(data, null, 2);
  el<HTMLTextAreaElement>('#viewer-link-data').value = JSON.stringify(Object.fromEntries(definition.topology.edges.map(edge => [edge.id, { status: 'up' }])), null, 2);
};
el('#clear-viewer-data').onclick = () => { viewer.setData({}); viewer.setLinkData({}); resetDataControls(); };
el<HTMLInputElement>('#viewer-file').onchange = async (event) => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try { if (file.size > 3 * 1024 * 1024) throw new Error('文件不能超过 3 MB'); const checked = parseDocument(JSON.parse(await file.text())); viewer.setDefinition(checked); second?.setDefinition(checked); definition = checked; leaveDocumentSource(); updateMetadata(); resetDataControls(); }
  catch (error) { el('#viewer-error').textContent = error instanceof Error ? error.message : '导入失败'; }
  finally { input.value = ''; }
};
window.addEventListener('pagehide', event => { if (!event.persisted) { clearInterval(refreshTimer); window.removeEventListener('storage', onStorage); viewer.destroy(); second?.destroy(); } });
window.topologyViewer = viewer; window.secondTopologyViewer = second;
}
void startViewerDemo().catch(showServerError);
declare global { interface Window { topologyViewer: TopologyViewer; secondTopologyViewer?: TopologyViewer } }
