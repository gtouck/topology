import { describe, expect, test } from 'bun:test';
import { createDocument, sampleDocument, definitionsFromTemplates } from '../src/document';
import { renderTopologySvg, type ExportState } from '../src/export-svg';
import { exportTelemetry, renderTopologyHtml, scriptJson } from '../src/export-html';
import { resolveNodeData } from '../src/runtime-data';

const fixture = () => sampleDocument('ground-station');
function snapshot(doc = fixture()): ExportState {
  const definitions = definitionsFromTemplates(doc.templates);
  return Object.fromEntries(doc.topology.nodes.map((node) => [node.id, { status: node.data.status, values: Object.fromEntries(definitions[node.data.kind].metrics.map((m) => [m.key, m.base])) }]));
}

describe('图片与独立 HTML 导出', () => {
  test('SVG 包含画布外节点、所有连线和手工拐点，导出不修改文档和实时值', () => {
    const doc = fixture(), state = snapshot(doc);
    doc.topology.nodes[0].x = -900;
    doc.topology.edges[0].vertices = [{ x: -1200, y: -500 }, { x: -1200, y: 156 }];
    const before = JSON.stringify({ doc, state });
    const result = renderTopologySvg(doc, state);
    expect(result.width).toBeGreaterThan(2200);
    expect(result.height).toBeGreaterThan(1000);
    expect(result.svg.match(/data-node-id=/g)).toHaveLength(8);
    expect(result.svg.match(/data-edge-id=/g)).toHaveLength(8);
    const [left, top] = result.svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
    expect(left).toBeLessThanOrEqual(-1240); expect(top).toBe(-540);
    expect(result.svg).toContain(' C ');
    expect(result.svg).not.toMatch(/foreignObject|<image|<script|x6-port|selected|<style/);
    expect(JSON.stringify({ doc, state })).toBe(before);
  });

  test('SVG 使用传入的实际路径，保留线缆纹理、粗细和箭头', () => {
    const doc = fixture();
    const edge = doc.topology.edges[0];
    edge.appearance = { style: 'braided', width: 12, color: '#123456', arrows: true };
    const result = renderTopologySvg(doc, snapshot(doc), { [edge.id]: { path: 'M30 40L50 60', label: { x: 40, y: 50 } } });
    expect(result.svg).toContain('d="M30 40L50 60"');
    expect(result.svg).toContain('stroke-width="12"');
    expect(result.svg).toContain('stroke="url(#export-braid)"');
    expect(result.svg).toContain('fill="#123456"');
    expect(result.svg).toContain('marker-end="url(#export-arrow-0)"');
  });

  test('空参数节点保持紧凑尺寸，设备图标为真实矢量路径', () => {
    const doc = fixture();
    doc.topology.edges = [];
    doc.topology.nodes = [doc.topology.nodes[0]];
    doc.topology.nodes[0].data.visibleMetrics = [];
    const { svg, width, height } = renderTopologySvg(doc, snapshot(doc));
    expect(width).toBe(290); expect(height).toBe(170);
    expect(svg).toContain('height="90"');
    expect(svg).not.toContain('方位角');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('currentColor');
  });

  test('实时离线状态覆盖设备配置，SVG 显示占位符和离线线缆', () => {
    const doc = fixture(), state = snapshot(doc);
    state['ant-01'].status = 'offline';
    const { svg } = renderTopologySvg(doc, state);
    expect(svg).toContain('设备离线');
    expect(svg).toContain('stroke-dasharray="6 5"');
    expect(svg).toContain('>—<');
    expect(doc.topology.nodes[0].data.status).toBe('normal');
  });

  test('SVG 中名称、连线标签和 XML 控制字符不会变成标记', () => {
    const doc = fixture();
    doc.name = '图 <svg onload="alert(1)">';
    doc.topology.nodes[0].data.title = '<script>坏标题</script>\u0001';
    doc.topology.edges[0].label = 'A&B <link>';
    const { svg } = renderTopologySvg(doc);
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('\u0001');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A&amp;B &lt;link&gt;');
  });

  test('HTML 初始快照按嵌套数据绑定和状态映射恢复，原图保持不变', () => {
    const doc = fixture(), state = snapshot(doc);
    const node = doc.topology.nodes[0];
    node.data.binding = { source: 'satellite-a', fields: { azimuth: 'angle.az', elevation: 'angle.el' }, statusField: 'health.state', statusMap: { ok: 'normal', down: 'offline' } };
    state[node.id].status = 'offline';
    const original = JSON.stringify(doc);
    const exported = exportTelemetry(doc, state);
    expect(exported.data['satellite-a']).toEqual({ angle: { az: 128.6, el: 42.3 }, health: { state: 'down' } });
    const defs = definitionsFromTemplates(doc.templates);
    expect(resolveNodeData(exported.definition.topology.nodes[0].data, defs.antenna, exported.data).status).toBe('offline');
    expect(JSON.stringify(doc)).toBe(original);
  });

  test('状态映射缺少当前状态时，HTML 仍能正确显示导出时状态', () => {
    const doc = fixture(), state = snapshot(doc);
    const node = doc.topology.nodes[0];
    node.data.binding!.statusMap = { normal: 'offline' };
    const { definition, data } = exportTelemetry(doc, state);
    expect(resolveNodeData(definition.topology.nodes[0].data, definitionsFromTemplates(doc.templates).antenna, data).status).toBe('normal');
  });

  test('独立 HTML 内嵌所有资源并暴露数据 API，恶意名称不能结束 script 标签', () => {
    const doc = fixture();
    doc.name = '</script><script>window.pwned=true</script>&\u2028';
    const html = renderTopologyHtml(doc, snapshot(doc), 'window.TopologyKit = {}; /* </script> */');
    expect(html).not.toMatch(/<script\s+src=|<link\b|<iframe\b/);
    expect(html).toContain('window.topologyViewer = viewer');
    expect(html).toContain("['setData', 'updateData']");
    expect(html).toContain('topology:node-click');
    expect(html).not.toContain('<script>window.pwned');
    expect(html).toContain('<\\/script>');
    const embedded = html.match(/id="topology-document" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(embedded).name).toBe(doc.name);
    expect(JSON.parse(scriptJson(doc))).toEqual(doc);
  });

  test('空图可以导出 HTML 和 JSON，图片导出给出明确提示', () => {
    const doc = createDocument('空图');
    expect(() => renderTopologySvg(doc)).toThrow('请先添加节点');
    expect(renderTopologyHtml(doc, {}, 'window.TopologyKit = {};')).toContain('空图');
    expect(() => renderTopologyHtml(doc, {}, '')).toThrow('展示组件未生成');
  });
});
