import { describe, expect, test } from 'bun:test';
import { FreshnessTracker, parseFreshness, parseFreshnessSnapshot } from '../src/data-freshness';
import { mergeTelemetryData, parseTelemetryData, resolveNodeData } from '../src/runtime-data';
import { EditorTelemetry } from '../src/editor-telemetry';
import { builtinDevices } from '../src/topology';
import { definitionsFromTemplates, sampleDocument } from '../src/document';
import { resolveLinkState } from '../src/link-state';
import { renderTopologyHtml } from '../src/export-html';
import { renderTopologySvg, type ExportState } from '../src/export-svg';

describe('S08 接收时间与生命周期', () => {
  test('等待、精确超时和局部更新按对象独立计时', () => {
    let now = 1000; const tracker = new FreshnessTracker({ staleAfterMs: 1000 }, () => now);
    expect(tracker.state('a')).toEqual({ phase: 'waiting', receivedAt: null });
    tracker.receive(['a', 'b']); expect(tracker.nextDelay()).toBe(1000);
    now = 1999; expect(tracker.state('a').phase).toBe('fresh');
    tracker.receive(['a']); now = 2000;
    expect(tracker.state('a')).toEqual({ phase: 'fresh', receivedAt: 1999 });
    expect(tracker.state('b')).toEqual({ phase: 'stale', receivedAt: 1000 });
    expect(tracker.nextDelay()).toBe(999);
    now = 3000; expect(tracker.nextDelay()).toBeNull();
  });
  test('断开和重连不刷新旧数据，只有新消息恢复', () => {
    let now = 1000; const tracker = new FreshnessTracker({}, () => now);
    tracker.receive(['a', 'b']); tracker.setConnection('disconnected');
    expect(tracker.state('a').phase).toBe('disconnected'); expect(tracker.nextDelay()).toBeNull();
    tracker.setConnection('connected'); expect(tracker.state('a').phase).toBe('stale');
    tracker.receive(['a']); expect(tracker.state('a').phase).toBe('fresh'); expect(tracker.state('b').phase).toBe('stale');
    now++; tracker.receive(['b']); expect(tracker.state('b').receivedAt).toBe(1001);
  });
  test('设置校验原子、关闭超时不伪造接收时间，清空和裁剪正确', () => {
    let now = 1000; const tracker = new FreshnessTracker({}, () => now); tracker.receive(['a', 'b']); now += 20_000;
    expect(tracker.state('a').phase).toBe('stale');
    expect(() => tracker.configure({ staleAfterMs: -1 })).toThrow(); expect(tracker.staleAfterMs).toBe(15_000);
    tracker.configure({ staleAfterMs: 0 }); expect(tracker.state('a')).toEqual({ phase: 'fresh', receivedAt: 1000 }); expect(tracker.nextDelay()).toBeNull();
    tracker.prune(new Set(['a'])); expect(tracker.state('b').phase).toBe('waiting'); tracker.clear(); expect(tracker.state('a').phase).toBe('waiting');
    expect(() => parseFreshness({ staleAfterMs: NaN })).toThrow(); expect(() => parseFreshness({ staleAfterMs: 1.5 })).toThrow();
  });
  test('导出快照冻结有效状态，实际更新后不延续未更新快照的寿命', () => {
    let now = 1000; const tracker = new FreshnessTracker({ staleAfterMs: 100 }, () => now);
    tracker.freeze(['a', 'b'], { b: { phase: 'stale', receivedAt: 500 } }); now = 999999;
    expect(tracker.state('a')).toEqual({ phase: 'snapshot', receivedAt: null }); expect(tracker.state('b').phase).toBe('stale'); expect(tracker.nextDelay()).toBeNull();
    tracker.receive(['a']); expect(tracker.state('a').phase).toBe('fresh'); expect(tracker.state('b').phase).toBe('waiting');
    expect(() => parseFreshnessSnapshot({ a: { phase: 'fresh', receivedAt: 'now' } })).toThrow();
  });
  test('空更新不改变接收时间，特殊业务源键不读取对象原型', () => {
    const tracker = new FreshnessTracker();
    tracker.freeze(['constructor', '__proto__']); tracker.receive([]);
    expect(tracker.state('constructor')).toEqual({ phase: 'snapshot', receivedAt: null });
    expect(tracker.state('__proto__')).toEqual({ phase: 'snapshot', receivedAt: null });
    tracker.receive([], true); expect(tracker.state('constructor').phase).toBe('waiting');
  });
  test('原始数据批量校验和合并整体拒绝非法记录，特殊源键不污染原型', () => {
    const current = { a: { status: 'normal', cpu: 10 } }, before = structuredClone(current);
    expect(() => mergeTelemetryData(current, { a: { cpu: 90 }, b: null })).toThrow(); expect(current).toEqual(before);
    expect(() => parseTelemetryData([])).toThrow(); expect(() => mergeTelemetryData(current, null)).toThrow();
    const next = mergeTelemetryData(current, JSON.parse('{"__proto__":{"cpu":12},"a":{"cpu":30}}'));
    expect(Object.hasOwn(next, '__proto__')).toBe(true); expect(next.a).toEqual({ status: 'normal', cpu: 30 });
    expect(({} as { cpu?: number }).cpu).toBeUndefined();
  });
  test('等待、过期、业务告警与离线分别呈现，过期不推定端点真实离线', () => {
    const doc = sampleDocument('ground-station'), node = doc.topology.nodes[0], definition = definitionsFromTemplates(doc.templates)[node.data.kind];
    const telemetry = { [node.data.binding!.source]: { status: 'warning', azimuth: 22.2 } };
    const fresh = resolveNodeData(node.data, definition, telemetry, { phase: 'fresh', receivedAt: 1000 });
    expect(fresh.status).toBe('warning'); expect(fresh.values.azimuth).toBe('22.2');
    const stale = resolveNodeData(node.data, definition, telemetry, { phase: 'stale', receivedAt: 1000 });
    expect(stale.pending).toBe(false); expect(stale.label).toBe('数据已过期'); expect(stale.values.azimuth).toBe('—');
    expect(resolveLinkState({}, [{ status: 'offline', stale: true }], { status: 'up' }, true).status).toBe('unknown');
    expect(resolveLinkState({}, [{ status: 'offline' }], { status: 'up' }, true).status).toBe('down');
    expect(resolveLinkState({}, [], { status: 'up' }, true, 'stale').active).toBe(false);
    expect(resolveNodeData(node.data, definition, telemetry, { phase: 'disconnected', receivedAt: 1000 }).label).toBe('数据连接中断');
  });
  test('编辑器空或非法更新不刷新接收时间，不影响已有运行值和模式', () => {
    const runtime = new EditorTelemetry(); expect(runtime.update(['a'], {})).toBe(0); expect(runtime.mode).toBe('simulation');
    runtime.update(['a'], { cpu: 10 }, 'normal'); const receipt = runtime.freshness.state('a');
    expect(() => runtime.update(['a'], { cpu: NaN })).toThrow(); expect(runtime.update(['a'], {})).toBe(0);
    expect(runtime.freshness.state('a')).toEqual(receipt); expect(runtime.values.get('a')).toEqual({ cpu: 10 });
    runtime.freshness.setConnection('disconnected'); runtime.freshness.setConnection('connected'); expect(runtime.freshness.state('a').phase).toBe('stale');
    runtime.update(['a'], {}, 'offline'); expect(runtime.freshness.state('a').phase).toBe('fresh');
    expect(runtime.sample('a', builtinDevices.server, 'normal', 100, 0, false)).toBe(false);
    runtime.clear(); expect(runtime.freshness.state('a').phase).toBe('waiting');
  });
  test('SVG 与 HTML 保留过期快照，接收元数据不写入定义', () => {
    const doc = sampleDocument('ground-station'), before = structuredClone(doc), id = doc.topology.nodes[0].id;
    const state: ExportState = { [id]: { status: 'normal', values: { azimuth: 99.9 }, freshness: 'stale', receivedAt: 1000 } };
    const svg = renderTopologySvg(doc, state).svg;
    expect(svg).toContain(`data-node-id="${id}" data-status="stale"`); expect(svg).toContain('数据已过期'); expect(svg).not.toContain('99.9');
    const html = renderTopologyHtml(doc, state, '/* viewer */');
    const json = JSON.parse(html.match(/id="topology-receive-state" type="application\/json">([^<]+)</)![1]);
    expect(json.nodes[id]).toEqual({ phase: 'stale', receivedAt: 1000 }); expect(html).toContain('snapshot: true');
    const links = JSON.parse(html.match(/id="topology-link-data" type="application\/json">([^<]+)</)![1]);
    expect(links['link-rx-rf']).toEqual({ status: 'unknown' });
    expect(doc).toEqual(before); expect(JSON.stringify(doc)).not.toContain('receivedAt');
  });
});
