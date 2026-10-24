import { definitionsFromTemplates, type TopologyDocument } from './document';
import { deviceGeometry, type DeviceStatus } from './topology';
import { cableAppearance, cableAttributes } from './cables';
import { escapeHtml, vectorIcon } from './icons';
import { drawingOrder } from './diagram';
import { diagramSvg } from './diagram-svg';
import { nodeStatus, statusGlyph } from './node-status';
import { resolveLinkState, type LinkTelemetryData } from './link-state';

export interface ExportNodeState { status: DeviceStatus; values: Record<string, number>; label?: string; pending?: boolean }
export type ExportState = Record<string, ExportNodeState>;
export interface Point { x: number; y: number }
export interface ExportEdgeGeometry { path: string; label: Point }
export interface SvgExport { svg: string; width: number; height: number }

const number = (n: number) => Math.round(n * 1000) / 1000;
const esc = (value: unknown) => escapeHtml(String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''));
const glyphs: Record<string, [string, string]> = {
  antenna: ['#799062', '#f0f3e8'], lnb: ['#927aac', '#f3eff8'], amplifier: ['#b8954f', '#faf3e7'],
  baseband: ['#7993a9', '#edf3f7'], switch: ['#669884', '#edf5f0'], router: ['#7a9983', '#eff5ee'], server: ['#6d9293', '#edf4f3'],
};
const point = (p: Point) => `${number(p.x)} ${number(p.y)}`;
const textWidth = (text: string, size: number) => Array.from(text).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : .62) * size, 0);
function fitText(text: string, width: number, size: number) {
  if (textWidth(text, size) <= width) return text;
  const chars = Array.from(text);
  while (chars.length && textWidth(chars.join('') + '…', size) > width) chars.pop();
  return chars.join('') + '…';
}
function text(x: number, y: number, value: string, size: number, fill: string, extra = '') {
  // XML 1.0 excludes control characters even when they were valid JSON strings.
  return `<text x="${number(x)}" y="${number(y)}" font-size="${size}" fill="${fill}" ${extra}>${esc(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))}</text>`;
}

/** Rounded manual polyline; the workbench supplies X6's exact path when available. */
function roundedPath(points: Point[]) {
  let d = `M ${point(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], p = points[i], next = points[i + 1];
    const before = Math.hypot(p.x - prev.x, p.y - prev.y), after = Math.hypot(next.x - p.x, next.y - p.y);
    if (!before || !after) { d += ` L ${point(p)}`; continue; }
    const a = Math.min(8, before / 2) / before, b = Math.min(8, after / 2) / after;
    const start = { x: p.x + (prev.x - p.x) * a, y: p.y + (prev.y - p.y) * a };
    const end = { x: p.x + (next.x - p.x) * b, y: p.y + (next.y - p.y) * b };
    d += ` L ${point(start)} C ${point({ x: (start.x + 2 * p.x) / 3, y: (start.y + 2 * p.y) / 3 })} ${point({ x: (end.x + 2 * p.x) / 3, y: (end.y + 2 * p.y) / 3 })} ${point(end)}`;
  }
  return d + ` L ${point(points.at(-1)!)}`;
}
function midpoint(points: Point[]) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio };
    }
    remaining -= lengths[i];
  }
  return points[0];
}

/** No foreignObject, external fonts, images, stylesheets or editing controls. */
export function renderTopologySvg(document: TopologyDocument, state: ExportState = {}, renderedEdges: Record<string, ExportEdgeGeometry> = {}, linkData: LinkTelemetryData = {}): SvgExport {
  if (!document.topology.nodes.length && !document.topology.elements?.length) throw new Error('请先添加节点再导出图片');
  const definitions = definitionsFromTemplates(document.templates);
  const nodes = new Map(document.topology.nodes.map((node) => [node.id, { ...node, geometry: deviceGeometry(node.data, definitions) }]));
  const bounds: Point[] = [];
  const defs = ['<pattern id="export-braid" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2L2 -2M0 7L7 0M5 9L9 5" stroke="#fff" stroke-width="1.2" opacity=".7"/><path d="M-2 5L2 9M0 0L7 7M5 -2L9 2" stroke="#142d25" stroke-width="1" opacity=".35"/></pattern>'];
  const cables = document.topology.edges.map((edge, index) => {
    const endpoint = (end: typeof edge.source) => {
      const node = nodes.get(end.cell)!;
      const port = node.geometry.ports.find((p) => p.id === end.port)!;
      return { x: node.x + port.x, y: node.y + port.y };
    };
    const points = [endpoint(edge.source), ...edge.vertices, endpoint(edge.target)];
    bounds.push(...points);
    const current = renderedEdges[edge.id];
    const path = current?.path || roundedPath(points);
    const center = current?.label || midpoint(points);
    const endpoints = [edge.source, edge.target].map(end => ({ status: state[end.cell]?.status || nodes.get(end.cell)!.data.status, pending: state[end.cell]?.pending }));
    const link = resolveLinkState(edge, endpoints, Object.hasOwn(linkData, edge.id) ? linkData[edge.id] : undefined);
    const offline = link.status === 'down';
    const appearance = cableAppearance(edge.kind, edge.appearance);
    const layers = cableAttributes(appearance, offline, 'export-braid', link.status === 'unknown');
    const paths = (['line', 'core', 'texture', 'shine'] as const).map((name) => {
      const attrs = layers[name];
      return `<path d="${esc(path)}" fill="none" stroke="${attrs.stroke}" stroke-width="${attrs.strokeWidth}" stroke-dasharray="${'strokeDasharray' in attrs ? attrs.strokeDasharray : ''}" opacity="${'opacity' in attrs ? attrs.opacity : 1}"/>`;
    }).join('');
    let arrow = '';
    if (appearance.arrows) {
      const color = layers.direction.targetMarker!.fill;
      defs.push(`<marker id="export-arrow-${index}" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="8" refX="7" refY="3" orient="auto" overflow="visible"><path d="M0 0L7 3L0 6Z" fill="${color}"/></marker>`);
      arrow = `<path d="${esc(path)}" fill="none" stroke="none" marker-end="url(#export-arrow-${index})"/>`;
    }
    let label = '';
    if (edge.label) {
      const width = textWidth(edge.label, 10) + 12;
      bounds.push({ x: center.x - width / 2, y: center.y - 10 }, { x: center.x + width / 2, y: center.y + 10 });
      label = `<g><rect x="${number(center.x - width / 2)}" y="${number(center.y - 9)}" width="${number(width)}" height="18" rx="3" fill="#f9fbfa"/>${text(center.x, center.y + 3.5, edge.label, 10, '#7c8c86', 'text-anchor="middle"')}</g>`;
    }
    return `<g data-edge-id="${esc(edge.id)}" data-link-status="${link.status}" stroke-linecap="round" stroke-linejoin="round">${paths}${arrow}${label}</g>`;
  }).join('');
  const cardMarkup = new Map<string, string>();
  [...nodes.values()].forEach((node) => {
    const { width, height, ports } = node.geometry;
    bounds.push({ x: node.x, y: node.y }, { x: node.x + width, y: node.y + height });
    const def = definitions[node.data.kind], live = state[node.id];
    const status = live?.status || node.data.status;
    const visual = nodeStatus(status, !!live?.pending, live?.label), pending = visual.tone === 'pending';
    const offline = status === 'offline' || pending, warning = status === 'warning', disconnected = offline && !pending;
    const border = visual.border, background = visual.surface;
    const title = fitText(node.data.title, width - 84, 12);
    const metrics = node.data.visibleMetrics.map((key, i, all) => {
      const metric = def.metrics.find((m) => m.key === key)!;
      const raw = live?.values[key];
      const value = offline || raw === undefined || !Number.isFinite(raw) ? '—' : raw.toFixed(metric.decimals);
      const single = all.length === 1, x = 13 + i * ((width - 26) / 2);
      const unit = value === '—' ? '' : metric.unit;
      const size = single ? 14 : 15;
      const available = single ? 105 : (width - 38) / 2;
      const formatted = fitText(value, Math.max(20, available - textWidth(unit, 8) - 4), size);
      const valueText = `<text x="${single ? width - 13 : x}" y="${single ? 71 : 83}" font-size="${size}" fill="${offline ? '#a3afa7' : warning && i === 1 ? '#b19052' : '#506b57'}"${single ? ' text-anchor="end"' : ''}>${esc(formatted)}<tspan font-size="8" fill="#98a89b">${unit ? ` ${esc(unit)}` : ''}</tspan></text>`;
      return `${i ? `<path d="M${x - 7} 56V87" stroke="#edf0ec"/>` : ''}${text(x, single ? 69 : 63, fitText(metric.label, single ? width - 110 : (width - 40) / 2, 8), 8, '#9ba89e')}${valueText}`;
    }).join('');
    const footer = height - 25;
    const capacity = ports.length > 8 ? text(width / 2, (footer + (node.data.visibleMetrics.length ? node.data.visibleMetrics.length === 1 ? 80 : 96 : 57)) / 2 + 4, `${ports.length} 连接端口`, 11, '#93a48d', 'text-anchor="middle"') : '';
    const address = fitText(node.data.address || node.data.deviceId, width - 112, 7);
    const [glyphColor, glyphBackground] = pending ? ['#7297bd', '#edf4fb'] : disconnected ? ['#a7b2aa', '#f0f3f0'] : glyphs[node.data.kind] || ['#7a986b', '#eff4ed'];
    cardMarkup.set(node.id, `<g data-node-id="${esc(node.id)}" data-status="${visual.tone}" transform="translate(${number(node.x)} ${number(node.y)})"><title>${esc(node.data.title)}</title><rect width="${width}" height="${height}" rx="8" fill="${background}" stroke="${border}" stroke-dasharray="${visual.dash}"/><rect x="12" y="13" width="31" height="31" rx="6" fill="${glyphBackground}"/><g transform="translate(18 19)" color="${glyphColor}">${vectorIcon(def.icon)}</g>${text(52, 27, title, 12, pending ? '#536c82' : disconnected ? '#99a59e' : '#42584a', 'font-weight="550"')}${text(52, 40, fitText(def.en, width - 80, 7), 7, '#b0bab3', 'letter-spacing="1"')}<rect x="${width - 29}" y="20" width="17" height="17" rx="5" fill="${visual.background}"/><g transform="translate(${width - 26.5} 22.5)" color="${visual.color}">${statusGlyph(visual.tone, 12)}</g>${metrics}${capacity}<path d="M1 ${footer}H${width - 1}V${height - 8}Q${width - 1} ${height - 1} ${width - 8} ${height - 1}H8Q1 ${height - 1} 1 ${height - 8}Z" fill="${visual.background}"/>${text(12, height - 10, fitText(visual.label, 106, 8), 8, visual.color)}${text(width - 12, height - 10, address, 7, '#bac4bb', 'text-anchor="end" font-family="monospace"')}<path d="M2.5 8V${height - 8}" stroke="${visual.color}" stroke-width="3" stroke-linecap="round"/></g>`);
  });
  const elements = new Map((document.topology.elements || []).map((element) => {
    bounds.push({ x: element.x, y: element.y }, { x: element.x + element.width, y: element.y + element.height });
    return [element.id, `<g data-element-id="${esc(element.id)}" data-element-kind="${element.kind}" transform="translate(${number(element.x)} ${number(element.y)})">${diagramSvg(element, document.topology)}</g>`];
  }));
  const order = drawingOrder(document.topology);
  const isRegion = (id: string) => document.topology.elements?.some((element) => element.id === id && element.kind === 'group');
  const regions = order.filter(isRegion).map((id) => elements.get(id)).join('');
  const cards = order.filter((id) => !isRegion(id)).map((id) => cardMarkup.get(id) || elements.get(id) || '').join('');
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of bounds) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const minX = Math.floor(left - 40), minY = Math.floor(top - 40);
  const width = Math.ceil(right - minX + 40), height = Math.ceil(bottom - minY + 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="${esc(document.name)}"><title>${esc(document.name)}</title><defs>${defs.join('')}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f9fbfa"/><g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif">${regions}${cables}${cards}</g></svg>`;
  return { svg, width, height };
}
