import { expect, test } from 'bun:test';
import { sampleDocument } from '../src/document';
import { EditorHistory } from '../src/editor-history';

test('S12 历史保存独立克隆，忽略保存时间且保留手工路径', () => {
  const history = new EditorHistory(), doc = sampleDocument('ground-station'), baseline = structuredClone(doc);
  expect(history.canUndo).toBe(false); expect(history.undo()).toBeNull();
  history.activate(doc); doc.updatedAt = new Date().toISOString(); expect(history.record(doc)).toBe(false);
  doc.topology.nodes[0].x += 30; doc.topology.edges[0].vertices[0].x += 40; history.record(doc);
  const changed = structuredClone(doc); doc.topology.nodes[0].x = 999;
  const undone = history.undo()!; expect(undone).toEqual(baseline); undone.topology.edges[0].vertices[0].x = 999;
  expect(history.redo()).toEqual(changed); expect(history.redo()).toBeNull();
  expect(history.undo()).toEqual(baseline);
});

test('S12 多图撤销和分支独立，删除释放历史，错图记录不会改变状态', () => {
  const history = new EditorHistory(), first = sampleDocument('ground-station'), second = sampleDocument('datacenter'), firstBaseline = structuredClone(first);
  history.activate(first); first.name = '第一张修改'; history.record(first); history.undo();
  history.activate(second); expect(history.canRedo).toBe(false); second.name = '第二张修改'; history.record(second);
  history.activate(firstBaseline); expect(history.canRedo).toBe(true); expect(history.redo()!.name).toBe('第一张修改');
  const branch = history.undo()!; branch.name = '新的分支'; history.record(branch); expect(history.canRedo).toBe(false);
  expect(() => history.record(second)).toThrow('不匹配'); expect(history.canUndo).toBe(true);
  history.activate(second); expect(history.undo()!.name).not.toBe('第二张修改');
  history.forget(second.id); expect(history.canUndo).toBe(false); history.activate(second); expect(history.canUndo).toBe(false);
});

test('S12 历史容量有界，重新打开会记录未合并的最后一笔编辑', () => {
  const history = new EditorHistory(2), doc = sampleDocument('ground-station'); history.activate(doc);
  for (let i = 1; i <= 4; i++) { doc.name = `修改 ${i}`; history.record(doc); }
  expect(history.undo()!.name).toBe('修改 3'); expect(history.undo()!.name).toBe('修改 2'); expect(history.undo()).toBeNull();
  doc.name = '切图前编辑'; history.activate(doc); expect(history.canRedo).toBe(false); expect(history.undo()!.name).toBe('修改 2');
  expect(() => new EditorHistory(0)).toThrow();
});
