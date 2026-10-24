import { iconNames, type IconName } from './icons';
import { builtinDevices, devices, initialTopology, newDevice, parseDevicePorts, parseTopologyFile, type DeviceDefinition, type DeviceKind, type PortDefinition, type Snapshot } from './topology';
import { parseDiagram } from './diagram';

export interface NodeTemplate {
  id: string; version: 1; label: string; en: string; icon: IconName; model: string;
  metrics: { key: string; label: string; unit: string; decimals: number }[];
  ports: PortDefinition[];
}
export interface TopologyDocument {
  format: 'topology-document'; version: 3; id: string; name: string; description: string;
  category: string; createdAt: string; updatedAt: string; templates: NodeTemplate[]; topology: Snapshot;
}
export const categories = { general: '通用拓扑', 'ground-station': '地面站', datacenter: '机房网络', satellite: '卫星逻辑' };
export function newId(prefix = 'topology') {
  return `${prefix}-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
const text = (value: unknown, max: number, label: string, empty = false): string => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`${label}不合法`);
  return value;
};
const safeId = (value: unknown, label: string): string => {
  const id = text(value, 100, label);
  if (!/^[\w.-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error(`${label}不合法`);
  return id;
};
const date = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('文档日期不合法');
  return value;
};

export function templatesFromDefinitions(definitions: Record<string, DeviceDefinition>): NodeTemplate[] {
  return Object.entries(definitions).map(([id, d]) => ({ id, version: 1, label: d.label, en: d.en, icon: d.icon, model: d.model, metrics: d.metrics.map(({ key, label, unit, decimals }) => ({ key, label, unit, decimals })), ports: structuredClone(d.ports) }));
}

export function parseTemplate(value: unknown): NodeTemplate {
  if (!value || typeof value !== 'object') throw new Error('节点模板不合法');
  const t = value as NodeTemplate;
  if (t.version !== 1 || !iconNames.includes(t.icon) || !Array.isArray(t.metrics) || t.metrics.length > 20) throw new Error('模板版本、图标或参数不合法');
  const keys = new Set<string>();
  const metrics = t.metrics.map((m) => {
    if (!m || typeof m !== 'object') throw new Error('模板参数不合法');
    const key = safeId(m.key, '参数标识');
    if (keys.has(key) || !Number.isInteger(m.decimals) || m.decimals < 0 || m.decimals > 6) throw new Error('模板参数重复或小数位数不合法');
    keys.add(key);
    return { key, label: text(m.label, 40, '参数名称'), unit: text(m.unit, 20, '参数单位', true), decimals: m.decimals };
  });
  return { id: safeId(t.id, '模板 ID'), version: 1, label: text(t.label, 40, '模板名称'), en: text(t.en, 40, '模板英文名', true), icon: t.icon, model: text(t.model, 100, '模板说明', true), metrics, ports: parseDevicePorts(t.ports) };
}

export function definitionsFromTemplates(templates: NodeTemplate[]): Record<string, DeviceDefinition> {
  return Object.fromEntries(templates.map((t) => [t.id, {
    label: t.label, en: t.en, icon: t.icon, model: t.model, ports: structuredClone(t.ports),
    metrics: t.metrics.map((m) => {
      const sample = builtinDevices[t.id]?.metrics.find((entry) => entry.key === m.key);
      return { ...m, base: sample?.base ?? 0, jitter: sample?.jitter ?? 0 };
    }),
  }]));
}

export function installEditorTemplates(document: TopologyDocument) {
  for (const key of Object.keys(devices)) delete devices[key];
  Object.assign(devices, definitionsFromTemplates(document.templates));
}

export function createDocument(name: string, category = 'general', topology: Snapshot = { nodes: [], edges: [] }, definitions = builtinDevices): TopologyDocument {
  const now = new Date().toISOString();
  return { format: 'topology-document', version: 3, id: newId(), name: name.trim() || '未命名拓扑', description: '', category, createdAt: now, updatedAt: now, templates: templatesFromDefinitions(definitions), topology: structuredClone(topology) };
}

/** Pure validation and migration: never changes the active editor's template registry. */
export function parseDocument(input: unknown): TopologyDocument {
  if (!input || typeof input !== 'object') throw new Error('拓扑文档不合法');
  const record = input as Record<string, unknown>;
  if (record.version === 1 && record.format === undefined) {
    const legacy = parseTopologyFile(input, builtinDevices);
    const migrated = createDocument(legacy.name, 'ground-station', legacy.topology);
    for (const node of migrated.topology.nodes) {
      node.data.binding ??= { source: node.data.deviceId, fields: Object.fromEntries(builtinDevices[node.data.kind].metrics.map((m) => [m.key, m.key])), statusField: 'status' };
    }
    if (Number.isFinite(Date.parse(legacy.savedAt))) migrated.createdAt = migrated.updatedAt = new Date(legacy.savedAt).toISOString();
    return migrated;
  }
  const doc = input as TopologyDocument;
  if (doc.format !== 'topology-document' || (record.version !== 2 && record.version !== 3)) throw new Error('不支持的拓扑文档版本');
  if (!Array.isArray(doc.templates) || !doc.templates.length || doc.templates.length > 64) throw new Error('文档需包含 1–64 个节点模板');
  const templates = doc.templates.map(parseTemplate);
  if (new Set(templates.map((t) => t.id)).size !== templates.length) throw new Error('存在重复模板 ID');
  const definitions = definitionsFromTemplates(templates);
  const topology = parseTopologyFile({ version: 1, name: doc.name, savedAt: doc.updatedAt, topology: doc.topology }, definitions).topology;
  for (const node of topology.nodes) safeId(node.id, '节点 ID');
  for (const edge of topology.edges) safeId(edge.id, '连线 ID');
  if (topology.nodes.some(node => node.data.childTopologyId === doc.id)) throw new Error('子拓扑不能指向当前文档自身');
  if (record.version === 3) Object.assign(topology, parseDiagram(doc.topology, topology));
  return { format: 'topology-document', version: 3, id: safeId(doc.id, '文档 ID'), name: text(doc.name, 100, '文档名称'), description: text(doc.description, 1000, '文档说明', true), category: text(doc.category, 60, '文档分类'), createdAt: date(doc.createdAt), updatedAt: date(doc.updatedAt), templates, topology };
}

export function sampleDocument(category: string, name?: string): TopologyDocument {
  if (category === 'ground-station') return createDocument(name || '北京地面站', category, initialTopology());
  const kinds: DeviceKind[] = category === 'datacenter' ? ['router', 'switch', 'server', 'server'] : category === 'satellite' ? ['subsystem', 'module', 'module', 'service'] : [];
  const titles = category === 'datacenter' ? ['核心路由器', '业务交换机', '运控服务器', '存储服务器'] : ['星务管理子系统', '姿轨控模块', '载荷模块', '测控服务'];
  const nodes = kinds.map((kind, i) => {
    const node = newDevice(kind, i < 2 ? 40 + i * 300 : 640, i < 3 ? 130 : 350, i + 1, builtinDevices);
    node.data.title = titles[i];
    if (category === 'datacenter' && kind === 'server') node.data.ports = ['left', 'right', 'top', 'bottom'].map((side) => ({ id: side, label: side, kind: 'ethernet', side } as PortDefinition));
    return node;
  });
  const ids = nodes.map((n) => n.id);
  const logical = category === 'satellite';
  const edges = nodes.length ? [
    { id: newId('link'), source: { cell: ids[0], port: logical ? 'right' : 'wan' }, target: { cell: ids[1], port: logical ? 'left' : 'ge1' }, kind: logical ? 'logical' as const : 'ethernet' as const, label: logical ? '控制' : '骨干网', vertices: [] },
    { id: newId('link'), source: { cell: ids[1], port: logical ? 'right' : 'ge3' }, target: { cell: ids[2], port: 'left' }, kind: logical ? 'logical' as const : 'ethernet' as const, label: logical ? '业务' : '业务网', vertices: [] },
    { id: newId('link'), source: { cell: ids[1], port: logical ? 'bottom' : 'mgmt' }, target: { cell: ids[3], port: logical ? 'left' : 'top' }, kind: logical ? 'logical' as const : 'ethernet' as const, label: logical ? '状态' : '管理网', vertices: [{ x: 445, y: 416 }] },
  ] : [];
  return createDocument(name || (category === 'datacenter' ? '运控中心机房' : category === 'satellite' ? '卫星逻辑结构' : '未命名拓扑'), category, { nodes, edges });
}
