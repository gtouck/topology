import { Graph, type Node } from '@antv/x6';
import { parseDocument, definitionsFromTemplates, newId, type TopologyDocument } from './document';
import { addRenderedNode, edgeLabels, installCableTexture, registerTopologyShapes } from './rendering';
import { cableAppearance, cableAttributes } from './cables';
import { resolveNodeData, parseTelemetryData, mergeTelemetryData, type TelemetryData } from './runtime-data';
import { escapeHtml as esc } from './icons';
import type { DeviceData, DeviceDefinition, DeviceRecord } from './topology';
import cardStyles from './viewer-cards.css?inline';
import statusStyles from './node-status.css?inline';
import { updateNodeStatus, updateReceivedState } from './node-status-ui';
import { FreshnessTracker, parseFreshness, parseFreshnessSnapshot, type FreshnessOptions, type ConnectionState, type RuntimeDataStatus, type FreshnessSnapshot } from './data-freshness';
import { addDiagramNode, isDeviceNode, syncDrawingLayers } from './diagram-rendering';
import { parseLinkData, mergeLinkData, resolveLinkState, linkStateLabel, type LinkTelemetryData, type LinkTelemetryPatch } from './link-state';
import { renderLink } from './link-rendering';
import flowStyles from './link-flow.css?inline';

export interface TopologyViewerOptions {
  definition: unknown;
  data?: TelemetryData;
  linkData?: LinkTelemetryData;
  animations?: boolean;
  controls?: boolean;
  freshness?: FreshnessOptions;
  snapshot?: boolean;
  snapshotState?: { nodes?: FreshnessSnapshot; links?: FreshnessSnapshot };
  dataStatus?: boolean;
  onNodeClick?: (event: { node: DeviceRecord; source: string }) => void;
}

const styles = `${cardStyles}${statusStyles.replaceAll('#graph ', '.topology-viewer ')}${flowStyles.replaceAll('#graph ', '.topology-viewer ')}
.topology-viewer{position:relative;width:100%;height:100%;min-height:160px;overflow:hidden;background:#f9fbfa;color:#42584a;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;isolation:isolate}
.topology-viewer *{box-sizing:border-box}.topology-viewer .tv-canvas{position:absolute;inset:0}
.topology-viewer .diagram-element{width:100%;height:100%;overflow:hidden}.topology-viewer .diagram-group{pointer-events:none}.topology-viewer .diagram-element svg{display:block;font-family:Arial,"PingFang SC",sans-serif}
.topology-viewer .x6-port{opacity:0!important;pointer-events:none!important}.topology-viewer .x6-cell-tools{display:none!important}
.topology-viewer .tv-controls{position:absolute;right:12px;bottom:12px;display:flex;gap:4px;align-items:center;background:#fff;border:1px solid #dfe7dd;border-radius:7px;padding:4px;z-index:2}
.topology-viewer .tv-controls button{font:inherit;border:0;background:transparent;color:#7286a6;padding:5px 8px;cursor:pointer;border-radius:4px}.topology-viewer .tv-controls button:hover{background:#eef3fb}.topology-viewer .tv-controls button:focus-visible{outline:2px solid #8eabd6}
.topology-viewer .tv-controls span{font-size:10px;min-width:32px;text-align:center;color:#8899b2}
.topology-viewer .tv-data-status{position:absolute;left:12px;top:10px;max-width:calc(100% - 24px);padding:5px 8px;border:1px solid #dfe5ed;border-radius:5px;background:#fffffff0;color:#788596;font-size:11px;pointer-events:none;z-index:2}\n.topology-viewer .tv-empty{position:absolute;inset:0;display:grid;place-items:center;color:#a0b196;font-size:13px;pointer-events:none}
`;

/** Framework-independent, read-only viewer. No storage, simulator, network or workbench imports. */
export class TopologyViewer {
  private graph: Graph;
  private root: HTMLDivElement;
  private definition!: TopologyDocument;
  private definitions: Record<string, DeviceDefinition> = {};
  private data: TelemetryData = {};
  private linkData: LinkTelemetryData = {};
  private destroyed = false;
  private observer: ResizeObserver;
  private frame = 0;
  private nodeFreshness: FreshnessTracker;
  private linkFreshness: FreshnessTracker;
  private freshnessTimer?: ReturnType<typeof setTimeout>;
  private snapshotMode = false;
  private highlighted: string | null = null;
  private visibilityHandler = () => { if (!this.destroyed && document.visibilityState === 'visible') this.refresh(); };
  private textureId = newId('braid');

  constructor(container: HTMLElement, private options: TopologyViewerOptions) {
    const checked = parseDocument(options.definition);
    const initialData = parseTelemetryData(options.data ?? {}), initialLinks = parseLinkData(options.linkData ?? {});
    const snapshotNodes = parseFreshnessSnapshot(options.snapshotState?.nodes ?? {}), snapshotLinks = parseFreshnessSnapshot(options.snapshotState?.links ?? {});
    if (options.snapshotState && !options.snapshot) throw new Error('快照接收状态仅用于 snapshot 模式');
    this.nodeFreshness = new FreshnessTracker(options.freshness); this.linkFreshness = new FreshnessTracker(options.freshness);
    if (!container || typeof container.appendChild !== 'function') throw new Error('请提供有效的展示容器');
    registerTopologyShapes();
    this.root = document.createElement('div'); this.root.className = 'topology-viewer';
    this.root.innerHTML = `<style>${styles}</style><div class="tv-canvas" role="img" aria-label="拓扑图"></div>${options.controls === false ? '' : '<div class="tv-controls"><button type="button" data-tv="out" aria-label="缩小">−</button><span>100%</span><button type="button" data-tv="in" aria-label="放大">＋</button><button type="button" data-tv="fit">适应画布</button></div>'}`;
    container.appendChild(this.root);
    this.graph = new Graph({ container: this.root.querySelector<HTMLElement>('.tv-canvas')!, autoResize: true, async: false, background: { color: '#f9fbfa' }, interacting: false, scaling: { min: .1, max: 3 }, panning: { enabled: true }, mousewheel: { enabled: true, modifiers: null, minScale: .1, maxScale: 3 }, connecting: { anchor: 'center', connectionPoint: 'anchor' } });
    installCableTexture(this.graph, this.textureId);
    this.root.onclick = (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-tv]')?.dataset.tv;
      if (action === 'fit') this.fit();
      if (action === 'in') this.graph.zoom(.1);
      if (action === 'out') this.graph.zoom(-.1);
    };
    this.graph.on('scale', () => { const label = this.root.querySelector('.tv-controls span'); if (label) label.textContent = `${Math.round(this.graph.zoom() * 100)}%`; });
    this.graph.on('node:click', ({ node }) => {
      if (!isDeviceNode(node)) return;
      this.highlight(node.id);
      const record = this.definition.topology.nodes.find((n) => n.id === node.id)!;
      this.options.onNodeClick?.({ node: structuredClone(record), source: this.nodeState(node).source });
    });
    this.graph.on('blank:click', () => this.highlight(null));
    this.observer = new ResizeObserver(() => { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { if (!this.destroyed) this.fit(); }); });
    this.observer.observe(container);
    this.setDefinition(checked);
    this.data = initialData; this.linkData = initialLinks;
    this.snapshotMode = options.snapshot === true;
    if (this.snapshotMode) {
      this.nodeFreshness.freeze(this.nodeIdsFor(Object.keys(initialData)), snapshotNodes);
      this.linkFreshness.freeze(Object.keys(initialLinks), snapshotLinks);
    } else {
      this.nodeFreshness.receive(this.nodeIdsFor(Object.keys(initialData).filter(key => Object.keys(initialData[key]).length > 0)));
      this.linkFreshness.receive(Object.keys(initialLinks));
    }
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.refresh();
  }

  private alive() { if (this.destroyed) throw new Error('展示组件已销毁'); }
  private nodeState(node: Node) { const data = node.getData<DeviceData>(); return resolveNodeData(data, this.definitions[data.kind], this.data, this.nodeFreshness.state(node.id)); }

  setDefinition(input: unknown) {
    this.alive();
    const definition = parseDocument(input); // Validate before touching an existing view.
    clearTimeout(this.freshnessTimer); this.nodeFreshness.clear(); this.linkFreshness.clear(); this.snapshotMode = false; this.highlighted = null;
    this.definition = definition; this.definitions = definitionsFromTemplates(definition.templates); this.data = {}; this.linkData = {};
    this.graph.clearCells();
    for (const record of definition.topology.nodes) addRenderedNode(this.graph, record, {
      definitions: this.definitions, status: (n) => this.nodeState(n).status,
      pending: (n) => this.nodeState(n).pending, freshness: (n) => this.nodeState(n).freshness.phase,
      value: (n, key) => this.nodeState(n).values[key], statusLabel: (n) => this.nodeState(n).label,
    });
    for (const edge of definition.topology.edges) this.graph.addEdge({ id: edge.id, shape: 'station-cable', source: edge.source, target: edge.target, vertices: edge.vertices, connector: { name: 'rounded', args: { radius: 8 } }, labels: edgeLabels(edge.label), data: { kind: edge.kind, appearance: edge.appearance, status: edge.status, flow: edge.flow }, attrs: cableAttributes(cableAppearance(edge.kind, edge.appearance), false, this.textureId), zIndex: 0 });
    for (const element of definition.topology.elements || []) addDiagramNode(this.graph, element, () => this.definition.topology);
    syncDrawingLayers(this.graph, definition.topology);
    this.root.querySelector('.tv-empty')?.remove();
    if (!definition.topology.nodes.length && !definition.topology.elements?.length) { const empty = document.createElement('div'); empty.className = 'tv-empty'; empty.textContent = '这张拓扑还没有内容'; this.root.appendChild(empty); }
    this.root.querySelector('.tv-canvas')!.setAttribute('aria-label', definition.name);
    this.refresh(); cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.fit());
  }

  getDefinition() { this.alive(); return structuredClone(this.definition); }

  private nodeIdsFor(sources: string[]) {
    const set = new Set(sources);
    return this.definition.topology.nodes.filter(n => set.has(n.data.binding?.source || n.data.deviceId)).map(n => n.id);
  }
  private startLive() {
    if (!this.snapshotMode) return;
    this.snapshotMode = false; this.nodeFreshness.clear(); this.linkFreshness.clear();
  }
  setLinkData(data: LinkTelemetryData) {
    this.alive(); const checked = parseLinkData(data); this.startLive();
    this.linkData = checked; this.linkFreshness.receive(Object.keys(checked), true); this.refresh();
  }
  updateLinkData(patch: LinkTelemetryPatch) {
    this.alive(); const checked = mergeLinkData(this.linkData, patch);
    const known = new Set(this.definition.topology.edges.map(e => e.id));
    const keys = Object.keys(patch).filter(key => known.has(key) && Object.keys(patch[key]).some(field => field === 'status' || field === 'active'));
    if (!keys.length) return;
    this.startLive(); this.linkData = checked; this.linkFreshness.receive(keys); this.refresh();
  }
  setData(data: TelemetryData) {
    this.alive(); const checked = parseTelemetryData(data); this.startLive(); this.data = checked;
    this.nodeFreshness.receive(this.nodeIdsFor(Object.keys(checked).filter(key => Object.keys(checked[key]).length > 0)), true); this.refresh();
  }
  updateData(patch: TelemetryData) {
    this.alive(); const checked = parseTelemetryData(patch), next = mergeTelemetryData(this.data, checked);
    const ids = this.nodeIdsFor(Object.keys(checked).filter(key => Object.keys(checked[key]).length > 0));
    if (!ids.length) return;
    this.startLive(); this.data = next; this.nodeFreshness.receive(ids); this.refresh();
  }
  configureFreshness(options: FreshnessOptions) {
    this.alive(); const checked = { staleAfterMs: parseFreshness(options) };
    this.nodeFreshness.configure(checked); this.linkFreshness.configure(checked); this.refresh();
  }
  setConnectionState(state: ConnectionState) {
    this.alive();
    if (state !== 'connected' && state !== 'disconnected') throw new Error('数据连接状态不合法');
    this.startLive(); this.nodeFreshness.setConnection(state); this.linkFreshness.setConnection(state); this.refresh();
  }
  getDataStatus(): RuntimeDataStatus {
    this.alive();
    return { nodes: this.nodeFreshness.snapshot(this.definition.topology.nodes.map(n => n.id)), links: this.linkFreshness.snapshot(this.definition.topology.edges.map(e => e.id)), connection: this.nodeFreshness.connection, staleAfterMs: this.nodeFreshness.staleAfterMs, mode: this.snapshotMode ? 'snapshot' : 'live' };
  }
  private scheduleFreshness() {
    clearTimeout(this.freshnessTimer);
    const delays = [this.nodeFreshness.nextDelay(), this.linkFreshness.nextDelay()].filter((value): value is number => value !== null);
    if (delays.length) this.freshnessTimer = setTimeout(() => { if (!this.destroyed) this.refresh(); }, Math.min(...delays));
  }
  private refresh() {
    this.graph.getNodes().filter(isDeviceNode).forEach((node) => {
      const state = this.nodeState(node);
      const view = this.graph.findViewByCell(node);
      const card = view?.container.querySelector<HTMLElement>('.device-card');
      if (!card) return;
      updateNodeStatus(card, state.status, state.pending, state.label, state.freshness.phase);
      updateReceivedState(card, state.freshness);
      card.querySelectorAll<HTMLElement>('[data-metric]').forEach((el) => {
        const key = el.dataset.metric!;
        const metric = this.definitions[node.getData<DeviceData>().kind].metrics.find((m) => m.key === key)!;
        const value = state.values[key] || '—';
        el.innerHTML = `${esc(value)}<small>${value === '—' ? '' : esc(metric.unit)}</small>`;
      });
    });
    this.graph.getEdges().forEach((edge) => {
      const data = edge.getData();
      const appearance = cableAppearance(data.kind, data.appearance);
      const endpoints = [edge.getSourceCell(), edge.getTargetCell()].filter(isDeviceNode).map(node => this.nodeState(node));
      const config = data;
      const state = resolveLinkState(config, endpoints, Object.hasOwn(this.linkData, edge.id) && this.linkFreshness.state(edge.id).phase !== 'waiting' ? this.linkData[edge.id] : undefined, true, this.linkFreshness.state(edge.id).phase);
      renderLink(this.graph, edge, appearance, state, { flow: config.flow, animate: this.options.animations !== false, textureId: this.textureId });
      const container = this.graph.findViewByCell(edge)?.container as SVGElement | undefined;
      if (container) { const text = updateReceivedState(container, this.linkFreshness.state(edge.id)), title = container.querySelector('title'); if (title) title.textContent = `${linkStateLabel(state)} · ${text}`; }
    });
    this.renderDataStatus(); this.scheduleFreshness();
  }

  private highlight(id: string | null) {
    this.highlighted = id; this.renderDataStatus();
    this.graph.getNodes().forEach((node) => this.graph.findViewByCell(node)?.container.querySelector('.device-card')?.classList.toggle('selected', node.id === id));
    this.graph.getEdges().forEach((edge) => { const view = this.graph.findViewByCell(edge); if (view) (view.container as SVGElement).style.opacity = !id || edge.getSourceCellId() === id || edge.getTargetCellId() === id ? '1' : '.2'; });
  }

  private renderDataStatus() {
    if (this.options.dataStatus === false) return;
    let label = this.root.querySelector<HTMLElement>('.tv-data-status');
    if (!label) { label = document.createElement('div'); label.className = 'tv-data-status'; this.root.appendChild(label); }
    if (this.highlighted) {
      label.dataset.receivedLabel = ''; updateReceivedState(label, this.nodeFreshness.state(this.highlighted));
    } else {
      const status = this.getDataStatus(), counts = Object.values(status.nodes).reduce((result, state) => { result[state.phase] = (result[state.phase] || 0) + 1; return result; }, {} as Record<string, number>);
      label.textContent = status.connection === 'disconnected' ? '数据连接中断' : this.snapshotMode ? '导出数据快照' : `实时数据 · 已接收 ${counts.fresh || 0} · 过期 ${counts.stale || 0} · 等待 ${counts.waiting || 0}`;
    }
  }
  fit() { this.alive(); if (this.graph.getNodes().length) this.graph.zoomToFit({ padding: 36, maxScale: 1 }); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; clearTimeout(this.freshnessTimer); document.removeEventListener('visibilitychange', this.visibilityHandler); cancelAnimationFrame(this.frame); this.observer.disconnect(); this.root.onclick = null; this.graph.dispose(); this.root.remove(); this.data = {}; this.linkData = {};
  }
}
