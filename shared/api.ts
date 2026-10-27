import type { TopologyDocument } from '../src/document';
import type { TopologyLibrary } from '../src/library';
import type { Workspace } from '../src/workspace';

export interface WorkspaceResponse { revision: number; workspace: Workspace }
export interface SessionResponse { authenticated: boolean; username?: string }
export type WorkspaceCommand =
  | { type: 'saveDraft'; document: TopologyDocument }
  | { type: 'saveDocument'; document: TopologyDocument }
  | { type: 'updateLibrary'; library: TopologyLibrary }
  | { type: 'restoreDraft'; documentId: string; versionId: string; current: TopologyDocument }
  | { type: 'discardDraft'; documentId: string }
  | { type: 'publish'; document: TopologyDocument; expectedPublicationRevision: number; note?: string }
  | { type: 'rollbackPublication'; documentId: string; publicationId: string; expectedPublicationRevision: number; note?: string }
  | { type: 'importWorkspace'; workspace: Workspace };
export interface WorkspaceCommandRequest { expectedRevision: number; requestId: string; command: WorkspaceCommand }
export type ApiErrorCode = 'AUTH_REQUIRED' | 'INVALID_CREDENTIALS' | 'INVALID_INPUT' | 'WORKSPACE_CONFLICT' | 'PUBLICATION_CONFLICT' | 'IMPORT_CONFLICT' | 'REQUEST_ID_CONFLICT' | 'BODY_TOO_LARGE' | 'ORIGIN_REJECTED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'INTERNAL_ERROR';
export interface ApiErrorResponse { error: { code: ApiErrorCode; message: string; currentRevision?: number; conflictingIds?: string[] } }
