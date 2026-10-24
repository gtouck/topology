import { documentSignature } from './document-signature';
export { documentSignature } from './document-signature';
import { newId, parseDocument, type TopologyDocument } from './document';
import { LIBRARY_KEY, loadLibrary, parseLibrary, type LibraryStorage, type TopologyLibrary } from './library';
import { latestPublication, newPublication, parsePublicationState, trimPublications, PublicationConflict, type PublicationState } from './publication';

export const MAX_HISTORY_PER_DOCUMENT = 10;
export const MAX_HISTORY_TOTAL = 40;
export const MAX_HISTORY_BYTES = 1_500_000;
export const AUTO_CHECKPOINT_MS = 60_000;
export type VersionReason = 'manual' | 'auto' | 'before-restore' | 'previous';
export interface Draft { document: TopologyDocument; savedAt: string; checkpointAt: string; base: string }
export interface LocalVersion { id: string; document: TopologyDocument; savedAt: string; reason: VersionReason }
export interface Workspace extends TopologyLibrary { editing: { version: 2; revision: number; drafts: Draft[]; history: LocalVersion[] }; publishing: PublicationState }
export class WorkspaceConflict extends Error {
  constructor(message = '其他标签页已修改拓扑库，保存已暂停。请导出当前图后重新读取。') { super(message); }
}

function fingerprint(document: TopologyDocument) {
  const content = documentSignature(document);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < content.length; i++) { a = Math.imul(a ^ content.charCodeAt(i), 16777619); b = Math.imul(b ^ content.charCodeAt(i), 2246822519); }
  return `${content.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
const same = (a: TopologyDocument, b: TopologyDocument) => documentSignature(a) === documentSignature(b);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const date = (value: unknown) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('草稿或版本时间不合法');
  return value;
};

function trimHistory(history: LocalVersion[]) {
  let totalBytes = 0;
  const counts = new Map<string, number>();
  return history.filter((entry) => {
    const size = bytes(entry), count = counts.get(entry.document.id) || 0;
    if (count >= MAX_HISTORY_PER_DOCUMENT || totalBytes + size > MAX_HISTORY_BYTES || [...counts.values()].reduce((a, b) => a + b, 0) >= MAX_HISTORY_TOTAL) return false;
    totalBytes += size; counts.set(entry.document.id, count + 1);
    return true;
  });
}

/** Extra editor metadata shares the library's single atomic setItem write. */
export function parseWorkspace(input: unknown): Workspace {
  const library = parseLibrary(input);
  const originalDocuments = (input as TopologyLibrary).documents;
  const metadata = (input as { editing?: Omit<Workspace['editing'], 'version'> & { version: number } }).editing;
  const publishing = parsePublicationState((input as Partial<Workspace>).publishing, new Set(library.documents.map(d => d.id)));
  if (metadata === undefined) return { ...library, editing: { version: 2, revision: 0, drafts: [], history: [] }, publishing };
  if (!metadata || (metadata.version !== 1 && metadata.version !== 2) || !Number.isSafeInteger(metadata.revision) || metadata.revision < 0 || !Array.isArray(metadata.drafts) || metadata.drafts.length > 100 || !Array.isArray(metadata.history) || metadata.history.length > 200) throw new Error('本地草稿或历史格式不合法');
  const ids = new Set(library.documents.map((d) => d.id)), draftIds = new Set<string>(), versionIds = new Set<string>();
  const drafts = metadata.drafts.map((draft) => {
    if (!draft || typeof draft.base !== 'string' || draft.base.length > 100) throw new Error('草稿基准不合法');
    const document = parseDocument(draft.document);
    if (draftIds.has(document.id)) throw new Error('存在重复草稿');
    draftIds.add(document.id);
    const original = originalDocuments.find((saved) => saved.id === document.id);
    const migrated = library.documents.find((saved) => saved.id === document.id);
    // Rebase only a valid old fingerprint. Stale drafts must remain stale after migration.
    const base = original && migrated && draft.base === fingerprint(original) ? fingerprint(migrated) : draft.base;
    return { document, base, savedAt: date(draft.savedAt), checkpointAt: date(draft.checkpointAt || draft.savedAt) };
  }).filter((draft) => ids.has(draft.document.id));
  const history = metadata.history.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100 || versionIds.has(entry.id) || !['manual', 'auto', 'before-restore', 'previous'].includes(entry.reason)) throw new Error('历史版本不合法');
    versionIds.add(entry.id);
    return { id: entry.id, document: parseDocument(entry.document), reason: entry.reason, savedAt: date(entry.savedAt) };
  }).filter((entry) => ids.has(entry.document.id));
  return { ...library, editing: { version: 2, revision: metadata.revision, drafts, history: trimHistory(history) }, publishing };
}

export function effectiveDocument(workspace: Workspace, id: string) {
  const saved = workspace.documents.find((d) => d.id === id);
  if (!saved) throw new Error('拓扑不存在');
  const draft = workspace.editing.drafts.find((entry) => entry.document.id === id);
  return { saved: structuredClone(saved), draft: draft ? structuredClone(draft) : undefined, stale: !!draft && draft.base !== fingerprint(saved) };
}

export class WorkspaceStore {
  private state: Workspace;
  private expected: string;

  constructor(private storage: LibraryStorage, private now = () => new Date().toISOString()) {
    if (storage.getItem(LIBRARY_KEY) === null) loadLibrary(storage);
    this.expected = storage.getItem(LIBRARY_KEY)!;
    this.state = parseWorkspace(JSON.parse(this.expected));
  }

  snapshot() { return structuredClone(this.state); }
  changedElsewhere() { return this.storage.getItem(LIBRARY_KEY) !== this.expected; }
  document(id: string) { return effectiveDocument(this.state, id); }
  history(id: string) { return structuredClone(this.state.editing.history.filter((entry) => entry.document.id === id)); }
  publications(id: string) { return structuredClone(this.state.publishing.entries.filter(p => p.documentId === id).sort((a, b) => b.revision - a.revision)); }
  published(id: string) { return structuredClone(latestPublication(this.state.publishing.entries, id) ?? null); }

  private change(edit: (next: Workspace) => void) {
    if (this.changedElsewhere()) throw new WorkspaceConflict();
    const next = this.snapshot(); edit(next);
    next.editing.revision++;
    const checked = parseWorkspace(next), raw = JSON.stringify(checked);
    this.storage.setItem(LIBRARY_KEY, raw);
    // Memory advances only after the complete write succeeds.
    this.state = checked; this.expected = raw;
    return this.snapshot();
  }

  private checkpoint(state: Workspace, document: TopologyDocument, reason: VersionReason) {
    const existing = state.editing.history.find((entry) => same(entry.document, document));
    state.editing.history = state.editing.history.filter((entry) => entry.id !== existing?.id);
    state.editing.history.unshift({ id: existing?.id || newId('version'), document: structuredClone(document), reason, savedAt: this.now() });
    state.editing.history = trimHistory(state.editing.history);
  }

  updateLibrary(library: TopologyLibrary) {
    const checked = parseLibrary(library);
    return this.change((next) => { next.activeId = checked.activeId; next.documents = checked.documents; });
  }

  saveDraft(input: TopologyDocument) {
    const document = parseDocument(input);
    return this.change((next) => {
      const saved = next.documents.find((d) => d.id === document.id);
      if (!saved) throw new Error('拓扑已删除，无法保存草稿');
      const previous = next.editing.drafts.find((draft) => draft.document.id === document.id);
      if (previous && previous.base !== fingerprint(saved)) throw new WorkspaceConflict('存在基于较早版本的草稿，请先在“草稿与历史”中选择恢复。');
      let checkpointAt = previous?.checkpointAt || this.now();
      if (previous && !same(previous.document, document) && Date.parse(this.now()) - Date.parse(checkpointAt) >= AUTO_CHECKPOINT_MS) {
        this.checkpoint(next, previous.document, 'auto'); checkpointAt = this.now();
      }
      next.editing.drafts = next.editing.drafts.filter((draft) => draft.document.id !== document.id);
      if (!same(saved, document)) next.editing.drafts.push({ document, savedAt: this.now(), checkpointAt, base: fingerprint(saved) });
    });
  }

  saveDocument(input: TopologyDocument) {
    const document = parseDocument(input);
    return this.change((next) => {
      const index = next.documents.findIndex((d) => d.id === document.id);
      if (index < 0) throw new Error('拓扑已删除，无法保存');
      const previous = next.documents[index];
      const draft = next.editing.drafts.find((entry) => entry.document.id === document.id);
      if (draft && draft.base !== fingerprint(previous)) throw new WorkspaceConflict('存在基于较早版本的草稿，请先在“草稿与历史”中选择恢复。');
      if (!same(previous, document)) this.checkpoint(next, previous, 'previous');
      this.checkpoint(next, document, 'manual');
      next.documents[index] = document;
      next.editing.drafts = next.editing.drafts.filter((draft) => draft.document.id !== document.id);
    });
  }

  restoreDraft(documentId: string, versionId: string, current: TopologyDocument) {
    const checked = parseDocument(current);
    if (checked.id !== documentId) throw new Error('当前图与恢复目标不一致');
    return this.change((next) => {
      const saved = next.documents.find((d) => d.id === documentId);
      const target = versionId === 'saved' ? saved : versionId === 'draft' ? next.editing.drafts.find((draft) => draft.document.id === documentId)?.document : next.editing.history.find((entry) => entry.id === versionId && entry.document.id === documentId)?.document;
      if (!saved || !target) throw new Error('历史版本不存在');
      const restored = structuredClone(target);
      const previousDraft = next.editing.drafts.find((draft) => draft.document.id === documentId);
      const required = [checked];
      if (previousDraft && !same(previousDraft.document, checked) && !same(previousDraft.document, restored)) {
        this.checkpoint(next, previousDraft.document, 'before-restore'); required.push(previousDraft.document);
      }
      this.checkpoint(next, checked, 'before-restore');
      if (required.some((document) => !next.editing.history.some((entry) => same(entry.document, document)))) throw new Error('当前图超出历史容量，请先导出备份后再恢复');
      restored.updatedAt = this.now();
      next.editing.drafts = next.editing.drafts.filter((draft) => draft.document.id !== documentId);
      if (!same(saved, restored)) next.editing.drafts.push({ document: restored, savedAt: this.now(), checkpointAt: this.now(), base: fingerprint(saved) });
    });
  }

  discardDraft(id: string) { return this.change((next) => { next.editing.drafts = next.editing.drafts.filter((draft) => draft.document.id !== id); }); }

  publish(input: TopologyDocument, expectedRevision: number, note = '') {
    const document = parseDocument(input);
    return this.change(next => {
      if (!next.documents.some(d => d.id === document.id)) throw new Error('拓扑已删除，无法发布');
      const previous = latestPublication(next.publishing.entries, document.id);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (previous?.revision ?? 0)) throw new PublicationConflict();
      const publication = newPublication(document, expectedRevision + 1, this.now(), note);
      next.publishing.entries = trimPublications([publication, ...next.publishing.entries]);
    });
  }

  rollbackPublication(documentId: string, publicationId: string, expectedRevision: number, note = '') {
    return this.change(next => {
      const previous = latestPublication(next.publishing.entries, documentId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (previous?.revision ?? 0)) throw new PublicationConflict();
      const target = next.publishing.entries.find(p => p.id === publicationId && p.documentId === documentId);
      if (!target || !previous) throw new Error('发布版本不存在或已被清理');
      const publication = newPublication(target.document, previous.revision + 1, this.now(), note || `回滚至 r${target.revision}`, target.id);
      next.publishing.entries = trimPublications([publication, ...next.publishing.entries]);
    });
  }
}
