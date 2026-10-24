import { nodeStatus, statusGlyph } from './node-status';
import type { DeviceStatus } from './topology';

function setVariables(element: HTMLElement, state: ReturnType<typeof nodeStatus>) {
  element.dataset.status = state.tone;
  for (const key of ['color', 'border', 'background', 'surface'] as const) element.style.setProperty(`--device-state-${key}`, state[key]);
}

export function updateNodeStatus(card: HTMLElement, status: DeviceStatus, pending: boolean, label?: string) {
  const state = nodeStatus(status, pending, label), text = card.querySelector<HTMLElement>('.device-status-text')!;
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

export function updateStatusBadge(badge: HTMLElement, status: DeviceStatus, pending: boolean, label?: string) {
  const state = nodeStatus(status, pending, label);
  badge.className = `status-pill ${state.tone}`; setVariables(badge, state);
  badge.innerHTML = statusGlyph(state.tone, 12);
  badge.appendChild(document.createTextNode(state.label));
}
