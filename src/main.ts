import { Graph, Snapline, Transform, type Node, type Edge, type Cell } from '@antv/x6';
import { icon, escapeHtml as esc } from './icons';
import { cableAppearance, cableAttributes, cablePreview, cableStyles, parseCableAppearance, type CableAppearance } from './cables';
import { PortEditor } from './port-editor';
import { TemplateEditor } from './template-editor';
import { applyTemplate, duplicateTemplate, templateFile, importTemplate } from './template-commands';
import { bindingForm, handleBindingClick, readBindingForm } from './binding-editor';
import { registerTopologyShapes, addRenderedNode, updateNodeGeometry, edgeLabels, installCableTexture } from './rendering';
import { categories, newId, parseDocument, sampleDocument, templatesFromDefinitions, definitionsFromTemplates, installEditorTemplates, type NodeTemplate, type TopologyDocument } from './document';
import { LIBRARY_KEY, duplicateDocument, removeDocument, emptyLibrary, type TopologyLibrary } from './library';
import { WorkspaceStore, WorkspaceConflict, documentSignature, type Workspace, type LocalVersion } from './workspace';
import { downloadBlob, exportFilename, graphSvg, svgToPng, standaloneHtml } from './exports';
import type { ExportState } from './export-svg';
import { EditorTelemetry, formatMetricValue, type EditorDataMode } from './editor-telemetry';
import { metricOptions, metricDetails, metricValueHtml } from './device-details';
import { updateNodeStatus, updateStatusBadge } from './node-status-ui';
import { defaultLinkFlow, flowDirections, flowSpeeds, linkStatusLabels, linkStateLabel, parseLinkStatus, parseLinkFlow, parseLinkData, resolveLinkState, type LinkStatus, type LinkFlow, type LinkTelemetryData, type ResolvedLinkState } from './link-state';
import { renderLink } from './link-rendering';
import { copySelection, pasteSelection, moveSelection, deleteSelection, setPositionLocks, type TopologyClipboard } from './editor-commands';
import { alignNodes, distributeNodes, alignmentLabels, MAX_LAYOUT_GAP, type Alignment, type LayoutAxis, type LayoutResult } from './layout-commands';
import { EditorSelection } from './editor-selection';
import { diagramOf, isDeviceNode, addDiagramNode, syncDrawingLayers } from './diagram-rendering';
import { groupOf, movableSelection, reorder, setGroupMembers, elementLabels, type DiagramElement } from './diagram';
import { addDiagramElement, fitRegion } from './diagram-commands';
import { WorkbenchLayout } from './workbench-layout';
import { clearFieldErrors, showFieldError } from './ui-forms';
import { categoryLabel, findDocuments, documentThumbnail, type LibrarySort } from './library-presentation';
import {
  devices, newDevice, linkTypes, statusLabels,
  NODE_WIDTH, NODE_HEIGHT, devicePorts, portSides, assertConnectedPortsPreserved,
  type DeviceKind, type DeviceData, type DeviceRecord, type LinkKind,
  type LinkRecord, type Snapshot, type DeviceStatus,
} from './topology';
import './style.css';
import './workbench.css';
import './node-status.css';
import './workbench-theme.css';
import './link-flow.css';
import './template-editor.css';

type Mode = 'monitor' | 'edit';
let mode: Mode = 'monitor';
let selected: Cell | null = null;
let paused = false;
let outage = false;
let outageNodeId: string | null = null;
let linkData: LinkTelemetryData = {};
const linkDemonstration = new Map<string, { status: LinkStatus }>();
let loading = false;
let tick = 0;
let lastUpdate = new Date();
let savedSignature = '';
let undoStack: TopologyDocument[] = [];
let redoStack: TopologyDocument[] = [];
let recordTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let portEditor: PortEditor | null = null;
let templateEditor: TemplateEditor | null = null;
let portEditorNode: Node | null = null;
let library: TopologyLibrary;
let activeDocument: TopologyDocument;
let workspace: WorkspaceStore | undefined;
let draftSaveTimer: ReturnType<typeof setTimeout>;
let draftSignature = '';
let storageError = '';
let storageConflict = false;
let clipboard: TopologyClipboard | null = null;
let pasteCount = 0;
let canvasTool: 'select' | 'pan' = 'pan';
let dragSession: { nodeId: string; ids: Set<string>; before: Snapshot; x: number; y: number; skipped: number } | null = null;
let applyingDrag = false;
let layerOrder: string[] | undefined;
let elementsPresent = false;
let resizeBefore: TopologyDocument | null = null;
let legendEdgesKey = '';
let contextPoint: { x: number; y: number } | null = null;
const documentHistories = new Map<string, { undo: TopologyDocument[]; redo: TopologyDocument[] }>();
const filters = new Set<LinkKind>(['rf', 'if', 'ethernet', 'logical']);
const telemetry = new EditorTelemetry();
const values = telemetry.values;
const runtimeStatuses = telemetry.statuses;
const historyValues = telemetry.history;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const time = (date: Date) => date.toLocaleTimeString('zh-CN', { hour12: false });
const button = (action: string, title: string, glyph: Parameters<typeof icon>[0], text = '', cls = '') =>
  `<button type="button" data-action="${action}" title="${title}" aria-label="${title}" class="${text ? 'button' : 'icon-button'} ${cls}">${icon(glyph)}${text ? `<span>${text}</span>` : ''}</button>`;

$('#app').innerHTML = `
  <aside class="sidebar" id="sidebar" aria-label="节点库与导航">
    <button class="icon-button drawer-close" data-action="close-sidebar" aria-label="关闭节点库">${icon('X')}</button>
    <a class="brand" href="/" aria-label="Topology 首页"><span class="brand-mark">${icon('Network', 25)}</span><span>topology<span class="brand-dot">.</span><small>拓扑制作工作台</small></span></a>
    <div class="workspace-label">WORKSPACE <span>01</span></div>
    <button class="station-picker" data-action="library" title="打开拓扑库"><span class="station-avatar">${icon('Network', 17)}</span><span><strong>当前拓扑</strong><small>本地拓扑库</small></span>${icon('ChevronDown', 14)}</button>
    <div class="nav-label">工作空间</div><button class="nav-item" data-action="library" aria-label="拓扑库" title="拓扑库">${icon('Layers')}<span>拓扑库</span><span class="nav-shortcut" id="library-count">1</span></button>
    <nav>
      <button class="nav-item active" data-action="monitor" aria-label="拓扑查看" title="拓扑查看">${icon('LayoutDashboard')}<span>拓扑查看</span><span class="nav-dot"></span></button>
      <button class="nav-item" data-action="edit" aria-label="拓扑编辑" title="拓扑编辑">${icon('Cable')}<span>拓扑编辑</span><span class="nav-shortcut">E</span></button>
    </nav>
    <div class="sidebar-divider"></div>
    <div id="sidebar-content"></div>
    <div class="sidebar-bottom"><button class="nav-item" data-action="help" title="使用指南">${icon('HelpCircle')}<span>使用指南</span>${icon('ArrowUpRight', 14)}</button></div>
  </aside>
  <div id="sidebar-resizer" class="panel-resizer sidebar-resizer" role="separator" tabindex="0" aria-label="调整节点库宽度" aria-orientation="vertical" aria-controls="sidebar" aria-valuemin="180" aria-valuemax="320" aria-valuenow="208" title="拖动调宽；方向键微调；双击恢复默认"></div>
  <button id="sidebar-backdrop" class="sidebar-backdrop" aria-label="关闭节点库" hidden></button>
  <div class="workspace">
    <header class="topbar"><div class="topbar-navigation"><button class="icon-button" data-action="toggle-sidebar" aria-controls="sidebar" aria-expanded="true" title="收起节点库" aria-label="收起节点库">${icon('PanelLeft')}</button><div class="breadcrumb"><span>工作空间</span>${icon('ChevronRight', 14)}<span id="crumb-document">当前拓扑</span>${icon('ChevronRight', 14)}<strong id="crumb-mode">拓扑查看</strong></div></div><div class="topbar-right">${button('help', '使用指南', 'HelpCircle')}</div></header>
    <main>
      <div class="page-heading"><div><h1 id="page-title">拓扑工作台</h1><p id="page-description">制作、管理和复用拓扑文件</p></div><div class="heading-actions"><button class="button" data-action="library">${icon('Layers', 15)}拓扑库</button><div class="mode-switch" role="group" aria-label="界面模式"><button data-action="monitor" class="active">${icon('Activity', 16)}查看</button><button data-action="edit">${icon('PencilRuler', 16)}编辑</button></div><button class="button primary" data-action="save">${icon('Save', 16)}<span>保存布局</span></button></div></div>
      <section class="topology-panel" aria-label="拓扑画布">
        <div class="panel-heading"><div class="panel-title"><span class="panel-symbol">${icon('Network', 18)}</span><h2>拓扑画布</h2><span class="tag">通用拓扑</span></div><div class="workspace-summary" aria-label="拓扑计数"><span><strong id="stat-total">0</strong> 节点</span><span><strong id="stat-links">0</strong> 链路</span></div><div class="panel-heading-actions"><span id="save-status" class="save-status">${icon('Check', 13)}示例布局</span>${button('import', '导入 JSON', 'Upload')}${button('export-options', '导出拓扑', 'Download')}${button('viewer', '在独立展示页打开', 'ExternalLink')}${button('draft-history', '草稿与历史', 'Clock3')}${button('fullscreen', '全屏查看', 'Maximize')}</div></div>
        <div id="draft-notice" class="draft-notice" hidden><span id="draft-message" role="status"></span><button class="button" data-action="retry-draft">重试保存草稿</button><button class="button" data-action="export-current-backup">导出当前图</button><button class="button" data-action="storage-reload">重新读取</button></div>
        <div class="canvas-toolbar"><div class="link-filters" aria-label="链路筛选">${(Object.entries(linkTypes) as [LinkKind, typeof linkTypes[LinkKind]][]).map(([kind, def]) => `<button data-filter="${kind}" class="filter-chip active" aria-pressed="true"><span style="--link-color:${def.color}"></span>${def.label}</button>`).join('')}</div><div class="toolbar-right"><span class="live-label" id="live-label"><i></i>模拟实时</span><span class="toolbar-separator"></span><select id="data-mode" aria-label="数据模式"><option value="simulation">模拟数据</option><option value="external">宿主数据</option></select>${button('pause', '暂停模拟数据', 'Pause')}${button('outage', '模拟节点离线', 'Unplug', '离线演示', 'subtle')}</div></div>
        <div class="selection-toolbar" id="edit-tools" hidden><div class="canvas-tool-switch" role="group" aria-label="画布工具">${button('tool-select', '拖动空白处框选节点', 'MousePointer2', '框选')}${button('tool-pan', '拖动空白处平移画布，Shift 拖动可框选', 'Hand', '平移')}</div><span class="toolbar-separator"></span>${button('undo', '撤销 Ctrl / ⌘ Z', 'Undo2')}${button('redo', '重做 Ctrl / ⌘ Shift Z', 'Redo2')}<span class="toolbar-separator"></span>${button('select-all', '全选图形对象 Ctrl / ⌘ A', 'Scan')}${button('copy', '复制节点及内部连线 Ctrl / ⌘ C', 'Copy')}${button('paste', '粘贴 Ctrl / ⌘ V', 'ClipboardPaste')}${button('duplicate', '复制副本 Ctrl / ⌘ D', 'CopyPlus')}${button('delete', '删除选中对象 Delete', 'Trash2')}<span class="toolbar-separator"></span><select id="align-command" aria-label="节点对齐" title="以首个锁定节点为参照；无锁定节点时以选区边界为参照"><option value="">对齐</option>${Object.entries(alignmentLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><select id="distribute-command" aria-label="节点分布" title="分布只处理未锁定节点"><option value="">分布</option><option value="horizontal">水平等距</option><option value="vertical">垂直等距</option><option value="gap">指定间距…</option></select>${button('lock-selected', '锁定位置，移动和批量删除会跳过', 'LockKeyhole')}${button('unlock-selected', '解锁所选节点', 'LockKeyholeOpen')}<span class="toolbar-separator"></span>${button('add-group', '将所选节点组成区域；无选择时创建空区域', 'Layers', '分组')}${button('add-note', '添加文字注释', 'PencilRuler', '注释')}${button('add-legend', '添加链路和状态图例', 'Info', '图例')}<select id="layer-command" aria-label="图形层次"><option value="">层次</option><option value="front">置顶</option><option value="back">置底</option></select><span id="selection-count">未选择</span><span class="selection-hint">Ctrl / ⌘ / Shift 点选 · 方向键移动</span></div>
        <div class="canvas-layout"><div class="canvas-wrap" id="canvas-wrap"><div class="canvas-watermark">当前拓扑</div><div id="graph" tabindex="0" aria-label="拓扑画布"></div><div class="canvas-empty" id="canvas-empty" hidden>${icon('Network', 32)}<strong>添加第一个节点</strong><p>展开节点库，点击模板或将其拖入画布。</p></div><div class="canvas-mode" id="canvas-mode">${icon('LockKeyhole', 13)}查看模式 · 布局已锁定</div><div class="canvas-controls">${button('zoom-out', '缩小', 'Minus')}<span id="zoom-label">100%</span>${button('zoom-in', '放大', 'Plus')}<span class="toolbar-separator"></span>${button('fit', '适应画布', 'Scan')}</div></div><div id="inspector-resizer" class="panel-resizer inspector-resizer" role="separator" tabindex="0" aria-label="调整属性栏宽度" aria-orientation="vertical" aria-controls="inspector" aria-valuemin="240" aria-valuemax="420" aria-valuenow="280" title="拖动调宽；方向键微调；双击恢复默认"></div><aside id="inspector" class="inspector" aria-label="节点与链路属性"></aside><button class="inspector-toggle icon-button" data-action="toggle-inspector" aria-controls="inspector" aria-expanded="true" title="收起属性栏" aria-label="收起属性栏">${icon('PanelRight')}</button></div>
        <div class="panel-footer"><span><span class="tiny-dot" id="footer-dot"></span><span id="footer-mode">查看模式</span><span class="footer-divider">/</span><span id="footer-hint">点击节点查看参数 · 滚轮缩放 · 拖动画布平移</span></span><span id="update-time">数据更新 --:--:--</span></div>
      </section>
    </main>
  </div>
  <input type="file" id="import-file" accept=".json,application/json" hidden />
  <dialog id="modal"><div class="modal-heading"><h2 id="modal-title"></h2>${button('close-modal', '关闭', 'X')}</div><div id="modal-content"></div><div class="modal-footer"><button class="button primary" data-action="close-modal">知道了</button></div></dialog>
  <div class="toast" id="toast" role="status" hidden></div>
  <div id="canvas-context-menu" class="canvas-context-menu" role="menu" aria-label="画布菜单" hidden></div>
`;

function runtimeStatus(node: Node): DeviceStatus {
  if (telemetry.mode === 'external' && !values.has(node.id)) return 'offline';
  return outage && node.id === outageNodeId ? 'offline' : (runtimeStatuses.get(node.id) || node.getData<DeviceData>().status || 'normal');
}

function runtimeLabel(node: Node) {
  if (telemetry.mode === 'external' && !values.has(node.id)) return '等待数据';
  const status = runtimeStatus(node);
  return telemetry.mode === 'simulation' && status === 'warning' && node.getData<DeviceData>().kind === 'amplifier' ? '温度偏高 · 请关注' : statusLabels[status];
}

function dataModeLabel() { return telemetry.mode === 'external' ? '宿主数据' : '模拟数据'; }

function metricValue(node: Node, key: string) {
  const def = devices[node.getData<DeviceData>().kind].metrics.find((m) => m.key === key)!;
  if (!def) return '—';
  const value = values.get(node.id)?.[key] ?? (telemetry.mode === 'simulation' ? def.base : undefined);
  return formatMetricValue(value, def);
}

registerTopologyShapes();

const graph: Graph = new Graph({
  container: $('#graph'), autoResize: true, async: false,
  background: { color: '#f9fbfa' },
  grid: { size: 10, visible: true, type: 'dot', args: { color: '#d9e2de', thickness: 1 } },
  scaling: { min: .25, max: 2 },
  panning: { enabled: true, eventTypes: ['leftMouseDown', 'mouseWheelDown'] },
  mousewheel: { enabled: true, modifiers: null, minScale: .25, maxScale: 2, factor: 1.08 },
  interacting: (view) => ({ nodeMovable: mode === 'edit' && cellMovable(view.cell), edgeMovable: false, edgeLabelMovable: false, magnetConnectable: mode === 'edit', arrowheadMovable: mode === 'edit', vertexMovable: mode === 'edit', vertexAddable: mode === 'edit', vertexDeletable: mode === 'edit' }),
  connecting: {
    snap: { radius: 24 }, allowBlank: false, allowLoop: false, allowNode: false, allowEdge: false,
    allowMulti: 'withPort', highlight: true, anchor: 'center', connectionPoint: 'anchor',
    router: 'normal', connector: { name: 'rounded', args: { radius: 8 } },
    createEdge() { return this.createEdge({ shape: 'station-cable', attrs: cableAttributes(cableAppearance('ethernet')), zIndex: 0 }); },
    validateConnection({ sourceCell, sourcePort, targetCell, targetPort }) {
      if (mode !== 'edit' || !isDeviceNode(sourceCell) || !isDeviceNode(targetCell) || sourceCell.id === targetCell.id) return false;
      const a = devicePorts(sourceCell.getData<DeviceData>()).find((p) => p.id === sourcePort);
      const b = devicePorts(targetCell.getData<DeviceData>()).find((p) => p.id === targetPort);
      return !!a && !!b && a.kind === b.kind;
    },
  },
  highlighting: { magnetAvailable: { name: 'stroke', args: { attrs: { stroke: '#21957b', strokeWidth: 3 } } }, magnetAdsorbed: { name: 'stroke', args: { attrs: { stroke: '#21957b', strokeWidth: 3 } } } },
});
graph.use(new Snapline({ enabled: true, sharp: true, tolerance: 8 }));
graph.use(new EditorSelection({
  enabled: false, rubberband: true, rubberNode: true, rubberEdge: false,
  multiple: true, multipleSelectionModifiers: ['ctrl', 'meta', 'shift'],
  showNodeSelectionBox: true, showEdgeSelectionBox: false,
  pointerEvents: 'auto', movable: false, eventTypes: ['leftMouseDown'],
}));
const transform = new Transform({ rotating: false, resizing: { enabled: (node) => mode === 'edit' && !!diagramOf(node) && !cellLocked(node), minWidth: 160, maxWidth: 10000, minHeight: 80, maxHeight: 10000, orthogonal: false, allowReverse: false } });
graph.use(transform);
function deviceNodes() { return graph.getNodes().filter(isDeviceNode); }
function elementNodes() { return graph.getNodes().filter((node) => !!diagramOf(node)); }
function cellLocked(cell: Cell): boolean {
  if (diagramOf(cell)) return !!diagramOf(cell)!.locked;
  return !!(cell.getData<DeviceData>()?.locked || elementNodes().some((node) => { const e = diagramOf(node)!; return e.kind === 'group' && e.locked && e.members.includes(cell.id); }));
}
function cellMovable(cell: Cell): boolean {
  const e = diagramOf(cell);
  return !cellLocked(cell) && !(e?.kind === 'group' && e.members.some((id) => { const member = graph.getCellById(id); return member && cellLocked(member); }));
}
installCableTexture(graph, 'station-cable-braid');
const workbench = new WorkbenchLayout(() => toast('界面偏好无法保存，本次调整仍有效；拓扑存档不受影响', true));
$('#inspector').addEventListener('toggle', (event) => {
  if (event.target instanceof HTMLDetailsElement && $('#inspector').contains(event.target)) workbench.rememberSection(event.target);
}, true);
function runtimeLinkState(edge: Edge) {
  const endpoints = [edge.getSourceCell(), edge.getTargetCell()].filter(isDeviceNode).map(node => ({ status: runtimeStatus(node), pending: telemetry.mode === 'external' && !values.has(node.id) }));
  const live = telemetry.mode === 'external' ? Object.hasOwn(linkData, edge.id) ? linkData[edge.id] : undefined : linkDemonstration.get(edge.id);
  return resolveLinkState(edge.getData() || {}, endpoints, live, telemetry.mode === 'external');
}
function updateLinkBadge(state: ResolvedLinkState) {
  const badge = document.querySelector<HTMLElement>('#edge-runtime-status');
  if (badge) { badge.dataset.linkStatus = state.status; badge.textContent = linkStateLabel(state); }
  const demo = document.querySelector<HTMLButtonElement>('[data-action="toggle-link-demo"]');
  if (demo) { demo.disabled = telemetry.mode === 'external' || state.reason === 'endpoint'; demo.textContent = state.status === 'down' ? '模拟链路连通' : '模拟链路断开'; }
}
function renderCable(edge: Edge) {
  const kind = (edge.getData()?.kind || 'ethernet') as LinkKind;
  const appearance = cableAppearance(kind, edge.getData()?.appearance);
  const state = runtimeLinkState(edge);
  renderLink(graph, edge, appearance, state, { flow: edge.getData()?.flow, animate: mode === 'monitor' && !(telemetry.mode === 'simulation' && paused) });
  if (selected?.id === edge.id) updateLinkBadge(state);
}

function addDevice(record: DeviceRecord) {
  return addRenderedNode(graph, record, {
    definitions: devices, editor: true, status: runtimeStatus, locked: cellLocked,
    pending: (node) => telemetry.mode === 'external' && !values.has(node.id),
    value: (node, key) => runtimeStatus(node) === 'offline' ? '—' : metricValue(node, key),
    selected: (node) => mode === 'edit' ? graph.isSelected(node) : selected?.id === node.id,
    statusLabel: runtimeLabel,
  });
}

function addLink(record: LinkRecord) {
  return graph.addEdge({ id: record.id, shape: 'station-cable', source: record.source, target: record.target, vertices: record.vertices,
    router: 'normal', connector: { name: 'rounded', args: { radius: 8 } },
    data: { kind: record.kind, label: record.label, ...(record.appearance ? { appearance: structuredClone(record.appearance) } : {}), ...(record.status ? { status: record.status } : {}), ...(record.flow ? { flow: structuredClone(record.flow) } : {}) }, labels: edgeLabels(record.label),
    attrs: cableAttributes(cableAppearance(record.kind, record.appearance)), zIndex: 0,
  });
}
function snapshot(): Snapshot {
  return {
    nodes: deviceNodes().map((node) => ({ id: node.id, ...node.getPosition(), data: structuredClone(node.getData<DeviceData>()) })),
    ...(elementsPresent || elementNodes().length ? { elements: elementNodes().map((node) => ({ ...structuredClone(diagramOf(node)!), ...node.getPosition(), ...node.size() })) } : {}),
    ...(layerOrder ? { order: [...layerOrder.filter((id) => graph.getCellById(id)?.isNode()), ...graph.getNodes().map((node) => node.id).filter((id) => !layerOrder!.includes(id))] } : {}),
    edges: graph.getEdges().filter((e) => e.getSourceCellId() && e.getTargetCellId()).map((edge) => ({ id: edge.id, source: { cell: edge.getSourceCellId(), port: edge.getSourcePortId() }, target: { cell: edge.getTargetCellId(), port: edge.getTargetPortId() }, kind: edge.getData()?.kind || 'ethernet', label: edge.getData()?.label || '', vertices: edge.getVertices().map((p) => ({ x: p.x, y: p.y })), ...(edge.getData()?.appearance ? { appearance: structuredClone(edge.getData().appearance) } : {}), ...(edge.getData()?.status ? { status: edge.getData().status } : {}), ...(edge.getData()?.flow ? { flow: structuredClone(edge.getData().flow) } : {}) })),
  };
}
function loadTopology(data: Snapshot, fit = false, preserveTelemetry = false) {
  loading = true; clearTimeout(recordTimer); selected = null;
  dragSession = null; resizeBefore = null; transform.clearWidgets(); graph.cleanSelection();
  if (preserveTelemetry) {
    telemetry.prune(new Set(data.nodes.map((node) => node.id)));
    const ids = new Set(data.edges.map(edge => edge.id));
    linkData = Object.fromEntries(Object.entries(linkData).filter(([id]) => ids.has(id)));
    for (const id of linkDemonstration.keys()) if (!ids.has(id)) linkDemonstration.delete(id);
  } else { telemetry.clear(); linkData = {}; linkDemonstration.clear(); }
  layerOrder = data.order ? [...data.order] : undefined; elementsPresent = data.elements !== undefined; legendEdgesKey = '';
  graph.clearCells(); data.nodes.forEach(addDevice); data.edges.forEach(addLink);
  for (const element of data.elements || []) addDiagramNode(graph, element, snapshot);
  syncDrawingLayers(graph, data);
  graph.getEdges().forEach((edge) => edge.setVisible(filters.has(edge.getData()?.kind || 'ethernet'), { runtime: true }));
  loading = false;
  updateRuntime(); renderInspector(); updateSaveStatus(); updateCounts();
  $('#canvas-empty').hidden = data.nodes.length > 0 || !!data.elements?.length;
  if (fit) requestAnimationFrame(fitGraph);
}
function recordChange() {
  if (loading || dragSession || resizeBefore) return;
  clearTimeout(recordTimer);
  recordTimer = setTimeout(flushHistory, 250);
}
function flushHistory() {
  if (dragSession || resizeBefore) return;
  clearTimeout(recordTimer);
  const current = captureDocument();
  if (!undoStack.length || documentSignature(current) !== documentSignature(undoStack.at(-1)!)) {
    undoStack.push(current); if (undoStack.length > 51) undoStack.shift(); redoStack = [];
  }
  updateSaveStatus(); updateHistoryButtons(); updateCounts();
  $('#canvas-empty').hidden = graph.getNodes().length > 0;
  scheduleDraftSave();
}
function updateHistoryButtons() {
  const undo = document.querySelector<HTMLButtonElement>('[data-action="undo"]');
  if (undo) undo.disabled = undoStack.length < 2;
  const redo = document.querySelector<HTMLButtonElement>('[data-action="redo"]');
  if (redo) redo.disabled = !redoStack.length;
  const del = document.querySelector<HTMLButtonElement>('[data-action="delete"]');
  const cells = selectedCells(), nodeCells = cells.filter((cell) => cell.isNode()), nodes = nodeCells.length;
  const locked = nodeCells.filter(cellLocked).length, movable = nodes - locked;
  const devicesOnly = nodeCells.filter(isDeviceNode), movableDevices = devicesOnly.filter((node) => !cellLocked(node)).length;
  if (del) del.disabled = !cells.some((cell) => cell.isEdge() || !cellLocked(cell));
  for (const action of ['copy', 'duplicate']) {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (button) button.disabled = nodes === 0;
  }
  $<HTMLButtonElement>('[data-action="paste"]').disabled = !clipboard;
  const edges = cells.length - nodes;
  $('#selection-count').textContent = cells.length ? `已选 ${devicesOnly.length} 节点${nodes > devicesOnly.length ? ` / ${nodes - devicesOnly.length} 图面` : ''}${edges ? ` / ${edges} 连线` : ''}${locked ? ` · ${locked} 已锁定` : ''}` : '未选择';
  $<HTMLSelectElement>('#align-command').disabled = devicesOnly.length < 2 || movableDevices === 0;
  $<HTMLSelectElement>('#distribute-command').disabled = movableDevices < 2;
  for (const axis of ['horizontal', 'vertical']) $<HTMLOptionElement>(`#distribute-command option[value="${axis}"]`).disabled = movableDevices < 3;
  $<HTMLSelectElement>('#layer-command').disabled = !nodes;
  $<HTMLButtonElement>('[data-action="lock-selected"]').disabled = movable === 0;
  $<HTMLButtonElement>('[data-action="unlock-selected"]').disabled = locked === 0;
}
function updateSaveStatus() {
  if (!activeDocument) return;
  const current = documentSignature(captureDocument()), dirty = current !== savedSignature;
  const draft = workspace?.document(activeDocument.id).draft;
  const label = storageError ? '草稿保存失败' : dirty && current === draftSignature ? `草稿已自动保存 ${draft ? time(new Date(draft.savedAt)) : ''}` : dirty ? '有修改 · 等待自动保存' : '布局已保存';
  $('#save-status').innerHTML = `${icon(storageError ? 'CircleAlert' : dirty ? 'Clock3' : 'Check', 13)}${label}`;
  $('#save-status').classList.toggle('dirty', dirty);
  $('#save-status').classList.toggle('error', !!storageError);
  $('#draft-notice').hidden = !storageError;
  $('#draft-message').textContent = storageError;
  $<HTMLButtonElement>('[data-action="retry-draft"]').disabled = storageConflict || !workspace;
}
function fitGraph() {
  if (!graph.getNodes().length) { graph.zoomTo(1); graph.translate(80, 80); return; }
  graph.zoomToFit({ padding: { top: 60, right: 38, bottom: 50, left: 38 }, maxScale: 1 });
  updateZoom();
}
function updateZoom() { $('#zoom-label').textContent = `${Math.round(graph.zoom() * 100)}%`; }

function selectedCells(): Cell[] {
  return mode === 'edit' ? graph.getSelectedCells().filter((cell) => !!graph.getCellById(cell.id)) : selected ? [selected] : [];
}
function selectCell(cell: Cell | null) {
  if (mode === 'edit') graph.resetSelection(cell ? [cell] : []);
  else selected = cell;
  refreshSelection();
}
function refreshSelection() {
  if (loading) return;
  const cells = selectedCells();
  if (selected?.isEdge()) selected.removeTools();
  selected = cells.length === 1 ? cells[0] : null;
  if (selected?.isEdge() && mode === 'edit') selected.addTools([
    { name: 'vertices', args: { attrs: { r: 4, fill: '#fff', stroke: '#20866f', strokeWidth: 2 } } },
    { name: 'segments', args: { attrs: { fill: '#20866f', stroke: '#fff', width: 14, height: 5, x: -7, y: -2.5 }, threshold: 25, anchor: () => ({ name: 'center' }) } },
  ]);
  transform.clearWidgets();
  if (mode === 'edit' && selected?.isNode() && diagramOf(selected) && !cellLocked(selected)) transform.createWidget(selected);
  applyHighlight(); renderInspector(); updateHistoryButtons();
}
function applyHighlight() {
  const ids = new Set(selectedCells().map((cell) => cell.id));
  $('#graph').querySelectorAll<HTMLElement>('.device-card').forEach((el) => el.classList.toggle('selected', ids.has(el.dataset.deviceNode!)));
  $('#graph').querySelectorAll<HTMLElement>('.diagram-element').forEach((el) => el.classList.toggle('selected', mode === 'edit' && ids.has(el.dataset.diagramElement!)));
  graph.getEdges().forEach((edge) => {
    const active = !ids.size || ids.has(edge.id) || ids.has(edge.getSourceCellId()) || ids.has(edge.getTargetCellId());
    const el = graph.findViewByCell(edge)?.container as SVGElement | undefined;
    if (el) { el.style.opacity = active ? '1' : '.22'; el.classList.toggle('selected-edge', selected?.id === edge.id); }
  });
}

function renderSidebar() {
  $('#sidebar-content').innerHTML = mode === 'edit' ? `<div class="nav-label">节点模板 <span>点击 / 拖入</span></div><div class="device-library">${Object.entries(devices).map(([kind, def]) => `<button class="library-item" draggable="true" data-device="${esc(kind)}" title="添加${esc(def.label)}" aria-label="添加${esc(def.label)}"><span>${icon(def.icon, 19)}</span><span>${esc(def.label)}<small>${esc(def.en)}</small></span>${icon('Plus', 13)}</button>`).join('')}</div><button class="button template-add" data-action="new-template" aria-label="新建节点模板" title="新建节点模板">${icon('Plus', 14)}<span>新建节点模板</span></button><button class="button template-add" data-action="manage-templates">${icon('Settings', 14)}管理模板 / 导入</button><div class="library-help">连接点可供多条线缆共用。<br>相同类型的连接点可以连接。</div>` : `<div class="nav-label">当前拓扑</div><div class="site-info"><span class="site-info-icon">${icon('Network', 28)}</span><strong>${esc(activeDocument.name)}</strong><p>${esc(categoryLabel(activeDocument.category))}</p><div><span>文件格式</span><b>Topology v3</b></div><div><span>节点模板</span><b>${activeDocument.templates.length} 个</b></div><div><span>数据来源</span><b class="mock-source">${dataModeLabel()}</b></div></div><div class="sidebar-tip"><span>拓扑说明</span><p>${esc(activeDocument.description || '制作、管理和复用你的拓扑。')}</p><button data-action="document-info">拓扑信息 ${icon('ArrowUpRight', 14)}</button></div>`;
}

function setMode(next: Mode) {
  closeContextMenu();
  finishGroupDrag();
  const previous = selectedCells();
  mode = next;
  selected = null; graph.cleanSelection(); updateCanvasTool();
  if (mode === 'edit') graph.resetSelection(previous);
  else selected = previous.length === 1 ? previous[0] : null;
  document.body.dataset.mode = mode;
  document.querySelectorAll<HTMLElement>('.mode-switch button').forEach((el) => el.classList.toggle('active', el.dataset.action === mode));
  document.querySelectorAll<HTMLElement>('nav .nav-item').forEach((el) => el.classList.toggle('active', el.dataset.action === mode));
  $('#crumb-mode').textContent = mode === 'edit' ? '拓扑编辑' : '拓扑查看';
  $('#page-title').textContent = activeDocument.name;
  $('#page-description').textContent = mode === 'edit' ? '编辑拓扑' : '查看拓扑';
  $('#canvas-mode').innerHTML = `${icon(mode === 'edit' ? 'PencilRuler' : 'LockKeyhole', 13)}${mode === 'edit' ? '编辑模式 · 10 px 网格吸附' : '查看模式 · 布局已锁定'}`;
  $('#edit-tools').hidden = mode !== 'edit';
  $('#footer-mode').textContent = mode === 'edit' ? '编辑模式' : '查看模式';
  $('#footer-hint').textContent = mode === 'edit' ? '拖动节点布局 · 从端口连线 · 选中连线调整拐点' : '点击节点查看参数 · 滚轮缩放 · 拖动画布平移';
  graph.getEdges().forEach((e) => e.removeTools());
  renderSidebar(); syncDataControls(); refreshSelection(); updateDocumentChrome(); graph.getEdges().forEach(renderCable);
}

function updateCanvasTool() {
  $('#graph').dataset.tool = mode === 'edit' ? canvasTool : 'pan';
  graph.toggleSelection(mode === 'edit'); graph.toggleRubberband(mode === 'edit');
  graph.setRubberbandModifiers(canvasTool === 'pan' ? 'shift' : null);
  graph.options.panning.eventTypes = mode === 'edit' && canvasTool === 'select' ? ['mouseWheelDown'] : ['leftMouseDown', 'mouseWheelDown'];
  graph.enablePanning();
  for (const tool of ['select', 'pan'] as const) {
    const button = $<HTMLButtonElement>(`[data-action="tool-${tool}"]`);
    button.classList.toggle('active', canvasTool === tool);
    button.setAttribute('aria-pressed', String(canvasTool === tool));
  }
}

function syncDataControls() {
  const external = telemetry.mode === 'external';
  $<HTMLSelectElement>('#data-mode').value = telemetry.mode;
  const pause = $<HTMLButtonElement>('[data-action="pause"]');
  pause.disabled = external;
  pause.innerHTML = icon(paused ? 'Play' : 'Pause');
  pause.title = paused ? '继续模拟数据' : '暂停模拟数据';
  pause.setAttribute('aria-label', pause.title);
  $<HTMLButtonElement>('[data-action="outage"]').disabled = external;
  $('#live-label').innerHTML = `<i></i>${external ? values.size ? '宿主数据' : '等待宿主数据' : paused ? '模拟已暂停' : '模拟实时'}`;
  $('#live-label').classList.toggle('paused', !external && paused);
}

function setDataMode(next: EditorDataMode) {
  if (!telemetry.setMode(next)) return;
  paused = false; tick = 0; lastUpdate = new Date(); linkData = {}; resetOutage();
  syncDataControls(); renderSidebar(); updateRuntime(); if (mode === 'monitor') renderInspector();
}

$('#data-mode').addEventListener('change', (event) => setDataMode((event.target as HTMLSelectElement).value as EditorDataMode));

function resetOutage() {
  linkDemonstration.clear();
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
  const flow: LinkFlow = edge.getData()?.flow ?? defaultLinkFlow;
  return `<div class="cable-preview" id="edge-cable-preview">${cablePreview(appearance)}</div>${mode === 'edit' ? `
    <label class="field">线缆样式<select id="edge-cable-style">${Object.entries(cableStyles).map(([key, def]) => `<option value="${key}" ${key === appearance.style ? 'selected' : ''}>${def.label}</option>`).join('')}</select></label>
    <label class="field cable-width-label">线缆粗细 <output id="edge-cable-width-value">${appearance.width} px</output><input type="range" id="edge-cable-width" min="1" max="14" step="1" value="${appearance.width}" /></label>
    <div class="cable-color-row"><label for="edge-cable-color">线缆颜色</label><input type="color" id="edge-cable-color" value="${appearance.color}" /><span id="edge-cable-color-value">${appearance.color}</span></div>
    <label class="cable-arrows"><input type="checkbox" id="edge-cable-arrows" ${appearance.arrows ? 'checked' : ''} />显示方向箭头</label>
    <p class="cable-style-description" id="edge-cable-description">${cableStyles[appearance.style].description}</p>
    <div class="link-state-controls"><h4>状态与流转</h4>
      <label class="field">初始链路状态<select id="edge-status">${Object.entries(linkStatusLabels).map(([key, label]) => `<option value="${key}" ${(edge.getData()?.status ?? 'up') === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="cable-arrows"><input id="edge-flow-enabled" type="checkbox" ${flow.enabled ? 'checked' : ''}/>连通时显示流转动效</label>
      <label class="field">流转方向<select id="edge-flow-direction">${Object.entries(flowDirections).map(([key, label]) => `<option value="${key}" ${flow.direction === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="field">流转速度<select id="edge-flow-speed">${Object.entries(flowSpeeds).map(([key, label]) => `<option value="${key}" ${flow.speed === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <p class="field-hint">正向为上方端点 → 下方端点，流转方向独立于方向箭头。编辑画布静态，切换查看模式播放；宿主状态优先于初始状态。</p>
    </div>` : `<div class="cable-summary"><span>${cableStyles[appearance.style].label}</span><span>${appearance.width} px${appearance.arrows ? ' · 有向' : ''}</span></div><p class="field-hint">${flow.enabled ? `${flowDirections[flow.direction]}流转 · ${flowSpeeds[flow.speed]}速` : '动效已关闭'}</p>`}`;
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
  const content = `${mode === 'edit' ? `<button class="button full-width port-config-button" data-action="configure-ports">${icon('Settings', 14)}配置端口 / 批量新增</button>` : ''}<div class="port-side-summary">${Object.entries(portSides).map(([key, label]) => `${label} ${ports.filter((p) => p.side === key).length}`).join(' · ')}</div><div class="port-list">${ports.slice(0, 6).map(row).join('') || '<p class="muted">暂无端口</p>'}</div>${ports.length > 6 ? `<details class="port-more"><summary>展开其余 ${ports.length - 6} 个端口</summary><div class="port-list">${ports.slice(6).map(row).join('')}</div></details>` : ''}`;
  const title = `连接端口 <span>${ports.length} 个 / 已连接 ${used.size}</span>`;
  return mode === 'edit' ? propertySection('ports', title, content) : `<div class="detail-section"><h4>${title}</h4>${content}</div>`;
}

function propertySection(key: string, title: string, content: string, open = true, className = '') {
  return `<details class="property-section ${className}" data-property-section="${key}" ${workbench.sectionOpen(key, open) ? 'open' : ''}><summary>${title}</summary><div class="property-content">${content}</div></details>`;
}

function renderNodeEditor(node: Node, data: DeviceData) {
  return propertySection('basic', '基本信息', `<label class="field">节点名称<input id="device-title" maxlength="60" value="${esc(data.title)}" /></label><label class="field">业务对象 ID<input id="device-id" maxlength="80" value="${esc(data.deviceId)}" /></label><label class="field">管理地址<input id="device-address" maxlength="100" value="${esc(data.address)}" /></label>${renderGroupMembership(node)}<label class="field">初始状态<select id="device-status">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${key === data.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`)
    + propertySection('metrics', '卡片展示参数 <span>最多 2 项</span>', `<div class="metric-options" id="visible-metrics" tabindex="-1">${metricOptions(data, devices[data.kind])}</div><p class="field-hint">可不选参数，卡片会自动收紧高度。</p>`)
    + renderDevicePorts(node) + renderBindingControls(data)
    + `<div class="inspector-apply"><button class="button primary full-width" data-action="apply-device">${icon('Check', 15)}应用修改</button></div>`;
}

function renderGroupMembership(node: Node) {
  const current = groupOf(snapshot(), node.id);
  return `<label class="field">所属区域<select id="node-group" ${current?.locked ? 'disabled' : ''}><option value="">不属于分组</option>${(snapshot().elements || []).filter((e) => e.kind === 'group').map((e) => `<option value="${esc(e.id)}" ${e.id === current?.id ? 'selected' : ''} ${e.locked && e.id !== current?.id ? 'disabled' : ''}>${esc(e.title)}${e.locked ? ' · 已锁定' : ''}</option>`).join('')}</select></label>`;
}

function renderDiagramInspector(element: DiagramElement) {
  const editable = mode === 'edit';
  const members = element.kind === 'group' ? `<div class="group-members">${deviceNodes().map((node) => { const owner = groupOf(snapshot(), node.id); return `<label><input type="checkbox" name="group-member" value="${esc(node.id)}" ${element.members.includes(node.id) ? 'checked' : ''} ${element.locked || (owner && owner.id !== element.id) ? 'disabled' : ''}/> <span>${esc(node.getData<DeviceData>().title)}${owner && owner.id !== element.id ? ` · ${esc(owner.title)}` : ''}</span></label>`; }).join('') || '<p class="muted">当前没有节点</p>'}</div>` : '';
  $('#inspector').innerHTML = `<div class="inspector-header"><span>${elementLabels[element.kind]}</span>${button('deselect', '取消选择', 'X')}</div><div class="detail-section"><h3>${esc(element.title)}</h3><p class="field-hint">${element.kind === 'group' ? '拖动标题移动整个区域；调边框保留节点位置，解散保留成员与连接。' : element.kind === 'note' ? '纯文本说明，随拓扑保存及导出。' : '按链路类型显示示意，使用该类型首条链路的外观。'}</p></div>${editable ? `<div class="detail-section"><label class="field">标题<input id="diagram-title" maxlength="100" value="${esc(element.title)}"/></label><label class="field">颜色<input id="diagram-color" type="color" value="${element.color}"/></label><div class="diagram-size-fields"><label class="field">宽度（px）<input id="diagram-width" type="number" min="160" max="10000" value="${element.width}" ${element.locked ? 'disabled' : ''}/></label><label class="field">高度（px）<input id="diagram-height" type="number" min="80" max="10000" value="${element.height}" ${element.locked ? 'disabled' : ''}/></label></div>${element.kind === 'note' ? `<label class="field">说明文字<textarea id="diagram-text" rows="6" maxlength="2000">${esc(element.text)}</textarea></label><label class="field">字号（px）<input id="diagram-font-size" type="number" min="12" max="28" value="${element.fontSize}"/></label>` : element.kind === 'legend' ? `<label class="field"><input type="checkbox" id="diagram-show-status" ${element.showStatus ? 'checked' : ''}/> 显示状态图例</label>` : `<h4>分组成员</h4>${members}<button class="button full-width" data-action="fit-group" ${element.locked ? 'disabled' : ''}>按成员适应边界</button>`}</div><div class="inspector-apply"><button class="button primary full-width" data-action="apply-diagram">应用图面修改</button></div><div class="diagram-actions"><button class="button" data-action="toggle-diagram-lock">${element.locked ? '解锁' : '锁定'}位置</button><button class="button danger" data-action="delete">${element.kind === 'group' ? '解散分组' : '删除'}</button></div>` : `<div class="detail-section"><p class="diagram-readonly-text">${element.kind === 'note' ? esc(element.text) : element.kind === 'group' ? `${element.members.length} 个节点 · 仅供查看` : '图例不代表实时采样值'}</p></div>`}`;
}

function createDiagram(kind: DiagramElement['kind']) {
  if (mode !== 'edit') return;
  try {
    const bounds = $('#graph').getBoundingClientRect();
    const point = graph.clientToLocal(bounds.x + bounds.width / 2 - 140, bounds.y + bounds.height / 2 - 80);
    const result = addDiagramElement(captureDocument(), kind, selectedIds(), { x: Math.round(point.x / 10) * 10, y: Math.round(point.y / 10) * 10 });
    executeEditorCommand(result.document, [result.id]); toast(`已添加${elementLabels[kind]}，可在属性栏修改`);
  } catch (error) { toast(error instanceof Error ? error.message : '添加图面元素失败', true); }
}

function applyDiagram() {
  if (mode !== 'edit' || !selected || !diagramOf(selected)) return;
  clearFieldErrors($('#inspector'));
  const document = captureDocument(), element = document.topology.elements!.find((e) => e.id === selected!.id)!;
  const title = $<HTMLInputElement>('#diagram-title').value.trim();
  if (!title) { showFieldError('diagram-title', '请填写标题'); return; }
  element.title = title; element.color = $<HTMLInputElement>('#diagram-color').value;
  if (!element.locked) {
    for (const field of ['width', 'height'] as const) {
      const value = Number($<HTMLInputElement>(`#diagram-${field}`).value), min = field === 'width' ? 160 : 80;
      if (!Number.isFinite(value) || value < min || value > 10000) { showFieldError(`diagram-${field}`, `请输入 ${min}–10000 px`); return; }
      element[field] = value;
    }
  }
  if (element.kind === 'note') { element.text = $<HTMLTextAreaElement>('#diagram-text').value; element.fontSize = Number($<HTMLInputElement>('#diagram-font-size').value); if (!Number.isInteger(element.fontSize) || element.fontSize < 12 || element.fontSize > 28) { showFieldError('diagram-font-size', '字号需为 12–28 px 的整数'); return; } }
  if (element.kind === 'legend') element.showStatus = $<HTMLInputElement>('#diagram-show-status').checked;
  if (element.kind === 'group' && !element.locked) element.members = [...$('#inspector').querySelectorAll<HTMLInputElement>('input[name="group-member"]:checked')].map((input) => input.value);
  try { executeEditorCommand(parseDocument(document), [element.id]); toast('图面修改已应用，可一步撤销'); }
  catch (error) { showFieldError('diagram-title', error instanceof Error ? error.message : '配置不合法'); }
}

function renderInspector() {
  const panel = $('#inspector');
  const cells = selectedCells();
  if (mode === 'edit' && cells.length > 1) {
    const nodes = cells.filter(isDeviceNode), objects = cells.filter((cell) => cell.isNode());
    const ids = new Set(nodes.map((node) => node.id));
    const internal = graph.getEdges().filter((edge) => ids.has(edge.getSourceCellId()) && ids.has(edge.getTargetCellId())).length;
    panel.innerHTML = `<div class="inspector-header"><span>批量选择</span>${button('deselect', '取消选择', 'X')}</div><div class="multi-selection"><span class="multi-symbol">${icon('Layers', 28)}</span><h3>${nodes.length} 个节点${objects.length > nodes.length ? ` / ${objects.length - nodes.length} 个图面` : ''}</h3><p>${internal} 条内部连线会随节点一起复制。</p><p>拖动未锁定对象移动所选内容，分组包含其成员。方向键微移，Shift 加速；对外拐点保留原位。</p><div class="multi-node-list">${objects.slice(0, 12).map((node) => `<button data-select-cell="${esc(node.id)}">${icon(diagramOf(node) ? 'Layers' : devices[node.getData<DeviceData>().kind].icon, 15)}${esc(diagramOf(node)?.title || node.getData<DeviceData>().title)}</button>`).join('')}</div><p>使用工具栏复制、粘贴或批量删除。每次操作都可撤销。</p></div>`;
    return;
  }
  if (!selected) {
    panel.innerHTML = `<div class="inspector-header"><span>属性</span><span class="small-kicker">未选择</span></div><div class="inspector-empty">${icon('MousePointer2', 22)}<strong>选择节点或连线</strong><p>${mode === 'edit' ? '查看并编辑属性。按住 Ctrl、⌘ 或 Shift 点选多个节点，也可以使用框选工具。' : '查看节点参数、状态和连接关系。切换到编辑模式可以修改拓扑。'}</p><div class="empty-shortcuts"><span>Ctrl / ⌘ S <b>手动保存</b></span><span>Ctrl / ⌘ Z <b>撤销</b></span>${mode === 'edit' ? '<span>Ctrl / ⌘ C / V <b>复制 / 粘贴</b></span><span>Delete <b>删除选中</b></span>' : ''}</div></div>`;
    return;
  }
  if (diagramOf(selected)) { renderDiagramInspector(snapshot().elements!.find((e) => e.id === selected!.id)!); return; }
  if (selected.isEdge()) {
    const edge = selected;
    const kind = (edge.getData()?.kind || 'ethernet') as LinkKind;
    const source = graph.getCellById(edge.getSourceCellId()) as Node;
    const target = graph.getCellById(edge.getTargetCellId()) as Node;
    panel.innerHTML = `
      <div class="inspector-header"><span>链路详情</span>${button('deselect', '关闭详情', 'X')}</div>
      <div class="detail-identity"><span class="detail-device-icon" style="color:${linkTypes[kind].color}">${icon('Cable', 27)}</span><h3>${esc(edge.getData()?.label || linkTypes[kind].label)}</h3><span class="type-caption">${linkTypes[kind].label} / ${linkTypes[kind].short}</span><span class="link-status-badge" id="edge-runtime-status"></span><p class="link-id">链路 ID：${esc(edge.id)}</p></div>
      <div class="detail-section"><h4>连接端点</h4>
        <div class="endpoint"><span class="tiny-dot green"></span><div><strong>${esc(source.getData<DeviceData>().title)}</strong><small>${esc(edge.getSourcePortId().toUpperCase())}</small></div></div><div class="endpoint-line"></div>
        <div class="endpoint"><span class="tiny-dot green"></span><div><strong>${esc(target.getData<DeviceData>().title)}</strong><small>${esc(edge.getTargetPortId().toUpperCase())}</small></div></div>
      </div>
      <div class="detail-section"><h4>${mode === 'edit' ? '链路与线缆设置' : '线缆外观'}</h4>
        ${mode === 'edit' ? `<label class="field">链路名称<input id="edge-label-input" maxlength="80" value="${esc(edge.getData()?.label || '')}" /></label>` : ''}
        ${renderCableSettings(edge, kind)}
        ${mode === 'edit' ? `<button class="button full-width" data-action="apply-edge">${icon('Check', 15)}应用修改</button>` : ''}
      </div>
      ${mode === 'edit' ? `<div class="inspector-callout">${icon('Move', 17)}<p>拖动绿色圆点调整拐点，拖动线段中间的手柄改变走线。点击线条添加拐点，双击拐点删除。查看模式会隐藏端口与编辑手柄。</p></div><button class="button danger inspector-bottom-button" data-action="delete">${icon('Trash2', 15)}删除这条连线</button>` : `<div class="detail-section"><button class="button full-width" data-action="toggle-link-demo" ${telemetry.mode === 'external' ? 'disabled' : ''}>${runtimeLinkState(edge).status === 'down' ? '模拟链路连通' : '模拟链路断开'}</button><p class="field-hint">宿主模式按链路 ID 接收真实状态。端点设备离线时链路断开；等待链路数据时保持静止。</p></div>`}
    `;
    updateLinkBadge(runtimeLinkState(edge));
    return;
  }
  const node = selected as Node;
  const data = node.getData<DeviceData>();
  const def = devices[data.kind];
  const status = runtimeStatus(node);
  const connected = graph.getConnectedEdges(node) || [];
  panel.innerHTML = `<div class="inspector-header"><span>${mode === 'edit' ? '节点属性' : '节点详情'}</span>${button('deselect', '关闭详情', 'X')}</div><div class="detail-identity"><span class="detail-device-icon kind-${data.kind}">${icon(def.icon, 28)}</span><h3>${esc(data.title)}</h3><span class="type-caption">${esc(def.model)}</span><span class="status-pill ${status}" id="detail-status"><i></i>${esc(runtimeLabel(node))}</span></div>${mode === 'edit' ? `<div class="node-lock-status">${icon(data.locked ? 'LockKeyhole' : 'Move', 14)}<span>${data.locked ? '位置已锁定' : groupOf(snapshot(), node.id)?.locked ? '所属区域已锁定' : '位置可编辑'}</span><button data-action="toggle-node-lock">${data.locked ? '解锁' : '锁定'}</button></div>` : ''}${mode === 'edit' ? `${renderNodeEditor(node, data)}<button class="button danger inspector-bottom-button" data-action="delete">${icon('Trash2', 15)}删除节点及连线</button>` : `${metricDetails(def, (key) => status === 'offline' ? '—' : metricValue(node, key), dataModeLabel())}${renderDevicePorts(node)}<div class="detail-section"><h4>节点信息</h4><div class="detail-info"><div><span>业务对象 ID</span><strong>${esc(data.deviceId)}</strong></div><div><span>管理地址</span><strong>${esc(data.address || '未配置')}</strong></div><div><span>关联链路</span><strong>${connected.length} 条</strong></div></div></div><div class="detail-section"><h4>连接关系</h4><div class="connection-list">${connected.map((edge) => { const other = graph.getCellById(edge.getSourceCellId() === node.id ? edge.getTargetCellId() : edge.getSourceCellId()); return `<button data-select-cell="${esc(edge.id)}"><span style="background:${linkTypes[(edge.getData()?.kind || 'ethernet') as LinkKind].color}"></span>${esc(other?.getData<DeviceData>()?.title || '未连接')}${icon('ChevronRight', 13)}</button>`; }).join('') || '<p class="muted">暂无连接</p>'}</div></div>`}`;
  const badge = document.querySelector<HTMLElement>('#detail-status');
  if (badge) updateStatusBadge(badge, status, telemetry.mode === 'external' && !values.has(node.id), runtimeLabel(node));
  updateTrend();
}

function updateCounts() {
  const key = JSON.stringify(graph.getEdges().map((edge) => [edge.getData()?.kind, edge.getData()?.appearance]));
  if (key !== legendEdgesKey) {
    legendEdgesKey = key;
    elementNodes().filter((node) => diagramOf(node)?.kind === 'legend').forEach((node) => node.setData({ element: structuredClone(diagramOf(node)!) }, { runtime: true }));
  }
  const nodes = deviceNodes();
  $('#stat-total').textContent = String(nodes.length);
  $('#stat-links').textContent = String(graph.getEdges().length);
}

function updateRuntime() {
  deviceNodes().forEach((node, index) => {
    const data = node.getData<DeviceData>();
    const def = devices[data.kind];
    const status = runtimeStatus(node);
    telemetry.sample(node.id, def, status, tick, index, paused);
    const card = [...$('#graph').querySelectorAll<HTMLElement>('[data-device-node]')].find((el) => el.dataset.deviceNode === node.id);
    if (card) {
      updateNodeStatus(card, status, telemetry.mode === 'external' && !values.has(node.id), runtimeLabel(node));
      card.querySelectorAll<HTMLElement>('[data-metric]').forEach((el) => {
        const m = def.metrics.find((entry) => entry.key === el.dataset.metric)!;
        el.innerHTML = metricValueHtml(status === 'offline' ? '—' : metricValue(node, m.key), m.unit);
      });
    }
    if (selected?.id === node.id) {
      document.querySelectorAll<HTMLElement>('[data-detail-metric]').forEach((el) => { const m = def.metrics.find((entry) => entry.key === el.dataset.detailMetric)!; el.innerHTML = metricValueHtml(status === 'offline' ? '—' : metricValue(node, m.key), m.unit); });
      const badge = document.querySelector<HTMLElement>('#detail-status');
      if (badge) updateStatusBadge(badge, status, telemetry.mode === 'external' && !values.has(node.id), runtimeLabel(node));
    }
  });
  graph.getEdges().forEach((edge) => {
    // Update the full cable material only when appearance or endpoint status changes.
    renderCable(edge);
  });
  updateTrend(); updateCounts();
  $('#update-time').textContent = telemetry.mode === 'external' && !values.size ? '等待宿主数据' : `${telemetry.mode === 'external' ? '宿主数据更新' : paused ? '已暂停 · 最后采样' : '数据更新'} ${time(lastUpdate)}`;
}
function updateTrend() {
  if (!selected?.isNode() || mode !== 'monitor' || !document.querySelector('#trend-line')) return;
  const node = selected;
  const metric = devices[node.getData<DeviceData>().kind].metrics[0];
  if (!metric) return;
  const history = historyValues.get(node.id) || [];
  if (history.length < 2 || runtimeStatus(node) === 'offline') { $('#trend-line').setAttribute('d', ''); $('#trend-area').setAttribute('d', ''); return; }
  const padding = Math.max((Math.max(...history) - Math.min(...history)) * .1, .1);
  const low = Math.min(...history) - padding, high = Math.max(...history) + padding;
  const points = history.map((v, i) => `${i / (history.length - 1) * 210},${44 - (v - low) / (high - low) * 36}`);
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
  portEditor = null; portEditorNode = null; templateEditor = null;
  const root = $('#modal-content'); root.onclick = null; root.oninput = null; root.onchange = null;
  $('#modal').classList.remove('port-config-modal', 'library-modal', 'template-modal');
  $('.modal-footer').innerHTML = '<button class="button primary" data-action="close-modal">知道了</button>';
  $('#modal-title').textContent = title; $('#modal-content').innerHTML = content;
  const dialog = $<HTMLDialogElement>('#modal'); if (!dialog.open) dialog.showModal();
}
$<HTMLDialogElement>('#modal').addEventListener('close', () => {
  portEditor = null; portEditorNode = null; templateEditor = null;
  const root = $('#modal-content'); root.onclick = null; root.oninput = null; root.onchange = null;
});
function addFromLibrary(kind: DeviceKind, point?: { x: number; y: number }) {
  if (mode !== 'edit') return;
  if (deviceNodes().length >= 300) { toast('每张拓扑最多添加 300 个节点', true); return; }
  const rect = $('#graph').getBoundingClientRect();
  const p = point || graph.clientToLocal(rect.x + rect.width / 2 - NODE_WIDTH * graph.zoom() / 2, rect.y + rect.height / 2 - NODE_HEIGHT * graph.zoom() / 2);
  const count = deviceNodes().length + 1;
  const node = addDevice(newDevice(kind, p.x, p.y, count));
  syncDrawingLayers(graph, snapshot());
  selectCell(node); updateRuntime(); flushHistory(); toast(`已添加${devices[kind].label}，可拖动调整位置`);
}

function captureDocument(): TopologyDocument {
  return { ...activeDocument, updatedAt: new Date().toISOString(), templates: templatesFromDefinitions(devices), topology: snapshot() };
}
function adoptWorkspace(state: Workspace) {
  library = { version: 1, activeId: state.activeId, documents: state.documents };
  storageError = ''; storageConflict = false;
}
function storageFailure(error: unknown) {
  storageConflict = error instanceof WorkspaceConflict;
  storageError = error instanceof WorkspaceConflict ? error.message : `本地保存失败：${error instanceof Error ? error.message : '存储不可用'}。当前画布仍可导出备份。`;
  clearTimeout(draftSaveTimer); updateSaveStatus();
}
function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  if (loading || !activeDocument || !workspace || storageConflict) return;
  if (documentSignature(captureDocument()) !== draftSignature) draftSaveTimer = setTimeout(saveDraftNow, 1000);
}
function saveDraftNow(force = false) {
  clearTimeout(draftSaveTimer);
  if (!workspace || storageConflict) return false;
  const current = captureDocument(), signature = documentSignature(current);
  if (signature === draftSignature && !force) return true;
  try {
    adoptWorkspace(workspace.saveDraft(current));
    activeDocument = current; draftSignature = signature; updateSaveStatus(); return true;
  } catch (error) { storageFailure(error); return false; }
}
function commitLibrary(next: TopologyLibrary) {
  if (!workspace) { toast('本地库无法读取，请导出当前图并检查存档', true); return false; }
  try { adoptWorkspace(workspace.updateLibrary(next)); return true; }
  catch (error) { storageFailure(error); toast(storageError, true); return false; }
}
function persistCurrent() {
  flushHistory();
  clearTimeout(draftSaveTimer);
  const current = captureDocument();
  if (!workspace) return false;
  try {
    adoptWorkspace(workspace.saveDocument(current));
    activeDocument = current; savedSignature = draftSignature = documentSignature(current); updateSaveStatus(); return true;
  } catch (error) { storageFailure(error); toast(storageError, true); return false; }
}
function applyEditorDocument(document: TopologyDocument, fit = false) {
  activeDocument = structuredClone(document); installEditorTemplates(activeDocument);
  loadTopology(activeDocument.topology, fit, true);
  renderSidebar(); updateDocumentChrome();
}
function openDocument(id: string) {
  const doc = library.documents.find((d) => d.id === id);
  if (!doc) return;
  clearTimeout(draftSaveTimer);
  if (activeDocument && library.documents.some((d) => d.id === activeDocument.id)) documentHistories.set(activeDocument.id, { undo: undoStack, redo: redoStack });
  const recovery = workspace?.document(id);
  const recovered = recovery?.draft && !recovery.stale ? recovery.draft.document : doc;
  activeDocument = structuredClone(recovered); installEditorTemplates(activeDocument);
  savedSignature = documentSignature(doc); draftSignature = documentSignature(recovered);
  resetOutage(); tick = 0; lastUpdate = new Date();
  filters.clear(); Object.keys(linkTypes).forEach((kind) => filters.add(kind as LinkKind));
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((button) => { button.classList.add('active'); button.setAttribute('aria-pressed', 'true'); });
  loadTopology(activeDocument.topology, true);
  const history = documentHistories.get(id);
  undoStack = history?.undo || [captureDocument()]; redoStack = history?.redo || [];
  setMode(mode); updateSaveStatus(); updateHistoryButtons();
  if (recovery?.draft) toast(recovery.stale ? '找到基于较早版本的草稿，请在“草稿与历史”中选择恢复' : `已恢复 ${time(new Date(recovery.draft.savedAt))} 自动保存的草稿`);
}
function updateDocumentChrome() {
  if (!activeDocument) return;
  $('#library-count').textContent = String(library.documents.length);
  $('.station-picker').innerHTML = `<span class="station-avatar">${icon('Network', 17)}</span><span><strong title="${esc(activeDocument.name)}">${esc(activeDocument.name)}</strong><small>${esc(categoryLabel(activeDocument.category))}</small></span>${icon('ChevronDown', 14)}`;
  $('#crumb-document').textContent = activeDocument.name;
  $('#page-title').textContent = activeDocument.name;
  $('#page-title').title = activeDocument.name;
  $('.canvas-watermark').innerHTML = `${esc(activeDocument.name)}<span>${esc(categoryLabel(activeDocument.category))}</span>`;
  $('.panel-title h2').textContent = '画布';
  $('.panel-title .tag').textContent = categoryLabel(activeDocument.category);
  document.title = `${activeDocument.name} · Topology`;
  document.body.dataset.documentId = activeDocument.id;
}
function documentsForLibrary() {
  return library.documents.map((saved) => {
    const recovery = workspace?.document(saved.id);
    const document = saved.id === activeDocument.id ? captureDocument() : recovery?.draft && !recovery.stale ? recovery.draft.document : saved;
    return { ...document, updatedAt: saved.id === activeDocument.id ? activeDocument.updatedAt : document.updatedAt, hasDraft: !!recovery?.draft || documentSignature(document) !== documentSignature(saved) };
  });
}
let libraryQuery = '', libraryCategory = '', librarySort: LibrarySort = 'modified';
function showLibrary() {
  finishGroupDrag(); flushHistory(); saveDraftNow();
  const categoryOptions = [...new Set(documentsForLibrary().map((doc) => doc.category))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'zh-CN'));
  if (!categoryOptions.includes(libraryCategory)) libraryCategory = '';
  showModal('拓扑库', `<div class="library-dialog-heading"><p>管理拓扑与草稿，按布局缩略图快速辨认。</p><button class="button primary" data-action="new-document">${icon('Plus', 15)}新建拓扑</button></div><div class="library-filters"><label class="library-search">${icon('Search', 16)}<input id="library-search" type="search" aria-label="搜索拓扑" placeholder="搜索名称、说明或分类" value="${esc(libraryQuery)}" /></label><label class="field">分类<select id="library-category"><option value="">全部分类</option>${categoryOptions.map((category) => `<option value="${esc(category)}" ${category === libraryCategory ? 'selected' : ''}>${esc(categoryLabel(category))}</option>`).join('')}</select></label><label class="field">排序<select id="library-sort"><option value="modified" ${librarySort === 'modified' ? 'selected' : ''}>最近修改</option><option value="name" ${librarySort === 'name' ? 'selected' : ''}>名称</option></select></label></div><div class="library-result-summary"><span id="library-result-count" role="status" aria-live="polite"></span><button class="text-button" data-action="clear-library-filters">清除筛选</button></div><div class="document-grid" id="library-results"></div>`);
  $('#modal').classList.add('library-modal');
  $('#library-search').addEventListener('input', (event) => { libraryQuery = (event.target as HTMLInputElement).value; renderLibraryResults(); });
  $('#library-category').addEventListener('change', (event) => { libraryCategory = (event.target as HTMLSelectElement).value; renderLibraryResults(); });
  $('#library-sort').addEventListener('change', (event) => { librarySort = (event.target as HTMLSelectElement).value as LibrarySort; renderLibraryResults(); });
  renderLibraryResults();
}
function renderLibraryResults() {
  const documents = documentsForLibrary(), results = findDocuments(documents, libraryQuery, libraryCategory, librarySort);
  $('#library-result-count').textContent = `显示 ${results.length} / ${documents.length} 张拓扑`;
  $('#library-results').innerHTML = results.map((d) => `<article class="document-card ${d.id === activeDocument.id ? 'current' : ''}" data-library-document="${esc(d.id)}"><button class="document-preview" data-preview-document="${esc(d.id)}" aria-label="打开${esc(d.name)}">${documentThumbnail(d)}</button><div class="document-card-top"><span>${esc(categoryLabel(d.category))}</span>${d.id === activeDocument.id ? '<b>当前</b>' : ''}${d.hasDraft ? '<b>含草稿</b>' : ''}</div><h3 title="${esc(d.name)}">${esc(d.name)}</h3><p>${esc(d.description || '暂无说明')}</p><div class="document-card-meta">${d.topology.nodes.length} 个节点 · ${d.topology.edges.length} 条连接<time datetime="${esc(d.updatedAt)}" title="${esc(new Date(d.updatedAt).toLocaleString('zh-CN'))}">${new Date(d.updatedAt).toLocaleDateString('zh-CN')}</time></div><div class="document-card-actions">${['open', 'viewer', 'rename', 'copy', 'delete'].map((action, i) => `<button type="button" data-document-action="${action}" data-document-id="${esc(d.id)}" ${action === 'delete' && library.documents.length === 1 ? 'disabled title="至少保留一张图"' : ''}>${['打开', '独立预览', '信息', '复制', '删除'][i]}</button>`).join('')}</div></article>`).join('') || `<div class="library-empty">${icon('Search', 25)}<strong>未找到匹配的拓扑</strong><p>试试其他关键词或分类，也可以清除筛选。</p></div>`;
}
function showDocumentInfo(id: string) {
  const doc = documentsForLibrary().find((d) => d.id === id)!;
  showModal('拓扑信息', `<input type="hidden" id="metadata-document-id" value="${esc(id)}"/><label class="field">名称<input id="metadata-name" maxlength="100" value="${esc(doc.name)}" /></label><label class="field">分类<input id="metadata-category" maxlength="60" value="${esc(doc.category)}" list="document-categories" /></label><datalist id="document-categories">${Object.keys(categories).map((key) => `<option value="${key}">${categoryLabel(key)}</option>`).join('')}</datalist><label class="field">说明<textarea id="metadata-description" maxlength="1000" rows="4">${esc(doc.description)}</textarea></label><p class="modal-description">文件格式：Topology v3<br>文档 ID：${esc(doc.id)}</p><button class="button primary" data-action="apply-document-info">保存信息</button>`);
}
function showDraftHistory() {
  flushHistory(); saveDraftNow();
  if (!workspace) { toast('本地存储无法读取，当前图仍可导出备份', true); return; }
  const recovery = workspace.document(activeDocument.id), current = documentSignature(captureDocument());
  const reason: Record<LocalVersion['reason'], string> = { manual: '手动保存', auto: '自动检查点', 'before-restore': '恢复前备份', previous: '原保存版本' };
  const row = (id: string, title: string, date: string, document: TopologyDocument) => `<article class="history-entry"><div><strong>${esc(title)}</strong><small>${esc(new Date(date).toLocaleString('zh-CN'))} · ${document.topology.nodes.length} 个节点 · ${document.topology.edges.length} 条连接</small></div><button class="button" data-restore-version="${esc(id)}" ${current === documentSignature(document) ? 'disabled' : ''}>恢复到草稿</button></article>`;
  showModal('草稿与历史', `<p class="modal-description">自动草稿与手动保存分别保留。恢复前会备份当前内容，恢复操作可撤销。每图最多 10 个历史版本，全库最多 40 个，并按容量清理较早历史。</p><div class="history-summary">${recovery.draft ? row('draft', recovery.stale ? '较早基准的自动草稿 · 需手动恢复' : '最近自动保存的草稿', recovery.draft.savedAt, recovery.draft.document) : '<p class="muted">当前没有自动草稿。</p>'}${row('saved', '手动保存版本', recovery.saved.updatedAt, recovery.saved)}</div><h3 class="history-heading">历史版本</h3><div class="history-list">${workspace.history(activeDocument.id).map((entry) => row(entry.id, reason[entry.reason], entry.savedAt, entry.document)).join('') || '<p class="muted">手动保存或持续编辑后会生成历史版本。</p>'}</div>`);
  $('#modal').classList.add('library-modal');
}
function restoreLocalVersion(id: string) {
  if (!workspace) return;
  flushHistory();
  try {
    adoptWorkspace(workspace.restoreDraft(activeDocument.id, id, captureDocument()));
    const recovery = workspace.document(activeDocument.id);
    const target = recovery.draft?.document || recovery.saved;
    draftSignature = documentSignature(target);
    applyEditorDocument(target, true); flushHistory();
    $<HTMLDialogElement>('#modal').close();
    toast('已恢复到草稿，恢复前内容已备份；可撤销或手动保存');
  } catch (error) { storageFailure(error); toast(storageError, true); }
}
function openIndependentViewer(id: string) {
  if (!saveDraftNow()) return;
  const url = new URL('./viewer.html', window.location.href); url.searchParams.set('document', id);
  url.searchParams.set('draft', '1');
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
  if (!saveDraftNow()) return;
  if (action === 'open') {
    if (commitLibrary({ ...library, activeId: id })) { openDocument(id); $<HTMLDialogElement>('#modal').close(); }
  } else if (action === 'copy') {
    const source = documentsForLibrary().find((d) => d.id === id)!;
    const { hasDraft: _hasDraft, ...document } = source;
    const copy = duplicateDocument(document);
    if (commitLibrary({ ...library, activeId: copy.id, documents: [...library.documents, copy] })) { openDocument(copy.id); showLibrary(); }
  } else if (action === 'confirm-delete') {
    const deletingActive = id === activeDocument.id;
    try { if (commitLibrary(removeDocument(library, id))) { documentHistories.delete(id); if (deletingActive) openDocument(library.activeId); showLibrary(); updateDocumentChrome(); } }
    catch (error) { toast(error instanceof Error ? error.message : '无法删除', true); }
  }
}
function renderBindingControls(data: DeviceData) {
  return propertySection('binding', '数据绑定 <span>用于独立展示</span>', bindingForm(data, devices[data.kind]), false, 'binding-fields');
}

function showTemplateEditor(template?: NodeTemplate) {
  if (mode !== 'edit') return;
  const initial: NodeTemplate = template || { id: newId('custom'), version: 1, label: '', en: 'CUSTOM', model: '', icon: 'Cpu', metrics: [], ports: Object.entries(portSides).map(([side, label]) => ({ id: side, label, side: side as keyof typeof portSides, kind: 'logical' })) };
  const nodes = snapshot().nodes.filter(n => n.data.kind === initial.id);
  const inherited = new Set(nodes.filter(n => n.data.ports === undefined).map(n => n.id));
  const connected = new Set(snapshot().edges.flatMap(e => [e.source, e.target]).filter(e => inherited.has(e.cell)).map(e => e.port));
  showModal(template ? '编辑节点模板' : '新建节点模板', '');
  $('#modal').classList.add('template-modal');
  $('.modal-footer').innerHTML = '<button class="button" data-action="close-modal">取消</button><button class="button primary" data-action="create-template">应用模板</button>';
  templateEditor = new TemplateEditor($('#modal-content'), initial, nodes.length, connected);
}
function showTemplateManager() {
  if (mode !== 'edit') return;
  const document = captureDocument();
  showModal('管理节点模板', `<div class="template-manager-actions"><button class="button primary" data-action="new-template">新建模板</button><button class="button" data-action="import-template">导入模板文件</button><input hidden type="file" accept=".json,application/json" id="template-import-file"/></div><p class="modal-description">修改会同步当前图的引用节点；复制或导入生成独立模板，不替换原模板。导出文件可在其他拓扑中导入。</p><p id="template-import-error" class="template-import-error" role="alert"></p>${document.templates.map(t => `<div class="template-manager-row"><span><strong>${esc(t.label)}</strong><small>${esc(t.id)} · ${document.topology.nodes.filter(n => n.data.kind === t.id).length} 个节点 · ${t.metrics.length} 个参数</small></span><button class="button" data-template-command="edit" data-template-id="${esc(t.id)}">编辑</button><button class="button" data-template-command="copy" data-template-id="${esc(t.id)}">复制</button><button class="button" data-template-command="export" data-template-id="${esc(t.id)}">导出</button></div>`).join('')}`);
  $('#modal').classList.add('template-modal');
  $<HTMLInputElement>('#template-import-file').onchange = async event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('模板文件不能超过 512 KB');
      const template = importTemplate(JSON.parse(await file.text()), captureDocument().templates);
      showTemplateEditor(template);
    } catch (error) { $('#template-import-error').textContent = error instanceof Error ? error.message : '模板文件不合法'; }
    finally { input.value = ''; }
  };
}
function handleTemplateCommand(target: HTMLElement) {
  const button = target.closest<HTMLElement>('[data-template-command]'); if (!button || mode !== 'edit') return false;
  const template = captureDocument().templates.find(t => t.id === button.dataset.templateId); if (!template) return true;
  if (button.dataset.templateCommand === 'edit') showTemplateEditor(template);
  if (button.dataset.templateCommand === 'copy') showTemplateEditor(duplicateTemplate(template));
  if (button.dataset.templateCommand === 'export') downloadBlob(new Blob([JSON.stringify(templateFile(template), null, 2)], { type: 'application/json' }), `${template.id}.template.json`);
  return true;
}

function executeEditorCommand(document: TopologyDocument, selectIds: string[] = []) {
  if (mode !== 'edit') return false;
  finishGroupDrag(); flushHistory();
  if (documentSignature(document) === documentSignature(captureDocument())) return false;
  applyEditorDocument(document);
  graph.resetSelection(selectIds.map((id) => graph.getCellById(id)).filter(Boolean));
  refreshSelection(); flushHistory();
  return true;
}

function copyNodes() {
  const result = copySelection(captureDocument(), new Set(selectedCells().map((cell) => cell.id)));
  if (!result) { toast('请选择要复制的节点', true); return; }
  clipboard = result; pasteCount = 0; updateHistoryButtons();
  toast(`已复制 ${result.nodes.length} 个节点${result.elements?.length ? ` / ${result.elements.length} 个图面元素` : ''}和 ${result.edges.length} 条内部连线`);
}

function pasteNodes(duplicate = false, at?: { x: number; y: number }) {
  if (mode !== 'edit') return;
  const content = duplicate ? copySelection(captureDocument(), new Set(selectedCells().map((cell) => cell.id))) : clipboard;
  if (!content) return;
  try {
    const offset = duplicate ? 40 : (pasteCount + 1) * 40;
    const shift = at ? { x: Math.round(at.x / 10) * 10 - Math.min(...[...content.nodes, ...(content.elements || [])].map((node) => node.x)), y: Math.round(at.y / 10) * 10 - Math.min(...[...content.nodes, ...(content.elements || [])].map((node) => node.y)) } : { x: offset, y: offset };
    const result = pasteSelection(captureDocument(), content, shift);
    executeEditorCommand(result.document, result.nodeIds);
    if (!duplicate) pasteCount++;
    if (result.nodeIds.length) graph.centerCell(graph.getCellById(result.nodeIds[0]));
    toast(`已粘贴 ${result.nodeIds.length} 个图形对象，节点副本需确认数据绑定`);
  } catch (error) { toast(error instanceof Error ? error.message : '粘贴失败', true); }
}

function deleteSelected() {
  if (mode !== 'edit') return;
  const cells = selectedCells(); if (!cells.length) return;
  const skipped = cells.filter((cell) => cell.isNode() && cellLocked(cell));
  const result = deleteSelection(captureDocument(), new Set(cells.map((cell) => cell.id)));
  const keptIds = skipped.map((cell) => cell.id);
  const changed = executeEditorCommand(result, keptIds);
  toast(`${changed ? '已删除选中对象及关联连线，可一步撤销' : '没有可删除的对象'}${skipped.length ? `；跳过 ${skipped.length} 个锁定节点` : ''}`);
}

function moveSelected(dx: number, dy: number) {
  if (mode !== 'edit') return;
  const ids = selectedCells().filter((cell) => cell.isNode()).map((node) => node.id);
  if (!ids.length) return;
  try {
    const document = captureDocument(), movement = movableSelection(document.topology, new Set(ids)); document.topology = moveSelection(document.topology, new Set(ids), { x: dx, y: dy });
    executeEditorCommand(document, ids);
    const skipped = movement.skipped.size;
    if (skipped) toast(`移动已跳过 ${skipped} 个锁定节点`);
  } catch (error) { toast(error instanceof Error ? error.message : '无法移动', true); }
}

function selectedIds() { return new Set(selectedCells().map((cell) => cell.id)); }
function setSelectedLock(locked: boolean) {
  if (mode !== 'edit') return;
  const cells = selectedCells(), nodes = cells.filter((cell) => cell.isNode());
  if (!nodes.length) return;
  const changed = nodes.filter((node) => !!(diagramOf(node)?.locked || node.getData<DeviceData>().locked) !== locked).length;
  const inherited = nodes.filter((node) => isDeviceNode(node) && groupOf(snapshot(), node.id)?.locked).length;
  executeEditorCommand(setPositionLocks(captureDocument(), selectedIds(), locked), cells.map((cell) => cell.id));
  toast(`${changed ? `已${locked ? '锁定' : '解锁'} ${changed} 个对象的位置` : '所选对象的锁定状态未改变'}${!locked && inherited ? '；所属区域仍锁定，请解锁区域' : ''}`);
}

function applyLayout(result: LayoutResult, label: string) {
  if (result.moved) executeEditorCommand(result.document, selectedCells().map((cell) => cell.id));
  toast(`${result.moved ? `${label}：调整 ${result.moved} 个节点` : '节点已处于目标布局'}${result.skipped ? `；跳过 ${result.skipped} 个锁定节点` : ''}`);
}
function runAlignment(alignment: Alignment) {
  if (mode !== 'edit') return;
  try { applyLayout(alignNodes(captureDocument(), selectedIds(), alignment), alignmentLabels[alignment]); }
  catch (error) { toast(error instanceof Error ? error.message : '对齐失败', true); }
}
function runDistribution(axis: LayoutAxis, gap?: number) {
  if (mode !== 'edit') return false;
  try {
    applyLayout(distributeNodes(captureDocument(), selectedIds(), axis, gap), gap === undefined ? '等距分布' : `间距 ${gap} px`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '分布失败';
    const inline = document.querySelector('#spacing-error'); if (inline) inline.textContent = message;
    toast(message, true); return false;
  }
}
function showSpacingDialog() {
  if (mode !== 'edit') return;
  const nodes = selectedCells().filter(isDeviceNode), movable = nodes.filter((node) => !cellLocked(node));
  if (movable.length < 2) { toast('指定间距至少需要两个未锁定节点', true); return; }
  showModal('指定节点间距', `<p class="modal-description">固定排序后的第一个节点，按实际尺寸依次排布，另一坐标轴保持原位。${nodes.length - movable.length ? `将跳过 ${nodes.length - movable.length} 个锁定节点。` : ''}</p><label class="field">方向<select id="layout-axis"><option value="horizontal">水平间距</option><option value="vertical">垂直间距</option></select></label><label class="field">节点之间的空隙（px）<input id="layout-gap" type="number" min="0" max="${MAX_LAYOUT_GAP}" step="any" value="24" /></label><p id="spacing-error" class="spacing-error" role="alert"></p><button class="button primary" data-action="apply-spacing">应用间距</button>`);
}

function closeContextMenu(focus = false) {
  const menu = $('#canvas-context-menu');
  if (menu.hidden) return;
  menu.hidden = true; contextPoint = null;
  if (focus) $('#graph').focus({ preventScroll: true });
}
function openContextMenu(x: number, y: number, cell: Cell | null) {
  finishGroupDrag(); closeContextMenu();
  if (!cell) selectCell(null);
  else if (mode === 'edit' ? !graph.isSelected(cell) : selected?.id !== cell.id) selectCell(cell);
  const nodes = selectedCells().filter((item) => item.isNode()), locked = nodes.filter(cellLocked).length;
  const movable = nodes.length - locked, deletable = selectedCells().some((item) => item.isEdge() || !cellLocked(item));
  const devicesOnly = nodes.filter(isDeviceNode), movableDevices = devicesOnly.filter((node) => !cellLocked(node)).length;
  const item = (command: string, label: string, shortcut = '', disabled = false) => `<button type="button" role="menuitem" data-context-command="${command}" ${disabled ? 'disabled' : ''}><span>${esc(label)}</span>${shortcut ? `<kbd>${esc(shortcut)}</kbd>` : ''}</button>`;
  const divider = '<div class="context-divider" role="separator"></div>';
  let content = '';
  if (mode === 'edit') {
    content = item('copy', '复制节点及内部连线', 'Ctrl / ⌘ C', !nodes.length) + item('paste', '粘贴到此处', 'Ctrl / ⌘ V', !clipboard) + item('duplicate', '创建副本', 'Ctrl / ⌘ D', !nodes.length) + item('delete', '删除所选对象', 'Delete', !deletable) + divider;
    content += item('lock-selected', '锁定节点位置', '', !movable) + item('unlock-selected', '解锁节点位置', '', !locked);
    content += `<div class="context-label">节点对齐${locked ? ' · 锁定节点作参照' : ''}</div><div class="context-align-grid">${Object.entries(alignmentLabels).map(([key, label]) => item(`align:${key}`, label, '', devicesOnly.length < 2 || !movableDevices)).join('')}</div>`;
    content += item('distribute:horizontal', '水平等距分布', '', movableDevices < 3) + item('distribute:vertical', '垂直等距分布', '', movableDevices < 3) + item('spacing', '指定节点间距…', '', movableDevices < 2) + divider;
    content += item('add-group', '创建区域分组') + item('add-note', '添加文字注释') + item('add-legend', '添加链路图例') + item('layer-front', '置顶', '', !nodes.length) + item('layer-back', '置底', '', !nodes.length) + divider + item('select-all', '全选图形对象', 'Ctrl / ⌘ A');
  }
  content += item('fit', '适应画布') + item('export-options', '导出拓扑…');
  const menu = $('#canvas-context-menu'); menu.innerHTML = content; menu.hidden = false;
  menu.style.left = '0px'; menu.style.top = '0px';
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - bounds.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - bounds.height - 6))}px`;
  const local = graph.clientToLocal(x, y); contextPoint = { x: local.x, y: local.y };
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}

$('#align-command').addEventListener('change', (event) => {
  const select = event.target as HTMLSelectElement, value = select.value; select.value = '';
  if (value) runAlignment(value as Alignment);
});
$('#distribute-command').addEventListener('change', (event) => {
  const select = event.target as HTMLSelectElement, value = select.value; select.value = '';
  if (value === 'gap') showSpacingDialog();
  else if (value) runDistribution(value as LayoutAxis);
});
function changeLayer(front: boolean) {
  if (mode !== 'edit') return;
  const document = captureDocument(); document.topology = reorder(document.topology, selectedIds(), front);
  executeEditorCommand(parseDocument(document), [...selectedIds()]); toast(front ? '已置顶，可撤销' : '已置底，可撤销');
}
$('#layer-command').addEventListener('change', (event) => {
  const select = event.target as HTMLSelectElement, value = select.value; select.value = '';
  if (value) changeLayer(value === 'front');
});
$('#canvas-context-menu').addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-context-command]');
  if (!button || button.disabled) return;
  const command = button.dataset.contextCommand!, point = contextPoint; closeContextMenu();
  if (command.startsWith('align:')) runAlignment(command.slice(6) as Alignment);
  else if (command.startsWith('distribute:')) runDistribution(command.slice(11) as LayoutAxis);
  else if (command === 'spacing') showSpacingDialog();
  else if (command === 'paste') pasteNodes(false, point || undefined);
  else actions[command]?.();
});
$('#canvas-context-menu').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeContextMenu(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const buttons = [...$('#canvas-context-menu').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
});
document.addEventListener('mousedown', (event) => { if (!(event.target as Element).closest('#canvas-context-menu')) closeContextMenu(); });
window.addEventListener('resize', () => closeContextMenu());
window.addEventListener('scroll', (event) => { if (!$('#canvas-context-menu').contains(event.target as globalThis.Node)) closeContextMenu(); }, true);

function finishGroupDrag() {
  if (!dragSession) return;
  const session = dragSession;
  dragSession = null; flushHistory();
  const changed = [...session.before.nodes, ...(session.before.elements || [])].some((node) => {
    if (!session.ids.has(node.id)) return false;
    const cell = graph.getCellById(node.id);
    return cell?.isNode() && (cell.getPosition().x !== node.x || cell.getPosition().y !== node.y);
  });
  if (changed && session.skipped) toast(`移动已跳过 ${session.skipped} 个锁定节点`);
}

function captureExportState(): ExportState {
  return Object.fromEntries(deviceNodes().map((node) => {
    const data = node.getData<DeviceData>();
    const status = runtimeStatus(node);
    return [node.id, { status, pending: telemetry.mode === 'external' && !values.has(node.id), values: Object.fromEntries(devices[data.kind].metrics.flatMap((m) => {
      const value = values.get(node.id)?.[m.key] ?? (telemetry.mode === 'simulation' ? m.base : undefined);
      return value === undefined ? [] : [[m.key, value]];
    })), label: runtimeLabel(node) }];
  }));
}
function captureLinkState(): LinkTelemetryData {
  return Object.fromEntries(graph.getEdges().map(edge => { const state = runtimeLinkState(edge); return [edge.id, { status: state.status, active: state.active }]; }));
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
    const definition = captureDocument(), state = captureExportState(), links = captureLinkState();
    let blob: Blob;
    if (format === 'json') blob = new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' });
    else if (format === 'html') blob = new Blob([await standaloneHtml(definition, state, links)], { type: 'text/html;charset=utf-8' });
    else {
      const image = graphSvg(graph, definition, state, links);
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
  'add-group': () => createDiagram('group'),
  'add-note': () => createDiagram('note'),
  'add-legend': () => createDiagram('legend'),
  'apply-diagram': applyDiagram,
  'layer-front': () => changeLayer(true),
  'layer-back': () => changeLayer(false),
  'toggle-diagram-lock': () => { if (selected && diagramOf(selected)) setSelectedLock(!diagramOf(selected)!.locked); },
  'fit-group': () => {
    if (mode !== 'edit' || !selected || diagramOf(selected)?.kind !== 'group') return;
    try { executeEditorCommand(fitRegion(captureDocument(), selected.id), [selected.id]); }
    catch (error) { toast(error instanceof Error ? error.message : '无法适应成员', true); }
  },
  'toggle-sidebar': () => workbench.toggle('sidebar'),
  'close-sidebar': () => workbench.closeDrawer(),
  'toggle-inspector': () => workbench.toggle('inspector'),
  'clear-library-filters': () => {
    libraryQuery = libraryCategory = '';
    $<HTMLInputElement>('#library-search').value = ''; $<HTMLSelectElement>('#library-category').value = '';
    renderLibraryResults(); $('#library-search').focus();
  },
  'lock-selected': () => setSelectedLock(true),
  'unlock-selected': () => setSelectedLock(false),
  'toggle-node-lock': () => { if (selected?.isNode()) setSelectedLock(!selected.getData<DeviceData>().locked); },
  'apply-spacing': () => {
    const raw = $<HTMLInputElement>('#layout-gap').value.trim();
    if (!raw) { $('#spacing-error').textContent = '请输入节点间距'; return; }
    if (runDistribution($<HTMLSelectElement>('#layout-axis').value as LayoutAxis, Number(raw))) $<HTMLDialogElement>('#modal').close();
  },
  'tool-select': () => { canvasTool = 'select'; updateCanvasTool(); },
  'tool-pan': () => { canvasTool = 'pan'; updateCanvasTool(); },
  'select-all': () => { if (mode === 'edit') graph.resetSelection(graph.getNodes()); },
  copy: () => { if (mode === 'edit') copyNodes(); },
  paste: () => pasteNodes(),
  duplicate: () => pasteNodes(true),
  'draft-history': showDraftHistory,
  'retry-draft': () => { if (saveDraftNow(true)) toast('草稿已重新保存'); },
  'export-current-backup': () => { void exportTopology('json'); },
  'export-reload-backup': () => { void exportTopology('json'); },
  'storage-reload': () => showModal('重新读取拓扑库', '<p class="modal-description">重新读取会替换当前画布，未成功保存的内容无法自动保留。请先导出当前图作为备份。</p><div class="storage-reload-actions"><button class="button" data-action="export-reload-backup">导出当前图</button><button class="button primary" data-action="confirm-storage-reload">重新读取并替换画布</button></div>'),
  'confirm-storage-reload': () => { reloadRequested = true; location.reload(); },
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
  'new-document': () => showModal('新建拓扑', `<label class="field">拓扑名称<input id="new-document-name" maxlength="100" placeholder="例如：运控中心机房" /></label><label class="field">起始内容<select id="new-document-kind">${Object.entries(categories).map(([key, label]) => `<option value="${key}">${label}${key === 'general' ? ' · 空白画布' : ' · 示例'}</option>`).join('')}</select></label><p class="modal-description">每张图独立保存。通用节点模板可用于节点连接、业务逻辑和子系统关系。</p><button class="button primary" data-action="create-document">创建并打开</button>`),
  'create-document': () => {
    clearFieldErrors($('#modal-content'));
    const name = $<HTMLInputElement>('#new-document-name').value.trim();
    if (!name) { showFieldError('new-document-name', '请填写拓扑名称'); return; }
    const category = $<HTMLSelectElement>('#new-document-kind').value;
    if (!saveDraftNow()) return;
    const doc = sampleDocument(category, name);
    if (commitLibrary({ ...library, activeId: doc.id, documents: [...library.documents, doc] })) { openDocument(doc.id); $<HTMLDialogElement>('#modal').close(); setMode('edit'); }
  },
  'apply-document-info': () => {
    clearFieldErrors($('#modal-content'));
    const id = $<HTMLInputElement>('#metadata-document-id').value;
    const name = $<HTMLInputElement>('#metadata-name').value.trim();
    const category = $<HTMLInputElement>('#metadata-category').value.trim();
    const description = $<HTMLTextAreaElement>('#metadata-description').value;
    if (!name) { showFieldError('metadata-name', '请填写拓扑名称'); return; }
    if (!category) { showFieldError('metadata-category', '请填写分类'); return; }
    if (!saveDraftNow()) return;
    if (!workspace) return;
    try {
      if (id === activeDocument.id) flushHistory();
      const source = documentsForLibrary().find((d) => d.id === id)!;
      const { hasDraft: _hasDraft, ...document } = source;
      const updated = { ...document, name, category, description, updatedAt: new Date().toISOString() };
      adoptWorkspace(workspace.saveDraft(updated));
      if (id === activeDocument.id) {
        activeDocument = updated; draftSignature = documentSignature(updated); flushHistory();
        updateDocumentChrome(); renderSidebar(); updateSaveStatus();
      }
      showLibrary();
    } catch (error) { storageFailure(error); toast(storageError, true); }
  },
  'new-template': () => showTemplateEditor(),
  'manage-templates': showTemplateManager,
  'import-template': () => $<HTMLInputElement>('#template-import-file').click(),
  'create-template': () => {
    if (mode !== 'edit' || !templateEditor) return;
    clearFieldErrors($('#modal-content'));
    const template = templateEditor.read(); if (!template) return;
    try {
      const next = applyTemplate(captureDocument(), template);
      executeEditorCommand(next, selectedCells().map(c => c.id));
      $<HTMLDialogElement>('#modal').close();
      toast('模板已应用，引用节点同步更新，可撤销');
    } catch (error) { showFieldError('template-metrics', error instanceof Error ? error.message : '模板配置不合法'); }
  },
  monitor: () => setMode('monitor'), edit: () => setMode('edit'), deselect: () => selectCell(null),
  fit: fitGraph, 'zoom-in': () => graph.zoom(.1), 'zoom-out': () => graph.zoom(-.1),
  save: () => { if (persistCurrent()) toast('当前拓扑已保存到拓扑库'); },
  export: () => { void exportTopology('json'); },
  import: () => $<HTMLInputElement>('#import-file').click(),
  undo: () => { if (mode !== 'edit') return; flushHistory(); if (undoStack.length < 2) return; redoStack.push(undoStack.pop()!); applyEditorDocument(structuredClone(undoStack.at(-1)!)); scheduleDraftSave(); updateHistoryButtons(); toast('已撤销上一步'); },
  redo: () => { if (mode !== 'edit') return; flushHistory(); const next = redoStack.pop(); if (!next) return; undoStack.push(next); applyEditorDocument(structuredClone(next)); scheduleDraftSave(); updateHistoryButtons(); toast('已重做'); },
  delete: deleteSelected,
  pause: () => { if (telemetry.mode !== 'simulation') return; paused = !paused; syncDataControls(); updateRuntime(); },
  outage: () => {
    if (telemetry.mode !== 'simulation') return;
    const node = outage && outageNodeId ? graph.getCellById(outageNodeId) : graph.getCellById('srv-01') || deviceNodes().find((n) => n.getData<DeviceData>().kind === 'server') || deviceNodes()[0];
    if (!node?.isNode()) { resetOutage(); toast('当前图中没有可演示的节点', true); return; }
    outage = !outage; outageNodeId = outage ? node.id : null;
    const el = document.querySelector<HTMLElement>('[data-action="outage"]')!;
    el.classList.toggle('outage-active', outage); el.innerHTML = `${icon('Unplug', 16)}<span>${outage ? '恢复在线' : '离线演示'}</span>`;
    updateRuntime(); if (mode === 'monitor' && selected?.id === node.id) renderInspector();
    toast(outage ? `已模拟“${node.getData<DeviceData>().title}”离线，关联链路已变灰` : '节点已恢复在线');
  },
  'apply-device': () => {
    if (mode !== 'edit' || !selected?.isNode()) return;
    clearFieldErrors($('#inspector'));
    const title = $<HTMLInputElement>('#device-title').value.trim();
    const deviceId = $<HTMLInputElement>('#device-id').value.trim();
    const visibleMetrics = [...document.querySelectorAll<HTMLInputElement>('input[name="visible-metric"]:checked')].map((el) => el.value);
    if (!title) { showFieldError('device-title', '请填写节点名称'); return; }
    if (!deviceId) { showFieldError('device-id', '请填写业务对象 ID'); return; }
    if (visibleMetrics.length > 2) { showFieldError('visible-metrics', '卡片最多展示 2 项参数'); return; }
    const binding = readBindingForm($('#inspector'), devices[selected.getData<DeviceData>().kind]);
    if (!binding) return;
    try {
      let document = captureDocument();
      const record = document.topology.nodes.find((node) => node.id === selected!.id)!;
      record.data = { ...record.data, title, deviceId, address: $<HTMLInputElement>('#device-address').value.trim(), status: $<HTMLSelectElement>('#device-status').value as DeviceStatus, visibleMetrics, binding };
      const owner = groupOf(document.topology, selected.id), target = $<HTMLSelectElement>('#node-group').value;
      if (owner?.id !== target) {
        if (owner) document.topology = setGroupMembers(document.topology, owner.id, owner.members.filter((id) => id !== selected!.id));
        if (target) { const group = document.topology.elements?.find((e) => e.id === target); if (group?.kind === 'group') document.topology = setGroupMembers(document.topology, target, [...group.members, selected.id]); }
      }
      executeEditorCommand(parseDocument(document), [selected.id]);
      toast('节点属性已应用，草稿将自动保存');
    } catch (error) { showFieldError('node-group', error instanceof Error ? error.message : '分组配置不合法'); }

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
      if (!graph.getCellById(node.id)) throw new Error('节点已不存在');
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
    const status = parseLinkStatus($<HTMLSelectElement>('#edge-status').value);
    const flow = parseLinkFlow({ enabled: $<HTMLInputElement>('#edge-flow-enabled').checked, direction: $<HTMLSelectElement>('#edge-flow-direction').value, speed: $<HTMLSelectElement>('#edge-flow-speed').value });
    flushHistory();
    const label = $<HTMLInputElement>('#edge-label-input').value.trim();
    selected.setData({ ...selected.getData(), label, appearance, status, flow });
    selected.setLabels(edgeLabels(label));
    renderCable(selected); flushHistory(); renderInspector();
    toast('链路样式、初始状态和流转设置已更新');
  },
  'toggle-link-demo': () => {
    if (mode !== 'monitor' || telemetry.mode !== 'simulation' || !selected?.isEdge()) return;
    linkDemonstration.set(selected.id, { status: runtimeLinkState(selected).status === 'down' ? 'up' : 'down' });
    updateRuntime(); renderInspector();
  },
  fullscreen: () => {
    const panel = $('.topology-panel');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => toast('无法退出全屏', true));
    else panel.requestFullscreen().catch(() => toast('浏览器未允许全屏，可使用浏览器全屏功能', true));
  },
  help: () => showModal('使用指南', `<p class="modal-description">这是用于制作和复用拓扑的工作台。编辑节点与连接，在查看模式下验证参数及状态。</p><ol class="help-list"><li><strong>编辑布局</strong><p>切换“拓扑编辑”。点击或拖入左侧节点；拖动节点时会按 10 px 网格吸附。</p></li><li><strong>连接节点</strong><p>从节点边缘的彩色端口拖向另一个同色端口。紫色 RF、金色 IF、绿色以太网。网络允许形成环路，禁止节点连到自身。</p></li><li><strong>多选与复制</strong><p>使用框选工具或按住 Ctrl、⌘、Shift 点选节点。Ctrl / ⌘ C / V 复制粘贴，Ctrl / ⌘ D 创建副本。内部连线随节点复制；副本生成新的业务对象 ID，需重新确认绑定。拖动已选节点整体移动，方向键微移，Shift 加速。</p></li><li><strong>调整走线</strong><p>点击连线，拖动圆点或线段中间的绿色手柄。点击线条增加拐点，双击拐点删除。走线采用手动控制，拖动节点后可按需调整邻接线段。</p></li><li><strong>对齐与锁定</strong><p>工具栏和右键菜单支持六种对齐、等距分布和指定间距；锁定节点会跳过移动及批量删除，所有批量操作可一步撤销。</p></li><li><strong>工作区与属性</strong><p>顶部左侧按钮折叠节点库，画布右上角按钮折叠属性栏。拖动侧栏分隔线调整宽度，方向键微调，双击恢复默认。属性按分区展开，输入错误会就地提示。</p></li><li><strong>保存与恢复</strong><p>编辑停止后自动保存草稿，刷新或切图自动恢复；“保存布局”建立手动保存版本。“草稿与历史”可恢复旧版本，恢复操作可撤销。“导出 / 导入”用 JSON 迁移配置。</p></li><li><strong>查看模式</strong><p>每两秒更新模拟参数，布局保持不变。点击节点查看详情；点击“离线演示”验证状态变化。</p></li></ol><div class="shortcut-list"><span>Ctrl / ⌘ S <b>保存</b></span><span>Ctrl / ⌘ Z <b>撤销</b></span><span>Delete <b>删除选中</b></span><span>Esc <b>取消选择</b></span><span>E / M <b>编辑 / 查看</b></span></div><button class="button" data-action="reset">${icon('RotateCcw', 15)}恢复示例拓扑</button>`),

  'close-modal': () => $<HTMLDialogElement>('#modal').close(),
  reset: () => { flushHistory(); resetOutage(); const sample = sampleDocument(activeDocument.category); applyEditorDocument({ ...activeDocument, templates: sample.templates, topology: sample.topology }, true); flushHistory(); $<HTMLDialogElement>('#modal').close(); setMode(mode); toast('已恢复当前分类的示例，可撤销'); },
};

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  handleBindingClick(target);
  if (handleTemplateCommand(target)) return;
  const preview = target.closest<HTMLElement>('[data-preview-document]');
  if (preview) { handleDocumentAction('open', preview.dataset.previewDocument!); return; }
  const restore = target.closest<HTMLElement>('[data-restore-version]');
  if (restore && !(restore as HTMLButtonElement).disabled) { restoreLocalVersion(restore.dataset.restoreVersion!); return; }
  const docAction = target.closest<HTMLElement>('[data-document-action]');
  if (docAction && !(docAction as HTMLButtonElement).disabled) { handleDocumentAction(docAction.dataset.documentAction!, docAction.dataset.documentId!); return; }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action && actions[action]) { if (target.closest('#sidebar')) workbench.closeDrawer(); actions[action](); return; }
  const device = target.closest<HTMLElement>('[data-device]')?.dataset.device as DeviceKind;
  if (device && Object.hasOwn(devices, device)) { addFromLibrary(device); workbench.closeDrawer(); return; }
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
    if (!saveDraftNow()) return;
    const document = library.documents.some((d) => d.id === parsed.id) ? { ...parsed, id: newId(), name: `${parsed.name.slice(0, 96)} 导入` } : parsed;
    if (commitLibrary({ ...library, activeId: document.id, documents: [...library.documents, document] })) {
      openDocument(document.id); toast('拓扑已导入为新文档，原有拓扑保留在库中');
    }
  } catch (error) { toast(error instanceof Error ? error.message : '导入失败，文件格式不合法', true); }
  finally { input.value = ''; }
});
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('#canvas-context-menu')) return;
  if (target.id === 'layout-gap' && event.key === 'Enter') { event.preventDefault(); actions['apply-spacing'](); return; }
  if (!$('#canvas-context-menu').hidden && event.key === 'Escape') { event.preventDefault(); closeContextMenu(true); return; }
  if (target.closest('input, textarea, select, [contenteditable="true"]') || $<HTMLDialogElement>('#modal').open) return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    const bounds = $('#graph').getBoundingClientRect();
    openContextMenu(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, selectedCells()[0] || null); return;
  }
  const key = event.key.toLowerCase();
  if (mode === 'edit' && (event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'd'].includes(key)) {
    event.preventDefault();
    actions[({ a: 'select-all', c: 'copy', v: 'paste', d: 'duplicate' } as Record<string, string>)[key]](); return;
  }
  if (mode === 'edit' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selectedCells().some((cell) => cell.isNode())) {
    event.preventDefault(); const step = event.shiftKey ? 50 : 10;
    moveSelected(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0); return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); actions.save(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) actions.redo(); else actions.undo(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); actions.redo(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { if (mode === 'edit' && selectedCells().length) { event.preventDefault(); actions.delete(); } }
  else if (event.key === 'Escape') { finishGroupDrag(); selectCell(null); }
  else if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'e') setMode('edit');
  else if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'm') setMode('monitor');
});
graph.on('selection:changed', refreshSelection);
graph.on('node:click', ({ node }) => { if (mode !== 'edit') selectCell(node); });
graph.on('edge:click', ({ edge }) => { if (mode !== 'edit') selectCell(edge); });
graph.on('blank:click', () => selectCell(null));
graph.on('node:mousedown', ({ node, e }) => {
  if (mode === 'edit' && e.button === 0 && diagramOf(node)?.kind === 'group' && !cellMovable(node)) toast('区域或成员位置已锁定，请先解锁再整体移动', true);
  if (mode !== 'edit' || !cellMovable(node) || e.button !== 0 || (e.target as Element).closest('.x6-port')) return;
  if ((e.ctrlKey || e.metaKey || e.shiftKey) && !graph.isSelected(node)) return;
  if (!graph.isSelected(node)) graph.resetSelection([node]);
  flushHistory(); clearTimeout(recordTimer); clearTimeout(draftSaveTimer);
  const position = node.getPosition();
  const before = snapshot(), movable = movableSelection(before, new Set(selectedCells().map((cell) => cell.id)));
  dragSession = { nodeId: node.id, ids: movable.ids, before, x: position.x, y: position.y, skipped: movable.skipped.size };
});
graph.on('node:change:position', ({ node }) => {
  if (!dragSession || applyingDrag || node.id !== dragSession.nodeId) return;
  applyingDrag = true;
  try {
    const position = node.getPosition();
    const next = moveSelection(dragSession.before, dragSession.ids, { x: position.x - dragSession.x, y: position.y - dragSession.y });
    for (const record of [...next.nodes, ...(next.elements || [])]) if (record.id !== node.id && dragSession.ids.has(record.id)) {
      const cell = graph.getCellById(record.id); if (cell.isNode()) cell.position(record.x, record.y, { groupMove: true });
    }
    for (const record of next.edges) if (dragSession.ids.has(record.source.cell) && dragSession.ids.has(record.target.cell)) {
      const cell = graph.getCellById(record.id); if (cell.isEdge()) cell.setVertices(record.vertices, { groupMove: true });
    }
  } catch (error) {
    for (const record of [...dragSession.before.nodes, ...(dragSession.before.elements || [])]) if (dragSession.ids.has(record.id)) {
      const cell = graph.getCellById(record.id); if (cell.isNode()) cell.position(record.x, record.y, { groupMove: true });
    }
    for (const record of dragSession.before.edges) if (dragSession.ids.has(record.source.cell) && dragSession.ids.has(record.target.cell)) {
      const cell = graph.getCellById(record.id); if (cell.isEdge()) cell.setVertices(record.vertices, { groupMove: true });
    }
    toast(error instanceof Error ? error.message : '无法移动选中节点', true);
  } finally { applyingDrag = false; }
});
graph.on('node:mouseup', finishGroupDrag);
graph.on('node:resize', () => { finishGroupDrag(); flushHistory(); clearTimeout(recordTimer); clearTimeout(draftSaveTimer); resizeBefore = captureDocument(); });
graph.on('node:resized', () => {
  if (!resizeBefore) return;
  const before = resizeBefore; resizeBefore = null;
  try { parseDocument(captureDocument()); flushHistory(); renderInspector(); }
  catch (error) { applyEditorDocument(before); toast(error instanceof Error ? error.message : '尺寸超出范围', true); }
});
graph.on('node:contextmenu', ({ node, e }) => { e.preventDefault(); e.stopPropagation(); openContextMenu(e.clientX, e.clientY, node); });
graph.on('edge:contextmenu', ({ edge, e }) => { e.preventDefault(); e.stopPropagation(); openContextMenu(e.clientX, e.clientY, edge); });
graph.on('blank:contextmenu', ({ e }) => { e.preventDefault(); e.stopPropagation(); openContextMenu(e.clientX, e.clientY, null); });
document.addEventListener('mouseup', () => { if (dragSession) queueMicrotask(finishGroupDrag); });
window.addEventListener('blur', finishGroupDrag);
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
graph.on('scale', () => { closeContextMenu(); updateZoom(); });
graph.on('translate', () => closeContextMenu());
document.addEventListener('fullscreenchange', () => setTimeout(fitGraph, 60));
let reloadRequested = false;
window.addEventListener('beforeunload', (event) => {
  if (reloadRequested) return;
  finishGroupDrag();
  saveDraftNow();
  const signature = documentSignature(captureDocument());
  if (signature !== savedSignature && signature !== draftSignature) event.preventDefault();
});
window.addEventListener('pagehide', () => { if (!reloadRequested) saveDraftNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraftNow(); });
window.addEventListener('storage', (event) => {
  try {
    if ((event.key === LIBRARY_KEY || event.key === null) && workspace?.changedElsewhere()) storageFailure(new WorkspaceConflict());
  } catch (error) { storageFailure(error); }
});

try {
  workspace = new WorkspaceStore(localStorage); library = workspace.snapshot();
} catch (error) {
  library = emptyLibrary();
  storageError = `存档无法读取：${error instanceof Error ? error.message : '请导入备份'}。已打开临时空图，原存档未覆盖。`;
  toast(storageError, true);
}
openDocument(library.activeId);
setInterval(() => { if (paused || telemetry.mode !== 'simulation') return; tick++; lastUpdate = new Date(); updateRuntime(); }, 2000);

// A stable interface for integration and browser verification; telemetry never changes layout.
declare global { interface Window { stationPrototype: { graph: Graph; snapshot: typeof snapshot; setDataMode: typeof setDataMode; getDataMode: () => EditorDataMode; updateTelemetry: (deviceId: string, metrics: Record<string, number>, status?: DeviceStatus) => number; updateLinkTelemetry: (linkId: string, status: LinkStatus, active?: boolean) => number } } }
window.stationPrototype = {
  graph, snapshot, setDataMode, getDataMode: () => telemetry.mode,
  updateLinkTelemetry(linkId, status, active) {
    const checked = parseLinkData({ [linkId]: { status, ...(active === undefined ? {} : { active }) } });
    const edge = graph.getCellById(linkId);
    if (!edge?.isEdge()) return 0;
    const changed = telemetry.setMode('external');
    if (changed) { paused = false; linkData = {}; resetOutage(); }
    linkData = { ...linkData, ...checked };
    lastUpdate = new Date(); updateRuntime(); syncDataControls();
    if (changed) { renderSidebar(); if (mode === 'monitor') renderInspector(); }
    return 1;
  },
  updateTelemetry(deviceId, metrics, status) {
    const nodes = deviceNodes().filter((n) => n.getData<DeviceData>().deviceId === deviceId);
    const previousMode = telemetry.mode;
    const count = telemetry.update(nodes.map((node) => node.id), metrics, status);
    if (!count) return 0;
    if (previousMode !== telemetry.mode) { paused = false; linkData = {}; resetOutage(); }
    nodes.forEach((node) => telemetry.recordHistory(node.id, devices[node.getData<DeviceData>().kind].metrics[0]?.key, runtimeStatus(node)));
    lastUpdate = new Date(); updateRuntime(); syncDataControls();
    if (previousMode !== telemetry.mode) { renderSidebar(); if (mode === 'monitor') renderInspector(); }
    return count;
  },
};
