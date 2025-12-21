# H2OS Fleet Architecture

## Overview

H2OS Fleet is a management system for Raspberry Pi devices running groundwater monitoring software. It provides:
- Remote access (SSH, VNC, screenshots)
- Status monitoring
- Device provisioning

## System Components

### 1. Cloudflare Workers (Edge)

Three workers handle different concerns:

```
fleet.aguakmze.ro/
├── /setup         → setup-worker    (Device provisioning)
├── /api/*         → api-worker      (REST API)
└── /dashboard     → dashboard-worker (Web UI)
```

### 2. Per-Device Tunnels

Each device has its own Cloudflare Tunnel:
- Hostname: `{device-id}-fleet.aguakmze.ro`
- Routes traffic to local services on the Pi

### 3. Pi Status Server

Python HTTP server on each Pi (port 8081):
- Exposes device health, service status, screenshots
- See `specs/device/status-server.md`

## Data Flow

### Device Setup Flow
```
1. User runs: curl https://fleet.aguakmze.ro/setup | bash
2. setup-worker returns bash script
3. Script prompts for password, device ID
4. Script calls api-worker to register device
5. api-worker creates CF tunnel, stores in D1
6. Script installs tunnel, VNC, status server
```

### Status Check Flow
```
1. dashboard-worker loads, fetches /api/devices
2. api-worker queries D1, returns device list
3. Dashboard JS fetches each device's /status endpoint
4. Device tunnel routes to Pi's status server (port 8081)
5. Dashboard displays aggregated status
```

### VNC Flow
```
1. User clicks VNC button on dashboard
2. Browser navigates to {device}-fleet.aguakmze.ro/vnc.html
3. Device tunnel routes to noVNC (port 6080)
4. noVNC connects to x11vnc (port 5901)
```

## Shared Resources

All workers share:

| Resource | ID/Name | Purpose |
|----------|---------|---------|
| D1 Database | `h2os-fleet-db` | Device registry, preferences |
| CF Access | N/A | Authentication |
| Zone | `aguakmze.ro` | DNS routing |
| Account | `b62c683522b0480cb5cf56b57dc6ba77` | CF account |

## Database Schema

### `devices` table
```sql
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  friendly_name TEXT,
  location TEXT,
  hostname TEXT,
  tunnel_id TEXT,
  tailscale_ip TEXT,
  last_seen DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `user_preferences` table
```sql
CREATE TABLE user_preferences (
  user_email TEXT PRIMARY KEY,
  pinned_devices TEXT DEFAULT '[]',
  sort_by TEXT DEFAULT 'status',
  sort_order TEXT DEFAULT 'asc',
  auto_refresh_interval INTEGER DEFAULT 0,
  collapsed_locations TEXT DEFAULT '[]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security

- **CF Access**: Protects dashboard and API (requires Agua KMZero Google auth)
- **Setup Password**: Protects device provisioning (`Agua@rmada1`)
- **SSH Password**: Device access (`soloagua1`, user: `pizero`)
- **Tunnels**: Each device has isolated tunnel credentials

## Deployment

Workers are deployed via Wrangler:
```bash
cd ~/Sites/h2os/fleet
npx wrangler deploy
```

Uses Cloudflare Global API Key (not tokens) for full tunnel management access.
