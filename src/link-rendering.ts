import type { Edge, Graph } from '@antv/x6';
import { cableAttributes, cableFlowAttributes, type CableAppearance } from './cables';
import { defaultLinkFlow, linkStateLabel, type LinkFlow, type ResolvedLinkState } from './link-state';

const styles = new WeakMap<Edge, string>();
export function renderLink(graph: Graph, edge: Edge, appearance: CableAppearance, state: ResolvedLinkState, options: { flow?: LinkFlow; animate: boolean; textureId?: string }) {
  const flow = options.flow ?? defaultLinkFlow;
  const playing = options.animate && flow.enabled && state.status === 'up' && state.active;
  const key = JSON.stringify([appearance, state, flow, playing, options.textureId]);
  if (styles.get(edge) === key) return;
  const motion = cableFlowAttributes(appearance, flow.speed);
  edge.attr({ ...cableAttributes(appearance, state.status === 'down', options.textureId, state.status === 'unknown'), ...motion.attrs, statusTitle: { text: linkStateLabel(state) } }, { runtime: true });
  const container = graph.findViewByCell(edge)?.container as SVGElement | undefined;
  if (!container) return;
  container.dataset.linkStatus = state.status;
  container.dataset.linkActive = String(state.active);
  container.dataset.linkPlaying = String(playing);
  container.dataset.flowDirection = flow.direction;
  container.dataset.cableStyle = appearance.style;
  container.style.setProperty('--cable-flow-end', `${-motion.period}px`);
  container.style.setProperty('--cable-flow-duration', `${motion.duration}s`);
  styles.set(edge, key);
}
