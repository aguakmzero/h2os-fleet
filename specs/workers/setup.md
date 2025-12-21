# Setup Worker Spec

## Purpose

Serves the device bootstrap script that provisions new Raspberry Pi devices into the fleet.

## Route

```
GET /setup → setup-worker
```

## Behavior

### Request
```
GET https://fleet.aguakmze.ro/setup
```

### Response
- Content-Type: `text/plain`
- Body: Bash script

## Script Functionality

The returned bash script:

1. **Prompts for setup password** (`Agua@rmada1`)
2. **Prompts for device ID** (e.g., `genie-52`)
3. **Registers device** via API call to `/api/register`
4. **Installs cloudflared** and configures tunnel
5. **Installs VNC** (x11vnc + noVNC)
6. **Installs status server** (`/opt/h2os-status.py`)
7. **Creates systemd services** for all components
8. **Validates installation** and reports status

## Dependencies

- Calls `api-worker` for device registration
- Uses Cloudflare API for tunnel creation

## Script Constants

```bash
API_BASE="https://fleet.aguakmze.ro"
SETUP_PASSWORD="Agua@rmada1"
SSH_USER="pizero"
SSH_PASSWORD="soloagua1"
```

## Services Installed

| Service | Purpose | Port |
|---------|---------|------|
| cloudflared | Tunnel connection | N/A |
| h2os-status | Status HTTP server | 8081 |
| x11vnc | VNC server | 5901 |
| novnc | WebSocket VNC proxy | 6080 |

## Status Server Details

The script installs `/opt/h2os-status.py` which monitors:

| Service | Type | Check Method |
|---------|------|--------------|
| groundwater-connection | systemd | `systemctl is-active` |
| groundwater-genie-manager | systemd | `systemctl is-active` |
| groundwater-updater | systemd | `systemctl is-active` |
| kmzero.sh | process | `pgrep -f` |
| groundwater.sh | process | `pgrep -f` |
| main.py | process | `pgrep -f` |

## Error Handling

- Invalid password: Exit with error message
- API registration fails: Exit with error, suggest retry
- cloudflared install fails: Try GitHub fallback URL
- Service start fails: Continue, report in summary

## Size Target

~300 lines (bash script generation only)
