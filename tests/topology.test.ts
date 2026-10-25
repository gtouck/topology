import { describe, expect, test } from 'bun:test';
import { initialTopology, parseTopologyFile, devices, devicePorts, deviceGeometry, assertConnectedPortsPreserved, type PortDefinition, type TopologyFile } from '../src/topology';
import { cableAppearance, cableStyles, type CableStyle } from '../src/cables';

const fixture = (): TopologyFile => ({ version: 1, name: '测试站', savedAt: '2026-10-22T10:00:00Z', topology: initialTopology() });

describe('拓扑配置保存与导入', () => {
  test('往返序列化保留设备位置、端口、展示参数和手工拐点', () => {
    const file = fixture();
    file.topology.nodes[0].x = 123.5;
    file.topology.edges[0].vertices = [{ x: 140, y: 200 }, { x: 140, y: 330 }];
    expect(parseTopologyFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  test('示例的每条连线都连接真实存在的同类型端口', () => {
    const topology = initialTopology();
    expect(topology.nodes.length).toBe(8);
    expect(topology.edges.length).toBe(8);
    for (const edge of topology.edges) {
      for (const endpoint of [edge.source, edge.target]) {
        const node = topology.nodes.find((n) => n.id === endpoint.cell)!;
        expect(devices[node.data.kind].ports.find((p) => p.id === endpoint.port)?.kind).toBe(edge.kind);
      }
    }
  });

  test('允许实际网络中的设备环路', () => {
    const file = fixture();
    file.topology.edges.push({ id: 'network-return', source: { cell: 'srv-01', port: 'eth1' }, target: { cell: 'rt-01', port: 'wan' }, kind: 'ethernet', label: '冗余网络', vertices: [] });
    expect(parseTopologyFile(file).topology.edges.length).toBe(9);
  });

  test('拒绝不匹配、悬空、自连接和重复 ID', () => {
    const mismatch = fixture(); mismatch.topology.edges[0].kind = 'ethernet';
    expect(() => parseTopologyFile(mismatch)).toThrow('端口不存在或链路类型不匹配');
    const dangling = fixture(); dangling.topology.edges[0].target.cell = 'missing';
    expect(() => parseTopologyFile(dangling)).toThrow();
    const loop = fixture(); loop.topology.edges[0].target = { ...loop.topology.edges[0].source };
    expect(() => parseTopologyFile(loop)).toThrow('自身');
    const duplicate = fixture(); duplicate.topology.nodes[1].id = duplicate.topology.nodes[0].id;
    expect(() => parseTopologyFile(duplicate)).toThrow('重复');
  });

  test('拒绝未知设备类型、不合法坐标、展示参数和大文件结构', () => {
    const coordinates = fixture(); coordinates.topology.nodes[0].x = Infinity;
    expect(() => parseTopologyFile(coordinates)).toThrow('坐标');
    const metrics = fixture(); metrics.topology.nodes[0].data.visibleMetrics = ['bad-key'];
    expect(() => parseTopologyFile(metrics)).toThrow('参数');
    const oversized = fixture(); oversized.topology.nodes = Array(301).fill(oversized.topology.nodes[0]);
    expect(() => parseTopologyFile(oversized)).toThrow('最多');
    expect(() => parseTopologyFile({ version: 2, topology: {} })).toThrow('格式');
    const unknown = fixture(); (unknown.topology.nodes[0].data as { kind: string }).kind = 'image';
    expect(() => parseTopologyFile(unknown)).toThrow('设备类型');
  });

  test('忽略外部文件中的图形代码、HTML 和未知属性', () => {
    const file = fixture();
    Object.assign(file.topology.nodes[0], { shape: 'html', html: '<script>alert(1)</script>' });
    Object.assign(file.topology.edges[0], { attrs: { line: { onclick: 'alert(1)' } } });
    const restored = parseTopologyFile(file);
    expect(restored.topology.nodes[0]).not.toHaveProperty('html');
    expect(restored.topology.nodes[0]).not.toHaveProperty('shape');
    expect(restored.topology.edges[0]).not.toHaveProperty('attrs');
  });

  test('五种线缆的外观设置随手工走线往返保存', () => {
    for (const style of Object.keys(cableStyles) as CableStyle[]) {
      const file = fixture();
      file.topology.edges[0].appearance = { style, width: 10, color: '#465566', arrows: false };
      const restored = parseTopologyFile(JSON.parse(JSON.stringify(file)));
      expect(restored).toEqual(file);
    }
  });

  test('兼容没有外观字段的旧存档，不向旧配置写入默认值', () => {
    const file = fixture();
    const restored = parseTopologyFile(file);
    expect(restored).toEqual(file);
    expect(restored.topology.edges[0]).not.toHaveProperty('appearance');
    expect(cableAppearance('rf').style).toBe('braided');
    expect(cableAppearance('if').style).toBe('jacket');
  });

  test('拒绝越界粗细、未知样式、外部贴图和非法箭头配置', () => {
    for (const patch of [
      { width: 0 }, { width: 15 }, { width: NaN }, { style: 'unknown' },
      { color: 'url(https://example.com/texture.svg)' }, { arrows: 'yes' },
    ]) {
      const file = fixture();
      file.topology.edges[0].appearance = { ...cableAppearance('rf'), ...patch } as ReturnType<typeof cableAppearance>;
      expect(() => parseTopologyFile(file)).toThrow('线缆');
    }
  });

  test('48 个端口四边等距排列，不重叠且尺寸保持紧凑', () => {
    const data = fixture().topology.nodes.find((n) => n.data.kind === 'switch')!.data;
    const sides = ['left', 'right', 'top', 'bottom'] as const;
    data.ports = Array.from({ length: 48 }, (_, i) => ({ id: `ge${i + 1}`, label: `GE${i + 1}`, kind: 'ethernet', side: sides[i % 4] }));
    data.portSpacing = 24;
    const geometry = deviceGeometry(data);
    expect(geometry.width).toBe(312);
    expect(geometry.height).toBe(312);
    for (const side of sides) {
      const positions = geometry.ports.filter((p) => p.side === side).map((p) => side === 'left' || side === 'right' ? p.y : p.x);
      expect(positions.length).toBe(12);
      for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(24);
    }
    for (const p of geometry.ports) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(geometry.width);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(geometry.height);
    }
  });

  test('自定义端口参与连接校验，配置和手动走线可往返恢复', () => {
    const file = fixture();
    const node = file.topology.nodes.find((n) => n.id === 'sw-01')!;
    node.data.ports = [...devicePorts(node.data), { id: 'ge24', label: 'GE24', kind: 'ethernet', side: 'right' }];
    node.data.portSpacing = 32;
    file.topology.edges.push({ id: 'custom-port-link', source: { cell: 'sw-01', port: 'ge24' }, target: { cell: 'srv-01', port: 'eth1' }, kind: 'ethernet', label: '自定义端口', vertices: [{ x: 1200, y: 600 }] });
    const restored = parseTopologyFile(JSON.parse(JSON.stringify(file)));
    expect(restored).toEqual(file);
    expect(deviceGeometry(restored.topology.nodes.find((n) => n.id === 'sw-01')!.data)).toEqual(deviceGeometry(node.data));
    node.data.ports.find((p) => p.id === 'ge24')!.kind = 'rf';
    expect(() => parseTopologyFile(file)).toThrow('类型不匹配');
  });

  test('旧配置保持原端口坐标，空端口配置不回退到默认端口', () => {
    const data = fixture().topology.nodes.find((n) => n.id === 'sw-01')!.data;
    const old = deviceGeometry(data);
    expect(old.ports.find((p) => p.id === 'ge1')).toMatchObject({ x: 0, y: 40 });
    expect(old.ports.find((p) => p.id === 'ge2')).toMatchObject({ x: 0, y: 99 });
    data.ports = [];
    expect(devicePorts(data)).toEqual([]);
    expect(deviceGeometry(data).ports).toEqual([]);
  });

  test('仅覆写端口名称保留原始偏移，明确间距或无偏移的同侧端口继续等距排列', () => {
    const data = fixture().topology.nodes.find((n) => n.id === 'sw-01')!.data;
    const original = deviceGeometry(data);
    const named = { ...data, ports: devicePorts(data).map(port => ({ ...port, label: `业务 ${port.label}` })) };
    const geometry = deviceGeometry(named);
    expect(geometry.ports.map(({ id, x, y }) => ({ id, x, y }))).toEqual(original.ports.map(({ id, x, y }) => ({ id, x, y })));
    expect(geometry.ports[0].label).toBe(`业务 ${original.ports[0].label}`);
    const spacing = deviceGeometry({ ...named, portSpacing: 24 });
    expect(spacing.ports.find(port => port.id === 'ge1')!.y).toBe(24);
    const unpositioned = deviceGeometry({ ...named, ports: named.ports.map(({ offset: _offset, ...port }) => port) });
    expect(unpositioned).toEqual({ ...spacing, ports: spacing.ports.map(({ offset: _offset, ...port }) => port) });
  });

  test('节点按参数数量收紧高度，连接点随边界变化且配置不被改写', () => {
    const node = fixture().topology.nodes.find((n) => n.id === 'sw-01')!;
    const original = structuredClone(node);
    const full = deviceGeometry(node.data);
    expect(full.height).toBe(132);
    const single = deviceGeometry({ ...node.data, visibleMetrics: node.data.visibleMetrics.slice(0, 1) });
    expect(single.height).toBe(116);
    const compact = deviceGeometry({ ...node.data, visibleMetrics: [] });
    expect(compact.height).toBe(90);
    for (const geometry of [single, compact]) {
      expect(geometry.width).toBe(full.width);
      expect(geometry.ports.map((p) => p.id)).toEqual(full.ports.map((p) => p.id));
      for (const port of geometry.ports) {
        expect(port.x).toBeGreaterThanOrEqual(0);
        expect(port.x).toBeLessThanOrEqual(geometry.width);
        expect(port.y).toBeGreaterThanOrEqual(0);
        expect(port.y).toBeLessThanOrEqual(geometry.height);
        if (port.side === 'bottom') expect(port.y).toBe(geometry.height);
        if (port.side === 'top') expect(port.y).toBe(0);
        if (port.side === 'left' || port.side === 'right') {
          expect(port.y / geometry.height).toBeCloseTo(full.ports.find((p) => p.id === port.id)!.y / full.height);
        }
      }
    }
    expect(node).toEqual(original);
  });

  test('参数全隐藏时密集端口仍有足够间距，文件往返保留隐藏设置和走线', () => {
    const file = fixture();
    const node = file.topology.nodes.find((n) => n.id === 'sw-01')!;
    node.data.visibleMetrics = [];
    node.data.ports = [...devices.switch.ports, ...Array.from({ length: 20 }, (_, i): PortDefinition => ({ id: `extra-${i}`, label: `GE${i}`, kind: 'ethernet', side: 'right' }))];
    node.data.portSpacing = 24;
    const geometry = deviceGeometry(node.data);
    const right = geometry.ports.filter((p) => p.side === 'right');
    for (let i = 1; i < right.length; i++) expect(right[i].y - right[i - 1].y).toBeGreaterThanOrEqual(24);
    const restored = parseTopologyFile(JSON.parse(JSON.stringify(file)));
    expect(restored).toEqual(file);
    expect(deviceGeometry(restored.topology.nodes.find((n) => n.id === node.id)!.data)).toEqual(geometry);
  });

  test('已连接端口可改名或移动，禁止删除或更改类型', () => {
    const current = devices.switch.ports;
    const connected = new Set(['ge1']);
    const next = structuredClone(current); next[0].label = '业务网口'; next[0].side = 'bottom';
    expect(() => assertConnectedPortsPreserved(current, next, connected)).not.toThrow();
    expect(() => assertConnectedPortsPreserved(current, current.filter((p) => p.id !== 'ge1'), connected)).toThrow('已连接');
    next[0].kind = 'rf';
    expect(() => assertConnectedPortsPreserved(current, next, connected)).toThrow('已连接');
  });

  test('拒绝重复端口、无效方向、过多端口和不合法间距', () => {
    const port: PortDefinition = { id: 'p1', label: 'GE1', kind: 'ethernet', side: 'left' };
    for (const ports of [[port, port], [{ ...port, side: 'invalid' }], Array(129).fill(port)]) {
      const file = fixture(); file.topology.nodes[0].data.ports = ports as PortDefinition[];
      expect(() => parseTopologyFile(file)).toThrow('端口');
    }
    const file = fixture(); file.topology.nodes[0].data.portSpacing = 5;
    expect(() => parseTopologyFile(file)).toThrow('间距');
  });
});
