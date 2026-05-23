/**
 * Reusable configuration panel component.
 * Renders config fields with load/save capability against /api/config.
 * 
 * Usage:
 *   ConfigPanel.render('#target-element', {
 *     title: 'Voice Settings',
 *     description: 'Configure text-to-speech and transcription.',
 *     fields: [
 *       { key: 'DELEGATE_TTS_MODEL', label: 'TTS Model', type: 'select', options: [...], default: 'gpt-4o-mini-tts' },
 *       { key: 'DEEPGRAM_API_KEY', label: 'Deepgram API Key', type: 'password', sensitive: true },
 *     ]
 *   });
 */
(function () {
  'use strict';

  const MASKED_CONFIG_VALUE = '••••••';

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else node.setAttribute(k, v);
    });
    if (text) node.textContent = text;
    return node;
  }

  function createControl(field, currentValue, idSuffix) {
    const wrapper = el('div', {});
    const isMaskedSensitive = !!field.sensitive && currentValue === MASKED_CONFIG_VALUE;
    const displayValue = isMaskedSensitive ? '' : (currentValue || '');

    if (field.type === 'boolean') {
      const select = el('select', { class: 'config-select', id: idSuffix, 'data-config-key': field.key });
      [['', '— not set —'], ['true', 'True'], ['false', 'False']].forEach(([val, label]) => {
        const opt = el('option', { value: val }, label);
        if (currentValue === val) opt.selected = true;
        select.appendChild(opt);
      });
      wrapper.appendChild(select);
      return { wrapper, input: select, masked: false };
    }

    if (field.type === 'select' && field.options) {
      const select = el('select', { class: 'config-select', id: idSuffix, 'data-config-key': field.key });
      const placeholderText = field.default ? `— default: ${field.default} —` : '— select —';
      const placeholder = el('option', { value: '' }, placeholderText);
      if (!currentValue) placeholder.selected = true;
      select.appendChild(placeholder);
      field.options.forEach(([val, label]) => {
        const opt = el('option', { value: val }, label);
        if (currentValue === val) opt.selected = true;
        select.appendChild(opt);
      });
      wrapper.appendChild(select);
      return { wrapper, input: select, masked: false };
    }

    if (field.type === 'range') {
      const row = el('div', { style: 'display:flex;align-items:center;gap:10px' });
      const input = el('input', {
        class: 'config-input',
        id: idSuffix,
        'data-config-key': field.key,
        type: 'range',
        min: String(field.min || 0),
        max: String(field.max || 100),
        step: String(field.step || 1),
      });
      input.value = displayValue || String(field.default || '');
      const valDisplay = el('span', { style: 'font-size:13px;color:var(--text-mid);min-width:36px' }, input.value);
      input.addEventListener('input', () => { valDisplay.textContent = input.value; });
      row.appendChild(input);
      row.appendChild(valDisplay);
      wrapper.appendChild(row);
      return { wrapper, input, masked: false };
    }

    const input = el('input', {
      class: 'config-input',
      id: idSuffix,
      'data-config-key': field.key,
      type: field.sensitive ? 'password' : (field.type === 'number' ? 'number' : 'text'),
      autocomplete: field.sensitive ? 'new-password' : 'off',
    });
    if (field.type === 'number') input.step = field.step || 'any';
    if (displayValue) input.value = displayValue;

    // Placeholder with default info
    if (isMaskedSensitive) {
      input.placeholder = 'Configured — leave blank to keep';
    } else if (field.default) {
      input.placeholder = `Default: ${field.default}`;
    } else if (field.sensitive) {
      input.placeholder = 'Enter a value';
    }

    if (!field.sensitive) {
      wrapper.appendChild(input);
      return { wrapper, input, masked: false };
    }

    const row = el('div', { style: 'display:flex;gap:6px;align-items:center' });
    const toggle = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Show');
    toggle.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? 'Show' : 'Hide';
    });
    row.appendChild(input);
    row.appendChild(toggle);
    wrapper.appendChild(row);
    return { wrapper, input, masked: isMaskedSensitive };
  }

  function buildField(field, currentValue, panelId) {
    const fieldId = `cp-${panelId}-${field.key.toLowerCase()}`;
    const control = createControl(field, currentValue, fieldId);
    const wrap = el('div', { class: 'config-field', 'data-config-field-key': field.key });

    const head = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' });
    const label = el('label', { class: 'config-field-title', for: fieldId }, field.label);
    head.appendChild(label);
    if (field.default && !field.sensitive) {
      head.appendChild(el('span', { style: 'font-size:11px;color:var(--text-dim);background:var(--surface2);padding:1px 6px;border-radius:4px' }, 'optional'));
    }
    if (control.masked) {
      head.appendChild(el('span', { style: 'font-size:11px;color:var(--green);background:var(--green-dim);padding:1px 6px;border-radius:4px' }, 'configured'));
    }
    wrap.appendChild(head);
    wrap.appendChild(control.wrapper);
    if (field.help) wrap.appendChild(el('div', { class: 'config-help', style: 'font-size:12px;color:var(--text-dim);margin-top:4px' }, field.help));
    return wrap;
  }

  async function render(targetSelector, config) {
    const target = typeof targetSelector === 'string' ? document.querySelector(targetSelector) : targetSelector;
    if (!target) return;

    const panelId = config.id || config.title.toLowerCase().replace(/\s+/g, '-');

    // Load current values
    let configMap = {};
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        (data.items || data || []).forEach(c => { configMap[c.key] = c.value; });
      }
    } catch (e) { /* proceed with empty */ }

    // Build UI
    const panel = el('div', { class: 'config-panel', id: `config-panel-${panelId}` });

    if (config.title) {
      const header = el('div', { style: 'margin-bottom:16px' });
      header.appendChild(el('h3', { style: 'margin:0 0 4px;font-size:16px;font-weight:600;color:var(--text)' }, config.title));
      if (config.description) header.appendChild(el('p', { style: 'margin:0;font-size:13px;color:var(--text-mid)' }, config.description));
      panel.appendChild(header);
    }

    const grid = el('div', { style: 'display:flex;flex-direction:column;gap:16px' });
    config.fields.forEach(field => {
      grid.appendChild(buildField(field, configMap[field.key] || '', panelId));
    });
    panel.appendChild(grid);

    // Save button
    const actions = el('div', { style: 'margin-top:16px;display:flex;align-items:center;gap:10px' });
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
    const msg = el('span', { style: 'font-size:13px' });

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      msg.style.color = 'var(--text-mid)';
      msg.textContent = 'Saving…';
      try {
        const items = config.fields
          .map(field => {
            const input = panel.querySelector(`[data-config-key="${field.key}"]`);
            if (!input) return null;
            const value = String(input.value ?? '');
            if (value === '') return null;
            return { key: field.key, value, ...(field.sensitive ? { sensitive: true } : {}) };
          })
          .filter(Boolean);

        if (items.length === 0) {
          msg.style.color = 'var(--amber)';
          msg.textContent = 'Nothing to save';
          return;
        }

        const response = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'Save failed');
        }
        msg.style.color = 'var(--green)';
        msg.textContent = 'Saved!';
        setTimeout(() => { msg.textContent = ''; }, 2500);
      } catch (err) {
        msg.style.color = 'var(--red, #f87171)';
        msg.textContent = 'Error: ' + err.message;
      } finally {
        saveBtn.disabled = false;
      }
    });

    actions.appendChild(saveBtn);
    actions.appendChild(msg);
    panel.appendChild(actions);

    target.innerHTML = '';
    target.appendChild(panel);
  }

  window.ConfigPanel = { render };
})();
