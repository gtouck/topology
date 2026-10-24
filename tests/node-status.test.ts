import { describe, expect, test } from 'bun:test';
import { nodeStatus, nodeStatusStyles, statusGlyph } from '../src/node-status';
import { sampleDocument, parseDocument } from '../src/document';
import { renderTopologySvg, type ExportState } from '../src/export-svg';
import { exportTelemetry } from '../src/export-html';

describe('设备状态呈现与主题隔离', () => {
  test('正常、告警、离线和等待由颜色、图标与边框共同区分，等待不扩展文件枚举', () => {
    const states = [nodeStatus('normal'), nodeStatus('warning'), nodeStatus('offline'), nodeStatus('offline', true)];
    expect(new Set(states.map((s) => s.color)).size).toBe(4);
    expect(new Set(states.map((s) => s.icon)).size).toBe(4);
    expect(states.map((s) => s.tone)).toEqual(['normal', 'warning', 'offline', 'pending']);
    expect(nodeStatus('offline', true, '设备离线').label).toBe('等待数据');
    expect(nodeStatus('warning', false, '温度偏高').label).toBe('温度偏高');
    expect(nodeStatusStyles.offline.dash).not.toBe(nodeStatusStyles.pending.dash);
    const bad = sampleDocument('ground-station'); (bad.topology.nodes[0].data.status as string) = 'pending';
    expect(() => parseDocument(bad)).toThrow('状态');
  });
  test('SVG 对四种状态使用共用样式，等待与离线有不同标记，原文档不改变', () => {
    const doc = sampleDocument('ground-station'), before = structuredClone(doc);
    const nodes = doc.topology.nodes.slice(0, 4);
    const state: ExportState = Object.fromEntries(nodes.map((node, i) => [node.id, { status: (['normal', 'warning', 'offline', 'offline'] as const)[i], pending: i === 3, values: {} }]));
    const svg = renderTopologySvg(doc, state).svg;
    nodes.forEach((node, i) => {
      const tone = (['normal', 'warning', 'offline', 'pending'] as const)[i];
      expect(svg).toContain(`data-node-id="${node.id}" data-status="${tone}"`);
      expect(svg).toContain(`stroke="${nodeStatusStyles[tone].border}"`);
      expect(svg).toContain(`color="${nodeStatusStyles[tone].color}"`);
      expect(statusGlyph(tone)).toContain('<svg');
    });
    expect(svg).toContain('等待数据'); expect(svg).not.toContain('foreignObject'); expect(svg).not.toContain('--ui-');
    expect(doc).toEqual(before);
  });
  test('HTML 保留等待与真实离线的区别，不将等待写为设备配置状态', () => {
    const doc = sampleDocument('ground-station'), [pending, offline] = doc.topology.nodes;
    const state: ExportState = { [pending.id]: { status: 'offline', pending: true, values: {} }, [offline.id]: { status: 'offline', values: {} } };
    const output = exportTelemetry(doc, state);
    expect(Object.hasOwn(output.data, pending.data.binding!.source)).toBe(false);
    expect(Object.hasOwn(output.data, offline.data.binding!.source)).toBe(true);
    expect(output.definition.topology.nodes.every((node) => ['normal', 'warning', 'offline'].includes(node.data.status))).toBe(true);
  });
});
