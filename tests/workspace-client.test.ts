import { describe, expect, test } from 'bun:test';
import { RemoteWorkspace } from '../src/workspace-client';
import { ServerRecovery, browserMigrationSource } from '../src/server-recovery';
import { WorkspaceStore, WorkspaceConflict } from '../src/workspace';
import { emptyLibrary, LIBRARY_KEY } from '../src/library';
import type { WorkspaceCommandRequest, WorkspaceResponse } from '../shared/api';
import { STORAGE_KEY } from '../src/topology';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
function fixture() {
  const storage = new MemoryStorage(); storage.setItem(LIBRARY_KEY, JSON.stringify(emptyLibrary()));
  const store = new WorkspaceStore(storage);
  const response: WorkspaceResponse = { revision: 0, workspace: store.snapshot() };
  return { storage, store, response, document: store.snapshot().documents[0] };
}

describe('server workspace confirmation and recovery', () => {
  test('writes wait for ACK and allocate revisions in queue order', async () => {
    const { response, store, document } = fixture(), requests: WorkspaceCommandRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const client = new RemoteWorkspace(response, async (_path, init) => {
      const body = JSON.parse(init!.body as string) as WorkspaceCommandRequest; requests.push(body);
      if (requests.length === 1) await gate;
      if (body.command.type !== 'saveDraft') throw new Error('unexpected command');
      return Response.json({ revision: requests.length, workspace: store.saveDraft(body.command.document) });
    });
    const first = client.saveDraft({ ...document, name: 'first' });
    const second = client.saveDraft({ ...document, name: 'second' });
    await Promise.resolve();
    expect(requests).toHaveLength(1); expect(client.document(document.id).draft).toBeUndefined();
    release(); await first; await second;
    expect(requests.map(request => request.expectedRevision)).toEqual([0, 1]);
    expect(client.document(document.id).draft?.document.name).toBe('second');
    expect(client.serverRevision).toBe(2);
  });
  test('a lost response pauses queued commands and retry keeps the same idempotency key', async () => {
    const { response, store, document } = fixture(), requests: WorkspaceCommandRequest[] = [];
    let saved: WorkspaceResponse | undefined;
    const client = new RemoteWorkspace(response, async (_path, init) => {
      const body = JSON.parse(init!.body as string) as WorkspaceCommandRequest; requests.push(body);
      if (!saved) {
        saved = { revision: 1, workspace: store.saveDocument({ ...document, name: 'committed' }) };
        throw new Error('response lost');
      }
      return Response.json(saved);
    });
    await expect(client.saveDocument({ ...document, name: 'committed' })).rejects.toThrow('response lost');
    await expect(client.saveDraft({ ...document, name: 'queued' })).rejects.toThrow('response lost');
    expect(requests).toHaveLength(1); expect(client.snapshot().documents[0].name).toBe(document.name);
    await client.retry();
    expect(requests[1]).toEqual(requests[0]); expect(client.snapshot().documents[0].name).toBe('committed');
    expect(client.hasPendingRequest).toBe(false);
  });
  test('409 keeps confirmed state and requires explicit reread, validation errors allow correction', async () => {
    const { response, document } = fixture(); let calls = 0;
    const client = new RemoteWorkspace(response, async () => { calls++; return Response.json({ error: { code: 'WORKSPACE_CONFLICT', message: 'newer version' } }, { status: 409 }); });
    await expect(client.saveDraft({ ...document, name: 'stale' })).rejects.toBeInstanceOf(WorkspaceConflict);
    await expect(client.retry()).rejects.toBeInstanceOf(WorkspaceConflict);
    await expect(client.saveDocument(document)).rejects.toBeInstanceOf(WorkspaceConflict);
    expect(calls).toBe(1); expect(client.serverRevision).toBe(0);
    const editable = new RemoteWorkspace(response, async () => { calls++; return calls === 2 ? Response.json({ error: { code: 'INVALID_INPUT', message: 'invalid' } }, { status: 422 }) : Response.json(response); });
    await expect(editable.saveDocument(document)).rejects.toThrow('invalid');
    await editable.saveDocument(document); expect(calls).toBe(3);
  });
  test('active drawing selection is local and does not produce a server write', async () => {
    const { response, document } = fixture(); response.workspace.documents.push({ ...document, id: `${document.id}-second` });
    const client = new RemoteWorkspace(response, async () => { throw new Error('selection must not write'); });
    const state = await client.updateLibrary({ ...client.snapshot(), activeId: `${document.id}-second` });
    expect(state.activeId).toBe(`${document.id}-second`); expect(client.serverRevision).toBe(0);
  });
  test('ACK removes only the matching tab snapshot, preserving edits made while saving', () => {
    const { storage, document } = fixture();
    const a = new ServerRecovery(storage), b = new ServerRecovery(storage);
    a.save(document, 'base'); b.save(document, 'base');
    const newer = { ...document, name: 'edited during save' }; a.save(newer, 'base');
    a.acknowledge(document); expect(a.entries()).toHaveLength(2);
    a.acknowledge(newer); expect(a.entries()).toHaveLength(1);
    b.acknowledge(document); expect(a.entries()).toHaveLength(0);
  });
  test('migration reads full workspace without overwriting source history or publications', () => {
    const { storage, store, document } = fixture();
    store.saveDocument({ ...document, name: 'saved' }); store.saveDraft({ ...document, name: 'draft' }); store.publish(document, 0, 'immutable');
    const raw = storage.getItem(LIBRARY_KEY), source = browserMigrationSource(storage)!;
    expect(source.editing.drafts).toHaveLength(1); expect(source.editing.history.length).toBeGreaterThan(0);
    expect(source.publishing.entries[0].note).toBe('immutable'); expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
  });
  test('legacy single drawing maps to a stable ID and dates without writing its source', () => {
    const { storage, document } = fixture(); storage.removeItem(LIBRARY_KEY);
    const raw = JSON.stringify({ version: 1, name: 'old drawing', topology: document.topology });
    storage.setItem(STORAGE_KEY, raw);
    const first = browserMigrationSource(storage)!;
    expect(browserMigrationSource(storage)).toEqual(first);
    const anotherBrowser = new MemoryStorage(); anotherBrowser.setItem(STORAGE_KEY, raw);
    expect(browserMigrationSource(anotherBrowser)).toEqual(first);
    expect(storage.getItem(STORAGE_KEY)).toBe(raw); expect(storage.getItem(LIBRARY_KEY)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: 'old drawing', savedAt: 123, topology: document.topology }));
    expect(browserMigrationSource(storage)!.documents[0].updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });
  test('migration does not pre-trim an oversized browser history before sending it', () => {
    const { storage, store, document } = fixture(); store.saveDocument({ ...document, name: 'history' });
    const original = store.snapshot(), entry = original.editing.history[0];
    original.editing.history = Array.from({ length: 11 }, (_, i) => ({ ...entry, id: `history-${i}` }));
    const raw = JSON.stringify(original); storage.setItem(LIBRARY_KEY, raw);
    expect(() => browserMigrationSource(storage)).toThrow('迁移将丢失');
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
  });
});
