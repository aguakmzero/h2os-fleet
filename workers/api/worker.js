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

// Removed durable objects import - using batching instead

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
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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
      if (path === '/api/fleet-summary-image') {
        return handleFleetSummaryImage(request, env, corsHeaders);
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
      if (path === '/api/reboot') {
        return handleReboot(request, env, corsHeaders);
      }
      // Update device name/location
      if (path.startsWith('/api/devices/') && request.method === 'PATCH') {
        const deviceId = path.replace('/api/devices/', '');
        return handleUpdateDevice(request, env, corsHeaders, deviceId);
      }
      // Batch update devices
      if (path === '/api/devices/batch' && request.method === 'POST') {
        return handleBatchUpdateDevices(request, env, corsHeaders);
      }
      // Proxy endpoints for individual device status and screenshots
      if (path.startsWith('/api/device-status/')) {
        const deviceId = path.replace('/api/device-status/', '');
        return handleDeviceStatus(request, env, corsHeaders, deviceId);
      }
      if (path.startsWith('/api/device-screenshot/')) {
        const deviceId = path.replace('/api/device-screenshot/', '');
        return handleDeviceScreenshot(request, env, corsHeaders, deviceId);
      }
      // Deploy key management
      if (path.startsWith('/api/deploy-keys/') && request.method === 'GET') {
        const deviceId = path.replace('/api/deploy-keys/', '');
        return handleCheckDeployKey(request, env, corsHeaders, deviceId);
      }
      if (path === '/api/deploy-keys' && request.method === 'POST') {
        return handleCreateDeployKey(request, env, corsHeaders);
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
  const { password, name, friendlyName, location, vncAccount, reassign } = await request.json();

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
    INSERT INTO devices (device_id, friendly_name, hostname, location, vnc_account, tunnel_id, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      hostname = excluded.hostname,
      location = excluded.location,
      vnc_account = COALESCE(excluded.vnc_account, vnc_account),
      tunnel_id = excluded.tunnel_id,
      last_seen = datetime('now')
  `).bind(name, friendlyName || null, hostname, location || null, vncAccount || null, tunnelId).run();

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

const ADMIN_EMAILS = ['sahil@aguakmzero.com'];

async function handleUpdateDevice(request, env, corsHeaders, deviceId) {
  // Check admin access
  const userEmail = getUserEmail(request);
  if (!ADMIN_EMAILS.includes(userEmail)) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { friendly_name, location, vnc_account } = await request.json();

  // Check device exists
  const device = await env.DB.prepare(
    'SELECT * FROM devices WHERE device_id = ?'
  ).bind(deviceId).first();

  if (!device) {
    return new Response(JSON.stringify({ error: 'Device not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Update only provided fields
  const updates = [];
  const params = [];

  if (friendly_name !== undefined) {
    updates.push('friendly_name = ?');
    params.push(friendly_name || null);
  }
  if (location !== undefined) {
    updates.push('location = ?');
    params.push(location || null);
  }
  if (vnc_account !== undefined) {
    // Validate vnc_account value
    const validValues = [null, '', 'VNC1', 'VNC2'];
    const normalizedValue = vnc_account === '' ? null : vnc_account;
    if (vnc_account && !validValues.includes(vnc_account)) {
      return new Response(JSON.stringify({ error: 'Invalid vnc_account value. Must be VNC1, VNC2, or empty.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    updates.push('vnc_account = ?');
    params.push(normalizedValue);
  }

  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  params.push(deviceId);
  await env.DB.prepare(
    `UPDATE devices SET ${updates.join(', ')} WHERE device_id = ?`
  ).bind(...params).run();

  // Fetch updated device
  const updated = await env.DB.prepare(
    'SELECT * FROM devices WHERE device_id = ?'
  ).bind(deviceId).first();

  return new Response(JSON.stringify({
    success: true,
    device: updated,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleBatchUpdateDevices(request, env, corsHeaders) {
  // Check admin access
  const userEmail = getUserEmail(request);
  if (!ADMIN_EMAILS.includes(userEmail)) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { device_ids, location, vnc_account } = await request.json();

  // Validate input
  if (!device_ids || !Array.isArray(device_ids) || device_ids.length === 0) {
    return new Response(JSON.stringify({ error: 'device_ids array is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Build update query - only location and vnc_account allowed for batch
  const updates = [];
  const baseParams = [];

  if (location !== undefined) {
    updates.push('location = ?');
    baseParams.push(location || null);
  }
  if (vnc_account !== undefined) {
    // Validate vnc_account value
    const validValues = [null, '', 'VNC1', 'VNC2'];
    const normalizedValue = vnc_account === '' ? null : vnc_account;
    if (vnc_account && !validValues.includes(vnc_account)) {
      return new Response(JSON.stringify({ error: 'Invalid vnc_account value. Must be VNC1, VNC2, or empty.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    updates.push('vnc_account = ?');
    baseParams.push(normalizedValue);
  }

  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update. Batch edit supports: location, vnc_account' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Update each device
  const results = [];
  for (const deviceId of device_ids) {
    try {
      const params = [...baseParams, deviceId];
      await env.DB.prepare(
        `UPDATE devices SET ${updates.join(', ')} WHERE device_id = ?`
      ).bind(...params).run();
      results.push({ device_id: deviceId, success: true });
    } catch (err) {
      results.push({ device_id: deviceId, success: false, error: err.message });
    }
  }

  // Fetch updated devices
  const placeholders = device_ids.map(() => '?').join(',');
  const updatedDevices = await env.DB.prepare(
    `SELECT * FROM devices WHERE device_id IN (${placeholders})`
  ).bind(...device_ids).all();

  return new Response(JSON.stringify({
    success: results.every(r => r.success),
    updated_count: results.filter(r => r.success).length,
    results,
    devices: updatedDevices.results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const GITHUB_REPO = 'aguakmzero/h2os-groundwater';

async function handleCheckDeployKey(request, env, corsHeaders, deviceId) {
  const { password } = Object.fromEntries(new URL(request.url).searchParams);

  if (password !== env.SETUP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const keyTitle = `${deviceId} deploy key`;

  try {
    // List all deploy keys from GitHub
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/keys`, {
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'H2OS-Fleet-Setup',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error: `GitHub API error: ${response.status}`, details: error }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const keys = await response.json();
    const existingKey = keys.find(k => k.title === keyTitle);

    return new Response(JSON.stringify({
      exists: !!existingKey,
      key: existingKey ? { id: existingKey.id, title: existingKey.title, created_at: existingKey.created_at } : null,
      deviceId,
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

async function handleCreateDeployKey(request, env, corsHeaders) {
  const { password, deviceId, publicKey, replace } = await request.json();

  if (password !== env.SETUP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!deviceId || !publicKey) {
    return new Response(JSON.stringify({ error: 'deviceId and publicKey are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const keyTitle = `${deviceId} deploy key`;
  const ghHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'H2OS-Fleet-Setup',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // Check if key already exists
    const listResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/keys`, {
      headers: ghHeaders,
    });

    if (!listResponse.ok) {
      const error = await listResponse.text();
      return new Response(JSON.stringify({ error: `GitHub API error: ${listResponse.status}`, details: error }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const keys = await listResponse.json();
    const existingKey = keys.find(k => k.title === keyTitle);

    // If key exists and replace is not true, return error
    if (existingKey && !replace) {
      return new Response(JSON.stringify({
        error: 'Deploy key already exists',
        exists: true,
        key: { id: existingKey.id, title: existingKey.title },
        hint: 'Set replace=true to delete and recreate the key',
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete existing key if replacing
    if (existingKey && replace) {
      const deleteResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/keys/${existingKey.id}`, {
        method: 'DELETE',
        headers: ghHeaders,
      });

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const error = await deleteResponse.text();
        return new Response(JSON.stringify({ error: `Failed to delete existing key: ${deleteResponse.status}`, details: error }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Create new deploy key
    const createResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/keys`, {
      method: 'POST',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: keyTitle,
        key: publicKey.trim(),
        read_only: true,
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      return new Response(JSON.stringify({ error: `Failed to create deploy key: ${createResponse.status}`, details: error }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newKey = await createResponse.json();

    return new Response(JSON.stringify({
      success: true,
      replaced: !!existingKey,
      key: { id: newKey.id, title: newKey.title, created_at: newKey.created_at },
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

async function handleFleetStatus(request, env, corsHeaders) {
  const url = new URL(request.url);
  const filterStatus = url.searchParams.get('status');
  const filterLocation = url.searchParams.get('location');
  const filterDevice = url.searchParams.get('device');

  // Get all devices from the database
  const devices = await env.DB.prepare(`
    SELECT * FROM devices ORDER BY device_id ASC
  `).all();

  // Process devices in batches to avoid hitting the 50 subrequest limit
  const BATCH_SIZE = 40; // Leave some headroom under the 50 limit
  const batches = [];

  for (let i = 0; i < devices.results.length; i += BATCH_SIZE) {
    batches.push(devices.results.slice(i, i + BATCH_SIZE));
  }

  // Process each batch
  const allResults = [];

  for (const batch of batches) {
    const batchPromises = batch.map(async (device) => {
      const startTime = Date.now();
      let lastError = null;

      // Single attempt with 20 second timeout to fit more devices in
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(`https://${device.hostname}/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const status = await res.json();
        const responseTime = Date.now() - startTime;

        return {
          device_id: device.device_id,
          friendly_name: device.friendly_name,
          hostname: device.hostname,
          location: device.location,
          ...status,
          online: true,
          response_time_ms: responseTime,
          attempts: 1
        };
      } catch (err) {
        lastError = err;
        const responseTime = Date.now() - startTime;

        // Better error categorization
        let status = 'offline';
        let error = lastError?.message || 'Connection failed';

        if (err.name === 'AbortError') {
          status = 'timeout';
          error = 'Request timeout (20s)';
        } else if (err.message?.includes('Too many subrequests')) {
          status = 'monitoring_error';
          error = 'Monitoring system limit reached';
        } else if (err.message?.includes('530')) {
          // Cloudflare tunnel errors
          status = 'offline';
          error = 'Device unreachable (HTTP 530)';
        }

        return {
          device_id: device.device_id,
          friendly_name: device.friendly_name,
          hostname: device.hostname,
          location: device.location,
          status: status,
          error: error,
          online: false,
          response_time_ms: responseTime,
          total_attempts: 1
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults);
  }

  // Apply filters
  let results = allResults;
  if (filterStatus) {
    results = results.filter(d => d.status === filterStatus);
  }
  if (filterLocation) {
    results = results.filter(d => d.location && d.location.toLowerCase().includes(filterLocation.toLowerCase()));
  }
  if (filterDevice) {
    results = results.filter(d => d.device_id.includes(filterDevice));
  }

  // Calculate summary
  const summary = {
    total: results.length,
    healthy: results.filter(d => d.status === 'healthy').length,
    partial: results.filter(d => d.status === 'partial').length,
    offline: results.filter(d => d.status === 'offline').length,
    timeout: results.filter(d => d.status === 'timeout').length,
    monitoring_error: results.filter(d => d.status === 'monitoring_error').length,
    avg_response_time_ms: Math.round(
      results
        .filter(d => d.response_time_ms)
        .reduce((acc, d) => acc + d.response_time_ms, 0) / results.length || 0
    ),
  };

  return new Response(JSON.stringify({
    summary,
    devices: results,
    timestamp: new Date().toISOString(),
    batches: batches.length,
    batch_size: BATCH_SIZE
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

async function handleReboot(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const { hostname } = await request.json();
  if (!hostname) {
    return new Response(JSON.stringify({ error: 'hostname required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(`https://${hostname}/reboot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // Device may close connection during reboot, so handle empty response
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : { status: 'rebooting', message: 'Reboot initiated' };
    } catch {
      data = { status: 'rebooting', message: 'Reboot initiated' };
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Connection error likely means device is already rebooting
    if (err.message.includes('fetch') || err.message.includes('network')) {
      return new Response(JSON.stringify({ status: 'rebooting', message: 'Device is rebooting' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_email TEXT PRIMARY KEY,
        pinned_devices TEXT DEFAULT '[]',
        sort_by TEXT DEFAULT 'status',
        sort_order TEXT DEFAULT 'asc',
        auto_refresh_interval INTEGER DEFAULT 0,
        collapsed_locations TEXT DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {
    // Table likely already exists
  }
}

async function handleGetPreferences(request, env, corsHeaders) {
  const userEmail = getUserEmail(request);

  try {
    await ensurePreferencesTable(env);

    const prefs = await env.DB.prepare(
      'SELECT * FROM user_preferences WHERE user_email = ?'
    ).bind(userEmail).first();

    const isAdmin = ADMIN_EMAILS.includes(userEmail);

    if (prefs) {
      return new Response(JSON.stringify({
        userEmail,
        isAdmin,
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
      isAdmin,
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

async function handleFleetSummaryImage(request, env, corsHeaders) {
  try {
    // First get fleet status using the same Durable Objects approach
    const statusResponse = await handleFleetStatus(request, env, corsHeaders);
    const statusData = await statusResponse.json();
    const { summary, devices } = statusData;

    // Group devices by location for better visualization
    const locationGroups = {};
    devices.forEach(device => {
      const loc = device.location || 'Unknown';
      if (!locationGroups[loc]) {
        locationGroups[loc] = {
          healthy: 0,
          partial: 0,
          offline: 0,
          timeout: 0
        };
      }
      locationGroups[loc][device.status]++;
    });

    // Sort locations by total devices
    const sortedLocations = Object.entries(locationGroups)
      .sort((a, b) => {
        const totalA = a[1].healthy + a[1].partial + a[1].offline + a[1].timeout;
        const totalB = b[1].healthy + b[1].partial + b[1].offline + b[1].timeout;
        return totalB - totalA;
      });

    // Create SVG visualization
    const width = 800;
    const height = 600 + (sortedLocations.length * 30);

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: bold 28px Arial; fill: #333; }
        .subtitle { font: 20px Arial; fill: #666; }
        .stat { font: bold 24px Arial; }
        .label { font: 16px Arial; fill: #555; }
        .location { font: 14px Arial; fill: #333; }
        .number { font: bold 14px Arial; }
        .healthy { fill: #22c55e; }
        .partial { fill: #f59e0b; }
        .offline { fill: #ef4444; }
        .timeout { fill: #8b5cf6; }
        .bg { fill: #f3f4f6; }
      </style>

      <rect width="${width}" height="${height}" class="bg"/>

      <!-- Title -->
      <text x="${width/2}" y="40" text-anchor="middle" class="title">H2OS Fleet Status</text>
      <text x="${width/2}" y="70" text-anchor="middle" class="subtitle">${new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })}</text>

      <!-- Summary Stats -->
      <g transform="translate(50, 120)">
        <rect x="0" y="0" width="140" height="80" rx="10" fill="#22c55e" opacity="0.2"/>
        <text x="70" y="35" text-anchor="middle" class="stat healthy">${summary.healthy}</text>
        <text x="70" y="60" text-anchor="middle" class="label">Healthy</text>
      </g>

      <g transform="translate(210, 120)">
        <rect x="0" y="0" width="140" height="80" rx="10" fill="#f59e0b" opacity="0.2"/>
        <text x="70" y="35" text-anchor="middle" class="stat partial">${summary.partial}</text>
        <text x="70" y="60" text-anchor="middle" class="label">Partial</text>
      </g>

      <g transform="translate(370, 120)">
        <rect x="0" y="0" width="140" height="80" rx="10" fill="#ef4444" opacity="0.2"/>
        <text x="70" y="35" text-anchor="middle" class="stat offline">${summary.offline}</text>
        <text x="70" y="60" text-anchor="middle" class="label">Offline</text>
      </g>

      <g transform="translate(530, 120)">
        <rect x="0" y="0" width="140" height="80" rx="10" fill="#8b5cf6" opacity="0.2"/>
        <text x="70" y="35" text-anchor="middle" class="stat timeout">${summary.timeout}</text>
        <text x="70" y="60" text-anchor="middle" class="label">Timeout</text>
      </g>

      <!-- Response Time -->
      <text x="50" y="240" class="label">Average Response Time: ${summary.avg_response_time_ms}ms</text>

      <!-- Location Breakdown -->
      <text x="50" y="280" class="subtitle">By Location:</text>
      ${sortedLocations.map((loc, i) => {
        const [name, stats] = loc;
        const total = stats.healthy + stats.partial + stats.offline + stats.timeout;
        const y = 310 + (i * 30);
        const barWidth = 400;
        const healthyWidth = (stats.healthy / total) * barWidth;
        const partialWidth = (stats.partial / total) * barWidth;
        const offlineWidth = (stats.offline / total) * barWidth;
        const timeoutWidth = (stats.timeout / total) * barWidth;

        return `
          <g transform="translate(50, ${y})">
            <text x="0" y="15" class="location">${name.substring(0, 30)}${name.length > 30 ? '...' : ''}</text>
            <rect x="250" y="0" width="${healthyWidth}" height="20" class="healthy"/>
            <rect x="${250 + healthyWidth}" y="0" width="${partialWidth}" height="20" class="partial"/>
            <rect x="${250 + healthyWidth + partialWidth}" y="0" width="${offlineWidth}" height="20" class="offline"/>
            <rect x="${250 + healthyWidth + partialWidth + offlineWidth}" y="0" width="${timeoutWidth}" height="20" class="timeout"/>
            <text x="660" y="15" class="number">${total}</text>
          </g>
        `;
      }).join('')}

      <!-- Legend -->
      <g transform="translate(50, ${height - 80})">
        <rect x="0" y="0" width="20" height="20" class="healthy"/>
        <text x="25" y="15" class="label">Healthy</text>
        <rect x="100" y="0" width="20" height="20" class="partial"/>
        <text x="125" y="15" class="label">Partial</text>
        <rect x="200" y="0" width="20" height="20" class="offline"/>
        <text x="225" y="15" class="label">Offline</text>
        <rect x="300" y="0" width="20" height="20" class="timeout"/>
        <text x="325" y="15" class="label">Timeout</text>
      </g>
    </svg>`;

    // Convert SVG to base64
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    const dataUri = `data:image/svg+xml;base64,${base64}`;

    return new Response(JSON.stringify({
      image: dataUri,
      summary: summary,
      timestamp: new Date().toISOString()
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

// Proxy handler for individual device status
async function handleDeviceStatus(request, env, corsHeaders, deviceId) {
  try {
    // Get device info from database
    const device = await env.DB.prepare(
      "SELECT hostname FROM devices WHERE device_id = ?"
    ).bind(deviceId).first();

    if (!device) {
      return new Response(JSON.stringify({ error: "Device not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch status from device
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const res = await fetch(`https://${device.hostname}/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status = await res.json();

      return new Response(JSON.stringify({
        device_id: deviceId,
        ...status,
        online: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      clearTimeout(timeoutId);
      return new Response(JSON.stringify({
        device_id: deviceId,
        status: "offline",
        error: err.message,
        online: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Proxy handler for device screenshots
async function handleDeviceScreenshot(request, env, corsHeaders, deviceId) {
  try {
    // Get device info from database
    const device = await env.DB.prepare(
      "SELECT hostname FROM devices WHERE device_id = ?"
    ).bind(deviceId).first();

    if (!device) {
      return new Response("Device not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Fetch screenshot from device
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const res = await fetch(`https://${device.hostname}/screenshot`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Forward the screenshot response
      return new Response(res.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": res.headers.get("Content-Type") || "image/png",
          "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        },
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Return a 1x1 transparent PNG on error
      const emptyPng = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
      return new Response(emptyPng, {
        status: 200, // Return 200 to avoid console errors
        headers: {
          ...corsHeaders,
          "Content-Type": "image/png",
        },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
