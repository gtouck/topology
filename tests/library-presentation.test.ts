import { describe, expect, test } from 'bun:test';
import { createDocument, sampleDocument } from '../src/document';
import { findDocuments, documentThumbnail } from '../src/library-presentation';

describe('拓扑库查询与布局缩略图', () => {
  test('搜索支持多词、说明与分类中文名，分类与排序组合不修改原数组', () => {
    const first = sampleDocument('satellite', '卫星 10'); first.updatedAt = '2026-01-01T00:00:00.000Z'; first.description = '主控链路';
    const second = sampleDocument('datacenter', '机房'); second.updatedAt = '2026-04-01T00:00:00.000Z';
    const third = sampleDocument('satellite', '卫星 2'); third.updatedAt = '2026-03-01T00:00:00.000Z';
    const docs = [first, second, third], before = structuredClone(docs);
    expect(findDocuments(docs, '卫星 主控', '', 'modified').map((d) => d.id)).toEqual([first.id]);
    expect(findDocuments(docs, '卫星逻辑', 'satellite', 'name').map((d) => d.id)).toEqual([third.id, first.id]);
    expect(findDocuments(docs, '', '', 'modified').map((d) => d.id)).toEqual([second.id, third.id, first.id]);
    expect(findDocuments(docs, '不存在', '', 'modified')).toEqual([]);
    expect(docs).toEqual(before);
  });
  test('空图及不可信文本安全显示，不生成可执行标签或运行值', () => {
    const doc = createDocument('<img src=x onerror=alert(1)>');
    expect(documentThumbnail(doc)).toContain('空白画布');
    expect(documentThumbnail(doc)).toContain('&lt;img');
    doc.topology = sampleDocument('satellite').topology;
    doc.topology.nodes[0].data.title = '<script>alert(1)</script>';
    const before = structuredClone(doc), svg = documentThumbnail(doc);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('device-metric');
    expect(doc).toEqual(before);
  });
  test('缩略图使用自定义模板尺寸、手工位置和完整拐点', () => {
    const doc = sampleDocument('satellite');
    const node = doc.topology.nodes[0];
    node.x = -123; node.y = 456; node.data.visibleMetrics = [];
    doc.topology.edges[0].vertices = [{ x: -1000, y: -800 }, { x: 200, y: -800 }];
    const svg = documentThumbnail(doc);
    expect(svg).toContain('x="-123" y="456"');
    expect(svg).toContain('height="90"');
    expect(svg).toContain('-1000,-800 200,-800');
    expect(svg).toContain('viewBox="-1040 -840');
    node.x += 800;
    expect(documentThumbnail(doc)).toContain('x="677" y="456"');
  });
  test('格式上限内的密集拐点不会超过函数参数上限，所有拐点计入边界', () => {
    const doc = sampleDocument('satellite'), edge = doc.topology.edges[0];
    doc.topology.edges = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(edge), id: `link-${i}`, vertices: Array.from({ length: 200 }, (_, j) => ({ x: -90000 + i, y: 80000 - j })) }));
    const svg = documentThumbnail(doc);
    expect(svg).toContain('viewBox="-90040');
    expect(svg).toContain('-90000,80000');
    expect(svg.match(/data-thumbnail-edge=/g)).toHaveLength(1000);
  });
});
