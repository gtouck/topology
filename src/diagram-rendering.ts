import { Graph, Shape, type Node, type Cell } from '@antv/x6';
import { escapeHtml as esc } from './icons';
import { drawingOrder, type DiagramElement } from './diagram';
import type { Snapshot } from './topology';
import { diagramSvg } from './diagram-svg';

export const diagramOf = (cell: Cell | null | undefined): DiagramElement | undefined => cell?.isNode() ? cell.getData<{ element?: DiagramElement }>()?.element : undefined;
export const isDeviceNode = (cell: Cell | null | undefined): cell is Node => !!cell?.isNode() && !diagramOf(cell);

const contexts = new WeakMap<Node, () => Snapshot>();
let registered = false;
export function addDiagramNode(graph: Graph, element: DiagramElement, snapshot: () => Snapshot) {
  if (!registered) {
    registered = true;
    Shape.HTML.register({ shape: 'diagram-element', effect: ['data', 'size'], html(cell) {
      const node = cell as Node, element = { ...diagramOf(node)!, ...node.size() };
      const root = document.createElement('div'); root.className = `diagram-element diagram-${element.kind}`;
      root.dataset.diagramElement = node.id;
      root.dataset.locked = String(!!element.locked);
      root.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${element.width} ${element.height}" role="img" aria-label="${esc(element.title)}"><title>${esc(element.kind === 'note' ? `${element.title}\n${element.text}` : element.title)}</title>${diagramSvg(element, contexts.get(node)?.() || { nodes: [], edges: [] })}</svg>`;
      return root;
    } });
  }
  const node = graph.createNode({ id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, shape: 'diagram-element', data: { element: structuredClone(element) }, zIndex: element.kind === 'group' ? -1000 : 3 });
  contexts.set(node, snapshot); graph.addNode(node); return node;
}
export function syncDrawingLayers(graph: Graph, snapshot: Snapshot) {
  drawingOrder(snapshot).forEach((id, i) => {
    const cell = graph.getCellById(id);
    if (cell) cell.setZIndex((diagramOf(cell)?.kind === 'group' ? -1000 : 2) + i, { runtime: true });
  });
}
