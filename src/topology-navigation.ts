import { definitionsFromTemplates, type TopologyDocument } from './document';
import { deviceGeometry, linkTypes, type Snapshot } from './topology';
import { elementLabels } from './diagram';

export interface NavigationResult { id: string; kind: 'node' | 'edge' | 'element'; label: string; detail: string }
export interface NavigationBounds { x: number; y: number; width: number; height: number }
export interface NavigationPoint { x: number; y: number }
export function searchTopology(document: TopologyDocument, query: string, limit = 50): NavigationResult[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return [];
  const definitions = definitionsFromTemplates(document.templates), titles = new Map(document.topology.nodes.map(n => [n.id, n.data.title]));
  const rows = [
    ...document.topology.nodes.map(n => ({ id: n.id, kind: 'node' as const, label: n.data.title, detail: `${definitions[n.data.kind].label} · ${n.data.deviceId}`, text: [n.id, n.data.title, n.data.deviceId, n.data.binding?.source, n.data.address, definitions[n.data.kind].label, definitions[n.data.kind].en].join(' ') })),
    ...document.topology.edges.map(e => ({ id: e.id, kind: 'edge' as const, label: e.label || linkTypes[e.kind].label, detail: `${titles.get(e.source.cell)} → ${titles.get(e.target.cell)}`, text: [e.id, e.label, linkTypes[e.kind].label, titles.get(e.source.cell), titles.get(e.target.cell)].join(' ') })),
    ...(document.topology.elements || []).map(e => ({ id: e.id, kind: 'element' as const, label: e.title, detail: elementLabels[e.kind], text: [e.id, e.title, e.kind === 'note' ? e.text : ''].join(' ') })),
  ];
  return rows.filter(row => words.every(word => row.text.toLocaleLowerCase().includes(word)))
    .sort((a, b) => Number(b.label.toLocaleLowerCase() === words.join(' ')) - Number(a.label.toLocaleLowerCase() === words.join(' ')))
    .slice(0, Math.max(0, Math.min(200, limit)))
    .map(({ text: _text, ...row }) => row);
}
/** A one-hop selection, preserving cycles and parallel cables without following the entire graph. */
export function relatedTopology(snapshot: Snapshot, id: string): Set<string> {
  const group = snapshot.elements?.find(e => e.id === id), edge = snapshot.edges.find(e => e.id === id);
  const seeds = new Set(group?.kind === 'group' ? group.members : edge ? [edge.source.cell, edge.target.cell] : [id]);
  const result = new Set([id, ...seeds]);
  for (const cable of snapshot.edges) if (seeds.has(cable.source.cell) || seeds.has(cable.target.cell)) {
    result.add(cable.id); result.add(cable.source.cell); result.add(cable.target.cell);
  }
  for (const region of snapshot.elements || []) if (region.kind === 'group' && region.members.some(member => result.has(member))) result.add(region.id);
  return result;
}
export function navigationGeometry(document: TopologyDocument) {
  const definitions = definitionsFromTemplates(document.templates);
  const nodes = document.topology.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, ...deviceGeometry(n.data, definitions) }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const elements = (document.topology.elements || []).map(e => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, kind: e.kind }));
  const edges = document.topology.edges.map(e => {
    const endpoint = (end: typeof e.source) => { const n = byId.get(end.cell)!, port = n.ports.find(p => p.id === end.port)!; return { x: n.x + port.x, y: n.y + port.y }; };
    return { id: e.id, points: [endpoint(e.source), ...e.vertices, endpoint(e.target)] };
  });
  const boxes = [...nodes, ...elements], points = [...boxes.flatMap(n => [{ x: n.x, y: n.y }, { x: n.x + n.width, y: n.y + n.height }]), ...edges.flatMap(e => e.points)];
  if (!points.length) return { nodes, elements, edges, bounds: { x: -50, y: -50, width: 100, height: 100 } };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  left -= 40; top -= 40;
  return { nodes, elements, edges, bounds: { x: left, y: top, width: Math.max(100, right - left + 40), height: Math.max(100, bottom - top + 40) } };
}
/** Inverse of SVG xMidYMid meet, including letterboxing and negative world coordinates. */
export function minimapPoint(point: NavigationPoint, bounds: NavigationBounds, width: number, height: number): NavigationPoint {
  const scale = Math.min(width / bounds.width, height / bounds.height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('小地图尺寸不合法');
  const x = bounds.x + (point.x - (width - bounds.width * scale) / 2) / scale;
  const y = bounds.y + (point.y - (height - bounds.height * scale) / 2) / scale;
  return { x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, x)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, y)) };
}
