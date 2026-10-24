import type { TopologyDocument } from './document';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)])) : value;
}
/** Content identity ignores save time, while preserving array order and geometry. */
export function documentSignature(document: TopologyDocument) {
  const { updatedAt: _updatedAt, ...content } = document;
  return JSON.stringify(sorted(content));
}
