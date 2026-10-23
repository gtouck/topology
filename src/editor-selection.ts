import { Selection, type EventArgs } from '@antv/x6';

/** X6 normally treats every cell mouseup as a new selection, including right click. */
export class EditorSelection extends Selection {
  protected onCellMouseUp(args: EventArgs['cell:mouseup']) {
    if (args.e.button !== undefined && args.e.button !== 0) {
      const enabled = this.isEnabled();
      this.disable();
      try { super.onCellMouseUp(args); }
      finally { if (enabled) this.enable(); }
      return;
    }
    super.onCellMouseUp(args);
  }
}
