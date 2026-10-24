import { escapeHtml as esc, icon } from './icons';
import { parseDataBinding, statusLabels, type DataBinding, type DeviceData, type DeviceDefinition, type DeviceStatus } from './topology';
import { showFieldError } from './ui-forms';

export function bindingForm(data: DeviceData, definition: DeviceDefinition) {
  const binding = data.binding ?? { source: data.deviceId, fields: Object.fromEntries(definition.metrics.map(m => [m.key, m.key])), statusField: 'status' };
  return `<div id="binding-editor"><label class="field">绑定源 ID<input id="binding-source" maxlength="100" value="${esc(binding.source)}" /></label>
    <div id="binding-fields" tabindex="-1">${definition.metrics.map((m, i) => `<label class="field binding-metric">${esc(m.label)} <small>${esc(m.key)}</small><input id="binding-path-${i}" data-binding-metric="${esc(m.key)}" maxlength="150" placeholder="留空表示不绑定，例如 sensors.voltage" value="${esc(binding.fields[m.key] || '')}" /></label>`).join('') || '<p class="muted">模板暂无参数。</p>'}</div>
    <label class="field">状态字段<input id="binding-status" maxlength="150" value="${esc(binding.statusField || '')}" placeholder="例如 status 或 health.state" /></label>
    <p class="field-hint">参数填写数据字段路径。状态值默认支持 normal / warning / offline，业务状态可在下面映射。</p>
    <div id="binding-status-map" tabindex="-1"><div id="binding-status-rows">${Object.entries(binding.statusMap || {}).map(([value, status], i) => statusRow(value, status, i)).join('')}</div></div>
    <button type="button" class="button" data-binding-action="add">${icon('Plus', 14)}添加状态映射</button></div>`;
}
function statusRow(value: string, status: DeviceStatus, index: number) {
  return `<div class="binding-status-row"><input id="binding-map-${index}" aria-label="业务状态值" maxlength="100" value="${esc(value)}" placeholder="例如 0 或 ONLINE"/><select aria-label="映射设备状态">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${key === status ? 'selected' : ''}>${label}</option>`).join('')}</select><button type="button" class="icon-button" data-binding-action="remove" aria-label="删除状态映射">${icon('Trash2', 14)}</button></div>`;
}
export function handleBindingClick(target: HTMLElement) {
  const button = target.closest<HTMLElement>('[data-binding-action]'); if (!button) return;
  if (button.dataset.bindingAction === 'remove') button.closest('.binding-status-row')?.remove();
  else {
    const rows = document.querySelector('#binding-status-rows')!;
    if (rows.children.length >= 30) { showFieldError('binding-status-map', '最多配置 30 项状态映射'); return; }
    rows.insertAdjacentHTML('beforeend', statusRow('', 'normal', Date.now()));
    rows.querySelector<HTMLInputElement>('.binding-status-row:last-child input')!.focus();
  }
}
export function readBindingForm(root: HTMLElement, definition: DeviceDefinition): DataBinding | undefined {
  const read = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)!.value.trim();
  let field = 'binding-source';
  try {
    const source = read(field);
    if (!source) throw new Error('请填写绑定源 ID');
    const fields: [string, string][] = [];
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-binding-metric]')) {
      field = input.id;
      if (input.value.trim()) { parseDataBinding({ source, fields: { [input.dataset.bindingMetric!]: input.value.trim() } }, definition.metrics.map(m => m.key)); fields.push([input.dataset.bindingMetric!, input.value.trim()]); }
    }
    field = 'binding-status'; const statusField = read(field);
    parseDataBinding({ source, fields: Object.fromEntries(fields), ...(statusField ? { statusField } : {}) }, definition.metrics.map(m => m.key));
    const statuses: [string, DeviceStatus][] = [];
    for (const row of root.querySelectorAll<HTMLElement>('.binding-status-row')) {
      const input = row.querySelector('input')!; field = input.id;
      const key = input.value.trim(); if (!key) throw new Error('请填写业务状态值或删除空行');
      if (statuses.some(([value]) => value === key)) throw new Error('业务状态值不能重复');
      statuses.push([key, row.querySelector('select')!.value as DeviceStatus]);
    }
    return parseDataBinding({ source, fields: Object.fromEntries(fields), ...(statusField ? { statusField } : {}), statusMap: Object.fromEntries(statuses) }, definition.metrics.map(m => m.key));
  } catch (error) { showFieldError(field, error instanceof Error ? error.message : '数据绑定不合法'); }
}
