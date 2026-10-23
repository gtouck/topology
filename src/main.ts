import { Graph, Snapline, type Node, type Edge, type Cell } from '@antv/x6';
import { icon, iconNames, escapeHtml as esc } from './icons';
import { cableAppearance, cableAttributes, cablePreview, cableStyles, parseCableAppearance, type CableAppearance } from './cables';
import { PortEditor } from './port-editor';
import { registerTopologyShapes, addRenderedNode, updateNodeGeometry, edgeLabels, installCableTexture } from './rendering';
import { categories, newId, parseDocument, sampleDocument, templatesFromDefinitions, definitionsFromTemplates, installEditorTemplates, parseTemplate, type TopologyDocument } from './document';
import { loadLibrary, saveLibrary, duplicateDocument, removeDocument, emptyLibrary, type TopologyLibrary } from './library';
import { downloadBlob, exportFilename, graphSvg, svgToPng, standaloneHtml } from './exports';
import type { ExportState } from './export-svg';
import {
  devices, newDevice, linkTypes, statusLabels,
  NODE_WIDTH, NODE_HEIGHT, devicePorts, portSides, assertConnectedPortsPreserved, parseDataBinding,
  type DeviceKind, type DeviceData, type DeviceRecord, type LinkKind,
  type LinkRecord, type Snapshot, type DeviceStatus,
} from './topology';
import './style.css';

type Mode = 'monitor' | 'edit';
let mode: Mode = 'monitor';
let selected: Cell | null = null;
let paused = false;
let outage = false;
let outageNodeId: string | null = null;
let loading = false;
let tick = 0;
let lastUpdate = new Date();
let savedSignature = '';
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let recordTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let portEditor: PortEditor | null = null;
let portEditorNode: Node | null = null;
let library: TopologyLibrary;
let activeDocument: TopologyDocument;
const documentHistories = new Map<string, { undo: Snapshot[]; redo: Snapshot[] }>();
const filters = new Set<LinkKind>(['rf', 'if', 'ethernet', 'logical']);
const values = new Map<string, Record<string, number>>();
const runtimeStatuses = new Map<string, DeviceStatus>();
const historyValues = new Map<string, number[]>();
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const time = (date: Date) => date.toLocaleTimeString('zh-CN', { hour12: false });
const button = (action: string, title: string, glyph: Parameters<typeof icon>[0], text = '', cls = '') =>
  `<button type="button" data-action="${action}" title="${title}" aria-label="${title}" class="${text ? 'button' : 'icon-button'} ${cls}">${icon(glyph)}${text ? `<span>${text}</span>` : ''}</button>`;

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Topology 首页"><span class="brand-mark">${icon('SatelliteDish', 25)}</span><span>topology<span class="brand-dot">.</span><small>拓扑制作工作台</small></span></a>
    <div class="workspace-label">WORKSPACE <span>01</span></div>
    <button class="station-picker" data-action="library"><span class="station-avatar">BJ</span><span><strong>北京地面站</strong><small>卫星通信 · 主站</small></span>${icon('ChevronDown', 14)}</button>
    <div class="nav-label">工作空间</div><button class="nav-item" data-action="library">${icon('Layers')}<span>拓扑库</span><span class="nav-shortcut" id="library-count">1</span></button>
    <nav>
      <button class="nav-item active" data-action="monitor">${icon('LayoutDashboard')}<span>拓扑总览</span><span class="nav-dot"></span></button>
      <button class="nav-item" data-action="edit">${icon('Cable')}<span>拓扑编辑</span><span class="nav-shortcut">E</span></button>
      <button class="nav-item" data-action="alarms">${icon('Bell')}<span>告警中心</span><span class="alarm-count" id="nav-alarms">1</span></button>
    </nav>
    <div class="sidebar-divider"></div>
    <div id="sidebar-content"></div>
    <div class="sidebar-bottom"><span class="sidebar-live"><i></i> 本地演示环境</span><button class="nav-item" data-action="help">${icon('HelpCircle')}<span>使用指南</span>${icon('ArrowUpRight', 14)}</button><div class="profile"><span class="avatar">站</span><span><strong>工作台管理员</strong><small>本地拓扑库 · 无需登录</small></span></div></div>
  </aside>
  <div class="workspace">
    <header class="topbar"><div class="breadcrumb"><span>工作空间</span>${icon('ChevronRight', 14)}<span id="crumb-document">北京地面站</span>${icon('ChevronRight', 14)}<strong id="crumb-mode">拓扑总览</strong></div><div class="topbar-right"><span class="prototype-badge">X6 PROTOTYPE</span>${button('help', '使用指南', 'HelpCircle')}${button('alarms', '查看告警', 'Bell')}<span class="topbar-avatar">站</span></div></header>
    <main>
      <div class="page-heading"><div><div class="eyebrow">TOPOLOGY WORKSPACE</div><h1 id="page-title">让每一条连接，清晰可见<span class="heading-dot">.</span></h1><p id="page-description">节点、连接关系与实时运行状态，尽在一张图中。</p></div><div class="heading-actions"><button class="button" data-action="library">${icon('Layers', 15)}拓扑库</button><div class="mode-switch" role="group" aria-label="界面模式"><button data-action="monitor" class="active">${icon('Activity', 16)}首页监控</button><button data-action="edit">${icon('PencilRuler', 16)}拓扑编辑</button></div><button class="button primary" data-action="save">${icon('Save', 16)}<span>保存布局</span></button></div></div>
      <section class="stats" aria-label="拓扑概况">
        <article class="stat"><div class="stat-heading"><span>节点数量</span><span class="stat-icon">${icon('Server', 19)}</span></div><div class="stat-value"><strong id="stat-total">8</strong><span>台</span><span class="stat-note">当前拓扑</span></div><div class="stat-bottom"><span class="tiny-dot green"></span>当前图中的节点<span class="sparkline green-spark">▁▂▂▃▂▄▃▅▄▆▅▆</span></div></article>
        <article class="stat"><div class="stat-heading"><span>在线节点</span><span class="stat-icon green-icon">${icon('CircleCheck', 19)}</span></div><div class="stat-value"><strong id="stat-online">8</strong><span>台</span><span class="percentage" id="stat-percent">100%</span></div><div class="stat-bottom"><span class="tiny-dot green"></span><span id="online-description">所有设备通信正常</span><span class="sparkline green-spark">▅▅▅▅▅▅▅▅▅▅▅▅</span></div></article>
        <article class="stat"><div class="stat-heading"><span>当前告警</span><span class="stat-icon amber-icon">${icon('CircleAlert', 19)}</span></div><div class="stat-value"><strong id="stat-alarms">1</strong><span>项</span><button class="text-button" data-action="alarms">查看详情 ${icon('ArrowUpRight', 13)}</button></div><div class="stat-bottom"><span class="tiny-dot amber"></span><span id="alarm-description">1 台设备需要关注</span></div></article>
        <article class="stat"><div class="stat-heading"><span>连接链路</span><span class="stat-icon">${icon('Cable', 19)}</span></div><div class="stat-value"><strong id="stat-links">8</strong><span>条</span><span class="stat-note">RF / IF / ETH</span></div><div class="stat-bottom"><span class="tiny-dot green"></span>端口级连接关系</div></article>
      </section>
      <section class="topology-panel" aria-label="拓扑画布">
        <div class="panel-heading"><div class="panel-title"><span class="panel-symbol">${icon('Network', 18)}</span><h2>拓扑画布</h2><span class="tag">主站</span></div><div class="panel-heading-actions"><span id="save-status" class="save-status">${icon('Check', 13)}示例布局</span>${button('import', '导入 JSON', 'Upload')}${button('export-options', '导出拓扑', 'Download')}${button('viewer', '在独立展示页打开', 'ExternalLink')}${button('fullscreen', '全屏查看', 'Maximize')}</div></div>
        <div class="canvas-toolbar"><div class="link-filters" aria-label="链路筛选">${(Object.entries(linkTypes) as [LinkKind, typeof linkTypes[LinkKind]][]).map(([kind, def]) => `<button data-filter="${kind}" class="filter-chip active" aria-pressed="true"><span style="--link-color:${def.color}"></span>${def.label}</button>`).join('')}</div><div class="toolbar-right"><span class="live-label" id="live-label"><i></i>模拟实时</span><span class="toolbar-separator"></span>${button('pause', '暂停模拟数据', 'Pause')}${button('outage', '模拟节点离线', 'Unplug', '离线演示', 'subtle')}</div></div>
        <div class="canvas-layout"><div class="canvas-wrap" id="canvas-wrap"><div class="canvas-watermark">BEIJING GROUND STATION <span>站内设备连接示意</span></div><div id="graph" tabindex="0" aria-label="设备拓扑画布"></div><div class="canvas-empty" id="canvas-empty" hidden>${icon('Network', 32)}<strong>从第一台设备开始</strong><p>点击左侧设备，或将设备拖入画布。</p></div><div class="canvas-mode" id="canvas-mode">${icon('LockKeyhole', 13)}首页展示 · 布局已锁定</div><div class="canvas-controls">${button('zoom-out', '缩小', 'Minus')}<span id="zoom-label">100%</span>${button('zoom-in', '放大', 'Plus')}<span class="toolbar-separator"></span>${button('fit', '适应画布', 'Scan')}</div><div class="edit-tools" id="edit-tools" hidden>${button('undo', '撤销 Ctrl / ⌘ Z', 'Undo2')}${button('redo', '重做 Ctrl / ⌘ Shift Z', 'Redo2')}<span class="toolbar-separator"></span>${button('delete', '删除选中对象', 'Trash2')}</div></div><aside id="inspector" class="inspector" aria-label="设备详情"></aside></div>
        <div class="panel-footer"><span><span class="tiny-dot" id="footer-dot"></span><span id="footer-mode">监控模式</span><span class="footer-divider">/</span><span id="footer-hint">点击设备查看参数 · 滚轮缩放 · 拖动画布平移</span></span><span id="update-time">数据更新 --:--:--</span></div>
      </section>
      <div class="bottom-note"><span>${icon('Info', 14)}当前为模拟数据。拓扑库保存在本机浏览器，可导出通用文件用于独立展示。</span><span>POWERED BY <strong>AntV X6</strong></span></div>
    </main>
  </div>
  <input type="file" id="import-file" accept=".json,application/json" hidden />
  <dialog id="modal"><div class="modal-heading"><h2 id="modal-title"></h2>${button('close-modal', '关闭', 'X')}</div><div id="modal-content"></div><div class="modal-footer"><button class="button primary" data-action="close-modal">知道了</button></div></dialog>
  <div class="toast" id="toast" role="status" hidden></div>
`;

function runtimeStatus(node: Node): DeviceStatus {
  return outage && node.id === outageNodeId ? 'offline' : (runtimeStatuses.get(node.id) || node.getData<DeviceData>().status || 'normal');
}

function metricValue(node: Node, key: string) {
  const def = devices[node.getData<DeviceData>().kind].metrics.find((m) => m.key === key)!;
  const value = values.get(node.id)?.[key] ?? def.base;
  return value.toFixed(def.decimals);
}

registerTopologyShapes();

const graph = new Graph({
  container: $('#graph'), autoResize: true, async: false,
  background: { color: '#f9fbfa' },
  grid: { size: 10, visible: true, type: 'dot', args: { color: '#d9e2de', thickness: 1 } },
  scaling: { min: .25, max: 2 },
  panning: { enabled: true, eventTypes: ['leftMouseDown', 'mouseWheelDown'] },
  mousewheel: { enabled: true, modifiers: null, minScale: .25, maxScale: 2, factor: 1.08 },
  interacting: () => ({ nodeMovable: mode === 'edit', edgeMovable: false, edgeLabelMovable: false, magnetConnectable: mode === 'edit', arrowheadMovable: mode === 'edit', vertexMovable: mode === 'edit', vertexAddable: mode === 'edit', vertexDeletable: mode === 'edit' }),
  connecting: {
    snap: { radius: 24 }, allowBlank: false, allowLoop: false, allowNode: false, allowEdge: false,
    allowMulti: 'withPort', highlight: true, anchor: 'center', connectionPoint: 'anchor',
    router: 'normal', connector: { name: 'rounded', args: { radius: 8 } },
    createEdge() { return this.createEdge({ shape: 'station-cable', attrs: cableAttributes(cableAppearance('ethernet')), zIndex: 0 }); },
    validateConnection({ sourceCell, sourcePort, targetCell, targetPort }) {
      if (mode !== 'edit' || !sourceCell?.isNode() || !targetCell?.isNode() || sourceCell.id === targetCell.id) return false;
      const a = devicePorts(sourceCell.getData<DeviceData>()).find((p) => p.id === sourcePort);
      const b = devicePorts(targetCell.getData<DeviceData>()).find((p) => p.id === targetPort);
      return !!a && !!b && a.kind === b.kind;
    },
  },
  highlighting: { magnetAvailable: { name: 'stroke', args: { attrs: { stroke: '#21957b', strokeWidth: 3 } } }, magnetAdsorbed: { name: 'stroke', args: { attrs: { stroke: '#21957b', strokeWidth: 3 } } } },
});
graph.use(new Snapline({ enabled: true, sharp: true, tolerance: 8 }));
installCableTexture(graph, 'station-cable-braid');
const renderedCableStyles = new WeakMap<Edge, string>();

function renderCable(edge: Edge) {
  const kind = (edge.getData()?.kind || 'ethernet') as LinkKind;
  const appearance = cableAppearance(kind, edge.getData()?.appearance);
  const down = [edge.getSourceCell(), edge.getTargetCell()].some((end) => end?.isNode() && runtimeStatus(end) === 'offline');
  const key = JSON.stringify([appearance, down]);
  if (renderedCableStyles.get(edge) !== key) {
    edge.attr(cableAttributes(appearance, down), { runtime: true });
    renderedCableStyles.set(edge, key);
  }
}

function addDevice(record: DeviceRecord) {
  return addRenderedNode(graph, record, {
    definitions: devices, status: runtimeStatus,
    value: (node, key) => runtimeStatus(node) === 'offline' ? '—' : metricValue(node, key),
    selected: (node) => selected?.id === node.id,
  });
}

function addLink(record: LinkRecord) {
  return graph.addEdge({ id: record.id, shape: 'station-cable', source: record.source, target: record.target, vertices: record.vertices,
    router: 'normal', connector: { name: 'rounded', args: { radius: 8 } },
    data: { kind: record.kind, label: record.label, ...(record.appearance ? { appearance: structuredClone(record.appearance) } : {}) }, labels: edgeLabels(record.label),
    attrs: cableAttributes(cableAppearance(record.kind, record.appearance)), zIndex: 0,
  });
}
function snapshot(): Snapshot {
  return {
    nodes: graph.getNodes().map((node) => ({ id: node.id, ...node.getPosition(), data: structuredClone(node.getData<DeviceData>()) })),
    edges: graph.getEdges().filter((e) => e.getSourceCellId() && e.getTargetCellId()).map((edge) => ({ id: edge.id, source: { cell: edge.getSourceCellId(), port: edge.getSourcePortId() }, target: { cell: edge.getTargetCellId(), port: edge.getTargetPortId() }, kind: edge.getData()?.kind || 'ethernet', label: edge.getData()?.label || '', vertices: edge.getVertices().map((p) => ({ x: p.x, y: p.y })), ...(edge.getData()?.appearance ? { appearance: structuredClone(edge.getData().appearance) } : {}) })),
  };
}
function signature(data = snapshot()) {
  return JSON.stringify(data, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
function loadTopology(data: Snapshot, fit = false) {
  loading = true; clearTimeout(recordTimer); selected = null;
  values.clear(); historyValues.clear(); runtimeStatuses.clear();
  graph.clearCells(); data.nodes.forEach(addDevice); data.edges.forEach(addLink);
  graph.getEdges().forEach((edge) => edge.setVisible(filters.has(edge.getData()?.kind || 'ethernet'), { runtime: true }));
  loading = false;
  updateRuntime(); renderInspector(); updateSaveStatus(); updateCounts();
  $('#canvas-empty').hidden = data.nodes.length > 0;
  if (fit) requestAnimationFrame(fitGraph);
}
function recordChange() {
  if (loading) return;
  clearTimeout(recordTimer);
  recordTimer = setTimeout(flushHistory, 250);
}
function flushHistory() {
  clearTimeout(recordTimer);
  const current = snapshot();
  if (!undoStack.length || signature(current) !== signature(undoStack.at(-1)!)) {
    undoStack.push(current); if (undoStack.length > 51) undoStack.shift(); redoStack = [];
  }
  updateSaveStatus(); updateHistoryButtons(); updateCounts();
  $('#canvas-empty').hidden = graph.getNodes().length > 0;
}
function updateHistoryButtons() {
  const undo = document.querySelector<HTMLButtonElement>('[data-action="undo"]');
  if (undo) undo.disabled = undoStack.length < 2;
  const redo = document.querySelector<HTMLButtonElement>('[data-action="redo"]');
  if (redo) redo.disabled = !redoStack.length;
  const del = document.querySelector<HTMLButtonElement>('[data-action="delete"]');
  if (del) del.disabled = !selected;
}
function updateSaveStatus() {
  const dirty = signature() !== savedSignature;
  $('#save-status').innerHTML = `${icon(dirty ? 'Clock3' : 'Check', 13)}${dirty ? '有未保存的布局' : '布局已保存'}`;
  $('#save-status').classList.toggle('dirty', dirty);
}
function fitGraph() {
  if (!graph.getNodes().length) { graph.zoomTo(1); graph.translate(80, 80); return; }
  graph.zoomToFit({ padding: { top: 60, right: 38, bottom: 50, left: 38 }, maxScale: 1 });
  updateZoom();
}
function updateZoom() { $('#zoom-label').textContent = `${Math.round(graph.zoom() * 100)}%`; }

function selectCell(cell: Cell | null) {
  if (selected?.isEdge()) selected.removeTools();
  selected = cell;
  if (cell?.isEdge() && mode === 'edit') cell.addTools([
    { name: 'vertices', args: { attrs: { r: 4, fill: '#fff', stroke: '#20866f', strokeWidth: 2 } } },
    { name: 'segments', args: { attrs: { fill: '#20866f', stroke: '#fff', width: 14, height: 5, x: -7, y: -2.5 }, threshold: 25, anchor: () => ({ name: 'center' }) } },
  ]);
  applyHighlight(); renderInspector(); updateHistoryButtons();
}
function applyHighlight() {
  $('#graph').querySelectorAll<HTMLElement>('.device-card').forEach((el) => el.classList.toggle('selected', el.dataset.deviceNode === selected?.id));
  graph.getEdges().forEach((edge) => {
    const active = !selected || selected.id === edge.id || (selected.isNode() && (edge.getSourceCellId() === selected.id || edge.getTargetCellId() === selected.id));
    const el = graph.findViewByCell(edge)?.container as SVGElement | undefined;
    if (el) { el.style.opacity = active ? '1' : '.22'; el.classList.toggle('selected-edge', selected?.id === edge.id); }
  });
}

function renderSidebar() {
  $('#sidebar-content').innerHTML = mode === 'edit' ? `<div class="nav-label">节点模板 <span>点击 / 拖入</span></div><div class="device-library">${Object.entries(devices).map(([kind, def]) => `<button class="library-item" draggable="true" data-device="${esc(kind)}"><span>${icon(def.icon, 19)}</span><span>${esc(def.label)}<small>${esc(def.en)}</small></span>${icon('Plus', 13)}</button>`).join('')}</div><button class="button template-add" data-action="new-template">${icon('Plus', 14)}新建节点模板</button><div class="library-help">连接点可供多条线缆共用。<br>相同类型的连接点可以连接。</div>` : `<div class="nav-label">当前拓扑</div><div class="site-info"><span class="site-info-icon">${icon('Network', 28)}</span><strong>${esc(activeDocument.name)}</strong><p>${esc(categoryLabel(activeDocument.category))}</p><div><span>文件格式</span><b>Topology v2</b></div><div><span>节点模板</span><b>${activeDocument.templates.length} 个</b></div><div><span>数据来源</span><b class="mock-source">模拟数据</b></div></div><div class="sidebar-tip"><span>从连接，到洞察。</span><p>${esc(activeDocument.description || '制作、管理和复用你的拓扑。')}</p><button data-action="document-info">拓扑信息 ${icon('ArrowUpRight', 14)}</button></div>`;
}

function setMode(next: Mode) {
  mode = next;
  document.body.dataset.mode = mode;
  document.querySelectorAll<HTMLElement>('.mode-switch button').forEach((el) => el.classList.toggle('active', el.dataset.action === mode));
  document.querySelectorAll<HTMLElement>('nav .nav-item').forEach((el) => el.classList.toggle('active', el.dataset.action === mode));
  $('#crumb-mode').textContent = mode === 'edit' ? '拓扑编辑' : '拓扑总览';
  $('#page-title').innerHTML = mode === 'edit' ? '把复杂连接，编排得井井有条<span class="heading-dot">.</span>' : '让每一条连接，清晰可见<span class="heading-dot">.</span>';
  $('#page-description').textContent = mode === 'edit' ? '拖入设备，连接端口，手动调整每一段走线。你的布局，由你决定。' : '节点、连接关系与实时运行状态，尽在一张图中。';
  $('#canvas-mode').innerHTML = `${icon(mode === 'edit' ? 'PencilRuler' : 'LockKeyhole', 13)}${mode === 'edit' ? '编辑模式 · 10 px 网格吸附' : '首页展示 · 布局已锁定'}`;
  $('#edit-tools').hidden = mode !== 'edit';
  $('#footer-mode').textContent = mode === 'edit' ? '编辑模式' : '监控模式';
  $('#footer-hint').textContent = mode === 'edit' ? '拖动设备布局 · 从端口连线 · 选中连线调整拐点' : '点击设备查看参数 · 滚轮缩放 · 拖动画布平移';
  graph.getEdges().forEach((e) => e.removeTools());
  renderSidebar(); selectCell(selected); updateDocumentChrome();
}

function resetOutage() {
  outage = false;
  outageNodeId = null;
  const el = document.querySelector<HTMLElement>('[data-action="outage"]')!;
  el.classList.remove('outage-active');
  el.innerHTML = `${icon('Unplug', 16)}<span>离线演示</span>`;
}

function readCableControls(): CableAppearance {
  return parseCableAppearance({
    style: $<HTMLSelectElement>('#edge-cable-style').value,
    width: Number($<HTMLInputElement>('#edge-cable-width').value),
    color: $<HTMLInputElement>('#edge-cable-color').value,
    arrows: $<HTMLInputElement>('#edge-cable-arrows').checked,
  });
}

function renderCableSettings(edge: Edge, kind: LinkKind) {
  const appearance = cableAppearance(kind, edge.getData()?.appearance);
  return `<div class="cable-preview" id="edge-cable-preview">${cablePreview(appearance)}</div>${mode === 'edit' ? `
    <label class="field">线缆样式<select id="edge-cable-style">${Object.entries(cableStyles).map(([key, def]) => `<option value="${key}" ${key === appearance.style ? 'selected' : ''}>${def.label}</option>`).join('')}</select></label>
    <label class="field cable-width-label">线缆粗细 <output id="edge-cable-width-value">${appearance.width} px</output><input type="range" id="edge-cable-width" min="1" max="14" step="1" value="${appearance.width}" /></label>
    <div class="cable-color-row"><label for="edge-cable-color">线缆颜色</label><input type="color" id="edge-cable-color" value="${appearance.color}" /><span id="edge-cable-color-value">${appearance.color}</span></div>
    <label class="cable-arrows"><input type="checkbox" id="edge-cable-arrows" ${appearance.arrows ? 'checked' : ''} />显示方向箭头</label>
    <p class="cable-style-description" id="edge-cable-description">${cableStyles[appearance.style].description}</p>` : `<div class="cable-summary"><span>${cableStyles[appearance.style].label}</span><span>${appearance.width} px${appearance.arrows ? ' · 有向' : ''}</span></div>`}`;
}

function updateCablePreview(event: Event) {
  const target = event.target as HTMLElement;
  if (!['edge-cable-style', 'edge-cable-width', 'edge-cable-color', 'edge-cable-arrows'].includes(target.id)) return;
  const appearance = readCableControls();
  $('#edge-cable-preview').innerHTML = cablePreview(appearance);
  $('#edge-cable-width-value').textContent = `${appearance.width} px`;
  $('#edge-cable-color-value').textContent = appearance.color;
  $('#edge-cable-description').textContent = cableStyles[appearance.style].description;
}
document.addEventListener('input', updateCablePreview);
document.addEventListener('change', updateCablePreview);

function connectedPortIds(node: Node) {
  return new Set((graph.getConnectedEdges(node) || []).map((edge) => edge.getSourceCellId() === node.id ? edge.getSourcePortId() : edge.getTargetPortId()));
}

function renderDevicePorts(node: Node) {
  const data = node.getData<DeviceData>();
  const ports = devicePorts(data);
  const used = connectedPortIds(node);
  const row = (port: typeof ports[number]) => `<div><i style="background:${linkTypes[port.kind].color}"></i><strong title="${esc(port.id)}">${esc(port.label)}</strong><span>${portSides[port.side]} · ${used.has(port.id) ? '已连接' : '空闲'}</span></div>`;
  return `<div class="detail-section"><h4>连接端口 <span>${ports.length} 个 / 已连接 ${used.size}</span></h4>${mode === 'edit' ? `<button class="button full-width port-config-button" data-action="configure-ports">${icon('Settings', 14)}配置端口 / 批量新增</button>` : ''}<div class="port-side-summary">${Object.entries(portSides).map(([key, label]) => `${label} ${ports.filter((p) => p.side === key).length}`).join(' · ')}</div><div class="port-list">${ports.slice(0, 6).map(row).join('') || '<p class="muted">暂无端口</p>'}</div>${ports.length > 6 ? `<details class="port-more"><summary>展开其余 ${ports.length - 6} 个端口</summary><div class="port-list">${ports.slice(6).map(row).join('')}</div></details>` : ''}</div>`;
}

function renderInspector() {
  const panel = $('#inspector');
  if (!selected) {
    panel.innerHTML = `<div class="inspector-header"><span>拓扑概览</span><span class="small-kicker">OVERVIEW</span></div><div class="overview-visual"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span>${icon('Network', 33)}</span><i></i><i></i><i></i></div><div class="overview-title"><strong>连接你的业务</strong><p>选择一个设备，<br>查看运行参数与连接详情。</p></div><div class="overview-rows"><div><span>拓扑分类</span><strong>${esc(categoryLabel(activeDocument.category))}</strong></div><div><span>设备数量</span><strong id="overview-nodes">${graph.getNodes().length} 台</strong></div><div><span>连接数量</span><strong id="overview-edges">${graph.getEdges().length} 条</strong></div><div><span>数据模式</span><strong class="green-text">模拟实时</strong></div></div><div class="inspector-callout">${icon('MousePointer2', 17)}<p>${mode === 'edit' ? '点击左侧设备添加到画布；选中连线可拖动拐点和线段。' : '首页锁定布局，支持查看设备和链路。切换“拓扑编辑”可自由调整。'}</p></div><button class="button inspector-bottom-button" data-action="${mode === 'edit' ? 'monitor' : 'edit'}">${icon(mode === 'edit' ? 'Activity' : 'PencilRuler', 16)}${mode === 'edit' ? '预览首页效果' : '进入拓扑编辑'}${icon('ArrowUpRight', 14)}</button>`;
    return;
  }
  if (selected.isEdge()) {
    const edge = selected;
    const kind = (edge.getData()?.kind || 'ethernet') as LinkKind;
    const source = graph.getCellById(edge.getSourceCellId()) as Node;
    const target = graph.getCellById(edge.getTargetCellId()) as Node;
    panel.innerHTML = `
      <div class="inspector-header"><span>链路详情</span>${button('deselect', '关闭详情', 'X')}</div>
      <div class="detail-identity"><span class="detail-device-icon" style="color:${linkTypes[kind].color}">${icon('Cable', 27)}</span><h3>${esc(edge.getData()?.label || linkTypes[kind].label)}</h3><span class="type-caption">${linkTypes[kind].label} / ${linkTypes[kind].short}</span></div>
      <div class="detail-section"><h4>连接端点</h4>
        <div class="endpoint"><span class="tiny-dot green"></span><div><strong>${esc(source.getData<DeviceData>().title)}</strong><small>${esc(edge.getSourcePortId().toUpperCase())}</small></div></div><div class="endpoint-line"></div>
        <div class="endpoint"><span class="tiny-dot green"></span><div><strong>${esc(target.getData<DeviceData>().title)}</strong><small>${esc(edge.getTargetPortId().toUpperCase())}</small></div></div>
      </div>
      <div class="detail-section"><h4>${mode === 'edit' ? '链路与线缆设置' : '线缆外观'}</h4>
        ${mode === 'edit' ? `<label class="field">链路名称<input id="edge-label-input" maxlength="80" value="${esc(edge.getData()?.label || '')}" /></label>` : ''}
        ${renderCableSettings(edge, kind)}
        ${mode === 'edit' ? `<button class="button full-width" data-action="apply-edge">${icon('Check', 15)}应用修改</button>` : ''}
      </div>
      ${mode === 'edit' ? `<div class="inspector-callout">${icon('Move', 17)}<p>拖动绿色圆点调整拐点，拖动线段中间的手柄改变走线。点击线条添加拐点，双击拐点删除。首页展示会隐藏端口与编辑手柄。</p></div><button class="button danger inspector-bottom-button" data-action="delete">${icon('Trash2', 15)}删除这条连线</button>` : `<div class="inspector-callout">${icon('Info', 17)}<p>线缆保留编辑时设置的样式。真实链路状态需要接入后端采集数据。</p></div>`}
    `;
    return;
  }
  const node = selected as Node;
  const data = node.getData<DeviceData>();
  const def = devices[data.kind];
  const status = runtimeStatus(node);
  const connected = graph.getConnectedEdges(node) || [];
  panel.innerHTML = `<div class="inspector-header"><span>${mode === 'edit' ? '设备属性' : '设备详情'}</span>${button('deselect', '关闭详情', 'X')}</div><div class="detail-identity"><span class="detail-device-icon kind-${data.kind}">${icon(def.icon, 28)}</span><h3>${esc(data.title)}</h3><span class="type-caption">${esc(def.model)}</span><span class="status-pill ${status}" id="detail-status"><i></i>${statusLabels[status]}</span></div>${mode === 'edit' ? `<div class="detail-section"><h4>基本信息</h4><label class="field">设备名称<input id="device-title" maxlength="60" value="${esc(data.title)}" /></label><label class="field">绑定设备 ID<input id="device-id" maxlength="80" value="${esc(data.deviceId)}" /></label><label class="field">管理地址<input id="device-address" maxlength="100" value="${esc(data.address)}" /></label><label class="field">演示状态<select id="device-status">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${key === data.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label><h4 class="metrics-heading">卡片展示参数 <span>最多 2 项</span></h4><div class="metric-options">${def.metrics.map((m) => `<label><input type="checkbox" name="visible-metric" value="${m.key}" ${data.visibleMetrics.includes(m.key) ? 'checked' : ''}/>${m.label}</label>`).join('')}</div>${renderBindingControls(data)}<button class="button primary full-width" data-action="apply-device">${icon('Check', 15)}应用修改</button></div>${renderDevicePorts(node)}<button class="button danger inspector-bottom-button" data-action="delete">${icon('Trash2', 15)}删除设备及连线</button>` : `<div class="detail-section"><h4>实时参数 <span class="green-text">SIMULATED</span></h4><div class="detail-metrics">${def.metrics.map((m) => `<div><span>${m.label}</span><strong data-detail-metric="${m.key}">${status === 'offline' ? '—' : metricValue(node, m.key)}<small>${status === 'offline' ? '' : m.unit}</small></strong></div>`).join('')}</div><div class="trend-heading"><span>${def.metrics[0].label}趋势</span><small>最近 30 次采样</small></div><svg class="trend-chart" viewBox="0 0 210 52" aria-label="参数趋势"><path class="trend-grid" d="M0 12H210 M0 32H210 M0 51H210"/><path id="trend-area"/><path id="trend-line"/></svg></div>${renderDevicePorts(node)}<div class="detail-section"><h4>设备信息</h4><div class="detail-info"><div><span>设备 ID</span><strong>${esc(data.deviceId)}</strong></div><div><span>管理地址</span><strong>${esc(data.address || '未配置')}</strong></div><div><span>关联链路</span><strong>${connected.length} 条</strong></div></div></div><div class="detail-section"><h4>连接关系</h4><div class="connection-list">${connected.map((edge) => { const other = graph.getCellById(edge.getSourceCellId() === node.id ? edge.getTargetCellId() : edge.getSourceCellId()); return `<button data-select-cell="${esc(edge.id)}"><span style="background:${linkTypes[(edge.getData()?.kind || 'ethernet') as LinkKind].color}"></span>${esc(other?.getData<DeviceData>()?.title || '未连接')}${icon('ChevronRight', 13)}</button>`; }).join('') || '<p class="muted">暂无连接</p>'}</div></div>`}`;
  updateTrend();
}

function updateCounts() {
  const nodes = graph.getNodes();
  const offline = nodes.filter((n) => runtimeStatus(n) === 'offline').length;
  const alarms = nodes.filter((n) => runtimeStatus(n) !== 'normal').length;
  $('#stat-total').textContent = String(nodes.length);
  $('#stat-online').textContent = String(nodes.length - offline);
  $('#stat-percent').textContent = `${nodes.length ? Math.round((nodes.length - offline) / nodes.length * 100) : 0}%`;
  $('#stat-alarms').textContent = String(alarms);
  $('#stat-links').textContent = String(graph.getEdges().length);
  $('#nav-alarms').textContent = String(alarms);
  $('#online-description').textContent = offline ? `${offline} 台设备通信中断（模拟）` : '所有设备通信正常';
  $('#alarm-description').textContent = alarms ? `${alarms} 台设备需要关注` : '暂无设备告警';
  if (document.querySelector('#overview-nodes')) $('#overview-nodes').textContent = `${nodes.length} 台`;
  if (document.querySelector('#overview-edges')) $('#overview-edges').textContent = `${graph.getEdges().length} 条`;
}

function updateRuntime() {
  graph.getNodes().forEach((node, index) => {
    const data = node.getData<DeviceData>();
    const def = devices[data.kind];
    const status = runtimeStatus(node);
    if (!paused || !values.has(node.id)) {
      const next: Record<string, number> = {};
      def.metrics.forEach((m, j) => { next[m.key] = m.base + Math.sin(tick * .67 + index * 1.6 + j) * m.jitter; });
      values.set(node.id, next);
      const history = historyValues.get(node.id) || [];
      if (status !== 'offline') history.push(next[def.metrics[0].key]);
      historyValues.set(node.id, history.slice(-30));
    }
    const card = [...$('#graph').querySelectorAll<HTMLElement>('[data-device-node]')].find((el) => el.dataset.deviceNode === node.id);
    if (card) {
      card.classList.remove('normal', 'warning', 'offline'); card.classList.add(status);
      card.querySelector<HTMLElement>('.device-status-text')!.textContent = status === 'warning' && data.kind === 'amplifier' ? '温度偏高 · 请关注' : statusLabels[status];
      card.querySelector<HTMLElement>('.device-status-dot')!.title = statusLabels[status];
      card.querySelectorAll<HTMLElement>('[data-metric]').forEach((el) => {
        const m = def.metrics.find((entry) => entry.key === el.dataset.metric)!;
        el.innerHTML = status === 'offline' ? '—' : `${metricValue(node, m.key)}<small>${m.unit}</small>`;
      });
    }
    if (selected?.id === node.id && mode === 'monitor') {
      document.querySelectorAll<HTMLElement>('[data-detail-metric]').forEach((el) => { const m = def.metrics.find((entry) => entry.key === el.dataset.detailMetric)!; el.innerHTML = status === 'offline' ? '—' : `${metricValue(node, m.key)}<small>${m.unit}</small>`; });
      const badge = document.querySelector<HTMLElement>('#detail-status');
      if (badge) { badge.className = `status-pill ${status}`; badge.innerHTML = `<i></i>${statusLabels[status]}`; }
    }
  });
  graph.getEdges().forEach((edge) => {
    // Update the full cable material only when appearance or endpoint status changes.
    renderCable(edge);
  });
  updateTrend(); updateCounts();
  $('#update-time').textContent = `${paused ? '已暂停 · 最后采样' : '数据更新'} ${time(lastUpdate)}`;
}
function updateTrend() {
  if (!selected?.isNode() || mode !== 'monitor' || !document.querySelector('#trend-line')) return;
  const node = selected;
  const history = historyValues.get(node.id) || [];
  if (history.length < 2 || runtimeStatus(node) === 'offline') { $('#trend-line').setAttribute('d', ''); $('#trend-area').setAttribute('d', ''); return; }
  const def = devices[node.getData<DeviceData>().kind].metrics[0];
  const range = Math.max(def.jitter, .1) * 1.4;
  const points = history.map((v, i) => `${i / (history.length - 1) * 210},${26 - (v - def.base) / range * 20}`);
  const path = `M${points.join(' L')}`;
  $('#trend-line').setAttribute('d', path);
  $('#trend-area').setAttribute('d', `${path} L210,52 L0,52 Z`);
}

function toast(message: string, error = false) {
  clearTimeout(toastTimer); const el = $('#toast');
  el.innerHTML = `${icon(error ? 'CircleAlert' : 'CircleCheck', 18)}<span>${esc(message)}</span>`;
  el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
function showModal(title: string, content: string) {
  portEditor = null; portEditorNode = null;
  const root = $('#modal-content'); root.onclick = null; root.oninput = null; root.onchange = null;
  $('#modal').classList.remove('port-config-modal', 'library-modal');
  $('.modal-footer').innerHTML = '<button class="button primary" data-action="close-modal">知道了</button>';
  $('#modal-title').textContent = title; $('#modal-content').innerHTML = content;
  const dialog = $<HTMLDialogElement>('#modal'); if (!dialog.open) dialog.showModal();
}
$<HTMLDialogElement>('#modal').addEventListener('close', () => {
  portEditor = null; portEditorNode = null;
  const root = $('#modal-content'); root.onclick = null; root.oninput = null; root.onchange = null;
});
function showAlarms() {
  const alarms = graph.getNodes().filter((n) => runtimeStatus(n) !== 'normal');
  showModal('当前告警', `<p class="modal-description">以下状态由原型模拟，用于验证首页的告警展示。</p>${alarms.map((n) => `<button class="alarm-row" data-focus-device="${esc(n.id)}"><span class="status-pill ${runtimeStatus(n)}">${icon(runtimeStatus(n) === 'offline' ? 'Unplug' : 'CircleAlert', 17)}</span><span><strong>${esc(n.getData<DeviceData>().title)}</strong><small>${runtimeStatus(n) === 'offline' ? '设备通信中断 · 离线演示' : n.getData<DeviceData>().kind === 'amplifier' ? '温度偏高 · 演示告警' : '设备告警 · 演示状态'}</small></span>${icon('ArrowUpRight', 16)}</button>`).join('') || '<div class="empty-alarms">' + icon('CircleCheck', 36) + '<p>所有设备运行正常</p></div>'}`);
}
function addFromLibrary(kind: DeviceKind, point?: { x: number; y: number }) {
  if (mode !== 'edit') return;
  if (graph.getNodes().length >= 300) { toast('每张拓扑最多添加 300 个节点', true); return; }
  const rect = $('#graph').getBoundingClientRect();
  const p = point || graph.clientToLocal(rect.x + rect.width / 2 - NODE_WIDTH * graph.zoom() / 2, rect.y + rect.height / 2 - NODE_HEIGHT * graph.zoom() / 2);
  const count = graph.getNodes().length + 1;
  const node = addDevice(newDevice(kind, p.x, p.y, count));
  selectCell(node); updateRuntime(); flushHistory(); toast(`已添加${devices[kind].label}，可拖动调整位置`);
}

function categoryLabel(category: string) { return categories[category as keyof typeof categories] || category; }
function captureDocument(): TopologyDocument {
  return { ...activeDocument, updatedAt: new Date().toISOString(), templates: templatesFromDefinitions(devices), topology: snapshot() };
}
function commitLibrary(next: TopologyLibrary) {
  try { library = saveLibrary(localStorage, next); return true; }
  catch (error) { toast(`保存失败：${error instanceof Error ? error.message : '浏览器存储不可用'}。当前修改仍在画布，可导出备份`, true); return false; }
}
function persistCurrent() {
  flushHistory();
  const current = captureDocument();
  if (!commitLibrary({ ...library, documents: library.documents.map((d) => d.id === current.id ? current : d) })) return false;
  activeDocument = current; savedSignature = signature(); updateSaveStatus(); return true;
}
function openDocument(id: string) {
  const doc = library.documents.find((d) => d.id === id);
  if (!doc) return;
  if (activeDocument && library.documents.some((d) => d.id === activeDocument.id)) documentHistories.set(activeDocument.id, { undo: undoStack, redo: redoStack });
  activeDocument = structuredClone(doc); installEditorTemplates(activeDocument);
  resetOutage(); tick = 0; lastUpdate = new Date();
  filters.clear(); Object.keys(linkTypes).forEach((kind) => filters.add(kind as LinkKind));
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((button) => { button.classList.add('active'); button.setAttribute('aria-pressed', 'true'); });
  loadTopology(activeDocument.topology, true);
  const history = documentHistories.get(id);
  undoStack = history?.undo || [snapshot()]; redoStack = history?.redo || [];
  savedSignature = signature(); setMode(mode); updateSaveStatus(); updateHistoryButtons();
}
function updateDocumentChrome() {
  if (!activeDocument) return;
  $('#library-count').textContent = String(library.documents.length);
  $('.station-picker').innerHTML = `<span class="station-avatar">${icon('Network', 17)}</span><span><strong title="${esc(activeDocument.name)}">${esc(activeDocument.name)}</strong><small>${esc(categoryLabel(activeDocument.category))}</small></span>${icon('ChevronDown', 14)}`;
  $('#crumb-document').textContent = activeDocument.name;
  $('.eyebrow').textContent = `TOPOLOGY WORKSPACE / ${categoryLabel(activeDocument.category)}`;
  $('.canvas-watermark').innerHTML = `${esc(activeDocument.name)}<span>${esc(categoryLabel(activeDocument.category))}</span>`;
  $('.panel-title h2').textContent = activeDocument.name;
  $('.panel-title .tag').textContent = categoryLabel(activeDocument.category);
  document.title = `${activeDocument.name} · Topology`;
  document.body.dataset.documentId = activeDocument.id;
}
function showLibrary() {
  showModal('拓扑库', `<div class="library-dialog-heading"><p>独立保存每张图的节点、模板、数据绑定和手动走线。切换时自动保存当前图。</p><button class="button primary" data-action="new-document">${icon('Plus', 15)}新建拓扑</button></div><div class="document-grid">${library.documents.map((d) => `<article class="document-card ${d.id === activeDocument.id ? 'current' : ''}"><div class="document-card-top">${icon(d.category === 'satellite' ? 'Layers' : d.category === 'datacenter' ? 'Server' : 'Network', 25)}<span>${esc(categoryLabel(d.category))}</span>${d.id === activeDocument.id ? '<b>当前</b>' : ''}</div><h3>${esc(d.name)}</h3><p>${esc(d.description || '暂无说明')}</p><div class="document-card-meta">${d.topology.nodes.length} 个节点 · ${d.topology.edges.length} 条连接<span>${new Date(d.updatedAt).toLocaleDateString('zh-CN')}</span></div><div class="document-card-actions">${['open', 'viewer', 'rename', 'copy', 'delete'].map((action, i) => `<button type="button" data-document-action="${action}" data-document-id="${esc(d.id)}" ${action === 'delete' && library.documents.length === 1 ? 'disabled title="至少保留一张图"' : ''}>${['打开', '独立预览', '信息', '复制', '删除'][i]}</button>`).join('')}</div></article>`).join('')}</div>`);
  $('#modal').classList.add('library-modal');
}
function showDocumentInfo(id: string) {
  const doc = library.documents.find((d) => d.id === id)!;
  showModal('拓扑信息', `<input type="hidden" id="metadata-document-id" value="${esc(id)}"/><label class="field">名称<input id="metadata-name" maxlength="100" value="${esc(doc.name)}" /></label><label class="field">分类<input id="metadata-category" maxlength="60" value="${esc(doc.category)}" list="document-categories" /></label><datalist id="document-categories">${Object.keys(categories).map((key) => `<option value="${key}">${categoryLabel(key)}</option>`).join('')}</datalist><label class="field">说明<textarea id="metadata-description" maxlength="1000" rows="4">${esc(doc.description)}</textarea></label><p class="modal-description">文件格式：Topology v2<br>文档 ID：${esc(doc.id)}</p><button class="button primary" data-action="apply-document-info">保存信息</button>`);
}
function openIndependentViewer(id: string) {
  if (!persistCurrent()) return;
  const url = new URL('./viewer.html', window.location.href); url.searchParams.set('document', id);
  window.open(url, '_blank', 'noopener');
}
function handleDocumentAction(action: string, id: string) {
  if (!library.documents.some((d) => d.id === id)) return;
  if (action === 'rename') { showDocumentInfo(id); return; }
  if (action === 'viewer') { openIndependentViewer(id); return; }
  if (action === 'delete') {
    const doc = library.documents.find((d) => d.id === id)!;
    showModal('删除拓扑', `<p class="modal-description">删除“${esc(doc.name)}”及其本地配置。需要保留时请先打开并导出通用文件。</p><button class="button danger" data-document-action="confirm-delete" data-document-id="${esc(id)}">确认删除这张拓扑</button>`); return;
  }
  if (!persistCurrent()) return;
  if (action === 'open') {
    if (commitLibrary({ ...library, activeId: id })) { openDocument(id); $<HTMLDialogElement>('#modal').close(); }
  } else if (action === 'copy') {
    const copy = duplicateDocument(library.documents.find((d) => d.id === id)!);
    if (commitLibrary({ ...library, activeId: copy.id, documents: [...library.documents, copy] })) { openDocument(copy.id); showLibrary(); }
  } else if (action === 'confirm-delete') {
    const deletingActive = id === activeDocument.id;
    try { if (commitLibrary(removeDocument(library, id))) { documentHistories.delete(id); if (deletingActive) openDocument(library.activeId); showLibrary(); updateDocumentChrome(); } }
    catch (error) { toast(error instanceof Error ? error.message : '无法删除', true); }
  }
}
function renderBindingControls(data: DeviceData) {
  const binding = data.binding || { source: data.deviceId, fields: Object.fromEntries(devices[data.kind].metrics.map((m) => [m.key, m.key])), statusField: 'status' };
  return `<details class="binding-fields"><summary>数据绑定 · 用于独立展示</summary><label class="field">业务对象 ID<input id="binding-source" maxlength="100" value="${esc(binding.source)}" /></label><label class="field">参数字段映射（JSON）<textarea id="binding-fields" rows="4">${esc(JSON.stringify(binding.fields, null, 2))}</textarea></label><label class="field">状态字段<input id="binding-status" value="${esc(binding.statusField || '')}" placeholder="例如 status 或 health.state" /></label><label class="field">状态映射（JSON，可留空）<textarea id="binding-status-map" rows="3">${esc(JSON.stringify(binding.statusMap || {}, null, 2))}</textarea></label><p>左侧为模板参数标识，右侧为数据路径。状态支持 normal / warning / offline，也可映射业务状态。</p></details>`;
}

function captureExportState(): ExportState {
  return Object.fromEntries(graph.getNodes().map((node) => {
    const data = node.getData<DeviceData>();
    const status = runtimeStatus(node);
    return [node.id, { status, values: Object.fromEntries(devices[data.kind].metrics.map((m) => [m.key, values.get(node.id)?.[m.key] ?? m.base])), label: status === 'warning' && data.kind === 'amplifier' ? '温度偏高 · 请关注' : statusLabels[status] }];
  }));
}

let exporting = false;
async function exportTopology(format: 'json' | 'svg' | 'png' | 'html') {
  if (exporting) return;
  exporting = true;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.export-format')];
  const status = document.querySelector<HTMLElement>('#export-status');
  buttons.forEach((button) => { button.disabled = true; });
  if (status) status.textContent = '正在生成文件…';
  try {
    const definition = captureDocument(), state = captureExportState();
    let blob: Blob;
    if (format === 'json') blob = new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' });
    else if (format === 'html') blob = new Blob([await standaloneHtml(definition, state)], { type: 'text/html;charset=utf-8' });
    else {
      const image = graphSvg(graph, definition, state);
      blob = format === 'svg' ? new Blob([image.svg], { type: 'image/svg+xml;charset=utf-8' }) : await svgToPng(image);
    }
    downloadBlob(blob, exportFilename(definition.name, format === 'json' ? 'topology.json' : format));
    if (status?.isConnected) { status.textContent = '文件已生成，已开始下载。'; status.classList.remove('error'); }
    toast(format === 'html' ? 'HTML 已导出，可离线打开或嵌入其他软件' : `${format.toUpperCase()} 已导出`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败，请重试';
    if (status?.isConnected) { status.textContent = message; status.classList.add('error'); }
    toast(message, true);
  } finally {
    buttons.forEach((button) => { button.disabled = button.dataset.requiresNodes === 'true' && !graph.getNodes().length; });
    exporting = false;
  }
}

const actions: Record<string, () => void> = {
  'export-options': () => showModal('导出拓扑', `<p class="modal-description">导出整张拓扑，包含尚未保存的修改。图片和网页保留导出时的参数、状态快照。</p><div class="export-formats">${[
    ['json', 'JSON', '通用拓扑文件', '包含节点模板和数据绑定，可导入后继续编辑。'],
    ['png', 'PNG', '高清图片', '默认 2 倍分辨率，适合报告、文档和分享。'],
    ['svg', 'SVG', '矢量图片', '可缩放的矢量图，适合大图展示和排版。'],
    ['html', 'HTML', '独立网页', '单文件离线打开，支持缩放、平移和宿主数据更新。'],
  ].map(([format, tag, title, description]) => `<button class="export-format" data-action="${format === 'json' ? 'export' : `export-${format}`}" data-requires-nodes="${format === 'png' || format === 'svg'}" ${(format === 'png' || format === 'svg') && !graph.getNodes().length ? 'disabled' : ''}><span>${tag}</span><strong>${title}</strong><small>${description}</small>${icon('Download', 17)}</button>`).join('')}</div><p class="export-note">HTML 中的数据默认停留在导出时刻，接入宿主数据后可实时更新。</p><p id="export-status" role="status" aria-live="polite"></p>`),
  'export-png': () => { void exportTopology('png'); },
  'export-svg': () => { void exportTopology('svg'); },
  'export-html': () => { void exportTopology('html'); },
  library: showLibrary,
  viewer: () => openIndependentViewer(activeDocument.id),
  'document-info': () => showDocumentInfo(activeDocument.id),
  'new-document': () => showModal('新建拓扑', `<label class="field">拓扑名称<input id="new-document-name" maxlength="100" placeholder="例如：运控中心机房" /></label><label class="field">起始内容<select id="new-document-kind">${Object.entries(categories).map(([key, label]) => `<option value="${key}">${label}${key === 'general' ? ' · 空白画布' : ' · 示例'}</option>`).join('')}</select></label><p class="modal-description">每张图独立保存。通用节点模板可用于设备连接、业务逻辑和子系统关系。</p><button class="button primary" data-action="create-document">创建并打开</button>`),
  'create-document': () => {
    const name = $<HTMLInputElement>('#new-document-name').value.trim();
    if (!name) { toast('请填写拓扑名称', true); return; }
    const category = $<HTMLSelectElement>('#new-document-kind').value;
    if (!persistCurrent()) return;
    const doc = sampleDocument(category, name);
    if (commitLibrary({ ...library, activeId: doc.id, documents: [...library.documents, doc] })) { openDocument(doc.id); $<HTMLDialogElement>('#modal').close(); setMode('edit'); }
  },
  'apply-document-info': () => {
    const id = $<HTMLInputElement>('#metadata-document-id').value;
    const name = $<HTMLInputElement>('#metadata-name').value.trim();
    const category = $<HTMLInputElement>('#metadata-category').value.trim();
    const description = $<HTMLTextAreaElement>('#metadata-description').value;
    if (!name || !category) { toast('请填写名称和分类', true); return; }
    if (!persistCurrent()) return;
    const documents = library.documents.map((d) => d.id === id ? { ...d, name, category, description, updatedAt: new Date().toISOString() } : d);
    if (commitLibrary({ ...library, documents })) { activeDocument = structuredClone(library.documents.find((d) => d.id === activeDocument.id)!); updateDocumentChrome(); renderSidebar(); showLibrary(); }
  },
  'new-template': () => showModal('新建节点模板', `<label class="field">模板名称<input id="template-name" maxlength="40" placeholder="例如：电源控制模块" /></label><label class="field">图标<select id="template-icon">${iconNames.map((name) => `<option value="${name}" ${name === 'Cpu' ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label class="field">四边连接点类型<select id="template-link">${Object.entries(linkTypes).map(([key, value]) => `<option value="${key}" ${key === 'logical' ? 'selected' : ''}>${value.label}</option>`).join('')}</select></label><label class="field">参数定义：每行“标识,名称,单位,小数位数”<textarea id="template-metrics" rows="5" placeholder="voltage,电压,V,1&#10;load,负载,%,1"></textarea></label><p class="modal-description">可不填写参数。每个模板最多 20 项参数，节点卡片可选择其中最多 2 项。模板随拓扑文件导出。</p><button class="button primary" data-action="create-template">创建模板</button>`),
  'create-template': () => {
    try {
      const name = $<HTMLInputElement>('#template-name').value.trim();
      const kind = $<HTMLSelectElement>('#template-link').value as LinkKind;
      const metrics = $<HTMLTextAreaElement>('#template-metrics').value.split('\n').filter((line) => line.trim()).map((line) => { const [key, label, unit = '', decimals = '1'] = line.split(/[,，]/).map((part) => part.trim()); return { key, label, unit, decimals: Number(decimals) }; });
      const template = parseTemplate({ id: newId('custom'), version: 1, label: name, en: 'CUSTOM', model: name, icon: $<HTMLSelectElement>('#template-icon').value, metrics, ports: Object.entries(portSides).map(([side, label]) => ({ id: side, label, side, kind })) });
      if (!persistCurrent()) return;
      const doc = { ...activeDocument, templates: [...activeDocument.templates, template] };
      if (commitLibrary({ ...library, documents: library.documents.map((d) => d.id === doc.id ? doc : d) })) { activeDocument = doc; installEditorTemplates(doc); renderSidebar(); updateDocumentChrome(); $<HTMLDialogElement>('#modal').close(); toast('节点模板已加入当前拓扑，可从左侧拖入'); }
    } catch (error) { toast(error instanceof Error ? error.message : '模板配置不合法', true); }
  },
  monitor: () => setMode('monitor'), edit: () => setMode('edit'), deselect: () => selectCell(null),
  fit: fitGraph, 'zoom-in': () => graph.zoom(.1), 'zoom-out': () => graph.zoom(-.1),
  save: () => { if (persistCurrent()) toast('当前拓扑已保存到拓扑库'); },
  export: () => { void exportTopology('json'); },
  import: () => $<HTMLInputElement>('#import-file').click(),
  undo: () => { if (mode !== 'edit') return; flushHistory(); if (undoStack.length < 2) return; redoStack.push(undoStack.pop()!); loadTopology(structuredClone(undoStack.at(-1)!)); updateHistoryButtons(); toast('已撤销上一步'); },
  redo: () => { if (mode !== 'edit') return; flushHistory(); const next = redoStack.pop(); if (!next) return; undoStack.push(next); loadTopology(structuredClone(next)); updateHistoryButtons(); toast('已重做'); },
  delete: () => { if (mode !== 'edit' || !selected) return; flushHistory(); const current = selected; selectCell(null); graph.removeCell(current); flushHistory(); updateRuntime(); renderInspector(); toast('已删除，可使用撤销恢复'); },
  pause: () => { paused = !paused; const el = document.querySelector<HTMLElement>('[data-action="pause"]')!; el.innerHTML = icon(paused ? 'Play' : 'Pause'); el.title = paused ? '继续模拟数据' : '暂停模拟数据'; el.setAttribute('aria-label', el.title); $('#live-label').innerHTML = `<i></i>${paused ? '模拟已暂停' : '模拟实时'}`; $('#live-label').classList.toggle('paused', paused); updateRuntime(); },
  outage: () => {
    const node = outage && outageNodeId ? graph.getCellById(outageNodeId) : graph.getCellById('srv-01') || graph.getNodes().find((n) => n.getData<DeviceData>().kind === 'server') || graph.getNodes()[0];
    if (!node?.isNode()) { resetOutage(); toast('当前图中没有可演示的节点', true); return; }
    outage = !outage; outageNodeId = outage ? node.id : null;
    const el = document.querySelector<HTMLElement>('[data-action="outage"]')!;
    el.classList.toggle('outage-active', outage); el.innerHTML = `${icon('Unplug', 16)}<span>${outage ? '恢复在线' : '离线演示'}</span>`;
    updateRuntime(); if (selected?.id === node.id) renderInspector();
    toast(outage ? `已模拟“${node.getData<DeviceData>().title}”离线，关联链路已变灰` : '节点已恢复在线');
  },
  'apply-device': () => {
    if (mode !== 'edit' || !selected?.isNode()) return;
    const title = $<HTMLInputElement>('#device-title').value.trim();
    const deviceId = $<HTMLInputElement>('#device-id').value.trim();
    const visibleMetrics = [...document.querySelectorAll<HTMLInputElement>('input[name="visible-metric"]:checked')].map((el) => el.value);
    if (!title || !deviceId) { toast('请填写设备名称和设备 ID', true); return; }
    if (visibleMetrics.length > 2) { toast('卡片最多展示 2 项参数', true); return; }
    let binding;
    try { binding = parseDataBinding({ source: $<HTMLInputElement>('#binding-source').value.trim(), fields: JSON.parse($<HTMLTextAreaElement>('#binding-fields').value), ...($<HTMLInputElement>('#binding-status').value.trim() ? { statusField: $<HTMLInputElement>('#binding-status').value.trim() } : {}), statusMap: JSON.parse($<HTMLTextAreaElement>('#binding-status-map').value || '{}') }, devices[selected.getData<DeviceData>().kind].metrics.map((m) => m.key)); }
    catch (error) { toast(error instanceof Error ? error.message : '数据绑定不合法', true); return; }
    flushHistory();
    selected.setData({ ...selected.getData<DeviceData>(), title, deviceId, address: $<HTMLInputElement>('#device-address').value.trim(), status: $<HTMLSelectElement>('#device-status').value as DeviceStatus, visibleMetrics, binding }, { overwrite: true });
    updateNodeGeometry(selected);
    flushHistory(); updateRuntime(); renderInspector(); applyHighlight(); toast('设备属性已更新，记得保存布局');
  },
  'configure-ports': () => {
    if (mode !== 'edit' || !selected?.isNode()) return;
    const node = selected;
    showModal(`配置端口 · ${node.getData<DeviceData>().title}`, '');
    $('#modal').classList.add('port-config-modal');
    $('.modal-footer').innerHTML = '<button class="button" data-action="close-modal">取消</button><button class="button primary" data-action="apply-ports">应用端口配置</button>';
    portEditorNode = node;
    portEditor = new PortEditor($('#modal-content'), node.getData<DeviceData>(), connectedPortIds(node));
  },
  'apply-ports': () => {
    if (mode !== 'edit' || !portEditor || !portEditorNode) return;
    try {
      const node = portEditorNode;
      if (!graph.getCellById(node.id)) throw new Error('设备已不存在');
      const configuration = portEditor.read();
      const old = node.getData<DeviceData>();
      assertConnectedPortsPreserved(devicePorts(old), configuration.ports, connectedPortIds(node));
      flushHistory();
      const data = { ...old, ...configuration };
      node.setData(data, { overwrite: true });
      updateNodeGeometry(node);
      flushHistory();
      $<HTMLDialogElement>('#modal').close();
      updateRuntime(); selectCell(node);
      toast('端口配置已应用，可调整周围走线后保存布局');
    } catch (error) { portEditor?.showError(error instanceof Error ? error.message : '端口配置不合法'); }
  },
  'apply-edge': () => {
    if (mode !== 'edit' || !selected?.isEdge()) return;
    const appearance = readCableControls();
    flushHistory();
    const label = $<HTMLInputElement>('#edge-label-input').value.trim();
    selected.setData({ ...selected.getData(), label, appearance });
    selected.setLabels(edgeLabels(label));
    renderCable(selected); flushHistory(); renderInspector();
    toast('链路名称和线缆样式已更新，保存布局后可恢复');
  },
  fullscreen: () => {
    const panel = $('.topology-panel');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => toast('无法退出全屏', true));
    else panel.requestFullscreen().catch(() => toast('浏览器未允许全屏，可使用浏览器全屏功能', true));
  },
  alarms: showAlarms,
  help: () => showModal('使用指南', `<p class="modal-description">这是基于 AntV X6 的交互原型。先整理布局，再回到首页验证监控体验。</p><ol class="help-list"><li><strong>编辑布局</strong><p>切换“拓扑编辑”。点击或拖入左侧设备；拖动节点时会按 10 px 网格吸附。</p></li><li><strong>连接设备</strong><p>从节点边缘的彩色端口拖向另一个同色端口。紫色 RF、金色 IF、绿色以太网。网络允许形成环路，禁止设备连到自身。</p></li><li><strong>调整走线</strong><p>点击连线，拖动圆点或线段中间的绿色手柄。点击线条增加拐点，双击拐点删除。走线采用手动控制，拖动设备后可按需调整邻接线段。</p></li><li><strong>保存与恢复</strong><p>“保存布局”写入当前浏览器，刷新自动恢复；“导出 / 导入”用 JSON 迁移配置。导入后需保存才能持久化。恢复示例会覆盖当前画布，可撤销。</p></li><li><strong>首页监控</strong><p>每两秒更新模拟参数，布局保持不变。点击设备查看详情；点击“离线演示”验证状态变化。</p></li></ol><div class="shortcut-list"><span>Ctrl / ⌘ S <b>保存</b></span><span>Ctrl / ⌘ Z <b>撤销</b></span><span>Delete <b>删除选中</b></span><span>Esc <b>取消选择</b></span><span>E / M <b>编辑 / 监控</b></span></div><button class="button" data-action="reset">${icon('RotateCcw', 15)}恢复示例拓扑</button>`),

  'close-modal': () => $<HTMLDialogElement>('#modal').close(),
  reset: () => { flushHistory(); resetOutage(); const sample = sampleDocument(activeDocument.category); Object.assign(devices, definitionsFromTemplates(sample.templates)); loadTopology(sample.topology, true); flushHistory(); $<HTMLDialogElement>('#modal').close(); setMode(mode); toast('已恢复当前分类的示例，可撤销'); },
};

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const docAction = target.closest<HTMLElement>('[data-document-action]');
  if (docAction && !(docAction as HTMLButtonElement).disabled) { handleDocumentAction(docAction.dataset.documentAction!, docAction.dataset.documentId!); return; }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action && actions[action]) { actions[action](); return; }
  const device = target.closest<HTMLElement>('[data-device]')?.dataset.device as DeviceKind;
  if (device && Object.hasOwn(devices, device)) { addFromLibrary(device); return; }
  const filterButton = target.closest<HTMLButtonElement>('[data-filter]');
  if (filterButton) {
    const kind = filterButton.dataset.filter as LinkKind;
    if (filters.has(kind)) filters.delete(kind); else filters.add(kind);
    filterButton.classList.toggle('active', filters.has(kind)); filterButton.setAttribute('aria-pressed', String(filters.has(kind)));
    graph.getEdges().forEach((edge) => edge.setVisible(filters.has(edge.getData()?.kind || 'ethernet'), { runtime: true }));
    if (selected?.isEdge() && !selected.isVisible()) selectCell(null);
    return;
  }
  const cellId = target.closest<HTMLElement>('[data-select-cell]')?.dataset.selectCell;
  if (cellId) selectCell(graph.getCellById(cellId));
  const focus = target.closest<HTMLElement>('[data-focus-device]')?.dataset.focusDevice;
  if (focus) { $<HTMLDialogElement>('#modal').close(); selectCell(graph.getCellById(focus)); graph.centerCell(selected!); }
});
document.addEventListener('dragstart', (event) => {
  const kind = (event.target as HTMLElement).closest<HTMLElement>('[data-device]')?.dataset.device;
  if (kind && event.dataTransfer) { event.dataTransfer.setData('application/station-device', kind); event.dataTransfer.effectAllowed = 'copy'; }
});
$('#canvas-wrap').addEventListener('dragover', (event) => { if (mode === 'edit' && event.dataTransfer?.types.includes('application/station-device')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
$('#canvas-wrap').addEventListener('drop', (event) => {
  event.preventDefault(); const kind = event.dataTransfer?.getData('application/station-device') as DeviceKind;
  if (kind && Object.hasOwn(devices, kind)) addFromLibrary(kind, graph.clientToLocal(event.clientX - NODE_WIDTH * graph.zoom() / 2, event.clientY - NODE_HEIGHT * graph.zoom() / 2));
});
$<HTMLInputElement>('#import-file').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 3 * 1024 * 1024) throw new Error('文件不能超过 3 MB');
    const parsed = parseDocument(JSON.parse(await file.text()));
    if (!persistCurrent()) return;
    const document = library.documents.some((d) => d.id === parsed.id) ? { ...parsed, id: newId(), name: `${parsed.name.slice(0, 96)} 导入` } : parsed;
    if (commitLibrary({ ...library, activeId: document.id, documents: [...library.documents, document] })) {
      openDocument(document.id); toast('拓扑已导入为新文档，原有拓扑保留在库中');
    }
  } catch (error) { toast(error instanceof Error ? error.message : '导入失败，文件格式不合法', true); }
  finally { input.value = ''; }
});
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable="true"]') || $<HTMLDialogElement>('#modal').open) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); actions.save(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) actions.redo(); else actions.undo(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); actions.redo(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { if (mode === 'edit' && selected) { event.preventDefault(); actions.delete(); } }
  else if (event.key === 'Escape') selectCell(null);
  else if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'e') setMode('edit');
  else if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'm') setMode('monitor');
});
graph.on('node:click', ({ node }) => selectCell(node));
graph.on('edge:click', ({ edge }) => { if (selected?.id !== edge.id) selectCell(edge); });
graph.on('blank:click', () => selectCell(null));
graph.on('node:added', recordChange);
graph.on('cell:removed', recordChange);
graph.on('cell:changed', ({ options }) => { if (!options?.runtime) recordChange(); });
graph.on('edge:connected', ({ edge }) => {
  const node = edge.getSourceCell() as Node;
  const port = devicePorts(node.getData<DeviceData>()).find((p) => p.id === edge.getSourcePortId())!;
  edge.setData({ kind: port.kind, label: linkTypes[port.kind].short, appearance: cableAppearance(port.kind) });
  edge.setLabels(edgeLabels(linkTypes[port.kind].short));
  // User-created links start orthogonal. Once edited, vertices fully control the route.
  const source = edge.getSourcePoint(); const target = edge.getTargetPoint();
  if (source.x !== target.x && source.y !== target.y) {
    if (port.side === 'top' || port.side === 'bottom') edge.setVertices([{ x: source.x, y: (source.y + target.y) / 2 }, { x: target.x, y: (source.y + target.y) / 2 }]);
    else edge.setVertices([{ x: (source.x + target.x) / 2, y: source.y }, { x: (source.x + target.x) / 2, y: target.y }]);
  }
  edge.setVisible(filters.has(port.kind), { runtime: true });
  updateRuntime(); flushHistory(); selectCell(edge); toast(`已建立${linkTypes[port.kind].label}，可手动调整走线`);
});
graph.on('scale', updateZoom);
document.addEventListener('fullscreenchange', () => setTimeout(fitGraph, 60));
window.addEventListener('beforeunload', (event) => { if (signature() !== savedSignature) event.preventDefault(); });

try {
  const loaded = loadLibrary(localStorage); library = loaded.library;
  if (loaded.migrated) toast('旧版存档已迁移到拓扑库，原始备份仍保留');
} catch (error) {
  library = emptyLibrary();
  toast(`存档无法读取：${error instanceof Error ? error.message : '请导入备份'}。已打开临时空图，原存档未覆盖`, true);
}
openDocument(library.activeId);
setInterval(() => { if (paused) return; tick++; lastUpdate = new Date(); updateRuntime(); }, 2000);

// A stable interface for integration and browser verification; telemetry never changes layout.
declare global { interface Window { stationPrototype: { graph: Graph; snapshot: typeof snapshot; updateTelemetry: (deviceId: string, metrics: Record<string, number>, status?: DeviceStatus) => void } } }
window.stationPrototype = {
  graph, snapshot,
  updateTelemetry(deviceId, metrics, status) {
    graph.getNodes().filter((n) => n.getData<DeviceData>().deviceId === deviceId).forEach((node) => {
      values.set(node.id, { ...values.get(node.id), ...metrics });
      if (status) runtimeStatuses.set(node.id, status);
    });
    // Production integration should replace the simulator with this update path.
    const wasPaused = paused; paused = true; lastUpdate = new Date(); updateRuntime(); paused = wasPaused;
  },
};
