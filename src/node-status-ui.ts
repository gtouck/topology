import { nodeStatus, statusGlyph } from './node-status';
import type { DeviceStatus } from './topology';
import { freshnessLabel, type FreshnessState, type FreshnessPhase } from './data-freshness';

function setVariables(element: HTMLElement, state: ReturnType<typeof nodeStatus>) {
  element.dataset.status = state.tone;
  for (const key of ['color', 'border', 'background', 'surface'] as const) element.style.setProperty(`--device-state-${key}`, state[key]);
}

export function updateNodeStatus(card: HTMLElement, status: DeviceStatus, pending: boolean, label?: string, freshness?: FreshnessPhase) {
  const state = nodeStatus(status, pending, label, freshness), text = card.querySelector<HTMLElement>('.device-status-text')!;
  if (card.dataset.status === state.tone && text.textContent === state.label && card.classList.contains(status)) return;
  card.classList.remove('normal', 'warning', 'offline', 'pending'); card.classList.add(status);
  if (pending) card.classList.add('pending');
  setVariables(card, state);
  const title = card.querySelector('.device-card-heading strong')?.textContent || '';
  card.setAttribute('aria-label', `${title} · ${state.label}`);
  const marker = card.querySelector<HTMLElement>('.device-status-dot')!;
  marker.innerHTML = statusGlyph(state.tone, 12); marker.title = state.label; marker.setAttribute('aria-label', state.label);
  text.textContent = state.label; text.title = state.label;
}

export function updateStatusBadge(badge: HTMLElement, status: DeviceStatus, pending: boolean, label?: string, freshness?: FreshnessPhase) {
  const state = nodeStatus(status, pending, label, freshness);
  badge.className = `status-pill ${state.tone}`; setVariables(badge, state);
  badge.innerHTML = statusGlyph(state.tone, 12);
  badge.appendChild(document.createTextNode(state.label));
}
export function updateReceivedState(element: HTMLElement | SVGElement, state: FreshnessState) {
  element.dataset.freshness = state.phase;
  element.dataset.receivedAt = state.receivedAt === null ? '' : String(state.receivedAt);
  const text = state.receivedAt === null ? freshnessLabel(state) : `${freshnessLabel(state)} · 接收于 ${new Date(state.receivedAt).toLocaleTimeString('zh-CN', { hour12: false })}`;
  if (element instanceof HTMLElement && element.matches('[data-received-label]')) element.textContent = text;
  element.setAttribute('title', text);
  return text;
}
