import { createDocument } from '../../src/document';
import type { DeviceRecord, LinkRecord } from '../../src/topology';

export function largeTopology(count: number, cables: number) {
  const nodes: DeviceRecord[] = Array.from({ length: count }, (_, i) => ({ id: `node-${i}`, x: 40 + (i % 20) * 260, y: 40 + Math.floor(i / 20) * 180, data: { kind: 'module', title: `模块 ${i}`, deviceId: `DEV-${i}`, address: '', status: 'normal', visibleMetrics: ['load', 'temperature'], binding: { source: `DEV-${i}`, fields: { load: 'load', temperature: 'temperature' }, statusField: 'status' } } }));
  const edges: LinkRecord[] = Array.from({ length: cables }, (_, i) => {
    const source = i % count; let target = (i * 7 + 11) % count; if (source === target) target = (target + 1) % count;
    const a = nodes[source], b = nodes[target];
    return { id: `edge-${i}`, source: { cell: a.id, port: 'right' }, target: { cell: b.id, port: 'left' }, kind: 'logical', label: `链路 ${i}`, vertices: [{ x: a.x + 235, y: a.y + 66 }, { x: b.x - 25, y: b.y + 66 }] };
  });
  return createDocument(`${count} 节点 / ${cables} 链路`, 'general', { nodes, edges });
}
