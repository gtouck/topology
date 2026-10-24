import { Graph, Shape, type Node } from '@antv/x6';
import { icon, escapeHtml as esc } from './icons';
import { deviceGeometry, devicePorts, devices, linkTypes, statusLabels, type DeviceData, type DeviceDefinition, type DeviceRecord, type DeviceStatus } from './topology';
import { updateNodeStatus } from './node-status-ui';

export interface RenderContext {
  definitions: Record<string, DeviceDefinition>;
  editor?: boolean;
  status(node: Node): DeviceStatus;
  pending?(node: Node): boolean;
  value(node: Node, key: string): string;
  selected?(node: Node): boolean;
  locked?(node: Node): boolean;
  statusLabel?(node: Node): string;
}
const contexts = new WeakMap<Node, RenderContext>();
let registered = false;

export function registerTopologyShapes() {
  if (registered) return;
  registered = true;
  Shape.HTML.register({
    shape: 'station-device', width: 210, height: 132, effect: ['data'],
    html(cell) {
      const node = cell as Node;
      const ctx = contexts.get(node);
      const data = node.getData<DeviceData>();
      const def = (ctx?.definitions || devices)[data.kind];
      const status = ctx?.status(node) || data.status;
      const el = document.createElement('div');
      el.className = `device-card ${status}${ctx?.selected?.(node) ? ' selected' : ''}`;
      el.dataset.deviceNode = node.id;
      el.dataset.metricCount = String(data.visibleMetrics.length);
      const locked = ctx?.locked?.(node) ?? data.locked === true;
      el.dataset.locked = String(locked);
      const ports = devicePorts(data, ctx?.definitions || devices);
      const lockIndicator = locked && ctx?.editor ? `<span class="device-lock-indicator" hidden title="位置已锁定" aria-label="位置已锁定">${icon('LockKeyhole', 10)}</span>` : '';
      el.innerHTML = `<div class="device-card-heading"><span class="device-glyph kind-${esc(data.kind)}">${icon(def.icon, 19)}${lockIndicator}</span><div><strong title="${esc(data.title)}">${esc(data.title)}</strong><small>${esc(def.en)}</small></div><span class="device-status-dot" title="${statusLabels[status]}"></span></div>${data.visibleMetrics.length ? `<div class="device-metrics">${data.visibleMetrics.map((key) => {
        const metric = def.metrics.find((m) => m.key === key)!;
        const value = ctx?.value(node, key) ?? '—';
        return `<div><span>${esc(metric.label)}</span><strong data-metric="${esc(key)}">${esc(value)}<small>${value === '—' ? '' : esc(metric.unit)}</small></strong></div>`;
      }).join('')}</div>` : ''}${ports.length > 8 ? `<div class="device-port-capacity"><strong>${ports.length}</strong><span>连接端口</span></div>` : ''}<div class="device-bottom"><span class="device-status-text">${esc(ctx?.statusLabel?.(node) || statusLabels[status])}</span><span>${esc(data.address || data.deviceId)}</span></div>`;
      updateNodeStatus(el, status, ctx?.pending?.(node) || false, ctx?.statusLabel?.(node));
      return el;
    },
  });
  Graph.registerEdge('station-cable', {
    inherit: 'edge',
    markup: ['wrap', 'line', 'core', 'texture', 'shine', 'direction'].map((selector) => ({ tagName: 'path', selector, groupSelector: 'lines', className: `cable-${selector}` })),
    attrs: {
      lines: { connection: true, fill: 'none', strokeLinejoin: 'round', strokeLinecap: 'round', pointerEvents: 'none' },
      wrap: { stroke: 'transparent', strokeWidth: 16, pointerEvents: 'stroke', cursor: 'pointer' },
      line: { targetMarker: null }, direction: { stroke: 'transparent', strokeWidth: 1 },
    },
  }, true);
}

export function nodePorts(data: DeviceData, definitions = devices) {
  return {
    groups: { absolute: { position: 'absolute', markup: [{ tagName: 'circle', selector: 'circle' }], attrs: { circle: { r: 4, magnet: true, strokeWidth: 1.5, fill: '#fff', cursor: 'crosshair' } } } },
    items: deviceGeometry(data, definitions).ports.map((p) => ({ id: p.id, group: 'absolute', args: { x: p.x, y: p.y }, attrs: { circle: { stroke: linkTypes[p.kind].color }, title: { text: `${p.label} · ${linkTypes[p.kind].label}` } }, markup: [{ tagName: 'circle', selector: 'circle' }, { tagName: 'title', selector: 'title' }] })),
  };
}

export function addRenderedNode(graph: Graph, record: DeviceRecord, context: RenderContext) {
  registerTopologyShapes();
  const { width, height } = deviceGeometry(record.data, context.definitions);
  const node = graph.createNode({ id: record.id, shape: 'station-device', x: record.x, y: record.y, width, height, data: structuredClone(record.data), zIndex: 2, ports: nodePorts(record.data, context.definitions) });
  contexts.set(node, context);
  graph.addNode(node);
  return node;
}

export function updateNodeGeometry(node: Node, definitions = devices) {
  const data = node.getData<DeviceData>();
  const { width, height } = deviceGeometry(data, definitions);
  node.resize(width, height);
  // Keep IDs stable so attached cables follow the resized card.
  node.setProp('ports', nodePorts(data, definitions));
}

export function edgeLabels(label: string) {
  return label ? [{ position: .5, attrs: { label: { text: label, fill: '#7c8c86', fontSize: 10, fontFamily: 'inherit' }, body: { fill: '#f9fbfa', stroke: 'none', rx: 3, ry: 3 } } }] : [];
}

export function installCableTexture(graph: Graph, id: string) {
  graph.view.defs.insertAdjacentHTML('beforeend', `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2L2 -2M0 7L7 0M5 9L9 5" stroke="#fff" stroke-width="1.2" opacity=".7"/><path d="M-2 5L2 9M0 0L7 7M5 -2L9 2" stroke="#142d25" stroke-width="1" opacity=".35"/></pattern>`);
}
