import {
  createElement, Activity, SatelliteDish, Cpu, Server, Router, Network, Zap,
  LayoutDashboard, Cable, ChevronDown, ArrowUpRight, Search, Bell, Settings,
  HelpCircle, Plus, Minus, Maximize, Scan, MousePointer2, Hand, Undo2, Redo2,
  Save, Download, Upload, Trash2, X, Check, RefreshCw, Pause, Play, LockKeyhole,
  PencilRuler, CircleAlert, ChevronRight, CircleCheck, Clock3, Unplug, Info,
  Layers, SlidersHorizontal, RotateCcw, Radio, Move, ExternalLink, Copy, ClipboardPaste, CopyPlus,
} from 'lucide';

const icons = {
  Activity, SatelliteDish, Cpu, Server, Router, Network, Zap, LayoutDashboard,
  Cable, ChevronDown, ArrowUpRight, Search, Bell, Settings, HelpCircle, Plus,
  Minus, Maximize, Scan, MousePointer2, Hand, Undo2, Redo2, Save, Download,
  Upload, Trash2, X, Check, RefreshCw, Pause, Play, LockKeyhole, PencilRuler,
  CircleAlert, ChevronRight, CircleCheck, Clock3, Unplug, Info, Layers,
  SlidersHorizontal, RotateCcw, Radio, Move, ExternalLink, Copy, ClipboardPaste, CopyPlus,
};
export const iconNames = [
  'Activity', 'SatelliteDish', 'Cpu', 'Server', 'Router', 'Network', 'Zap', 'LayoutDashboard',
  'Cable', 'ChevronDown', 'ArrowUpRight', 'Search', 'Bell', 'Settings', 'HelpCircle', 'Plus',
  'Minus', 'Maximize', 'Scan', 'MousePointer2', 'Hand', 'Undo2', 'Redo2', 'Save', 'Download',
  'Upload', 'Trash2', 'X', 'Check', 'RefreshCw', 'Pause', 'Play', 'LockKeyhole', 'PencilRuler',
  'CircleAlert', 'ChevronRight', 'CircleCheck', 'Clock3', 'Unplug', 'Info', 'Layers',
  'SlidersHorizontal', 'RotateCcw', 'Radio', 'Move', 'ExternalLink',
] as const;
export type IconName = typeof iconNames[number];
export function icon(name: keyof typeof icons, size = 18) {
  const svg = createElement(icons[name]);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}

/** SVG export must also work without a browser DOM. Only serializes built-in icons. */
export function vectorIcon(name: IconName, size = 19) {
  const [, attributes, children] = icons[name];
  const attrs = (value: Record<string, unknown>) => Object.entries(value).map(([key, val]) => ` ${key}="${escapeHtml(val)}"`).join('');
  return `<svg${attrs({ ...attributes, width: size, height: size, 'stroke-width': 1.7 })}>${(children || []).map(([tag, value]) => `<${tag}${attrs(value)}/>`).join('')}</svg>`;
}

export function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]!);
}
