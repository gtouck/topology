import { deviceGeometry, devicePorts, linkTypes, MAX_DEVICE_PORTS, parseDevicePorts, portSides, type DeviceData, type LinkKind, type PortDefinition } from './topology';
import { escapeHtml as esc, icon } from './icons';
import { clearFieldErrors, showFieldError } from './ui-forms';

type Distribution = 'around' | 'vertical' | 'horizontal' | PortDefinition['side'] | 'custom';
const distributionSides: Record<Exclude<Distribution, 'custom'>, PortDefinition['side'][]> = {
  around: ['left', 'right', 'top', 'bottom'], vertical: ['left', 'right'], horizontal: ['top', 'bottom'],
  left: ['left'], right: ['right'], top: ['top'], bottom: ['bottom'],
};

function inferDistribution(ports: PortDefinition[]): Distribution {
  if (!ports.length) return 'around';
  const count = (side: PortDefinition['side']) => ports.filter(port => port.side === side).length;
  for (const side of Object.keys(portSides) as PortDefinition['side'][]) if (count(side) === ports.length) return side;
  for (const distribution of ['vertical', 'horizontal', 'around'] as const) {
    const counts = distributionSides[distribution].map(count);
    if (counts.every(value => value > 0) && counts.reduce((sum, value) => sum + value, 0) === ports.length && Math.max(...counts) - Math.min(...counts) <= 1) return distribution;
  }
  return 'custom';
}

export class PortEditor {
  private ports: PortDefinition[];
  private spacing: number;
  private initialPorts: string;
  private initialLayout: string;
  private arranged = false;
  private bulk = { count: 8, prefix: 'GE', kind: 'ethernet' as LinkKind, distribution: 'around' as Distribution };

  constructor(private root: HTMLElement, private data: DeviceData, private connected: Set<string>) {
    this.ports = devicePorts(data).map(port => ({ ...port }));
    this.initialPorts = JSON.stringify(this.ports);
    this.initialLayout = this.layoutSignature();
    this.spacing = data.portSpacing ?? 24;
    this.bulk.distribution = inferDistribution(this.ports);
    this.render();
    root.oninput = (event) => this.onInput(event);
    root.onchange = (event) => this.onInput(event);
    root.onclick = (event) => this.onClick(event);
  }

  read() {
    this.showError('');
    if (!Number.isInteger(this.spacing) || this.spacing < 18 || this.spacing > 48) throw new Error('端口间距需为 18–48 px 的整数');
    const configuration = this.configuration();
    return { ...configuration, ports: parseDevicePorts(configuration.ports) };
  }

  private layoutSignature() { return JSON.stringify(this.ports.map(({ id, side }) => ({ id, side }))); }

  private configuration() {
    const rearrange = this.arranged || this.spacing !== (this.data.portSpacing ?? 24) || this.layoutSignature() !== this.initialLayout;
    const ports = this.ports.map(({ offset, ...port }) => ({ ...port, ...(!rearrange && offset !== undefined ? { offset } : {}) }));
    // Names and types do not change geometry. Retain legacy offsets until the
    // user changes spacing, sides, order or count, or explicitly arranges ports.
    return { ports, ...(rearrange || this.data.portSpacing !== undefined ? { portSpacing: this.spacing } : {}) };
  }

  hasChanges() {
    return this.arranged || this.spacing !== (this.data.portSpacing ?? 24) || JSON.stringify(this.ports) !== this.initialPorts;
  }

  showError(message: string) {
    clearFieldErrors(this.root);
    const error = this.root.querySelector<HTMLElement>('#port-editor-error')!;
    error.textContent = message;
    if (!message) return;
    let parent: HTMLElement | null = this.root;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    const field = message.includes('端口间距') ? this.root.querySelector<HTMLInputElement>('#port-spacing')
      : message.includes('名称前缀') ? this.root.querySelector<HTMLInputElement>('#port-prefix')
      : message.includes('新增数量') ? this.root.querySelector<HTMLInputElement>('#port-count')
      : message.includes('端口名称') ? [...this.root.querySelectorAll<HTMLInputElement>('[data-port-field="label"]')].find(input => !input.value.trim()) : undefined;
    if (field) {
      error.textContent = '';
      showFieldError(field.id, message);
      // Keep the input and its inline error clear of the sticky modal footer.
      field.parentElement!.scrollIntoView({ block: 'center' });
    } else {
      error.tabIndex = -1;
      error.focus({ preventScroll: true }); error.scrollIntoView({ block: 'center' });
    }
  }

  private render() {
    this.root.innerHTML = `
      <p class="modal-description">改名保留原端点位置。调整排布、数量、顺序或间距后按所在边等距排列，数量增加时自动扩展节点尺寸。</p>
      <div class="port-editor-top"><div class="port-layout-preview" id="port-layout-preview"></div><div class="port-layout-settings">
        <label class="field">最小端口间距（px）<input type="number" id="port-spacing" min="18" max="48" step="1" value="${this.spacing}" /></label>
        <button type="button" class="button full-width" data-port-action="balance" ${this.bulk.distribution === 'custom' ? 'disabled' : ''}>${icon('Layers', 15)}按所选排布整理</button>
        <p>切换排布会更新全部端口预览，应用后生效。自定义时新增沿用已有边；同侧按列表顺序排列。</p>
      </div></div>
      <div class="port-bulk"><div class="port-bulk-title">端口数量与排布 <span>每个节点最多 ${MAX_DEVICE_PORTS} 个</span></div><div class="port-bulk-fields">
        <label class="field">名称前缀<input id="port-prefix" maxlength="12" value="${esc(this.bulk.prefix)}" /></label>
        <label class="field">新增数量<input type="number" id="port-count" min="1" max="64" value="${this.bulk.count}" /></label>
        <label class="field">类型<select id="port-bulk-kind">${Object.entries(linkTypes).map(([kind, def]) => `<option value="${kind}" ${kind === this.bulk.kind ? 'selected' : ''}>${def.label}</option>`).join('')}</select></label>
        <label class="field">端口排布<select id="port-distribution">${Object.entries({ custom: '自定义（按端口所在边）', around: '四边均分', vertical: '左右均分', horizontal: '上下均分', ...portSides }).map(([key, label]) => `<option value="${key}" ${key === this.bulk.distribution ? 'selected' : ''} ${key === 'custom' ? 'disabled' : ''}>${label}</option>`).join('')}</select></label>
      </div><div class="port-bulk-actions"><button type="button" class="button" data-port-action="fill-24">补齐 24 口</button><button type="button" class="button" data-port-action="fill-48">补齐 48 口</button><button type="button" class="button" data-port-action="add-one">${icon('Plus', 14)}新增 1 个</button><button type="button" class="button" data-port-action="add-batch">${icon('Plus', 14)}批量新增</button></div></div>
      <div class="port-table-heading"><strong id="port-table-count">端口列表 · ${this.ports.length}</strong><span>已连接端口不能删除或更改类型</span></div>
      <div class="port-editor-table"><div class="port-editor-columns"><span>名称 / 连接状态</span><span>类型</span><span>所在边</span><span>排序 / 删除</span></div><div id="port-editor-rows"></div></div>
      <p class="port-editor-error" id="port-editor-error" role="alert"></p>
      <p class="port-editor-note">应用后保留端口 ID、已有连线和手动拐点。节点尺寸或端口位置变化后，可手动调整周边节点和走线。</p>`;
    this.renderRows(); this.renderPreview();
  }

  private renderRows() {
    this.root.querySelector<HTMLElement>('#port-table-count')!.textContent = `端口列表 · ${this.ports.length}`;
    this.root.querySelector<HTMLElement>('#port-editor-rows')!.innerHTML = this.ports.map((p, index) => {
      const used = this.connected.has(p.id);
      const group = this.ports.filter((entry) => entry.side === p.side);
      return `<div class="port-editor-row" data-port-id="${esc(p.id)}">
        <div class="port-name-field"><input id="port-label-${index}" aria-label="端口名称" data-port-field="label" maxlength="40" value="${esc(p.label)}" title="ID: ${esc(p.id)}"/><small class="${used ? 'port-used' : ''}">${used ? '已连接' : '未连接'}</small></div>
        <select aria-label="端口类型" data-port-field="kind" ${used ? 'disabled' : ''}>${Object.entries(linkTypes).map(([kind, def]) => `<option value="${kind}" ${kind === p.kind ? 'selected' : ''}>${def.short}</option>`).join('')}</select>
        <select aria-label="端口所在边" data-port-field="side">${Object.entries(portSides).map(([side, label]) => `<option value="${side}" ${side === p.side ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <div class="port-row-actions"><button type="button" class="icon-button" data-port-action="up" title="在同一边前移" aria-label="端口前移" ${group[0].id === p.id ? 'disabled' : ''}><span>↑</span></button><button type="button" class="icon-button" data-port-action="down" title="在同一边后移" aria-label="端口后移" ${group.at(-1)!.id === p.id ? 'disabled' : ''}><span>↓</span></button><button type="button" class="icon-button" data-port-action="remove" title="${used ? '请先删除关联连线' : '删除端口'}" aria-label="删除端口" ${used ? 'disabled' : ''}>${icon('Trash2', 13)}</button></div>
      </div>`;
    }).join('') || '<p class="port-editor-empty">暂无端口，可单个或批量新增。</p>';
  }

  private renderPreview() {
    const configuration = this.configuration();
    const geometry = deviceGeometry({ ...this.data, ...configuration, ...(configuration.portSpacing !== undefined ? { portSpacing: Number.isInteger(this.spacing) && this.spacing >= 18 && this.spacing <= 48 ? this.spacing : 24 } : {}) });
    const { width, height } = geometry;
    this.root.querySelector<HTMLElement>('#port-layout-preview')!.innerHTML = `<svg viewBox="-12 -12 ${width + 24} ${height + 24}" aria-label="端口排布示意"><rect width="${width}" height="${height}" rx="9" fill="#fff" stroke="#c5d7c7" stroke-width="2"/><text x="${width / 2}" y="${height / 2 - 5}" text-anchor="middle" fill="#5d8167" font-size="18">${this.ports.length} PORTS</text><text x="${width / 2}" y="${height / 2 + 19}" text-anchor="middle" fill="#9aaa96" font-size="12">${width} × ${height} px</text>${geometry.ports.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${this.connected.has(p.id) ? linkTypes[p.kind].color : '#fff'}" stroke="${linkTypes[p.kind].color}" stroke-width="2"><title>${esc(p.label)} · ${portSides[p.side]}</title></circle>`).join('')}</svg>`;
  }

  private onInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'port-spacing') { this.spacing = Number(target.value); this.renderPreview(); }
    if (target.id === 'port-prefix') this.bulk.prefix = target.value;
    if (target.id === 'port-count') this.bulk.count = Number(target.value);
    if (target.id === 'port-bulk-kind') this.bulk.kind = target.value as LinkKind;
    if (target.id === 'port-distribution') {
      this.bulk.distribution = target.value as Distribution;
      this.arrangePorts(); this.syncDistribution(false); this.renderRows(); this.renderPreview();
    }
    const id = target.closest<HTMLElement>('[data-port-id]')?.dataset.portId;
    const port = this.ports.find((p) => p.id === id);
    const field = target.dataset.portField;
    if (port && field) {
      if (field === 'label') port.label = target.value;
      if (field === 'kind' && !this.connected.has(port.id)) port.kind = target.value as LinkKind;
      if (field === 'side') { port.side = target.value as PortDefinition['side']; this.syncDistribution(); this.renderRows(); }
      this.renderPreview();
    }
  }

  private arrangePorts() {
    this.arranged = true;
    const sides = this.selectedSides();
    this.ports.forEach((port, index) => { port.side = sides[index % sides.length]; });
  }

  private selectedSides(): PortDefinition['side'][] {
    return this.bulk.distribution === 'custom' ? this.ports.length ? [...new Set(this.ports.map(port => port.side))] : distributionSides.around : distributionSides[this.bulk.distribution];
  }

  private syncDistribution(infer = true) {
    if (infer) this.bulk.distribution = inferDistribution(this.ports);
    this.root.querySelector<HTMLSelectElement>('#port-distribution')!.value = this.bulk.distribution;
    this.root.querySelector<HTMLButtonElement>('[data-port-action="balance"]')!.disabled = this.bulk.distribution === 'custom';
  }

  private onClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-port-action]');
    if (!button || button.disabled) return;
    this.showError('');
    const action = button.dataset.portAction;
    if (action === 'add-one' || action === 'add-batch' || action === 'fill-24' || action === 'fill-48') {
      const count = action === 'fill-24' ? 24 - this.ports.length : action === 'fill-48' ? 48 - this.ports.length : action === 'add-one' ? 1 : this.bulk.count;
      if (action.startsWith('fill-') && count <= 0) return this.showError('当前端口总数已达到或超过目标数量');
      if (!Number.isInteger(count) || count < 1 || count > 64) return this.showError('新增数量需为 1–64 的整数');
      if (this.ports.length + count > MAX_DEVICE_PORTS) return this.showError(`总数不能超过 ${MAX_DEVICE_PORTS} 个端口`);
      if (!this.bulk.prefix.trim()) return this.showError('请填写名称前缀');
      const sides = this.selectedSides();
      const names = new Set(this.ports.map((p) => p.label.toUpperCase()));
      let number = 1;
      for (let i = 0; i < count; i++) {
        let label: string;
        do { label = `${this.bulk.prefix.trim()}${number++}`; } while (names.has(label.toUpperCase()));
        names.add(label.toUpperCase());
        const side = sides.reduce((best, next) => this.ports.filter((p) => p.side === next).length < this.ports.filter((p) => p.side === best).length ? next : best);
        const id = `port-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
        this.ports.push({ id, label, kind: this.bulk.kind, side });
      }
    } else if (action === 'balance') {
      this.arrangePorts();
    } else {
      const id = button.closest<HTMLElement>('[data-port-id]')!.dataset.portId!;
      const index = this.ports.findIndex((p) => p.id === id);
      if (action === 'remove') {
        if (this.connected.has(id)) return this.showError('已连接端口不能删除，请先删除关联连线');
        this.ports.splice(index, 1);
      } else {
        const group = this.ports.filter((p) => p.side === this.ports[index].side);
        const neighbor = group[group.findIndex((p) => p.id === id) + (action === 'up' ? -1 : 1)];
        if (!neighbor) return;
        const other = this.ports.findIndex((p) => p.id === neighbor.id);
        [this.ports[index], this.ports[other]] = [this.ports[other], this.ports[index]];
      }
    }
    this.syncDistribution(false); this.renderRows(); this.renderPreview();
  }
}
