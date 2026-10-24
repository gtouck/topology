import type { Graph } from '@antv/x6';
import type { TopologyDocument } from './document';
import { renderTopologySvg, type ExportState, type ExportEdgeGeometry, type SvgExport } from './export-svg';
import { renderTopologyHtml } from './export-html';
import runtimeUrl from '../dist-viewer/topology-viewer.umd.js?url';
import type { LinkTelemetryData } from './link-state';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function exportFilename(name: string, extension: string) {
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'topology'}.${extension}`;
}

export function graphSvg(graph: Graph, definition: TopologyDocument, state: ExportState, linkData: LinkTelemetryData = {}) {
  const paths: Record<string, ExportEdgeGeometry> = {};
  for (const edge of graph.getEdges()) {
    const line = graph.findViewByCell(edge)?.container.querySelector<SVGPathElement>('.cable-line');
    const path = line?.getAttribute('d');
    if (line && path) {
      const middle = line.getPointAtLength(line.getTotalLength() / 2);
      paths[edge.id] = { path, label: { x: middle.x, y: middle.y } };
    }
  }
  return renderTopologySvg(definition, state, paths, linkData);
}

export async function svgToPng(image: SvgExport, requestedScale = 2): Promise<Blob> {
  // Bound both area and longest side before creating a canvas.
  const scale = Math.min(requestedScale, 16384 / image.width, 16384 / image.height, Math.sqrt(32_000_000 / image.width / image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(image.width * scale));
  canvas.height = Math.max(1, Math.floor(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 PNG 导出，请使用 SVG');
  const url = URL.createObjectURL(new Blob([image.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const source = new Image();
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve(); source.onerror = () => reject(new Error('图片生成失败，请使用 SVG 导出'));
      source.src = url;
    });
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 导出失败，请使用 SVG')), 'image/png'));
  } finally { URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; }
}

let runtimePromise: Promise<string> | undefined;
export async function standaloneHtml(definition: TopologyDocument, state: ExportState, linkData?: LinkTelemetryData) {
  runtimePromise ??= fetch(runtimeUrl).then((response) => {
    if (!response.ok) throw new Error('展示组件加载失败，请刷新页面后重试');
    return response.text();
  }).catch((error) => { runtimePromise = undefined; throw error; });
  return renderTopologyHtml(definition, state, await runtimePromise, linkData);
}
