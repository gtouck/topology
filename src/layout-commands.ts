import { definitionsFromTemplates, parseDocument, type TopologyDocument } from './document';
import { deviceGeometry } from './topology';
import { positionNodes, type Offset } from './editor-commands';

export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type LayoutAxis = 'horizontal' | 'vertical';
export const alignmentLabels: Record<Alignment, string> = { left: '左对齐', 'center-x': '水平居中', right: '右对齐', top: '顶对齐', 'center-y': '垂直居中', bottom: '底对齐' };
export const MAX_LAYOUT_GAP = 10000;
export interface LayoutResult { document: TopologyDocument; moved: number; skipped: number }

function boxes(document: TopologyDocument, ids: Set<string>) {
  const definitions = definitionsFromTemplates(document.templates), nodes = new Map(document.topology.nodes.map((node) => [node.id, node]));
  return [...ids].flatMap((id) => {
    const node = nodes.get(id);
    if (!node) return [];
    const geometry = deviceGeometry(node.data, definitions);
    return [{ node, width: geometry.width, height: geometry.height }];
  });
}

function result(document: TopologyDocument, positions: Map<string, Offset>, skipped: number): LayoutResult {
  const topology = positionNodes(document.topology, positions);
  const moved = topology.nodes.filter((node, i) => node.x !== document.topology.nodes[i].x || node.y !== document.topology.nodes[i].y).length;
  return { document: parseDocument({ ...document, topology }), moved, skipped };
}

export function alignNodes(document: TopologyDocument, ids: Set<string>, alignment: Alignment): LayoutResult {
  if (!Object.hasOwn(alignmentLabels, alignment)) throw new Error('对齐方式不合法');
  const selected = boxes(document, ids), movable = selected.filter((box) => !box.node.data.locked);
  if (selected.length < 2) throw new Error('对齐至少需要选择两个节点');
  if (!movable.length) throw new Error('所选节点均已锁定，请先解锁');
  const locked = selected.find((box) => box.node.data.locked);
  const reference = locked ? [locked] : selected;
  const left = Math.min(...reference.map((box) => box.node.x)), top = Math.min(...reference.map((box) => box.node.y));
  const right = Math.max(...reference.map((box) => box.node.x + box.width)), bottom = Math.max(...reference.map((box) => box.node.y + box.height));
  const positions = new Map<string, Offset>();
  for (const box of movable) {
    const position = { x: box.node.x, y: box.node.y };
    if (alignment === 'left') position.x = left;
    if (alignment === 'center-x') position.x = (left + right - box.width) / 2;
    if (alignment === 'right') position.x = right - box.width;
    if (alignment === 'top') position.y = top;
    if (alignment === 'center-y') position.y = (top + bottom - box.height) / 2;
    if (alignment === 'bottom') position.y = bottom - box.height;
    positions.set(box.node.id, position);
  }
  return result(document, positions, selected.length - movable.length);
}

export function distributeNodes(document: TopologyDocument, ids: Set<string>, axis: LayoutAxis, requestedGap?: number): LayoutResult {
  if (axis !== 'horizontal' && axis !== 'vertical') throw new Error('分布方向不合法');
  if (requestedGap !== undefined && (!Number.isFinite(requestedGap) || requestedGap < 0 || requestedGap > MAX_LAYOUT_GAP)) throw new Error(`间距必须为 0–${MAX_LAYOUT_GAP} px`);
  const selected = boxes(document, ids), coordinate = axis === 'horizontal' ? 'x' : 'y', size = axis === 'horizontal' ? 'width' : 'height';
  const movable = selected.filter((box) => !box.node.data.locked).sort((a, b) => a.node[coordinate] - b.node[coordinate]);
  const minimum = requestedGap === undefined ? 3 : 2;
  if (movable.length < minimum) throw new Error(`此分布方式至少需要 ${minimum} 个未锁定节点`);
  const first = movable[0], last = movable.at(-1)!;
  const gap = requestedGap ?? (last.node[coordinate] + last[size] - first.node[coordinate] - movable.reduce((sum, box) => sum + box[size], 0)) / (movable.length - 1);
  if (gap < 0) throw new Error('当前空间不足以等距分布，请拉开两端或使用指定间距');
  const positions = new Map<string, Offset>();
  let cursor = first.node[coordinate];
  movable.forEach((box, i) => {
    const value = requestedGap === undefined && i === movable.length - 1 ? last.node[coordinate] : cursor;
    positions.set(box.node.id, { x: coordinate === 'x' ? value : box.node.x, y: coordinate === 'y' ? value : box.node.y });
    cursor += box[size] + gap;
  });
  return result(document, positions, selected.length - movable.length);
}
