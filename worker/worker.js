/**
 * Fleet Setup Worker
 * Hosted at fleet.aguakmze.ro
 *
 * Each device gets its own tunnel with path-based routing:
 * - /status → status endpoint (port 8081)
 * - /vnc.html → noVNC (port 6080)
 * - SSH connections → SSH (port 22)
 *
 * Endpoints:
 * GET  /           - Redirects to /dashboard
 * GET  /setup      - Returns the bootstrap script
 * GET  /dashboard  - Fleet dashboard showing all devices
 * POST /validate   - Validates password
 * POST /check      - Checks if device name exists
 * POST /register   - Creates tunnel, DNS, and returns token
 * POST /devices    - List/search devices
 * GET  /api/devices - Get devices as JSON (for dashboard)
 * GET  /api/fleet-status - Get live status of all devices (with optional filters)
 *      ?status=healthy|partial|offline - Filter by status
 *      ?location=Barcelona - Filter by location
 *      ?device=genie-1 - Filter by device name
 */

const ACCOUNT_ID = 'b62c683522b0480cb5cf56b57dc6ba77';
const ZONE_ID = 'dc57ebbf78af9984015c7762b4fee21d';
const DOMAIN = 'aguakmze.ro';
const VERSION = '36aae85'; // Update this with: git log -1 --format="%h"

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      switch (url.pathname) {
        case '/':
          return Response.redirect('https://fleet.aguakmze.ro/dashboard', 302);

        case '/setup':
          return new Response(getBootstrapScript(), {
            headers: { 'Content-Type': 'text/plain' },
          });

        case '/dashboard':
          return new Response(getDashboardHTML(), {
            headers: { 'Content-Type': 'text/html' },
          });

        case '/api/devices':
          return handleApiDevices(request, env, corsHeaders);

        case '/api/fleet-status':
          return handleFleetStatus(request, env, corsHeaders);

        case '/api/preferences':
          if (request.method === 'GET') {
            return handleGetPreferences(request, env, corsHeaders);
          } else if (request.method === 'POST') {
            return handleSavePreferences(request, env, corsHeaders);
          }
          return new Response('Method not allowed', { status: 405 });

        case '/validate':
          return handleValidate(request, env, corsHeaders);

        case '/check':
          return handleCheck(request, env, corsHeaders);

        case '/register':
          return handleRegister(request, env, corsHeaders);

        case '/devices':
          return handleDevices(request, env, corsHeaders);

        case '/download/cloudflared':
          return handleCloudflaredDownload(url, corsHeaders);

        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

async function handleValidate(request, env, corsHeaders) {
  const { password } = await request.json();
  const valid = password === env.SETUP_PASSWORD;

  return new Response(JSON.stringify({ valid }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCheck(request, env, corsHeaders) {
  const { password, name } = await request.json();

  if (password !== env.SETUP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check if device exists in D1
  const device = await env.DB.prepare(
    'SELECT * FROM devices WHERE device_id = ?'
  ).bind(name).first();

  return new Response(JSON.stringify({
    exists: !!device,
    device: device || null,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleRegister(request, env, corsHeaders) {
  const { password, name, friendlyName, location, reassign } = await request.json();

  if (password !== env.SETUP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const hostname = `${name}-fleet.${DOMAIN}`;
  const tunnelName = `h2os-${name}`;

  const cfHeaders = {
    'X-Auth-Email': env.CF_EMAIL,
    'X-Auth-Key': env.CF_API_KEY,
    'Content-Type': 'application/json',
  };

  let tunnelId, tunnelToken;

  // Check if device already has a tunnel
  const existingDevice = await env.DB.prepare(
    'SELECT tunnel_id FROM devices WHERE device_id = ?'
  ).bind(name).first();

  if (existingDevice?.tunnel_id && !reassign) {
    // Reuse existing tunnel
    tunnelId = existingDevice.tunnel_id;

    // Get token for existing tunnel
    const tokenResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
      { headers: cfHeaders }
    );
    const tokenData = await tokenResponse.json();
    tunnelToken = tokenData.result;
  } else {
    // Delete old tunnel if reassigning (from our DB)
    if (existingDevice?.tunnel_id && reassign) {
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${existingDevice.tunnel_id}?cascade=true`,
        { method: 'DELETE', headers: cfHeaders }
      );
    }

    // Also check Cloudflare directly for tunnel with this name (might exist but not in our DB)
    const listTunnelsResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel?name=${encodeURIComponent(tunnelName)}`,
      { headers: cfHeaders }
    );
    const listData = await listTunnelsResponse.json();

    if (listData.result?.length > 0) {
      // Found existing tunnel(s) with this name - force delete them (cascade=true removes active connections)
      for (const tunnel of listData.result) {
        console.log(`Force deleting tunnel: ${tunnel.id} (${tunnel.name})`);
        const delRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnel.id}?cascade=true`,
          { method: 'DELETE', headers: cfHeaders }
        );
        const delData = await delRes.json();
        console.log(`Delete result: ${JSON.stringify(delData)}`);
      }
      // Wait a moment for deletion to propagate
      await new Promise(r => setTimeout(r, 2000));
    }

    // Create new tunnel for this device
    const createTunnelResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel`,
      {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({
          name: tunnelName,
          config_src: 'cloudflare',
        }),
      }
    );
    const tunnelData = await createTunnelResponse.json();

    if (!tunnelData.success) {
      return new Response(JSON.stringify({
        error: tunnelData.errors?.[0]?.message || 'Failed to create tunnel'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    tunnelId = tunnelData.result.id;

    // Get tunnel token
    const tokenResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
      { headers: cfHeaders }
    );
    const tokenData = await tokenResponse.json();
    tunnelToken = tokenData.result;
  }

  // Configure tunnel ingress with path-based routing:
  // /status → status endpoint, /vnc.* → noVNC, fallback → SSH
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: 'PUT',
      headers: cfHeaders,
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, path: '/status', service: 'http://localhost:8081' },
            { hostname, path: '/screenshot', service: 'http://localhost:8081' },
            { hostname, path: '/screenshot/*', service: 'http://localhost:8081' },
            { hostname, path: '/vnc.*', service: 'http://localhost:6080' },
            { hostname, service: 'ssh://localhost:22' },
            { service: 'http_status:404' },
          ],
        },
      }),
    }
  );

  // Delete existing DNS record if any
  const existingDns = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${hostname}`,
    { headers: cfHeaders }
  );
  const dnsData = await existingDns.json();
  for (const record of dnsData.result || []) {
    await fetch(
      `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${record.id}`,
      { method: 'DELETE', headers: cfHeaders }
    );
  }

  // Create single DNS record pointing to this device's tunnel
  await fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`,
    {
      method: 'POST',
      headers: cfHeaders,
      body: JSON.stringify({
        type: 'CNAME',
        name: hostname,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
        ttl: 1,
      }),
    }
  );

  // Save to D1
  await env.DB.prepare(`
    INSERT INTO devices (device_id, friendly_name, hostname, location, tunnel_id, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      hostname = excluded.hostname,
      location = excluded.location,
      tunnel_id = excluded.tunnel_id,
      last_seen = datetime('now')
  `).bind(name, friendlyName || null, hostname, location || null, tunnelId).run();

  return new Response(JSON.stringify({
    success: true,
    tunnelToken,
    hostname,
    tunnelId,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleDevices(request, env, corsHeaders) {
  const { password, search } = await request.json();

  if (password !== env.SETUP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let devices;
  if (search) {
    const searchPattern = `%${search}%`;
    devices = await env.DB.prepare(`
      SELECT * FROM devices
      WHERE device_id LIKE ? OR friendly_name LIKE ? OR location LIKE ?
      ORDER BY last_seen DESC
    `).bind(searchPattern, searchPattern, searchPattern).all();
  } else {
    devices = await env.DB.prepare(`
      SELECT * FROM devices ORDER BY last_seen DESC
    `).all();
  }

  return new Response(JSON.stringify({
    devices: devices.results,
    count: devices.results.length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// API endpoint for dashboard to fetch devices
async function handleApiDevices(request, env, corsHeaders) {
  const devices = await env.DB.prepare(`
    SELECT * FROM devices ORDER BY device_id ASC
  `).all();

  return new Response(JSON.stringify({
    devices: devices.results,
    count: devices.results.length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Fetch live status from all devices with optional filtering
async function handleFleetStatus(request, env, corsHeaders) {
  const url = new URL(request.url);
  const filterStatus = url.searchParams.get('status');
  const filterLocation = url.searchParams.get('location');
  const filterDevice = url.searchParams.get('device');

  // Get all devices from DB
  const devices = await env.DB.prepare(`
    SELECT * FROM devices ORDER BY device_id ASC
  `).all();

  // Fetch status from each device in parallel
  const statusPromises = devices.results.map(async (device) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`https://${device.hostname}/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status = await res.json();

      return {
        device_id: device.device_id,
        friendly_name: device.friendly_name,
        hostname: device.hostname,
        location: device.location,
        ...status,
        online: true,
      };
    } catch (err) {
      return {
        device_id: device.device_id,
        friendly_name: device.friendly_name,
        hostname: device.hostname,
        location: device.location,
        status: 'offline',
        error: err.message,
        online: false,
      };
    }
  });

  let results = await Promise.all(statusPromises);

  // Apply filters
  if (filterStatus) {
    results = results.filter(d => d.status === filterStatus);
  }
  if (filterLocation) {
    results = results.filter(d => d.location && d.location.toLowerCase().includes(filterLocation.toLowerCase()));
  }
  if (filterDevice) {
    results = results.filter(d => d.device_id.includes(filterDevice));
  }

  // Summary stats
  const summary = {
    total: results.length,
    healthy: results.filter(d => d.status === 'healthy').length,
    partial: results.filter(d => d.status === 'partial').length,
    offline: results.filter(d => d.status === 'offline').length,
  };

  return new Response(JSON.stringify({
    summary,
    devices: results,
    timestamp: new Date().toISOString(),
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Proxy cloudflared downloads through our worker (for Pis that can't reach GitHub)
async function handleCloudflaredDownload(url, corsHeaders) {
  const arch = url.searchParams.get('arch') || 'armhf';
  const validArchs = ['armhf', 'arm64', 'amd64'];

  if (!validArchs.includes(arch)) {
    return new Response(`Invalid architecture. Use: ${validArchs.join(', ')}`, {
      status: 400,
      headers: corsHeaders,
    });
  }

  const githubUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb`;

  try {
    const response = await fetch(githubUrl, {
      headers: {
        'User-Agent': 'H2OS-Fleet-Setup/1.0',
      },
    });

    if (!response.ok) {
      return new Response(`Failed to fetch from GitHub: ${response.status}`, {
        status: 502,
        headers: corsHeaders,
      });
    }

    // Stream the response through
    return new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/vnd.debian.binary-package',
        'Content-Disposition': `attachment; filename="cloudflared-linux-${arch}.deb"`,
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, {
      status: 502,
      headers: corsHeaders,
    });
  }
}

// Get user email from Cloudflare Access header
function getUserEmail(request) {
  return request.headers.get('CF-Access-Authenticated-User-Email') || 'anonymous';
}

// Ensure user_preferences table exists
async function ensurePreferencesTable(env) {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_email TEXT PRIMARY KEY,
      pinned_devices TEXT DEFAULT '[]',
      sort_by TEXT DEFAULT 'status',
      sort_order TEXT DEFAULT 'asc',
      auto_refresh_interval INTEGER DEFAULT 0,
      collapsed_locations TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Get user preferences
async function handleGetPreferences(request, env, corsHeaders) {
  const userEmail = getUserEmail(request);

  try {
    await ensurePreferencesTable(env);

    const prefs = await env.DB.prepare(
      'SELECT * FROM user_preferences WHERE user_email = ?'
    ).bind(userEmail).first();

    if (prefs) {
      return new Response(JSON.stringify({
        userEmail,
        pinnedDevices: JSON.parse(prefs.pinned_devices || '[]'),
        sortBy: prefs.sort_by || 'status',
        sortOrder: prefs.sort_order || 'asc',
        autoRefreshInterval: prefs.auto_refresh_interval || 0,
        collapsedLocations: JSON.parse(prefs.collapsed_locations || '[]'),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Return defaults for new user
    return new Response(JSON.stringify({
      userEmail,
      pinnedDevices: [],
      sortBy: 'status',
      sortOrder: 'asc',
      autoRefreshInterval: 0,
      collapsedLocations: [],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Save user preferences
async function handleSavePreferences(request, env, corsHeaders) {
  const userEmail = getUserEmail(request);

  try {
    await ensurePreferencesTable(env);

    const body = await request.json();
    const { pinnedDevices, sortBy, sortOrder, autoRefreshInterval, collapsedLocations } = body;

    await env.DB.prepare(`
      INSERT INTO user_preferences (user_email, pinned_devices, sort_by, sort_order, auto_refresh_interval, collapsed_locations, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_email) DO UPDATE SET
        pinned_devices = excluded.pinned_devices,
        sort_by = excluded.sort_by,
        sort_order = excluded.sort_order,
        auto_refresh_interval = excluded.auto_refresh_interval,
        collapsed_locations = excluded.collapsed_locations,
        updated_at = datetime('now')
    `).bind(
      userEmail,
      JSON.stringify(pinnedDevices || []),
      sortBy || 'status',
      sortOrder || 'asc',
      autoRefreshInterval || 0,
      JSON.stringify(collapsedLocations || [])
    ).run();

    return new Response(JSON.stringify({ success: true, userEmail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>H2OS Fleet</title>
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
    }

    @media (min-width: 769px) {
      body { padding-bottom: 0; }
    }

    /* Header */
    .header {
      background: linear-gradient(180deg, #0f172a 0%, var(--bg-dark) 100%);
      border-bottom: 1px solid var(--border);
      padding: 1rem 1.5rem;
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(12px);
    }
    .header-content {
      max-width: 1600px;
      margin: 0 auto;
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
      align-items: center;
      flex-wrap: wrap;
    }

    /* Search */
    .search-box {
      flex: 1;
      min-width: 200px;
      max-width: 300px;
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
    }
    .filter-pill:hover { background: var(--border-light); color: var(--text-primary); }
    .filter-pill.active {
      background: rgba(14, 165, 233, 0.15);
      border-color: var(--accent-blue);
      color: var(--accent-cyan);
    }

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

    /* Auto-refresh toggle */
    .auto-refresh-toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
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
      padding: 1.5rem;
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
    .card:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-light);
      transform: translateY(-2px);
      box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.4);
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
    .status-badge.checking { background: rgba(14, 165, 233, 0.15); color: var(--accent-blue); }
    .status-badge.checking .dot { background: var(--accent-blue); animation: pulse-blue 1s ease-in-out infinite; }

    @keyframes pulse-blue {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }

    /* Location Tag */
    .location-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      background: var(--border);
      border-radius: 4px;
      font-size: 0.65rem;
      color: var(--text-secondary);
      margin-bottom: 0.75rem;
    }
    .location-tag svg { width: 10px; height: 10px; opacity: 0.7; }

    /* Services */
    .services {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
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

    /* Buttons */
    .buttons {
      display: flex;
      gap: 0.5rem;
      align-items: center;
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
    @media (max-width: 768px) {
      .mobile-nav { display: flex; justify-content: space-around; align-items: center; }
      .controls-row { display: none; }
      .summary-stats { display: none; }
      .header-top .summary-stats { display: none; }
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
    .sheet-options { display: flex; flex-wrap: wrap; gap: 0.5rem; }
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
  </style>
</head>
<body>
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
        <div class="summary-stats" id="summary-stats">
          <div class="stat-badge healthy"><span class="stat-dot healthy"></span><span id="stat-healthy">0</span></div>
          <div class="stat-badge partial"><span class="stat-dot partial"></span><span id="stat-partial">0</span></div>
          <div class="stat-badge offline"><span class="stat-dot offline"></span><span id="stat-offline">0</span></div>
        </div>
      </div>
      <div class="controls-row">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" id="search-input" placeholder="Search devices..." oninput="handleSearch(this.value)">
        </div>
        <div class="filter-pills" id="filter-pills">
          <button class="filter-pill active" data-status="all" onclick="setStatusFilter('all')">All</button>
          <button class="filter-pill" data-status="healthy" onclick="setStatusFilter('healthy')">Healthy</button>
          <button class="filter-pill" data-status="partial" onclick="setStatusFilter('partial')">Partial</button>
          <button class="filter-pill" data-status="offline" onclick="setStatusFilter('offline')">Offline</button>
        </div>
        <div class="control-group">
          <span class="control-label">Sort</span>
          <select class="control-select" id="sort-select" onchange="setSortBy(this.value)">
            <option value="status">Status</option>
            <option value="name">Name</option>
            <option value="location">Location</option>
            <option value="lastSeen">Last Seen</option>
          </select>
        </div>
        <div class="control-group auto-refresh-toggle">
          <span class="control-label">Auto</span>
          <select class="control-select" id="auto-refresh-select" onchange="setAutoRefresh(this.value)">
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
    <button class="mobile-nav-btn" onclick="openMobileSheet('filter')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      <span>Filter</span>
    </button>
    <button class="mobile-nav-btn" onclick="openMobileSheet('sort')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"/></svg>
      <span>Sort</span>
    </button>
    <button class="mobile-nav-btn" onclick="refreshDevices()" id="mobile-refresh-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      <span>Refresh</span>
    </button>
    <button class="mobile-nav-btn" onclick="openMobileSheet('settings')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
      <span>Settings</span>
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

  <script>
    // State
    let devices = [];
    let deviceStatuses = {};
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
    let isRefreshing = false;
    let autoRefreshTimer = null;
    let savePrefsTimeout = null;

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
      camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
    };

    // Load preferences
    async function loadPreferences() {
      try {
        const res = await fetch('/api/preferences');
        const data = await res.json();
        if (data.pinnedDevices) userPrefs.pinnedDevices = data.pinnedDevices;
        if (data.sortBy) userPrefs.sortBy = data.sortBy;
        if (data.sortOrder) userPrefs.sortOrder = data.sortOrder;
        if (data.autoRefreshInterval) userPrefs.autoRefreshInterval = data.autoRefreshInterval;
        if (data.collapsedLocations) userPrefs.collapsedLocations = data.collapsedLocations;

        // Apply preferences to UI
        document.getElementById('sort-select').value = userPrefs.sortBy;
        document.getElementById('auto-refresh-select').value = userPrefs.autoRefreshInterval;
        if (userPrefs.autoRefreshInterval > 0) {
          startAutoRefresh(userPrefs.autoRefreshInterval);
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
          await fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        const res = await fetch('/api/devices');
        const data = await res.json();
        devices = data.devices;
        document.getElementById('skeleton-loader').style.display = 'none';
        document.getElementById('devices-container').style.display = 'block';
        renderDevices();
        checkAllStatus();
        updateLastUpdate();
      } catch (err) {
        showToast('Error loading devices', true);
      }
    }

    // Check all device statuses
    async function checkAllStatus() {
      previousStatuses = {...deviceStatuses};
      const promises = devices.map(d => checkDeviceStatus(d));
      await Promise.all(promises);
      updateSummaryStats();
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
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch('https://' + device.hostname + '/status', { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await res.json();

        deviceStatuses[device.device_id] = data.status;

        const statusClass = data.status === 'healthy' ? 'online' : data.status === 'partial' ? 'partial' : 'offline';
        const statusText = data.status === 'healthy' ? 'Online' : data.status === 'partial' ? 'Partial' : 'Offline';
        badge.className = 'status-badge ' + statusClass;
        badge.innerHTML = '<span class="dot"></span><span class="status-text">' + statusText + '</span>';

        const services = data.services || {...(data.systemd || {}), ...(data.processes || {})};
        if (servicesDiv) {
          const pct = data.total > 0 ? Math.round((data.running / data.total) * 100) : 0;
          const fillClass = pct === 100 ? '' : pct >= 50 ? 'partial' : 'bad';
          servicesDiv.innerHTML =
            '<div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill ' + fillClass + '" style="width:' + pct + '%"></div></div><span class="progress-text">' + data.running + '/' + data.total + '</span></div></div>' +
            '<div class="services-list">' + Object.entries(services).map(([name, running]) =>
              '<div class="service-item"><span class="service-dot ' + (running ? 'running' : 'stopped') + '"></span><span class="service-name">' + name.replace('.sh', '').replace('.py', '') + '</span></div>'
            ).join('') + '</div>' +
            '<div class="uptime-text">Uptime: ' + data.uptime + '</div>';
        }
      } catch (err) {
        deviceStatuses[device.device_id] = 'offline';
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span class="dot"></span><span class="status-text">Offline</span>';
        if (servicesDiv) {
          servicesDiv.innerHTML = '<div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill bad" style="width:0%"></div></div><span class="progress-text">-/-</span></div></div><div class="services-placeholder" style="color:var(--accent-red)">Unable to connect</div>';
        }
      }
    }

    // Refresh single device
    async function refreshSingleDevice(deviceId, btn) {
      const device = devices.find(d => d.device_id === deviceId);
      if (!device) return;
      btn.classList.add('loading');
      await checkDeviceStatus(device);
      btn.classList.remove('loading');
      updateSummaryStats();
    }

    // Update summary stats
    function updateSummaryStats() {
      const healthy = Object.values(deviceStatuses).filter(s => s === 'healthy').length;
      const partial = Object.values(deviceStatuses).filter(s => s === 'partial').length;
      const offline = Object.values(deviceStatuses).filter(s => s === 'offline').length;

      document.getElementById('stat-healthy').textContent = healthy;
      document.getElementById('stat-partial').textContent = partial;
      document.getElementById('stat-offline').textContent = offline;

      // Update tab title if offline
      if (offline > 0) {
        document.title = '(' + offline + ') H2OS Fleet';
      } else {
        document.title = 'H2OS Fleet';
      }
    }

    // Check for offline alerts
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

      await loadDevices();

      document.getElementById('refresh-btn').classList.remove('loading');
      if (mobileBtn) mobileBtn.classList.remove('active');
      isRefreshing = false;
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
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      document.querySelector('.filter-pill[data-status="' + status + '"]').classList.add('active');
      renderDevices();
    }

    // Sort
    function setSortBy(sortBy) {
      userPrefs.sortBy = sortBy;
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
        btn.innerHTML = icons.check + ' Copied!';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = icons.terminal + ' SSH';
        }, 2000);
      });
    }

    // Filter & sort devices
    function getFilteredDevices() {
      return devices.filter(d => {
        const name = (d.friendly_name || d.device_id).toLowerCase();
        const loc = (d.location || '').toLowerCase();
        const matchesSearch = !searchTerm || name.includes(searchTerm) || loc.includes(searchTerm) || d.device_id.toLowerCase().includes(searchTerm);
        const status = deviceStatuses[d.device_id] || 'unknown';
        const matchesStatus = statusFilter === 'all' || status === statusFilter || (statusFilter === 'healthy' && status === 'healthy') || (statusFilter === 'partial' && status === 'partial') || (statusFilter === 'offline' && (status === 'offline' || status === 'unknown'));
        return matchesSearch && matchesStatus;
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
      const showLocationHeaders = locations.length > 1;

      // Build unified grid
      let html = '<div class="devices-grid">';

      // Pinned section
      if (pinned.length > 0) {
        html += '<div class="pinned-header">' + icons.pinFilled + '<span>Pinned (' + pinned.length + ')</span></div>';
        html += pinned.map(d => renderCard(d, true, true)).join('');
        if (unpinned.length > 0) {
          html += '<div class="pinned-divider"></div>';
        }
      }

      // Location groups in unified grid
      locations.forEach(locKey => {
        const displayLoc = locationDisplayNames[locKey];
        const isCollapsed = userPrefs.collapsedLocations.includes(locKey);
        if (showLocationHeaders) {
          html += '<div class="location-header' + (isCollapsed ? ' collapsed' : '') + '" onclick="toggleLocation(\\''+locKey.replace(/'/g, "\\\\'")+'\\')">';
          html += '<span class="location-chevron">' + icons.chevron + '</span>';
          html += '<span class="location-name">' + displayLoc + '</span>';
          html += '<span class="location-count">' + grouped[locKey].length + '</span>';
          html += '</div>';
        }
        grouped[locKey].forEach(d => {
          html += renderCard(d, false, !showLocationHeaders, isCollapsed && showLocationHeaders);
        });
      });

      html += '</div>';
      container.innerHTML = html;
    }

    // Render single card
    function renderCard(device, isPinned, showLocation, isHidden) {
      const displayName = device.friendly_name || device.device_id;
      const subtitle = device.friendly_name ? device.device_id : '';
      const hiddenClass = isHidden ? ' hidden' : '';

      return '<div class="card' + (isPinned ? ' pinned' : '') + hiddenClass + '" data-device-id="' + device.device_id + '" data-location="' + (device.location || 'No Location') + '">' +
        '<div class="card-header">' +
          '<div class="card-title-group">' +
            '<div class="card-title-row">' +
              '<div class="card-title">' + displayName + '</div>' +
              '<button class="pin-btn' + (isPinned ? ' pinned' : '') + '" onclick="togglePin(\\'' + device.device_id + '\\')" title="' + (isPinned ? 'Unpin' : 'Pin') + '">' + (isPinned ? icons.pinFilled : icons.pin) + '</button>' +
            '</div>' +
            (subtitle ? '<div class="card-subtitle">' + subtitle + '</div>' : '') +
          '</div>' +
          '<div class="card-right">' +
            '<div class="status-badge" id="status-' + device.device_id + '"><span class="dot"></span><span class="status-text">Unknown</span></div>' +
          '</div>' +
        '</div>' +
        (showLocation && device.location ? '<div class="location-tag">' + icons.location + device.location + '</div>' : '') +
        '<div class="services" id="services-' + device.device_id + '"><div class="services-header"><span class="services-title">Services</span><div class="services-progress"><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div><span class="progress-text">-/-</span></div></div><div class="services-placeholder">Checking...</div></div>' +
        '<div class="buttons">' +
          '<button class="btn-icon" onclick="showDetails(\\'' + device.device_id + '\\')" title="Details">' + icons.info + '</button>' +
          '<button class="btn-icon" onclick="showScreenshot(\\'' + device.hostname + '\\', \\'' + displayName.replace(/'/g, "\\\\'") + '\\')" title="Screenshot">' + icons.camera + '</button>' +
          '<button class="btn btn-secondary" onclick="refreshSingleDevice(\\'' + device.device_id + '\\', this)">' + icons.refresh + ' Refresh</button>' +
          '<button class="btn btn-secondary" onclick="copySSH(\\'' + device.hostname + '\\', this)">' + icons.terminal + ' SSH</button>' +
          '<a class="btn btn-primary" href="https://' + device.hostname + '/vnc.html" target="_blank">' + icons.monitor + ' VNC</a>' +
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

      document.getElementById('modal-body').innerHTML =
        '<div class="modal-section"><div class="modal-section-title">Device Info</div><div class="info-grid">' +
        '<div class="info-item"><span class="info-label">Location</span><span class="info-value">' + (device.location || '-') + '</span></div>' +
        '<div class="info-item"><span class="info-label">Hostname</span><span class="info-value mono">' + device.hostname + '</span></div>' +
        '<div class="info-item"><span class="info-label">Tunnel ID</span><span class="info-value mono">' + (device.tunnel_id || '-') + '</span></div>' +
        '</div></div>' +
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
      document.getElementById('modal-title').textContent = deviceName + ' - Screenshot';
      document.getElementById('modal-subtitle').textContent = hostname;
      document.getElementById('modal-body').innerHTML =
        '<div class="screenshot-container"><div class="screenshot-loading">Loading screenshot...</div><img class="screenshot-img" style="display:none" /></div>' +
        '<div class="modal-actions" style="margin-top:1rem">' +
        '<button class="btn btn-secondary" onclick="refreshScreenshot(\\'' + hostname + '\\')" style="flex:1">Refresh</button>' +
        '<a class="btn btn-primary" href="https://' + hostname + '/screenshot" target="_blank" style="flex:1">Download</a></div>';
      document.getElementById('modal').classList.add('active');
      loadScreenshot(hostname);
    }

    function loadScreenshot(hostname) {
      const container = document.querySelector('.screenshot-container');
      const loading = container.querySelector('.screenshot-loading');
      const img = container.querySelector('.screenshot-img');
      img.onload = () => { loading.style.display = 'none'; img.style.display = 'block'; };
      img.onerror = () => { loading.textContent = 'Failed to load'; loading.style.color = 'var(--accent-red)'; };
      img.src = 'https://' + hostname + '/screenshot?t=' + Date.now();
    }

    function refreshScreenshot(hostname) {
      const loading = document.querySelector('.screenshot-loading');
      const img = document.querySelector('.screenshot-img');
      if (loading && img) {
        loading.style.display = 'block';
        loading.style.color = '';
        loading.textContent = 'Loading screenshot...';
        img.style.display = 'none';
        loadScreenshot(hostname);
      }
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
      }

      content.innerHTML = html;
      sheet.classList.add('active');
      backdrop.classList.add('active');
    }

    function closeMobileSheet() {
      document.getElementById('mobile-sheet').classList.remove('active');
      document.getElementById('sheet-backdrop').classList.remove('active');
    }

    // Toast
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast active' + (isError ? ' error' : '');
      setTimeout(() => { toast.classList.remove('active'); }, 3000);
    }

    // Init
    loadPreferences();
    loadDevices();
  </script>
</body>
</html>`;
}

function getBootstrapScript() {
  return `#!/bin/bash
#
# H2OS Fleet Setup Script
# Each device gets its own tunnel with:
# - SSH access
# - VNC browser access (/vnc.html)
# - Status endpoint (/status)
#
# Run with: curl -sL https://fleet.aguakmze.ro/setup -o /tmp/setup.sh && sudo bash /tmp/setup.sh
#

set -e

SETUP_URL="https://fleet.aguakmze.ro"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

exec < /dev/tty

echo ""
echo "======================================"
echo "  H2OS Fleet Device Setup"
echo "======================================"
echo ""

# Step 1: Password
echo -n "Setup password: "
read -s PASSWORD
echo ""

VALID=$(curl -s -X POST "$SETUP_URL/validate" \\
  -H "Content-Type: application/json" \\
  -d "{\\"password\\":\\"$PASSWORD\\"}" | grep -o '"valid":true' || true)

if [ -z "$VALID" ]; then
  echo -e "\${RED}✗ Invalid password\${NC}"
  exit 1
fi

echo -e "\${GREEN}✓ Password valid\${NC}"
echo ""

# Step 2: Device name
while true; do
  echo -n "Device name (e.g., genie-52): "
  read DEVICE_NAME

  if ! [[ "$DEVICE_NAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    echo -e "\${RED}✗ Invalid name. Use only letters, numbers, and hyphens.\${NC}"
    continue
  fi

  CHECK_RESULT=$(curl -s -X POST "$SETUP_URL/check" \\
    -H "Content-Type: application/json" \\
    -d "{\\"password\\":\\"$PASSWORD\\",\\"name\\":\\"$DEVICE_NAME\\"}")

  EXISTS=$(echo "$CHECK_RESULT" | grep -o '"exists":true' || true)

  if [ -n "$EXISTS" ]; then
    echo -e "\${YELLOW}⚠ Device '$DEVICE_NAME' already exists\${NC}"
    echo ""
    echo "Options:"
    echo "  1) Reassign $DEVICE_NAME to this device"
    echo "  2) Enter a different name"
    echo ""
    echo -n "Choice [1/2]: "
    read CHOICE

    if [ "$CHOICE" = "1" ]; then
      REASSIGN="true"
      break
    fi
  else
    REASSIGN="false"
    break
  fi
done

echo ""
echo -n "Friendly name (optional): "
read FRIENDLY_NAME
FRIENDLY_NAME=\${FRIENDLY_NAME:-}

echo -n "Location (optional): "
read LOCATION
LOCATION=\${LOCATION:-}

echo ""
echo "Registering device and creating tunnel..."

# Step 3: Register (creates tunnel, returns token)
REGISTER_RESULT=$(curl -s -X POST "$SETUP_URL/register" \\
  -H "Content-Type: application/json" \\
  -d "{\\"password\\":\\"$PASSWORD\\",\\"name\\":\\"$DEVICE_NAME\\",\\"friendlyName\\":\\"$FRIENDLY_NAME\\",\\"location\\":\\"$LOCATION\\",\\"reassign\\":$REASSIGN}")

SUCCESS=$(echo "$REGISTER_RESULT" | grep -o '"success":true' || true)

if [ -z "$SUCCESS" ]; then
  ERROR=$(echo "$REGISTER_RESULT" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || true)
  echo -e "\${RED}✗ Registration failed: $ERROR\${NC}"
  echo "Full response: $REGISTER_RESULT"
  exit 1
fi

# Extract tunnel token
TUNNEL_TOKEN=$(echo "$REGISTER_RESULT" | grep -o '"tunnelToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TUNNEL_TOKEN" ]; then
  echo -e "\${RED}✗ Failed to get tunnel token\${NC}"
  exit 1
fi

echo -e "\${GREEN}✓ Device registered with dedicated tunnel\${NC}"

# Step 4: Install cloudflared
echo ""
echo "Installing cloudflared..."

if ! command -v cloudflared &> /dev/null; then
  ARCH=$(dpkg --print-architecture)
  echo "Detected architecture: $ARCH"

  case "$ARCH" in
    arm64|armhf|amd64)
      # Use our proxy first, fallback to GitHub
      PROXY_URL="$SETUP_URL/download/cloudflared?arch=$ARCH"
      GITHUB_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-\${ARCH}.deb"
      ;;
    *)
      echo -e "\${RED}✗ Unsupported architecture: $ARCH\${NC}"
      exit 1
      ;;
  esac

  rm -f /tmp/cloudflared.deb
  DOWNLOAD_SUCCESS=false

  # Try GitHub directly first (faster)
  echo "Downloading from GitHub..."
  echo "URL: $GITHUB_URL"
  if curl -fSL --connect-timeout 15 --max-time 90 "$GITHUB_URL" -o /tmp/cloudflared.deb 2>&1; then
    if [ -f /tmp/cloudflared.deb ]; then
      FILE_SIZE=$(stat -c%s /tmp/cloudflared.deb 2>/dev/null || stat -f%z /tmp/cloudflared.deb 2>/dev/null)
      if [ "$FILE_SIZE" -gt 1000000 ]; then
        echo "Downloaded: $FILE_SIZE bytes"
        DOWNLOAD_SUCCESS=true
        echo -e "\${GREEN}✓ Downloaded from GitHub\${NC}"
      fi
    fi
  fi

  # Fallback to our proxy if GitHub is blocked/slow
  if [ "$DOWNLOAD_SUCCESS" = "false" ]; then
    echo -e "\${YELLOW}GitHub failed, trying fleet proxy...\${NC}"
    echo "URL: $PROXY_URL"
    rm -f /tmp/cloudflared.deb

    if curl -fSL --connect-timeout 30 --max-time 180 "$PROXY_URL" -o /tmp/cloudflared.deb 2>&1; then
      if [ -f /tmp/cloudflared.deb ]; then
        FILE_SIZE=$(stat -c%s /tmp/cloudflared.deb 2>/dev/null || stat -f%z /tmp/cloudflared.deb 2>/dev/null)
        if [ "$FILE_SIZE" -gt 1000000 ]; then
          echo "Downloaded: $FILE_SIZE bytes"
          DOWNLOAD_SUCCESS=true
          echo -e "\${GREEN}✓ Downloaded via proxy\${NC}"
        fi
      fi
    fi
  fi

  if [ "$DOWNLOAD_SUCCESS" = "false" ]; then
    echo -e "\${RED}✗ Failed to download cloudflared\${NC}"
    echo "Both proxy and GitHub failed. Try manually:"
    echo "  curl -fSL $GITHUB_URL -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb"
    exit 1
  fi

  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
  echo -e "\${GREEN}✓ cloudflared installed\${NC}"
else
  echo -e "\${GREEN}✓ cloudflared already installed\${NC}"
fi

# Step 5: Configure tunnel service
echo "Configuring tunnel service..."

systemctl stop cloudflared 2>/dev/null || true
cloudflared service uninstall 2>/dev/null || true

cloudflared service install "$TUNNEL_TOKEN"

systemctl start cloudflared
systemctl enable cloudflared

echo -e "\${GREEN}✓ Tunnel service running\${NC}"

# Track installation results
VNC_OK=false
STATUS_OK=false

# Step 6: Install VNC (x11vnc + noVNC)
echo ""
echo "Installing VNC support..."

# Note: RealVNC stays on port 5900 (for company use)
# x11vnc runs on port 5901 (for noVNC browser access)

apt-get update --allow-releaseinfo-change -qq 2>/dev/null || true
if apt-get install -y -qq x11vnc novnc python3-websockify 2>/dev/null; then
  echo "  VNC packages installed"
else
  echo -e "\${YELLOW}  ⚠ VNC packages failed to install (apt-get error)\${NC}"
fi

# Create x11vnc service on port 5901 (doesn't conflict with RealVNC on 5900)
cat > /etc/systemd/system/x11vnc.service << 'VNCEOF'
[Unit]
Description=x11vnc VNC Server (for noVNC browser access)
After=display-manager.service

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :0 -forever -shared -nopw -noxdamage -rfbport 5901 -auth guess -rfbversion 3.8
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
VNCEOF

# Create noVNC websocket proxy service (connects to x11vnc on 5901)
cat > /etc/systemd/system/novnc.service << 'NOVNCEOF'
[Unit]
Description=noVNC WebSocket Proxy
After=x11vnc.service

[Service]
Type=simple
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 6080 localhost:5901
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
NOVNCEOF

systemctl daemon-reload
systemctl enable x11vnc novnc 2>/dev/null
systemctl start x11vnc novnc 2>/dev/null

# Check if VNC actually started
if systemctl is-active --quiet x11vnc && systemctl is-active --quiet novnc; then
  VNC_OK=true
  echo -e "\${GREEN}✓ VNC services running\${NC}"
else
  echo -e "\${YELLOW}⚠ VNC services not running (check: systemctl status x11vnc novnc)\${NC}"
fi

# Step 7: Install status endpoint with screenshot support
echo ""
echo "Installing status endpoint with screenshot support..."

# Install screenshot dependencies
if apt-get install -y -qq scrot xdotool imagemagick 2>/dev/null; then
  echo "  Screenshot tools installed"
else
  echo -e "\${YELLOW}  ⚠ Screenshot tools failed (apt-get error)\${NC}"
fi

# Create screenshot wrapper script (handles X11 auth for systemd services)
cat > /opt/take-screenshot.sh << 'SCREOF'
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/pizero/.Xauthority
scrot "\$1"
SCREOF
chmod +x /opt/take-screenshot.sh

cat > /opt/h2os-status.py << 'STATUSEOF'
#!/usr/bin/env python3
"""H2OS Fleet Status - GET /status, /screenshot, /screenshot/terminal, /screenshot/chromium"""
import http.server, json, subprocess, socketserver, os, tempfile

X11_ENV = {'DISPLAY': ':0', 'XAUTHORITY': '/home/pizero/.Xauthority'}

def check_service(name):
    try:
        r = subprocess.run(['systemctl', 'is-active', name], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() == 'active'
    except: return False

def check_process(pattern):
    try:
        r = subprocess.run(['pgrep', '-f', pattern], capture_output=True, timeout=5)
        return r.returncode == 0
    except: return False

def get_uptime():
    try:
        with open('/proc/uptime') as f:
            s = float(f.readline().split()[0])
            d, h = int(s // 86400), int((s % 86400) // 3600)
            return f"{d}d {h}h" if d else f"{h}h"
    except: return "unknown"

def get_window_id(pattern):
    try:
        r = subprocess.run(['xdotool', 'search', '--name', pattern], capture_output=True, text=True, timeout=5, env={**os.environ, **X11_ENV})
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip().split('\\n')[0]
    except: pass
    return None

def take_screenshot(window_id=None):
    try:
        temp_path = tempfile.mktemp(suffix='.png')
        if window_id:
            r = subprocess.run(['import', '-window', window_id, temp_path], capture_output=True, timeout=10, env={**os.environ, **X11_ENV})
        else:
            r = subprocess.run(['/opt/take-screenshot.sh', temp_path], capture_output=True, timeout=10)
        if r.returncode == 0 and os.path.exists(temp_path):
            with open(temp_path, 'rb') as f:
                data = f.read()
            if data:
                os.unlink(temp_path)
                return data
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    except: pass
    return None

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path in ['/', '/status']:
            svcs = {
                'groundwater-genie-manager': check_service('groundwater-genie-manager'),
                'kmzero.sh': check_process('kmzero.sh'),
                'groundwater.sh': check_process('groundwater.sh'),
                'main.py': check_process('main.py')
            }
            running = sum(1 for v in svcs.values() if v)
            status = 'healthy' if running == 4 else 'partial' if running else 'offline'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': status, 'services': svcs, 'running': running, 'total': 4, 'uptime': get_uptime()}).encode())
        elif self.path == '/screenshot':
            data = take_screenshot()
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Failed to take screenshot'}).encode())
        elif self.path == '/screenshot/terminal':
            wid = get_window_id('kmzero') or get_window_id('LXTerminal') or get_window_id('Terminal')
            data = take_screenshot(wid) if wid else take_screenshot()
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
        elif self.path == '/screenshot/chromium':
            wid = get_window_id('Chromium') or get_window_id('Chrome')
            if wid:
                data = take_screenshot(wid)
                if data:
                    self.send_response(200)
                    self.send_header('Content-Type', 'image/png')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    self.wfile.write(data)
                    return
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Chromium not running'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    with ReusableTCPServer(('', 8081), Handler) as h:
        h.serve_forever()
STATUSEOF

chmod +x /opt/h2os-status.py

cat > /etc/systemd/system/h2os-status.service << 'SVCEOF'
[Unit]
Description=H2OS Fleet Status Endpoint
After=network.target

[Service]
Type=simple
User=pizero
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/pizero/.Xauthority
ExecStart=/usr/bin/python3 /opt/h2os-status.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVCEOF

systemctl daemon-reload
systemctl enable h2os-status 2>/dev/null
systemctl start h2os-status 2>/dev/null

# Wait a moment for service to start
sleep 2

# Check if status endpoint actually started
if systemctl is-active --quiet h2os-status; then
  STATUS_OK=true
  echo -e "\${GREEN}✓ Status endpoint running\${NC}"
else
  echo -e "\${YELLOW}⚠ Status endpoint not running\${NC}"
  echo "  Debug: systemctl status h2os-status"
  echo "  Logs:  journalctl -u h2os-status -n 20"
fi

# Final Summary
HOSTNAME="$DEVICE_NAME-fleet.aguakmze.ro"
echo ""
echo "======================================"
echo "  SETUP SUMMARY"
echo "======================================"
echo ""

# Tunnel status (always check live)
if systemctl is-active --quiet cloudflared; then
  echo -e "\${GREEN}✓ Tunnel:    RUNNING\${NC}"
else
  echo -e "\${RED}✗ Tunnel:    NOT RUNNING\${NC}"
fi

# VNC status
if [ "$VNC_OK" = "true" ]; then
  echo -e "\${GREEN}✓ VNC:       RUNNING\${NC}"
else
  echo -e "\${YELLOW}⚠ VNC:       NOT RUNNING\${NC}"
fi

# Status endpoint
if [ "$STATUS_OK" = "true" ]; then
  echo -e "\${GREEN}✓ Status:    RUNNING\${NC}"
else
  echo -e "\${YELLOW}⚠ Status:    NOT RUNNING\${NC}"
fi

echo ""
echo "Device: $HOSTNAME"
echo ""

# Show URLs only for working services
echo "Access:"
echo "  SSH:       ssh -o ProxyCommand=\\"cloudflared access ssh --hostname %h\\" pizero@$HOSTNAME"
if [ "$VNC_OK" = "true" ]; then
  echo "  VNC:       https://$HOSTNAME/vnc.html"
fi
if [ "$STATUS_OK" = "true" ]; then
  echo "  Status:    https://$HOSTNAME/status"
fi
echo "  Dashboard: https://fleet.aguakmze.ro/dashboard"
echo ""

# Show what failed and how to debug
if [ "$VNC_OK" != "true" ] || [ "$STATUS_OK" != "true" ]; then
  echo -e "\${YELLOW}Some services failed. Debug commands:\${NC}"
  if [ "$VNC_OK" != "true" ]; then
    echo "  systemctl status x11vnc novnc"
    echo "  journalctl -u x11vnc -u novnc -n 20"
  fi
  if [ "$STATUS_OK" != "true" ]; then
    echo "  systemctl status h2os-status"
    echo "  journalctl -u h2os-status -n 20"
  fi
  echo ""
fi

echo "SSH config shortcut:"
echo "  Host *-fleet.aguakmze.ro"
echo "      ProxyCommand cloudflared access ssh --hostname %h"
echo "      User pizero"
echo ""
`;
}
