import { Graph, type Node } from '@antv/x6';
import { parseDocument, definitionsFromTemplates, newId, type TopologyDocument } from './document';
import { addRenderedNode, edgeLabels, installCableTexture, registerTopologyShapes } from './rendering';
import { cableAppearance, cableAttributes } from './cables';
import { resolveNodeData, type TelemetryData } from './runtime-data';
import { escapeHtml as esc } from './icons';
import type { DeviceData, DeviceDefinition, DeviceRecord } from './topology';
import cardStyles from './viewer-cards.css?inline';

export interface TopologyViewerOptions {
  definition: unknown;
  data?: TelemetryData;
  controls?: boolean;
  onNodeClick?: (event: { node: DeviceRecord; source: string }) => void;
}

const styles = `${cardStyles}
.topology-viewer{position:relative;width:100%;height:100%;min-height:160px;overflow:hidden;background:#f9fbfa;color:#42584a;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;isolation:isolate}
.topology-viewer *{box-sizing:border-box}.topology-viewer .tv-canvas{position:absolute;inset:0}
.topology-viewer .x6-port{opacity:0!important;pointer-events:none!important}.topology-viewer .x6-cell-tools{display:none!important}
.topology-viewer .tv-controls{position:absolute;right:12px;bottom:12px;display:flex;gap:4px;align-items:center;background:#fff;border:1px solid #dfe7dd;border-radius:7px;padding:4px;z-index:2}
.topology-viewer .tv-controls button{font:inherit;border:0;background:transparent;color:#62805e;padding:5px 8px;cursor:pointer;border-radius:4px}.topology-viewer .tv-controls button:hover{background:#eff5ed}.topology-viewer .tv-controls button:focus-visible{outline:2px solid #468b6c}
.topology-viewer .tv-controls span{font-size:10px;min-width:32px;text-align:center;color:#8a9c82}
.topology-viewer .tv-empty{position:absolute;inset:0;display:grid;place-items:center;color:#a0b196;font-size:13px;pointer-events:none}
`;

/** Framework-independent, read-only viewer. No storage, simulator, network or workbench imports. */
export class TopologyViewer {
  private graph: Graph;
  private root: HTMLDivElement;
  private definition!: TopologyDocument;
  private definitions: Record<string, DeviceDefinition> = {};
  private data: TelemetryData = {};
  private destroyed = false;
  private observer: ResizeObserver;
  private frame = 0;
  private textureId = newId('braid');
  private styleKeys = new Map<string, string>();

  constructor(container: HTMLElement, private options: TopologyViewerOptions) {
    const checked = parseDocument(options.definition);
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
      this.highlight(node.id);
      const record = this.definition.topology.nodes.find((n) => n.id === node.id)!;
      this.options.onNodeClick?.({ node: structuredClone(record), source: this.nodeState(node).source });
    });
    this.graph.on('blank:click', () => this.highlight(null));
    this.observer = new ResizeObserver(() => { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { if (!this.destroyed) this.fit(); }); });
    this.observer.observe(container);
    this.setDefinition(checked);
    if (options.data) this.setData(options.data);
  }

  private alive() { if (this.destroyed) throw new Error('展示组件已销毁'); }
  private nodeState(node: Node) { const data = node.getData<DeviceData>(); return resolveNodeData(data, this.definitions[data.kind], this.data); }

  setDefinition(input: unknown) {
    this.alive();
    const definition = parseDocument(input); // Validate before touching an existing view.
    this.definition = definition; this.definitions = definitionsFromTemplates(definition.templates); this.data = {}; this.styleKeys.clear();
    this.graph.clearCells();
    for (const record of definition.topology.nodes) addRenderedNode(this.graph, record, {
      definitions: this.definitions, status: (n) => this.nodeState(n).status,
      value: (n, key) => this.nodeState(n).values[key], statusLabel: (n) => this.nodeState(n).label,
    });
    for (const edge of definition.topology.edges) this.graph.addEdge({ id: edge.id, shape: 'station-cable', source: edge.source, target: edge.target, vertices: edge.vertices, connector: { name: 'rounded', args: { radius: 8 } }, labels: edgeLabels(edge.label), data: { kind: edge.kind, appearance: edge.appearance }, attrs: cableAttributes(cableAppearance(edge.kind, edge.appearance), false, this.textureId), zIndex: 0 });
    this.root.querySelector('.tv-empty')?.remove();
    if (!definition.topology.nodes.length) { const empty = document.createElement('div'); empty.className = 'tv-empty'; empty.textContent = '这张拓扑还没有节点'; this.root.appendChild(empty); }
    this.root.querySelector('.tv-canvas')!.setAttribute('aria-label', definition.name);
    this.refresh(); cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.fit());
  }

  getDefinition() { this.alive(); return structuredClone(this.definition); }

  setData(data: TelemetryData) {
    this.alive();
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some((v) => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('实时数据需为按业务对象 ID 索引的对象');
    this.data = structuredClone(data); this.refresh();
  }

  updateData(patch: TelemetryData) {
    this.alive();
    const next = { ...this.data };
    for (const [key, record] of Object.entries(patch)) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('实时数据记录不合法');
      Object.defineProperty(next, key, { value: { ...(Object.hasOwn(next, key) ? next[key] : {}), ...record }, writable: true, enumerable: true, configurable: true });
    }
    this.setData(next);
  }

  private refresh() {
    this.graph.getNodes().forEach((node) => {
      const state = this.nodeState(node);
      const view = this.graph.findViewByCell(node);
      const card = view?.container.querySelector<HTMLElement>('.device-card');
      if (!card) return;
      card.classList.remove('normal', 'warning', 'offline'); card.classList.add(state.status);
      card.querySelector('.device-status-text')!.textContent = state.label;
      card.querySelector('.device-status-dot')!.setAttribute('title', state.label);
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
      const down = [edge.getSourceCell(), edge.getTargetCell()].some((n) => n?.isNode() && this.nodeState(n).status === 'offline');
      const key = JSON.stringify([appearance, down]);
      if (this.styleKeys.get(edge.id) !== key) { edge.attr(cableAttributes(appearance, down, this.textureId)); this.styleKeys.set(edge.id, key); }
    });
  }

  private highlight(id: string | null) {
    this.graph.getNodes().forEach((node) => this.graph.findViewByCell(node)?.container.querySelector('.device-card')?.classList.toggle('selected', node.id === id));
    this.graph.getEdges().forEach((edge) => { const view = this.graph.findViewByCell(edge); if (view) (view.container as SVGElement).style.opacity = !id || edge.getSourceCellId() === id || edge.getTargetCellId() === id ? '1' : '.2'; });
  }

  fit() { this.alive(); if (this.graph.getNodes().length) this.graph.zoomToFit({ padding: 36, maxScale: 1 }); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.root.onclick = null; this.graph.dispose(); this.root.remove(); this.data = {}; this.styleKeys.clear();
  }
}
