import type { TopologyDocument } from './document';
import type { ExportState } from './export-svg';
import type { TelemetryData } from './runtime-data';
import { escapeHtml as esc } from './icons';

/** JSON is embedded as data, never as an executable expression. */
export function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function writeField(record: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('数据绑定路径不合法');
  let target = record;
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(target, key) || !target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
      Object.defineProperty(target, key, { value: {}, writable: true, enumerable: true, configurable: true });
    }
    target = target[key] as Record<string, unknown>;
  }
  Object.defineProperty(target, keys.at(-1)!, { value, writable: true, enumerable: true, configurable: true });
}

export function exportTelemetry(document: TopologyDocument, state: ExportState) {
  const definition = structuredClone(document);
  const data: TelemetryData = {};
  for (const node of definition.topology.nodes) {
    const current = state[node.id];
    if (!current) continue;
    node.data.status = current.status;
    const binding = node.data.binding;
    const source = binding?.source || node.data.deviceId;
    if (!Object.hasOwn(data, source)) Object.defineProperty(data, source, { value: {}, enumerable: true });
    for (const [key, value] of Object.entries(current.values)) {
      const path = binding ? binding.fields[key] : key;
      if (path) writeField(data[source], path, value);
    }
    const statusPath = binding ? binding.statusField : 'status';
    if (statusPath) {
      let raw = Object.entries(binding?.statusMap || {}).find(([, status]) => status === current.status)?.[0] ?? current.status;
      // An unmapped value falls back to the snapshot's node status.
      while (binding?.statusMap && Object.hasOwn(binding.statusMap, raw) && binding.statusMap[raw] !== current.status) raw += '_snapshot';
      writeField(data[source], statusPath, raw);
    }
  }
  return { definition, data };
}

/** One file, including its viewer runtime: no server or network needed to open it. */
export function renderTopologyHtml(document: TopologyDocument, state: ExportState, runtime: string) {
  if (!runtime.trim()) throw new Error('展示组件未生成，请重新运行 bun run dev 或 bun run build');
  const snapshot = exportTelemetry(document, state);
  const runtimeScript = runtime.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(document.name)}</title>
<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:#f9fbfa;color:#42584a;font:13px Arial,"PingFang SC","Microsoft YaHei",sans-serif}header{display:flex;gap:16px;align-items:center;padding:16px 24px;border-bottom:1px solid #dfe7dd;background:#fff}header>div{min-width:0;flex:1}h1{font-size:18px;margin:0;overflow-wrap:anywhere}p{margin:6px 0 0;color:#8a9c82;font-size:12px;overflow-wrap:anywhere}#data-status{color:#8a9c82;font-size:11px;flex-shrink:0}#topology{flex:1;min-height:0}#error{white-space:pre-wrap;color:#a44;padding:24px}@media(max-width:600px){header{padding:12px;flex-wrap:wrap}#data-status{font-size:10px}}</style></head>
<body><header><div><h1>${esc(document.name)}</h1>${document.description ? `<p>${esc(document.description)}</p>` : ''}</div><span id="data-status">导出时数据快照</span></header><main id="topology"></main><div id="error" hidden></div>
<script id="topology-document" type="application/json">${scriptJson(snapshot.definition)}</script>
<script id="topology-data" type="application/json">${scriptJson(snapshot.data)}</script>
<script>${runtimeScript}</script>
<script>
try {
  const definition = JSON.parse(document.getElementById('topology-document').textContent);
  const data = JSON.parse(document.getElementById('topology-data').textContent);
  const viewer = new TopologyKit.TopologyViewer(document.getElementById('topology'), {
    definition, data,
    onNodeClick(event) { window.dispatchEvent(new CustomEvent('topology:node-click', { detail: event })); }
  });
  for (const method of ['setData', 'updateData']) {
    const original = viewer[method].bind(viewer);
    viewer[method] = (data) => { original(data); document.getElementById('data-status').textContent = '数据更新 · ' + new Date().toLocaleTimeString(); };
  }
  window.topologyViewer = viewer;
  window.dispatchEvent(new Event('topology:ready'));
} catch (error) {
  const el = document.getElementById('error'); el.hidden = false; el.textContent = '拓扑加载失败：' + error.message;
}
</script></body></html>`;
}
