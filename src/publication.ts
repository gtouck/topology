import { newId, parseDocument, type TopologyDocument } from './document';

export interface TopologyPublication {
  id: string;
  documentId: string;
  revision: number;
  publishedAt: string;
  note: string;
  document: TopologyDocument;
  rollbackOf?: string;
}
/** Host implementations own authentication, durable storage and transactional revision checks. */
export interface PublicationRepository {
  getPublished(documentId: string): Promise<TopologyPublication | null>;
  listPublications(documentId: string): Promise<TopologyPublication[]>;
  publish(document: TopologyDocument, expectedRevision: number, note?: string): Promise<TopologyPublication>;
  rollback(documentId: string, publicationId: string, expectedRevision: number, note?: string): Promise<TopologyPublication>;
}
export class PublicationConflict extends Error {
  constructor() { super('已发布版本已变化，请重新读取后再发布'); }
}
export function parsePublication(input: unknown): TopologyPublication {
  if (!input || typeof input !== 'object') throw new Error('发布记录不合法');
  const p = input as TopologyPublication, document = parseDocument(p.document);
  const validId = (value: unknown): value is string => typeof value === 'string' && value.length <= 100 && /^[\w.-]+$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
  if (!validId(p.id) || p.documentId !== document.id || !Number.isSafeInteger(p.revision) || p.revision < 1 || typeof p.publishedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(p.publishedAt) || !Number.isFinite(Date.parse(p.publishedAt)) || typeof p.note !== 'string' || p.note.length > 500 || (p.rollbackOf !== undefined && !validId(p.rollbackOf))) throw new Error('发布版本、时间或说明不合法');
  return { id: p.id, documentId: document.id, revision: p.revision, publishedAt: p.publishedAt, note: p.note, document, ...(p.rollbackOf === undefined ? {} : { rollbackOf: p.rollbackOf }) };
}
export function newPublication(document: TopologyDocument, revision: number, publishedAt: string, note = '', rollbackOf?: string) {
  return parsePublication({ id: newId('publication'), documentId: document.id, revision, publishedAt, note, document, ...(rollbackOf ? { rollbackOf } : {}) });
}
export function latestPublication(entries: TopologyPublication[], documentId: string) {
  return entries.filter(p => p.documentId === documentId).reduce<TopologyPublication | undefined>((latest, p) => !latest || p.revision > latest.revision ? p : latest, undefined);
}

export interface PublicationState { version: 1; entries: TopologyPublication[] }
export const MAX_PUBLICATIONS_PER_DOCUMENT = 10;
export const MAX_PUBLICATIONS_TOTAL = 200;
export const MAX_PUBLICATION_BYTES = 2_000_000;
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export function trimPublications(entries: TopologyPublication[]): TopologyPublication[] {
  const active = new Map<string, TopologyPublication>();
  for (const p of entries) if (!active.has(p.documentId) || active.get(p.documentId)!.revision < p.revision) active.set(p.documentId, p);
  let bytes = [...active.values()].reduce((sum, p) => sum + size(p), 0);
  if (bytes > MAX_PUBLICATION_BYTES || active.size > MAX_PUBLICATIONS_TOTAL) throw new Error('当前发布快照超出本地容量，请导出备份并清理不再使用的拓扑，或接入宿主存储');
  const keep = new Set([...active.values()].map(p => p.id)), counts = new Map([...active.keys()].map(id => [id, 1]));
  for (const p of entries) {
    if (keep.has(p.id)) continue;
    const used = counts.get(p.documentId) || 0, length = size(p);
    if (used >= MAX_PUBLICATIONS_PER_DOCUMENT || keep.size >= MAX_PUBLICATIONS_TOTAL || bytes + length > MAX_PUBLICATION_BYTES) continue;
    keep.add(p.id); counts.set(p.documentId, used + 1); bytes += length;
  }
  return entries.filter(p => keep.has(p.id));
}
export function parsePublicationState(input: unknown, documentIds: Set<string>): PublicationState {
  if (input === undefined) return { version: 1, entries: [] };
  const state = input as PublicationState;
  if (!state || state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 1000) throw new Error('本地发布记录格式不合法');
  const ids = new Set<string>(), revisions = new Set<string>();
  const entries = state.entries.map(parsePublication).filter(p => documentIds.has(p.documentId));
  for (const p of entries) {
    const key = `${p.documentId}:${p.revision}`;
    if (ids.has(p.id) || revisions.has(key)) throw new Error('发布记录 ID 或版本重复');
    ids.add(p.id); revisions.add(key);
  }
  entries.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.revision - a.revision);
  return { version: 1, entries: trimPublications(entries) };
}
