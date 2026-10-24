import type { TopologyDocument } from './document';
import { documentSignature } from './document-signature';

interface History { undo: TopologyDocument[]; redo: TopologyDocument[] }

/** Document-only session history. Graph events, timers, telemetry and storage live outside. */
export class EditorHistory {
  private documents = new Map<string, History>();
  private activeId: string | null = null;
  constructor(private maxUndo = 50) {
    if (!Number.isInteger(maxUndo) || maxUndo < 1) throw new Error('撤销步数必须为正整数');
  }
  private get current() { return this.activeId ? this.documents.get(this.activeId) : undefined; }
  get canUndo() { return (this.current?.undo.length ?? 0) > 1; }
  get canRedo() { return !!this.current?.redo.length; }
  activate(document: TopologyDocument) {
    this.activeId = document.id;
    if (!this.documents.has(document.id)) this.documents.set(document.id, { undo: [], redo: [] });
    this.record(document);
  }
  record(document: TopologyDocument) {
    if (document.id !== this.activeId || !this.current) throw new Error('撤销历史与当前拓扑不匹配');
    const history = this.current, previous = history.undo.at(-1);
    if (previous && documentSignature(previous) === documentSignature(document)) return false;
    history.undo.push(structuredClone(document));
    if (history.undo.length > this.maxUndo + 1) history.undo.shift();
    history.redo = []; return true;
  }
  undo() {
    if (!this.canUndo) return null;
    const history = this.current!;
    history.redo.push(history.undo.pop()!);
    return structuredClone(history.undo.at(-1)!);
  }
  redo() {
    const history = this.current, next = history?.redo.pop();
    if (!next) return null;
    history!.undo.push(next); return structuredClone(next);
  }
  forget(id: string) {
    this.documents.delete(id);
    if (this.activeId === id) this.activeId = null;
  }
}
