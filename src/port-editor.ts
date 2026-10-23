import { deviceGeometry, devicePorts, linkTypes, MAX_DEVICE_PORTS, parseDevicePorts, portSides, type DeviceData, type LinkKind, type PortDefinition } from './topology';
import { escapeHtml as esc, icon } from './icons';

type Distribution = 'around' | 'vertical' | 'horizontal' | PortDefinition['side'];
const distributionSides: Record<Distribution, PortDefinition['side'][]> = {
  around: ['left', 'right', 'top', 'bottom'], vertical: ['left', 'right'], horizontal: ['top', 'bottom'],
  left: ['left'], right: ['right'], top: ['top'], bottom: ['bottom'],
};

export class PortEditor {
  private ports: PortDefinition[];
  private spacing: number;
  private bulk = { count: 8, prefix: 'GE', kind: 'ethernet' as LinkKind, distribution: 'around' as Distribution };

  constructor(private root: HTMLElement, private data: DeviceData, private connected: Set<string>) {
    this.ports = devicePorts(data).map(({ id, label, kind, side }) => ({ id, label, kind, side }));
    this.spacing = data.portSpacing ?? 24;
    this.render();
    root.oninput = (event) => this.onInput(event);
    root.onchange = (event) => this.onInput(event);
    root.onclick = (event) => this.onClick(event);
  }

  read() {
    if (!Number.isInteger(this.spacing) || this.spacing < 18 || this.spacing > 48) throw new Error('端口间距需为 18–48 px 的整数');
    return { ports: parseDevicePorts(this.ports), portSpacing: this.spacing };
  }

  showError(message: string) { this.root.querySelector<HTMLElement>('#port-editor-error')!.textContent = message; }

  private render() {
    this.root.innerHTML = `
      <p class="modal-description">端口按所在边等距排布，数量增加时自动扩展设备尺寸。名称在画布悬停时显示，保持展示界面简洁。</p>
      <div class="port-editor-top"><div class="port-layout-preview" id="port-layout-preview"></div><div class="port-layout-settings">
        <label class="field">最小端口间距（px）<input type="number" id="port-spacing" min="18" max="48" step="1" value="${this.spacing}" /></label>
        <button type="button" class="button full-width" data-port-action="balance">${icon('Layers', 15)}均衡排到四边</button>
        <p>同一边按下方列表顺序排列。可逐个调整所在边和顺序。</p>
      </div></div>
      <div class="port-bulk"><div class="port-bulk-title">批量新增端口 <span>每台设备最多 ${MAX_DEVICE_PORTS} 个</span></div><div class="port-bulk-fields">
        <label class="field">名称前缀<input id="port-prefix" maxlength="12" value="${esc(this.bulk.prefix)}" /></label>
        <label class="field">新增数量<input type="number" id="port-count" min="1" max="64" value="${this.bulk.count}" /></label>
        <label class="field">类型<select id="port-bulk-kind">${Object.entries(linkTypes).map(([kind, def]) => `<option value="${kind}" ${kind === this.bulk.kind ? 'selected' : ''}>${def.label}</option>`).join('')}</select></label>
        <label class="field">新增端口排布<select id="port-distribution">${Object.entries({ around: '四边均分', vertical: '左右均分', horizontal: '上下均分', ...portSides }).map(([key, label]) => `<option value="${key}" ${key === this.bulk.distribution ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div><div class="port-bulk-actions"><button type="button" class="button" data-port-action="fill-24">补齐 24 口</button><button type="button" class="button" data-port-action="fill-48">补齐 48 口</button><button type="button" class="button" data-port-action="add-one">${icon('Plus', 14)}新增 1 个</button><button type="button" class="button" data-port-action="add-batch">${icon('Plus', 14)}批量新增</button></div></div>
      <div class="port-table-heading"><strong id="port-table-count">端口列表 · ${this.ports.length}</strong><span>已连接端口不能删除或更改类型</span></div>
      <div class="port-editor-table"><div class="port-editor-columns"><span>名称 / 连接状态</span><span>类型</span><span>所在边</span><span>排序 / 删除</span></div><div id="port-editor-rows"></div></div>
      <p class="port-editor-error" id="port-editor-error" role="alert"></p>
      <p class="port-editor-note">应用后保留端口 ID、已有连线和手动拐点。设备尺寸或端口位置变化后，可手动调整周边设备和走线。</p>`;
    this.renderRows(); this.renderPreview();
  }

  private renderRows() {
    this.root.querySelector<HTMLElement>('#port-table-count')!.textContent = `端口列表 · ${this.ports.length}`;
    this.root.querySelector<HTMLElement>('#port-editor-rows')!.innerHTML = this.ports.map((p) => {
      const used = this.connected.has(p.id);
      const group = this.ports.filter((entry) => entry.side === p.side);
      return `<div class="port-editor-row" data-port-id="${esc(p.id)}">
        <div class="port-name-field"><input aria-label="端口名称" data-port-field="label" maxlength="40" value="${esc(p.label)}" title="ID: ${esc(p.id)}"/><small class="${used ? 'port-used' : ''}">${used ? '已连接' : '未连接'}</small></div>
        <select aria-label="端口类型" data-port-field="kind" ${used ? 'disabled' : ''}>${Object.entries(linkTypes).map(([kind, def]) => `<option value="${kind}" ${kind === p.kind ? 'selected' : ''}>${def.short}</option>`).join('')}</select>
        <select aria-label="端口所在边" data-port-field="side">${Object.entries(portSides).map(([side, label]) => `<option value="${side}" ${side === p.side ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <div class="port-row-actions"><button type="button" class="icon-button" data-port-action="up" title="在同一边前移" aria-label="端口前移" ${group[0].id === p.id ? 'disabled' : ''}><span>↑</span></button><button type="button" class="icon-button" data-port-action="down" title="在同一边后移" aria-label="端口后移" ${group.at(-1)!.id === p.id ? 'disabled' : ''}><span>↓</span></button><button type="button" class="icon-button" data-port-action="remove" title="${used ? '请先删除关联连线' : '删除端口'}" aria-label="删除端口" ${used ? 'disabled' : ''}>${icon('Trash2', 13)}</button></div>
      </div>`;
    }).join('') || '<p class="port-editor-empty">暂无端口，可单个或批量新增。</p>';
  }

  private renderPreview() {
    const geometry = deviceGeometry({ ...this.data, ports: this.ports, portSpacing: Number.isInteger(this.spacing) && this.spacing >= 18 && this.spacing <= 48 ? this.spacing : 24 });
    const { width, height } = geometry;
    this.root.querySelector<HTMLElement>('#port-layout-preview')!.innerHTML = `<svg viewBox="-12 -12 ${width + 24} ${height + 24}" aria-label="端口排布示意"><rect width="${width}" height="${height}" rx="9" fill="#fff" stroke="#c5d7c7" stroke-width="2"/><text x="${width / 2}" y="${height / 2 - 5}" text-anchor="middle" fill="#5d8167" font-size="18">${this.ports.length} PORTS</text><text x="${width / 2}" y="${height / 2 + 19}" text-anchor="middle" fill="#9aaa96" font-size="12">${width} × ${height} px</text>${geometry.ports.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${this.connected.has(p.id) ? linkTypes[p.kind].color : '#fff'}" stroke="${linkTypes[p.kind].color}" stroke-width="2"><title>${esc(p.label)} · ${portSides[p.side]}</title></circle>`).join('')}</svg>`;
  }

  private onInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'port-spacing') { this.spacing = Number(target.value); this.renderPreview(); }
    if (target.id === 'port-prefix') this.bulk.prefix = target.value;
    if (target.id === 'port-count') this.bulk.count = Number(target.value);
    if (target.id === 'port-bulk-kind') this.bulk.kind = target.value as LinkKind;
    if (target.id === 'port-distribution') this.bulk.distribution = target.value as Distribution;
    const id = target.closest<HTMLElement>('[data-port-id]')?.dataset.portId;
    const port = this.ports.find((p) => p.id === id);
    const field = target.dataset.portField;
    if (port && field) {
      if (field === 'label') port.label = target.value;
      if (field === 'kind' && !this.connected.has(port.id)) port.kind = target.value as LinkKind;
      if (field === 'side') { port.side = target.value as PortDefinition['side']; this.renderRows(); }
      this.renderPreview();
    }
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
      const sides = distributionSides[this.bulk.distribution];
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
      this.ports.forEach((p, index) => { p.side = distributionSides.around[index % 4]; });
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
    this.renderRows(); this.renderPreview();
  }
}
