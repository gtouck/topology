import { escapeHtml } from './icons';
import type { DiagramElement } from './diagram';
import { linkTypes, type Snapshot } from './topology';
import { cableAppearance, cableStyles, cableAttributes } from './cables';
import { nodeStatusStyles, statusGlyph, type NodeStatusTone } from './node-status';

const esc = (value: unknown) => escapeHtml(String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''));
function wrapped(text: string, width: number, size: number, maxLines: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '', used = 0;
    for (const char of paragraph) {
      const length = (char.codePointAt(0)! > 255 ? 1 : .6) * size;
      if (used + length > width && line) { lines.push(line); line = ''; used = 0; }
      line += char; used += length;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = (lines[maxLines - 1] || '').slice(0, -1) + '…'; }
  return lines;
}
function label(text: string, x: number, y: number, size: number, color: string, width: number) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" pointer-events="none">${esc(wrapped(text, width, size, 1)[0] || '')}</text>`;
}
/** Same pure SVG in the editor, viewer, thumbnail and vector/bitmap exports. */
export function diagramSvg(element: DiagramElement, snapshot: Snapshot) {
  const { width: w, height: h, color } = element;
  const body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="9" fill="${element.kind === 'group' ? color : '#fffefb'}" fill-opacity="${element.kind === 'group' ? '.07' : '1'}" stroke="${color}" stroke-width="1.5" ${element.kind === 'group' ? 'stroke-dasharray="7 4" pointer-events="stroke"' : ''}/>`;
  if (element.kind === 'group') return `${body}<rect class="diagram-drag-header" x="1" y="1" width="${w - 2}" height="35" rx="7" fill="${color}" fill-opacity=".14" pointer-events="all"/>${label(element.title, 14, 23, 14, color, w - 100)}${label(`${element.members.length} 个节点`, w - 83, 23, 11, color, 75)}`;
  const header = `${body}${label(element.title, 15, 28, 15, color, w - 30)}<path d="M14 41H${w - 14}" stroke="${color}" opacity=".2"/>`;
  if (element.kind === 'note') {
    const lines = wrapped(element.text, w - 30, element.fontSize, Math.max(1, Math.floor((h - 61) / (element.fontSize * 1.6))));
    return `<title>${esc(element.text)}</title>` + header + lines.map((line, i) => label(line, 15, 61 + i * element.fontSize * 1.6, element.fontSize, '#526558', w - 30)).join('');
  }
  let y = 62;
  const rows: string[] = [];
  const texture = `legend-braid-${element.id}`;
  rows.push(`<defs><pattern id="${texture}" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L7 0M-2 2L2 -2M5 9L9 5" stroke="#fff" stroke-width="1.2"/><path d="M0 0L7 7" stroke="#254333" stroke-width="1" opacity=".3"/></pattern></defs>`);
  const kinds = [...new Set(snapshot.edges.map((edge) => edge.kind))];
  for (const kind of kinds) {
    const appearance = cableAppearance(kind, snapshot.edges.find((edge) => edge.kind === kind)?.appearance);
    const layers = cableAttributes({ ...appearance, width: Math.min(appearance.width, 7) }, false, texture);
    if (y <= h - 12) rows.push(`${(['line', 'core', 'texture', 'shine'] as const).map((key) => { const attrs = layers[key]; return `<path d="M16 ${y - 4}H57" fill="none" stroke="${attrs.stroke}" stroke-width="${attrs.strokeWidth}" stroke-dasharray="${'strokeDasharray' in attrs ? attrs.strokeDasharray : ''}" opacity="${'opacity' in attrs ? attrs.opacity : 1}" stroke-linecap="round"/>`; }).join('')}${appearance.arrows ? `<path d="M53 ${y - 8}L59 ${y - 4}L53 ${y}Z" fill="${appearance.color}"/>` : ''}${label(`${linkTypes[kind].label} · ${cableStyles[appearance.style].label}`, 69, y, 12, '#526558', w - 80)}`);
    y += 25;
  }
  if (element.showStatus) {
    y += 6;
    const states: [NodeStatusTone, string][] = [['normal', '正常'], ['warning', '告警'], ['offline', '离线'], ['pending', '等待数据'], ['stale', '数据过期'], ['disconnected', '连接中断']];
    for (const [i, [tone, name]] of states.entries()) {
      const x = 16 + (i % 2) * (w - 28) / 2, row = y + Math.floor(i / 2) * 25;
      if (row <= h - 12) rows.push(`<g transform="translate(${x} ${row - 12})" color="${nodeStatusStyles[tone].color}">${statusGlyph(tone, 14)}</g>${label(name, x + 21, row, 11, '#526558', (w - 28) / 2 - 25)}`);
    }
  }
  if (!kinds.length && !element.showStatus) rows.push(label('暂无链路类型', 15, 64, 12, '#87958b', w - 30));
  return header + rows.join('');
}
