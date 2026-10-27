import { newId, parseDocument, type TopologyDocument } from './document';
import { documentSignature } from './document-signature';

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
