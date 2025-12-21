# Device Status Server Spec

## Purpose

HTTP server running on each Pi that exposes device health, service status, and screenshots.

## Location

Installed at `/opt/h2os-status.py` by the setup script.

## Service

```
[Unit]
Description=H2OS Status Server
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/h2os-status.py
Restart=always

[Install]
WantedBy=default.target
```

## Port

`8081` (routed via Cloudflare tunnel)

## Endpoints

### GET / or GET /status

Returns device health status.

**Response:**
```json
{
  "status": "healthy",
  "services": {
    "groundwater-connection": true,
    "groundwater-genie-manager": true,
    "groundwater-updater": true,
    "kmzero.sh": true,
    "groundwater.sh": true,
    "main.py": true
  },
  "running": 6,
  "total": 6,
  "uptime": "17d 5h"
}
```

**Status values:**
- `healthy`: All 6 services running
- `partial`: Some services running (1-5)
- `offline`: No services running (0)

### GET /screenshot

Returns full-screen PNG screenshot.

**Response:**
- Content-Type: `image/png`
- Body: PNG image data

**Implementation:**
Uses `/opt/take-screenshot.sh` which handles X11 auth for systemd context.

### GET /screenshot/terminal

Returns screenshot of terminal window only.

**Response:** Same as `/screenshot`

**Implementation:**
Uses `xdotool` to find terminal window, then `scrot -u` for focused window.

### GET /screenshot/chromium

Returns screenshot of Chromium/Chrome window.

**Response:**
- 200 + PNG if browser found
- 404 if browser not running

## Service Checks

### Systemd Services

Checked via `systemctl is-active --quiet {service}`:

| Service | Purpose |
|---------|---------|
| groundwater-connection | H2OS connection manager |
| groundwater-genie-manager | Main H2OS application |
| groundwater-updater | OTA update service |

### Process Checks

Checked via `pgrep -f {pattern}`:

| Process | Pattern |
|---------|---------|
| kmzero.sh | `kmzero.sh` |
| groundwater.sh | `groundwater.sh` |
| main.py | `main.py` |

## Uptime

Reads from `/proc/uptime`, formats as:
- `Xd Yh` (days + hours)
- `Xh Ym` (hours + minutes if < 1 day)
- `Xm` (minutes if < 1 hour)

## Screenshot Script

`/opt/take-screenshot.sh`:

```bash
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/pizero/.Xauthority

if [ -n "$1" ]; then
  # Window ID provided
  import -window "$1" "$2"
else
  # Full screen
  scrot "$1"
fi
```

## Dependencies

- Python 3 (standard library only)
- scrot (screenshots)
- xdotool (window management)
- imagemagick (import command)

## CORS

All responses include:
```
Access-Control-Allow-Origin: *
```

## Error Handling

- Screenshot fails: Returns 500 with JSON error
- Service check fails: Marks service as stopped
- Timeout: 8 second timeout on dashboard side
