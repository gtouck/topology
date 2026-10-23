import { statusLabels, type DeviceDefinition, type DeviceStatus, type MetricDefinition } from './topology';

export type EditorDataMode = 'simulation' | 'external';

export function formatMetricValue(value: unknown, metric: MetricDefinition) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(metric.decimals) : '—';
}

/** Runtime state stays outside saved documents and the editor's undo history. */
export class EditorTelemetry {
  private currentMode: EditorDataMode = 'simulation';
  readonly values = new Map<string, Record<string, number>>();
  readonly statuses = new Map<string, DeviceStatus>();
  readonly history = new Map<string, number[]>();

  get mode() { return this.currentMode; }

  clear() { this.values.clear(); this.statuses.clear(); this.history.clear(); }

  setMode(mode: EditorDataMode) {
    if (mode !== 'simulation' && mode !== 'external') throw new Error('数据模式不合法');
    if (mode === this.currentMode) return false;
    this.clear(); this.currentMode = mode;
    return true;
  }

  prune(ids: Set<string>) {
    for (const map of [this.values, this.statuses, this.history]) {
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    }
  }

  sample(id: string, definition: DeviceDefinition, status: DeviceStatus, tick: number, index: number, paused: boolean) {
    if (this.mode !== 'simulation' || (paused && this.values.has(id))) return false;
    const next = Object.fromEntries(definition.metrics.map((metric, j) => [metric.key, metric.base + Math.sin(tick * .67 + index * 1.6 + j) * metric.jitter]));
    this.values.set(id, next);
    this.recordHistory(id, definition.metrics[0]?.key, status);
    return true;
  }

  recordHistory(id: string, key: string | undefined, status: DeviceStatus) {
    const value = key ? this.values.get(id)?.[key] : undefined;
    if (status === 'offline' || typeof value !== 'number' || !Number.isFinite(value)) return;
    this.history.set(id, [...(this.history.get(id) || []), value].slice(-30));
  }

  update(ids: string[], metrics: Record<string, number>, status?: DeviceStatus) {
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || Object.values(metrics).some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('设备参数必须是有限数值');
    if (status !== undefined && !Object.hasOwn(statusLabels, status)) throw new Error('设备状态不合法');
    if (!ids.length) return 0;
    this.setMode('external');
    for (const id of ids) {
      this.values.set(id, { ...this.values.get(id), ...metrics });
      if (status !== undefined) this.statuses.set(id, status);
    }
    return ids.length;
  }
}
