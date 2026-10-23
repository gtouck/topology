import { describe, expect, test } from 'bun:test';
import { EditorTelemetry, formatMetricValue } from '../src/editor-telemetry';
import { metricOptions, metricDetails, metricValueHtml } from '../src/device-details';
import { builtinDevices, initialTopology } from '../src/topology';
import { createDocument, parseDocument, definitionsFromTemplates } from '../src/document';
import { renderTopologySvg } from '../src/export-svg';

describe('S01 编辑器运行数据与参数详情', () => {
  test('宿主值和状态在多个模拟周期、未暂停调用下保持不变', () => {
    const runtime = new EditorTelemetry();
    runtime.sample('server-1', builtinDevices.server, 'normal', 0, 0, false);
    expect(runtime.update(['server-1'], { cpu: 98.5 }, 'warning')).toBe(1);
    expect(runtime.mode).toBe('external');
    const original = structuredClone(runtime.values.get('server-1'));
    for (let tick = 1; tick <= 20; tick++) expect(runtime.sample('server-1', builtinDevices.server, 'normal', tick, 0, false)).toBe(false);
    expect(runtime.values.get('server-1')).toEqual(original);
    expect(runtime.statuses.get('server-1')).toBe('warning');
    // The first host update removes all simulated values, including missing metrics.
    expect(runtime.values.get('server-1')).not.toHaveProperty('memory');
  });

  test('切回模拟模式清理宿主数据；手动暂停保留当前采样', () => {
    const runtime = new EditorTelemetry();
    runtime.update(['server-1'], { cpu: 98.5 }, 'offline');
    expect(runtime.setMode('simulation')).toBe(true);
    expect(runtime.statuses.size).toBe(0);
    expect(runtime.sample('server-1', builtinDevices.server, 'normal', 0, 0, false)).toBe(true);
    const original = structuredClone(runtime.values.get('server-1'));
    expect(runtime.sample('server-1', builtinDevices.server, 'normal', 20, 0, true)).toBe(false);
    expect(runtime.values.get('server-1')).toEqual(original);
    expect(runtime.setMode('simulation')).toBe(false);
    expect(runtime.values.get('server-1')).toEqual(original);
  });

  test('无匹配设备不切换模式；不合法更新不部分覆盖已有数据', () => {
    const runtime = new EditorTelemetry();
    expect(runtime.update([], { cpu: 80 })).toBe(0);
    expect(runtime.mode).toBe('simulation');
    expect(() => runtime.update(['a'], { cpu: NaN })).toThrow('有限数值');
    expect(runtime.mode).toBe('simulation');
    runtime.update(['a'], { cpu: 80, memory: 50 }, 'normal');
    expect(() => runtime.update(['a'], { cpu: Infinity }, 'offline')).toThrow();
    expect(() => runtime.update(['a'], { cpu: 1 }, 'bad' as 'normal')).toThrow('状态');
    runtime.update(['a'], { cpu: 60 });
    expect(runtime.values.get('a')).toEqual({ cpu: 60, memory: 50 });
    expect(runtime.statuses.get('a')).toBe('normal');
  });

  test('零参数模板可解析、采样、生成详情和矢量导出', () => {
    const definitions = { plain: { ...builtinDevices.module, metrics: [] } };
    const node = initialTopology().nodes[0];
    node.data = { ...node.data, kind: 'plain', visibleMetrics: [] }; delete node.data.binding;
    const doc = parseDocument(createDocument('零参数图', 'general', { nodes: [node], edges: [] }, definitions));
    const def = definitionsFromTemplates(doc.templates).plain;
    const runtime = new EditorTelemetry();
    expect(() => runtime.sample(node.id, def, 'normal', 0, 0, false)).not.toThrow();
    expect(runtime.history.size).toBe(0);
    expect(metricOptions(node.data, def)).toContain('未配置参数');
    const html = metricDetails(def, () => { throw new Error('不应读取参数'); }, '模拟数据');
    expect(html).toContain('此节点未配置参数');
    expect(html).not.toContain('trend-line');
    expect(renderTopologySvg(doc).height).toBe(170);
  });

  test('参数名称、单位和动态值按纯文本转义，离线值隐藏单位', () => {
    const def = structuredClone(builtinDevices.server);
    def.metrics[0].label = '<img src=x onerror=alert(1)>';
    def.metrics[0].unit = '<svg onload=alert(1)>&';
    const node = initialTopology().nodes.find((n) => n.data.kind === 'server')!;
    const options = metricOptions(node.data, def);
    const details = metricDetails(def, () => '<script>', '宿主数据');
    expect(options).toContain('&lt;img');
    expect(options).not.toContain('<img');
    expect(details).not.toMatch(/<img|<svg onload|<script>/);
    expect(details).toContain('&lt;svg onload=alert(1)&gt;&amp;');
    expect(metricValueHtml('—', '<bad>')).toBe('—<small></small>');
  });

  test('缺失和非有限参数显示占位符；趋势忽略无参数、缺失或离线值并限制长度', () => {
    const metric = builtinDevices.server.metrics[0];
    for (const value of [undefined, null, NaN, Infinity, '12']) expect(formatMetricValue(value, metric)).toBe('—');
    expect(formatMetricValue(12.345, metric)).toBe('12.3');
    const runtime = new EditorTelemetry();
    runtime.update(['a'], {});
    runtime.recordHistory('a', undefined, 'normal');
    runtime.recordHistory('a', 'cpu', 'normal');
    expect(runtime.history.size).toBe(0);
    for (let n = 0; n < 40; n++) { runtime.update(['a'], { cpu: n }); runtime.recordHistory('a', 'cpu', 'normal'); }
    expect(runtime.history.get('a')).toEqual(Array.from({ length: 30 }, (_, i) => i + 10));
    runtime.recordHistory('a', 'cpu', 'offline');
    expect(runtime.history.get('a')).toHaveLength(30);
  });

  test('布局撤销时保留现有节点运行数据，切图清空数据并保持数据模式', () => {
    const runtime = new EditorTelemetry();
    runtime.update(['keep', 'removed'], { cpu: 80 }, 'normal');
    runtime.prune(new Set(['keep']));
    expect(runtime.values.has('removed')).toBe(false);
    expect(runtime.statuses.has('removed')).toBe(false);
    expect(runtime.values.get('keep')).toEqual({ cpu: 80 });
    runtime.clear();
    expect(runtime.values.size).toBe(0);
    expect(runtime.mode).toBe('external');
  });
});
