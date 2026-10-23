import { describe, expect, test } from 'bun:test';
import { sampleDocument, parseDocument, definitionsFromTemplates } from '../src/document';
import { deviceGeometry, parseTopologyFile } from '../src/topology';
import { alignNodes, distributeNodes, alignmentLabels, MAX_LAYOUT_GAP, type Alignment } from '../src/layout-commands';
import { positionNodes, moveSelection, setPositionLocks, copySelection, pasteSelection, deleteSelection } from '../src/editor-commands';
import { renderTopologySvg } from '../src/export-svg';
import { renderTopologyHtml } from '../src/export-html';
import { WorkspaceStore } from '../src/workspace';

function fixture() {
  const doc = sampleDocument('ground-station');
  doc.topology.nodes = doc.topology.nodes.slice(0, 3); doc.topology.edges = [];
  const [a, b, c] = doc.topology.nodes;
  a.x = 10; a.y = 20; a.data.visibleMetrics = [];
  b.x = 360; b.y = 250; b.data.visibleMetrics = b.data.visibleMetrics.slice(0, 1);
  c.x = 800; c.y = 700;
  c.data.ports = Array.from({ length: 12 }, (_, i) => ({ id: `p-${i}`, label: `P${i}`, kind: 'ethernet' as const, side: 'top' as const }));
  c.data.portSpacing = 24;
  return doc;
}
const ids = (doc: ReturnType<typeof fixture>) => new Set(doc.topology.nodes.map((node) => node.id));

describe('S04 对齐、分布及位置锁定', () => {
  test('六种对齐使用实际尺寸，保持另一坐标轴和原文档不变', () => {
    const doc = fixture(), before = structuredClone(doc), definitions = definitionsFromTemplates(doc.templates);
    const sizes = doc.topology.nodes.map((node) => deviceGeometry(node.data, definitions));
    expect(sizes.map(({ width, height }) => [width, height])).toEqual([[210, 90], [210, 116], [312, 160]]);
    for (const mode of Object.keys(alignmentLabels) as Alignment[]) {
      const result = alignNodes(doc, ids(doc), mode), nodes = result.document.topology.nodes;
      nodes.forEach((node, i) => {
        if (mode === 'left') expect(node.x).toBe(10);
        if (mode === 'center-x') expect(node.x + sizes[i].width / 2).toBe(561);
        if (mode === 'right') expect(node.x + sizes[i].width).toBe(1112);
        if (mode === 'top') expect(node.y).toBe(20);
        if (mode === 'center-y') expect(node.y + sizes[i].height / 2).toBe(440);
        if (mode === 'bottom') expect(node.y + sizes[i].height).toBe(860);
        if (['left', 'center-x', 'right'].includes(mode)) expect(node.y).toBe(doc.topology.nodes[i].y);
        else expect(node.x).toBe(doc.topology.nodes[i].x);
      });
      expect(result.skipped).toBe(0); expect(result.moved).toBeGreaterThanOrEqual(2);
    }
    expect(doc).toEqual(before);
  });

  test('锁定节点作为对齐参照，选择顺序决定首个参照', () => {
    const doc = fixture(), [a, b, c] = doc.topology.nodes;
    b.data.locked = true;
    const result = alignNodes(doc, ids(doc), 'right');
    expect(result.document.topology.nodes.map((node) => node.x)).toEqual([360, 360, 258]);
    expect(result.document.topology.nodes[1]).toEqual(b); expect(result.skipped).toBe(1);
    c.data.locked = true;
    const ordered = alignNodes(doc, new Set([c.id, b.id, a.id]), 'left');
    expect(ordered.document.topology.nodes[0].x).toBe(800);
    expect(ordered.document.topology.nodes[1].x).toBe(360);
    expect(ordered.document.topology.nodes[2].x).toBe(800);
    expect(ordered.skipped).toBe(2);
  });

  test('水平和垂直等距分布按空隙计算，固定两端且不改变另一轴', () => {
    const doc = fixture();
    const horizontal = distributeNodes(doc, ids(doc), 'horizontal');
    expect(horizontal.document.topology.nodes.map((node) => node.x)).toEqual([10, 405, 800]);
    expect(horizontal.document.topology.nodes.map((node) => node.y)).toEqual([20, 250, 700]);
    const vertical = distributeNodes(doc, ids(doc), 'vertical');
    expect(vertical.document.topology.nodes.map((node) => node.y)).toEqual([20, 347, 700]);
    expect(vertical.document.topology.nodes.map((node) => node.x)).toEqual([10, 360, 800]);
    expect(horizontal.moved).toBe(1); expect(vertical.moved).toBe(1);
  });

  test('指定间距支持零和小数，按空间顺序而非选择顺序排布', () => {
    const doc = fixture(), selected = new Set([...ids(doc)].reverse());
    expect(distributeNodes(doc, selected, 'horizontal', 0).document.topology.nodes.map((node) => node.x)).toEqual([10, 220, 430]);
    expect(distributeNodes(doc, selected, 'horizontal', 12.5).document.topology.nodes.map((node) => node.x)).toEqual([10, 232.5, 455]);
    expect(distributeNodes(doc, selected, 'vertical', 24).document.topology.nodes.map((node) => node.y)).toEqual([20, 134, 274]);
  });

  test('分布只处理未锁定节点并报告跳过数量', () => {
    const doc = fixture(); doc.topology.nodes[1].data.locked = true;
    const result = distributeNodes(doc, ids(doc), 'horizontal', 24);
    expect(result.document.topology.nodes.map((node) => node.x)).toEqual([10, 360, 244]);
    expect(result.skipped).toBe(1);
    expect(() => distributeNodes(doc, ids(doc), 'horizontal')).toThrow('3 个未锁定');
  });

  test('空间不足、数量不足和无效参数会拒绝整次布局', () => {
    const doc = fixture(), before = structuredClone(doc);
    for (const gap of [-1, NaN, Infinity, MAX_LAYOUT_GAP + 1]) expect(() => distributeNodes(doc, ids(doc), 'horizontal', gap)).toThrow('间距');
    expect(() => alignNodes(doc, new Set([doc.topology.nodes[0].id]), 'left')).toThrow('两个');
    expect(() => alignNodes(doc, ids(doc), 'bad' as Alignment)).toThrow('不合法');
    const locked = setPositionLocks(doc, ids(doc), true);
    expect(() => alignNodes(locked, ids(locked), 'left')).toThrow('均已锁定');
    expect(() => distributeNodes(doc, new Set([doc.topology.nodes[0].id]), 'vertical', 12)).toThrow('2 个未锁定');
    expect(doc).toEqual(before);
    doc.topology.nodes.forEach((node, i) => { node.x = i * 20; });
    expect(() => distributeNodes(doc, ids(doc), 'horizontal')).toThrow('空间不足');
  });

  test('指定间距超出坐标范围时拒绝而不部分移动', () => {
    const doc = fixture(); doc.topology.nodes.forEach((node, i) => { node.x = 99000 + i * 200; });
    const before = structuredClone(doc);
    expect(() => distributeNodes(doc, ids(doc), 'horizontal', 1000)).toThrow('范围');
    expect(doc).toEqual(before);
  });

  test('位置锁定覆盖方向键式移动，锁定端点的连线拐点保持原位', () => {
    const doc = sampleDocument('ground-station'), selected = new Set(['ant-01', 'lnb-01']);
    doc.topology.nodes[1].data.locked = true;
    const moved = moveSelection(doc.topology, selected, { x: 40, y: 20 });
    expect(moved.nodes[0].x).toBe(doc.topology.nodes[0].x + 40);
    expect(moved.nodes[1]).toEqual(doc.topology.nodes[1]);
    expect(moved.edges[0].vertices).toEqual(doc.topology.edges[0].vertices);
  });

  test('相同位移平移内部拐点，不同位移和边界连线保留手工拐点', () => {
    const doc = sampleDocument('ground-station'), [a, b] = doc.topology.nodes;
    const same = positionNodes(doc.topology, new Map([[a.id, { x: a.x + 10, y: a.y + 20 }], [b.id, { x: b.x + 10, y: b.y + 20 }]]));
    expect(same.edges[0].vertices).toEqual(doc.topology.edges[0].vertices.map((point) => ({ x: point.x + 10, y: point.y + 20 })));
    expect(same.edges[3].vertices).toEqual(doc.topology.edges[3].vertices);
    const different = positionNodes(doc.topology, new Map([[a.id, { x: a.x + 10, y: a.y + 20 }], [b.id, { x: b.x + 30, y: b.y + 50 }]]));
    expect(different.edges[0].vertices).toEqual(doc.topology.edges[0].vertices);
  });

  test('批量删除保护锁定节点，但显式选线和删除另一端仍清理连接', () => {
    const doc = sampleDocument('ground-station'); doc.topology.nodes[0].data.locked = true;
    const onlyLocked = deleteSelection(doc, new Set(['ant-01']));
    expect(onlyLocked).toEqual(doc);
    const mixed = deleteSelection(doc, new Set(['ant-01', 'lnb-01']));
    expect(mixed.topology.nodes.some((node) => node.id === 'ant-01')).toBe(true);
    expect(mixed.topology.nodes.some((node) => node.id === 'lnb-01')).toBe(false);
    expect(mixed.topology.edges.some((edge) => edge.id === 'link-rx-rf')).toBe(false);
    expect(mixed.topology.edges.some((edge) => edge.id === 'link-tx-rf')).toBe(true);
    expect(deleteSelection(doc, new Set(['ant-01', 'link-tx-rf'])).topology.edges.some((edge) => edge.id === 'link-tx-rf')).toBe(false);
  });

  test('锁定可解除，副本始终解锁且不改变源节点', () => {
    const doc = sampleDocument('ground-station'), selected = new Set(['ant-01']);
    const locked = setPositionLocks(doc, selected, true);
    expect(locked.topology.nodes[0].data.locked).toBe(true);
    expect(doc.topology.nodes[0].data).not.toHaveProperty('locked');
    expect(setPositionLocks(locked, selected, false).topology.nodes[0].data).not.toHaveProperty('locked');
    const result = pasteSelection(locked, copySelection(locked, selected)!);
    expect(result.document.topology.nodes.at(-1)!.data).not.toHaveProperty('locked');
    expect(result.document.topology.nodes.at(-1)!.x).toBe(locked.topology.nodes[0].x + 40);
    expect(locked.topology.nodes[0].data.locked).toBe(true);
  });

  test('通用和旧文件往返保留布尔锁定字段，旧数据不注入默认值', () => {
    const doc = sampleDocument('ground-station');
    expect(parseDocument(doc)).toEqual(doc);
    doc.topology.nodes[0].data.locked = true; doc.topology.nodes[1].data.locked = false;
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const legacy = { version: 1, name: '旧文件', savedAt: '', topology: doc.topology };
    expect(parseTopologyFile(legacy).topology).toEqual(doc.topology);
    for (const value of [0, 1, 'true', null, []]) {
      const bad = structuredClone(doc); Object.assign(bad.topology.nodes[0].data, { locked: value });
      expect(() => parseDocument(bad)).toThrow('锁定');
    }
  });

  test('Schema 包含可选锁定字段，SVG/HTML 保留展示效果和文档', async () => {
    const schema = await Bun.file(new URL('../schema/topology-v2.schema.json', import.meta.url)).json();
    expect(schema.$defs.nodeData.properties.locked.type).toBe('boolean');
    expect(schema.$defs.nodeData.required).not.toContain('locked');
    const doc = sampleDocument('ground-station'), before = renderTopologySvg(doc).svg;
    doc.topology.nodes[0].data.locked = true;
    expect(renderTopologySvg(doc).svg).toBe(before);
    const html = renderTopologyHtml(doc, {}, 'window.TopologyKit = {};');
    const payload = html.match(/id="topology-document" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(payload).topology.nodes[0].data.locked).toBe(true);
  });

  test('锁定状态通过自动草稿、手动保存和历史恢复持久化', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = new WorkspaceStore(storage), original = store.snapshot().documents[0];
    const locked = setPositionLocks(original, new Set([original.topology.nodes[0].id]), true);
    store.saveDraft(locked);
    expect(new WorkspaceStore(storage).document(original.id).draft!.document.topology.nodes[0].data.locked).toBe(true);
    store.saveDocument(locked);
    const previous = store.history(original.id).find((entry) => !entry.document.topology.nodes[0].data.locked)!;
    store.restoreDraft(original.id, previous.id, locked);
    const recovered = new WorkspaceStore(storage).document(original.id);
    expect(recovered.saved.topology.nodes[0].data.locked).toBe(true);
    expect(recovered.draft!.document.topology.nodes[0].data).not.toHaveProperty('locked');
  });
});
