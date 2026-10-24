import { categories, definitionsFromTemplates, type TopologyDocument } from './document';
import { deviceGeometry, linkTypes } from './topology';
import { escapeHtml as esc } from './icons';
import { drawingOrder } from './diagram';
import { diagramSvg } from './diagram-svg';
import { resolveLinkState } from './link-state';

export type LibrarySort = 'modified' | 'name';
export const categoryLabel = (category: string) => categories[category as keyof typeof categories] || category;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function findDocuments<T extends TopologyDocument>(documents: T[], query: string, category: string, sort: LibrarySort): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return documents.filter((doc) => (!category || doc.category === category) && terms.every((term) => `${doc.name}\n${doc.description}\n${doc.category}\n${categoryLabel(doc.category)}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => (sort === 'modified' ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : collator.compare(a.name, b.name)) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/** A small vector overview of saved geometry, without runtime values or external assets. */
export function documentThumbnail(document: TopologyDocument): string {
  if (!document.topology.nodes.length && !document.topology.elements?.length) return `<svg class="document-thumbnail" viewBox="0 0 360 150" role="img" aria-label="${esc(document.name)} · 空白拓扑"><text x="180" y="80" text-anchor="middle" fill="#74847c" font-size="13">空白画布 · 添加第一个节点</text></svg>`;
  const definitions = definitionsFromTemplates(document.templates);
  const nodes = document.topology.nodes.map((node) => ({ ...node, ...deviceGeometry(node.data, definitions) }));
  const map = new Map(nodes.map((node) => [node.id, node]));
  const endpoint = (end: { cell: string; port: string }) => {
    const node = map.get(end.cell)!;
    const port = node.ports.find((port) => port.id === end.port);
    return { x: node.x + (port?.x ?? node.width / 2), y: node.y + (port?.y ?? node.height / 2) };
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (point: { x: number; y: number }) => { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); };
  nodes.forEach((node) => { include(node); include({ x: node.x + node.width, y: node.y + node.height }); });
  document.topology.edges.forEach((edge) => edge.vertices.forEach(include));
  document.topology.elements?.forEach((element) => { include(element); include({ x: element.x + element.width, y: element.y + element.height }); });
  const left = minX - 40, top = minY - 40, width = maxX - left + 40, height = maxY - top + 40;
  const order = drawingOrder(document.topology);
  const drawing = new Map((document.topology.elements || []).map((element) => [element.id, `<g data-thumbnail-element="${esc(element.id)}" transform="translate(${element.x} ${element.y})">${diagramSvg(element, document.topology)}</g>`]));
  const cards = new Map(nodes.map((node) => [node.id, `<g data-thumbnail-node="${esc(node.id)}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="#fff" stroke="#6c9181" stroke-width="2"/><rect x="${node.x + 12}" y="${node.y + 17}" width="5" height="22" rx="2" fill="#498c70"/><text x="${node.x + 26}" y="${node.y + 35}" fill="#3c5b4c" font-size="17">${esc(Array.from(node.data.title).slice(0, 10).join(''))}</text><path d="M${node.x + 15} ${node.y + 56}h${node.width - 30}" stroke="#e2ebe6" stroke-width="2"/></g>`]));
  const isGroup = (id: string) => document.topology.elements?.some((element) => element.id === id && element.kind === 'group');
  const regions = order.filter(isGroup).map((id) => drawing.get(id)).join('');
  const foreground = order.filter((id) => !isGroup(id)).map((id) => cards.get(id) || drawing.get(id)).join('');
  const edges = document.topology.edges.map((edge) => {
    const state = resolveLinkState(edge, [edge.source, edge.target].map(end => ({ status: map.get(end.cell)!.data.status })));
    const color = state.status === 'down' ? '#aeb8b3' : state.status === 'unknown' ? '#bdc8d1' : edge.appearance?.color || linkTypes[edge.kind].color;
    return `<polyline data-thumbnail-edge="${esc(edge.id)}" data-link-status="${state.status}" points="${[endpoint(edge.source), ...edge.vertices, endpoint(edge.target)].map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${esc(color)}" stroke-width="4" ${state.status === 'down' ? 'stroke-dasharray="6 5"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg class="document-thumbnail" viewBox="${left} ${top} ${width} ${height}" role="img" aria-label="${esc(document.name)} · ${nodes.length} 个节点的布局缩略图">${regions}${edges}${foreground}</svg>`;
}
