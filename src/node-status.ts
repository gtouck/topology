import { vectorIcon, type IconName } from './icons';
import { statusLabels, type DeviceStatus } from './topology';
import type { FreshnessPhase } from './data-freshness';

export type NodeStatusTone = DeviceStatus | 'pending' | 'stale' | 'disconnected';
export const nodeStatusStyles: Record<NodeStatusTone, { color: string; border: string; background: string; surface: string; dash: string; icon: IconName }> = {
  normal: { color: '#529579', border: '#bad7c9', background: '#eef7f1', surface: '#ffffff', dash: '', icon: 'CircleCheck' },
  warning: { color: '#ba8732', border: '#e2c68f', background: '#fff4df', surface: '#fffdfa', dash: '', icon: 'CircleAlert' },
  offline: { color: '#8898a4', border: '#bdc9d1', background: '#edf1f4', surface: '#f7f9fa', dash: '5 3', icon: 'Unplug' },
  pending: { color: '#7297bd', border: '#b7cde2', background: '#edf4fb', surface: '#ffffff', dash: '2 3', icon: 'Clock3' },
  stale: { color: '#a78c55', border: '#d9c8a3', background: '#f7f1e5', surface: '#fffdf8', dash: '3 3', icon: 'Clock3' },
  disconnected: { color: '#b0796e', border: '#d9bcb6', background: '#f8eeeb', surface: '#fffaf8', dash: '7 3', icon: 'Unplug' },
};

/** Waiting is presentation state; the persisted status enum remains unchanged. */
export function nodeStatus(status: DeviceStatus, pending = false, label?: string, freshness?: FreshnessPhase) {
  const tone: NodeStatusTone = freshness === 'stale' || freshness === 'disconnected' ? freshness : pending ? 'pending' : status;
  return { tone, ...nodeStatusStyles[tone], label: tone === 'stale' ? '数据已过期' : tone === 'disconnected' ? '数据连接中断' : pending ? '等待数据' : label || statusLabels[status] };
}

export function statusGlyph(tone: NodeStatusTone, size = 14) { return vectorIcon(nodeStatusStyles[tone].icon, size); }
