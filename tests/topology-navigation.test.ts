import { describe, expect, test } from 'bun:test';
import { sampleDocument, parseDocument } from '../src/document';
import { searchTopology, relatedTopology, navigationGeometry, minimapPoint } from '../src/topology-navigation';
import { copySelection, pasteSelection } from '../src/editor-commands';
import { renderTopologySvg } from '../src/export-svg';
import { renderTopologyHtml } from '../src/export-html';

describe('S10 查找、关联与子拓扑', () => {
  test('名称、业务/绑定 ID、地址、模板及文字匹配，支持空格条件和精确排序', () => {
    const doc = sampleDocument('ground-station');
    doc.topology.nodes[0].data.binding!.source = 'station.azimuth';
    doc.topology.elements = [{ id: 'note-1', kind: 'note', title: '维护说明', text: '指向运控中心主站', fontSize: 14, color: '#123456', x: 0, y: 0, width: 240, height: 120 }];
    const before = structuredClone(doc);
    expect(searchTopology(doc, 'DEV-001')[0].id).toBe('ant-01');
    expect(searchTopology(doc, 'station.azimuth')[0].id).toBe('ant-01');
    expect(searchTopology(doc, '192.168.10.11')[0].id).toBe('ant-01');
    expect(searchTopology(doc, 'ANTENNA DEV-001').map(r => r.id)).toEqual(['ant-01']);
    expect(searchTopology(doc, 'Ku-band · 接收')[0].id).toBe('link-rx-rf');
    expect(searchTopology(doc, '主站')[0].id).toBe('note-1'); expect(searchTopology(doc, '  ')).toEqual([]);
    expect(doc).toEqual(before);
  });
  test('关联仅扩展一跳、保留并行边/环路并包含分组，不遍历整个图', () => {
    const doc = sampleDocument('ground-station');
    doc.topology.elements = [{ id: 'region', kind: 'group', title: '接收链', members: ['lnb-01'], color: '#123456', x: 200, y: 20, width: 400, height: 200 }];
    const ids = relatedTopology(doc.topology, 'ant-01');
    expect(ids.has('lnb-01')).toBe(true); expect(ids.has('hpa-01')).toBe(true); expect(ids.has('region')).toBe(true);
    expect(ids.has('link-rx-rf')).toBe(true); expect(ids.has('srv-01')).toBe(false); expect(ids.has('bb-rx')).toBe(false);
    const edge = relatedTopology(doc.topology, 'link-rx-rf'); expect(edge.has('ant-01')).toBe(true); expect(edge.has('lnb-01')).toBe(true);
  });
  test('小地图覆盖负坐标、节点尺寸及手工拐点，逆变换包含留白', () => {
    const doc = sampleDocument('ground-station'), before = structuredClone(doc);
    doc.topology.nodes[0].x = -400; doc.topology.edges[0].vertices[0] = { x: -900, y: -800 };
    const geometry = navigationGeometry(doc), bounds = geometry.bounds;
    expect(bounds.x).toBeLessThanOrEqual(-900); expect(bounds.y).toBeLessThanOrEqual(-800);
    expect(geometry.edges[0].points).toContainEqual({ x: -900, y: -800 });
    const center = minimapPoint({ x: 90, y: 60 }, bounds, 180, 120);
    expect(center.x).toBeCloseTo(bounds.x + bounds.width / 2); expect(center.y).toBeCloseTo(bounds.y + bounds.height / 2);
    expect(minimapPoint({ x: -1000, y: -1000 }, bounds, 180, 120)).toEqual({ x: bounds.x, y: bounds.y });
    expect(() => minimapPoint({ x: 0, y: 0 }, bounds, 0, 0)).toThrow();
    expect(before.topology.nodes[0].x).toBe(30);
  });
  test('子图引用可选不注入旧文档，复制/迁移/Schema/HTML 一致，拒绝危险和自身引用', async () => {
    const doc = sampleDocument('ground-station'), before = structuredClone(doc);
    expect(parseDocument(doc)).toEqual(doc);
    doc.topology.nodes[0].data.childTopologyId = 'child-graph';
    expect(parseDocument(doc).topology.nodes[0].data.childTopologyId).toBe('child-graph');
    const clipboard = copySelection(doc, new Set(['ant-01']))!;
    const copy = pasteSelection(doc, clipboard, { x: 40, y: 40 });
    expect(copy.document.topology.nodes.at(-1)!.data.childTopologyId).toBe('child-graph');
    expect(renderTopologySvg(doc).svg).toContain('↗');
    expect(renderTopologyHtml(doc, {}, '/* runtime */')).toContain('topology:navigate');
    const schema = await Bun.file('schema/topology-v3.schema.json').json(); expect(schema.$defs.nodeData.properties.childTopologyId).toEqual(schema.properties.id);
    doc.topology.nodes[0].data.childTopologyId = 'javascript:bad'; expect(() => parseDocument(doc)).toThrow('子拓扑');
    doc.topology.nodes[0].data.childTopologyId = doc.id; expect(() => parseDocument(doc)).toThrow('自身');
    expect(before.topology.nodes[0].data.childTopologyId).toBeUndefined();
  });
});
