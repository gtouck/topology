import { describe, expect, test } from 'bun:test';
import { LIBRARY_KEY, loadLibrary, saveLibrary, duplicateDocument, removeDocument, type LibraryStorage } from '../src/library';
import { sampleDocument } from '../src/document';

class MemoryStorage implements LibraryStorage {
  values = new Map<string, string>();
  writes = 0; fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('QuotaExceededError'); this.values.set(key, value); this.writes++; }
}
describe('多图存储', () => {
  test('初始建库、切换、刷新与多图数据隔离', () => {
    const storage = new MemoryStorage(); const { library } = loadLibrary(storage);
    const second = sampleDocument('satellite');
    const next = saveLibrary(storage, { version: 1, activeId: second.id, documents: [...library.documents, second] });
    next.documents[1].topology.nodes[0].data.title = '内存修改';
    const restored = loadLibrary(storage).library;
    expect(restored.activeId).toBe(second.id); expect(restored.documents).toHaveLength(2);
    expect(restored.documents[1].topology.nodes[0].data.title).not.toBe('内存修改');
    expect(restored.documents[0].topology).toEqual(library.documents[0].topology);
  });
  test('不读取旧单图浏览器存档，直接创建当前拓扑库', () => {
    const storage = new MemoryStorage(), oldKey = 'station-x6-topology-v1', raw = '{invalid old storage';
    storage.setItem(oldKey, raw);
    const first = loadLibrary(storage), second = loadLibrary(storage);
    expect(first.library.documents[0].name).toBe('北京地面站');
    expect(first.library.activeId).toBe(second.library.activeId);
    expect(storage.getItem(oldKey)).toBe(raw);
  });
  test('复制具有独立文档 ID，节点和模板修改不影响原图', () => {
    const original = sampleDocument('datacenter'); const copy = duplicateDocument(original);
    expect(copy.id).not.toBe(original.id);
    copy.topology.nodes[0].data.title = '副本节点'; copy.templates[0].label = '副本模板';
    expect(original.topology.nodes[0].data.title).not.toBe('副本节点'); expect(original.templates[0].label).not.toBe('副本模板');
  });
  test('删除当前图选择另一张，最后一张不能删除', () => {
    const a = sampleDocument('ground-station'), b = sampleDocument('satellite');
    const library = { version: 1 as const, activeId: a.id, documents: [a, b] };
    const next = removeDocument(library, a.id); expect(next.activeId).toBe(b.id); expect(library.documents).toHaveLength(2);
    expect(() => removeDocument(next, b.id)).toThrow('至少保留');
  });
  test('损坏的库不会静默重建或覆盖原内容', () => {
    const storage = new MemoryStorage(); storage.setItem(LIBRARY_KEY, '{corrupt'); const writes = storage.writes;
    expect(() => loadLibrary(storage)).toThrow(); expect(storage.writes).toBe(writes); expect(storage.getItem(LIBRARY_KEY)).toBe('{corrupt');
  });
  test('校验和存储失败不会覆盖之前成功保存的库', () => {
    const storage = new MemoryStorage(); const { library } = loadLibrary(storage); const before = storage.getItem(LIBRARY_KEY);
    expect(() => saveLibrary(storage, { ...library, activeId: 'missing' })).toThrow();
    storage.fail = true;
    expect(() => saveLibrary(storage, library)).toThrow('Quota'); expect(storage.getItem(LIBRARY_KEY)).toBe(before);
  });
});
