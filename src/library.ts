import { createDocument, newId, parseDocument, sampleDocument, type TopologyDocument } from './document';
import { STORAGE_KEY } from './topology';

export const LIBRARY_KEY = 'topology-workspace-v1';
export interface TopologyLibrary { version: 1; activeId: string; documents: TopologyDocument[] }
export interface LibraryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function parseLibrary(input: unknown): TopologyLibrary {
  if (!input || typeof input !== 'object') throw new Error('拓扑库格式不合法');
  const library = input as TopologyLibrary;
  if (library.version !== 1 || !Array.isArray(library.documents) || !library.documents.length || library.documents.length > 100) throw new Error('拓扑库需包含 1–100 张图');
  const documents = library.documents.map(parseDocument);
  if (new Set(documents.map((d) => d.id)).size !== documents.length || !documents.some((d) => d.id === library.activeId)) throw new Error('拓扑库文档 ID 或当前图不合法');
  return { version: 1, activeId: library.activeId, documents };
}

export function loadLibrary(storage: LibraryStorage): { library: TopologyLibrary; migrated: boolean } {
  const saved = storage.getItem(LIBRARY_KEY);
  if (saved !== null) return { library: parseLibrary(JSON.parse(saved)), migrated: false };
  const legacy = storage.getItem(STORAGE_KEY);
  const document = legacy ? parseDocument(JSON.parse(legacy)) : sampleDocument('ground-station');
  const library: TopologyLibrary = { version: 1, activeId: document.id, documents: [document] };
  // Keep the original v1 key intact as a recovery copy.
  storage.setItem(LIBRARY_KEY, JSON.stringify(library));
  return { library, migrated: legacy !== null };
}

export function saveLibrary(storage: LibraryStorage, library: TopologyLibrary) {
  const checked = parseLibrary(library);
  storage.setItem(LIBRARY_KEY, JSON.stringify(checked));
  return checked;
}

export function duplicateDocument(document: TopologyDocument): TopologyDocument {
  const now = new Date().toISOString();
  return { ...structuredClone(document), id: newId(), name: `${document.name.slice(0, 95)} 副本`, createdAt: now, updatedAt: now };
}

export function removeDocument(library: TopologyLibrary, id: string): TopologyLibrary {
  if (!library.documents.some((d) => d.id === id)) throw new Error('拓扑不存在');
  if (library.documents.length === 1) throw new Error('请至少保留一张拓扑');
  const documents = library.documents.filter((d) => d.id !== id);
  return { version: 1, activeId: library.activeId === id ? documents[0].id : library.activeId, documents };
}

export function emptyLibrary(): TopologyLibrary {
  const doc = createDocument('未命名拓扑');
  return { version: 1, activeId: doc.id, documents: [doc] };
}
