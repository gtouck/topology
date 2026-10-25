import { newId, parseDocument, type TopologyDocument } from './document';
import { documentSignature } from './document-signature';
import { LIBRARY_KEY } from './library';
import { parseWorkspace, type Workspace } from './workspace';
import { STORAGE_KEY } from './topology';
import { parseMigrationWorkspace } from '../shared/migration';

export const RECOVERY_PREFIX = 'topology-server-recovery-v1:';
export interface RecoveryCopy { document: TopologyDocument; baseSignature: string; savedAt: string }
export class ServerRecovery {
  private tabId: string;
  // Duplicated tabs can clone sessionStorage; each page needs a distinct writer.
  constructor(private storage: Storage) { this.tabId = newId('writer'); }
  save(document: TopologyDocument, baseSignature: string) {
    const record: RecoveryCopy = { document, baseSignature, savedAt: new Date().toISOString() };
    this.storage.setItem(`${RECOVERY_PREFIX}${this.tabId}:${document.id}`, JSON.stringify(record));
  }
  acknowledge(document: TopologyDocument) {
    const key = `${RECOVERY_PREFIX}${this.tabId}:${document.id}`, raw = this.storage.getItem(key);
    if (raw && documentSignature(JSON.parse(raw).document) === documentSignature(document)) this.storage.removeItem(key);
  }
  remove(key: string) { if (!key.startsWith(RECOVERY_PREFIX)) throw new Error('恢复记录不合法'); this.storage.removeItem(key); }
  entries(): (RecoveryCopy & { key: string })[] {
    const entries: (RecoveryCopy & { key: string })[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i); if (!key || !key.startsWith(RECOVERY_PREFIX)) continue;
      try {
        const record = JSON.parse(this.storage.getItem(key)!) as RecoveryCopy;
        if (typeof record.baseSignature !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) continue;
        entries.push({ key, ...record, document: parseDocument(record.document) });
      } catch { /* Keep unreadable originals for a storage-level backup. */ }
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
}

export const browserMigrationRaw = (storage: Storage) => storage.getItem(LIBRARY_KEY) ?? storage.getItem(STORAGE_KEY);
export function browserMigrationSource(storage: Storage): Workspace | null {
  const raw = storage.getItem(LIBRARY_KEY);
  if (raw !== null) return parseMigrationWorkspace(JSON.parse(raw));
  const legacy = storage.getItem(STORAGE_KEY); if (legacy === null) return null;
  const input = JSON.parse(legacy), document = parseDocument(input);
  if (input.version === 1 && input.format === undefined) {
    // The old single-drawing format has no ID. Repeated reads/imports must map
    // the exact same source to one document, including on another browser.
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < legacy.length; i++) { a = Math.imul(a ^ legacy.charCodeAt(i), 16777619); b = Math.imul(b ^ legacy.charCodeAt(i), 3266489917); }
    document.id = `legacy-${legacy.length.toString(36)}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
    if (typeof input.savedAt !== 'string' || !Number.isFinite(Date.parse(input.savedAt))) document.createdAt = document.updatedAt = '1970-01-01T00:00:00.000Z';
  }
  return parseWorkspace({ version: 1, activeId: document.id, documents: [document] });
}
