import { describe, expect, test } from 'bun:test';
import { parseDocument, sampleDocument } from '../src/document';
import { applyTemplate, duplicateTemplate, importTemplate, templateFile } from '../src/template-commands';
import { deviceGeometry } from '../src/topology';

describe('S07 模板迁移与复用', () => {
  test('修改删除参数清理可见项及绑定，保留标识、布局、手工路径及原文档', () => {
    const doc = sampleDocument('ground-station'), before = structuredClone(doc);
    const template = structuredClone(doc.templates.find(t => t.id === 'antenna')!);
    template.label = '新天线'; template.metrics = template.metrics.filter(m => m.key !== 'azimuth');
    template.metrics.push({ key: 'tracking', label: '跟踪误差', unit: '°', decimals: 2 });
    const next = applyTemplate(doc, template), node = next.topology.nodes[0];
    expect(doc).toEqual(before); expect(next.topology.edges).toEqual(doc.topology.edges);
    expect({ ...node, data: undefined }).toEqual({ ...doc.topology.nodes[0], data: undefined });
    expect(node.data.visibleMetrics).toEqual(['elevation']);
    expect(node.data.binding?.fields.azimuth).toBeUndefined(); expect(node.data.binding?.fields.tracking).toBeUndefined();
    expect(node.data.deviceId).toBe(doc.topology.nodes[0].data.deviceId);
    expect(node.data.title).toBe(doc.topology.nodes[0].data.title);
    expect(parseDocument(next)).toEqual(next);
  });
  test('继承模板的已连接端口不能删除或改类型，整批拒绝', () => {
    const doc = sampleDocument('ground-station'), before = structuredClone(doc);
    const template = structuredClone(doc.templates.find(t => t.id === 'antenna')!);
    template.ports = template.ports.filter(p => p.id !== 'rf-rx');
    expect(() => applyTemplate(doc, template)).toThrow('已连接端口'); expect(doc).toEqual(before);
    template.ports = structuredClone(before.templates.find(t => t.id === 'antenna')!.ports);
    template.ports[0].kind = 'logical';
    expect(() => applyTemplate(doc, template)).toThrow('已连接端口'); expect(doc).toEqual(before);
  });
  test('节点覆盖端口不随模板修改，未连接端口和位置可调整', () => {
    const doc = sampleDocument('ground-station');
    const template = structuredClone(doc.templates.find(t => t.id === 'antenna')!);
    doc.topology.nodes[0].data.ports = structuredClone(template.ports);
    template.ports = [{ id: 'top', label: '顶部', kind: 'logical', side: 'top' }];
    const next = applyTemplate(doc, template);
    expect(next.topology.nodes).toEqual(doc.topology.nodes); expect(next.topology.edges).toEqual(doc.topology.edges);
    expect(next.templates.find(t => t.id === template.id)?.ports).toEqual(template.ports);
  });
  test('复制、导出再导入保留定义并避免覆盖，错误格式和超额被拒绝', () => {
    const doc = sampleDocument('satellite'), original = doc.templates[0];
    const copy = duplicateTemplate(original); expect(copy.id).not.toBe(original.id); expect(copy.metrics).toEqual(original.metrics);
    const imported = importTemplate(JSON.parse(JSON.stringify(templateFile(original))), doc.templates);
    expect(imported.id).not.toBe(original.id); expect(imported.ports).toEqual(original.ports);
    expect(importTemplate(templateFile(original), []).id).toBe(original.id);
    expect(() => importTemplate({ version: 2, template: original }, [])).toThrow();
    const maximum = { ...doc, templates: Array.from({ length: 64 }, (_, i) => ({ ...copy, id: `custom-${i}` })) };
    expect(() => applyTemplate(maximum, imported)).toThrow('64');
  });
  test('同侧多个无偏移模板连接点等距排布，不在中心重叠', () => {
    const doc = sampleDocument('satellite');
    const node = doc.topology.nodes[0];
    const ports = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, kind: 'logical' as const, side: 'left' as const }));
    const geometry = deviceGeometry(node.data, { [node.data.kind]: { label: '', en: '', model: '', icon: 'Cpu', metrics: [], ports } });
    expect(new Set(geometry.ports.map(p => p.y)).size).toBe(6);
    expect(geometry.ports.every(p => p.x === 0)).toBe(true);
    expect(node.x).toBe(doc.topology.nodes[0].x);
  });
  test('独立模板 Schema 自包含且与 v3 模板定义一致', async () => {
    const schema = await Bun.file('schema/node-template.schema.json').json();
    const document = await Bun.file('schema/topology-v3.schema.json').json();
    expect(schema.properties.template.$ref).toBe('#/$defs/template');
    for (const key of ['template', 'metric', 'port']) expect(schema.$defs[key]).toEqual(document.$defs[key]);
  });
});
