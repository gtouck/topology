import { vectorIcon, type IconName } from './icons';
import { statusLabels, type DeviceStatus } from './topology';

export type NodeStatusTone = DeviceStatus | 'pending';
export const nodeStatusStyles: Record<NodeStatusTone, { color: string; border: string; background: string; surface: string; dash: string; icon: IconName }> = {
  normal: { color: '#529579', border: '#bad7c9', background: '#eef7f1', surface: '#ffffff', dash: '', icon: 'CircleCheck' },
  warning: { color: '#ba8732', border: '#e2c68f', background: '#fff4df', surface: '#fffdfa', dash: '', icon: 'CircleAlert' },
  offline: { color: '#8898a4', border: '#bdc9d1', background: '#edf1f4', surface: '#f7f9fa', dash: '5 3', icon: 'Unplug' },
  pending: { color: '#7297bd', border: '#b7cde2', background: '#edf4fb', surface: '#ffffff', dash: '2 3', icon: 'Clock3' },
};

/** Waiting is presentation state; the persisted status enum remains unchanged. */
export function nodeStatus(status: DeviceStatus, pending = false, label?: string) {
  const tone: NodeStatusTone = pending ? 'pending' : status;
  return { tone, ...nodeStatusStyles[tone], label: pending ? '等待数据' : label || statusLabels[status] };
}

export function statusGlyph(tone: NodeStatusTone, size = 14) { return vectorIcon(nodeStatusStyles[tone].icon, size); }
