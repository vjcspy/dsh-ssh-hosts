/**
 * The SSH tab's scoped stylesheet.
 *
 * One `<style>` element is created inside a `ctx.effect()`, marked with
 * `data-plugin` / `data-plugin-css` and removed by that same effect's disposer,
 * so hot re-activation never accumulates nodes. Every rule is scoped to
 * `[data-dsh-ssh]`. Chrome colours come from the platform's `--dsw-alias-*`
 * theme aliases, so every palette skin applies; only the named host/group
 * accent colours are fixed hues.
 */
import type { Context } from '@deepseek-ai/cordis'

import { PLUGIN_ID } from '../config.ts'

const STYLE_ID = `${PLUGIN_ID}/hosts`

const CSS = `
[data-dsh-ssh] {
  --ssh-violet: #8b5cf6; --ssh-teal: #14b8a6; --ssh-blue: #3b82f6; --ssh-green: #22c55e; --ssh-amber: #f59e0b;
  --ssh-red: #ef4444; --ssh-pink: #ec4899; --ssh-slate: #64748b; --ssh-orange: #f97316; --ssh-cyan: #06b6d4;
  display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px;
}
[data-dsh-ssh] *, [data-dsh-ssh] *::before, [data-dsh-ssh] *::after { box-sizing: border-box; }
[data-dsh-ssh] button { font: inherit; color: inherit; cursor: pointer; }
[data-dsh-ssh] button:disabled { cursor: default; opacity: 0.5; }
[data-dsh-ssh] .ssh-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

[data-dsh-ssh] .ssh-toolbar { display: flex; gap: 6px; padding: 10px 10px 6px; align-items: center; }
[data-dsh-ssh] .ssh-search {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit;
}
[data-dsh-ssh] .ssh-search:focus { outline: 1px solid var(--dsw-alias-state-business-primary); }
[data-dsh-ssh] .ssh-icon-btn, [data-dsh-ssh] .ssh-btn {
  height: 30px; padding: 0 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-1);
}
[data-dsh-ssh] .ssh-icon-btn:hover:not(:disabled), [data-dsh-ssh] .ssh-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
[data-dsh-ssh] .ssh-btn--primary { background: var(--dsw-alias-state-business-primary); color: #fff; border-color: transparent; }
[data-dsh-ssh] .ssh-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-state-business-primary); filter: brightness(1.1); }
[data-dsh-ssh] .ssh-btn--danger { color: var(--dsw-alias-state-error-primary); }

[data-dsh-ssh] .ssh-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 12px; }
[data-dsh-ssh] .ssh-section { margin-top: 8px; }
[data-dsh-ssh] .ssh-section-head {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 6px; border: none; background: none;
  color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; text-align: left;
}
[data-dsh-ssh] .ssh-chip { width: 8px; height: 8px; border-radius: 50%; background: var(--ssh-slate); flex: none; }
[data-dsh-ssh] .ssh-count { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-weight: 500; }

[data-dsh-ssh] .ssh-row {
  position: relative; display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 12px; border-radius: var(--dsw-radius-md);
  cursor: pointer; border: 0.5px solid transparent;
}
[data-dsh-ssh] .ssh-row:hover, [data-dsh-ssh] .ssh-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-hover); }
[data-dsh-ssh] .ssh-row[data-selected='true'] { border-color: var(--dsw-alias-border-l3); }
[data-dsh-ssh] .ssh-accent { position: absolute; left: 3px; top: 7px; bottom: 7px; width: 3px; border-radius: 2px; background: var(--ssh-slate); }
[data-dsh-ssh] .ssh-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
[data-dsh-ssh] .ssh-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; gap: 6px; align-items: center; }
[data-dsh-ssh] .ssh-sub { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsh-ssh] .ssh-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
[data-dsh-ssh] .ssh-badge {
  font-size: 10.5px; line-height: 16px; padding: 0 6px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); white-space: nowrap;
}
[data-dsh-ssh] .ssh-badge--warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
[data-dsh-ssh] .ssh-badge--error { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
[data-dsh-ssh] .ssh-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; border: 1.5px solid var(--dsw-alias-label-tertiary); }
[data-dsh-ssh] .ssh-dot[data-state='up'] { background: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
[data-dsh-ssh] .ssh-dot[data-state='down'] { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
[data-dsh-ssh] .ssh-dot[data-state='unknown'] { background: var(--dsw-alias-label-tertiary); }
[data-dsh-ssh] .ssh-latency { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
[data-dsh-ssh] .ssh-actions { display: none; gap: 2px; }
[data-dsh-ssh] .ssh-row:hover .ssh-actions, [data-dsh-ssh] .ssh-row[data-selected='true'] .ssh-actions { display: flex; }
[data-dsh-ssh] .ssh-act { width: 26px; height: 26px; border: none; background: none; border-radius: var(--dsw-radius-sm); font-size: 13px; }
[data-dsh-ssh] .ssh-act:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3); }
[data-dsh-ssh] .ssh-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l3); border-top-color: var(--dsw-alias-state-business-primary); animation: ssh-spin 0.8s linear infinite; }
@keyframes ssh-spin { to { transform: rotate(360deg); } }

[data-dsh-ssh] .ssh-empty { padding: 28px 18px; text-align: center; color: var(--dsw-alias-label-secondary); display: flex; flex-direction: column; gap: 10px; align-items: center; }
[data-dsh-ssh] .ssh-empty h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; }
[data-dsh-ssh] .ssh-empty p { margin: 0; font-size: 12px; line-height: 18px; max-width: 280px; }
[data-dsh-ssh] .ssh-banner { margin: 6px 10px; padding: 8px 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); font-size: 12px; overflow-wrap: anywhere; }
[data-dsh-ssh] .ssh-toast { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 5; padding: 8px 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-4); font-size: 12px; display: flex; gap: 8px; overflow-wrap: anywhere; }
[data-dsh-ssh] .ssh-toast button { margin-left: auto; border: none; background: none; }
[data-dsh-ssh] .ssh-footnote { padding: 6px 12px 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }

[data-dsh-ssh] .ssh-drawer { position: absolute; inset: 0; z-index: 4; background: var(--dsw-alias-bg-base); display: flex; flex-direction: column; }
[data-dsh-ssh] .ssh-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l3); font-weight: 600; }
[data-dsh-ssh] .ssh-drawer-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
[data-dsh-ssh] .ssh-drawer-foot { display: flex; gap: 6px; padding: 10px; border-top: 0.5px solid var(--dsw-alias-border-l3); }
[data-dsh-ssh] .ssh-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
[data-dsh-ssh] .ssh-field > label, [data-dsh-ssh] .ssh-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
[data-dsh-ssh] .ssh-input, [data-dsh-ssh] .ssh-select, [data-dsh-ssh] .ssh-textarea {
  width: 100%; min-height: 30px; padding: 4px 8px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit;
}
[data-dsh-ssh] .ssh-input:focus, [data-dsh-ssh] .ssh-select:focus, [data-dsh-ssh] .ssh-textarea:focus { outline: 1px solid var(--dsw-alias-state-business-primary); }
[data-dsh-ssh] .ssh-input[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
[data-dsh-ssh] .ssh-error { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
[data-dsh-ssh] .ssh-grid2 { display: grid; grid-template-columns: 1fr 90px; gap: 8px; }
[data-dsh-ssh] .ssh-seg { display: flex; flex-wrap: wrap; gap: 4px; }
[data-dsh-ssh] .ssh-seg button { padding: 3px 9px; border-radius: 12px; border: 0.5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); font-size: 11.5px; }
[data-dsh-ssh] .ssh-seg button[aria-pressed='true'] { background: var(--dsw-alias-state-business-primary); color: #fff; border-color: transparent; }
[data-dsh-ssh] .ssh-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
[data-dsh-ssh] .ssh-swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; padding: 0; background: var(--ssh-slate); }
[data-dsh-ssh] .ssh-swatch[aria-pressed='true'] { border-color: var(--dsw-alias-label-primary); }
[data-dsh-ssh] .ssh-preview { padding: 8px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); font-size: 11.5px; line-height: 17px; overflow-wrap: anywhere; user-select: all; }
[data-dsh-ssh] .ssh-disclosure { border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); }
[data-dsh-ssh] .ssh-disclosure > summary { padding: 6px 10px; cursor: pointer; color: var(--dsw-alias-label-secondary); }
[data-dsh-ssh] .ssh-disclosure-body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
[data-dsh-ssh] .ssh-kv { display: grid; grid-template-columns: 1fr 1fr 26px; gap: 4px; align-items: center; }
[data-dsh-ssh] .ssh-fwd { display: grid; grid-template-columns: 82px 1fr 1fr 26px; gap: 4px; align-items: center; }
[data-dsh-ssh] .ssh-hint { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
`

/**
 * Install the stylesheet, owned by an effect of `ctx`.
 * @param ctx - browser-side plugin context.
 */
export function installStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_ID)
    style.setAttribute('data-plugin-css', STYLE_ID)
    style.textContent = CSS
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-ssh-hosts: stylesheet')
}
