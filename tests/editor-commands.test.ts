import { describe, expect, test } from 'bun:test';
import { sampleDocument, createDocument, parseDocument } from '../src/document';
import { copySelection, pasteSelection, moveSelection, deleteSelection } from '../src/editor-commands';

const fixture = () => sampleDocument('ground-station');
const ids = () => new Set(['ant-01', 'lnb-01']);

describe('S03 多选与剪贴板命令', () => {
  test('只复制节点和内部连线，模板和拐点独立于原图', () => {
    const doc = fixture(), before = JSON.stringify(doc);
    const copy = copySelection(doc, ids())!;
    expect(copy.nodes.map((node) => node.id)).toEqual(['ant-01', 'lnb-01']);
    expect(copy.edges.map((edge) => edge.id)).toEqual(['link-rx-rf']);
    expect(copy.templates.map((template) => template.id)).toEqual(['antenna', 'lnb']);
    copy.nodes[0].data.title = '修改副本'; copy.edges[0].vertices[0].x = 500;
    copy.templates[0].label = '修改模板';
    expect(JSON.stringify(doc)).toBe(before);
    expect(copySelection(doc, new Set(['link-rx-rf']))).toBeNull();
  });

  test('整组移动内部拐点，对外拐点和非选节点保持原位', () => {
    const doc = fixture(), before = structuredClone(doc.topology);
    const moved = moveSelection(doc.topology, ids(), { x: 40, y: -20 });
    for (const node of moved.nodes) {
      const old = before.nodes.find((item) => item.id === node.id)!;
      expect(node.x).toBe(old.x + (ids().has(node.id) ? 40 : 0));
      expect(node.y).toBe(old.y + (ids().has(node.id) ? -20 : 0));
    }
    expect(moved.edges.find((edge) => edge.id === 'link-rx-rf')!.vertices).toEqual(before.edges[0].vertices.map((point) => ({ x: point.x + 40, y: point.y - 20 })));
    expect(moved.edges.find((edge) => edge.id === 'link-tx-rf')!.vertices).toEqual(before.edges.find((edge) => edge.id === 'link-tx-rf')!.vertices);
    expect(doc.topology).toEqual(before);
    expect(() => moveSelection(before, ids(), { x: Infinity, y: 0 })).toThrow('不合法');
    expect(() => moveSelection(before, ids(), { x: 100001, y: 0 })).toThrow('范围');
  });

  test('粘贴生成唯一图形和设备 ID，整体偏移且不复用原绑定源', () => {
    const doc = fixture(), before = structuredClone(doc), copy = copySelection(doc, ids())!;
    const result = pasteSelection(doc, copy);
    const pasted = result.document.topology.nodes.filter((node) => result.nodeIds.includes(node.id));
    expect(pasted).toHaveLength(2);
    const all = [...result.document.topology.nodes, ...result.document.topology.edges].map((cell) => cell.id);
    expect(new Set(all).size).toBe(all.length);
    for (const [i, node] of pasted.entries()) {
      expect(node.x).toBe(copy.nodes[i].x + 40); expect(node.y).toBe(copy.nodes[i].y + 40);
      expect(node.data.deviceId).not.toBe(copy.nodes[i].data.deviceId);
      expect(node.data.binding!.source).toBe(node.data.deviceId);
      expect(node.data.binding!.fields).toEqual(copy.nodes[i].data.binding!.fields);
    }
    const edge = result.document.topology.edges.at(-1)!;
    expect(edge.source.cell).toBe(pasted[0].id); expect(edge.target.cell).toBe(pasted[1].id);
    expect(edge.source.port).toBe(copy.edges[0].source.port);
    expect(edge.vertices).toEqual(copy.edges[0].vertices.map((point) => ({ x: point.x + 40, y: point.y + 40 })));
    expect(doc).toEqual(before);
    expect(parseDocument(result.document)).toEqual(result.document);
  });

  test('重复粘贴不会碰撞业务 ID，支持切图粘贴所需模板', () => {
    const doc = fixture(), copy = copySelection(doc, ids())!;
    const first = pasteSelection(createDocument('空白图', 'general', { nodes: [], edges: [] }, {}), copy);
    expect(first.document.templates.map((template) => template.id)).toEqual(['antenna', 'lnb']);
    const second = pasteSelection(first.document, copy, { x: 80, y: 80 });
    const businessIds = second.document.topology.nodes.map((node) => node.data.deviceId);
    expect(new Set(businessIds).size).toBe(4);
    expect(second.document.topology.nodes.at(-1)!.y).toBe(copy.nodes[1].y + 80);
  });

  test('同名但不同定义的模板生成别名，不覆盖目标节点', () => {
    const source = fixture(), target = fixture();
    source.templates.find((template) => template.id === 'antenna')!.label = '不同的源天线';
    const result = pasteSelection(target, copySelection(source, new Set(['ant-01']))!);
    expect(result.document.templates.find((template) => template.id === 'antenna')!.label).toBe('天线');
    expect(result.document.topology.nodes[0].data.kind).toBe('antenna');
    const pasted = result.document.topology.nodes.at(-1)!;
    expect(pasted.data.kind).not.toBe('antenna');
    expect(result.document.templates.find((template) => template.id === pasted.data.kind)!.label).toBe('不同的源天线');
  });

  test('自定义端口、绑定路径和线缆外观随副本保留', () => {
    const doc = fixture();
    const antenna = doc.topology.nodes[0];
    antenna.data.ports = structuredClone(doc.templates.find((template) => template.id === 'antenna')!.ports);
    antenna.data.ports[0].label = '自定义入口'; antenna.data.portSpacing = 30;
    antenna.data.binding!.source = 'host-original'; antenna.data.binding!.fields.azimuth = 'angle.az';
    doc.topology.edges[0].appearance = { style: 'double', width: 12, color: '#112233', arrows: true };
    const result = pasteSelection(doc, copySelection(doc, ids())!);
    const pasted = result.document.topology.nodes.find((node) => node.id === result.nodeIds[0])!;
    expect(pasted.data.ports).toEqual(antenna.data.ports);
    expect(pasted.data.portSpacing).toBe(30);
    expect(pasted.data.binding!.fields.azimuth).toBe('angle.az');
    expect(pasted.data.binding!.source).not.toBe('host-original');
    expect(result.document.topology.edges.at(-1)!.appearance).toEqual(doc.topology.edges[0].appearance);
  });

  test('批量删除包括关联连线，删除单独选中的线不改变节点', () => {
    const doc = fixture(), before = structuredClone(doc);
    const result = deleteSelection(doc, new Set(['ant-01', 'lnb-01', 'link-server']));
    expect(result.topology.nodes).toHaveLength(6);
    expect(result.topology.edges.some((edge) => ['ant-01', 'lnb-01'].includes(edge.source.cell) || ['ant-01', 'lnb-01'].includes(edge.target.cell) || edge.id === 'link-server')).toBe(false);
    const lineOnly = deleteSelection(doc, new Set(['link-server']));
    expect(lineOnly.topology.nodes).toEqual(doc.topology.nodes);
    expect(lineOnly.topology.edges).toHaveLength(doc.topology.edges.length - 1);
    expect(doc).toEqual(before);
  });

  test('数量和坐标越界时拒绝整次粘贴，原图与剪贴板不改变', () => {
    const doc = fixture(), copy = copySelection(doc, ids())!, before = JSON.stringify({ doc, copy });
    expect(() => pasteSelection(doc, copy, { x: 100000, y: 100000 })).toThrow('范围');
    const full = fixture(); full.topology.nodes = Array.from({ length: 299 }, (_, i) => ({ ...structuredClone(doc.topology.nodes[0]), id: `n-${i}` }));
    expect(() => pasteSelection(full, copy)).toThrow('上限');
    const manyEdges = fixture(); manyEdges.topology.edges = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(doc.topology.edges[0]), id: `edge-${i}` }));
    expect(() => pasteSelection(manyEdges, copy)).toThrow('上限');
    expect(JSON.stringify({ doc, copy })).toBe(before);
  });

  test('生成器碰撞可重试；持续碰撞和悬空线不会产生部分粘贴', () => {
    const doc = fixture(), copy = copySelection(doc, ids())!;
    let n = 0;
    const result = pasteSelection(doc, copy, { x: 0, y: 0 }, () => n++ === 0 ? 'ant-01' : `fresh-${n}`);
    expect(result.nodeIds[0]).toBe('fresh-2');
    expect(() => pasteSelection(doc, copy, { x: 0, y: 0 }, () => 'ant-01')).toThrow('唯一');
    const broken = structuredClone(copy); broken.edges[0].target.cell = 'missing';
    expect(() => pasteSelection(doc, broken)).toThrow('悬空');
    expect(doc.topology.nodes).toHaveLength(8);
  });

  test('跨图粘贴不复用源 ID，长设备 ID 及 Unicode 标题仍有效', () => {
    const doc = fixture(), node = doc.topology.nodes[0];
    node.data.deviceId = 'A'.repeat(73) + '-copy-1';
    node.data.title = '🛰️'.repeat(20).slice(0, 60);
    const copy = copySelection(doc, new Set([node.id]))!;
    let n = 0;
    const result = pasteSelection(createDocument('接收图', 'general', { nodes: [], edges: [] }, {}), copy, { x: 40, y: 40 }, () => n++ === 0 ? node.id : `fresh-${n}`);
    const pasted = result.document.topology.nodes[0];
    expect(pasted.id).not.toBe(node.id);
    expect(pasted.data.deviceId).not.toBe(node.data.deviceId);
    expect(pasted.data.deviceId.length).toBeLessThanOrEqual(80);
    expect(pasted.data.title.length).toBeLessThanOrEqual(60);
    expect(pasted.data.title).not.toMatch(/[\uD800-\uDFFF]/u);
  });
});
