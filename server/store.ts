import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { emptyLibrary, LIBRARY_KEY, type LibraryStorage } from '../src/library';
import { WorkspaceConflict, WorkspaceStore, parseWorkspace, type Workspace } from '../src/workspace';
import { PublicationConflict } from '../src/publication';
import type { ApiErrorCode, WorkspaceCommandRequest, WorkspaceResponse } from '../shared/api';
import { parseWorkspaceImport } from '../shared/workspace-import';

export class ApiFailure extends Error {
  constructor(public status: number, public code: ApiErrorCode, message: string, public details: { currentRevision?: number; conflictingIds?: string[] } = {}) { super(message); }
}

export function strictObject(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiFailure(422, 'INVALID_INPUT', '请求必须是对象');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(result, key))) throw new ApiFailure(422, 'INVALID_INPUT', '请求包含未知字段或缺少必要字段');
  return result;
}
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const identifier = (value: unknown) => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function parseCommandRequest(input: unknown): WorkspaceCommandRequest {
  const request = strictObject(input, ['expectedRevision', 'requestId', 'command']);
  if (!integer(request.expectedRevision) || !identifier(request.requestId)) throw new ApiFailure(422, 'INVALID_INPUT', '版本或请求 ID 不合法');
  const type = (request.command as { type?: unknown } | null)?.type;
  const fields: Record<string, string[]> = {
    saveDraft: ['document'], saveDocument: ['document'], updateLibrary: ['library'],
    restoreDraft: ['documentId', 'versionId', 'current'], discardDraft: ['documentId'],
    publish: ['document', 'expectedPublicationRevision', 'note'],
    rollbackPublication: ['documentId', 'publicationId', 'expectedPublicationRevision', 'note'],
    importWorkspace: ['workspace'],
  };
  if (typeof type !== 'string' || !Object.hasOwn(fields, type)) throw new ApiFailure(422, 'INVALID_INPUT', '不支持的工作区命令');
  const keys = ['type', ...fields[type]], command = strictObject(request.command, keys, keys.filter(key => key !== 'note'));
  for (const key of ['documentId', 'versionId', 'publicationId']) if (Object.hasOwn(command, key) && !identifier(command[key])) throw new ApiFailure(422, 'INVALID_INPUT', '文档或版本 ID 不合法');
  if (Object.hasOwn(command, 'expectedPublicationRevision') && !integer(command.expectedPublicationRevision)) throw new ApiFailure(422, 'INVALID_INPUT', '发布版本不合法');
  if (Object.hasOwn(command, 'note') && (typeof command.note !== 'string' || command.note.length > 500)) throw new ApiFailure(422, 'INVALID_INPUT', '发布说明不合法');
  return request as unknown as WorkspaceCommandRequest;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function documentBundle(workspace: Workspace, id: string) {
  const sort = <T extends { id: string }>(entries: T[]) => entries.sort((a, b) => a.id.localeCompare(b.id));
  return stable({ document: workspace.documents.find(document => document.id === id), draft: workspace.editing.drafts.find(draft => draft.document.id === id) ?? null, history: sort(workspace.editing.history.filter(entry => entry.document.id === id)), publications: sort(workspace.publishing.entries.filter(entry => entry.documentId === id)) });
}
function importBackup(current: Workspace, input: Workspace, pristine: boolean) {
  const incoming = parseWorkspaceImport(input);
  if (pristine) return incoming;
  const existing = new Set(current.documents.map(document => document.id));
  const conflicts = incoming.documents.filter(document => existing.has(document.id) && documentBundle(current, document.id) !== documentBundle(incoming, document.id)).map(document => document.id);
  if (conflicts.length) throw new ApiFailure(409, 'IMPORT_CONFLICT', '备份与服务器存在同 ID 的不同内容，导入未执行。请处理冲突后重试', { conflictingIds: conflicts });
  const added = new Set(incoming.documents.filter(document => !existing.has(document.id)).map(document => document.id));
  if (!added.size) return current;
  const combined: Workspace = {
    ...current, documents: [...current.documents, ...incoming.documents.filter(document => added.has(document.id))],
    editing: { ...current.editing, drafts: [...current.editing.drafts, ...incoming.editing.drafts.filter(entry => added.has(entry.document.id))], history: [...current.editing.history, ...incoming.editing.history.filter(entry => added.has(entry.document.id))].sort((a, b) => b.savedAt.localeCompare(a.savedAt)) },
    publishing: { version: 1, entries: [...current.publishing.entries, ...incoming.publishing.entries.filter(entry => added.has(entry.documentId))] },
  };
  return parseWorkspaceImport(combined);
}

interface WorkspaceRow { revision: number; body: string; pristine: number }
export class ServerStore {
  readonly database: Database;
  constructor(filename: string) {
    this.database = new Database(filename, { create: true, strict: true });
    const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > 1) { this.database.close(); throw new Error('数据库版本高于当前程序支持范围，请恢复兼容的程序版本；数据库未修改'); }
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.database.exec(`CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, body TEXT NOT NULL, pristine INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    this.database.query('INSERT OR IGNORE INTO workspace (id,revision,body,pristine) VALUES (1,0,?,1)').run(JSON.stringify(parseWorkspace(emptyLibrary())));
    this.database.exec('PRAGMA user_version=1');
  }
  read(): WorkspaceResponse {
    const row = this.database.query('SELECT revision,body FROM workspace WHERE id=1').get() as WorkspaceRow;
    return { revision: row.revision, workspace: parseWorkspace(JSON.parse(row.body)) };
  }
  execute(request: WorkspaceCommandRequest): WorkspaceResponse {
    const fingerprint = createHash('sha256').update(stable(request)).digest('hex');
    return this.database.transaction(() => {
      const previous = this.database.query('SELECT fingerprint,response FROM requests WHERE id=?').get(request.requestId) as { fingerprint: string; response: string } | null;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiFailure(409, 'REQUEST_ID_CONFLICT', '请求 ID 已用于不同的操作，请勿复用');
        return JSON.parse(previous.response) as WorkspaceResponse;
      }
      const row = this.database.query('SELECT revision,body,pristine FROM workspace WHERE id=1').get() as WorkspaceRow;
      if (row.revision !== request.expectedRevision) throw new ApiFailure(409, 'WORKSPACE_CONFLICT', '其他浏览器已修改拓扑库。当前画布保留，请先备份并重新读取', { currentRevision: row.revision });
      let raw = row.body;
      const storage: LibraryStorage = { getItem: key => key === LIBRARY_KEY ? raw : null, setItem: (key, value) => { if (key !== LIBRARY_KEY) throw new Error('Invalid storage key'); raw = value; } };
      const store = new WorkspaceStore(storage), command = request.command;
      let next: Workspace;
      try {
        switch (command.type) {
          case 'saveDraft': next = store.saveDraft(command.document); break;
          case 'saveDocument': next = store.saveDocument(command.document); break;
          case 'updateLibrary': next = store.updateLibrary(command.library); break;
          case 'restoreDraft': next = store.restoreDraft(command.documentId, command.versionId, command.current); break;
          case 'discardDraft': next = store.discardDraft(command.documentId); break;
          case 'publish': next = store.publish(command.document, command.expectedPublicationRevision, command.note); break;
          case 'rollbackPublication': next = store.rollbackPublication(command.documentId, command.publicationId, command.expectedPublicationRevision, command.note); break;
          case 'importWorkspace': next = importBackup(store.snapshot(), command.workspace, row.pristine === 1); break;
          default: throw new ApiFailure(422, 'INVALID_INPUT', '不支持的工作区命令');
        }
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        if (error instanceof PublicationConflict) throw new ApiFailure(409, 'PUBLICATION_CONFLICT', error.message);
        if (error instanceof WorkspaceConflict) throw new ApiFailure(409, 'WORKSPACE_CONFLICT', error.message, { currentRevision: row.revision });
        throw new ApiFailure(422, 'INVALID_INPUT', error instanceof Error ? error.message : '拓扑数据不合法');
      }
      const body = JSON.stringify(next), unchanged = command.type === 'importWorkspace' && stable(next) === stable(store.snapshot());
      const response = { revision: row.revision + (unchanged ? 0 : 1), workspace: next };
      this.database.query('UPDATE workspace SET revision=?,body=?,pristine=0 WHERE id=1').run(response.revision, body);
      this.database.query('INSERT INTO requests (id,fingerprint,response,created_at) VALUES (?,?,?,?)').run(request.requestId, fingerprint, JSON.stringify(response), Date.now());
      // Retry receipts are bounded; clients must not retry an old operation after reloading a newer workspace.
      this.database.exec(`DELETE FROM requests WHERE rowid IN (
        SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (ORDER BY rowid DESC) AS position,
          SUM(length(CAST(response AS BLOB))) OVER (ORDER BY rowid DESC) AS total_bytes FROM requests)
        WHERE position > 1 AND (position > 100 OR total_bytes > 33554432))`);
      return response;
    }).immediate();
  }
  close() { this.database.close(); }
}
