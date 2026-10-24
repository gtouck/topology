import { iconNames, escapeHtml as esc, icon } from './icons';
import { parseTemplate, type NodeTemplate } from './document';
import { PortEditor } from './port-editor';
import { showFieldError } from './ui-forms';

export class TemplateEditor {
  private portEditor: PortEditor;
  constructor(private root: HTMLElement, private initial: NodeTemplate, used: number, connected: Set<string>) {
    root.innerHTML = `<p class="modal-description">${used ? `当前 ${used} 个节点引用此模板。修改会同步应用，可一步撤销。` : '模板随拓扑保存，也可导出供其他拓扑复用。'} 移除参数会清理对应可见项和字段绑定；已有连接的端口不能删除或变更类型。</p>
      <div class="template-basics"><label class="field">模板名称<input id="template-name" maxlength="40" value="${esc(initial.label)}" /></label><label class="field">英文标记<input id="template-en" maxlength="40" value="${esc(initial.en)}" /></label><label class="field">图标<select id="template-icon">${iconNames.map(name => `<option ${name === initial.icon ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
      <label class="field">模板说明<input id="template-model" maxlength="100" value="${esc(initial.model)}" /></label>
      <h3>参数定义 <span class="muted">最多 20 项，卡片显示最多 2 项</span></h3><div id="template-metrics" tabindex="-1"><div class="template-metric-head"><span>标识（稳定键）</span><span>显示名称</span><span>单位</span><span>小数位</span><span></span></div><div id="template-metric-rows"></div></div>
      <button type="button" class="button" data-template-action="add-metric">${icon('Plus', 14)}添加参数</button>
      <details class="template-ports"><summary>模板连接点</summary><div id="template-port-editor"></div></details>`;
    this.renderMetrics(initial.metrics);
    this.portEditor = new PortEditor(root.querySelector('#template-port-editor')!, { kind: initial.id, title: initial.label, deviceId: 'preview', address: '', status: 'normal', visibleMetrics: [], ports: structuredClone(initial.ports) }, connected);
    // Spacing is a per-node override in v3, so do not offer an unsaved template setting.
    root.querySelector('#port-spacing')?.closest('label')?.remove();
    root.querySelector('.port-layout-settings p')!.textContent = '同侧按列表顺序排列。最小间距可在节点的端口配置中单独调整。';
    root.onclick = event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-template-action]'); if (!button) return;
      const metrics = this.metrics();
      if (button.dataset.templateAction === 'add-metric') {
        if (metrics.length >= 20) { showFieldError('template-metrics', '最多配置 20 项参数'); return; }
        metrics.push({ key: '', label: '', unit: '', decimals: 1 });
      } else metrics.splice(Number(button.dataset.index), 1);
      this.renderMetrics(metrics);
      if (button.dataset.templateAction === 'add-metric') root.querySelector<HTMLInputElement>('.template-metric-row:last-child input')?.focus();
    };
  }
  private metrics() {
    return [...this.root.querySelectorAll<HTMLElement>('.template-metric-row')].map(row => {
      const read = (key: string) => row.querySelector<HTMLInputElement>(`[data-metric-field="${key}"]`)!.value.trim();
      return { key: read('key'), label: read('label'), unit: read('unit'), decimals: Number(read('decimals')) };
    });
  }
  private renderMetrics(metrics: NodeTemplate['metrics']) {
    this.root.querySelector('#template-metric-rows')!.innerHTML = metrics.map((m, i) => `<div class="template-metric-row"><input aria-label="参数标识" data-metric-field="key" maxlength="100" value="${esc(m.key)}"/><input aria-label="参数名称" data-metric-field="label" maxlength="40" value="${esc(m.label)}"/><input aria-label="参数单位" data-metric-field="unit" maxlength="20" value="${esc(m.unit)}"/><input aria-label="小数位数" data-metric-field="decimals" type="number" min="0" max="6" step="1" value="${m.decimals}"/><button class="icon-button" type="button" data-template-action="remove-metric" data-index="${i}" aria-label="移除参数">${icon('Trash2', 14)}</button></div>`).join('') || '<p class="muted">暂无参数，节点仅显示标题和状态。</p>';
  }
  read() {
    const read = (id: string) => this.root.querySelector<HTMLInputElement>(`#${id}`)!.value.trim();
    if (!read('template-name')) { showFieldError('template-name', '请填写模板名称'); return; }
    try {
      const metrics = this.metrics();
      // Preserve original offsets if the port form has not changed its semantic content.
      const ports = this.portEditor.read().ports;
      const plain = (list: NodeTemplate['ports']) => list.map(({ id, label, side, kind }) => ({ id, label, side, kind }));
      return parseTemplate({ ...this.initial, label: read('template-name'), en: read('template-en'), model: read('template-model'), icon: read('template-icon'), metrics,
        ports: JSON.stringify(plain(ports)) === JSON.stringify(plain(this.initial.ports)) ? this.initial.ports : ports });
    } catch (error) { showFieldError('template-metrics', error instanceof Error ? error.message : '模板配置不合法'); }
  }
}
