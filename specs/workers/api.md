# API Worker Spec

## Purpose

REST API for device management, user preferences, and Cloudflare tunnel operations.

## Routes

```
/api/*          → api-worker
/validate       → api-worker (legacy)
/cloudflared/*  → api-worker (proxy)
```

## Endpoints

### Device Management

#### GET /api/devices
List all registered devices.

**Response:**
```json
{
  "devices": [
    {
      "device_id": "genie-52",
      "friendly_name": "CEM Poble Nou",
      "location": "CEM Poble Nou",
      "hostname": "genie-52-fleet.aguakmze.ro",
      "tunnel_id": "abc123...",
      "last_seen": "2025-12-21T10:00:00Z"
    }
  ]
}
```

#### GET /api/fleet-status
List devices with optional filtering.

**Query Parameters:**
- `location` - Filter by location (partial match)
- `device` - Filter by device ID
- `status` - Filter by status (healthy/partial/offline)

**Response:**
```json
{
  "summary": {
    "total": 14,
    "healthy": 11,
    "partial": 1,
    "offline": 2
  },
  "devices": [...]
}
```

#### POST /api/register
Register a new device.

**Request:**
```json
{
  "device_id": "genie-52",
  "password": "Agua@rmada1"
}
```

**Response:**
```json
{
  "success": true,
  "tunnel_token": "eyJ...",
  "hostname": "genie-52-fleet.aguakmze.ro"
}
```

**Side Effects:**
- Creates Cloudflare tunnel
- Creates DNS record
- Stores device in D1

#### POST /api/reassign
Reassign device to new tunnel (for recovery).

**Request:**
```json
{
  "device_id": "genie-52",
  "password": "Agua@rmada1"
}
```

### User Preferences

#### GET /api/preferences
Get current user's preferences.

**User Identification (in order):**
1. `CF-Access-Authenticated-User-Email` header (when endpoint is CF Access protected)
2. `CF_Authorization` cookie JWT decode (when user authenticated via dashboard)
3. Falls back to `anonymous`

**Response:**
```json
{
  "pinnedDevices": ["genie-1", "genie-52"],
  "sortBy": "status",
  "sortOrder": "asc",
  "autoRefreshInterval": 60,
  "collapsedLocations": []
}
```

#### POST /api/preferences
Save user preferences.

**Request:** Same format as GET response

**Note:** Dashboard sends `credentials: 'include'` to pass cookies for user identification.

### Utility (Legacy Routes - Bypass CF Access)

#### POST /validate
Validate setup password.

**Request:**
```json
{"password": "Agua@rmada1"}
```

**Response:**
```json
{"valid": true}
```

#### POST /check
Check if device already exists.

**Request:**
```json
{"password": "...", "name": "genie-52"}
```

**Response:**
```json
{"exists": true}
```

#### GET /download/cloudflared
Proxy cloudflared binary download (for devices behind firewalls).

**Query:** `?arch=arm64` (arm64, armhf, or amd64)

## Database Operations

Uses D1 database `h2os-fleet-db`:

- `devices` - Device registry
- `user_preferences` - Per-user dashboard settings

## Cloudflare API Operations

- Create tunnel: `POST /accounts/{account}/tunnels`
- Delete tunnel: `DELETE /accounts/{account}/tunnels/{id}?cascade=true`
- Create DNS: `POST /zones/{zone}/dns_records`
- Delete DNS: `DELETE /zones/{zone}/dns_records/{id}`

## Authentication

- Dashboard/API endpoints: CF Access (Google auth)
- Registration: Password in request body
- Cloudflare API: Global API Key + Email

## Error Handling

All errors return JSON:
```json
{
  "error": "Error message",
  "details": "Optional details"
}
```

## Size Target

~400 lines
