import type { PublicationRepository } from './publication';
import type { TopologyDocument } from './document';
import { LIBRARY_KEY, type LibraryStorage } from './library';
import { WorkspaceStore } from './workspace';

/** Local editor adapter; deliberately excluded from the standalone viewer bundle. */
export class LocalPublicationRepository implements PublicationRepository {
  constructor(private storage: LibraryStorage) {}
  private store() {
    if (this.storage.getItem(LIBRARY_KEY) === null) throw new Error('当前浏览器没有拓扑库，请先创建或导入拓扑');
    return new WorkspaceStore(this.storage);
  }
  async getPublished(id: string) { return this.storage.getItem(LIBRARY_KEY) === null ? null : new WorkspaceStore(this.storage).published(id); }
  async listPublications(id: string) { return this.storage.getItem(LIBRARY_KEY) === null ? [] : new WorkspaceStore(this.storage).publications(id); }
  async publish(document: TopologyDocument, expectedRevision: number, note = '') {
    const store = this.store(); store.publish(document, expectedRevision, note); return store.published(document.id)!;
  }
  async rollback(documentId: string, publicationId: string, expectedRevision: number, note = '') {
    const store = this.store(); store.rollbackPublication(documentId, publicationId, expectedRevision, note); return store.published(documentId)!;
  }
}
