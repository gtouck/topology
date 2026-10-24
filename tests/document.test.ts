import { describe, expect, test } from 'bun:test';
import { createDocument, parseDocument, parseTemplate, sampleDocument, definitionsFromTemplates } from '../src/document';
import { builtinDevices, devices, deviceGeometry, initialTopology } from '../src/topology';
import { resolveNodeData, readField } from '../src/runtime-data';

describe('通用文档 v3', () => {
  test('所有场景均可脱离活动模板注册表往返解析', () => {
    const registryBefore = JSON.stringify(devices);
    for (const category of ['general', 'ground-station', 'datacenter', 'satellite']) {
      const doc = sampleDocument(category);
      expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
      expect(doc.version).toBe(3);
    }
    expect(JSON.stringify(devices)).toBe(registryBefore);
  });

  test('v1 迁移保留端点、位置、拐点、动态端口和线缆外观', () => {
    const topology = initialTopology();
    topology.edges[0].appearance = { style: 'jacket', width: 9, color: '#123456', arrows: false };
    const legacy = { version: 1, name: '旧拓扑', savedAt: '2026-10-22T12:00:00Z', topology };
    const doc = parseDocument(legacy);
    expect(doc.name).toBe('旧拓扑'); expect(doc.topology).toEqual(topology);
    expect(doc.createdAt).toBe('2026-10-22T12:00:00.000Z');
    expect(parseDocument(doc)).toEqual(doc);
    expect(JSON.stringify(doc)).not.toContain('jitter');
  });

  test('文件内自定义模板、字段与连接点可独立使用', () => {
    const doc = createDocument('载荷逻辑图');
    const template = parseTemplate({ id: 'custom-payload', version: 1, label: '载荷', en: 'PAYLOAD', icon: 'Cpu', model: '自定义模板', metrics: [{ key: 'voltage', label: '电压', unit: 'V', decimals: 2 }], ports: [{ id: 'left', label: '数据入口', kind: 'logical', side: 'left' }] });
    doc.templates = [template];
    doc.topology.nodes = [{ id: 'payload-1', x: 20, y: 30, data: { kind: template.id, title: '光学载荷', deviceId: 'PAYLOAD-1', address: '', visibleMetrics: ['voltage'], status: 'normal', binding: { source: 'satellite-A', fields: { voltage: 'power.voltage' }, statusField: 'health', statusMap: { ok: 'normal', down: 'offline' } } } }];
    expect(parseDocument(doc)).toEqual(doc);
    const defs = definitionsFromTemplates(doc.templates);
    expect(deviceGeometry(doc.topology.nodes[0].data, defs).ports[0]).toMatchObject({ x: 0, y: 58 });
    expect(builtinDevices).not.toHaveProperty(template.id);
  });

  test('实际旧版没有绑定字段的节点获得默认映射，原对象保持不变', () => {
    const topology = initialTopology(); topology.nodes.forEach((node) => { delete node.data.binding; });
    const original = JSON.stringify(topology);
    const migrated = parseDocument({ version: 1, name: '旧图', savedAt: '', topology });
    expect(migrated.topology.nodes[0].data.binding).toMatchObject({ source: topology.nodes[0].data.deviceId, fields: { azimuth: 'azimuth' }, statusField: 'status' });
    expect(migrated.topology.edges).toEqual(topology.edges);
    expect(JSON.stringify(topology)).toBe(original);
    expect(parseDocument(migrated)).toEqual(migrated);
  });

  test('拒绝未知版本、缺失模板、重复模板和非法字段映射', () => {
    const doc = sampleDocument('satellite');
    expect(() => parseDocument({ ...doc, version: 9 })).toThrow('版本');
    const missing = structuredClone(doc); missing.templates = missing.templates.filter((t) => t.id !== 'subsystem');
    expect(() => parseDocument(missing)).toThrow('设备类型');
    const duplicate = structuredClone(doc); duplicate.templates.push(duplicate.templates[0]);
    expect(() => parseDocument(duplicate)).toThrow('重复模板');
    const badBinding = structuredClone(doc); badBinding.topology.nodes[0].data.binding!.fields.load = '__proto__.polluted';
    expect(() => parseDocument(badBinding)).toThrow('绑定');
    const badTemplate = structuredClone(doc); badTemplate.templates[0].metrics[0].decimals = 99;
    expect(() => parseDocument(badTemplate)).toThrow('小数');
  });

  test('实际数据、嵌套路径和业务状态映射不修改文件', () => {
    const doc = sampleDocument('satellite'); const node = doc.topology.nodes[0];
    node.data.binding = { source: 'sat-1', fields: { load: 'stats.load', temperature: 'stats.temp' }, statusField: 'state', statusMap: { good: 'normal', failed: 'offline' } };
    const original = JSON.stringify(doc);
    const def = definitionsFromTemplates(doc.templates)[node.data.kind];
    const normal = resolveNodeData(node.data, def, { 'sat-1': { stats: { load: 42.5, temp: 31 }, state: 'good' } });
    expect(normal.status).toBe('normal'); expect(normal.values.load).toBe('42.5'); expect(normal.pending).toBe(false);
    const offline = resolveNodeData(node.data, def, { 'sat-1': { stats: { load: 42.5 }, state: 'failed' } });
    expect(offline.values.load).toBe('—'); expect(offline.status).toBe('offline');
    expect(resolveNodeData(node.data, def, {}).label).toBe('等待数据');
    expect(JSON.stringify(doc)).toBe(original);
    expect(readField(Object.create({ inherited: 42 }), 'inherited')).toBeUndefined();
    expect(readField({}, '__proto__.constructor')).toBeUndefined();
  });
});
