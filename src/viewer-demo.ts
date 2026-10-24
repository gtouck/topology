import { TopologyViewer } from './viewer';
import { createDocument, parseDocument, sampleDocument, type TopologyDocument } from './document';
import { LIBRARY_KEY, parseLibrary } from './library';
import { parseWorkspace, effectiveDocument } from './workspace';
import type { TelemetryData } from './runtime-data';
import './viewer-demo.css';

document.querySelector('#viewer-demo')!.innerHTML = `<header><a href="./index.html">topology.</a><div><strong>独立拓扑展示</strong><span>与编辑器分离 · 可嵌入其他软件</span></div><label class="demo-button">导入拓扑文件<input id="viewer-file" type="file" accept=".json" hidden/></label></header><main><div class="demo-title"><div><small>TOPOLOGY VIEWER</small><h1 id="viewer-title"></h1><p id="viewer-description"></p></div><span id="viewer-data-status">等待宿主数据</span></div><div class="demo-layout"><section><div id="standalone-viewer"></div><div id="second-viewer" hidden></div><div class="viewer-demo-note">展示组件只加载文件与宿主传入的数据，不包含编辑器、存储或模拟计时器。</div></section><aside><h2>宿主数据</h2><p>按业务对象 ID 提供参数和状态。编辑器中可配置字段映射。</p><textarea id="viewer-data" aria-label="宿主实时数据" spellcheck="false">{}</textarea><div class="demo-actions"><button id="apply-viewer-data">更新数据</button><button id="sample-viewer-data">填入示例数据</button><button id="clear-viewer-data">清空</button></div><p id="viewer-error" role="alert"></p><div class="demo-selection"><h2>节点点击事件</h2><pre id="viewer-selection">点击节点查看回调内容</pre></div><details><summary>JavaScript 接入</summary><pre>const viewer = new TopologyViewer(container, { definition });
viewer.setData(data);
viewer.updateData(patch);
viewer.destroy();</pre></details></aside></div></main>`;
const el = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let definition: TopologyDocument;
try {
  const id = new URLSearchParams(location.search).get('document');
  if (id) {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null');
    const library = parseLibrary(raw);
    let found = library.documents.find((d) => d.id === id);
    if (!found) throw new Error('当前浏览器中没有这张拓扑，请导入导出的文件');
    if (new URLSearchParams(location.search).get('draft') === '1') {
      const recovery = effectiveDocument(parseWorkspace(raw), id);
      if (recovery.draft && !recovery.stale) found = recovery.draft.document;
    }
    definition = found;
  } else definition = sampleDocument('datacenter');
} catch (error) { definition = createDocument('请导入拓扑文件'); el('#viewer-error').textContent = error instanceof Error ? error.message : '读取失败'; }
const viewer = new TopologyViewer(el('#standalone-viewer'), { definition, onNodeClick: ({ node, source }) => { el('#viewer-selection').textContent = JSON.stringify({ nodeId: node.id, title: node.data.title, source }, null, 2); } });
let second: TopologyViewer | undefined;
if (new URLSearchParams(location.search).get('instances') === '2') { el('#second-viewer').hidden = false; second = new TopologyViewer(el('#second-viewer'), { definition }); }
function updateMetadata() { el('#viewer-title').textContent = definition.name; el('#viewer-description').textContent = definition.description || `${definition.topology.nodes.length} 个节点 · ${definition.topology.edges.length} 条连接 · Topology v3`; }
updateMetadata();
el('#apply-viewer-data').onclick = () => {
  try { const data = JSON.parse(el<HTMLTextAreaElement>('#viewer-data').value); viewer.setData(data); el('#viewer-error').textContent = ''; el('#viewer-data-status').textContent = `宿主更新 · ${new Date().toLocaleTimeString()}`; }
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
};
el('#clear-viewer-data').onclick = () => { viewer.setData({}); el<HTMLTextAreaElement>('#viewer-data').value = '{}'; el('#viewer-data-status').textContent = '等待宿主数据'; };
el<HTMLInputElement>('#viewer-file').onchange = async (event) => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try { if (file.size > 3 * 1024 * 1024) throw new Error('文件不能超过 3 MB'); const checked = parseDocument(JSON.parse(await file.text())); viewer.setDefinition(checked); second?.setDefinition(checked); definition = checked; updateMetadata(); el<HTMLTextAreaElement>('#viewer-data').value = '{}'; el('#viewer-error').textContent = ''; el('#viewer-data-status').textContent = '等待宿主数据'; }
  catch (error) { el('#viewer-error').textContent = error instanceof Error ? error.message : '导入失败'; }
  finally { input.value = ''; }
};
window.addEventListener('pagehide', () => { viewer.destroy(); second?.destroy(); });
declare global { interface Window { topologyViewer: TopologyViewer; secondTopologyViewer?: TopologyViewer } }
window.topologyViewer = viewer; window.secondTopologyViewer = second;
