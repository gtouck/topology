export type FreshnessPhase = 'waiting' | 'fresh' | 'stale' | 'disconnected' | 'snapshot';
export type ConnectionState = 'connected' | 'disconnected';
export interface FreshnessOptions { staleAfterMs?: number }
export interface FreshnessState { phase: FreshnessPhase; receivedAt: number | null }
export type FreshnessSnapshot = Record<string, FreshnessState>;
export interface RuntimeDataStatus { nodes: FreshnessSnapshot; links: FreshnessSnapshot; connection: ConnectionState; staleAfterMs: number; mode: 'live' | 'snapshot' | 'simulation' }
export const DEFAULT_STALE_AFTER_MS = 15_000;
const phases: FreshnessPhase[] = ['waiting', 'fresh', 'stale', 'disconnected', 'snapshot'];
export function parseFreshness(options: FreshnessOptions): number {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('新鲜度设置不合法');
  const value = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isInteger(value) || (value !== 0 && (value < 100 || value > 86_400_000))) throw new Error('数据超时应为 100–86400000 毫秒，0 表示关闭');
  return value;
}
export function parseFreshnessSnapshot(value: unknown): FreshnessSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('快照接收状态不合法');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const state = item as FreshnessState;
    if (!state || !phases.includes(state.phase) || (state.receivedAt !== null && (typeof state.receivedAt !== 'number' || !Number.isFinite(state.receivedAt) || state.receivedAt < 0))) throw new Error('快照接收时间或状态不合法');
    return [key, { phase: state.phase, receivedAt: state.receivedAt }];
  }));
}
export function isUnavailable(state: FreshnessState) { return state.phase === 'waiting' || isExpired(state); }
export function isExpired(state: FreshnessState) { return state.phase === 'stale' || state.phase === 'disconnected'; }
export function freshnessLabel(state: FreshnessState) {
  return state.phase === 'disconnected' ? '数据连接中断' : state.phase === 'stale' ? '数据已过期' : state.phase === 'waiting' ? '等待数据' : state.phase === 'snapshot' ? '导出快照' : '数据已接收';
}

/** Receive time is local runtime state, never stored in topology definitions. */
export class FreshnessTracker {
  private receipts = new Map<string, number>();
  private invalidated = new Set<string>();
  private frozen = new Map<string, FreshnessState>();
  connection: ConnectionState = 'connected';
  staleAfterMs: number;
  constructor(options: FreshnessOptions = {}, private now = () => Date.now()) { this.staleAfterMs = parseFreshness(options); }
  configure(options: FreshnessOptions) { this.staleAfterMs = parseFreshness(options); }
  clear() { this.receipts.clear(); this.invalidated.clear(); this.frozen.clear(); this.connection = 'connected'; }
  prune(keys: Set<string>) { for (const map of [this.receipts, this.invalidated, this.frozen]) for (const key of map.keys()) if (!keys.has(key)) map.delete(key); }
  freeze(keys: string[], state: FreshnessSnapshot = {}) {
    const checked = parseFreshnessSnapshot(state); this.clear();
    for (const key of new Set([...keys, ...Object.keys(checked)])) this.frozen.set(key, Object.hasOwn(checked, key) ? checked[key] : { phase: 'snapshot', receivedAt: null });
  }
  receive(keys: string[], replace = false) {
    if (!replace && !keys.length) return;
    if (replace) { this.receipts.clear(); this.invalidated.clear(); }
    this.frozen.clear();
    const now = this.now();
    for (const key of keys) { this.receipts.set(key, now); this.invalidated.delete(key); }
  }
  setConnection(state: ConnectionState) {
    if (state !== 'connected' && state !== 'disconnected') throw new Error('数据连接状态不合法');
    if (state === 'disconnected') for (const key of this.receipts.keys()) this.invalidated.add(key);
    this.connection = state;
  }
  state(key: string, now = this.now()): FreshnessState {
    const frozen = this.frozen.get(key); if (frozen) return { ...frozen };
    const receivedAt = this.receipts.get(key) ?? null;
    const phase = this.connection === 'disconnected' ? 'disconnected' : receivedAt === null ? 'waiting' : this.invalidated.has(key) || (this.staleAfterMs > 0 && now - receivedAt >= this.staleAfterMs) ? 'stale' : 'fresh';
    return { phase, receivedAt };
  }
  snapshot(keys: string[]): FreshnessSnapshot { const now = this.now(); return Object.fromEntries(keys.map(key => [key, this.state(key, now)])); }
  nextDelay() {
    if (!this.staleAfterMs || this.connection === 'disconnected') return null;
    const now = this.now(), deadlines = [...this.receipts].filter(([key]) => this.state(key, now).phase === 'fresh').map(([, time]) => time + this.staleAfterMs - now);
    return deadlines.length ? Math.max(1, Math.min(...deadlines)) : null;
  }
}
