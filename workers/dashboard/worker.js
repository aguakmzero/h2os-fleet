/**
 * Dashboard Worker
 * Serves the fleet management web UI at /dashboard
 *
 * This worker returns a single-page application with all HTML, CSS, and JS inline.
 * It communicates with the API worker for data.
 */

// VERSION is injected at deploy time via --define (see deploy.sh)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Landing page (for unauthenticated users)
    if (url.pathname === '/') {
      return new Response(getLandingHTML(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Logged out page
    if (url.pathname === '/logged-out') {
      return new Response(getLoggedOutHTML(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Version endpoint for PWA update check
    if (url.pathname === '/version') {
      return new Response(JSON.stringify({ version: VERSION }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
      });
    }

    // PWA Manifest
    if (url.pathname === '/manifest.json') {
      return new Response(getManifest(), {
        headers: { 'Content-Type': 'application/manifest+json' },
      });
    }

    // Service Worker
    if (url.pathname === '/sw.js') {
      return new Response(getServiceWorker(), {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    // PWA Icon (PNG)
    if (url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png') {
      // Return a simple colored square with water drop emoji as SVG
      const size = url.pathname.includes('512') ? 512 : 192;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
        <rect fill="#0ea5e9" width="${size}" height="${size}" rx="${size * 0.22}"/>
        <text x="${size/2}" y="${size * 0.7}" text-anchor="middle" font-size="${size * 0.55}" fill="white">💧</text>
      </svg>`;
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    }

    // Only handle /dashboard
    if (url.pathname !== '/dashboard') {
      return new Response('Not found', { status: 404 });
    }

    return new Response(getDashboardHTML(), {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

function getLandingHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>H2OS Fleet</title>
  <meta name="theme-color" content="#0a0f1a">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0a0f1a 0%, #1a1f2e 50%, #0d1420 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #f1f5f9;
      padding: 2rem;
    }
    .container {
      text-align: center;
      max-width: 400px;
    }
    .logo {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      margin: 0 auto 1.5rem;
      box-shadow: 0 8px 32px rgba(14, 165, 233, 0.3);
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #f1f5f9 0%, #22d3ee 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      color: #64748b;
      font-size: 1rem;
      margin-bottom: 2.5rem;
    }
    .login-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      color: white;
      padding: 1rem 2rem;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 1rem;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 16px rgba(14, 165, 233, 0.3);
    }
    .login-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(14, 165, 233, 0.4);
    }
    .login-btn svg {
      width: 20px;
      height: 20px;
    }
    .features {
      display: flex;
      gap: 2rem;
      margin-top: 3rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .feature {
      text-align: center;
    }
    .feature-icon {
      width: 48px;
      height: 48px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 0.5rem;
      font-size: 1.25rem;
    }
    .feature-label {
      font-size: 0.8rem;
      color: #64748b;
    }
    .footer {
      position: absolute;
      bottom: 2rem;
      color: #475569;
      font-size: 0.75rem;
    }
    .footer a {
      color: #64748b;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">💧</div>
    <h1>H2OS Fleet</h1>
    <p class="subtitle">Groundwater Monitoring Dashboard</p>
    <a href="/dashboard" class="login-btn">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Sign in with Google
    </a>
    <div class="features">
      <div class="feature">
        <div class="feature-icon">📡</div>
        <div class="feature-label">Live Monitoring</div>
      </div>
      <div class="feature">
        <div class="feature-icon">🖥️</div>
        <div class="feature-label">Remote Access</div>
      </div>
      <div class="feature">
        <div class="feature-icon">📊</div>
        <div class="feature-label">Status Tracking</div>
      </div>
    </div>
  </div>
  <div class="footer">
    <a href="https://aguakmzero.com">Agua KMZero</a> · H2OS Fleet v${VERSION}
  </div>
</body>
</html>`;
}

function getLoggedOutHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logged Out · H2OS Fleet</title>
  <meta name="theme-color" content="#0a0f1a">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0a0f1a 0%, #1a1f2e 50%, #0d1420 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #f1f5f9;
      padding: 2rem;
    }
    .container {
      text-align: center;
      max-width: 400px;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
    }
    .icon svg {
      width: 40px;
      height: 40px;
      color: #10b981;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      color: #64748b;
      font-size: 1rem;
      margin-bottom: 2rem;
    }
    .login-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      padding: 0.875rem 1.5rem;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 500;
      font-size: 0.95rem;
      transition: background 0.2s;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .login-btn:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .login-btn svg {
      width: 18px;
      height: 18px;
    }
    .footer {
      position: absolute;
      bottom: 2rem;
      color: #475569;
      font-size: 0.75rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>You've been signed out</h1>
    <p class="subtitle">Thanks for using H2OS Fleet</p>
    <a href="/dashboard" class="login-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
        <polyline points="10 17 15 12 10 7"/>
        <line x1="15" y1="12" x2="3" y2="12"/>
      </svg>
      Sign in again
    </a>
  </div>
  <div class="footer">
    H2OS Fleet · Agua KMZero
  </div>
</body>
</html>`;
}

function getManifest() {
  return JSON.stringify({
    name: 'H2OS Fleet',
    short_name: 'Fleet',
    description: 'H2OS Fleet Management Dashboard',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0a0f1a',
    theme_color: '#0a0f1a',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  });
}

function getServiceWorker() {
  return `
// H2OS Fleet Service Worker - Minimal for PWA installability
const CACHE_NAME = 'fleet-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy - always try network, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone and cache successful responses
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
      })
  );
});
`;
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>H2OS Fleet</title>

  <!-- PWA Meta Tags -->
  <meta name="theme-color" content="#0a0f1a">
  <meta name="background-color" content="#0a0f1a">
  <meta name="description" content="H2OS Fleet Management Dashboard">

  <!-- iOS PWA Meta Tags -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Fleet">
  <link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'><rect fill='%230ea5e9' width='180' height='180' rx='40'/><text x='90' y='125' text-anchor='middle' font-size='100' fill='white'>💧</text></svg>">

  <!-- Web App Manifest -->
  <link rel="manifest" href="/manifest.json">

  <!-- Prevent text selection and callouts on iOS -->
  <meta name="format-detection" content="telephone=no">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-dark: #0a0f1a;
      --bg-card: #111827;
      --bg-card-hover: #1a2332;
      --border: #1e293b;
      --border-light: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-blue: #0ea5e9;
      --accent-cyan: #22d3ee;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --accent-red: #ef4444;
      --accent-purple: #a855f7;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
      padding-bottom: 80px;
      /* Add safe area for iOS status bar */
      padding-top: env(safe-area-inset-top);
    }

    @media (min-width: 769px) {
      body { padding-bottom: 0; }
    }

    /* Header */
    .header {
      background: linear-gradient(180deg, #0f172a 0%, var(--bg-dark) 100%);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(12px);
    }
    .header-content {
      max-width: 1600px;
      margin: 0 auto;
      padding: 1rem 1.5rem;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-blue) 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
    }
    .logo-text h1 {
      font-size: 1.1rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-cyan) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .logo-text p {
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: -2px;
    }
    .version-tag {
      font-size: 0.55rem;
      color: var(--text-muted);
      background: var(--border);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      margin-left: 0.5rem;
      font-family: 'SF Mono', Monaco, monospace;
      opacity: 0.7;
    }

    /* Summary Stats */
    .summary-stats {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .user-menu {
      position: relative;
    }
    .user-pill {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s;
    }
    .user-pill:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .user-pill svg {
      width: 12px;
      height: 12px;
    }
    .user-dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      min-width: 200px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      z-index: 100;
      overflow: hidden;
    }
    .user-dropdown.active {
      display: block;
    }
    .user-dropdown-email {
      padding: 0.75rem 1rem;
      font-size: 0.8rem;
      color: var(--text-secondary);
      word-break: break-all;
    }
    .user-dropdown-divider {
      height: 1px;
      background: var(--border);
    }
    .user-dropdown-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      color: var(--text-primary);
      text-decoration: none;
      transition: background 0.15s;
    }
    .user-dropdown-item:hover {
      background: var(--bg-card-hover);
    }
    .user-dropdown-item svg {
      width: 16px;
      height: 16px;
      opacity: 0.7;
    }
    .stat-badge {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--border);
      color: var(--text-secondary);
    }
    .stat-badge.healthy { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }
    .stat-badge.partial { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
    .stat-badge.offline { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }
    .stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .stat-dot.healthy { background: var(--accent-green); }
    .stat-dot.partial { background: var(--accent-amber); }
    .stat-dot.offline { background: var(--accent-red); }

    /* Controls Row */
    .controls-row {
      display: flex;
      gap: 0.75rem;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    /* Control Section (label above content) */
    .control-section {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .control-section-label {
      font-size: 0.6rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    /* Section Divider (vertical line) */
    .section-divider {
      width: 1px;
      height: 20px;
      background: var(--border-light);
      align-self: flex-end;
      margin-bottom: 0.5rem;
    }

    /* Search */
    .search-box {
      min-width: 200px;
      max-width: 280px;
      position: relative;
    }
    .search-box input {
      width: 100%;
      background: var(--border);
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 0.5rem 0.75rem 0.5rem 2.25rem;
      font-size: 0.8rem;
      color: var(--text-primary);
      outline: none;
      transition: all 0.2s;
    }
    .search-box input:focus {
      border-color: var(--accent-cyan);
      box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.2);
    }
    .search-box input::placeholder { color: var(--text-muted); }
    .search-box svg {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      width: 14px;
      height: 14px;
      color: var(--text-muted);
    }

    /* Filter Pills */
    .filter-pills {
      display: flex;
      gap: 0.375rem;
    }
    .filter-pill {
      padding: 0.375rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--border);
      border: 1px solid transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .filter-pill:hover { background: var(--border-light); color: var(--text-primary); }
    .filter-pill.active {
      background: rgba(14, 165, 233, 0.15);
      border-color: var(--accent-blue);
      color: var(--accent-cyan);
    }
    .filter-pill .count {
      font-size: 0.7rem;
      opacity: 0.8;
    }

    /* Sort Pills */
    .sort-pills {
      display: flex;
      gap: 0.375rem;
    }
    .sort-pill {
      padding: 0.375rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--border);
      border: 1px solid transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }
    .sort-pill:hover { background: var(--border-light); color: var(--text-primary); }
    .sort-pill.active {
      background: rgba(34, 197, 94, 0.15);
      border-color: var(--accent-green);
      color: var(--accent-green);
    }

    /* Location Dropdown */
    .location-select {
      background: var(--border);
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      color: var(--text-secondary);
      cursor: pointer;
      outline: none;
      min-width: 140px;
    }
    .location-select:focus { border-color: var(--accent-cyan); }

    /* Sort & Auto-refresh */
    .control-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .control-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .control-select {
      background: var(--border);
      border: 1px solid var(--border-light);
      border-radius: 6px;
      padding: 0.375rem 0.5rem;
      font-size: 0.75rem;
      color: var(--text-secondary);
      cursor: pointer;
      outline: none;
    }
    .control-select:focus { border-color: var(--accent-cyan); }

    /* Auto-refresh dropdown */
    .auto-select {
      background: var(--border);
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      color: var(--text-secondary);
      cursor: pointer;
      outline: none;
    }
    .auto-select:focus { border-color: var(--accent-cyan); }

    /* Auto-refresh toggle */
    .auto-refresh-toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Responsive: collapse pills to dropdowns on medium screens */
    @media (max-width: 1100px) and (min-width: 769px) {
      .control-section-label { display: none; }
      .section-divider { display: none; }
      .filter-pills { display: none; }
      .sort-pills { display: none; }
      .filter-dropdown { display: block; }
      .sort-dropdown { display: block; }
    }
    .filter-dropdown, .sort-dropdown { display: none; }
    @media (max-width: 1100px) and (min-width: 769px) {
      .filter-dropdown, .sort-dropdown {
        display: block;
        background: var(--border);
        border: 1px solid var(--border-light);
        border-radius: 8px;
        padding: 0.375rem 0.75rem;
        font-size: 0.75rem;
        color: var(--text-secondary);
        cursor: pointer;
      }
    }
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      background: var(--border);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .toggle-switch.active { background: var(--accent-green); }
    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle-switch.active::after { transform: translateX(16px); }

    /* Refresh Button */
    .btn-refresh {
      background: var(--border);
      border: 1px solid var(--border-light);
      color: var(--text-secondary);
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      font-size: 0.75rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      transition: all 0.2s;
      margin-left: auto;
    }
    .btn-refresh:hover { background: var(--border-light); color: var(--text-primary); }
    .btn-refresh.loading svg { animation: spin 1s linear infinite; }
    .last-update { font-size: 0.65rem; color: var(--text-muted); }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Main Content */
    .main {
      max-width: 1600px;
      margin: 0 auto;
      padding: 1rem 1.5rem;
    }

    /* Unified Grid */
    .devices-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    /* Location Headers (span full grid width) */
    .location-header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
      margin-top: 0.5rem;
      cursor: pointer;
      user-select: none;
    }
    .location-header:first-child { margin-top: 0; }
    .location-header:hover .location-name { color: var(--text-primary); }
    .location-chevron {
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }
    .location-header.collapsed .location-chevron { transform: rotate(-90deg); }
    .location-name {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .location-count {
      font-size: 0.65rem;
      color: var(--text-muted);
      background: var(--border);
      padding: 0.125rem 0.5rem;
      border-radius: 10px;
    }
    .card.hidden { display: none; }

    /* Pinned Header (span full grid width) */
    .pinned-header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
      color: var(--accent-amber);
    }
    .pinned-header svg { width: 16px; height: 16px; }
    .pinned-header span {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .pinned-divider {
      grid-column: 1 / -1;
      height: 1px;
      background: var(--border);
      margin: 0.5rem 0;
    }

    /* Cards */
    .card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1.25rem;
      position: relative;
      border: 1px solid var(--border);
      transition: all 0.2s ease;
    }
    .card.pinned { border-color: var(--accent-amber); }
    .card.incomplete-status { border-left: 3px solid var(--accent-amber); }
    .card.incomplete-status .card-footer::after {
      content: '⚠ incomplete status';
      font-size: 10px;
      color: var(--accent-amber);
      opacity: 0.8;
      margin-left: auto;
    }
    .card:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-light);
      transform: translateY(-2px);
      box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.4);
    }

    /* Card Screenshot */
    .card-screenshot {
      position: relative;
      width: 100%;
      aspect-ratio: 16/9;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      margin-bottom: 0.75rem;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card-screenshot img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 6px;
    }
    .card-screenshot .screenshot-loader {
      position: absolute;
      color: var(--text-muted);
      font-size: 0.7rem;
    }
    .card-screenshot .screenshot-loader svg {
      width: 20px;
      height: 20px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .card-screenshot .refresh-overlay {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 28px;
      height: 28px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .card-screenshot:hover .refresh-overlay {
      opacity: 1;
    }
    .card-screenshot .refresh-overlay:hover {
      background: rgba(0, 0, 0, 0.8);
    }
    .card-screenshot .refresh-overlay svg {
      width: 14px;
      height: 14px;
      color: var(--text-secondary);
    }
    .card-screenshot .refresh-overlay.loading svg {
      animation: spin 1s linear infinite;
    }
    .card-screenshot.failed {
      background: rgba(239, 68, 68, 0.1);
    }
    .card-screenshot.failed .screenshot-loader {
      color: var(--accent-red);
    }

    /* Card Header */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }
    .card-title-group { flex: 1; min-width: 0; }
    .card-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pin-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 4px;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pin-btn:hover { color: var(--accent-amber); background: rgba(245, 158, 11, 0.1); }
    .pin-btn.pinned { color: var(--accent-amber); }
    .pin-btn svg { width: 14px; height: 14px; }
    .card-subtitle {
      font-size: 0.7rem;
      color: var(--text-muted);
      font-family: 'SF Mono', Monaco, monospace;
    }

    /* Card Right Side (status badge only now) */
    .card-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-left: 1rem;
    }

    /* Status Badge */
    .status-badge {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
      font-size: 0.65rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      background: var(--border);
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .status-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
    }
    .status-badge.online { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }
    .status-badge.online .dot { background: var(--accent-green); }
    .status-badge.partial { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
    .status-badge.partial .dot { background: var(--accent-amber); }
    .status-badge.offline { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }
    .status-badge.offline .dot { background: var(--accent-red); }
    .status-badge.unknown { background: rgba(107, 114, 128, 0.15); color: var(--text-muted); }
    .status-badge.unknown .dot { background: var(--text-muted); animation: pulse-gray 1.5s ease-in-out infinite; }
    .status-badge.checking { background: rgba(14, 165, 233, 0.15); color: var(--accent-blue); }
    .status-badge.checking .dot { background: var(--accent-blue); animation: pulse-blue 1s ease-in-out infinite; }
    .status-badge.rebooting { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
    .status-badge.rebooting .dot { background: var(--accent-amber); animation: pulse-amber 1s ease-in-out infinite; }

    .rebooting-card { opacity: 0.6; pointer-events: none; }
    .rebooting-card .btn-reboot { pointer-events: auto; }

    @keyframes pulse-blue {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    @keyframes pulse-amber {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    @keyframes pulse-gray {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.3; transform: scale(1.1); }
    }

    /* Location Row */
    .location-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      min-height: 1.5rem;
    }
    .location-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      background: var(--border);
      border-radius: 4px;
      font-size: 0.65rem;
      color: var(--text-secondary);
    }
    .location-tag svg { width: 10px; height: 10px; opacity: 0.7; }
    .device-time-inline {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.65rem;
      color: var(--text-secondary);
    }
    .device-time-inline svg { width: 10px; height: 10px; opacity: 0.7; }

    /* Services */
    .services {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      overflow: hidden;
    }
    .services-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .services-title {
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    /* Progress bar for services */
    .services-progress {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .progress-bar {
      width: 50px;
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--accent-green);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .progress-fill.partial { background: var(--accent-amber); }
    .progress-fill.bad { background: var(--accent-red); }
    .progress-text {
      font-size: 0.6rem;
      color: var(--text-muted);
      min-width: 28px;
    }
    .services-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.25rem;
    }
    .service-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.7rem;
      color: var(--text-secondary);
      overflow: hidden;
    }
    .service-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .service-dot.running { background: var(--accent-green); }
    .service-dot.stopped { background: var(--accent-red); }
    .service-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .services-placeholder {
      color: var(--text-muted);
      font-size: 0.7rem;
      font-style: italic;
      text-align: center;
      padding: 0.25rem 0;
    }
    .uptime-text {
      font-size: 0.65rem;
      color: var(--text-muted);
      margin-top: 0.375rem;
    }
    .quick-info {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
    }
    .quick-info-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.7rem;
      color: var(--text-secondary);
      background: rgba(255,255,255,0.05);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }
    .quick-info-item svg {
      width: 12px;
      height: 12px;
      opacity: 0.7;
    }
    .quick-info-item.mono {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    .commit-date-line {
      margin-top: 0.35rem;
      margin-bottom: 0.25rem;
      border-top: none;
      padding-top: 0;
    }
    .commit-date-line .quick-info-item {
      font-size: 0.6rem;
      opacity: 0.8;
    }
    .device-time {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.4rem;
    }
    .device-time span {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .device-time svg {
      width: 12px;
      height: 12px;
      opacity: 0.6;
    }

    /* Buttons */
    .buttons {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      justify-content: flex-end;
    }
    .btn {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border: none;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
    }
    .btn svg { width: 12px; height: 12px; }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-cyan) 100%);
      color: white;
    }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-secondary {
      background: var(--border);
      border: 1px solid var(--border-light);
      color: var(--text-secondary);
    }
    .btn-secondary:hover { background: var(--border-light); color: var(--text-primary); }
    /* Icon-only buttons */
    .btn-icon {
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      padding: 0;
      background: var(--border);
      border: 1px solid var(--border-light);
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .btn-icon:hover { background: var(--border-light); color: var(--text-primary); }
    .btn-icon.loading svg { animation: spin 1s linear infinite; }
    .btn-icon.copied { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); border-color: var(--accent-green); }
    .btn-icon svg { width: 14px; height: 14px; }
    /* VNC button (icon-only, blue) */
    .btn-vnc {
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      padding: 0;
      background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-cyan) 100%);
      border: none;
      border-radius: 6px;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.2s;
    }
    .btn-vnc:hover { filter: brightness(1.1); }
    .btn-vnc svg { width: 14px; height: 14px; }

    /* Reboot button (icon-only, amber/warning) */
    .btn-reboot {
      background: rgba(245, 158, 11, 0.15);
      color: var(--accent-amber);
    }
    .btn-reboot:hover {
      background: rgba(245, 158, 11, 0.25);
      color: var(--accent-amber);
    }
    .btn-reboot.rebooting {
      animation: pulse 1s infinite;
      pointer-events: none;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Card Footer */
    .card-footer {
      margin-top: 0.75rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .last-seen { font-size: 0.65rem; color: var(--text-muted); }
    .ssh-hint {
      font-size: 0.6rem;
      color: var(--text-muted);
      font-family: 'SF Mono', Monaco, monospace;
      opacity: 0.7;
    }

    /* Skeleton Loading */
    .skeleton-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }
    .skeleton-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1.25rem;
      border: 1px solid var(--border);
    }
    .skeleton {
      background: linear-gradient(90deg, var(--border) 25%, var(--border-light) 50%, var(--border) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 4px;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .skeleton-title { height: 20px; width: 60%; margin-bottom: 0.5rem; }
    .skeleton-subtitle { height: 12px; width: 40%; margin-bottom: 1rem; }
    .skeleton-services { height: 80px; margin-bottom: 0.75rem; }
    .skeleton-buttons { height: 32px; }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
    }
    .empty-icon {
      width: 64px;
      height: 64px;
      background: var(--border);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem;
      font-size: 1.5rem;
    }
    .empty-state h3 { color: var(--text-primary); margin-bottom: 0.5rem; }
    .empty-state p { color: var(--text-muted); font-size: 0.875rem; }

    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(4px);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      max-width: 480px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1.25rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .modal-title-group h2 { font-size: 1.25rem; font-weight: 600; color: var(--text-primary); }
    .modal-title-group p {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-family: 'SF Mono', Monaco, monospace;
      margin-top: 0.25rem;
    }
    .modal-close {
      background: var(--border);
      border: none;
      color: var(--text-muted);
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .modal-close:hover { background: var(--border-light); color: var(--text-primary); }
    .modal-section { margin-bottom: 1.25rem; }
    .modal-section-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .info-grid { display: grid; gap: 0.5rem; }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      font-size: 0.8rem;
    }
    .info-label { color: var(--text-muted); }
    .info-value { color: var(--text-secondary); text-align: right; max-width: 60%; word-break: break-all; }
    .info-value.mono { font-family: 'SF Mono', Monaco, monospace; font-size: 0.7rem; }
    .modal-services-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.4rem;
    }
    .modal-service-item {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.6rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .modal-service-item.stopped { color: var(--accent-red); opacity: 0.7; }
    .ssh-command {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      padding: 0.75rem;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.7rem;
      color: var(--accent-cyan);
      word-break: break-all;
      line-height: 1.6;
      position: relative;
    }
    .ssh-copy-btn {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      background: var(--border);
      border: none;
      color: var(--text-muted);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.65rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ssh-copy-btn:hover { background: var(--border-light); color: var(--text-primary); }
    .ssh-copy-btn.copied { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); }
    .modal-actions { display: flex; gap: 0.625rem; margin-top: 1.25rem; }

    /* Screenshot */
    .screenshot-container {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      padding: 0.5rem;
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .screenshot-loading { color: var(--text-muted); font-size: 0.875rem; }
    .screenshot-img {
      max-width: 100%;
      max-height: 60vh;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    /* Mobile Bottom Nav */
    .mobile-nav {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--bg-card);
      border-top: 1px solid var(--border);
      padding: 0.75rem 1rem;
      z-index: 60;
      padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
    }
    /* Mobile Search Bar */
    .mobile-search {
      display: none;
      padding: 0 0 0.75rem 0;
    }
    .mobile-search input {
      width: 100%;
      background: var(--border);
      border: 1px solid var(--border-light);
      border-radius: 10px;
      padding: 0.625rem 1rem 0.625rem 2.5rem;
      color: var(--text-primary);
      font-size: 0.9rem;
      outline: none;
    }
    .mobile-search input:focus {
      border-color: var(--accent-cyan);
      box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.1);
    }
    .mobile-search input::placeholder { color: var(--text-muted); }
    .mobile-search-wrapper {
      position: relative;
    }
    .mobile-search-wrapper svg {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--text-muted);
    }

    @media (max-width: 768px) {
      .mobile-nav { display: flex; justify-content: space-around; align-items: center; position: fixed !important; bottom: 0 !important; left: 0 !important; right: 0 !important; }
      .controls-row { display: none; }
      .mobile-search { display: block; }
      /* Hide user pill and dropdown on mobile */
      .user-menu { display: none; }
      /* Show summary stats on mobile, but compact */
      .summary-stats {
        display: flex;
        gap: 0.35rem;
      }
      .stat-badge {
        padding: 0.25rem 0.5rem;
        font-size: 0.7rem;
      }
      .stat-dot {
        width: 6px;
        height: 6px;
      }
    }
    .mobile-nav-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
      padding: 0.5rem;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .mobile-nav-btn:hover, .mobile-nav-btn.active {
      color: var(--accent-cyan);
      background: rgba(34, 211, 238, 0.1);
    }
    .mobile-nav-btn svg { width: 20px; height: 20px; }
    .mobile-nav-btn span { font-size: 0.65rem; }

    /* Mobile Filter Sheet */
    .mobile-sheet {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--bg-card);
      border-top: 1px solid var(--border);
      border-radius: 16px 16px 0 0;
      padding: 1.5rem;
      z-index: 70;
      transform: translateY(100%);
      transition: transform 0.3s ease;
      padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
    }
    .mobile-sheet.active { display: block; transform: translateY(0); }
    .mobile-sheet-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 65;
    }
    .mobile-sheet-backdrop.active { display: block; }
    .sheet-handle {
      width: 40px;
      height: 4px;
      background: var(--border-light);
      border-radius: 2px;
      margin: 0 auto 1rem;
    }
    .sheet-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
    .sheet-section { margin-bottom: 1.5rem; }
    .sheet-section-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .sheet-options { display: flex; flex-direction: column; gap: 0.5rem; max-height: 70vh; overflow-y: auto; }
    .sheet-option {
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-size: 0.8rem;
      background: var(--border);
      border: 1px solid transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }
    .sheet-option.active {
      background: rgba(14, 165, 233, 0.15);
      border-color: var(--accent-blue);
      color: var(--accent-cyan);
    }
    .sheet-account-email {
      color: var(--text-secondary);
      font-size: 0.85rem;
      padding: 0.5rem 0 1rem;
      word-break: break-all;
    }
    .sheet-logout {
      display: flex;
      align-items: center;
      width: 100%;
      justify-content: center;
      margin-top: 0.5rem;
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1.25rem;
      font-size: 0.8rem;
      color: var(--text-primary);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      z-index: 200;
      opacity: 0;
      transition: all 0.3s ease;
    }
    .toast.active { opacity: 1; transform: translateX(-50%) translateY(0); }
    .toast.error { border-color: var(--accent-red); }

    @media (min-width: 769px) {
      .toast { bottom: 2rem; }
    }

    /* Batch Selection Bar */
    .batch-selection-bar {
      position: fixed;
      bottom: 80px;
      left: 0;
      right: 0;
      background: var(--bg-card);
      border-top: 1px solid var(--border);
      padding: 0.75rem 1rem;
      z-index: 90; /* Below mobile nav which is 100 */
      /* Hide by default */
      display: none;
    }
    .batch-selection-bar.active {
      display: block;
      animation: slideUp 0.2s ease-out;
    }
    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
    .batch-selection-content {
      max-width: 1600px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .batch-count {
      font-weight: 600;
      color: var(--accent-cyan);
    }
    .batch-actions {
      display: flex;
      gap: 0.5rem;
    }
    @media (min-width: 769px) {
      .batch-selection-bar { bottom: 0; }
    }

    /* Device Selection Checkbox */
    .card-checkbox {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 10;
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: 2px solid var(--border-light);
      background: var(--bg-dark);
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .card-checkbox svg {
      width: 14px;
      height: 14px;
      stroke: white;
      stroke-width: 3;
      opacity: 0;
    }
    .card-checkbox.checked {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
    }
    .card-checkbox.checked svg { opacity: 1; }
    .card.selected { outline: 2px solid var(--accent-blue); outline-offset: -2px; }
    /* Show checkboxes when admin is in selection mode or hovering */
    body.selection-mode .card-checkbox,
    body.admin-mode .card:hover .card-checkbox { display: flex; }
    body.admin-mode .card-checkbox { display: flex; opacity: 0.4; }
    body.admin-mode .card:hover .card-checkbox,
    body.admin-mode .card.selected .card-checkbox { opacity: 1; }

    /* Pull to refresh */
    .pull-indicator {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 0;
      background: linear-gradient(180deg, var(--accent-cyan) 0%, transparent 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      color: white;
      font-weight: 600;
      overflow: hidden;
      opacity: 0;
      z-index: 100;
      transition: opacity 0.2s;
    }

    /* Update banner */
    .update-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-cyan) 100%);
      color: white;
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      font-size: 0.85rem;
      font-weight: 500;
      z-index: 300;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .update-banner button {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }
    .update-banner button:first-of-type {
      background: white;
      color: var(--accent-blue);
      border: none;
    }
  </style>
</head>
<body>
  <div id="pull-indicator" class="pull-indicator">Pull to refresh</div>
  <header class="header">
    <div class="header-content">
      <div class="header-top">
        <div class="logo">
          <div class="logo-icon">💧</div>
          <div class="logo-text">
            <h1>H2OS Fleet</h1>
            <p>Groundwater Monitoring <span class="version-tag">v${VERSION}</span></p>
          </div>
        </div>
        <div class="header-right">
          <div class="user-menu" id="user-menu">
            <div class="user-pill" id="user-pill" onclick="toggleUserMenu()" style="display: none;"></div>
            <div class="user-dropdown" id="user-dropdown">
              <div class="user-dropdown-email" id="user-dropdown-email"></div>
              <div class="user-dropdown-divider"></div>
              <a class="user-dropdown-item" href="#" onclick="handleLogout(event)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign out
              </a>
            </div>
          </div>
          <div class="summary-stats" id="summary-stats">
            <div class="stat-badge healthy"><span class="stat-dot healthy"></span><span id="stat-healthy">0</span></div>
            <div class="stat-badge partial"><span class="stat-dot partial"></span><span id="stat-partial">0</span></div>
            <div class="stat-badge offline"><span class="stat-dot offline"></span><span id="stat-offline">0</span></div>
          </div>
        </div>
      </div>
      <div class="mobile-search">
        <div class="mobile-search-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" id="mobile-search-input" placeholder="Search devices..." oninput="handleSearch(this.value)">
        </div>
      </div>
      <div class="controls-row">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" id="search-input" placeholder="Search devices..." oninput="handleSearch(this.value)">
        </div>
        <div class="section-divider"></div>
        <div class="control-section">
          <span class="control-section-label">Status</span>
          <div class="filter-pills" id="filter-pills">
            <button class="filter-pill active" data-status="all" onclick="setStatusFilter('all')">All <span class="count" id="count-all">(0)</span></button>
            <button class="filter-pill" data-status="healthy" onclick="setStatusFilter('healthy')">Healthy <span class="count" id="count-healthy">(0)</span></button>
            <button class="filter-pill" data-status="partial" onclick="setStatusFilter('partial')">Partial <span class="count" id="count-partial">(0)</span></button>
            <button class="filter-pill" data-status="offline" onclick="setStatusFilter('offline')">Offline <span class="count" id="count-offline">(0)</span></button>
            <button class="filter-pill" data-status="unknown" onclick="setStatusFilter('unknown')">Loading <span class="count" id="count-unknown">(0)</span></button>
          </div>
          <select class="filter-dropdown" id="filter-dropdown" onchange="setStatusFilter(this.value)">
            <option value="all">All</option>
            <option value="healthy">Healthy</option>
            <option value="partial">Partial</option>
            <option value="offline">Offline</option>
            <option value="unknown">Loading</option>
          </select>
        </div>
        <div class="section-divider"></div>
        <div class="control-section">
          <span class="control-section-label">Location</span>
          <select class="location-select" id="location-select" onchange="setLocationFilter(this.value)">
            <option value="all">All Locations</option>
          </select>
        </div>
        <div class="section-divider"></div>
        <div class="control-section">
          <span class="control-section-label">Model</span>
          <div class="filter-pills" id="model-pills">
            <button class="filter-pill active" data-model="all" onclick="setModelFilter('all')">All <span class="count" id="count-model-all">(0)</span></button>
            <button class="filter-pill" data-model="pi5" onclick="setModelFilter('pi5')">Pi 5 <span class="count" id="count-model-pi5">(0)</span></button>
            <button class="filter-pill" data-model="pi4" onclick="setModelFilter('pi4')">Pi 4 <span class="count" id="count-model-pi4">(0)</span></button>
          </div>
          <select class="filter-dropdown" id="model-dropdown" onchange="setModelFilter(this.value)">
            <option value="all">All Models</option>
            <option value="pi5">Pi 5</option>
            <option value="pi4">Pi 4</option>
          </select>
        </div>
        <div class="section-divider"></div>
        <div class="control-section">
          <span class="control-section-label">Sort</span>
          <div class="sort-pills" id="sort-pills">
            <button class="sort-pill active" data-sort="status" onclick="setSortBy('status')">Status</button>
            <button class="sort-pill" data-sort="name" onclick="setSortBy('name')">Name</button>
            <button class="sort-pill" data-sort="location" onclick="setSortBy('location')">Location</button>
            <button class="sort-pill" data-sort="lastSeen" onclick="setSortBy('lastSeen')">Last Seen</button>
          </div>
          <select class="sort-dropdown" id="sort-dropdown" onchange="setSortBy(this.value)">
            <option value="status">Status</option>
            <option value="name">Name</option>
            <option value="location">Location</option>
            <option value="lastSeen">Last Seen</option>
          </select>
        </div>
        <div class="section-divider"></div>
        <div class="control-section">
          <span class="control-section-label">Auto</span>
          <select class="auto-select" id="auto-refresh-select" onchange="setAutoRefresh(this.value)">
            <option value="0">Off</option>
            <option value="30">30s</option>
            <option value="60">1m</option>
            <option value="300">5m</option>
          </select>
        </div>
        <button class="btn-refresh" onclick="refreshDevices()" id="refresh-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          <span class="last-update" id="last-update"></span>
        </button>
      </div>
    </div>
  </header>

  <main class="main" id="main-content">
    <div class="skeleton-grid" id="skeleton-loader">
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-services"></div><div class="skeleton skeleton-buttons"></div></div>
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-services"></div><div class="skeleton skeleton-buttons"></div></div>
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-services"></div><div class="skeleton skeleton-buttons"></div></div>
      <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-services"></div><div class="skeleton skeleton-buttons"></div></div>
    </div>
    <div id="devices-container" style="display:none"></div>
  </main>

  <div class="modal" id="modal">
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-title-group">
          <h2 id="modal-title">Device Details</h2>
          <p id="modal-subtitle"></p>
        </div>
        <button class="modal-close" onclick="closeModal()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="modal-body"></div>
    </div>
  </div>

  <!-- Mobile Bottom Nav -->
  <nav class="mobile-nav">
    <button class="mobile-nav-btn" onclick="openMobileSheet('filter')" id="mobile-filter-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      <span id="mobile-filter-label">Filter</span>
    </button>
    <button class="mobile-nav-btn" onclick="openMobileSheet('location')" id="mobile-location-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <span id="mobile-location-label">Location</span>
    </button>
    <button class="mobile-nav-btn" onclick="openMobileSheet('sort')" id="mobile-sort-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"/></svg>
      <span id="mobile-sort-label">Sort</span>
    </button>
    <button class="mobile-nav-btn" onclick="refreshDevices()" id="mobile-refresh-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      <span>Refresh</span>
    </button>
    <button class="mobile-nav-btn" onclick="openMobileSheet('account')" id="mobile-account-btn" style="display: none;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span id="mobile-account-name">Account</span>
    </button>
  </nav>

  <!-- Mobile Filter Sheet -->
  <div class="mobile-sheet-backdrop" id="sheet-backdrop" onclick="closeMobileSheet()"></div>
  <div class="mobile-sheet" id="mobile-sheet">
    <div class="sheet-handle"></div>
    <div id="sheet-content"></div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <!-- Edit Device Modal -->
  <div class="modal" id="edit-modal">
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <div class="modal-title-group">
          <h2 id="edit-modal-title">Edit Device</h2>
          <p id="edit-modal-subtitle"></p>
        </div>
        <button class="modal-close" onclick="closeEditModal()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="edit-modal-body" style="padding: 1.5rem;">
        <div style="margin-bottom: 1rem;">
          <label style="display: block; color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">Name</label>
          <input type="text" id="edit-friendly-name" style="width: 100%; padding: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 1rem;" placeholder="Friendly name">
        </div>
        <div style="margin-bottom: 1rem;">
          <label style="display: block; color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">Location</label>
          <input type="text" id="edit-location" style="width: 100%; padding: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 1rem;" placeholder="Location">
        </div>
        <div style="margin-bottom: 1.5rem;">
          <label style="display: block; color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">VNC Account</label>
          <select id="edit-vnc-account" style="width: 100%; padding: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 1rem;">
            <option value="">Not Set</option>
            <option value="VNC1">VNC1</option>
            <option value="VNC2">VNC2</option>
          </select>
        </div>
        <button onclick="saveDeviceEdit()" id="edit-save-btn" style="width: 100%; padding: 0.75rem; background: var(--accent-blue); border: none; border-radius: 8px; color: white; font-size: 1rem; cursor: pointer; font-weight: 500;">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Batch Edit Modal -->
  <div class="modal" id="batch-edit-modal">
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <div class="modal-title-group">
          <h2 id="batch-edit-modal-title">Batch Edit</h2>
          <p id="batch-edit-modal-subtitle">0 devices selected</p>
        </div>
        <button class="modal-close" onclick="closeBatchEditModal()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="batch-edit-modal-body" style="padding: 1.5rem;">
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">Only fill in fields you want to change. Empty fields will not be modified.</p>
        <div style="margin-bottom: 1rem;">
          <label style="display: block; color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">Location</label>
          <input type="text" id="batch-edit-location" style="width: 100%; padding: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 1rem;" placeholder="Leave empty to keep current">
        </div>
        <div style="margin-bottom: 1.5rem;">
          <label style="display: block; color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">VNC Account</label>
          <select id="batch-edit-vnc-account" style="width: 100%; padding: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 1rem;">
            <option value="">-- Don't change --</option>
            <option value="VNC1">VNC1</option>
            <option value="VNC2">VNC2</option>
            <option value="__clear__">Clear (remove value)</option>
          </select>
        </div>
        <button onclick="saveBatchEdit()" id="batch-edit-save-btn" style="width: 100%; padding: 0.75rem; background: var(--accent-blue); border: none; border-radius: 8px; color: white; font-size: 1rem; cursor: pointer; font-weight: 500;">Apply to Selected Devices</button>
      </div>
    </div>
  </div>

  <!-- Batch Selection Bar -->
  <div class="batch-selection-bar" id="batch-selection-bar">
    <div class="batch-selection-content">
      <span class="batch-count"><span id="batch-count-num">0</span> selected</span>
      <div class="batch-actions">
        <button class="btn btn-secondary" onclick="showBatchEditModal()">Edit Selected</button>
        <button class="btn btn-secondary" onclick="clearSelection()">Clear Selection</button>
      </div>
    </div>
  </div>

  <script>
    // API base URL - empty for production (same origin), full URL for local dev
    const API_BASE = location.hostname === 'localhost' ? 'https://fleet.aguakmze.ro' : '';

    // State
    let devices = [];
    let deviceStatuses = {};
    let deviceStatusData = {}; // Full status response data
    let previousStatuses = {};
    let userPrefs = {
      pinnedDevices: [],
      sortBy: 'status',
      sortOrder: 'asc',
      autoRefreshInterval: 0,
      collapsedLocations: []
    };
    let searchTerm = '';
    let statusFilter = 'all';
    let locationFilter = 'all';
    let modelFilter = 'all';
    let allLocations = [];
    let isRefreshing = false;
    let deviceServicesHTML = {}; // Cache services HTML for re-render
    let screenshotCache = {}; // Cache screenshot URLs for re-render
    let autoRefreshTimer = null;
    let savePrefsTimeout = null;
    let currentUserEmail = '';
    let isCurrentUserAdmin = false;
    let activeAbortControllers = [];
    let selectedDevices = new Set(); // For batch selection

    // Icons
    const icons = {
      pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
      pinFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 17v5M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
      location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
      eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
      camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
      temp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/></svg>',
      wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>',
      branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
      ram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4M10 10v4M14 10v4M18 10v4"/></svg>',
      disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
      cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
      commit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      reboot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>',
      edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
    };

    // Load preferences
    async function loadPreferences() {
      try {
        const res = await fetch(API_BASE + '/api/preferences', { credentials: 'include' });
        const data = await res.json();
        if (data.pinnedDevices) userPrefs.pinnedDevices = data.pinnedDevices;
        if (data.sortBy) userPrefs.sortBy = data.sortBy;
        if (data.sortOrder) userPrefs.sortOrder = data.sortOrder;
        if (data.autoRefreshInterval) userPrefs.autoRefreshInterval = data.autoRefreshInterval;
        if (data.collapsedLocations) userPrefs.collapsedLocations = data.collapsedLocations;

        // Apply preferences to UI
        document.querySelectorAll('.sort-pill').forEach(p => p.classList.remove('active'));
        const activeSortPill = document.querySelector('.sort-pill[data-sort="' + userPrefs.sortBy + '"]');
        if (activeSortPill) activeSortPill.classList.add('active');
        document.getElementById('sort-dropdown').value = userPrefs.sortBy;
        document.getElementById('auto-refresh-select').value = userPrefs.autoRefreshInterval;
        if (userPrefs.autoRefreshInterval > 0) {
          startAutoRefresh(userPrefs.autoRefreshInterval);
        }

        // Set user info
        currentUserEmail = data.userEmail || '';
        isCurrentUserAdmin = data.isAdmin || false;

        // Add admin-mode class to body for checkbox visibility
        if (isCurrentUserAdmin) {
          document.body.classList.add('admin-mode');
        }

        // Show user pill and set dropdown email
        if (data.userEmail && data.userEmail !== 'anonymous') {
          const pill = document.getElementById('user-pill');
          const displayName = data.userEmail.split('@')[0];
          pill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' + displayName;
          pill.style.display = 'flex';
          document.getElementById('user-dropdown-email').textContent = data.userEmail;
          // Show mobile account button
          const mobileBtn = document.getElementById('mobile-account-btn');
          mobileBtn.style.display = 'flex';
          document.getElementById('mobile-account-name').textContent = displayName;
        }

        // Update mobile nav labels
        updateMobileNavLabels();

        // Re-render devices if already loaded (to show/hide edit button based on admin status)
        if (devices.length > 0) {
          renderDevices();
        }
      } catch (err) {
        console.error('Failed to load preferences:', err);
      }
    }

    // Save preferences (debounced)
    function savePreferences() {
      clearTimeout(savePrefsTimeout);
      savePrefsTimeout = setTimeout(async () => {
        try {
          await fetch(API_BASE + '/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(userPrefs)
          });
        } catch (err) {
          console.error('Failed to save preferences:', err);
        }
      }, 500);
    }

    // Load devices
    async function loadDevices() {
      try {
        // First, load basic device list quickly
        const res = await fetch(API_BASE + '/api/devices');
        const data = await res.json();
        devices = data.devices;

        // Initialize status as unknown for all devices
        deviceStatuses = {};
        deviceStatusData = {};
        devices.forEach(device => {
          deviceStatuses[device.device_id] = 'unknown';
          deviceStatusData[device.device_id] = null;
        });

        screenshotCache = {}; // Clear screenshot cache on full refresh
        document.getElementById('skeleton-loader').style.display = 'none';
        document.getElementById('devices-container').style.display = 'block';
        populateLocationDropdown();
        renderDevices();
        updateSummaryStats();

        // Then progressively check status for each device
        checkAllStatusProgressive();

        // Start loading screenshots immediately (they'll use proxy endpoint)
        loadAllCardScreenshots();
        updateLastUpdate();
      } catch (err) {
        showToast('Error loading devices', true);
      }
    }

    // Populate location dropdown
    function populateLocationDropdown() {
      const locations = new Set();
      devices.forEach(d => {
        const loc = (d.location || d.friendly_name || 'Unknown').trim();
        if (loc) locations.add(loc);
      });
      allLocations = Array.from(locations).sort();

      const select = document.getElementById('location-select');
      select.innerHTML = '<option value="all">All Locations</option>';
      allLocations.forEach(loc => {
        select.innerHTML += '<option value="' + loc.replace(/"/g, '&quot;') + '">' + loc + '</option>';
      });
    }

    // Set location filter
    function setLocationFilter(loc) {
      locationFilter = loc;
      document.getElementById('location-select').value = loc;
      updateMobileNavLabels();
      renderDevices();
    }

    // Check all device statuses
    async function checkAllStatus() {
      previousStatuses = {...deviceStatuses};
      const promises = devices.map(d => checkDeviceStatus(d));
      await Promise.all(promises);
      updateSummaryStats();
      checkOfflineAlerts();
    }

    // Progressively check status for all devices
    async function checkAllStatusProgressive() {
      previousStatuses = {...deviceStatuses};

      // Check devices in small batches to avoid overloading
      const batchSize = 5;
      for (let i = 0; i < devices.length; i += batchSize) {
        const batch = devices.slice(i, i + batchSize);
        const promises = batch.map(d => checkDeviceStatusProxy(d));
        await Promise.all(promises);
        updateSummaryStats(); // Update stats after each batch

        // Re-render if filters are active so newly matched devices appear
        if (statusFilter !== 'all' || locationFilter !== 'all' || modelFilter !== 'all') {
          renderDevices();
        }
      }

      checkOfflineAlerts();
    }

    // Check single device status
    async function checkDeviceStatus(device) {
      const badge = document.getElementById('status-' + device.device_id);
      const servicesDiv = document.getElementById('services-' + device.device_id);
      if (!badge) return;

      badge.className = 'status-badge checking';
      badge.innerHTML = '<span class="dot"></span><span class="status-text">Checking</span>';

      try {
        const controller = new AbortController();
        activeAbortControllers.push(controller);
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch('https://' + device.hostname + '/status', { signal: controller.signal });
        clearTimeout(timeoutId);
        activeAbortControllers = activeAbortControllers.filter(c => c !== controller);
        const data = await res.json();

        deviceStatuses[device.device_id] = data.status;
        deviceStatusData[device.device_id] = data; // Store full status data

        const statusClass = data.status === 'healthy' ? 'online' : data.status === 'partial' ? 'partial' : data.status === 'unknown' ? 'unknown' : 'offline';
        const statusText = data.status === 'healthy' ? 'Online' : data.status === 'partial' ? 'Partial' : data.status === 'unknown' ? 'Loading' : 'Offline';
        badge.className = 'status-badge ' + statusClass;
        badge.innerHTML = '<span class="dot"></span><span class="status-text">' + statusText + '</span>';

        // Mark card if status is incomplete (missing branch/commit)
        const card = document.querySelector('.card[data-device-id="' + device.device_id + '"]');
        if (card) {
          if (!data.branch || !data.commit) {
            card.classList.add('incomplete-status');
          } else {
            card.classList.remove('incomplete-status');
          }
        }

        const services = data.services || {...(data.systemd || {}), ...(data.processes || {})};
        if (servicesDiv) {
          const pct = data.total > 0 ? Math.round((data.running / data.total) * 100) : 0;
          const fillClass = pct === 100 ? '' : pct >= 50 ? 'partial' : 'bad';

          // Helper: format datetime nicely (21 Dec 2025, 05:33)
          function formatDateTime(str) {
            if (!str) return '';
            try {
              // Parse: "2025-12-21 05:33:43" or "2025-12-21 04:54:49 +0100"
              const parts = str.trim().split(' ');
              const datePart = parts[0]; // 2025-12-21
              const timePart = parts[1]; // 05:33:43
              const dp = datePart.split('-');
              const tp = timePart.split(':');
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              return parseInt(dp[2]) + ' ' + months[parseInt(dp[1]) - 1] + ' ' + dp[0] + ', ' + tp[0] + ':' + tp[1];
            } catch(e) { return str; }
          }

          // Helper: format device time without year (21 Dec, 05:33)
          function formatDeviceTime(str) {
            if (!str) return '';
            try {
              const parts = str.trim().split(' ');
              const datePart = parts[0];
              const timePart = parts[1];
              const dp = datePart.split('-');
              const tp = timePart.split(':');
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              return parseInt(dp[2]) + ' ' + months[parseInt(dp[1]) - 1] + ', ' + tp[0] + ':' + tp[1];
            } catch(e) { return str; }
          }

          // Helper: shorten Pi model (Raspberry Pi 5 Model B Rev 1.0 -> Pi 5)
          function shortPiModel(model) {
            if (!model) return '';
            const match = model.match(/Raspberry Pi (\\d)/);
            return match ? 'Pi ' + match[1] : model;
          }

          // Build quick info lines
          // Line 1: model, branch: commit @ date
          const quickInfo1 = [];
          if (data.pi_model) quickInfo1.push('<span class="quick-info-item" title="' + data.pi_model + '">' + icons.cpu + shortPiModel(data.pi_model) + '</span>');
          if (data.branch || data.commit) {
            let branchInfo = data.branch || '';
            if (data.commit) branchInfo += ': ' + data.commit;
            if (data.commit_date) branchInfo += ' @ ' + formatDeviceTime(data.commit_date);
            quickInfo1.push('<span class="quick-info-item mono" title="Branch: Commit @ Date">' + icons.branch + branchInfo + '</span>');
          }
          const commitDateHtml = ''; // Now combined above
          // Line 2: wifi, temp
          const quickInfo2 = [];
          if (data.wifi) quickInfo2.push('<span class="quick-info-item" title="WiFi Network">' + icons.wifi + data.wifi + '</span>');
          if (data.temp) quickInfo2.push('<span class="quick-info-item" title="CPU Temperature">' + icons.temp + data.temp + '°C</span>');

          let quickInfoHtml = '';
          if (quickInfo1.length > 0) quickInfoHtml += '<div class="quick-info">' + quickInfo1.join('') + '</div>';
          quickInfoHtml += commitDateHtml;
          if (quickInfo2.length > 0) quickInfoHtml += '<div class="quick-info">' + quickInfo2.join('') + '</div>';

          // Update device time in location row (outside services container)
          const deviceTimeEl = document.getElementById('device-time-' + device.device_id);
          if (deviceTimeEl && data.local_time) {
            deviceTimeEl.innerHTML = icons.clock + formatDeviceTime(data.local_time);
          }

          const html = '<div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill ' + fillClass + '" style="width:' + pct + '%"></div></div><span class="progress-text">' + data.running + '/' + data.total + '</span></div></div>' +
            quickInfoHtml +
            '<div class="uptime-text">Uptime: ' + data.uptime + '</div>';
          servicesDiv.innerHTML = html;
          deviceServicesHTML[device.device_id] = html; // Cache for re-render
        }
      } catch (err) {
        deviceStatuses[device.device_id] = 'offline';
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span class="dot"></span><span class="status-text">Offline</span>';
        if (servicesDiv) {
          const html = '<div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill bad" style="width:0%"></div></div><span class="progress-text">-/-</span></div></div><div class="services-placeholder" style="color:var(--accent-red)">Unable to connect</div>';
          servicesDiv.innerHTML = html;
          deviceServicesHTML[device.device_id] = html; // Cache for re-render
        }
      }
    }

    // Refresh single device
    async function refreshSingleDevice(deviceId, btn) {
      const device = devices.find(d => d.device_id === deviceId);
      if (!device) return;
      btn.classList.add('loading');
      delete screenshotCache[deviceId]; // Clear cache to force screenshot refresh

      try {
        // Use device filter to get just this device's updated status
        const response = await fetch(API_BASE + '/api/fleet-status?device=' + deviceId);
        if (!response.ok) throw new Error('Failed to fetch device status');

        const data = await response.json();
        const deviceData = data.devices.find(d => d.device_id === deviceId);

        if (deviceData) {
          // Update this device's status in the local state
          deviceStatuses[deviceId] = deviceData.status;
          deviceStatusData[deviceId] = deviceData;

          // Update the UI for just this device
          updateSingleDeviceUI(deviceId, deviceData);

          // Update the counts in filter pills
          updateFilterCounts();
        }

        loadCardScreenshot(deviceId); // Reload screenshot
      } catch (error) {
        console.error('Failed to refresh device:', error);
        showToast('Failed to refresh device status', true);
      } finally {
        btn.classList.remove('loading');
      }
    }

    // Update UI for a single device
    function updateSingleDeviceUI(deviceId, data) {
      const badge = document.getElementById('status-' + deviceId);
      const servicesDiv = document.getElementById('services-' + deviceId);

      if (badge) {
        const statusClass = data.status === 'healthy' ? 'online' : data.status === 'partial' ? 'partial' : data.status === 'unknown' ? 'unknown' : 'offline';
        const statusText = data.status === 'healthy' ? 'Online' : data.status === 'partial' ? 'Partial' : data.status === 'unknown' ? 'Loading' : 'Offline';
        badge.className = 'status-badge ' + statusClass;
        badge.innerHTML = '<span class="dot"></span><span class="status-text">' + statusText + '</span>';
      }

      if (servicesDiv && data.services) {
        const servicesHTML = Object.entries(data.services || {}).map(([service, running]) =>
          '<span class="service ' + (running ? 'running' : 'stopped') + '" title="' + service + '">' + service.replace(/[-_]/g, ' ') + '</span>'
        ).join('');
        servicesDiv.innerHTML = servicesHTML;
        deviceServicesHTML[deviceId] = servicesHTML;
      }
    }

    // Helper functions for status display
    function getStatusClass(deviceId) {
      const status = deviceStatuses[deviceId];
      if (status === 'healthy') return 'online';
      if (status === 'partial') return 'partial';
      return 'offline';
    }

    function getStatusText(deviceId) {
      const status = deviceStatuses[deviceId];
      if (status === 'healthy') return 'Online';
      if (status === 'partial') return 'Partial';
      if (status === 'offline') return 'Offline';
      return 'Unknown';
    }

    function renderServicesHTML(deviceId) {
      const data = deviceStatusData[deviceId];
      if (!data || data.status === 'offline') {
        return '<div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill bad" style="width:0%"></div></div><span class="progress-text">-/-</span></div></div><div class="services-placeholder" style="color:var(--accent-red)">Unable to connect</div>';
      }

      const services = data.services || {};
      const running = data.running || 0;
      const total = data.total || 6;
      const percent = total > 0 ? Math.round((running / total) * 100) : 0;
      const progressClass = running === total ? 'good' : running > 0 ? 'partial' : 'bad';

      let html = '<div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill ' + progressClass + '" style="width:' + percent + '%"></div></div><span class="progress-text">' + running + '/' + total + '</span></div></div>';

      if (services && Object.keys(services).length > 0) {
        html += '<div class="services-list">';
        for (const [service, isRunning] of Object.entries(services)) {
          html += '<div class="service-item"><span class="service-dot ' + (isRunning ? 'running' : 'stopped') + '"></span><span class="service-name" title="' + service + '">' + service + '</span></div>';
        }
        html += '</div>';

        if (data.uptime) {
          html += '<div class="uptime-text">Uptime: ' + data.uptime + '</div>';
        }
      }

      return html;
    }

    // Update summary stats
    function updateSummaryStats() {
      const healthy = Object.values(deviceStatuses).filter(s => s === 'healthy').length;
      const partial = Object.values(deviceStatuses).filter(s => s === 'partial').length;
      const offline = Object.values(deviceStatuses).filter(s => s === 'offline').length;
      const unknown = Object.values(deviceStatuses).filter(s => s === 'unknown').length;
      const total = devices.length;

      document.getElementById('stat-healthy').textContent = healthy;
      document.getElementById('stat-partial').textContent = partial;
      document.getElementById('stat-offline').textContent = offline;

      // Update filter pill counts
      document.getElementById('count-all').textContent = '(' + total + ')';
      document.getElementById('count-healthy').textContent = '(' + healthy + ')';
      document.getElementById('count-partial').textContent = '(' + partial + ')';
      document.getElementById('count-offline').textContent = '(' + offline + ')';
      document.getElementById('count-unknown').textContent = '(' + unknown + ')';

      // Update model filter counts
      let pi5Count = 0, pi4Count = 0;
      devices.forEach(d => {
        const statusData = deviceStatusData[d.device_id] || {};
        const piVersion = getPiVersion(statusData.pi_model);
        if (piVersion === 'pi5') pi5Count++;
        else if (piVersion === 'pi4') pi4Count++;
      });
      document.getElementById('count-model-all').textContent = '(' + total + ')';
      document.getElementById('count-model-pi5').textContent = '(' + pi5Count + ')';
      document.getElementById('count-model-pi4').textContent = '(' + pi4Count + ')';

      // Update tab title if offline
      if (offline > 0) {
        document.title = '(' + offline + ') H2OS Fleet';
      } else {
        document.title = 'H2OS Fleet';
      }
    }

    // Check for offline alerts
    // Check device status using proxy endpoint
    async function checkDeviceStatusProxy(device) {
      const badge = document.getElementById('status-' + device.device_id);
      const servicesDiv = document.getElementById('services-' + device.device_id);

      // Show checking state if element exists
      if (badge) {
        badge.className = 'status-badge checking';
        badge.innerHTML = '<span class="dot"></span><span class="status-text">Checking</span>';
      }

      try {
        const res = await fetch(API_BASE + '/api/device-status/' + device.device_id);
        const data = await res.json();

        if (data.online) {
          deviceStatuses[device.device_id] = data.status;
          deviceStatusData[device.device_id] = data;

          // Update UI if element exists
          if (badge) {
            const statusClass = data.status === 'healthy' ? 'online' : data.status === 'partial' ? 'partial' : data.status === 'unknown' ? 'unknown' : 'offline';
            const statusText = data.status === 'healthy' ? 'Online' : data.status === 'partial' ? 'Partial' : data.status === 'unknown' ? 'Loading' : 'Offline';
            badge.className = 'status-badge ' + statusClass;
            badge.innerHTML = '<span class="dot"></span><span class="status-text">' + statusText + '</span>';
          }

          // Render services if element exists
          if (servicesDiv) {
            servicesDiv.innerHTML = renderServicesHTML(device.device_id);
          }
        } else {
          deviceStatuses[device.device_id] = 'offline';
          if (badge) {
            badge.className = 'status-badge offline';
            badge.innerHTML = '<span class="dot"></span><span class="status-text">Offline</span>';
          }
          if (servicesDiv) {
            servicesDiv.innerHTML = renderServicesHTML(device.device_id);
          }
        }
      } catch (err) {
        deviceStatuses[device.device_id] = 'offline';
        if (badge) {
          badge.className = 'status-badge offline';
          badge.innerHTML = '<span class="dot"></span><span class="status-text">Offline</span>';
        }
        if (servicesDiv) {
          servicesDiv.innerHTML = renderServicesHTML(device.device_id);
        }
      }
    }

    function checkOfflineAlerts() {
      for (const [deviceId, status] of Object.entries(deviceStatuses)) {
        if (status === 'offline' && previousStatuses[deviceId] && previousStatuses[deviceId] !== 'offline') {
          const device = devices.find(d => d.device_id === deviceId);
          if (device && Notification.permission === 'granted') {
            new Notification('Device Offline', {
              body: (device.friendly_name || device.device_id) + ' is now offline',
              icon: '💧'
            });
          }
          showToast((device?.friendly_name || deviceId) + ' went offline', true);
        }
      }
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Refresh devices
    async function refreshDevices() {
      if (isRefreshing) return;
      isRefreshing = true;
      document.getElementById('refresh-btn').classList.add('loading');
      const mobileBtn = document.getElementById('mobile-refresh-btn');
      if (mobileBtn) mobileBtn.classList.add('active');

      // If we have active filters (not "all"), use optimized refresh
      if (statusFilter !== 'all' || locationFilter !== 'all' || modelFilter !== 'all') {
        await refreshFilteredDevices();
      } else {
        await loadDevices();
      }

      document.getElementById('refresh-btn').classList.remove('loading');
      if (mobileBtn) mobileBtn.classList.remove('active');
      isRefreshing = false;
    }

    // Optimized refresh for filtered view - only refresh visible devices
    async function refreshFilteredDevices() {
      try {
        // Build API query based on current filters
        let apiQuery = '';
        const queryParams = [];

        if (statusFilter !== 'all') {
          queryParams.push('status=' + statusFilter);
        }
        if (locationFilter !== 'all') {
          queryParams.push('location=' + encodeURIComponent(locationFilter));
        }
        // Note: modelFilter is client-side only, API doesn't support it

        if (queryParams.length > 0) {
          apiQuery = '?' + queryParams.join('&');
        }

        const response = await fetch(API_BASE + '/api/fleet-status' + apiQuery);
        if (!response.ok) throw new Error('Failed to fetch filtered status');

        const data = await response.json();

        // Update only the devices that match our filters
        data.devices.forEach(deviceData => {
          deviceStatuses[deviceData.device_id] = deviceData.status;
          deviceStatusData[deviceData.device_id] = deviceData;
          updateSingleDeviceUI(deviceData.device_id, deviceData);
        });

        // Update filter counts
        updateFilterCounts();
        updateLastUpdate();

        showToast('Refreshed ' + data.devices.length + ' filtered devices');
      } catch (error) {
        console.error('Filtered refresh failed:', error);
        // Fallback to full refresh
        await loadDevices();
      }
    }

    // Update last update time
    function updateLastUpdate() {
      const now = new Date();
      document.getElementById('last-update').textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    // Auto-refresh
    function setAutoRefresh(seconds) {
      userPrefs.autoRefreshInterval = parseInt(seconds);
      savePreferences();
      startAutoRefresh(parseInt(seconds));
    }

    function startAutoRefresh(seconds) {
      clearInterval(autoRefreshTimer);
      if (seconds > 0) {
        autoRefreshTimer = setInterval(refreshDevices, seconds * 1000);
      }
    }

    // Search
    function handleSearch(value) {
      searchTerm = value.toLowerCase();
      renderDevices();
    }

    // Status filter
    function setStatusFilter(status) {
      statusFilter = status;
      document.querySelectorAll('#filter-pills .filter-pill').forEach(p => p.classList.remove('active'));
      document.querySelector('.filter-pill[data-status="' + status + '"]').classList.add('active');
      document.getElementById('filter-dropdown').value = status;
      updateMobileNavLabels();
      renderDevices();
    }

    // Model filter
    function setModelFilter(model) {
      modelFilter = model;
      document.querySelectorAll('#model-pills .filter-pill').forEach(p => p.classList.remove('active'));
      document.querySelector('.filter-pill[data-model="' + model + '"]').classList.add('active');
      document.getElementById('model-dropdown').value = model;
      renderDevices();
    }

    // Helper to extract Pi version from pi_model string
    function getPiVersion(piModel) {
      if (!piModel) return 'unknown';
      const match = piModel.match(/Raspberry Pi (\\d)/);
      return match ? 'pi' + match[1] : 'unknown';
    }

    // Sort
    function setSortBy(sortBy) {
      userPrefs.sortBy = sortBy;
      // Update pills
      document.querySelectorAll('.sort-pill').forEach(p => p.classList.remove('active'));
      const activePill = document.querySelector('.sort-pill[data-sort="' + sortBy + '"]');
      if (activePill) activePill.classList.add('active');
      // Update dropdown
      document.getElementById('sort-dropdown').value = sortBy;
      updateMobileNavLabels();
      savePreferences();
      renderDevices();
    }

    // Pin/unpin
    function togglePin(deviceId) {
      const idx = userPrefs.pinnedDevices.indexOf(deviceId);
      if (idx > -1) {
        userPrefs.pinnedDevices.splice(idx, 1);
      } else {
        userPrefs.pinnedDevices.push(deviceId);
      }
      savePreferences();
      renderDevices();
    }

    // Toggle location collapse
    function toggleLocation(locKey) {
      const idx = userPrefs.collapsedLocations.indexOf(locKey);
      if (idx > -1) {
        userPrefs.collapsedLocations.splice(idx, 1);
      } else {
        userPrefs.collapsedLocations.push(locKey);
      }
      savePreferences();
      renderDevices(); // Re-render with updated collapsed state
    }

    // Copy SSH
    function copySSH(hostname, btn) {
      const cmd = 'ssh -o ProxyCommand="cloudflared access ssh --hostname %h" pizero@' + hostname;
      navigator.clipboard.writeText(cmd).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = icons.check;
        btn.title = 'Copied!';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = icons.terminal;
          btn.title = 'Copy SSH';
        }, 2000);
      });
    }

    async function rebootDevice(hostname, deviceName, btn) {
      if (!confirm('Reboot ' + deviceName + '?\\n\\nThe device will go offline for ~60 seconds while it restarts.')) {
        return;
      }

      btn.classList.add('rebooting');
      btn.title = 'Rebooting...';
      showToast('Rebooting ' + deviceName + '...');

      try {
        const response = await fetch('https://fleet.aguakmze.ro/api/reboot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostname: hostname })
        });

        if (response.ok) {
          showToast(deviceName + ' is rebooting. Will check again in 60s.');
          // Find device and update UI to show rebooting state
          const device = devices.find(d => d.hostname === hostname);
          const deviceId = device ? device.device_id : null;

          if (deviceId) {
            // Update card to show rebooting state
            const card = document.getElementById('card-' + deviceId);
            const badge = document.getElementById('badge-' + deviceId);
            if (card) card.classList.add('rebooting-card');
            if (badge) {
              badge.className = 'status-badge rebooting';
              badge.innerHTML = '<span class="dot"></span><span class="status-text">Rebooting</span>';
            }
          }

          // After 60s, refresh the device status and screenshot
          setTimeout(async () => {
            btn.classList.remove('rebooting');
            btn.innerHTML = icons.reboot;
            btn.title = 'Reboot';
            if (deviceId) {
              const card = document.getElementById('card-' + deviceId);
              if (card) card.classList.remove('rebooting-card');
              showToast('Checking ' + deviceName + '...');
              delete screenshotCache[deviceId];
              await checkDeviceStatus(device);
              loadCardScreenshot(deviceId);
            }
          }, 60000);
        } else {
          throw new Error('Reboot request failed');
        }
      } catch (err) {
        btn.classList.remove('rebooting');
        btn.innerHTML = icons.reboot;
        btn.title = 'Reboot';
        showToast('Failed to reboot ' + deviceName, true);
      }
    }

    // Filter & sort devices
    function getFilteredDevices() {
      return devices.filter(d => {
        const name = (d.friendly_name || d.device_id).toLowerCase();
        const loc = (d.location || d.friendly_name || 'Unknown').trim();
        const matchesSearch = !searchTerm || name.includes(searchTerm) || loc.toLowerCase().includes(searchTerm) || d.device_id.toLowerCase().includes(searchTerm);
        const status = deviceStatuses[d.device_id] || 'unknown';
        const matchesStatus = statusFilter === 'all' || status === statusFilter;
        const matchesLocation = locationFilter === 'all' || loc === locationFilter;
        const statusData = deviceStatusData[d.device_id] || {};
        const piVersion = getPiVersion(statusData.pi_model);
        const matchesModel = modelFilter === 'all' || piVersion === modelFilter;
        return matchesSearch && matchesStatus && matchesLocation && matchesModel;
      }).sort((a, b) => {
        const statusOrder = { healthy: 0, partial: 1, offline: 2, unknown: 3 };
        const aStatus = deviceStatuses[a.device_id] || 'unknown';
        const bStatus = deviceStatuses[b.device_id] || 'unknown';

        switch (userPrefs.sortBy) {
          case 'status':
            return statusOrder[aStatus] - statusOrder[bStatus];
          case 'name':
            return (a.friendly_name || a.device_id).localeCompare(b.friendly_name || b.device_id);
          case 'location':
            return (a.location || 'ZZZ').localeCompare(b.location || 'ZZZ');
          case 'lastSeen':
            return new Date(b.last_seen || 0) - new Date(a.last_seen || 0);
          default:
            return 0;
        }
      });
    }

    // Render devices
    function renderDevices() {
      const container = document.getElementById('devices-container');
      const filtered = getFilteredDevices();

      if (!devices.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div><h3>No devices registered</h3><p>Run the setup script on a Raspberry Pi to add it.</p></div>';
        return;
      }

      if (!filtered.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>No devices match</h3><p>Try adjusting your search or filters.</p></div>';
        return;
      }

      // Separate pinned and unpinned
      const pinned = filtered.filter(d => userPrefs.pinnedDevices.includes(d.device_id));
      const unpinned = filtered.filter(d => !userPrefs.pinnedDevices.includes(d.device_id));

      // Group by location (case-insensitive)
      const grouped = {};
      const locationDisplayNames = {}; // Store original case for display
      unpinned.forEach(d => {
        const loc = d.location || 'No Location';
        const locKey = loc.toLowerCase().trim(); // normalize for grouping
        if (!grouped[locKey]) {
          grouped[locKey] = [];
          locationDisplayNames[locKey] = loc; // store first occurrence for display
        }
        grouped[locKey].push(d);
      });

      const locations = Object.keys(grouped).sort();
      // Build unified grid - all cards flow together, location shown as tag on each card
      let html = '<div class="devices-grid">';

      // Pinned section
      if (pinned.length > 0) {
        html += '<div class="pinned-header">' + icons.pinFilled + '<span>Pinned (' + pinned.length + ')</span></div>';
        html += pinned.map(d => renderCard(d, true, true)).join('');
        if (unpinned.length > 0) {
          html += '<div class="pinned-divider"></div>';
        }
      }

      // All unpinned cards in a single grid (no location headers breaking the flow)
      unpinned.forEach(d => {
        html += renderCard(d, false, true, false); // always show location tag
      });

      html += '</div>';
      container.innerHTML = html;
      restoreCachedStatuses();
    }

    // Restore cached statuses after re-render
    function restoreCachedStatuses() {
      for (const deviceId of Object.keys(deviceStatuses)) {
        const badge = document.getElementById('status-' + deviceId);
        const servicesDiv = document.getElementById('services-' + deviceId);
        const status = deviceStatuses[deviceId];

        if (badge && status) {
          const statusClass = status === 'healthy' ? 'online' : status === 'partial' ? 'partial' : status === 'unknown' ? 'unknown' : 'offline';
          const statusText = status === 'healthy' ? 'Online' : status === 'partial' ? 'Partial' : status === 'unknown' ? 'Loading' : 'Offline';
          badge.className = 'status-badge ' + statusClass;
          badge.innerHTML = '<span class="dot"></span><span class="status-text">' + statusText + '</span>';
        }

        if (servicesDiv && deviceServicesHTML[deviceId]) {
          servicesDiv.innerHTML = deviceServicesHTML[deviceId];
        }

        // Restore incomplete-status indicator
        const card = document.querySelector('.card[data-device-id="' + deviceId + '"]');
        const statusData = deviceStatusData[deviceId];
        if (card && statusData) {
          if (!statusData.branch || !statusData.commit) {
            card.classList.add('incomplete-status');
          }
        }
      }

      // Restore cached screenshots and mark offline devices
      for (const deviceId of Object.keys(deviceStatuses)) {
        const container = document.getElementById('screenshot-' + deviceId);
        if (!container) continue;
        const loader = container.querySelector('.screenshot-loader');
        const img = container.querySelector('img');
        const status = deviceStatuses[deviceId];

        // If device is offline, show offline state
        if (status === 'offline' || status === 'unknown') {
          if (loader) {
            loader.innerHTML = 'Offline';
            loader.style.opacity = '0.5';
          }
          container.classList.add('failed');
        }
        // Otherwise restore cached screenshot if available
        else if (screenshotCache[deviceId] && loader && img) {
          img.src = screenshotCache[deviceId];
          loader.style.display = 'none';
          img.style.display = 'block';
        }
      }
    }

    // Render single card
    function renderCard(device, isPinned, showLocation, isHidden) {
      const displayName = device.friendly_name || device.device_id;
      const subtitle = device.friendly_name ? device.device_id : '';
      const hiddenClass = isHidden ? ' hidden' : '';
      const isSelected = selectedDevices.has(device.device_id);

      return '<div class="card' + (isPinned ? ' pinned' : '') + (isSelected ? ' selected' : '') + hiddenClass + '" data-device-id="' + device.device_id + '" data-location="' + (device.location || 'No Location') + '">' +
        '<div class="card-checkbox' + (isSelected ? ' checked' : '') + '" onclick="toggleDeviceSelection(\\'' + device.device_id + '\\', event)"><svg viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="card-screenshot" id="screenshot-' + device.device_id + '" data-hostname="' + device.hostname + '">' +
          '<div class="screenshot-loader">' + icons.refresh + '</div>' +
          '<img style="display:none" />' +
          '<div class="refresh-overlay" onclick="refreshCardScreenshot(\\'' + device.device_id + '\\', event)" title="Refresh screenshot">' + icons.refresh + '</div>' +
        '</div>' +
        '<div class="card-header">' +
          '<div class="card-title-group">' +
            '<div class="card-title-row">' +
              '<div class="card-title">' + displayName + '</div>' +
              '<button class="pin-btn' + (isPinned ? ' pinned' : '') + '" onclick="togglePin(\\'' + device.device_id + '\\')" title="' + (isPinned ? 'Unpin' : 'Pin') + '">' + (isPinned ? icons.pinFilled : icons.pin) + '</button>' +
            '</div>' +
            (subtitle ? '<div class="card-subtitle">' + subtitle + '</div>' : '') +
          '</div>' +
          '<div class="card-right">' +
            '<div class="status-badge ' + getStatusClass(device.device_id) + '" id="status-' + device.device_id + '"><span class="dot"></span><span class="status-text">' + getStatusText(device.device_id) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="location-row">' +
          (showLocation && device.location ? '<span class="location-tag">' + icons.location + device.location + '</span>' : '') +
          '<span class="device-time-inline" id="device-time-' + device.device_id + '"></span>' +
        '</div>' +
        '<div class="services" id="services-' + device.device_id + '">' + renderServicesHTML(device.device_id) + '</div>' +
        '<div class="buttons">' +
          '<button class="btn-icon" onclick="showDetails(\\'' + device.device_id + '\\')" title="Details">' + icons.eye + '</button>' +
          '<button class="btn-icon" onclick="showScreenshot(\\'' + device.hostname + '\\', \\'' + displayName.replace(/'/g, "\\\\'") + '\\')" title="Screenshot">' + icons.camera + '</button>' +
          '<button class="btn-icon" onclick="refreshSingleDevice(\\'' + device.device_id + '\\', this)" title="Refresh">' + icons.refresh + '</button>' +
          '<button class="btn-icon" onclick="copySSH(\\'' + device.hostname + '\\', this)" title="Copy SSH">' + icons.terminal + '</button>' +
          '<a class="btn btn-vnc" href="https://' + device.hostname + '/vnc.html" target="_blank" title="Open VNC">' + icons.monitor + '</a>' +
          (isCurrentUserAdmin ? '<button class="btn-icon" onclick="showEditDevice(\\'' + device.device_id + '\\')" title="Edit">' + icons.edit + '</button>' : '') +
          '<button class="btn-icon btn-reboot" onclick="rebootDevice(\\'' + device.hostname + '\\', \\'' + displayName.replace(/'/g, "\\\\'") + '\\', this)" title="Reboot">' + icons.reboot + '</button>' +
        '</div>' +
        '<div class="card-footer">' +
          '<span class="last-seen">Last: ' + (device.last_seen ? formatTime(device.last_seen) : 'Never') + '</span>' +
          '<span class="ssh-hint">' + device.hostname + '</span>' +
        '</div>' +
      '</div>';
    }

    function formatTime(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return diffMins + 'm ago';
      if (diffHours < 24) return diffHours + 'h ago';
      if (diffDays < 7) return diffDays + 'd ago';
      return date.toLocaleDateString();
    }

    // Show details modal
    function showDetails(deviceId) {
      const device = devices.find(d => d.device_id === deviceId);
      if (!device) return;

      const displayName = device.friendly_name || device.device_id;
      document.getElementById('modal-title').textContent = displayName;
      document.getElementById('modal-subtitle').textContent = device.device_id;

      const sshCmd = 'ssh -o ProxyCommand="cloudflared access ssh --hostname %h" pizero@' + device.hostname;
      const statusData = deviceStatusData[deviceId] || {};

      // Build system info section from live status
      let systemInfoHtml = '';
      if (statusData.pi_model || statusData.os || statusData.branch || statusData.commit) {
        systemInfoHtml = '<div class="modal-section"><div class="modal-section-title">System</div><div class="info-grid">' +
          (statusData.pi_model ? '<div class="info-item"><span class="info-label">Model</span><span class="info-value">' + statusData.pi_model + '</span></div>' : '') +
          (statusData.os ? '<div class="info-item"><span class="info-label">OS</span><span class="info-value">' + statusData.os.name + '</span></div>' : '') +
          (statusData.os ? '<div class="info-item"><span class="info-label">Kernel</span><span class="info-value mono">' + statusData.os.kernel + '</span></div>' : '') +
          (statusData.branch ? '<div class="info-item"><span class="info-label">Branch</span><span class="info-value mono">' + statusData.branch + '</span></div>' : '') +
          (statusData.commit ? '<div class="info-item"><span class="info-label">Commit</span><span class="info-value mono">' + statusData.commit + '</span></div>' : '') +
          (statusData.commit_date ? '<div class="info-item"><span class="info-label">Commit Date</span><span class="info-value">' + statusData.commit_date + '</span></div>' : '') +
          '</div></div>';
      }

      // Build live stats section
      let liveStatsHtml = '';
      if (statusData.temp || statusData.ram || statusData.disk || statusData.wifi) {
        liveStatsHtml = '<div class="modal-section"><div class="modal-section-title">Live Stats</div><div class="info-grid">' +
          (statusData.temp ? '<div class="info-item"><span class="info-label">CPU Temp</span><span class="info-value">' + statusData.temp + '°C</span></div>' : '') +
          (statusData.ram ? '<div class="info-item"><span class="info-label">RAM</span><span class="info-value">' + statusData.ram.percent + '% (' + statusData.ram.used_mb + '/' + statusData.ram.total_mb + ' MB)</span></div>' : '') +
          (statusData.disk ? '<div class="info-item"><span class="info-label">Disk</span><span class="info-value">' + statusData.disk.percent + '% (' + statusData.disk.used_gb + '/' + statusData.disk.total_gb + ' GB)</span></div>' : '') +
          (statusData.wifi ? '<div class="info-item"><span class="info-label">WiFi</span><span class="info-value">' + statusData.wifi + '</span></div>' : '') +
          (statusData.ip ? '<div class="info-item"><span class="info-label">Local IP</span><span class="info-value mono">' + statusData.ip + '</span></div>' : '') +
          (statusData.uptime ? '<div class="info-item"><span class="info-label">Uptime</span><span class="info-value">' + statusData.uptime + '</span></div>' : '') +
          (statusData.local_time ? '<div class="info-item"><span class="info-label">Device Time</span><span class="info-value">' + statusData.local_time + '</span></div>' : '') +
          '</div></div>';
      }

      // Build services section for modal
      let servicesHtml = '';
      const services = statusData.services || {};
      if (Object.keys(services).length > 0) {
        const running = Object.values(services).filter(v => v).length;
        const total = Object.keys(services).length;
        servicesHtml = '<div class="modal-section"><div class="modal-section-title">Services (' + running + '/' + total + ')</div><div class="modal-services-grid">' +
          Object.entries(services).map(([name, isRunning]) =>
            '<div class="modal-service-item ' + (isRunning ? 'running' : 'stopped') + '">' +
            '<span class="service-dot ' + (isRunning ? 'running' : 'stopped') + '"></span>' +
            '<span>' + name.replace('.sh', '').replace('.py', '') + '</span></div>'
          ).join('') +
          '</div></div>';
      }

      document.getElementById('modal-body').innerHTML =
        '<div class="modal-section"><div class="modal-section-title">Device Info</div><div class="info-grid">' +
        '<div class="info-item"><span class="info-label">Location</span><span class="info-value">' + (device.location || '-') + '</span></div>' +
        '<div class="info-item"><span class="info-label">Hostname</span><span class="info-value mono">' + device.hostname + '</span></div>' +
        '<div class="info-item"><span class="info-label">Tunnel ID</span><span class="info-value mono">' + (device.tunnel_id || '-') + '</span></div>' +
        '</div></div>' +
        systemInfoHtml +
        liveStatsHtml +
        servicesHtml +
        '<div class="modal-section"><div class="modal-section-title">Timestamps</div><div class="info-grid">' +
        '<div class="info-item"><span class="info-label">Last Seen</span><span class="info-value">' + (device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never') + '</span></div>' +
        '<div class="info-item"><span class="info-label">Created</span><span class="info-value">' + (device.created_at ? new Date(device.created_at).toLocaleString() : '-') + '</span></div>' +
        '</div></div>' +
        '<div class="modal-section"><div class="modal-section-title">SSH Command</div><div class="ssh-command">' + sshCmd + '<button class="ssh-copy-btn" onclick="copySSHModal(this, \\'' + device.hostname + '\\')">Copy</button></div></div>' +
        '<div class="modal-actions"><a class="btn btn-primary" href="https://' + device.hostname + '/vnc.html" target="_blank" style="flex:1">Open VNC</a></div>';

      document.getElementById('modal').classList.add('active');
    }

    function copySSHModal(btn, hostname) {
      const cmd = 'ssh -o ProxyCommand="cloudflared access ssh --hostname %h" pizero@' + hostname;
      navigator.clipboard.writeText(cmd).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('active');
    }

    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Screenshot modal
    async function showScreenshot(hostname, deviceName) {
      // Find device to get device_id
      const device = devices.find(d => d.hostname === hostname);
      const deviceId = device ? device.device_id : null;

      document.getElementById('modal-title').textContent = deviceName + ' - Screenshot';
      document.getElementById('modal-subtitle').textContent = hostname;
      document.getElementById('modal-body').innerHTML =
        '<div class="screenshot-container"><div class="screenshot-loading">Loading screenshot...</div><img class="screenshot-img" style="display:none" /></div>' +
        '<div class="modal-actions" style="margin-top:1rem">' +
        '<button class="btn btn-secondary" onclick="refreshScreenshot(\\'' + hostname + '\\')" style="flex:1">Refresh</button>' +
        '<a class="btn btn-primary" href="' + (deviceId ? API_BASE + '/api/device-screenshot/' + deviceId : 'https://' + hostname + '/screenshot') + '" target="_blank" style="flex:1">Download</a></div>';
      document.getElementById('modal').classList.add('active');
      loadScreenshot(hostname, deviceId);
    }

    function loadScreenshot(hostname, deviceId) {
      const container = document.querySelector('.screenshot-container');
      const loading = container.querySelector('.screenshot-loading');
      const img = container.querySelector('.screenshot-img');
      img.onload = () => { loading.style.display = 'none'; img.style.display = 'block'; };
      img.onerror = () => { loading.textContent = 'Failed to load'; loading.style.color = 'var(--accent-red)'; };

      if (deviceId) {
        // Use proxy endpoint
        img.src = API_BASE + '/api/device-screenshot/' + deviceId + '?t=' + Date.now();
      } else {
        // Fallback to direct URL (will likely fail due to CORS)
        img.src = 'https://' + hostname + '/screenshot?t=' + Date.now();
      }
    }

    function refreshScreenshot(hostname) {
      const loading = document.querySelector('.screenshot-loading');
      const img = document.querySelector('.screenshot-img');
      if (loading && img) {
        loading.style.display = 'block';
        loading.style.color = '';
        loading.textContent = 'Loading screenshot...';
        img.style.display = 'none';
        // Find device to get device_id
        const device = devices.find(d => d.hostname === hostname);
        loadScreenshot(hostname, device ? device.device_id : null);
      }
    }

    // Card screenshot functions
    function loadCardScreenshot(deviceId) {
      const container = document.getElementById('screenshot-' + deviceId);
      if (!container) return;

      // Skip if device is offline - don't waste time trying to load screenshot
      const status = deviceStatuses[deviceId];
      if (status === 'offline' || status === 'unknown') {
        const loader = container.querySelector('.screenshot-loader');
        if (loader) {
          loader.innerHTML = 'Offline';
          loader.style.opacity = '0.5';
        }
        container.classList.add('failed');
        return;
      }

      // Skip if already cached - will be restored by restoreCachedStatuses
      if (screenshotCache[deviceId]) return;

      const hostname = container.dataset.hostname;
      const loader = container.querySelector('.screenshot-loader');
      const img = container.querySelector('img');
      // Use proxy endpoint to avoid CORS
      const url = API_BASE + '/api/device-screenshot/' + deviceId + '?t=' + Date.now();

      img.onload = () => {
        loader.style.display = 'none';
        img.style.display = 'block';
        container.classList.remove('failed');
        screenshotCache[deviceId] = url; // Cache on success
      };
      img.onerror = () => {
        loader.innerHTML = 'Failed';
        container.classList.add('failed');
      };
      img.src = url;
    }

    function refreshCardScreenshot(deviceId, event) {
      event.stopPropagation();
      const container = document.getElementById('screenshot-' + deviceId);
      if (!container) return;
      const overlay = container.querySelector('.refresh-overlay');
      const loader = container.querySelector('.screenshot-loader');
      const img = container.querySelector('img');

      overlay.classList.add('loading');
      loader.innerHTML = icons.refresh;
      loader.style.display = 'block';
      img.style.display = 'none';
      container.classList.remove('failed');

      const hostname = container.dataset.hostname;
      // Use proxy endpoint to avoid CORS
      const url = API_BASE + '/api/device-screenshot/' + deviceId + '?t=' + Date.now();
      img.onload = () => {
        loader.style.display = 'none';
        img.style.display = 'block';
        overlay.classList.remove('loading');
        screenshotCache[deviceId] = url; // Update cache
      };
      img.onerror = () => {
        loader.innerHTML = 'Failed';
        container.classList.add('failed');
        overlay.classList.remove('loading');
        delete screenshotCache[deviceId]; // Clear cache on failure
      };
      img.src = url;
    }

    function loadAllCardScreenshots() {
      devices.forEach(d => {
        setTimeout(() => loadCardScreenshot(d.device_id), Math.random() * 2000);
      });
    }

    // Mobile sheet
    function openMobileSheet(type) {
      const sheet = document.getElementById('mobile-sheet');
      const backdrop = document.getElementById('sheet-backdrop');
      const content = document.getElementById('sheet-content');

      let html = '';
      if (type === 'filter') {
        html = '<div class="sheet-title">Filter</div>' +
          '<div class="sheet-section"><div class="sheet-section-title">Status</div><div class="sheet-options">' +
          '<button class="sheet-option' + (statusFilter === 'all' ? ' active' : '') + '" onclick="setStatusFilter(\\'all\\');closeMobileSheet()">All</button>' +
          '<button class="sheet-option' + (statusFilter === 'healthy' ? ' active' : '') + '" onclick="setStatusFilter(\\'healthy\\');closeMobileSheet()">Healthy</button>' +
          '<button class="sheet-option' + (statusFilter === 'partial' ? ' active' : '') + '" onclick="setStatusFilter(\\'partial\\');closeMobileSheet()">Partial</button>' +
          '<button class="sheet-option' + (statusFilter === 'offline' ? ' active' : '') + '" onclick="setStatusFilter(\\'offline\\');closeMobileSheet()">Offline</button>' +
          '</div></div>';
      } else if (type === 'location') {
        html = '<div class="sheet-title">Location</div>' +
          '<div class="sheet-section"><div class="sheet-options">' +
          '<button class="sheet-option' + (locationFilter === 'all' ? ' active' : '') + '" onclick="setLocationFilter(\\'all\\');closeMobileSheet()">All Locations</button>';
        allLocations.forEach(loc => {
          html += '<button class="sheet-option' + (locationFilter === loc ? ' active' : '') + '" onclick="setLocationFilter(\\'' + loc.replace(/'/g, "\\\\'") + '\\');closeMobileSheet()">' + loc + '</button>';
        });
        html += '</div></div>';
      } else if (type === 'sort') {
        html = '<div class="sheet-title">Sort By</div>' +
          '<div class="sheet-section"><div class="sheet-options">' +
          '<button class="sheet-option' + (userPrefs.sortBy === 'status' ? ' active' : '') + '" onclick="setSortBy(\\'status\\');closeMobileSheet()">Status</button>' +
          '<button class="sheet-option' + (userPrefs.sortBy === 'name' ? ' active' : '') + '" onclick="setSortBy(\\'name\\');closeMobileSheet()">Name</button>' +
          '<button class="sheet-option' + (userPrefs.sortBy === 'location' ? ' active' : '') + '" onclick="setSortBy(\\'location\\');closeMobileSheet()">Location</button>' +
          '<button class="sheet-option' + (userPrefs.sortBy === 'lastSeen' ? ' active' : '') + '" onclick="setSortBy(\\'lastSeen\\');closeMobileSheet()">Last Seen</button>' +
          '</div></div>';
      } else if (type === 'settings') {
        html = '<div class="sheet-title">Settings</div>' +
          '<div class="sheet-section"><div class="sheet-section-title">Auto Refresh</div><div class="sheet-options">' +
          '<button class="sheet-option' + (userPrefs.autoRefreshInterval === 0 ? ' active' : '') + '" onclick="setAutoRefresh(0);closeMobileSheet()">Off</button>' +
          '<button class="sheet-option' + (userPrefs.autoRefreshInterval === 30 ? ' active' : '') + '" onclick="setAutoRefresh(30);closeMobileSheet()">30s</button>' +
          '<button class="sheet-option' + (userPrefs.autoRefreshInterval === 60 ? ' active' : '') + '" onclick="setAutoRefresh(60);closeMobileSheet()">1m</button>' +
          '<button class="sheet-option' + (userPrefs.autoRefreshInterval === 300 ? ' active' : '') + '" onclick="setAutoRefresh(300);closeMobileSheet()">5m</button>' +
          '</div></div>';
      } else if (type === 'account') {
        html = '<div class="sheet-title">Account</div>' +
          '<div class="sheet-section">' +
          '<div class="sheet-account-email">' + currentUserEmail + '</div>' +
          '<button class="sheet-option sheet-logout" onclick="handleLogout(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-right:8px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Sign out</button>' +
          '</div>';
      }

      content.innerHTML = html;
      sheet.classList.add('active');
      backdrop.classList.add('active');
    }

    function closeMobileSheet() {
      document.getElementById('mobile-sheet').classList.remove('active');
      document.getElementById('sheet-backdrop').classList.remove('active');
    }

    // Update mobile nav labels to show active filter/sort values
    function updateMobileNavLabels() {
      // Filter label
      const filterLabel = document.getElementById('mobile-filter-label');
      const filterBtn = document.getElementById('mobile-filter-btn');
      if (statusFilter === 'all') {
        filterLabel.textContent = 'Filter';
        filterBtn.classList.remove('active');
      } else {
        const labels = { healthy: 'Online', partial: 'Partial', offline: 'Offline', unknown: 'Loading' };
        filterLabel.textContent = labels[statusFilter] || statusFilter;
        filterBtn.classList.add('active');
      }

      // Location label
      const locLabel = document.getElementById('mobile-location-label');
      const locBtn = document.getElementById('mobile-location-btn');
      if (locationFilter === 'all') {
        locLabel.textContent = 'Location';
        locBtn.classList.remove('active');
      } else {
        // Truncate long location names
        locLabel.textContent = locationFilter.length > 10 ? locationFilter.slice(0, 10) + '…' : locationFilter;
        locBtn.classList.add('active');
      }

      // Sort label
      const sortLabel = document.getElementById('mobile-sort-label');
      const sortLabels = { status: 'Status', name: 'Name', location: 'Location', lastSeen: 'Recent' };
      sortLabel.textContent = sortLabels[userPrefs.sortBy] || 'Sort';
    }

    // Toast
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast active' + (isError ? ' error' : '');
      setTimeout(() => { toast.classList.remove('active'); }, 3000);
    }

    // Edit device
    let editingDeviceId = null;

    function showEditDevice(deviceId) {
      const device = devices.find(d => d.device_id === deviceId);
      if (!device) return;

      editingDeviceId = deviceId;
      document.getElementById('edit-modal-title').textContent = 'Edit Device';
      document.getElementById('edit-modal-subtitle').textContent = deviceId;
      document.getElementById('edit-friendly-name').value = device.friendly_name || '';
      document.getElementById('edit-location').value = device.location || '';
      document.getElementById('edit-vnc-account').value = device.vnc_account || '';
      document.getElementById('edit-modal').classList.add('active');
    }

    function closeEditModal() {
      document.getElementById('edit-modal').classList.remove('active');
      editingDeviceId = null;
    }

    // User menu dropdown
    function toggleUserMenu() {
      const dropdown = document.getElementById('user-dropdown');
      dropdown.classList.toggle('active');
    }

    function closeUserMenu() {
      document.getElementById('user-dropdown').classList.remove('active');
    }

    function handleLogout(e) {
      e.preventDefault();
      // Stop auto-refresh
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      // Abort all pending requests
      activeAbortControllers.forEach(c => c.abort());
      activeAbortControllers = [];
      // Small delay to let things settle, then redirect
      setTimeout(() => {
        window.location.href = 'https://aguakmzero.cloudflareaccess.com/cdn-cgi/access/logout';
      }, 100);
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      const menu = document.getElementById('user-menu');
      if (menu && !menu.contains(e.target)) {
        closeUserMenu();
      }
    });

    async function saveDeviceEdit() {
      if (!editingDeviceId) return;

      const btn = document.getElementById('edit-save-btn');
      const originalText = btn.textContent;
      btn.textContent = 'Saving...';
      btn.disabled = true;

      try {
        const res = await fetch(API_BASE + '/api/devices/' + editingDeviceId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            friendly_name: document.getElementById('edit-friendly-name').value.trim(),
            location: document.getElementById('edit-location').value.trim(),
            vnc_account: document.getElementById('edit-vnc-account').value
          })
        });

        const data = await res.json();
        if (data.success) {
          // Update local device data
          const idx = devices.findIndex(d => d.device_id === editingDeviceId);
          if (idx !== -1 && data.device) {
            devices[idx] = { ...devices[idx], ...data.device };
          }
          closeEditModal();
          renderDevices();
          showToast('Device updated');
        } else {
          showToast(data.error || 'Failed to update', true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    // Close edit modal on backdrop click
    document.getElementById('edit-modal').addEventListener('click', function(e) {
      if (e.target === this) closeEditModal();
    });

    // Batch Selection Functions
    function toggleDeviceSelection(deviceId, event) {
      event.stopPropagation();
      if (selectedDevices.has(deviceId)) {
        selectedDevices.delete(deviceId);
      } else {
        selectedDevices.add(deviceId);
      }
      updateSelectionUI();
    }

    function updateSelectionUI() {
      const count = selectedDevices.size;
      document.getElementById('batch-count-num').textContent = count;

      // Show/hide batch selection bar
      const bar = document.getElementById('batch-selection-bar');
      if (count > 0) {
        bar.classList.add('active');
        document.body.classList.add('selection-mode');
      } else {
        bar.classList.remove('active');
        document.body.classList.remove('selection-mode');
      }

      // Update card visual states
      document.querySelectorAll('.card').forEach(card => {
        const deviceId = card.dataset.deviceId;
        const checkbox = card.querySelector('.card-checkbox');
        if (selectedDevices.has(deviceId)) {
          card.classList.add('selected');
          if (checkbox) checkbox.classList.add('checked');
        } else {
          card.classList.remove('selected');
          if (checkbox) checkbox.classList.remove('checked');
        }
      });
    }

    function clearSelection() {
      selectedDevices.clear();
      updateSelectionUI();
    }

    function showBatchEditModal() {
      if (selectedDevices.size === 0) {
        showToast('No devices selected', true);
        return;
      }
      document.getElementById('batch-edit-modal-subtitle').textContent = selectedDevices.size + ' devices selected';
      document.getElementById('batch-edit-location').value = '';
      document.getElementById('batch-edit-vnc-account').value = '';
      document.getElementById('batch-edit-modal').classList.add('active');
    }

    function closeBatchEditModal() {
      document.getElementById('batch-edit-modal').classList.remove('active');
    }

    async function saveBatchEdit() {
      if (selectedDevices.size === 0) return;

      const btn = document.getElementById('batch-edit-save-btn');
      const originalText = btn.textContent;
      btn.textContent = 'Saving...';
      btn.disabled = true;

      const location = document.getElementById('batch-edit-location').value.trim();
      const vncAccountSelect = document.getElementById('batch-edit-vnc-account').value;

      // Build update payload - only include fields that have values
      const payload = { device_ids: Array.from(selectedDevices) };

      if (location) {
        payload.location = location;
      }
      if (vncAccountSelect) {
        // Handle "clear" option
        payload.vnc_account = vncAccountSelect === '__clear__' ? '' : vncAccountSelect;
      }

      // Check if any field is being updated
      if (!location && !vncAccountSelect) {
        showToast('No changes to apply', true);
        btn.textContent = originalText;
        btn.disabled = false;
        return;
      }

      try {
        const res = await fetch(API_BASE + '/api/devices/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          // Update local device data
          if (data.devices) {
            data.devices.forEach(updatedDevice => {
              const idx = devices.findIndex(d => d.device_id === updatedDevice.device_id);
              if (idx !== -1) {
                devices[idx] = { ...devices[idx], ...updatedDevice };
              }
            });
          }
          closeBatchEditModal();
          clearSelection();
          renderDevices();
          showToast('Updated ' + data.updated_count + ' devices');
        } else {
          showToast(data.error || 'Failed to update', true);
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    // Close batch edit modal on backdrop click
    document.getElementById('batch-edit-modal').addEventListener('click', function(e) {
      if (e.target === this) closeBatchEditModal();
    });

    // Init
    loadPreferences();
    loadDevices();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Pull-to-refresh
    let pullStartY = 0;
    let pulling = false;
    const pullThreshold = 80;

    document.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0) {
        pullStartY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const pullDistance = e.touches[0].clientY - pullStartY;
      if (pullDistance > 0 && pullDistance < pullThreshold * 1.5) {
        const indicator = document.getElementById('pull-indicator');
        if (indicator) {
          indicator.style.height = Math.min(pullDistance, pullThreshold) + 'px';
          indicator.style.opacity = Math.min(pullDistance / pullThreshold, 1);
          if (pullDistance >= pullThreshold) {
            indicator.textContent = 'Release to refresh';
          } else {
            indicator.textContent = 'Pull to refresh';
          }
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!pulling) return;
      const indicator = document.getElementById('pull-indicator');
      if (indicator) {
        const height = parseInt(indicator.style.height) || 0;
        if (height >= pullThreshold) {
          indicator.textContent = 'Refreshing...';
          refreshDevices().then(() => {
            indicator.style.height = '0';
            indicator.style.opacity = '0';
          });
        } else {
          indicator.style.height = '0';
          indicator.style.opacity = '0';
        }
      }
      pulling = false;
      pullStartY = 0;
    }, { passive: true });

    // Version check for PWA updates
    const APP_VERSION = '${VERSION}';
    async function checkForUpdates() {
      try {
        const res = await fetch('/version?t=' + Date.now());
        const data = await res.json();
        if (data.version && data.version !== APP_VERSION) {
          showUpdatePrompt(data.version);
        }
      } catch (e) { /* ignore */ }
    }

    function showUpdatePrompt(newVersion) {
      const banner = document.createElement('div');
      banner.className = 'update-banner';
      banner.innerHTML = '<span>New version available</span><button onclick="location.reload(true)">Update</button><button onclick="this.parentElement.remove()">Later</button>';
      document.body.appendChild(banner);
    }

    // Check for updates every 5 minutes and on visibility change
    setInterval(checkForUpdates, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdates();
    });
    // Initial check after 10 seconds
    setTimeout(checkForUpdates, 10000);
  </script>
</body>
</html>`;
}
