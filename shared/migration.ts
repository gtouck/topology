import { parseWorkspace, type Workspace } from '../src/workspace';

/** Migration must never silently apply the editor's history-retention cleanup. */
export function parseMigrationWorkspace(input: unknown): Workspace {
  const parsed = parseWorkspace(input), original = input as Partial<Workspace>;
  if ((original.editing?.history?.length ?? 0) !== parsed.editing.history.length ||
      (original.editing?.drafts?.length ?? 0) !== parsed.editing.drafts.length ||
      (original.publishing?.entries?.length ?? 0) !== parsed.publishing.entries.length) {
    throw new Error('迁移将丢失草稿、历史或发布记录，请先整理容量及文档引用后重试；本机原存档保持不变');
  }
  return parsed;
}
