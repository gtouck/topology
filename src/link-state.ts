import type { DeviceStatus } from './topology';

export type LinkStatus = 'up' | 'down' | 'unknown';
export type FlowDirection = 'forward' | 'reverse' | 'both';
export type FlowSpeed = 'slow' | 'normal' | 'fast';
export interface LinkFlow { enabled: boolean; direction: FlowDirection; speed: FlowSpeed }
export interface LinkTelemetry { status: LinkStatus; active?: boolean }
export type LinkTelemetryData = Record<string, LinkTelemetry>;
export type LinkTelemetryPatch = Record<string, Partial<LinkTelemetry>>;
export const linkStatusLabels: Record<LinkStatus, string> = { up: '连通', down: '断开', unknown: '未知' };
export const flowDirections: Record<FlowDirection, string> = { forward: '正向', reverse: '反向', both: '双向' };
export const flowSpeeds: Record<FlowSpeed, string> = { slow: '慢', normal: '标准', fast: '快' };
export const defaultLinkFlow: LinkFlow = { enabled: true, direction: 'forward', speed: 'normal' };

export function parseLinkStatus(value: unknown): LinkStatus {
  if (typeof value !== 'string' || !Object.hasOwn(linkStatusLabels, value)) throw new Error('链路状态应为 up、down 或 unknown');
  return value as LinkStatus;
}
export function parseLinkFlow(value: unknown): LinkFlow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('链路流转配置不合法');
  const flow = value as LinkFlow;
  if (typeof flow.enabled !== 'boolean' || !Object.hasOwn(flowDirections, flow.direction) || !Object.hasOwn(flowSpeeds, flow.speed)) throw new Error('链路流转开关、方向或速度不合法');
  return { enabled: flow.enabled, direction: flow.direction, speed: flow.speed };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('链路实时数据需为按链路 ID 索引的对象');
  return value as Record<string, unknown>;
}
export function parseLinkData(value: unknown): LinkTelemetryData {
  return Object.fromEntries(Object.entries(record(value)).map(([id, input]) => {
    const item = record(input), status = parseLinkStatus(item.status);
    if (item.active !== undefined && typeof item.active !== 'boolean') throw new Error('链路 active 必须为布尔值');
    return [id, { status, ...(item.active === undefined ? {} : { active: item.active }) }];
  }));
}
export function mergeLinkData(current: LinkTelemetryData, patch: unknown): LinkTelemetryData {
  const next = Object.fromEntries(Object.entries(current));
  for (const [id, input] of Object.entries(record(patch))) {
    const item = record(input);
    if (Object.hasOwn(item, 'status')) parseLinkStatus(item.status);
    if (Object.hasOwn(item, 'active') && typeof item.active !== 'boolean') throw new Error('链路 active 必须为布尔值');
    Object.defineProperty(next, id, { value: { status: 'unknown', ...(Object.hasOwn(current, id) ? current[id] : {}), ...item }, enumerable: true, configurable: true, writable: true });
  }
  return parseLinkData(next); // Validate the whole update before callers replace their cache.
}
export function resolveLinkState(config: { status?: LinkStatus }, endpoints: { status: DeviceStatus; pending?: boolean }[], live?: LinkTelemetry, external = false) {
  if (endpoints.some(end => end.status === 'offline' && !end.pending)) return { status: 'down' as const, active: false, reason: 'endpoint' as const };
  if (live) return { status: live.status, active: live.status === 'up' && live.active !== false, reason: 'host' as const };
  if (external || endpoints.some(end => end.pending)) return { status: 'unknown' as const, active: false, reason: 'waiting' as const };
  const status = config.status ?? 'up';
  return { status, active: status === 'up', reason: 'initial' as const };
}
export type ResolvedLinkState = ReturnType<typeof resolveLinkState>;
export function linkStateLabel(state: ResolvedLinkState) {
  return state.reason === 'endpoint' ? '断开 · 端点离线' : state.reason === 'waiting' ? '等待链路数据' : state.status === 'up' && !state.active ? '连通 · 空闲' : linkStatusLabels[state.status];
}
