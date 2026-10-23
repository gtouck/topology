import { describe, expect, test } from 'bun:test';
import { WorkspaceStore, WorkspaceConflict, parseWorkspace, effectiveDocument, documentSignature, MAX_HISTORY_BYTES, MAX_HISTORY_PER_DOCUMENT, MAX_HISTORY_TOTAL } from '../src/workspace';
import { LIBRARY_KEY, parseLibrary, type LibraryStorage } from '../src/library';
import { sampleDocument, createDocument } from '../src/document';

class MemoryStorage implements LibraryStorage {
  data = new Map<string, string>(); writes = 0; fail = false;
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('QuotaExceededError'); this.data.set(key, value); this.writes++; }
}
function setup() {
  const storage = new MemoryStorage();
  let milliseconds = Date.parse('2026-10-23T01:00:00Z');
  const store = new WorkspaceStore(storage, () => new Date(milliseconds).toISOString());
  return { storage, store, original: store.snapshot().documents[0], advance: (ms: number) => { milliseconds += ms; } };
}
const edit = (doc: ReturnType<typeof sampleDocument>, title: string) => {
  const copy = structuredClone(doc); copy.topology.nodes[0].data.title = title; return copy;
};

describe('S02 自动草稿与本地历史', () => {
  test('兼容旧库，自动草稿不改手动保存版本，刷新后按图恢复', () => {
    const { storage, store, original } = setup();
    const changed = edit(original, '未手动保存的修改');
    store.saveDraft(changed);
    const reloaded = new WorkspaceStore(storage);
    expect(reloaded.document(original.id).draft!.document).toEqual(changed);
    expect(reloaded.document(original.id).stale).toBe(false);
    expect(reloaded.document(original.id).saved).toEqual(original);
    expect(parseLibrary(JSON.parse(storage.getItem(LIBRARY_KEY)!)).documents[0]).toEqual(original);
    const second = sampleDocument('satellite');
    store.updateLibrary({ ...store.snapshot(), activeId: second.id, documents: [...store.snapshot().documents, second] });
    expect(store.document(second.id).draft).toBeUndefined();
    expect(store.document(original.id).draft!.document.topology.nodes[0].data.title).toBe('未手动保存的修改');
  });

  test('手动保存创建前后版本，清除草稿；重复保存不制造重复版本', () => {
    const { store, original } = setup();
    const changed = edit(original, '手动保存的新版本');
    store.saveDraft(changed); store.saveDocument(changed);
    expect(store.document(original.id).saved).toEqual(changed);
    expect(store.document(original.id).draft).toBeUndefined();
    const versions = store.history(original.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].document).toEqual(changed); expect(versions[1].document).toEqual(original);
    store.saveDocument({ ...changed, updatedAt: new Date().toISOString() });
    expect(store.history(original.id)).toHaveLength(2);
  });

  test('持续编辑每分钟建立检查点，频繁保存草稿不重置计时基准', () => {
    const { store, original, advance } = setup();
    for (let i = 0; i < 63; i++) { store.saveDraft(edit(original, `草稿 ${i}`)); advance(1000); }
    const history = store.history(original.id);
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe('auto');
    expect(history[0].document.topology.nodes[0].data.title).toBe('草稿 59');
    expect(store.document(original.id).draft!.document.topology.nodes[0].data.title).toBe('草稿 62');
  });

  test('恢复历史为草稿且保留当前内容，手动保存版本不改变', () => {
    const { store, original } = setup();
    const saved = edit(original, '已保存 B'), current = edit(original, '当前 C');
    store.saveDocument(saved); store.saveDraft(current);
    const version = store.history(original.id).find((entry) => documentSignature(entry.document) === documentSignature(original))!;
    store.restoreDraft(original.id, version.id, current);
    expect(store.document(original.id).saved).toEqual(saved);
    expect(store.document(original.id).draft!.document.topology).toEqual(original.topology);
    expect(store.history(original.id).some((entry) => entry.document.topology.nodes[0].data.title === '当前 C' && entry.reason === 'before-restore')).toBe(true);
    const backup = store.history(original.id).find((entry) => entry.document.topology.nodes[0].data.title === '当前 C')!;
    store.restoreDraft(original.id, backup.id, original);
    expect(store.document(original.id).draft!.document.topology).toEqual(current.topology);
  });

  test('恢复到已保存版本也保留当前草稿，以便再次恢复', () => {
    const { store, original } = setup(); const current = edit(original, '待保留');
    store.saveDraft(current); store.restoreDraft(original.id, 'saved', current);
    expect(store.document(original.id).draft).toBeUndefined();
    expect(store.history(original.id)[0].document).toEqual(current);
  });

  test('配额不足不推进内存状态或破坏旧存档，解除故障后可重试', () => {
    const { store, storage, original } = setup(); const draft = edit(original, '草稿 A');
    store.saveDraft(draft);
    const before = store.snapshot(), raw = storage.getItem(LIBRARY_KEY);
    storage.fail = true;
    expect(() => store.saveDraft(edit(original, '草稿 B'))).toThrow('Quota');
    expect(() => store.saveDocument(draft)).toThrow('Quota');
    expect(() => store.restoreDraft(original.id, 'saved', draft)).toThrow('Quota');
    expect(store.snapshot()).toEqual(before); expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    storage.fail = false; store.saveDraft(edit(original, '草稿 B'));
    expect(store.document(original.id).draft!.document.topology.nodes[0].data.title).toBe('草稿 B');
  });

  test('另一个标签页写入后拒绝覆盖，当前快照仍可导出', () => {
    const { store, storage, original } = setup(); const other = new WorkspaceStore(storage);
    store.saveDraft(edit(original, '标签页 A'));
    const raw = storage.getItem(LIBRARY_KEY);
    expect(other.changedElsewhere()).toBe(true);
    expect(() => other.saveDraft(edit(original, '标签页 B'))).toThrow(WorkspaceConflict);
    expect(() => other.saveDocument(original)).toThrow(WorkspaceConflict);
    expect(() => other.updateLibrary(other.snapshot())).toThrow(WorkspaceConflict);
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    expect(other.document(original.id).saved).toEqual(original);
    expect(new WorkspaceStore(storage).document(original.id).draft!.document.topology.nodes[0].data.title).toBe('标签页 A');
  });

  test('历史按图和全局数量限制，清理时保留当前草稿', () => {
    const { store, original } = setup();
    for (let i = 0; i < 20; i++) store.saveDocument(edit(original, `版本 ${i}`));
    expect(store.history(original.id)).toHaveLength(MAX_HISTORY_PER_DOCUMENT);
    expect(store.history(original.id)[0].document.topology.nodes[0].data.title).toBe('版本 19');
    const documents = Array.from({ length: 5 }, (_, i) => createDocument(`空图 ${i}`));
    store.updateLibrary({ ...store.snapshot(), documents: [...store.snapshot().documents, ...documents] });
    for (const doc of documents) for (let i = 0; i < 12; i++) store.saveDocument({ ...doc, description: `版本 ${i}` });
    const current = edit(original, '最新草稿'); store.saveDraft(current);
    expect(store.snapshot().editing.history.length).toBeLessThanOrEqual(MAX_HISTORY_TOTAL);
    expect(store.document(original.id).draft!.document).toEqual(current);
    expect(new TextEncoder().encode(JSON.stringify(store.snapshot().editing.history)).length).toBeLessThanOrEqual(MAX_HISTORY_BYTES + 100);
  });

  test('按容量清理大历史，超出备份容量时拒绝恢复并保留原值', () => {
    const { store, storage, original } = setup();
    const large = structuredClone(original);
    large.topology.nodes = Array.from({ length: 300 }, (_, i) => ({ ...structuredClone(original.topology.nodes[0]), id: `node-${i}`, data: { ...structuredClone(original.topology.nodes[0].data), deviceId: `d-${i}` } }));
    large.topology.edges = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(original.topology.edges[0]), id: `edge-${i}`, source: { cell: 'node-0', port: 'rf-rx' }, target: { cell: 'node-1', port: 'rf-rx' }, kind: 'rf', vertices: Array.from({ length: 200 }, (_, j) => ({ x: j * .123456789, y: j * .987654321 })) }));
    store.saveDraft(large);
    const before = storage.getItem(LIBRARY_KEY);
    expect(() => store.restoreDraft(original.id, 'saved', large)).toThrow('超出历史容量');
    expect(storage.getItem(LIBRARY_KEY)).toBe(before);
    expect(store.document(original.id).draft!.document.topology.nodes).toHaveLength(300);
  });

  test('删除文档在同一次写入中清理所属草稿及历史；副本不继承源图草稿', () => {
    const { store, original } = setup(); const second = sampleDocument('satellite');
    store.saveDocument(edit(original, '保存 B')); store.saveDraft(edit(original, '草稿 C'));
    store.updateLibrary({ ...store.snapshot(), activeId: second.id, documents: [second] });
    expect(store.snapshot().editing.drafts).toEqual([]); expect(store.snapshot().editing.history).toEqual([]);
    expect(() => store.saveDraft(original)).toThrow('已删除');
    expect(store.document(second.id).draft).toBeUndefined();
  });

  test('损坏的编辑元数据不被启动或保存流程静默覆盖', () => {
    const { storage, store } = setup();
    const state = store.snapshot(); state.editing.revision = -1;
    const raw = JSON.stringify(state); storage.setItem(LIBRARY_KEY, raw); const writes = storage.writes;
    expect(() => new WorkspaceStore(storage)).toThrow('格式');
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw); expect(storage.writes).toBe(writes);
    expect(() => parseWorkspace({ ...state, editing: null })).toThrow();
  });

  test('旧基准草稿不自动覆盖新保存内容，可显式恢复且保留旧内容', () => {
    const { store, storage, original } = setup();
    store.saveDraft(edit(original, '旧草稿'));
    const state = store.snapshot(); state.documents[0] = edit(original, '较新保存版本');
    storage.setItem(LIBRARY_KEY, JSON.stringify(state));
    const reloaded = new WorkspaceStore(storage), info = reloaded.document(original.id);
    expect(info.stale).toBe(true);
    expect(effectiveDocument(parseWorkspace(state), original.id).saved.topology.nodes[0].data.title).toBe('较新保存版本');
    expect(() => reloaded.saveDraft(edit(original, '新草稿'))).toThrow('较早版本');
    expect(() => reloaded.saveDocument(original)).toThrow('较早版本');
    reloaded.restoreDraft(original.id, 'draft', info.saved);
    expect(reloaded.document(original.id).stale).toBe(false);
    expect(reloaded.document(original.id).draft!.document.topology.nodes[0].data.title).toBe('旧草稿');
  });
});
