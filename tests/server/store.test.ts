import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocument, sampleDocument } from '../../src/document';
import { LIBRARY_KEY } from '../../src/library';
import { WorkspaceStore, parseWorkspace, type Workspace } from '../../src/workspace';
import { ServerStore, parseCommandRequest, ApiFailure } from '../../server/store';
import type { WorkspaceCommand } from '../../shared/api';
import { parseMigrationWorkspace } from '../../shared/migration';

const resources: { store: ServerStore; directory: string }[] = [];
function database() {
  const directory = mkdtempSync(join(tmpdir(), 'topology-store-')), store = new ServerStore(join(directory, 'workspace.sqlite'));
  resources.push({ store, directory }); return store;
}
afterEach(() => { for (const { store, directory } of resources.splice(0)) { store.close(); rmSync(directory, { recursive: true, force: true }); } });
function execute(store: ServerStore, command: WorkspaceCommand, expectedRevision = store.read().revision, requestId: string = crypto.randomUUID()) { return store.execute(parseCommandRequest({ expectedRevision, requestId, command })); }
function local() {
  const first = sampleDocument('ground-station'), second = createDocument('子拓扑');
  first.topology.nodes[0].data.childTopologyId = second.id;
  first.topology.edges[0].vertices = [{ x: 42, y: 123 }, { x: 555, y: 456 }];
  let raw = JSON.stringify({ version: 1, activeId: first.id, documents: [first, second] });
  const store = new WorkspaceStore({ getItem: key => key === LIBRARY_KEY ? raw : null, setItem: (_key, value) => { raw = value; } });
  const changed = { ...first, name: '已保存版本' }; store.saveDocument(changed);
  store.publish(changed, 0, '初次发布'); store.publish({ ...changed, name: '第二次发布' }, 1, '第二版');
  const rollbackId = store.publications(first.id)[1].id; store.rollbackPublication(first.id, rollbackId, 2);
  store.saveDraft({ ...changed, description: '未发布的草稿' });
  return store.snapshot();
}

describe('SQLite workspace commands', () => {
  test('draft, saved history, publication and manual vertices remain separate and survive reopen', () => {
    const store = database(), initial = store.read();
    const document = { ...initial.workspace.documents[0], name: '保存前', description: '草稿' };
    const draft = execute(store, { type: 'saveDraft', document });
    expect(draft.workspace.documents[0].name).not.toBe('保存前');
    expect(draft.workspace.editing.drafts[0].document.name).toBe('保存前');
    const saved = execute(store, { type: 'saveDocument', document });
    expect(saved.workspace.editing.drafts).toHaveLength(0);
    expect(saved.workspace.editing.history.some(entry => entry.document.name === '保存前')).toBe(true);
    const published = execute(store, { type: 'publish', document, expectedPublicationRevision: 0 });
    execute(store, { type: 'saveDraft', document: { ...document, name: '新的草稿' } });
    expect(store.read().workspace.publishing.entries[0].document.name).toBe('保存前');
    const resource = resources.find(resource => resource.store === store)!;
    store.close(); resource.store = new ServerStore(join(resource.directory, 'workspace.sqlite'));
    expect(resource.store.read().workspace.editing.drafts[0].document.name).toBe('新的草稿');
    expect(resource.store.read().workspace.publishing.entries).toEqual(published.workspace.publishing.entries);
  });

  test('stale writes and publication revisions fail atomically; idempotent retries do not republish', () => {
    const store = database(), before = store.read(), document = before.workspace.documents[0];
    const command = { type: 'publish', document, expectedPublicationRevision: 0 } as const;
    const result = execute(store, command, 0, 'request-stable');
    expect(execute(store, command, 0, 'request-stable')).toEqual(result);
    expect(store.read().workspace.publishing.entries).toHaveLength(1);
    expect(() => execute(store, { type: 'discardDraft', documentId: document.id }, 0)).toThrow(ApiFailure);
    expect(() => execute(store, command, 1)).toThrow('发布版本');
    expect(() => execute(store, { type: 'discardDraft', documentId: document.id }, 1, 'request-stable')).toThrow('请求 ID');
    expect(store.read()).toEqual(result);
  });

  test('invalid commands and unknown transport fields are rejected before writes', () => {
    const store = database(), before = store.read();
    for (const input of [
      { expectedRevision: 0, requestId: 'request-x', command: { type: 'constructor' } },
      { expectedRevision: 0, requestId: 'request-x', command: { type: 'discardDraft', documentId: before.workspace.activeId, ignored: true } },
      { expectedRevision: -1, requestId: 'request-x', command: { type: 'discardDraft', documentId: before.workspace.activeId } },
      { expectedRevision: 0, requestId: '../request', command: { type: 'discardDraft', documentId: before.workspace.activeId } },
      { expectedRevision: 0, requestId: 'request-x', surprise: true, command: { type: 'saveDocument', document: before.workspace.documents[0] } },
    ]) expect(() => parseCommandRequest(input)).toThrow(ApiFailure);
    expect(() => execute(store, { type: 'saveDocument', document: { ...before.workspace.documents[0], version: 99 } as never })).toThrow(ApiFailure);
    expect(store.read()).toEqual(before);
  });

  test('full local migration preserves IDs, drafts, histories, publications and child links and is idempotent', () => {
    const store = database(), incoming = local();
    const first = execute(store, { type: 'migrateWorkspace', workspace: incoming });
    expect(first.workspace).toEqual(incoming);
    expect(first.workspace.documents[0].topology.edges[0].vertices).toEqual([{ x: 42, y: 123 }, { x: 555, y: 456 }]);
    const repeated = execute(store, { type: 'migrateWorkspace', workspace: incoming });
    expect(repeated).toEqual(first);
    expect(first.workspace.publishing.entries.some(entry => entry.rollbackOf)).toBe(true);
  });

  test('migration merges disjoint libraries, rejects conflicting IDs atomically and never silently trims history', () => {
    const store = database(), incoming = local();
    execute(store, { type: 'migrateWorkspace', workspace: incoming });
    const other = local(), merged = execute(store, { type: 'migrateWorkspace', workspace: other });
    expect(merged.workspace.documents).toHaveLength(4);
    expect(merged.workspace.editing.history).toHaveLength(incoming.editing.history.length + other.editing.history.length);
    const conflict = structuredClone(incoming); conflict.documents[0].name = '冲突'; conflict.documents.push(createDocument('不应部分导入'));
    expect(() => execute(store, { type: 'migrateWorkspace', workspace: conflict })).toThrow('同 ID');
    expect(store.read()).toEqual(merged);
    const orphan = structuredClone(other); orphan.editing.history.push({ ...orphan.editing.history[0], id: 'orphan-history', document: createDocument('不属于库') });
    expect(() => execute(store, { type: 'migrateWorkspace', workspace: orphan })).toThrow('丢失');
    expect(store.read()).toEqual(merged);
  });

  test('migration exceeding combined retention limits is rejected instead of dropping either library histories', () => {
    function historyLibrary(): Workspace {
      const documents = Array.from({ length: 5 }, (_, index) => createDocument(`图 ${index}`));
      return parseWorkspace({ version: 1, activeId: documents[0].id, documents, editing: { version: 2, revision: 0, drafts: [], history: documents.flatMap(document => Array.from({ length: 8 }, (_, index) => ({ id: crypto.randomUUID(), document: { ...document, name: `${document.name}历史${index}` }, reason: 'manual', savedAt: document.createdAt }))) } });
    }
    const store = database(), first = execute(store, { type: 'migrateWorkspace', workspace: historyLibrary() });
    expect(first.workspace.editing.history).toHaveLength(40);
    expect(() => execute(store, { type: 'migrateWorkspace', workspace: historyLibrary() })).toThrow('丢失');
    expect(store.read()).toEqual(first);
  });

  test('shared migration parser rejects pre-trimming of source histories and publications without modifying the source', () => {
    const incoming = local(), history = incoming.editing.history[0], publication = incoming.publishing.entries[0];
    const historyOverflow = structuredClone(incoming);
    historyOverflow.editing.history = Array.from({ length: 11 }, (_, index) => ({ ...history, id: `history-${index}` }));
    const publicationOverflow = structuredClone(incoming);
    publicationOverflow.publishing.entries = Array.from({ length: 11 }, (_, index) => ({ ...publication, id: `publication-${index}`, revision: index + 1 }));
    for (const source of [historyOverflow, publicationOverflow]) {
      const original = JSON.stringify(source);
      expect(() => parseMigrationWorkspace(source)).toThrow('丢失');
      expect(JSON.stringify(source)).toBe(original);
    }
    expect(parseMigrationWorkspace(incoming)).toEqual(incoming);
  });

  test('restoring history first preserves the current drawing, rollback creates a publication without replacing draft', () => {
    const store = database(), incoming = local(); execute(store, { type: 'migrateWorkspace', workspace: incoming });
    const documentId = incoming.activeId, current = incoming.editing.drafts[0].document;
    const restored = execute(store, { type: 'restoreDraft', documentId, versionId: 'saved', current });
    expect(restored.workspace.editing.history.some(entry => entry.reason === 'before-restore' && entry.document.description === current.description)).toBe(true);
    const rolled = execute(store, { type: 'rollbackPublication', documentId, publicationId: incoming.publishing.entries[0].id, expectedPublicationRevision: 3 });
    expect(rolled.workspace.publishing.entries[0].revision).toBe(4);
    expect(rolled.workspace.editing.drafts).toEqual(restored.workspace.editing.drafts);
  });

  test('unknown database schema versions are refused without modification', () => {
    const store = database(), resource = resources.find(resource => resource.store === store)!;
    expect((store.database.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    store.database.exec('PRAGMA user_version=2');
    expect(() => new ServerStore(join(resource.directory, 'workspace.sqlite'))).toThrow('数据库版本');
    expect((store.database.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
  });

  test('retry receipts enforce count and byte limits while retaining the latest receipt', () => {
    const store = database();
    const filler = 'x'.repeat(17 * 1024 * 1024);
    store.database.query('INSERT INTO requests(id,fingerprint,response,created_at) VALUES (?,?,?,?)').run('old-large-a', 'x', filler, 0);
    store.database.query('INSERT INTO requests(id,fingerprint,response,created_at) VALUES (?,?,?,?)').run('old-large-b', 'x', filler, 0);
    execute(store, { type: 'discardDraft', documentId: store.read().workspace.activeId });
    expect((store.database.query('SELECT count(*) AS count FROM requests').get() as { count: number }).count).toBe(2);
    const add = store.database.query('INSERT INTO requests(id,fingerprint,response,created_at) VALUES (?,?,?,?)');
    for (let index = 0; index < 110; index++) add.run(`extra-${index}`, 'x', '{}', 0);
    execute(store, { type: 'discardDraft', documentId: store.read().workspace.activeId });
    expect((store.database.query('SELECT count(*) AS count FROM requests').get() as { count: number }).count).toBe(100);
  });
});
