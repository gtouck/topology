import type { WorkspaceCommand, WorkspaceCommandRequest, WorkspaceResponse, ApiErrorResponse } from '../shared/api';
import { newId, type TopologyDocument } from './document';
import type { TopologyLibrary } from './library';
import { effectiveDocument, parseWorkspace, WorkspaceConflict, type Workspace, type WorkspaceStore } from './workspace';
import { latestPublication } from './publication';

type WriteMethod = 'saveDraft' | 'saveDocument' | 'updateLibrary' | 'restoreDraft' | 'discardDraft' | 'publish' | 'rollbackPublication';
export type WorkspaceAccess = Omit<WorkspaceStore, WriteMethod> & {
  [K in WriteMethod]: (...args: Parameters<WorkspaceStore[K]>) => Workspace | Promise<Workspace>
};
export type WorkspaceFetch = (path: string, init?: RequestInit) => Promise<Response>;
export class RemoteWorkspace {
  private state: Workspace;
  private revision: number;
  private tail: Promise<unknown> = Promise.resolve();
  private blocked: Error | undefined;
  private pending: WorkspaceCommandRequest | undefined;
  private selectedId: string;
  constructor(response: WorkspaceResponse, private request: WorkspaceFetch) {
    this.state = parseWorkspace(response.workspace); this.revision = response.revision; this.selectedId = this.state.activeId;
  }
  static async connect(request: WorkspaceFetch) { return new RemoteWorkspace(await RemoteWorkspace.read(request), request); }
  private static async read(request: WorkspaceFetch) {
    const response = await request('/api/workspace');
    if (!response.ok) throw new Error('服务器拓扑库读取失败，请重新连接');
    return response.json() as Promise<WorkspaceResponse>;
  }
  snapshot(): Workspace { return { ...structuredClone(this.state), activeId: this.selectedId }; }
  document(id: string) { return effectiveDocument(this.state, id); }
  history(id: string) { return structuredClone(this.state.editing.history.filter(entry => entry.document.id === id)); }
  publications(id: string) { return structuredClone(this.state.publishing.entries.filter(entry => entry.documentId === id).sort((a, b) => b.revision - a.revision)); }
  published(id: string) { return structuredClone(latestPublication(this.state.publishing.entries, id) ?? null); }
  changedElsewhere() { return false; }
  get serverRevision() { return this.revision; }
  get hasPendingRequest() { return !!this.pending; }
  select(id: string) { if (this.state.documents.some(document => document.id === id)) this.selectedId = id; return this.snapshot(); }
  private async transmit(body: WorkspaceCommandRequest): Promise<Workspace> {
    const response = await this.request('/api/workspace/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as ApiErrorResponse | null;
      const message = failure?.error?.message || `服务器保存失败（${response.status}）`;
      if (response.status < 500) this.pending = undefined;
      if (response.status === 409) throw new WorkspaceConflict(`${message}。当前画布已保留，请导出或保留本机副本后重新读取。`);
      throw new Error(message);
    }
    const result = await response.json() as WorkspaceResponse;
    this.state = parseWorkspace(result.workspace); this.revision = result.revision; this.pending = undefined;
    if (!this.state.documents.some(document => document.id === this.selectedId)) this.selectedId = this.state.activeId;
    return this.snapshot();
  }
  private write(command: WorkspaceCommand) {
    // Allocate the revision only after earlier requests were acknowledged.
    const work = this.tail.then(async () => {
      if (this.blocked) throw this.blocked;
      const body: WorkspaceCommandRequest = { expectedRevision: this.revision, requestId: newId('request'), command: structuredClone(command) };
      this.pending = body;
      try { return await this.transmit(body); }
      catch (error) {
        const failure = error instanceof Error ? error : new Error('服务器保存失败');
        if (this.pending || failure instanceof WorkspaceConflict) this.blocked = failure;
        throw failure;
      }
    });
    this.tail = work.catch(() => undefined); return work;
  }
  async retry() {
    await this.tail;
    if (this.blocked instanceof WorkspaceConflict) throw this.blocked;
    if (this.pending) { try { await this.transmit(this.pending); } catch (error) { this.blocked = error as Error; throw error; } }
    this.blocked = undefined; return this.snapshot();
  }
  saveDraft(document: TopologyDocument) { return this.write({ type: 'saveDraft', document }); }
  saveDocument(document: TopologyDocument) { return this.write({ type: 'saveDocument', document }); }
  updateLibrary(library: TopologyLibrary) {
    // Selecting another drawing is a browser preference, not a shared write.
    if (JSON.stringify(library.documents) === JSON.stringify(this.state.documents)) return Promise.resolve(this.select(library.activeId));
    const serverActiveId = library.documents.some(document => document.id === this.state.activeId) ? this.state.activeId : library.activeId;
    return this.write({ type: 'updateLibrary', library: { ...library, activeId: serverActiveId } }).then(state => {
      this.select(library.activeId); return { ...state, activeId: this.selectedId };
    });
  }
  restoreDraft(documentId: string, versionId: string, current: TopologyDocument) { return this.write({ type: 'restoreDraft', documentId, versionId, current }); }
  discardDraft(documentId: string) { return this.write({ type: 'discardDraft', documentId }); }
  publish(document: TopologyDocument, expectedPublicationRevision: number, note?: string) { return this.write({ type: 'publish', document, expectedPublicationRevision, note }); }
  rollbackPublication(documentId: string, publicationId: string, expectedPublicationRevision: number, note?: string) { return this.write({ type: 'rollbackPublication', documentId, publicationId, expectedPublicationRevision, note }); }
  migrateWorkspace(workspace: Workspace) { return this.write({ type: 'migrateWorkspace', workspace }); }
}
