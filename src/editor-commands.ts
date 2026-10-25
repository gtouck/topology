import { newId, parseDocument, type NodeTemplate, type TopologyDocument } from './document';
import type { Snapshot } from './topology';
import { drawingOrder, movableSelection, positionLocked, parseDiagram } from './diagram';

export interface TopologyClipboard { nodes: Snapshot['nodes']; edges: Snapshot['edges']; templates: NodeTemplate[]; elements?: Snapshot['elements']; order?: string[] }
export interface Offset { x: number; y: number }
const valid = (n: number) => Number.isFinite(n) && Math.abs(n) <= 100000;

export function copySelection(document: TopologyDocument, selectedIds: Set<string>): TopologyClipboard | null {
  const elements = document.topology.elements?.filter((element) => selectedIds.has(element.id));
  const included = new Set(selectedIds);
  elements?.forEach((e) => { if (e.kind === 'group') e.members.forEach((id) => included.add(id)); });
  const nodes = document.topology.nodes.filter((node) => included.has(node.id));
  if (!nodes.length && !elements?.length) return null;
  const ids = new Set(nodes.map((node) => node.id)), kinds = new Set(nodes.map((node) => node.data.kind));
  return structuredClone({ nodes, edges: document.topology.edges.filter((edge) => ids.has(edge.source.cell) && ids.has(edge.target.cell)), templates: document.templates.filter((template) => kinds.has(template.id)), ...(elements?.length ? { elements } : {}), ...(document.topology.order || elements?.length ? { order: drawingOrder(document.topology).filter((id) => included.has(id)) } : {}) });
}

export function moveSelection(snapshot: Snapshot, ids: Set<string>, offset: Offset): Snapshot {
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new Error('移动距离不合法');
  const movable = movableSelection(snapshot, ids).ids;
  const next = positionNodes(snapshot, new Map(snapshot.nodes.filter((node) => movable.has(node.id)).map((node) => [node.id, { x: node.x + offset.x, y: node.y + offset.y }])));
  for (const element of next.elements || []) if (movable.has(element.id)) { element.x += offset.x; element.y += offset.y; }
  Object.assign(next, parseDiagram(next, next));
  return next;
}

/** Shared layout policy: keep manual bends unless both ends move equally. */
export function positionNodes(snapshot: Snapshot, positions: ReadonlyMap<string, Offset>): Snapshot {
  const next = structuredClone(snapshot);
  const deltas = new Map<string, Offset>();
  for (const node of next.nodes) {
    const target = positions.get(node.id);
    if (!target || positionLocked(snapshot, node.id)) continue;
    const dx = target.x - node.x, dy = target.y - node.y;
    if (dx || dy) deltas.set(node.id, { x: dx, y: dy });
    node.x = target.x; node.y = target.y;
  }
  for (const edge of next.edges) {
    const source = deltas.get(edge.source.cell), target = deltas.get(edge.target.cell);
    if (source && target && Math.abs(source.x - target.x) < 1e-9 && Math.abs(source.y - target.y) < 1e-9) edge.vertices.forEach((point) => { point.x += source.x; point.y += source.y; });
  }
  if (next.nodes.some((node) => !valid(node.x) || !valid(node.y)) || next.edges.some((edge) => edge.vertices.some((point) => !valid(point.x) || !valid(point.y)))) throw new Error('移动位置超出坐标范围');
  return next;
}

export function deleteSelection(document: TopologyDocument, ids: Set<string>): TopologyDocument {
  const next = structuredClone(document);
  const removable = new Set(next.topology.nodes.filter((node) => ids.has(node.id) && !positionLocked(next.topology, node.id)).map((node) => node.id));
  next.topology.nodes = next.topology.nodes.filter((node) => !removable.has(node.id));
  next.topology.edges = next.topology.edges.filter((edge) => !ids.has(edge.id) && !removable.has(edge.source.cell) && !removable.has(edge.target.cell));
  if (next.topology.elements) {
    next.topology.elements = next.topology.elements.filter((element) => !ids.has(element.id) || element.locked).map((element) => element.kind === 'group' ? { ...element, members: element.members.filter((id) => !removable.has(id)) } : element);
  }
  if (next.topology.order) next.topology.order = next.topology.order.filter((id) => next.topology.nodes.some((node) => node.id === id) || next.topology.elements?.some((element) => element.id === id));
  return next;
}

export function setPositionLocks(document: TopologyDocument, ids: Set<string>, locked: boolean) {
  const next = structuredClone(document);
  for (const node of next.topology.nodes) if (ids.has(node.id)) {
    if (locked) node.data.locked = true;
    else delete node.data.locked;
  }
  for (const element of next.topology.elements || []) if (ids.has(element.id)) { if (locked) element.locked = true; else delete element.locked; }
  return next;
}

function sameTemplate(a: NodeTemplate, b: NodeTemplate) {
  // Documents pass through the same template parser, which normalizes property order.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function pasteSelection(document: TopologyDocument, clipboard: TopologyClipboard, offset: Offset = { x: 40, y: 40 }, idFactory = newId) {
  if (!clipboard.nodes.length && !clipboard.elements?.length) throw new Error('剪贴板中没有节点');
  if (document.topology.nodes.length + clipboard.nodes.length > 300 || document.topology.edges.length + clipboard.edges.length > 1000) throw new Error('粘贴后将超过 300 个节点或 1000 条连线的上限');
  const next = structuredClone(document);
  const used = new Set([...next.topology.nodes, ...next.topology.edges, ...(next.topology.elements || []), ...next.templates, ...clipboard.nodes, ...clipboard.edges, ...(clipboard.elements || [])].map((item) => item.id));
  const freshId = (prefix: string) => {
    for (let i = 0; i < 100; i++) { const id = idFactory(prefix); if (!used.has(id)) { used.add(id); return id; } }
    throw new Error('无法生成唯一 ID，请重试');
  };
  const kinds = new Map<string, string>();
  for (const template of clipboard.templates) {
    const existing = next.templates.find((item) => item.id === template.id);
    const id = existing && !sameTemplate(existing, template) ? freshId('template') : template.id;
    kinds.set(template.id, id);
    if (!existing || id !== template.id) { next.templates.push({ ...structuredClone(template), id }); used.add(id); }
  }
  const businessIds = new Set([...next.topology.nodes, ...clipboard.nodes].map((node) => node.data.deviceId));
  const idMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((source) => {
    const node = structuredClone(source), id = freshId('node');
    idMap.set(source.id, id); node.id = id;
    delete node.data.locked;
    node.data.kind = kinds.get(node.data.kind) || node.data.kind;
    const title = Array.from(node.data.title);
    while (title.join('').length > 57) title.pop();
    node.data.title = `${title.join('')} 副本`;
    let number = 1, deviceId: string;
    do { const suffix = `-copy-${number++}`; deviceId = source.data.deviceId.slice(0, 80 - suffix.length) + suffix; } while (businessIds.has(deviceId));
    businessIds.add(deviceId); node.data.deviceId = deviceId;
    if (node.data.binding) node.data.binding.source = deviceId;
    return node;
  });
  const edges = clipboard.edges.map((source) => {
    const edge = structuredClone(source);
    const from = idMap.get(edge.source.cell), to = idMap.get(edge.target.cell);
    if (!from || !to) throw new Error('剪贴板包含悬空连线');
    edge.id = freshId('edge'); edge.source.cell = from; edge.target.cell = to;
    return edge;
  });
  const elements = clipboard.elements?.map((source) => {
    const element = structuredClone(source), id = freshId('element'); idMap.set(source.id, id); element.id = id; delete element.locked;
    if (element.kind === 'group') element.members = element.members.map((id) => { const member = idMap.get(id); if (!member) throw new Error('剪贴板分组成员不存在'); return member; });
    return element;
  });
  const copiedIds = [...nodes, ...(elements || [])].map((item) => item.id);
  const shifted = moveSelection({ nodes, edges, ...(elements ? { elements } : {}) }, new Set(copiedIds), offset);
  const oldOrder = drawingOrder(next.topology);
  next.topology.nodes.push(...shifted.nodes); next.topology.edges.push(...shifted.edges);
  if (shifted.elements?.length) next.topology.elements = [...(next.topology.elements || []), ...shifted.elements];
  if (next.topology.order || clipboard.order) next.topology.order = [...oldOrder, ...(clipboard.order?.map((id) => idMap.get(id)!).filter(Boolean) || copiedIds)];
  // Validate the whole result before touching the graph, including imported templates.
  return { document: parseDocument(next), nodeIds: copiedIds };
}
