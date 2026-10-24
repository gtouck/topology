import { describe, expect, test } from 'bun:test';
import { sampleDocument, parseDocument } from '../src/document';
import { addDiagramElement, fitRegion } from '../src/diagram-commands';
import { drawingOrder, setGroupMembers, reorder } from '../src/diagram';
import { copySelection, pasteSelection, moveSelection, deleteSelection, setPositionLocks } from '../src/editor-commands';
import { alignNodes } from '../src/layout-commands';
import { renderTopologySvg } from '../src/export-svg';
import { renderTopologyHtml } from '../src/export-html';
import { documentThumbnail } from '../src/library-presentation';
import { documentSignature, WorkspaceStore } from '../src/workspace';
import { LIBRARY_KEY } from '../src/library';

const grouped = () => {
  const doc = sampleDocument('ground-station');
  return addDiagramElement(doc, 'group', new Set(['ant-01', 'lnb-01']), { x: 0, y: 0 });
};
function oldFingerprint(document: unknown) {
  // Use exactly the legacy signature order, independent of the new migration.
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, val]) => [k, sort(val)])) : v;
  const { updatedAt: _, ...content } = document as Record<string, unknown>;
  const text = JSON.stringify(sort(content)); let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 2246822519); }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

describe('S06 分组、注释、图例与 v3 文件', () => {
  test('v2 迁移保留 ID、锁定、模板、时间及全部手工布局，v3 往返完整', () => {
    const source = sampleDocument('ground-station'); source.topology.nodes[0].data.locked = true;
    const old = { ...source, version: 2 };
    const original = structuredClone(old), migrated = parseDocument(old);
    expect(migrated.version).toBe(3); expect(migrated.topology).toEqual(source.topology);
    expect(migrated.id).toBe(source.id); expect(migrated.templates).toEqual(source.templates); expect(old).toEqual(original);
    const withGroup = grouped().document;
    expect(parseDocument(JSON.parse(JSON.stringify(withGroup)))).toEqual(withGroup);
  });
  test('旧库草稿基准只在原本有效时迁移，历史也升级且读取不覆盖原存档', () => {
    const saved = { ...sampleDocument('ground-station'), version: 2 };
    const draft = structuredClone(saved); draft.topology.nodes[0].data.title = '旧版有效草稿';
    const raw = { version: 1, activeId: saved.id, documents: [saved], editing: { version: 1, revision: 1, drafts: [{ document: draft, base: oldFingerprint(saved), savedAt: saved.updatedAt, checkpointAt: saved.updatedAt }], history: [{ id: 'history-1', document: saved, reason: 'manual', savedAt: saved.updatedAt }] } };
    const data = new Map([[LIBRARY_KEY, JSON.stringify(raw)]]), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    const before = data.get(LIBRARY_KEY), store = new WorkspaceStore(storage);
    expect(store.document(saved.id).stale).toBe(false);
    expect(store.document(saved.id).draft!.document.version).toBe(3);
    expect(store.document(saved.id).draft!.document.topology.nodes[0].data.title).toBe('旧版有效草稿');
    expect(store.history(saved.id)[0].document.version).toBe(3);
    expect(data.get(LIBRARY_KEY)).toBe(before);
    store.saveDraft(store.document(saved.id).draft!.document);
    expect(new WorkspaceStore(storage).document(saved.id).stale).toBe(false);
    expect(JSON.parse(data.get(LIBRARY_KEY)!).documents[0].version).toBe(3);
    raw.editing.drafts[0].base = 'stale-base'; data.set(LIBRARY_KEY, JSON.stringify(raw));
    expect(new WorkspaceStore(storage).document(saved.id).stale).toBe(true);
  });
  test('创建分组不移动节点，适应边界只改容器，成员归属不靠空间判断', () => {
    const { document, id } = grouped(), before = structuredClone(document.topology.nodes);
    expect(document.topology.elements![0]).toMatchObject({ kind: 'group', members: ['ant-01', 'lnb-01'] });
    expect(document.topology.nodes).toEqual(before);
    document.topology.nodes[0].x -= 300;
    const fitted = fitRegion(document, id);
    expect(fitted.topology.nodes).toEqual(document.topology.nodes);
    expect(fitted.topology.elements![0].x).toBe(document.topology.nodes[0].x - 28);
    expect(fitted.topology.elements![0].width).toBeGreaterThan(document.topology.elements![0].width);
    const empty = setGroupMembers(fitted.topology, id, []);
    expect(empty.nodes).toEqual(fitted.topology.nodes);
  });
  test('整组位移及显式多选去重，内部拐点移动，对外拐点原位', () => {
    const { document, id } = grouped(), before = structuredClone(document.topology);
    const moved = moveSelection(before, new Set([id, 'ant-01']), { x: 20, y: 30 });
    expect(moved.nodes.find((n) => n.id === 'ant-01')!.x).toBe(before.nodes[0].x + 20);
    expect(moved.nodes.find((n) => n.id === 'lnb-01')!.y).toBe(before.nodes[1].y + 30);
    expect(moved.elements![0].x).toBe(before.elements![0].x + 20);
    const internal = before.edges.find((e) => e.source.cell === 'ant-01' && e.target.cell === 'lnb-01')!;
    expect(moved.edges.find((e) => e.id === internal.id)!.vertices).toEqual(internal.vertices.map((p) => ({ x: p.x + 20, y: p.y + 30 })));
    const boundary = before.edges.find((e) => e.source.cell === 'lnb-01' && e.target.cell !== 'ant-01')!;
    expect(moved.edges.find((e) => e.id === boundary.id)!.vertices).toEqual(boundary.vertices);
    expect(document.topology).toEqual(before);
  });
  test('成员锁定阻止整组移动，区域锁定保护成员的布局和批量删除', () => {
    const { document, id } = grouped();
    document.topology.nodes[0].data.locked = true;
    expect(moveSelection(document.topology, new Set([id]), { x: 10, y: 0 })).toEqual(document.topology);
    delete document.topology.nodes[0].data.locked;
    const locked = setPositionLocks(document, new Set([id]), true);
    expect(moveSelection(locked.topology, new Set(['ant-01']), { x: 10, y: 0 })).toEqual(locked.topology);
    expect(deleteSelection(locked, new Set(['ant-01', id]))).toEqual(locked);
    const aligned = alignNodes(locked, new Set(['ant-01', 'hpa-01']), 'left');
    expect(aligned.document.topology.nodes.find((n) => n.id === 'hpa-01')!.x).toBe(locked.topology.nodes[0].x);
  });
  test('解散保留节点与连接，删除成员清理引用，重复成员及悬空引用被拒绝', () => {
    const { document, id } = grouped();
    const dissolved = deleteSelection(document, new Set([id]));
    expect(dissolved.topology.nodes).toEqual(document.topology.nodes); expect(dissolved.topology.edges).toEqual(document.topology.edges);
    const deleted = deleteSelection(document, new Set(['ant-01']));
    expect(deleted.topology.elements![0]).toMatchObject({ members: ['lnb-01'] });
    const bad = structuredClone(document); (bad.topology.elements![0] as any).members.push('missing');
    expect(() => parseDocument(bad)).toThrow('成员');
    expect(() => addDiagramElement(document, 'group', new Set(['ant-01']), { x: 0, y: 0 })).toThrow('已有分组');
  });
  test('分组复制重建成员及内部连接，跨图携带模板，副本解锁不关联原组', () => {
    const { document, id } = grouped();
    const source = setPositionLocks(document, new Set([id, 'ant-01']), true), clipboard = copySelection(source, new Set([id]))!;
    expect(clipboard.nodes).toHaveLength(2); expect(clipboard.elements).toHaveLength(1);
    const pasted = pasteSelection(sampleDocument('general'), clipboard);
    expect(pasted.document.topology.nodes).toHaveLength(2);
    const group = pasted.document.topology.elements![0];
    expect(group.kind).toBe('group'); if (group.kind !== 'group') throw new Error();
    expect(group.members).toEqual(pasted.document.topology.nodes.map((n) => n.id)); expect(group.locked).toBeUndefined();
    expect(pasted.document.topology.nodes.every((n) => !n.data.locked)).toBe(true);
    expect(group.id).not.toBe(id); expect(pasted.document.topology.nodes[0].x).toBe(source.topology.nodes[0].x + 40);
    expect(parseDocument(pasted.document)).toEqual(pasted.document);
  });
  test('纯注释复制、图面上限及越界操作均不部分修改原文档', () => {
    const note = addDiagramElement(sampleDocument('general'), 'note', new Set(), { x: 99000, y: 0 });
    const clipboard = copySelection(note.document, new Set([note.id]))!;
    const pasted = pasteSelection(note.document, clipboard);
    expect(pasted.document.topology.elements).toHaveLength(2); expect(pasted.document.topology.nodes).toHaveLength(0);
    expect(() => pasteSelection(note.document, clipboard, { x: 2000, y: 0 })).toThrow('坐标');
    expect(note.document.topology.elements).toHaveLength(1);
    const over = structuredClone(note.document); over.topology.elements = Array.from({ length: 101 }, (_, i) => ({ ...over.topology.elements![0], id: `note-${i}` }));
    expect(() => parseDocument(over)).toThrow('100');
  });
  test('非法尺寸、字号、图面类型及层次 ID 被拒绝，不接受嵌套分组', () => {
    const { document, id } = grouped();
    for (const patch of [{ width: 1 }, { height: Infinity }, { color: 'url(x)' }, { id: 'ant-01' }, { kind: 'script' }, { members: [id] }]) {
      const bad = structuredClone(document); Object.assign(bad.topology.elements![0], patch); expect(() => parseDocument(bad)).toThrow();
    }
    const bad = structuredClone(document); bad.topology.order = ['missing']; expect(() => parseDocument(bad)).toThrow('层次');
    const note = addDiagramElement(sampleDocument('general'), 'note', new Set(), { x: 0, y: 0 });
    Object.assign(note.document.topology.elements![0], { fontSize: 99 }); expect(() => parseDocument(note.document)).toThrow('字号');
  });
  test('层次和图面在 SVG、HTML、缩略图一致，说明文字转义且无需业务节点', () => {
    let { document, id } = grouped();
    const note = addDiagramElement(document, 'note', new Set(), { x: -600, y: -400 }); document = note.document;
    Object.assign(document.topology.elements!.at(-1)!, { text: '<script>alert(1)</script>\n第二行', width: 330 });
    const legend = addDiagramElement(document, 'legend', new Set(), { x: 1200, y: 0 }); document = legend.document;
    const before = documentSignature(document), svg = renderTopologySvg(document).svg;
    expect(svg.indexOf(`data-element-id="${id}"`)).toBeLessThan(svg.indexOf('data-edge-id='));
    expect(svg).toContain('&lt;script&gt;'); expect(svg).not.toContain('<script>');
    expect(svg).toContain('第二行'); expect(svg).toContain('链路图例');
    expect(svg).not.toContain('foreignObject');
    expect(documentThumbnail(document)).toContain(`data-thumbnail-element="${note.id}"`);
    expect(renderTopologyHtml(document, {}, 'window.runtime=1')).toContain('"version":3');
    const back = reorder(document.topology, new Set([note.id]), false); expect(drawingOrder(back)[0]).toBe(note.id);
    expect(documentSignature(document)).toBe(before);
    const only = addDiagramElement(sampleDocument('general'), 'note', new Set(), { x: 0, y: 0 }).document;
    expect(renderTopologySvg(only).width).toBeGreaterThan(200); expect(documentThumbnail(only)).not.toContain('空白画布');
  });
  test('v3 Schema 和发布组件使用同一版本并保留 v2 校验入口', async () => {
    const schema = await Bun.file('schema/topology-v3.schema.json').json();
    expect(schema.properties.version.const).toBe(3);
    expect(schema.$defs.diagramElement.oneOf.map((item: any) => item.properties.kind.const)).toEqual(['group', 'note', 'legend']);
    expect(schema.$defs.topology.properties.elements.maxItems).toBe(100);
    const script = await Bun.file('scripts/package-viewer.ts').text();
    expect(script).toContain("'./schema': './topology-v3.schema.json'");
    expect(script).toContain("'./schema/v2': './topology-v2.schema.json'");
  });
});
