/**
 * Auth guard for frontend pages.
 * Intercepts 401 responses and redirects to /login.
 * Include this script on all protected pages (not login/install).
 */
(function() {
  const LOGIN_PATH = '/login';

  // Don't run on login/install pages
  if (window.location.pathname === LOGIN_PATH || window.location.pathname === '/install') {
    return;
  }

  // Wrap fetch to intercept 401 responses
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (response.status === 401) {
      window.location.href = LOGIN_PATH;
    }
    return response;
  };

  // Wrap XMLHttpRequest for any legacy usage
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(...args) {
    this._authGuardUrl = args[1];
    return originalXHROpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      if (this.status === 401) {
        window.location.href = LOGIN_PATH;
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // Periodic auth check (every 5 minutes)
  setInterval(async () => {
    try {
      const res = await originalFetch('/auth/status');
      if (res.ok) {
        const data = await res.json();
        if (!data.authenticated) {
          window.location.href = LOGIN_PATH;
        }
      }
    } catch (e) {
      // Network error — don't redirect, might be temporary
    }
  }, 5 * 60 * 1000);
})();
