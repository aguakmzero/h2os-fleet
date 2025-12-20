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
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${existingDevice.tunnel_id}`,
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
      // Found existing tunnel(s) with this name - delete them
      for (const tunnel of listData.result) {
        console.log(`Deleting existing tunnel: ${tunnel.id} (${tunnel.name})`);
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnel.id}`,
          { method: 'DELETE', headers: cfHeaders }
        );
      }
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
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* Header */
    .header {
      background: linear-gradient(180deg, #0f172a 0%, var(--bg-dark) 100%);
      border-bottom: 1px solid var(--border);
      padding: 1.5rem 2rem;
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(12px);
    }
    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-blue) 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
    }
    .logo-text h1 {
      font-size: 1.25rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-cyan) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .logo-text p {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: -2px;
    }
    .header-actions {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .device-count {
      background: var(--border);
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .device-count span {
      color: var(--accent-cyan);
      font-weight: 600;
    }
    .btn-refresh {
      background: var(--border);
      border: 1px solid var(--border-light);
      color: var(--text-secondary);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.8rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }
    .btn-refresh:hover {
      background: var(--border-light);
      color: var(--text-primary);
    }
    .btn-refresh.loading svg {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Main Content */
    .main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    /* Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.25rem;
    }

    /* Cards */
    .card {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 1.5rem;
      position: relative;
      border: 1px solid var(--border);
      transition: all 0.3s ease;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-cyan), var(--accent-blue));
      opacity: 0;
      transition: opacity 0.3s;
    }
    .card:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-light);
      transform: translateY(-2px);
      box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.4);
    }
    .card:hover::before {
      opacity: 1;
    }

    /* Card Header */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .card-title-group {
      flex: 1;
      min-width: 0;
    }
    .card-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.125rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-subtitle {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }

    /* Status Badge */
    .status-badge {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 20px;
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      background: var(--border);
      color: var(--text-muted);
    }
    .status-badge .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: pulse-subtle 2s ease-in-out infinite;
    }
    .status-badge.online {
      background: rgba(16, 185, 129, 0.15);
      color: var(--accent-green);
    }
    .status-badge.online .dot {
      background: var(--accent-green);
      box-shadow: 0 0 8px var(--accent-green);
      animation: none;
    }
    .status-badge.partial {
      background: rgba(245, 158, 11, 0.15);
      color: var(--accent-amber);
    }
    .status-badge.partial .dot {
      background: var(--accent-amber);
      box-shadow: 0 0 8px var(--accent-amber);
      animation: pulse-amber 1.5s ease-in-out infinite;
    }
    .status-badge.offline {
      background: rgba(239, 68, 68, 0.15);
      color: var(--accent-red);
    }
    .status-badge.offline .dot {
      background: var(--accent-red);
      box-shadow: 0 0 8px var(--accent-red);
      animation: none;
    }
    .status-badge.checking {
      background: rgba(14, 165, 233, 0.15);
      color: var(--accent-blue);
    }
    .status-badge.checking .dot {
      background: var(--accent-blue);
      animation: pulse-blue 1s ease-in-out infinite;
    }
    @keyframes pulse-subtle {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
    @keyframes pulse-amber {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.1); }
    }
    @keyframes pulse-blue {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }

    /* Location Tag */
    .location-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.625rem;
      background: var(--border);
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }
    .location-tag svg {
      width: 12px;
      height: 12px;
      opacity: 0.7;
    }

    /* Services Section */
    .services {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 10px;
      padding: 0.875rem;
      margin-bottom: 1rem;
    }
    .services-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.625rem;
    }
    .services-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .services-count {
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .services-count span {
      color: var(--accent-green);
    }
    .services-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.375rem;
    }
    .service-item {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      color: var(--text-secondary);
      padding: 0.25rem 0;
    }
    .service-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
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
      font-size: 0.75rem;
      font-style: italic;
      text-align: center;
      padding: 0.5rem 0;
    }

    /* Buttons */
    .buttons {
      display: flex;
      gap: 0.625rem;
    }
    .btn {
      flex: 1;
      padding: 0.625rem 1rem;
      border: none;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
    }
    .btn svg {
      width: 14px;
      height: 14px;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-cyan) 100%);
      color: white;
    }
    .btn-primary:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: var(--border);
      border: 1px solid var(--border-light);
      color: var(--text-secondary);
    }
    .btn-secondary:hover {
      background: var(--border-light);
      color: var(--text-primary);
    }

    /* Card Footer */
    .card-footer {
      margin-top: 0.875rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .last-seen {
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .ssh-hint {
      font-size: 0.65rem;
      color: var(--text-muted);
      font-family: 'SF Mono', Monaco, monospace;
      opacity: 0.7;
    }

    /* Loading State */
    .loading {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
    }
    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent-cyan);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }

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
    .empty-state h3 {
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }
    .empty-state p {
      color: var(--text-muted);
      font-size: 0.875rem;
    }

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
    .modal.active {
      display: flex;
    }
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
    .modal-title-group h2 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }
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
    .modal-close:hover {
      background: var(--border-light);
      color: var(--text-primary);
    }
    .modal-section {
      margin-bottom: 1.25rem;
    }
    .modal-section-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .info-grid {
      display: grid;
      gap: 0.625rem;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      font-size: 0.8rem;
    }
    .info-label {
      color: var(--text-muted);
    }
    .info-value {
      color: var(--text-secondary);
      text-align: right;
      max-width: 60%;
      word-break: break-all;
    }
    .info-value.mono {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.7rem;
    }
    .ssh-command {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      padding: 0.75rem;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.7rem;
      color: var(--accent-cyan);
      word-break: break-all;
      line-height: 1.6;
    }
    .modal-actions {
      display: flex;
      gap: 0.625rem;
      margin-top: 1.25rem;
    }

    /* Screenshot styles */
    .screenshot-container {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      padding: 0.5rem;
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .screenshot-loading {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    .screenshot-img {
      max-width: 100%;
      max-height: 60vh;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-content">
      <div class="logo">
        <div class="logo-icon">💧</div>
        <div class="logo-text">
          <h1>H2OS Fleet</h1>
          <p>Groundwater Monitoring</p>
        </div>
      </div>
      <div class="header-actions">
        <div class="device-count"><span id="device-count">0</span> devices</div>
        <button class="btn-refresh" onclick="refreshDevices()" id="refresh-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>
    </div>
  </header>

  <main class="main">
    <div class="grid" id="devices-grid">
      <div class="loading">
        <div class="loading-spinner"></div>
        <p>Loading devices...</p>
      </div>
    </div>
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

  <script>
    const SERVICES = ['groundwater-genie-manager', 'kmzero.sh', 'groundwater.sh', 'main.py'];
    let devices = [];
    let isRefreshing = false;

    async function loadDevices() {
      try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        devices = data.devices;
        document.getElementById('device-count').textContent = devices.length;
        renderDevices();
        checkAllStatus();
      } catch (err) {
        document.getElementById('devices-grid').innerHTML =
          '<div class="loading"><p>Error loading devices</p></div>';
      }
    }

    async function checkAllStatus() {
      for (const device of devices) {
        checkDeviceStatus(device);
      }
    }

    async function checkDeviceStatus(device) {
      const badge = document.getElementById('status-' + device.device_id);
      const servicesDiv = document.getElementById('services-' + device.device_id);
      if (!badge) return;

      badge.className = 'status-badge checking';
      badge.querySelector('.status-text').textContent = 'Checking';

      try {
        const res = await fetch('https://' + device.hostname + '/status', { timeout: 10000 });
        const data = await res.json();

        badge.className = 'status-badge ' + (data.status === 'healthy' ? 'online' : data.status === 'partial' ? 'partial' : 'offline');
        badge.querySelector('.status-text').textContent = data.status === 'healthy' ? 'Online' : data.status === 'partial' ? 'Partial' : 'Offline';

        // Handle both response formats: {services: {...}} or {systemd: {...}, processes: {...}}
        const services = data.services || {...(data.systemd || {}), ...(data.processes || {})};

        servicesDiv.innerHTML = \`
          <div class="services-header">
            <span class="services-title">Services</span>
            <span class="services-count"><span>\${data.running}</span>/\${data.total} running</span>
          </div>
          <div class="services-list">
            \${Object.entries(services).map(([name, running]) => \`
              <div class="service-item">
                <span class="service-dot \${running ? 'running' : 'stopped'}"></span>
                <span class="service-name">\${name.replace('.sh', '').replace('.py', '')}</span>
              </div>
            \`).join('')}
          </div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.5rem">Uptime: \${data.uptime}</div>
        \`;
      } catch (err) {
        badge.className = 'status-badge offline';
        badge.querySelector('.status-text').textContent = 'Offline';
        servicesDiv.innerHTML = \`
          <div class="services-header"><span class="services-title">Services</span></div>
          <div class="services-placeholder" style="color:var(--accent-red)">Unable to connect</div>
        \`;
      }
    }

    async function refreshDevices() {
      if (isRefreshing) return;
      isRefreshing = true;
      const btn = document.getElementById('refresh-btn');
      btn.classList.add('loading');
      await loadDevices();
      btn.classList.remove('loading');
      isRefreshing = false;
    }

    function renderDevices() {
      const grid = document.getElementById('devices-grid');
      if (!devices.length) {
        grid.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">📡</div>
            <h3>No devices registered</h3>
            <p>Run the setup script on a Raspberry Pi to add it to the fleet.</p>
          </div>\`;
        return;
      }

      grid.innerHTML = devices.map(device => {
        const displayName = device.friendly_name || device.device_id;
        const subtitle = device.friendly_name ? device.device_id : '';

        return \`
        <div class="card" data-device-id="\${device.device_id}">
          <div class="card-header">
            <div class="card-title-group">
              <div class="card-title">\${displayName}</div>
              \${subtitle ? \`<div class="card-subtitle">\${subtitle}</div>\` : ''}
            </div>
            <div class="status-badge" id="status-\${device.device_id}">
              <span class="dot"></span>
              <span class="status-text">Unknown</span>
            </div>
          </div>

          \${device.location ? \`
          <div class="location-tag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            \${device.location}
          </div>\` : ''}

          <div class="services" id="services-\${device.device_id}">
            <div class="services-header">
              <span class="services-title">Services</span>
            </div>
            <div class="services-placeholder">Waiting for status check...</div>
          </div>

          <div class="buttons">
            <button class="btn btn-secondary" onclick="showDetails('\${device.device_id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
              </svg>
              Details
            </button>
            <button class="btn btn-secondary" onclick="showScreenshot('\${device.hostname}', '\${device.friendly_name || device.device_id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
              </svg>
              Screenshot
            </button>
            <a class="btn btn-primary" href="https://\${device.hostname}/vnc.html" target="_blank">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
              </svg>
              VNC
            </a>
          </div>

          <div class="card-footer">
            <span class="last-seen">Last seen: \${device.last_seen ? formatTime(device.last_seen) : 'Never'}</span>
            <span class="ssh-hint">\${device.hostname}</span>
          </div>
        </div>\`;
      }).join('');
    }

    function formatTime(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return \`\${diffMins}m ago\`;
      if (diffHours < 24) return \`\${diffHours}h ago\`;
      if (diffDays < 7) return \`\${diffDays}d ago\`;
      return date.toLocaleDateString();
    }

    function showDetails(deviceId) {
      const device = devices.find(d => d.device_id === deviceId);
      if (!device) return;

      const displayName = device.friendly_name || device.device_id;
      document.getElementById('modal-title').textContent = displayName;
      document.getElementById('modal-subtitle').textContent = device.device_id;

      document.getElementById('modal-body').innerHTML = \`
        <div class="modal-section">
          <div class="modal-section-title">Device Info</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Location</span>
              <span class="info-value">\${device.location || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">SSH Hostname</span>
              <span class="info-value mono">\${device.hostname}</span>
            </div>
            <div class="info-item">
              <span class="info-label">VNC</span>
              <span class="info-value mono">\${device.hostname}/vnc.html</span>
            </div>
            <div class="info-item">
              <span class="info-label">Status</span>
              <span class="info-value mono">\${device.hostname}/status</span>
            </div>
            <div class="info-item">
              <span class="info-label">Tunnel ID</span>
              <span class="info-value mono">\${device.tunnel_id || '-'}</span>
            </div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Timestamps</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Last Seen</span>
              <span class="info-value">\${device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Last Checked</span>
              <span class="info-value">\${device.last_checked ? new Date(device.last_checked).toLocaleString() : 'Never'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Created</span>
              <span class="info-value">\${device.created_at ? new Date(device.created_at).toLocaleString() : '-'}</span>
            </div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">SSH Command</div>
          <div class="ssh-command">ssh -o ProxyCommand="cloudflared access ssh --hostname %h" pizero@\${device.hostname}</div>
        </div>

        <div class="modal-actions">
          <a class="btn btn-primary" href="https://\${device.device_id}-vnc.aguakmze.ro" target="_blank" style="flex:1">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            Open VNC
          </a>
        </div>\`;

      document.getElementById('modal').classList.add('active');
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

    async function showScreenshot(hostname, deviceName) {
      document.getElementById('modal-title').textContent = deviceName + ' - Screenshot';
      document.getElementById('modal-subtitle').textContent = hostname;
      document.getElementById('modal-body').innerHTML = \`
        <div class="screenshot-container">
          <div class="screenshot-loading">Loading screenshot...</div>
          <img class="screenshot-img" style="display:none" />
        </div>
        <div class="modal-actions" style="margin-top:1rem">
          <button class="btn btn-secondary" onclick="refreshScreenshot('\${hostname}')" style="flex:1">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh
          </button>
          <a class="btn btn-primary" href="https://\${hostname}/screenshot" target="_blank" style="flex:1">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </a>
        </div>
      \`;
      document.getElementById('modal').classList.add('active');
      loadScreenshot(hostname);
    }

    async function loadScreenshot(hostname) {
      const container = document.querySelector('.screenshot-container');
      const loading = container.querySelector('.screenshot-loading');
      const img = container.querySelector('.screenshot-img');

      try {
        const timestamp = Date.now();
        img.onload = () => {
          loading.style.display = 'none';
          img.style.display = 'block';
        };
        img.onerror = () => {
          loading.textContent = 'Failed to load screenshot';
          loading.style.color = 'var(--accent-red)';
        };
        img.src = 'https://' + hostname + '/screenshot?t=' + timestamp;
      } catch (err) {
        loading.textContent = 'Error loading screenshot';
        loading.style.color = 'var(--accent-red)';
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
        loadScreenshot(hostname);
      }
    }

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

# Step 6: Install VNC (x11vnc + noVNC)
echo ""
echo "Installing VNC support..."

# Note: RealVNC stays on port 5900 (for company use)
# x11vnc runs on port 5901 (for noVNC browser access)

apt-get update --allow-releaseinfo-change -qq
apt-get install -y -qq x11vnc novnc python3-websockify > /dev/null 2>&1

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
systemctl enable x11vnc novnc
systemctl start x11vnc novnc

echo -e "\${GREEN}✓ VNC services installed and running\${NC}"

# Step 7: Install status endpoint with screenshot support
echo ""
echo "Installing status endpoint with screenshot support..."

# Install screenshot dependencies
apt-get install -y -qq scrot xdotool imagemagick > /dev/null 2>&1

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
systemctl enable h2os-status
systemctl start h2os-status

echo -e "\${GREEN}✓ Status endpoint with screenshot support installed\${NC}"

# Done
HOSTNAME="$DEVICE_NAME-fleet.aguakmze.ro"
echo ""
echo "======================================"
echo -e "\${GREEN}  Setup Complete!\${NC}"
echo "======================================"
echo ""
echo "Device hostname: $HOSTNAME"
echo ""
echo "SSH access:"
echo "  ssh -o ProxyCommand=\\"cloudflared access ssh --hostname %h\\" pizero@$HOSTNAME"
echo ""
echo "VNC access (browser):"
echo "  https://$HOSTNAME/vnc.html"
echo ""
echo "Status endpoint:"
echo "  https://$HOSTNAME/status"
echo ""
echo "Dashboard:"
echo "  https://fleet.aguakmze.ro/dashboard"
echo ""
echo "Add to ~/.ssh/config for easier access:"
echo "  Host *-fleet.aguakmze.ro"
echo "      ProxyCommand cloudflared access ssh --hostname %h"
echo "      User pizero"
echo ""
`;
}
