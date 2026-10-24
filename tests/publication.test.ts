import { describe, expect, test } from 'bun:test';
import { createDocument } from '../src/document';
import { LIBRARY_KEY, type LibraryStorage } from '../src/library';
import { WorkspaceStore, WorkspaceConflict, parseWorkspace } from '../src/workspace';
import { LocalPublicationRepository } from '../src/publication-storage';
import { parsePublication, parsePublicationState, PublicationConflict, MAX_PUBLICATIONS_PER_DOCUMENT } from '../src/publication';

function fixture() {
  const map = new Map<string, string>(); let fail = false;
  const storage: LibraryStorage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error('QuotaExceededError'); map.set(key, value); } };
  const store = new WorkspaceStore(storage, () => '2026-10-25T01:00:00.000Z');
  return { storage, store, document: store.snapshot().documents[0], rejectWrites: (value: boolean) => { fail = value; } };
}
describe('S09 草稿与发布版本', () => {
  test('旧库未自动发布，草稿和手动保存不会覆盖发布快照', () => {
    const { store, document } = fixture(); expect(store.published(document.id)).toBeNull();
    const draft = structuredClone(document); draft.name = '待发布的草稿'; store.saveDraft(draft);
    store.publish(draft, 0, '首次业务版本'); const published = store.published(document.id)!;
    expect(published.revision).toBe(1); expect(published.note).toBe('首次业务版本'); expect(published.document.name).toBe(draft.name);
    expect(store.snapshot().documents[0].name).toBe(document.name);
    draft.name = '下一批草稿'; store.saveDraft(draft); store.saveDocument(draft);
    expect(store.published(document.id)).toEqual(published);
    published.document.name = '调用者修改'; expect(store.published(document.id)!.document.name).toBe('待发布的草稿');
  });
  test('回滚创建单调新版本、记录来源，保留草稿与编辑历史', () => {
    const { store, document } = fixture(); store.publish(document, 0, 'r1'); const first = store.published(document.id)!;
    const next = structuredClone(document); next.name = '第二版'; store.publish(next, 1, 'r2');
    next.name = '尚未发布的修改'; store.saveDraft(next); const editing = store.snapshot().editing;
    store.rollbackPublication(document.id, first.id, 2);
    const rolled = store.published(document.id)!;
    expect(rolled.revision).toBe(3); expect(rolled.rollbackOf).toBe(first.id); expect(rolled.document).toEqual(first.document);
    expect(store.snapshot().editing.drafts).toEqual(editing.drafts); expect(store.snapshot().editing.history).toEqual(editing.history);
    expect(store.publications(document.id).map(p => p.revision)).toEqual([3, 2, 1]);
  });
  test('过期预期版本、其他标签页和配额失败不改变内存、存储或版本号', () => {
    const { store, storage, document, rejectWrites } = fixture(); const other = new WorkspaceStore(storage);
    store.publish(document, 0); const before = store.snapshot(), raw = storage.getItem(LIBRARY_KEY);
    expect(() => store.publish(document, 0)).toThrow(PublicationConflict);
    expect(() => other.publish(document, 0)).toThrow(WorkspaceConflict);
    rejectWrites(true); expect(() => store.publish(document, 1)).toThrow('Quota'); rejectWrites(false);
    expect(store.snapshot()).toEqual(before); expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    store.publish(document, 1); expect(store.published(document.id)!.revision).toBe(2);
  });
  test('历史有界且保护每张图的当前发布，删除图清理其发布', () => {
    const { store, document } = fixture();
    for (let i = 0; i < 15; i++) store.publish({ ...document, name: `发布 ${i}` }, i);
    expect(store.publications(document.id)).toHaveLength(MAX_PUBLICATIONS_PER_DOCUMENT);
    expect(store.published(document.id)!.revision).toBe(15);
    const second = createDocument('另一张图'); store.updateLibrary({ ...store.snapshot(), documents: [...store.snapshot().documents, second] });
    store.publish(second, 0); expect(store.published(document.id)!.revision).toBe(15);
    store.updateLibrary({ ...store.snapshot(), activeId: second.id, documents: [second] });
    expect(store.published(document.id)).toBeNull(); expect(store.publications(document.id)).toEqual([]); expect(store.published(second.id)!.revision).toBe(1);
  });
  test('超过当前发布容量整体拒绝，不删除其他版本来伪装成功', () => {
    const { store, document } = fixture(); store.publish(document, 0); const before = store.snapshot();
    const ports = Array.from({ length: 128 }, (_, i) => ({ id: `${i}-${'p'.repeat(90)}`, label: '端'.repeat(40), kind: 'logical' as const, side: 'left' as const }));
    const big = structuredClone(document);
    big.topology = { nodes: Array.from({ length: 120 }, (_, i) => ({ id: `node-${i}`, x: i * 10, y: 0, data: { kind: 'module', title: `模块${i}`, deviceId: `DEV-${i}`, address: '', status: 'normal' as const, visibleMetrics: [], ports } })), edges: [] };
    expect(() => store.publish(big, 1)).toThrow('容量'); expect(store.snapshot()).toEqual(before);
  });
  test('宿主接口本地适配读取最新版本、校验预期并返回隔离副本', async () => {
    const empty = new LocalPublicationRepository({ getItem: () => null, setItem: () => { throw new Error('只读查询不应初始化示例库'); } });
    expect(await empty.getPublished('missing')).toBeNull(); expect(await empty.listPublications('missing')).toEqual([]);
    const { storage, document } = fixture(); const repository = new LocalPublicationRepository(storage);
    await expect(empty.publish(document, 0)).rejects.toThrow('没有拓扑库');
    expect(await repository.getPublished(document.id)).toBeNull();
    const first = await repository.publish(document, 0, '宿主发布');
    const second = await repository.publish({ ...document, name: '宿主新版本' }, 1);
    expect(second.revision).toBe(2);
    await expect(repository.publish(document, 1)).rejects.toThrow(PublicationConflict);
    const rolled = await repository.rollback(document.id, first.id, 2); expect(rolled.revision).toBe(3); expect(rolled.rollbackOf).toBe(first.id);
    const list = await repository.listPublications(document.id); list[0].document.name = '外部修改';
    expect((await repository.getPublished(document.id))!.document.name).toBe(document.name);
  });
  test('发布元数据非法版本、重复引用被拒绝，配置仍规范化为 v3', () => {
    const { store, document } = fixture(); const old = store.snapshot(); delete (old as Partial<typeof old>).publishing;
    old.editing.version = 1 as never;
    expect(parseWorkspace(old).publishing.entries).toEqual([]);
    expect(parseWorkspace(old).editing.version).toBe(2);
    expect(() => parseWorkspace({ ...old, editing: { ...old.editing, version: 99 } })).toThrow();
    store.publish(document, 0); const publication = store.published(document.id)!;
    expect(() => parsePublication({ ...publication, revision: 0 })).toThrow();
    expect(() => parsePublicationState({ version: 2, entries: [] }, new Set())).toThrow();
    expect(() => parsePublicationState({ version: 1, entries: [publication, publication] }, new Set([document.id]))).toThrow('重复');
    const input = structuredClone(publication); (input.document.topology.nodes[0].data as unknown as Record<string, unknown>).receivedAt = 1000;
    expect(parsePublication(input).document.version).toBe(3); expect(JSON.stringify(parsePublication(input).document)).not.toContain('receivedAt');
  });
});
