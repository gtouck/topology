import { newId, parseDocument, parseTemplate, type NodeTemplate, type TopologyDocument } from './document';
import { assertConnectedPortsPreserved } from './topology';

/** Apply atomically. Node identity, placement, overrides and manual routes stay intact. */
export function applyTemplate(document: TopologyDocument, input: unknown): TopologyDocument {
  const template = parseTemplate(input);
  const next = structuredClone(document);
  const previous = next.templates.find(t => t.id === template.id);
  if (!previous && next.templates.length >= 64) throw new Error('每张拓扑最多包含 64 个模板');
  const keys = new Set(template.metrics.map(m => m.key));
  for (const node of next.topology.nodes.filter(n => n.data.kind === template.id)) {
    if (previous && node.data.ports === undefined) {
      const connected = new Set(next.topology.edges.flatMap(e => [e.source, e.target]).filter(e => e.cell === node.id).map(e => e.port));
      assertConnectedPortsPreserved(previous.ports, template.ports, connected);
    }
    node.data.visibleMetrics = node.data.visibleMetrics.filter(key => keys.has(key));
    if (node.data.binding) node.data.binding.fields = Object.fromEntries(Object.entries(node.data.binding.fields).filter(([key]) => keys.has(key)));
  }
  if (previous) next.templates[next.templates.indexOf(previous)] = template; else next.templates.push(template);
  return parseDocument(next);
}

export function duplicateTemplate(template: NodeTemplate): NodeTemplate {
  return parseTemplate({ ...structuredClone(template), id: newId('custom'), label: `${template.label.slice(0, 35)} 副本` });
}

export function templateFile(template: NodeTemplate) {
  return { format: 'topology-node-template' as const, version: 1 as const, template: parseTemplate(template) };
}

export function importTemplate(input: unknown, existing: NodeTemplate[]): NodeTemplate {
  if (!input || typeof input !== 'object' || (input as { format?: string }).format !== 'topology-node-template' || (input as { version?: number }).version !== 1) throw new Error('不支持的节点模板文件');
  const template = parseTemplate((input as { template: unknown }).template);
  return existing.some(t => t.id === template.id) ? { ...template, id: newId('custom') } : template;
}
