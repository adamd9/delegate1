/**
 * Setup Wizard Component
 * Reusable component that shows configuration progress and validation status.
 * Can be embedded anywhere via: <div id="setup-wizard"></div> + SetupWizard.init('#setup-wizard')
 */
const SetupWizard = (() => {
  const STATUS_ICONS = {
    complete: '✓',
    partial: '◐',
    unconfigured: '○'
  };
  const STATUS_COLORS = {
    complete: 'var(--green, #4ade80)',
    partial: 'var(--yellow, #facc15)',
    unconfigured: 'var(--text-dim, #666)'
  };

  let _cache = null;
  let _cacheTime = 0;
  const CACHE_TTL = 10000; // 10s client-side cache

  async function fetchStatus() {
    const now = Date.now();
    if (_cache && now - _cacheTime < CACHE_TTL) return _cache;
    try {
      const res = await fetch('/api/setup/status');
      if (!res.ok) return null;
      _cache = await res.json();
      _cacheTime = now;
      return _cache;
    } catch {
      return null;
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderCompact(container, data) {
    if (!data) {
      container.innerHTML = '<div class="sw-error">Unable to load setup status</div>';
      return;
    }

    const { progress, groups } = data;
    const configured = groups.filter(g => g.status === 'complete').length;
    const total = groups.length;
    const requiredGroups = groups.filter(g => g.required);
    const requiredComplete = requiredGroups.filter(g => g.status === 'complete').length;

    container.innerHTML = `
      <div class="sw-compact">
        <div class="sw-progress-header">
          <span class="sw-progress-label">Setup Progress</span>
          <span class="sw-progress-pct">${progress}%</span>
        </div>
        <div class="sw-progress-bar">
          <div class="sw-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="sw-groups">
          ${groups.map(g => `
            <div class="sw-group-row" data-group-id="${g.id}">
              <span class="sw-group-icon" style="color:${STATUS_COLORS[g.status]}">${STATUS_ICONS[g.status]}</span>
              <span class="sw-group-name">${esc(g.name)}</span>
              ${g.required ? '<span class="sw-required-badge">required</span>' : ''}
              <span class="sw-group-count">${g.items.filter(i => i.configured).length}/${g.items.length}</span>
            </div>
          `).join('')}
        </div>
        ${progress < 100 ? `<a href="/settings?tab=config" class="sw-config-link">Configure →</a>` : ''}
      </div>
    `;

    // Add click handlers to expand groups
    container.querySelectorAll('.sw-group-row').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const detail = row.nextElementSibling;
        if (detail && detail.classList.contains('sw-group-detail')) {
          detail.remove();
        } else {
          const groupId = row.dataset.groupId;
          const group = groups.find(g => g.id === groupId);
          if (group) {
            const detailEl = document.createElement('div');
            detailEl.className = 'sw-group-detail';
            detailEl.innerHTML = group.items.map(item => `
              <div class="sw-item-row">
                <span class="sw-item-icon" style="color:${item.configured ? STATUS_COLORS.complete : STATUS_COLORS.unconfigured}">${item.configured ? '✓' : '✗'}</span>
                <span class="sw-item-label">${esc(item.label)}</span>
                ${item.validated === true ? '<span class="sw-validated">connected</span>' : ''}
                ${item.validated === false ? '<span class="sw-validate-fail">failed</span>' : ''}
              </div>
            `).join('');
            row.after(detailEl);
          }
        }
      });
    });
  }

  function renderFull(container, data) {
    if (!data) {
      container.innerHTML = '<div class="sw-error">Unable to load setup status</div>';
      return;
    }

    const { progress, groups } = data;

    container.innerHTML = `
      <div class="sw-full">
        <div class="sw-full-header">
          <h3 class="sw-title">Configuration Status</h3>
          <div class="sw-progress-ring-wrap">
            <svg class="sw-ring" viewBox="0 0 36 36">
              <path class="sw-ring-bg" d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"/>
              <path class="sw-ring-fill" stroke-dasharray="${progress}, 100" d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"/>
            </svg>
            <span class="sw-ring-text">${progress}%</span>
          </div>
        </div>
        <div class="sw-full-groups">
          ${groups.map(g => `
            <div class="sw-full-group ${g.status}">
              <div class="sw-full-group-header">
                <span class="sw-group-icon" style="color:${STATUS_COLORS[g.status]}">${STATUS_ICONS[g.status]}</span>
                <span class="sw-group-name">${esc(g.name)}</span>
                ${g.required ? '<span class="sw-required-badge">required</span>' : ''}
                <span class="sw-group-status-text">${g.status}</span>
              </div>
              <div class="sw-full-items">
                ${g.items.map(item => `
                  <div class="sw-item-row">
                    <span class="sw-item-icon" style="color:${item.configured ? STATUS_COLORS.complete : STATUS_COLORS.unconfigured}">${item.configured ? '✓' : '✗'}</span>
                    <span class="sw-item-label">${esc(item.label)}</span>
                    ${item.validated === true ? '<span class="sw-validated">connected</span>' : ''}
                    ${item.validated === false ? '<span class="sw-validate-fail">failed</span>' : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <a href="/settings?tab=config" class="sw-config-link">Open Configuration →</a>
      </div>
    `;
  }

  function injectStyles() {
    if (document.getElementById('sw-styles')) return;
    const style = document.createElement('style');
    style.id = 'sw-styles';
    style.textContent = `
      .sw-compact, .sw-full { font-size: 12px; }
      .sw-progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .sw-progress-label { color: var(--text-mid, #999); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      .sw-progress-pct { color: var(--text, #eee); font-weight: 600; font-size: 13px; }
      .sw-progress-bar { height: 4px; background: var(--surface2, #333); border-radius: 2px; overflow: hidden; margin-bottom: 10px; }
      .sw-progress-fill { height: 100%; background: var(--green, #4ade80); border-radius: 2px; transition: width 0.3s ease; }
      .sw-groups { display: flex; flex-direction: column; gap: 2px; }
      .sw-group-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; font-size: 11px; }
      .sw-group-row:hover { background: var(--surface2, #333); }
      .sw-group-icon { font-size: 12px; width: 14px; text-align: center; flex-shrink: 0; }
      .sw-group-name { flex: 1; color: var(--text, #eee); }
      .sw-group-count { color: var(--text-dim, #666); font-size: 10px; }
      .sw-required-badge { font-size: 9px; background: var(--surface2, #333); color: var(--yellow, #facc15); padding: 1px 4px; border-radius: 3px; }
      .sw-group-detail { padding: 2px 0 6px 20px; }
      .sw-item-row { display: flex; align-items: center; gap: 5px; padding: 2px 0; font-size: 11px; color: var(--text-mid, #999); }
      .sw-item-icon { font-size: 11px; width: 12px; text-align: center; flex-shrink: 0; }
      .sw-item-label { flex: 1; }
      .sw-validated { font-size: 9px; color: var(--green, #4ade80); background: rgba(74,222,128,0.1); padding: 1px 4px; border-radius: 3px; }
      .sw-validate-fail { font-size: 9px; color: var(--red, #f87171); background: rgba(248,113,113,0.1); padding: 1px 4px; border-radius: 3px; }
      .sw-config-link { display: block; margin-top: 8px; font-size: 11px; color: var(--accent, #60a5fa); text-decoration: none; }
      .sw-config-link:hover { text-decoration: underline; }
      .sw-error { color: var(--text-dim, #666); font-size: 11px; padding: 8px 0; }

      /* Full mode styles */
      .sw-full-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      .sw-title { margin: 0; font-size: 16px; color: var(--text, #eee); font-weight: 600; }
      .sw-ring-wrap { position: relative; width: 48px; height: 48px; }
      .sw-ring { width: 48px; height: 48px; }
      .sw-ring-bg { fill: none; stroke: var(--surface2, #333); stroke-width: 3; }
      .sw-ring-fill { fill: none; stroke: var(--green, #4ade80); stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray 0.3s ease; }
      .sw-ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: var(--text, #eee); }
      .sw-progress-ring-wrap { position: relative; width: 48px; height: 48px; display: inline-flex; align-items: center; justify-content: center; }
      .sw-full-groups { display: flex; flex-direction: column; gap: 12px; }
      .sw-full-group { border: 1px solid var(--border, #333); border-radius: 8px; padding: 10px 12px; }
      .sw-full-group.complete { border-color: rgba(74,222,128,0.3); }
      .sw-full-group.partial { border-color: rgba(250,204,21,0.3); }
      .sw-full-group-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
      .sw-group-status-text { margin-left: auto; font-size: 10px; color: var(--text-dim, #666); text-transform: uppercase; }
      .sw-full-items { display: flex; flex-direction: column; gap: 2px; padding-left: 20px; }
    `;
    document.head.appendChild(style);
  }

  return {
    /**
     * Initialize the wizard in compact mode (for sidebar/embedded use)
     * @param {string|HTMLElement} target - CSS selector or element
     */
    async init(target, mode = 'compact') {
      injectStyles();
      const container = typeof target === 'string' ? document.querySelector(target) : target;
      if (!container) return;

      container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:4px 0;">Loading setup status…</div>';

      const data = await fetchStatus();
      if (mode === 'full') {
        renderFull(container, data);
      } else {
        renderCompact(container, data);
      }
    },

    /** Force refresh (bypasses cache) */
    async refresh(target, mode = 'compact') {
      _cache = null;
      _cacheTime = 0;
      return this.init(target, mode);
    }
  };
})();

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SetupWizard;
}
