import { statusLabels, type DeviceData, type DeviceDefinition, type DeviceStatus } from './topology';
import { freshnessLabel, isUnavailable, isExpired, type FreshnessState } from './data-freshness';

export type TelemetryData = Record<string, Record<string, unknown>>;
export function parseTelemetryData(input: unknown): TelemetryData {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.values(input).some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw new Error('实时数据需为按业务对象 ID 索引的对象');
  return structuredClone(input) as TelemetryData;
}
export function mergeTelemetryData(current: TelemetryData, input: unknown): TelemetryData {
  const patch = parseTelemetryData(input), next = { ...current };
  for (const [key, value] of Object.entries(patch)) Object.defineProperty(next, key, { value: { ...(Object.hasOwn(current, key) ? current[key] : {}), ...value }, writable: true, configurable: true, enumerable: true });
  return next;
}
export function readField(record: unknown, path: string): unknown {
  let value = record;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || ['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function resolveNodeData(data: DeviceData, definition: DeviceDefinition, telemetry: TelemetryData, received?: FreshnessState) {
  const binding = data.binding || { source: data.deviceId, fields: Object.fromEntries(definition.metrics.map((m) => [m.key, m.key])), statusField: 'status' };
  const record = Object.hasOwn(telemetry, binding.source) ? telemetry[binding.source] : undefined;
  const freshness = received ?? { phase: record ? 'fresh' as const : 'waiting' as const, receivedAt: null };
  const pending = !record || freshness.phase === 'waiting';
  const rawStatus = record && binding.statusField ? readField(record, binding.statusField) : undefined;
  const statusKey = String(rawStatus);
  const mapped = binding.statusMap && Object.hasOwn(binding.statusMap, statusKey) ? binding.statusMap[statusKey] : undefined;
  const status: DeviceStatus = pending ? 'offline' : mapped ?? (typeof rawStatus === 'string' && Object.hasOwn(statusLabels, rawStatus) ? rawStatus as DeviceStatus : data.status);
  const values: Record<string, string> = {};
  for (const m of definition.metrics) {
    const raw = binding.fields[m.key] ? readField(record, binding.fields[m.key]) : undefined;
    values[m.key] = status === 'offline' || isUnavailable(freshness) || raw === undefined || raw === null ? '—' : typeof raw === 'number' ? Number.isFinite(raw) ? raw.toFixed(m.decimals) : '—' : typeof raw === 'boolean' ? raw ? '是' : '否' : typeof raw === 'string' ? raw.slice(0, 100) : '—';
  }
  return { source: binding.source, pending, status, values, freshness, stale: isExpired(freshness), label: isExpired(freshness) ? freshnessLabel(freshness) : pending ? '等待数据' : statusLabels[status] };
}
