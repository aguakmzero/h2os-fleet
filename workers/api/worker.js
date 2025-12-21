/**
 * API Worker
 * Handles all REST API endpoints for fleet management
 *
 * Routes:
 * - /api/validate    - Validate setup password
 * - /api/check       - Check if device exists
 * - /api/register    - Register new device + create tunnel
 * - /api/devices     - List all devices
 * - /api/fleet-status - Get live status with filtering
 * - /api/preferences - Get/save user preferences
 * - /api/cloudflared - Proxy cloudflared downloads
 *
 * Legacy routes (for backwards compatibility):
 * - /validate, /check, /register, /devices
 */

const ACCOUNT_ID = 'b62c683522b0480cb5cf56b57dc6ba77';
const ZONE_ID = 'dc57ebbf78af9984015c7762b4fee21d';
const DOMAIN = 'aguakmze.ro';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // For credentials to work, origin must be specific (not *)
    const origin = request.headers.get('Origin') || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API routes
      if (path === '/api/validate' || path === '/validate') {
        return handleValidate(request, env, corsHeaders);
      }
      if (path === '/api/check' || path === '/check') {
        return handleCheck(request, env, corsHeaders);
      }
      if (path === '/api/register' || path === '/register') {
        return handleRegister(request, env, corsHeaders);
      }
      if (path === '/api/devices' || path === '/devices') {
        if (request.method === 'POST') {
          return handleDevicesPost(request, env, corsHeaders);
        }
        return handleApiDevices(request, env, corsHeaders);
      }
      if (path === '/api/fleet-status') {
        return handleFleetStatus(request, env, corsHeaders);
      }
      if (path === '/api/preferences') {
        if (request.method === 'GET') {
          return handleGetPreferences(request, env, corsHeaders);
        } else if (request.method === 'POST') {
          return handleSavePreferences(request, env, corsHeaders);
        }
        return new Response('Method not allowed', { status: 405 });
      }
      if (path === '/api/cloudflared' || path === '/download/cloudflared') {
        return handleCloudflaredDownload(url, corsHeaders);
      }

      return new Response('Not found', { status: 404 });
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
    tunnelId = existingDevice.tunnel_id;

    const tokenResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
      { headers: cfHeaders }
    );
    const tokenData = await tokenResponse.json();
    tunnelToken = tokenData.result;
  } else {
    // Delete old tunnel if reassigning
    if (existingDevice?.tunnel_id && reassign) {
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${existingDevice.tunnel_id}?cascade=true`,
        { method: 'DELETE', headers: cfHeaders }
      );
    }

    // Check Cloudflare for tunnel with this name
    const listTunnelsResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel?name=${encodeURIComponent(tunnelName)}`,
      { headers: cfHeaders }
    );
    const listData = await listTunnelsResponse.json();

    if (listData.result?.length > 0) {
      for (const tunnel of listData.result) {
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnel.id}?cascade=true`,
          { method: 'DELETE', headers: cfHeaders }
        );
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // Create new tunnel
    const createTunnelResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel`,
      {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({ name: tunnelName, config_src: 'cloudflare' }),
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

    const tokenResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
      { headers: cfHeaders }
    );
    const tokenData = await tokenResponse.json();
    tunnelToken = tokenData.result;
  }

  // Configure tunnel ingress
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
            { hostname, path: '/vnc.html', service: 'http://localhost:6080' },
            { hostname, path: '/vnc_lite.html', service: 'http://localhost:6080' },
            { hostname, path: '/app', service: 'http://localhost:6080' },
            { hostname, path: '/core', service: 'http://localhost:6080' },
            { hostname, path: '/vendor', service: 'http://localhost:6080' },
            { hostname, path: '/websockify', service: 'http://localhost:6080' },
            { hostname, service: 'ssh://localhost:22' },  // SSH as catch-all for cloudflared access
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

  // Create DNS record
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

async function handleDevicesPost(request, env, corsHeaders) {
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

async function handleFleetStatus(request, env, corsHeaders) {
  const url = new URL(request.url);
  const filterStatus = url.searchParams.get('status');
  const filterLocation = url.searchParams.get('location');
  const filterDevice = url.searchParams.get('device');

  const devices = await env.DB.prepare(`
    SELECT * FROM devices ORDER BY device_id ASC
  `).all();

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

  if (filterStatus) {
    results = results.filter(d => d.status === filterStatus);
  }
  if (filterLocation) {
    results = results.filter(d => d.location && d.location.toLowerCase().includes(filterLocation.toLowerCase()));
  }
  if (filterDevice) {
    results = results.filter(d => d.device_id.includes(filterDevice));
  }

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
      headers: { 'User-Agent': 'H2OS-Fleet-Setup/1.0' },
    });

    if (!response.ok) {
      return new Response(`Failed to fetch from GitHub: ${response.status}`, {
        status: 502,
        headers: corsHeaders,
      });
    }

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

function getUserEmail(request) {
  // First try the CF Access header (set when endpoint is protected)
  const headerEmail = request.headers.get('CF-Access-Authenticated-User-Email');
  if (headerEmail) return headerEmail;

  // Try to decode CF Access JWT from cookie (works even when endpoint is public)
  const cookies = request.headers.get('Cookie') || '';
  const cfAuthMatch = cookies.match(/CF_Authorization=([^;]+)/);
  if (cfAuthMatch) {
    try {
      // JWT is base64url encoded: header.payload.signature
      const payload = cfAuthMatch[1].split('.')[1];
      // Convert base64url to base64
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(atob(base64));
      if (decoded.email) return decoded.email;
    } catch (e) {
      // Invalid JWT, fall through to anonymous
    }
  }

  return 'anonymous';
}

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
