import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sampleDocument, parseDocument } from '../src/document';
import { resolveLinkState, parseLinkData, mergeLinkData, parseLinkFlow, parseLinkStatus, defaultLinkFlow } from '../src/link-state';
import { cableAppearance, cableAttributes, cableFlowAttributes, type CableStyle } from '../src/cables';
import { copySelection, pasteSelection } from '../src/editor-commands';
import { renderTopologySvg } from '../src/export-svg';
import { renderTopologyHtml } from '../src/export-html';
import { documentThumbnail } from '../src/library-presentation';

describe('链路独立状态与流转', () => {
  test('旧图不注入默认字段，v1/v2/v3 读取后保持已有布局和有效配置', () => {
    const doc = sampleDocument('ground-station');
    expect(parseDocument(doc)).toEqual(doc);
    expect(doc.topology.edges.every(edge => edge.status === undefined && edge.flow === undefined)).toBe(true);
    const configured = structuredClone(doc);
    configured.topology.edges[0].status = 'down';
    configured.topology.edges[0].flow = { enabled: true, direction: 'both', speed: 'slow' };
    expect(parseDocument(configured)).toEqual(configured);
    expect(parseDocument({ ...configured, version: 2 }).topology.edges).toEqual(configured.topology.edges);
    const migrated = parseDocument({ version: 1, name: '旧图', savedAt: doc.updatedAt, topology: configured.topology });
    expect(migrated.topology.edges).toEqual(configured.topology.edges);
    expect(migrated.topology.nodes.map(n => [n.id, n.x, n.y])).toEqual(doc.topology.nodes.map(n => [n.id, n.x, n.y]));
  });
  test('实际端点离线优先，宿主状态独立，等待与明确断开可区分', () => {
    const healthy = [{ status: 'normal' as const }, { status: 'warning' as const }];
    expect(resolveLinkState({}, healthy).status).toBe('up');
    expect(resolveLinkState({ status: 'down' }, healthy).status).toBe('down');
    expect(resolveLinkState({}, healthy, undefined, true)).toMatchObject({ status: 'unknown', active: false, reason: 'waiting' });
    expect(resolveLinkState({}, healthy, { status: 'down' }, true).status).toBe('down');
    expect(resolveLinkState({ status: 'down' }, healthy, { status: 'up' }, true)).toMatchObject({ status: 'up', active: true });
    expect(resolveLinkState({}, [{ status: 'offline', pending: true }], { status: 'up' }, true).status).toBe('up');
    expect(resolveLinkState({}, [{ status: 'offline' }], { status: 'up' }, true)).toMatchObject({ status: 'down', active: false, reason: 'endpoint' });
    expect(resolveLinkState({}, healthy, { status: 'up', active: false }, true)).toMatchObject({ status: 'up', active: false });
  });
  test('非法状态、流向、速度、活动值整体拒绝，输入对象不变', () => {
    for (const value of ['normal', 'offline', 'UP', null, {}, 1, '__proto__']) expect(() => parseLinkStatus(value)).toThrow();
    for (const value of [null, [], {}, { ...defaultLinkFlow, enabled: 1 }, { ...defaultLinkFlow, direction: 'left' }, { ...defaultLinkFlow, speed: 3 }]) expect(() => parseLinkFlow(value)).toThrow();
    const current = parseLinkData({ a: { status: 'up', active: true }, b: { status: 'down' } }), before = structuredClone(current);
    expect(() => mergeLinkData(current, { a: { status: 'down' }, b: { status: 'invalid' } })).toThrow();
    expect(() => mergeLinkData(current, { a: { active: 'false' } })).toThrow();
    expect(() => parseLinkData({ a: { status: 'up' }, b: null })).toThrow();
    expect(current).toEqual(before);
    const next = mergeLinkData(current, { a: { active: false }, c: { active: true } });
    expect(next.a).toEqual({ status: 'up', active: false }); expect(next.c).toEqual({ status: 'unknown', active: true });
    next.a.active = true; expect(current).toEqual(before);
    const input = { ...sampleDocument('ground-station') };
    input.topology.edges[0].flow = { ...defaultLinkFlow, speed: 'broken' as never };
    expect(() => parseDocument(input)).toThrow('流转');
  });
  test('原型键作为运行索引时不会污染对象，运行数据与文件隔离', () => {
    const raw = JSON.parse('{"__proto__":{"status":"up"},"constructor":{"status":"down"}}');
    const data = parseLinkData(raw), updated = mergeLinkData(data, JSON.parse('{"__proto__":{"active":false}}'));
    expect(Object.hasOwn(updated, '__proto__')).toBe(true);
    expect(updated['__proto__']).toEqual({ status: 'up', active: false });
    expect(({} as Record<string, unknown>).status).toBeUndefined();
    expect(Object.getPrototypeOf(updated)).toBe(Object.prototype);
  });
  test('复制只携带初始状态与流转设置，重建链路 ID，原始路径不变', () => {
    const doc = sampleDocument('ground-station'), edge = doc.topology.edges[0];
    edge.status = 'unknown'; edge.flow = { enabled: false, direction: 'reverse', speed: 'fast' };
    const before = structuredClone(doc);
    const clip = copySelection(doc, new Set([edge.source.cell, edge.target.cell]));
    const pasted = pasteSelection(doc, clip, { x: 30, y: 40 });
    const copy = pasted.document.topology.edges.at(-1)!;
    expect(copy.id).not.toBe(edge.id); expect(copy.status).toBe('unknown'); expect(copy.flow).toEqual(edge.flow);
    expect(copy.vertices).toEqual(edge.vertices.map(p => ({ x: p.x + 30, y: p.y + 40 })));
    expect(doc).toEqual(before);
  });
  test('各材质使用独立高光，速度与周期对应，基础线缆不发生移动', () => {
    for (const style of ['solid', 'dashed', 'double', 'jacket', 'braided'] as CableStyle[]) {
      const appearance = { style, width: 8, color: '#327c9a', arrows: true };
      const original = structuredClone(appearance), normal = cableFlowAttributes(appearance);
      expect(normal.attrs.flowForward.strokeDasharray).toContain(' ');
      expect(cableFlowAttributes(appearance, 'slow').duration).toBe(normal.duration * 2);
      expect(cableFlowAttributes(appearance, 'fast').duration).toBe(normal.duration / 2);
      expect(cableAttributes(appearance, true).line.strokeDasharray).toBe('6 5');
      expect(cableAttributes(appearance, false, 'braid', true).line.stroke).not.toBe(cableAttributes(appearance).line.stroke);
      expect(appearance).toEqual(original);
    }
  });
  test('SVG 静态状态与 HTML 动态快照保留，运行状态不覆盖定义', () => {
    const doc = sampleDocument('ground-station'); const edge = doc.topology.edges[0];
    edge.flow = { enabled: true, direction: 'both', speed: 'fast' };
    const data = { [edge.id]: { status: 'down' as const } }, before = structuredClone(doc);
    const svg = renderTopologySvg(doc, {}, {}, data).svg;
    expect(svg).toContain(`data-edge-id="${edge.id}" data-link-status="down"`);
    expect(svg).toContain('stroke-dasharray="6 5"'); expect(svg).not.toMatch(/<animate|@keyframes|cable-flow/);
    const html = renderTopologyHtml(doc, {}, 'window.TopologyKit={};', data);
    const embedded = html.match(/id="topology-link-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(embedded)).toEqual(data);
    const definition = html.match(/id="topology-document" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(definition).topology.edges[0].flow).toEqual(edge.flow);
    expect(JSON.parse(definition).topology.edges[0].status).toBeUndefined(); expect(doc).toEqual(before);
    expect(documentThumbnail(doc)).toContain(`data-thumbnail-edge="${edge.id}" data-link-status="up"`);
    const configured = structuredClone(doc); configured.topology.edges[0].status = 'down';
    expect(documentThumbnail(configured)).toContain(`data-thumbnail-edge="${edge.id}" data-link-status="down"`);
  });
  test('v3 Schema 与组件类型同步，旧 Schema 不追加新字段', () => {
    const schema = JSON.parse(readFileSync('schema/topology-v3.schema.json', 'utf8'));
    expect(schema.$defs.edge.properties.status.enum).toEqual(['up', 'down', 'unknown']);
    expect(schema.$defs.linkFlow.required).toEqual(['enabled', 'direction', 'speed']);
    expect(JSON.parse(readFileSync('schema/topology-v2.schema.json', 'utf8')).$defs.edge.properties.flow).toBeUndefined();
    expect(readFileSync('src/viewer-index.ts', 'utf8')).toContain('LinkTelemetryData');
  });
});
