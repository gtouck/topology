import { escapeHtml as esc } from './icons';
import type { DeviceData, DeviceDefinition } from './topology';

export function metricOptions(data: DeviceData, definition: DeviceDefinition) {
  return definition.metrics.map((metric) => `<label><input type="checkbox" name="visible-metric" value="${esc(metric.key)}" ${data.visibleMetrics.includes(metric.key) ? 'checked' : ''}/>${esc(metric.label)}</label>`).join('') || '<p class="muted">此模板未配置参数</p>';
}

export function metricValueHtml(value: string, unit: string) {
  return `${esc(value)}<small>${value === '—' ? '' : esc(unit)}</small>`;
}

export function metricDetails(definition: DeviceDefinition, value: (key: string) => string, dataLabel: string) {
  const first = definition.metrics[0];
  return `<div class="detail-section"><h4>实时参数 <span class="green-text">${esc(dataLabel)}</span></h4>${first ? `<div class="detail-metrics">${definition.metrics.map((metric) => `<div><span>${esc(metric.label)}</span><strong data-detail-metric="${esc(metric.key)}">${metricValueHtml(value(metric.key), metric.unit)}</strong></div>`).join('')}</div><div class="trend-heading"><span>${esc(first.label)}趋势</span><small>最近 30 次采样</small></div><svg class="trend-chart" viewBox="0 0 210 52" aria-label="参数趋势"><path class="trend-grid" d="M0 12H210 M0 32H210 M0 51H210"/><path id="trend-area"/><path id="trend-line"/></svg>` : '<p class="muted">此节点未配置参数，仍可查看设备信息和连接关系。</p>'}</div>`;
}
