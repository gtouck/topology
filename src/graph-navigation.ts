import type { Graph } from '@antv/x6';
import type { TopologyDocument } from './document';
import { escapeHtml as esc } from './icons';
import { searchTopology, relatedTopology, navigationGeometry, minimapPoint, type NavigationResult } from './topology-navigation';

interface NavigationOptions {
  definition: () => TopologyDocument;
  select: (id: string) => void;
  highlight: (ids: Set<string> | null) => void;
  enabled?: boolean;
  minimap?: boolean;
}
export class GraphNavigation {
  private root: HTMLDivElement;
  private results: NavigationResult[] = [];
  private active = -1;
  private selected: string | null = null;
  private related = false;
  private mapVisible: boolean;
  private dirty = true;
  private geometry?: ReturnType<typeof navigationGeometry>;
  private frame = 0;
  private observer: ResizeObserver;
  private disposed = false;
  private dragging = false;
  private change = (event?: { options?: { runtime?: boolean } }) => { if (!event?.options?.runtime) { this.dirty = true; this.refresh(); } };
  private viewChange = () => this.refresh();
  constructor(private graph: Graph, container: HTMLElement, private options: NavigationOptions) {
    this.mapVisible = options.minimap !== false && options.enabled !== false;
    this.root = document.createElement('div'); this.root.className = 'graph-navigation'; this.root.hidden = options.enabled === false;
    this.root.innerHTML = `<div class="gn-bar"><input class="gn-search" type="search" aria-label="查找图形" placeholder="搜索节点 / 链路 / ID" autocomplete="off"/><button type="button" class="gn-related" aria-pressed="false" disabled title="聚焦所选图形的一跳关联关系">关联</button><button type="button" class="gn-clear" title="清除搜索和聚焦">清除</button><button type="button" class="gn-map-toggle" aria-label="切换小地图" aria-pressed="${this.mapVisible}">小图</button><div class="gn-results" aria-label="搜索结果" hidden></div></div><span class="gn-status" role="status" aria-live="polite"></span><svg class="gn-map" tabindex="0" role="img" aria-label="拓扑小地图，点击或拖动定位，方向键移动视口" ${this.mapVisible ? '' : 'hidden'}><g class="gn-drawing"></g><rect class="gn-viewport"/></svg>`;
    container.appendChild(this.root);
    const input = this.root.querySelector<HTMLInputElement>('.gn-search')!;
    input.oninput = () => this.renderResults();
    input.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.clear(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.results.length) % Math.max(1, this.results.length); this.paintActive(); }
      if (event.key === 'Enter' && this.results.length) { event.preventDefault(); this.focus(this.results[Math.max(0, this.active)].id); }
    };
    this.root.onclick = event => {
      const target = event.target as Element, result = target.closest<HTMLElement>('[data-gn-id]');
      if (result) this.focus(result.dataset.gnId!);
      if (target.closest('.gn-clear')) this.clear();
      if (target.closest('.gn-related')) { this.related = !this.related; this.updateRelated(); }
      if (target.closest('.gn-map-toggle')) { this.mapVisible = !this.mapVisible; this.root.querySelector('.gn-map')!.toggleAttribute('hidden', !this.mapVisible); this.root.querySelector('.gn-map-toggle')!.setAttribute('aria-pressed', String(this.mapVisible)); this.refresh(); }
    };
    const map = this.root.querySelector<SVGSVGElement>('.gn-map')!;
    const locate = (event: PointerEvent) => {
      if (!this.geometry) return;
      const rect = map.getBoundingClientRect(), point = minimapPoint({ x: event.clientX - rect.left - map.clientLeft, y: event.clientY - rect.top - map.clientTop }, this.geometry.bounds, map.clientWidth, map.clientHeight);
      this.graph.centerPoint(point.x, point.y);
    };
    map.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); this.dragging = true; map.setPointerCapture(event.pointerId); locate(event); };
    map.onpointermove = event => { if (this.dragging) locate(event); };
    map.onpointerup = map.onpointercancel = event => { this.dragging = false; if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId); };
    map.onkeydown = event => {
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key]; if (!direction) return;
      event.preventDefault(); event.stopPropagation(); const center = this.viewport();
      this.graph.centerPoint(center.x + center.width / 2 + direction[0] * center.width / 5, center.y + center.height / 2 + direction[1] * center.height / 5);
    };
    graph.on('cell:added', this.change); graph.on('cell:removed', this.change); graph.on('cell:changed', this.change);
    graph.on('scale', this.viewChange); graph.on('translate', this.viewChange);
    this.observer = new ResizeObserver(this.viewChange); this.observer.observe(graph.container); this.refresh();
  }
  focusSearch() { this.root.querySelector<HTMLInputElement>('.gn-search')!.focus(); }
  setSelection(id: string | null) { this.selected = id; this.root.querySelector<HTMLButtonElement>('.gn-related')!.disabled = !id; this.updateRelated(); }
  focus(id: string, related = this.related) {
    const cell = this.graph.getCellById(id); if (!cell) return false;
    this.related = related; this.selected = id;
    const box = cell.getBBox(); this.graph.zoomToRect(box.inflate(50), { maxScale: 1 });
    this.options.select(id); this.updateRelated(); this.root.querySelector<HTMLElement>('.gn-results')!.hidden = true;
    this.root.querySelector('.gn-status')!.textContent = '已定位，可拖动画布继续浏览'; return true;
  }
  clear() {
    this.results = []; this.active = -1;
    this.root.querySelector<HTMLInputElement>('.gn-search')!.value = ''; this.root.querySelector<HTMLElement>('.gn-results')!.hidden = true;
    this.related = false; this.options.highlight(null); this.root.querySelector('.gn-related')!.setAttribute('aria-pressed', 'false'); this.root.querySelector('.gn-status')!.textContent = '';
  }
  private updateRelated() {
    this.root.querySelector('.gn-related')!.setAttribute('aria-pressed', String(this.related));
    this.options.highlight(this.related && this.selected ? relatedTopology(this.options.definition().topology, this.selected) : null); this.refresh();
  }
  private renderResults() {
    const query = this.root.querySelector<HTMLInputElement>('.gn-search')!.value;
    this.results = searchTopology(this.options.definition(), query); this.active = this.results.length ? 0 : -1;
    const root = this.root.querySelector<HTMLElement>('.gn-results')!; root.hidden = !query.trim();
    root.innerHTML = this.results.map(result => `<button type="button" class="gn-result" data-gn-id="${esc(result.id)}">${esc(result.label)}<small>${esc(result.detail)}</small></button>`).join('') || '<p class="gn-empty">没有匹配的图形</p>';
    this.paintActive();
  }
  private paintActive() { this.root.querySelectorAll('.gn-result').forEach((row, i) => row.classList.toggle('active', i === this.active)); this.root.querySelector('.gn-result.active')?.scrollIntoView({ block: 'nearest' }); }
  private viewport() { const rect = this.graph.container.getBoundingClientRect(), p = this.graph.clientToLocal(rect.left, rect.top), q = this.graph.clientToLocal(rect.right, rect.bottom); return { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y }; }
  refresh() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0; if (this.disposed) return;
      if (this.dirty && !this.root.querySelector<HTMLElement>('.gn-results')!.hidden) this.renderResults();
      const enoughSpace = this.graph.container.clientHeight >= 240, visible = this.mapVisible && enoughSpace;
      if (this.root.parentElement) this.root.parentElement.dataset.navCompact = String(!enoughSpace);
      this.root.style.setProperty('--gn-height', `${this.graph.container.clientHeight}px`);
      const map = this.root.querySelector<SVGSVGElement>('.gn-map')!;
      map.toggleAttribute('hidden', !visible);
      const toggle = this.root.querySelector<HTMLButtonElement>('.gn-map-toggle')!;
      toggle.disabled = !enoughSpace; toggle.setAttribute('aria-pressed', String(visible));
      if (!visible) return;
      if (this.dirty || !this.geometry) {
        this.geometry = navigationGeometry(this.options.definition()); this.dirty = false;
        const { bounds, nodes, elements, edges } = this.geometry;
        map.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
        this.root.querySelector('.gn-drawing')!.innerHTML = `${elements.map(e => `<rect class="gn-element" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}"/>`).join('')}${edges.map(e => `<polyline class="gn-edge" points="${e.points.map(p => `${p.x},${p.y}`).join(' ')}"/>`).join('')}${nodes.map(n => `<rect class="gn-node" data-gn-node="${esc(n.id)}" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}"/>`).join('')}`;
      }
      const viewport = this.viewport(), box = this.root.querySelector('.gn-viewport')!;
      for (const key of ['x', 'y', 'width', 'height'] as const) box.setAttribute(key, String(viewport[key]));
      this.root.querySelectorAll<SVGElement>('[data-gn-node]').forEach(n => n.classList.toggle('selected', n.dataset.gnNode === this.selected));
    });
  }
  reset() { this.selected = null; this.clear(); this.root.querySelector<HTMLButtonElement>('.gn-related')!.disabled = true; this.dirty = true; this.refresh(); }
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.graph.off('cell:added', this.change); this.graph.off('cell:removed', this.change); this.graph.off('cell:changed', this.change); this.graph.off('scale', this.viewChange); this.graph.off('translate', this.viewChange); this.root.remove();
  }
}
