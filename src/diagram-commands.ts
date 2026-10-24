import { definitionsFromTemplates, newId, parseDocument, type TopologyDocument } from './document';
import { drawingOrder, groupOf, regionBounds, type DiagramElement } from './diagram';

export function addDiagramElement(document: TopologyDocument, kind: DiagramElement['kind'], ids: Set<string>, point: { x: number; y: number }) {
  const next = structuredClone(document), id = newId('diagram');
  const members = next.topology.nodes.filter((node) => ids.has(node.id)).map((node) => node.id);
  if (kind === 'group' && members.some((member) => groupOf(next.topology, member))) throw new Error('所选节点已有分组，请先移出原分组');
  const bounds = kind === 'group' && members.length ? regionBounds(next.topology, members, definitionsFromTemplates(next.templates)) : { ...point, width: kind === 'group' ? 400 : 280, height: kind === 'group' ? 260 : kind === 'legend' ? 240 : 160 };
  const base = { id, ...bounds, title: kind === 'group' ? '新建区域' : kind === 'note' ? '注释' : '链路图例', color: kind === 'note' ? '#b88a43' : '#5f927e' };
  const element: DiagramElement = kind === 'group' ? { ...base, kind, members } : kind === 'note' ? { ...base, kind, text: '在属性栏填写说明文字', fontSize: 14 } : { ...base, kind, showStatus: true };
  const order = drawingOrder(next.topology);
  next.topology.elements = [...(next.topology.elements || []), element]; next.topology.order = [...order, id];
  return { document: parseDocument(next), id };
}

export function fitRegion(document: TopologyDocument, id: string) {
  const next = structuredClone(document), group = next.topology.elements?.find((e) => e.id === id);
  if (group?.kind !== 'group' || group.locked) throw new Error('请选择未锁定的分组');
  if (!group.members.length) throw new Error('分组没有成员，请先添加节点');
  Object.assign(group, regionBounds(next.topology, group.members, definitionsFromTemplates(next.templates)));
  return parseDocument(next);
}
