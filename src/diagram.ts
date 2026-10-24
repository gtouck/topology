import { deviceGeometry, type DeviceDefinition, type Snapshot } from './topology';

interface ElementBase { id: string; x: number; y: number; width: number; height: number; title: string; color: string; locked?: boolean }
export interface RegionElement extends ElementBase { kind: 'group'; members: string[] }
export interface NoteElement extends ElementBase { kind: 'note'; text: string; fontSize: number }
export interface LegendElement extends ElementBase { kind: 'legend'; showStatus: boolean }
export type DiagramElement = RegionElement | NoteElement | LegendElement;
export const MAX_DIAGRAM_ELEMENTS = 100;
export const elementLabels = { group: '区域分组', note: '文字注释', legend: '链路图例' };
export const validCoordinate = (n: number) => Number.isFinite(n) && Math.abs(n) <= 100000;

export function parseDiagram(input: unknown, snapshot: Snapshot): Pick<Snapshot, 'elements' | 'order'> {
  const raw = input as { elements?: unknown; order?: unknown };
  const ids = new Set([...snapshot.nodes, ...snapshot.edges].map((item) => item.id));
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id)), grouped = new Set<string>();
  const parsed: Pick<Snapshot, 'elements' | 'order'> = {};
  if (raw.elements !== undefined) {
    if (!Array.isArray(raw.elements) || raw.elements.length > MAX_DIAGRAM_ELEMENTS) throw new Error(`图面元素最多 ${MAX_DIAGRAM_ELEMENTS} 个`);
    parsed.elements = raw.elements.map((value) => {
      if (!value || typeof value !== 'object') throw new Error('图面元素不合法');
      const e = value as DiagramElement;
      if (typeof e.id !== 'string' || !/^[\w.-]{1,100}$/.test(e.id) || ['__proto__', 'constructor', 'prototype'].includes(e.id) || ids.has(e.id)) throw new Error('图面元素 ID 不合法或重复');
      ids.add(e.id);
      if (!Object.hasOwn(elementLabels, e.kind)) throw new Error('图面元素类型不合法');
      if (!validCoordinate(e.x) || !validCoordinate(e.y)) throw new Error('图面元素坐标超出范围');
      if (!Number.isFinite(e.width) || !Number.isFinite(e.height) || e.width < 160 || e.width > 10000 || e.height < 80 || e.height > 10000) throw new Error('图面尺寸需为宽 160–10000、高 80–10000 px');
      if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 100 || typeof e.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(e.color)) throw new Error('图面标题或颜色不合法');
      if (e.locked !== undefined && typeof e.locked !== 'boolean') throw new Error('图面锁定配置不合法');
      const base: ElementBase = { id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, title: e.title, color: e.color, ...(e.locked === undefined ? {} : { locked: e.locked }) };
      if (e.kind === 'group') {
        if (!Array.isArray(e.members) || e.members.length > 300 || e.members.some((id) => !nodeIds.has(id) || grouped.has(id)) || new Set(e.members).size !== e.members.length) throw new Error('分组成员不存在、重复或已属于其他分组');
        e.members.forEach((id) => grouped.add(id));
        return { ...base, kind: 'group', members: [...e.members] };
      }
      if (e.kind === 'note') {
        if (typeof e.text !== 'string' || e.text.length > 2000 || !Number.isInteger(e.fontSize) || e.fontSize < 12 || e.fontSize > 28) throw new Error('注释最多 2000 字符，字号需为 12–28 px 的整数');
        return { ...base, kind: 'note', text: e.text, fontSize: e.fontSize };
      }
      if (typeof e.showStatus !== 'boolean') throw new Error('图例状态配置不合法');
      return { ...base, kind: 'legend', showStatus: e.showStatus };
    });
  }
  if (raw.order !== undefined) {
    const eligible = new Set([...snapshot.nodes, ...(parsed.elements || [])].map((item) => item.id));
    if (!Array.isArray(raw.order) || raw.order.length !== eligible.size || raw.order.some((id) => !eligible.has(id)) || new Set(raw.order).size !== raw.order.length) throw new Error('层次顺序需包含每个节点和图面元素且不得重复');
    parsed.order = [...raw.order];
  }
  return parsed;
}

export const drawingOrder = (snapshot: Snapshot) => snapshot.order || [...snapshot.nodes, ...(snapshot.elements || [])].map((item) => item.id);
export const groupOf = (snapshot: Snapshot, id: string) => snapshot.elements?.find((element): element is RegionElement => element.kind === 'group' && element.members.includes(id));
export function positionLocked(snapshot: Snapshot, id: string) {
  const element = snapshot.elements?.find((item) => item.id === id);
  return !!(element?.locked || snapshot.nodes.find((node) => node.id === id)?.data.locked || groupOf(snapshot, id)?.locked);
}
export function movableSelection(snapshot: Snapshot, selected: Set<string>) {
  const ids = new Set<string>(), skipped = new Set<string>();
  for (const id of selected) {
    const element = snapshot.elements?.find((item) => item.id === id);
    if (positionLocked(snapshot, id) || (element?.kind === 'group' && element.members.some((member) => positionLocked(snapshot, member)))) { skipped.add(id); continue; }
    if (snapshot.nodes.some((node) => node.id === id) || element) ids.add(id);
    if (element?.kind === 'group') element.members.forEach((member) => ids.add(member));
  }
  return { ids, skipped };
}
export function regionBounds(snapshot: Snapshot, ids: string[], definitions: Record<string, DeviceDefinition>) {
  const nodes = snapshot.nodes.filter((node) => ids.includes(node.id));
  if (!nodes.length) return { x: 0, y: 0, width: 400, height: 260 };
  const boxes = nodes.map((node) => ({ ...node, ...deviceGeometry(node.data, definitions) }));
  const x = Math.min(...boxes.map((n) => n.x)) - 28, y = Math.min(...boxes.map((n) => n.y)) - 52;
  return { x, y, width: Math.max(...boxes.map((n) => n.x + n.width)) - x + 28, height: Math.max(...boxes.map((n) => n.y + n.height)) - y + 28 };
}
export function reorder(snapshot: Snapshot, ids: Set<string>, front: boolean): Snapshot {
  const next = structuredClone(snapshot), order = drawingOrder(snapshot);
  const selected = order.filter((id) => ids.has(id)), rest = order.filter((id) => !ids.has(id));
  next.order = front ? [...rest, ...selected] : [...selected, ...rest];
  return next;
}
export function setGroupMembers(snapshot: Snapshot, id: string, members: string[]): Snapshot {
  const next = structuredClone(snapshot), group = next.elements?.find((e) => e.id === id);
  if (group?.kind !== 'group' || group.locked) throw new Error('请先选择未锁定的分组');
  if (members.some((member) => { const owner = groupOf(snapshot, member); return owner && owner.id !== id; })) throw new Error('节点已属于其他分组，请先移出原分组');
  group.members = [...members];
  return { ...next, ...parseDiagram(next, next) };
}
