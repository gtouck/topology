import { newId, parseDocument, type NodeTemplate, type TopologyDocument } from './document';
import type { Snapshot } from './topology';

export interface TopologyClipboard { nodes: Snapshot['nodes']; edges: Snapshot['edges']; templates: NodeTemplate[] }
export interface Offset { x: number; y: number }
const valid = (n: number) => Number.isFinite(n) && Math.abs(n) <= 100000;

export function copySelection(document: TopologyDocument, selectedIds: Set<string>): TopologyClipboard | null {
  const nodes = document.topology.nodes.filter((node) => selectedIds.has(node.id));
  if (!nodes.length) return null;
  const ids = new Set(nodes.map((node) => node.id)), kinds = new Set(nodes.map((node) => node.data.kind));
  return structuredClone({ nodes, edges: document.topology.edges.filter((edge) => ids.has(edge.source.cell) && ids.has(edge.target.cell)), templates: document.templates.filter((template) => kinds.has(template.id)) });
}

export function moveSelection(snapshot: Snapshot, ids: Set<string>, offset: Offset): Snapshot {
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new Error('移动距离不合法');
  return positionNodes(snapshot, new Map(snapshot.nodes.filter((node) => ids.has(node.id) && !node.data.locked).map((node) => [node.id, { x: node.x + offset.x, y: node.y + offset.y }])));
}

/** Shared layout policy: keep manual bends unless both ends move equally. */
export function positionNodes(snapshot: Snapshot, positions: ReadonlyMap<string, Offset>): Snapshot {
  const next = structuredClone(snapshot);
  const deltas = new Map<string, Offset>();
  for (const node of next.nodes) {
    const target = positions.get(node.id);
    if (!target || node.data.locked) continue;
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
  const removable = new Set(next.topology.nodes.filter((node) => ids.has(node.id) && !node.data.locked).map((node) => node.id));
  next.topology.nodes = next.topology.nodes.filter((node) => !removable.has(node.id));
  next.topology.edges = next.topology.edges.filter((edge) => !ids.has(edge.id) && !removable.has(edge.source.cell) && !removable.has(edge.target.cell));
  return next;
}

export function setPositionLocks(document: TopologyDocument, ids: Set<string>, locked: boolean) {
  const next = structuredClone(document);
  for (const node of next.topology.nodes) if (ids.has(node.id)) {
    if (locked) node.data.locked = true;
    else delete node.data.locked;
  }
  return next;
}

function sameTemplate(a: NodeTemplate, b: NodeTemplate) {
  // Documents pass through the same template parser, which normalizes property order.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function pasteSelection(document: TopologyDocument, clipboard: TopologyClipboard, offset: Offset = { x: 40, y: 40 }, idFactory = newId) {
  if (!clipboard.nodes.length) throw new Error('剪贴板中没有节点');
  if (document.topology.nodes.length + clipboard.nodes.length > 300 || document.topology.edges.length + clipboard.edges.length > 1000) throw new Error('粘贴后将超过 300 个节点或 1000 条连线的上限');
  const next = structuredClone(document);
  const used = new Set([...next.topology.nodes, ...next.topology.edges, ...next.templates, ...clipboard.nodes, ...clipboard.edges].map((item) => item.id));
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
  const shifted = moveSelection({ nodes, edges }, new Set(nodes.map((node) => node.id)), offset);
  next.topology.nodes.push(...shifted.nodes); next.topology.edges.push(...shifted.edges);
  // Validate the whole result before touching the graph, including imported templates.
  return { document: parseDocument(next), nodeIds: nodes.map((node) => node.id) };
}
