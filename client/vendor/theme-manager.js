(function () {
  const STORAGE_KEY = 'hk-ui-theme';
  const DEFAULT_THEME = 'daylight';

  const themes = {
    daylight: {
      label: 'Daylight',
      vars: {
        '--bg': '#f5f7fb',
        '--surface': '#ffffff',
        '--surface2': '#edf2fb',
        '--surface3': '#e7edf7',
        '--border': '#b8c4da',
        '--border2': '#a7b6d2',
        '--accent': '#1d4ed8',
        '--accent-dim': 'rgba(29, 78, 216, 0.14)',
        '--green': '#0f9d58',
        '--green-dim': 'rgba(15, 157, 88, 0.14)',
        '--amber': '#b45309',
        '--amber-dim': 'rgba(180, 83, 9, 0.14)',
        '--red': '#c62828',
        '--red-dim': 'rgba(198, 40, 40, 0.14)',
        '--blue': '#1d4ed8',
        '--blue-dim': 'rgba(29, 78, 216, 0.14)',
        '--text': '#111827',
        '--text-mid': '#334155',
        '--text-dim': '#4b5563'
      }
    },
    paper: {
      label: 'Paper',
      vars: {
        '--bg': '#fbf8f3',
        '--surface': '#fffdfa',
        '--surface2': '#f6efe3',
        '--surface3': '#efe6d8',
        '--border': '#c9baa3',
        '--border2': '#b9a98f',
        '--accent': '#7c2d12',
        '--accent-dim': 'rgba(124, 45, 18, 0.13)',
        '--green': '#166534',
        '--green-dim': 'rgba(22, 101, 52, 0.13)',
        '--amber': '#92400e',
        '--amber-dim': 'rgba(146, 64, 14, 0.13)',
        '--red': '#991b1b',
        '--red-dim': 'rgba(153, 27, 27, 0.13)',
        '--blue': '#1e40af',
        '--blue-dim': 'rgba(30, 64, 175, 0.13)',
        '--text': '#1c1917',
        '--text-mid': '#44403c',
        '--text-dim': '#57534e'
      }
    },
    mint: {
      label: 'Mint',
      vars: {
        '--bg': '#eef9f4',
        '--surface': '#ffffff',
        '--surface2': '#dbf2e7',
        '--surface3': '#d0eadf',
        '--border': '#92c7af',
        '--border2': '#7ab79c',
        '--accent': '#0e7490',
        '--accent-dim': 'rgba(14, 116, 144, 0.15)',
        '--green': '#0f766e',
        '--green-dim': 'rgba(15, 118, 110, 0.15)',
        '--amber': '#b45309',
        '--amber-dim': 'rgba(180, 83, 9, 0.14)',
        '--red': '#b91c1c',
        '--red-dim': 'rgba(185, 28, 28, 0.14)',
        '--blue': '#0369a1',
        '--blue-dim': 'rgba(3, 105, 161, 0.15)',
        '--text': '#06281f',
        '--text-mid': '#1f4d3f',
        '--text-dim': '#2d5b4d'
      }
    },
    dusk: {
      label: 'Dusk',
      vars: {
        '--bg': '#1b1d27',
        '--surface': '#22253a',
        '--surface2': '#2a2d42',
        '--surface3': '#181a26',
        '--border': '#2e3150',
        '--border2': '#383b5e',
        '--accent': '#818cf8',
        '--accent-dim': 'rgba(129, 140, 248, 0.12)',
        '--green': '#34d399',
        '--green-dim': 'rgba(52, 211, 153, 0.10)',
        '--amber': '#fbbf24',
        '--amber-dim': 'rgba(251, 191, 36, 0.10)',
        '--red': '#f87171',
        '--red-dim': 'rgba(248, 113, 113, 0.10)',
        '--blue': '#60a5fa',
        '--blue-dim': 'rgba(96, 165, 250, 0.10)',
        '--text': '#e2e4f0',
        '--text-mid': '#9aa1c2',
        '--text-dim': '#6e7599'
      }
    }
  };

  function applyTheme(name) {
    const key = Object.prototype.hasOwnProperty.call(themes, name) ? name : DEFAULT_THEME;
    const selected = themes[key];
    const root = document.documentElement;
    Object.entries(selected.vars).forEach(([varName, value]) => {
      root.style.setProperty(varName, value);
    });
    root.setAttribute('data-theme', key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Ignore localStorage failures (private mode or blocked storage).
    }
  }

  function injectControl() {
    if (!document.body || document.getElementById('theme-switcher')) {
      return;
    }

    const host = document.createElement('div');
    host.id = 'theme-switcher';
    host.style.position = 'fixed';
    host.style.right = '12px';
    host.style.bottom = '12px';
    host.style.zIndex = '9999';
    host.style.background = 'var(--surface)';
    host.style.border = '1px solid var(--border2, var(--border))';
    host.style.borderRadius = '10px';
    host.style.padding = '8px 10px';
    host.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.gap = '8px';

    const label = document.createElement('label');
    label.htmlFor = 'theme-select';
    label.textContent = 'Theme';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    label.style.color = 'var(--text-mid)';

    const select = document.createElement('select');
    select.id = 'theme-select';
    select.style.fontSize = '12px';
    select.style.padding = '5px 7px';
    select.style.borderRadius = '7px';
    select.style.border = '1px solid var(--border2, var(--border))';
    select.style.background = 'var(--surface2)';
    select.style.color = 'var(--text)';

    Object.entries(themes).forEach(([name, config]) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = config.label;
      select.appendChild(option);
    });

    try {
      select.value = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
    } catch {
      select.value = DEFAULT_THEME;
    }

    select.addEventListener('change', () => applyTheme(select.value));

    host.appendChild(label);
    host.appendChild(select);
    document.body.appendChild(host);
  }

  function init() {
    let preferred = DEFAULT_THEME;
    try {
      preferred = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
    } catch {
      preferred = DEFAULT_THEME;
    }
    applyTheme(preferred);
    injectControl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();