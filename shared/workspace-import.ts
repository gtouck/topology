import { parseWorkspace, type Workspace } from '../src/workspace';

/** A complete backup import must not silently discard retained records. */
export function parseWorkspaceImport(input: unknown): Workspace {
  const parsed = parseWorkspace(input), original = input as Partial<Workspace>;
  if ((original.editing?.history?.length ?? 0) !== parsed.editing.history.length ||
      (original.editing?.drafts?.length ?? 0) !== parsed.editing.drafts.length ||
      (original.publishing?.entries?.length ?? 0) !== parsed.publishing.entries.length) {
    throw new Error('导入将丢失草稿、历史或发布记录，请先整理容量及文档引用后重试；服务器内容未更改');
  }
  return parsed;
}
