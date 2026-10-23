export const UI_PREFERENCES_KEY = 'topology-workbench-ui-v1';
const limits = { sidebar: [180, 320], inspector: [240, 420] } as const;
type Panel = keyof typeof limits;
interface Preferences {
  version: 1; sidebarCollapsed: boolean; inspectorCollapsed: boolean;
  sidebarWidth: number; inspectorWidth: number; sections: Record<string, boolean>;
}
const defaults = (): Preferences => ({ version: 1, sidebarCollapsed: false, inspectorCollapsed: false, sidebarWidth: 208, inspectorWidth: 280, sections: {} });

/** UI preferences never enter topology documents, telemetry or undo history. */
export class WorkbenchLayout {
  private preferences = defaults();
  private mobileOpen = false;
  private mobile = matchMedia('(max-width: 650px)');
  private warned = false;

  constructor(private onStorageError: () => void) {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || 'null');
      if (saved?.version === 1) {
        for (const panel of ['sidebar', 'inspector'] as const) {
          const collapsed = `${panel}Collapsed` as const, width = `${panel}Width` as const;
          if (typeof saved[collapsed] === 'boolean') this.preferences[collapsed] = saved[collapsed];
          if (Number.isFinite(saved[width])) this.preferences[width] = this.clamp(panel, saved[width]);
        }
        if (saved.sections && typeof saved.sections === 'object') {
          this.preferences.sections = Object.fromEntries(Object.entries(saved.sections).filter(([key, value]) => /^[\w-]{1,40}$/.test(key) && typeof value === 'boolean')) as Record<string, boolean>;
        }
      }
    } catch { /* Corrupt or unavailable preferences do not affect the workspace. */ }
    this.mobile.addEventListener('change', () => { this.mobileOpen = false; this.apply(); });
    for (const panel of ['sidebar', 'inspector'] as const) this.bindResize(panel);
    document.querySelector('#sidebar-backdrop')!.addEventListener('click', () => this.closeDrawer());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.mobileOpen) { event.preventDefault(); event.stopImmediatePropagation(); this.closeDrawer(); }
    });
    this.apply();
  }

  toggle(panel: Panel) {
    if (panel === 'sidebar' && this.mobile.matches) this.mobileOpen = !this.mobileOpen;
    else {
      const key = `${panel}Collapsed` as const;
      this.preferences[key] = !this.preferences[key]; this.save();
    }
    this.apply();
    if (panel === 'sidebar' && this.mobileOpen) document.querySelector<HTMLButtonElement>('#sidebar .drawer-close')?.focus();
  }

  closeDrawer() {
    if (!this.mobileOpen) return;
    this.mobileOpen = false; this.apply();
    document.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar"]')?.focus();
  }

  sectionOpen(key: string, fallback: boolean) { return this.preferences.sections[key] ?? fallback; }
  rememberSection(section: HTMLDetailsElement) {
    const key = section.dataset.propertySection;
    if (!key || this.preferences.sections[key] === section.open) return;
    this.preferences.sections[key] = section.open; this.save();
  }

  private clamp(panel: Panel, value: number) { return Math.round(Math.min(limits[panel][1], Math.max(limits[panel][0], value))); }
  private apply() {
    const body = document.body, prefs = this.preferences;
    body.style.setProperty('--sidebar-width', `${prefs.sidebarWidth}px`);
    body.style.setProperty('--inspector-width', `${prefs.inspectorWidth}px`);
    body.dataset.sidebarCollapsed = String(prefs.sidebarCollapsed);
    body.dataset.inspectorCollapsed = String(prefs.inspectorCollapsed);
    body.dataset.sidebarDrawer = String(this.mobileOpen);
    document.querySelector<HTMLElement>('#sidebar-backdrop')!.hidden = !this.mobileOpen;
    const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
    sidebar.inert = this.mobile.matches && !this.mobileOpen;
    document.querySelector<HTMLElement>('.workspace')!.inert = this.mobile.matches && this.mobileOpen;
    for (const panel of ['sidebar', 'inspector'] as const) {
      const button = document.querySelector<HTMLButtonElement>(`[data-action="toggle-${panel}"]`)!;
      const expanded = panel === 'sidebar' && this.mobile.matches ? this.mobileOpen : !prefs[`${panel}Collapsed`];
      button.setAttribute('aria-expanded', String(expanded));
      button.title = `${expanded ? '收起' : '展开'}${panel === 'sidebar' ? '节点库' : '属性栏'}`;
      button.setAttribute('aria-label', button.title);
      document.querySelector(`#${panel}-resizer`)!.setAttribute('aria-valuenow', String(prefs[`${panel}Width`]));
    }
  }
  private save() {
    try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(this.preferences)); }
    catch { if (!this.warned) { this.warned = true; this.onStorageError(); } }
  }
  private bindResize(panel: Panel) {
    const handle = document.querySelector<HTMLElement>(`#${panel}-resizer`)!;
    const key = `${panel}Width` as const, sign = panel === 'sidebar' ? 1 : -1;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.mobile.matches) return;
      event.preventDefault();
      const start = event.clientX, width = this.preferences[key];
      handle.setPointerCapture(event.pointerId); document.body.classList.add('resizing-panel');
      const move = (next: PointerEvent) => { this.preferences[key] = this.clamp(panel, width + (next.clientX - start) * sign); this.apply(); };
      const finish = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('lostpointercapture', finish);
        document.body.classList.remove('resizing-panel'); this.save();
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('lostpointercapture', finish);
      handle.addEventListener('pointerup', () => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); }, { once: true });
    });
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      this.preferences[key] = event.key === 'Home' ? limits[panel][0] : event.key === 'End' ? limits[panel][1] : this.clamp(panel, this.preferences[key] + (event.key === 'ArrowRight' ? 1 : -1) * sign * (event.shiftKey ? 40 : 10));
      this.apply(); this.save();
    });
    handle.addEventListener('dblclick', () => { this.preferences[key] = defaults()[key]; this.apply(); this.save(); });
  }
}
