import type { LinkKind } from './topology';

export type CableStyle = 'solid' | 'dashed' | 'double' | 'jacket' | 'braided';
export interface CableAppearance { style: CableStyle; width: number; color: string; arrows: boolean }
export const cableStyles: Record<CableStyle, { label: string; description: string }> = {
  solid: { label: '简洁实线', description: '清晰的标准连接线' },
  dashed: { label: '分段虚线', description: '通过线型区分不同用途' },
  double: { label: '平行双线', description: '两道并行的线条' },
  jacket: { label: '护套线缆', description: '深色外皮与柔和高光' },
  braided: { label: '编织线缆', description: '交叉编织纹理与护套质感' },
};
const defaults: Record<LinkKind, CableAppearance> = {
  rf: { style: 'braided', width: 8, color: '#b286c7', arrows: false },
  if: { style: 'jacket', width: 7, color: '#d9a855', arrows: false },
  ethernet: { style: 'solid', width: 3, color: '#4a9e92', arrows: true },
  logical: { style: 'dashed', width: 2, color: '#8298bd', arrows: true },
};

export function cableAppearance(kind: LinkKind, appearance?: CableAppearance): CableAppearance {
  return { ...(appearance || defaults[kind]) };
}

export function parseCableAppearance(input: unknown): CableAppearance {
  if (!input || typeof input !== 'object') throw new Error('线缆样式配置不合法');
  const a = input as CableAppearance;
  if (!Object.hasOwn(cableStyles, a.style) || typeof a.width !== 'number' || !Number.isFinite(a.width) || a.width < 1 || a.width > 14 || typeof a.color !== 'string' || !/^#[\da-f]{6}$/i.test(a.color) || typeof a.arrows !== 'boolean') {
    throw new Error('线缆样式、粗细或颜色不合法');
  }
  return { style: a.style, width: a.width, color: a.color, arrows: a.arrows };
}

function mix(color: string, amount: number) {
  const target = amount > 0 ? 255 : 0;
  return '#' + [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(channel + (target - channel) * Math.abs(amount)).toString(16).padStart(2, '0');
  }).join('');
}

// Every layer follows the same X6 connection path, including all manually edited vertices.
export function cableAttributes(appearance: CableAppearance, offline = false, textureId = 'station-cable-braid') {
  const { style, width, arrows } = appearance;
  const color = offline ? '#aeb8b3' : appearance.color;
  const physical = style === 'jacket' || style === 'braided';
  const double = style === 'double';
  const dash = offline ? '6 5' : style === 'dashed' ? `${Math.max(6, width * 2)} ${Math.max(4, width * 1.3)}` : '';
  return {
    wrap: { strokeWidth: Math.max(16, width + 10) },
    line: { stroke: physical ? mix(color, -.38) : color, strokeWidth: width, strokeDasharray: dash, targetMarker: null },
    core: { stroke: double ? '#f9fbfa' : color, strokeWidth: double ? width * .45 : Math.max(.5, width - 2), strokeDasharray: dash, opacity: physical || double ? 1 : 0 },
    texture: { stroke: `url(#${textureId})`, strokeWidth: Math.max(.5, width - 1.5), opacity: style === 'braided' && !offline ? .7 : 0 },
    shine: { stroke: mix(color, .65), strokeWidth: Math.max(.5, width * .18), strokeDasharray: dash, opacity: physical ? .65 : 0 },
    direction: { opacity: arrows ? 1 : 0, targetMarker: arrows ? { name: 'block', width: 7, height: 6, fill: color, stroke: color } : null },
  };
}

export function cablePreview(appearance: CableAppearance) {
  const layers = cableAttributes(appearance);
  const d = 'M9 32H64Q76 32 76 20Q76 8 88 8H180';
  const paths = (['line', 'core', 'texture', 'shine'] as const).map((key) => {
    const attrs = layers[key];
    return `<path d="${d}" fill="none" stroke="${attrs.stroke}" stroke-width="${attrs.strokeWidth}" stroke-dasharray="${'strokeDasharray' in attrs ? attrs.strokeDasharray : ''}" opacity="${'opacity' in attrs ? attrs.opacity : 1}" stroke-linejoin="round" stroke-linecap="round" />`;
  }).join('');
  return `<svg viewBox="0 0 190 44" aria-hidden="true">${paths}${appearance.arrows ? `<path d="M180 4L187 8L180 12Z" fill="${appearance.color}"/>` : ''}</svg>`;
}
