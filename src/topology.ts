import type { IconName } from './icons';
import { parseCableAppearance, type CableAppearance } from './cables';

export type DeviceKind = string;
export type LinkKind = 'rf' | 'if' | 'ethernet' | 'logical';
export type DeviceStatus = 'normal' | 'warning' | 'offline';
export interface MetricDefinition { key: string; label: string; unit: string; base: number; jitter: number; decimals: number }
export interface DataBinding { source: string; fields: Record<string, string>; statusField?: string; statusMap?: Record<string, DeviceStatus> }
export interface DeviceData { kind: DeviceKind; title: string; deviceId: string; address: string; visibleMetrics: string[]; status: DeviceStatus; ports?: PortDefinition[]; portSpacing?: number; binding?: DataBinding; locked?: boolean }
export interface PortDefinition { id: string; label: string; kind: LinkKind; side: 'left' | 'right' | 'top' | 'bottom'; offset?: number }
export interface DeviceDefinition { label: string; en: string; icon: IconName; model: string; metrics: MetricDefinition[]; ports: PortDefinition[] }
export interface DeviceRecord { id: string; x: number; y: number; data: DeviceData }
export interface LinkRecord { id: string; source: { cell: string; port: string }; target: { cell: string; port: string }; kind: LinkKind; label: string; vertices: { x: number; y: number }[]; appearance?: CableAppearance }
export interface Snapshot { nodes: DeviceRecord[]; edges: LinkRecord[] }
export interface TopologyFile { version: 1; name: string; savedAt: string; topology: Snapshot }

export const STORAGE_KEY = 'station-x6-topology-v1';
export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 132;
export const MAX_DEVICE_PORTS = 128;
export const portSides = { left: '左侧', right: '右侧', top: '顶部', bottom: '底部' } as const;
export const linkTypes: Record<LinkKind, { label: string; color: string; short: string }> = {
  rf: { label: '射频链路', color: '#b286c7', short: 'RF' },
  if: { label: '中频链路', color: '#d9a855', short: 'IF' },
  ethernet: { label: '以太网', color: '#4a9e92', short: 'ETH' },
  logical: { label: '逻辑连接', color: '#8298bd', short: 'LOGIC' },
};
export const statusLabels: Record<DeviceStatus, string> = { normal: '运行正常', warning: '设备告警', offline: '设备离线' };
const eth = (id: string, side: PortDefinition['side'], offset = 66): PortDefinition => ({ id, label: id.toUpperCase(), kind: 'ethernet', side, offset });
const metric = (key: string, label: string, unit: string, base: number, jitter = 1, decimals = 1): MetricDefinition => ({ key, label, unit, base, jitter, decimals });
export const builtinDevices: Record<DeviceKind, DeviceDefinition> = {
  antenna: {
    label: '天线', en: 'ANTENNA', icon: 'SatelliteDish', model: '7.3 m Ku 双极化天线',
    metrics: [metric('azimuth', '方位角', '°', 128.6, .03), metric('elevation', '俯仰角', '°', 42.3, .03), metric('signal', '信标电平', 'dBm', -42.5, .4)],
    ports: [{ id: 'rf-rx', label: 'RF RX', kind: 'rf', side: 'right', offset: 42 }, { id: 'rf-tx', label: 'RF TX', kind: 'rf', side: 'right', offset: 99 }, eth('ctrl', 'bottom', 105)],
  },
  lnb: {
    label: '低噪声下变频器', en: 'LNB', icon: 'Radio', model: 'Ku-band LNB · 10.75 GHz',
    metrics: [metric('gain', '增益', 'dB', 60.2, .15), metric('temperature', '温度', '℃', 36.5, .8), metric('voltage', '供电电压', 'V', 13, .05)],
    ports: [{ id: 'rf-in', label: 'RF IN', kind: 'rf', side: 'left', offset: 66 }, { id: 'if-out', label: 'IF OUT', kind: 'if', side: 'right', offset: 66 }],
  },
  amplifier: {
    label: '功率放大器', en: 'AMPLIFIER', icon: 'Zap', model: 'Ku-band SSPA · 200 W',
    metrics: [metric('power', '输出功率', 'W', 128.4, 2.5), metric('temperature', '温度', '℃', 72.6, 1.2), metric('current', '工作电流', 'A', 8.2, .1)],
    ports: [{ id: 'rf-out', label: 'RF OUT', kind: 'rf', side: 'left', offset: 66 }, { id: 'if-in', label: 'IF IN', kind: 'if', side: 'right', offset: 66 }, eth('mgmt', 'bottom', 105)],
  },
  baseband: {
    label: '基带设备', en: 'BASEBAND', icon: 'Cpu', model: 'DVB-S2X 卫星调制解调器',
    metrics: [metric('rate', '业务速率', 'Mbps', 45.6, 1.5), metric('snr', '信噪比', 'dB', 14.8, .25), metric('temperature', '温度', '℃', 41.2, .6)],
    ports: [{ id: 'if', label: 'IF', kind: 'if', side: 'left', offset: 66 }, eth('ge1', 'right')],
  },
  switch: {
    label: '核心交换机', en: 'SWITCH', icon: 'Network', model: '24 口千兆 / 4 口万兆交换机',
    metrics: [metric('traffic', '总吞吐量', 'Mbps', 486, 20, 0), metric('ports', '活动端口', '个', 12, 0, 0), metric('temperature', '温度', '℃', 38.6, .6)],
    ports: [eth('ge1', 'left', 40), eth('ge2', 'left', 99), eth('ge3', 'right'), eth('uplink', 'top', 105), eth('mgmt', 'bottom', 105)],
  },
  router: {
    label: '出口路由器', en: 'ROUTER', icon: 'Router', model: '企业级多业务路由器',
    metrics: [metric('bandwidth', '出口带宽', 'Mbps', 236.5, 10), metric('latency', '网络时延', 'ms', 12.4, 1.5), metric('cpu', 'CPU 使用率', '%', 23.6, 3)],
    ports: [eth('lan', 'bottom', 105), eth('wan', 'right')],
  },
  server: {
    label: '业务服务器', en: 'SERVER', icon: 'Server', model: '2U 业务服务器 · Linux',
    metrics: [metric('cpu', 'CPU 使用率', '%', 32.8, 4), metric('memory', '内存使用率', '%', 56.2, .6), metric('temperature', '温度', '℃', 43.1, .5)],
    ports: [eth('eth0', 'top', 105), eth('eth1', 'left')],
  },
};

const logicalPorts = (): PortDefinition[] => (Object.keys(portSides) as PortDefinition['side'][]).map((side) => ({ id: side, label: portSides[side], kind: 'logical', side }));
for (const [id, label, glyph] of [['module', '逻辑模块', 'Cpu'], ['subsystem', '子系统', 'Layers'], ['service', '服务节点', 'Network']] as const) {
  builtinDevices[id] = { label, en: id.toUpperCase(), icon: glyph, model: '通用逻辑节点', metrics: [metric('load', '负载', '%', 30, 2), metric('temperature', '温度', '℃', 35, .5)], ports: logicalPorts() };
}
// The editor installs the active document's templates here. Viewers use their own registry.
export const devices: Record<DeviceKind, DeviceDefinition> = { ...builtinDevices };

export function devicePorts(data: DeviceData, definitions = devices): PortDefinition[] {
  return data.ports ?? definitions[data.kind].ports;
}

export function parseDevicePorts(input: unknown): PortDefinition[] {
  if (!Array.isArray(input) || input.length > MAX_DEVICE_PORTS) throw new Error(`每台设备最多配置 ${MAX_DEVICE_PORTS} 个端口`);
  const ids = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('端口配置不合法');
    const p = value as PortDefinition;
    if (typeof p.id !== 'string' || !p.id.trim() || p.id.length > 100 || ids.has(p.id)) throw new Error('端口 ID 不合法或重复');
    if (typeof p.label !== 'string' || !p.label.trim() || p.label.length > 40 || !Object.hasOwn(linkTypes, p.kind) || !Object.hasOwn(portSides, p.side)) throw new Error('端口名称、类型或位置不合法');
    if (p.offset !== undefined && (typeof p.offset !== 'number' || !Number.isFinite(p.offset) || p.offset < 0 || p.offset > 100000)) throw new Error('端口偏移不合法');
    ids.add(p.id);
    return { id: p.id, label: p.label, kind: p.kind, side: p.side, ...(p.offset === undefined ? {} : { offset: p.offset }) };
  });
}

export function assertConnectedPortsPreserved(current: PortDefinition[], next: PortDefinition[], connected: Set<string>) {
  for (const id of connected) {
    const before = current.find((p) => p.id === id);
    const after = next.find((p) => p.id === id);
    if (!before || !after || before.kind !== after.kind) throw new Error('已连接端口不能删除或更改类型，请先删除关联连线');
  }
}

export function deviceGeometry(data: DeviceData, definitions = devices) {
  const ports = devicePorts(data, definitions);
  // Match the card's content: no metric block, one inline row, or two columns.
  const contentHeight = data.visibleMetrics.length === 0 ? 90 : data.visibleMetrics.length === 1 ? 116 : NODE_HEIGHT;
  const baseHeight = contentHeight + (ports.length > 8 ? 28 : 0);
  if (data.ports === undefined && data.portSpacing === undefined) {
    return { width: NODE_WIDTH, height: baseHeight, ports: ports.map((p) => ({ ...p,
      x: p.side === 'left' ? 0 : p.side === 'right' ? NODE_WIDTH : (p.offset ?? NODE_WIDTH / 2),
      y: p.side === 'top' ? 0 : p.side === 'bottom' ? baseHeight : (p.offset ?? NODE_HEIGHT / 2) * baseHeight / NODE_HEIGHT,
    })) };
  }
  const spacing = data.portSpacing ?? 24;
  const margin = 24;
  const groups = Object.fromEntries(Object.keys(portSides).map((side) => [side, ports.filter((p) => p.side === side)])) as Record<PortDefinition['side'], PortDefinition[]>;
  const width = Math.max(NODE_WIDTH, margin * 2 + (Math.max(groups.top.length, groups.bottom.length) - 1) * spacing);
  const height = Math.max(baseHeight, margin * 2 + (Math.max(groups.left.length, groups.right.length) - 1) * spacing);
  return { width, height, ports: ports.map((p) => {
    const group = groups[p.side];
    const index = group.findIndex((entry) => entry.id === p.id);
    const vertical = p.side === 'left' || p.side === 'right';
    const extent = vertical ? height : width;
    const position = group.length === 1 ? extent / 2 : margin + index * (extent - margin * 2) / (group.length - 1);
    return { ...p, x: vertical ? (p.side === 'left' ? 0 : width) : position, y: vertical ? position : (p.side === 'top' ? 0 : height) };
  }) };
}

export function newDevice(kind: DeviceKind, x: number, y: number, index: number, definitions = devices): DeviceRecord {
  const definition = definitions[kind];
  // getRandomValues also works on LAN HTTP origins, where randomUUID is unavailable.
  const id = `${kind}-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return { id, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, data: {
    kind, title: `${definition.label} ${String(index).padStart(2, '0')}`, deviceId: `DEV-${String(index).padStart(3, '0')}`,
    address: `192.168.10.${index + 10}`, visibleMetrics: definition.metrics.slice(0, 2).map((m) => m.key), status: 'normal',
    binding: { source: `DEV-${String(index).padStart(3, '0')}`, fields: Object.fromEntries(definition.metrics.map((m) => [m.key, m.key])), statusField: 'status' },
  } };
}

export function initialTopology(): Snapshot {
  const specs: [string, DeviceKind, string, number, number, DeviceStatus][] = [
    ['ant-01', 'antenna', '天线 ANT-01', 30, 250, 'normal'],
    ['lnb-01', 'lnb', '低噪放 LNB-01', 310, 90, 'normal'],
    ['hpa-01', 'amplifier', '功放 HPA-01', 310, 430, 'warning'],
    ['bb-rx', 'baseband', '接收基带 BB-01', 590, 90, 'normal'],
    ['bb-tx', 'baseband', '发射基带 BB-02', 590, 430, 'normal'],
    ['sw-01', 'switch', '核心交换机 SW-01', 870, 250, 'normal'],
    ['rt-01', 'router', '出口路由器 RT-01', 870, 10, 'normal'],
    ['srv-01', 'server', '业务服务器 SRV-01', 870, 430, 'normal'],
  ];
  const nodes = specs.map(([id, kind, title, x, y, status], i) => ({
    id, x, y, data: { ...newDevice(kind, x, y, i + 1, builtinDevices).data, title, status },
  }));
  const edges: LinkRecord[] = [
    { id: 'link-rx-rf', source: { cell: 'ant-01', port: 'rf-rx' }, target: { cell: 'lnb-01', port: 'rf-in' }, kind: 'rf', label: 'Ku-band · 接收', vertices: [{ x: 270, y: 292 }, { x: 270, y: 156 }] },
    { id: 'link-rx-if', source: { cell: 'lnb-01', port: 'if-out' }, target: { cell: 'bb-rx', port: 'if' }, kind: 'if', label: 'L-band', vertices: [] },
    { id: 'link-tx-if', source: { cell: 'bb-tx', port: 'if' }, target: { cell: 'hpa-01', port: 'if-in' }, kind: 'if', label: 'L-band', vertices: [] },
    { id: 'link-tx-rf', source: { cell: 'hpa-01', port: 'rf-out' }, target: { cell: 'ant-01', port: 'rf-tx' }, kind: 'rf', label: 'Ku-band · 发射', vertices: [{ x: 270, y: 496 }, { x: 270, y: 349 }] },
    { id: 'link-rx-eth', source: { cell: 'bb-rx', port: 'ge1' }, target: { cell: 'sw-01', port: 'ge1' }, kind: 'ethernet', label: 'GE1', vertices: [{ x: 835, y: 156 }, { x: 835, y: 290 }] },
    { id: 'link-tx-eth', source: { cell: 'sw-01', port: 'ge2' }, target: { cell: 'bb-tx', port: 'ge1' }, kind: 'ethernet', label: 'GE2', vertices: [{ x: 835, y: 349 }, { x: 835, y: 496 }] },
    { id: 'link-uplink', source: { cell: 'sw-01', port: 'uplink' }, target: { cell: 'rt-01', port: 'lan' }, kind: 'ethernet', label: '上联 · 1 Gbps', vertices: [] },
    { id: 'link-server', source: { cell: 'sw-01', port: 'mgmt' }, target: { cell: 'srv-01', port: 'eth0' }, kind: 'ethernet', label: '业务网', vertices: [] },
  ];
  return { nodes, edges };
}

// Build only known node shapes and attributes when importing, rather than trusting X6 JSON.
export function parseTopologyFile(input: unknown, definitions = devices): TopologyFile {
  if (!input || typeof input !== 'object') throw new Error('文件内容不是拓扑配置');
  const file = input as TopologyFile;
  if (file.version !== 1 || !file.topology || !Array.isArray(file.topology.nodes) || !Array.isArray(file.topology.edges)) throw new Error('不支持的拓扑文件格式');
  if (file.topology.nodes.length > 300 || file.topology.edges.length > 1000) throw new Error('原型最多支持导入 300 个设备、1000 条连线');
  const ids = new Set<string>();
  const str = (v: unknown, max = 100): string => {
    if (typeof v !== 'string' || v.length > max || !v.trim()) throw new Error('设备或连线字段不合法');
    return v;
  };
  const coord = (n: unknown) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100000) throw new Error('布局坐标不合法');
    return n;
  };
  const uniqueId = (id: unknown) => {
    const value = str(id);
    if (ids.has(value)) throw new Error('存在重复的图形 ID');
    ids.add(value); return value;
  };
  const nodes = file.topology.nodes.map((n) => {
    const id = uniqueId(n.id);
    if (!n.data || !Object.hasOwn(definitions, n.data.kind)) throw new Error('存在不支持的设备类型');
    const kind = n.data.kind;
    const keys = definitions[kind].metrics.map((m) => m.key);
    if (!Array.isArray(n.data.visibleMetrics) || n.data.visibleMetrics.length > 2 || n.data.visibleMetrics.some((k) => !keys.includes(k)) || new Set(n.data.visibleMetrics).size !== n.data.visibleMetrics.length) throw new Error('展示参数配置不合法');
    if (!Object.hasOwn(statusLabels, n.data.status)) throw new Error('设备状态不合法');
    if (n.data.locked !== undefined && typeof n.data.locked !== 'boolean') throw new Error('节点锁定配置必须是布尔值');
    if (n.data.portSpacing !== undefined && (typeof n.data.portSpacing !== 'number' || !Number.isInteger(n.data.portSpacing) || n.data.portSpacing < 18 || n.data.portSpacing > 48)) throw new Error('端口间距必须为 18–48 px 的整数');
    const binding = n.data.binding === undefined ? undefined : parseDataBinding(n.data.binding, keys);
    return { id, x: coord(n.x), y: coord(n.y), data: { kind, title: str(n.data.title, 60), deviceId: str(n.data.deviceId, 80), address: typeof n.data.address === 'string' ? n.data.address.slice(0, 100) : '', status: n.data.status, visibleMetrics: [...n.data.visibleMetrics], ...(n.data.ports === undefined ? {} : { ports: parseDevicePorts(n.data.ports) }), ...(n.data.portSpacing === undefined ? {} : { portSpacing: n.data.portSpacing }), ...(binding ? { binding } : {}), ...(n.data.locked === undefined ? {} : { locked: n.data.locked }) } };
  });
  const edges = file.topology.edges.map((e) => {
    const id = uniqueId(e.id);
    if (!Object.hasOwn(linkTypes, e.kind) || !Array.isArray(e.vertices) || e.vertices.length > 200) throw new Error('连线配置不合法');
    const endpoint = (end: LinkRecord['source']) => {
      if (!end) throw new Error('缺少连接端点');
      const node = nodes.find((n) => n.id === end.cell);
      const port = node && devicePorts(node.data, definitions).find((p) => p.id === end.port);
      if (!port || port.kind !== e.kind) throw new Error('端口不存在或链路类型不匹配');
      return { cell: str(end.cell), port: str(end.port) };
    };
    const source = endpoint(e.source), target = endpoint(e.target);
    if (source.cell === target.cell) throw new Error('不支持设备连接到自身');
    return { id, source, target, kind: e.kind, label: typeof e.label === 'string' ? e.label.slice(0, 80) : '', vertices: e.vertices.map((p) => ({ x: coord(p.x), y: coord(p.y) })), ...(e.appearance === undefined ? {} : { appearance: parseCableAppearance(e.appearance) }) };
  });
  return { version: 1, name: typeof file.name === 'string' ? file.name.slice(0, 100) : '站点拓扑', savedAt: typeof file.savedAt === 'string' ? file.savedAt : '', topology: { nodes, edges } };
}

export function parseDataBinding(input: unknown, metricKeys: string[]): DataBinding {
  if (!input || typeof input !== 'object') throw new Error('数据绑定配置不合法');
  const b = input as DataBinding;
  const pathValid = (s: unknown): s is string => typeof s === 'string' && s.length <= 150 && /^[\w-]+(?:\.[\w-]+)*$/.test(s) && !s.split('.').some((k) => ['__proto__', 'prototype', 'constructor'].includes(k));
  if (typeof b.source !== 'string' || !b.source.trim() || b.source.length > 100 || !b.fields || typeof b.fields !== 'object' || Array.isArray(b.fields)) throw new Error('数据绑定来源或字段不合法');
  const fields = Object.entries(b.fields);
  if (fields.length > 20 || fields.some(([key, value]) => !metricKeys.includes(key) || !pathValid(value))) throw new Error('数据绑定字段不合法');
  if (b.statusField !== undefined && !pathValid(b.statusField)) throw new Error('状态绑定字段不合法');
  if (b.statusMap !== undefined && (!b.statusMap || typeof b.statusMap !== 'object' || Array.isArray(b.statusMap) || Object.entries(b.statusMap).length > 30 || Object.values(b.statusMap).some((s) => !Object.hasOwn(statusLabels, s)))) throw new Error('状态映射不合法');
  return { source: b.source, fields: Object.fromEntries(fields), ...(b.statusField ? { statusField: b.statusField } : {}), ...(b.statusMap ? { statusMap: { ...b.statusMap } } : {}) };
}
