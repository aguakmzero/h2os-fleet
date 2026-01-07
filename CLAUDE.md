# H2OS Fleet Management

Fleet management infrastructure for H2OS Raspberry Pi devices. Provides remote access (SSH, VNC, screenshots) and status monitoring via Cloudflare Tunnels.

## Development Process

**IMPORTANT: Follow spec-driven development.**

### 1. Research → Decision → Spec → Build → Document

Before making changes:
1. **Research**: Understand the problem, check existing patterns
2. **Decision**: Document why you're choosing an approach in `specs/decisions/`
3. **Spec**: Write/update spec in `specs/` BEFORE coding
4. **Build**: Implement according to spec
5. **Document**: Update CLAUDE.md and README if needed

### 2. Specs Location

```
specs/
├── architecture.md      # Overall system architecture
├── workers/
│   ├── setup.md         # Setup worker spec
│   ├── api.md           # API worker spec
│   └── dashboard.md     # Dashboard worker spec
├── device/
│   └── status-server.md # Pi status server spec
└── decisions/           # Architecture decision records
```

### 3. Versioning

- **Git tags**: Use semver tags (v1.0.0, v1.1.0, etc.) for releases
- **Worker version**: Each worker shows its version in responses/UI
- **Version format**: Git short hash for dev, tag for releases

### 4. Deployment Workflow

```bash
# 1. Make changes in feature branch
git checkout -b feature/my-change

# 2. Update relevant spec
# 3. Implement changes
# 4. Test locally: npx wrangler dev --remote

# 5. Commit with clear message
git commit -m "feat: description of change"

# 6. Deploy to production
npx wrangler deploy

# 7. Merge to main and push
git checkout main && git merge feature/my-change && git push
```

### 5. Local Development

```bash
cd ~/Sites/h2os/fleet/workers/<worker-name>
CLOUDFLARE_API_KEY=<key> CLOUDFLARE_EMAIL=tech@aguakmzero.com npx wrangler dev --remote
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge                               │
│  ┌────────────────────────────────────┐                             │
│  │ fleet.aguakmze.ro                  │                             │
│  │                                    │                             │
│  │  /dashboard    → dashboard-worker  │  ┌────────────────────────┐ │
│  │  /api/*        → api-worker        │  │ DEVICE-fleet.aguakmze.ro│ │
│  │  /setup        → setup-worker      │  │   (Per-device tunnel)  │ │
│  │                                    │  │   /status → :8081      │ │
│  │  All share: D1 database, CF Access │  │   /screenshot → :8081  │ │
│  └────────────────────────────────────┘  │   /vnc.html → :6080    │ │
│                                          │   SSH → :22            │ │
│                                          └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────┐   ┌──────────┐
              │ genie-1  │   │ genie-52 │   │ genie-XX │
              │ (Pi Zero)│   │ (Pi Zero)│   │ (Pi Zero)│
              └──────────┘   └──────────┘   └──────────┘
```

## Key Components

### 1. Cloudflare Workers (`workers/`)

Three separate workers, each focused on one concern:

| Worker | Route | Purpose |
|--------|-------|---------|
| `setup-worker` | `/setup` | Bootstrap script for new devices |
| `api-worker` | `/api/*` | REST API, D1 database operations |
| `dashboard-worker` | `/dashboard` | Web UI for fleet management |

All workers share:
- Same D1 database (`h2os-fleet-db`)
- Same Cloudflare Access authentication
- Same domain (`fleet.aguakmze.ro`)

### 2. Pi Status Server (`scripts/pi-status-server.py`)
HTTP server running on each Pi (port 8081):
- `GET /status` - JSON with service status, uptime
- `GET /screenshot` - Full screen PNG
- `GET /screenshot/terminal` - Terminal window screenshot
- `GET /screenshot/chromium` - Browser window screenshot

### 3. Per-Device Cloudflare Tunnel
Each device gets its own tunnel with path-based routing:
- `/status`, `/screenshot/*` → localhost:8081 (status server)
- `/vnc.*` → localhost:6080 (noVNC)
- Default → localhost:22 (SSH)

## URLs

| URL | Purpose |
|-----|---------|
| `fleet.aguakmze.ro/dashboard` | Fleet dashboard |
| `fleet.aguakmze.ro/setup` | Bootstrap script |
| `DEVICE-fleet.aguakmze.ro/status` | Device status JSON |
| `DEVICE-fleet.aguakmze.ro/screenshot` | Device screenshot |
| `DEVICE-fleet.aguakmze.ro/vnc.html` | Browser VNC |

## Commands

### Setup New Device
```bash
curl -sL https://fleet.aguakmze.ro/setup -o /tmp/setup.sh && sudo bash /tmp/setup.sh
# Password: Agua@rmada1
```

### SSH to Device
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" pizero@DEVICE-fleet.aguakmze.ro
# Password: soloagua1
```

### Check Device Status
```bash
curl -s https://DEVICE-fleet.aguakmze.ro/status | jq .
```

### Take Screenshot
```bash
curl -s https://DEVICE-fleet.aguakmze.ro/screenshot -o screenshot.png
```

## Deployment

### Worker Deployment

**Use the deploy scripts** (they auto-load credentials from `.env`):
```bash
# Deploy dashboard
./workers/dashboard/deploy.sh

# Deploy API
./workers/api/deploy.sh
```

**Manual deployment** (if needed):
```bash
source .env
CLOUDFLARE_API_KEY=$CLOUDFLARE_GLOBAL_API_KEY CLOUDFLARE_EMAIL=tech@aguakmzero.com npx wrangler deploy
```

**Credentials**: Stored in `/Users/sahil/Sites/h2os/fleet/.env`
- `CLOUDFLARE_GLOBAL_API_KEY` - Global API key for tech@aguakmzero.com
- `CLOUDFLARE_EMAIL` - tech@aguakmzero.com

**IMPORTANT**: Use `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`, NOT `CLOUDFLARE_API_TOKEN`!

### Cloudflare Resources
- **Account ID**: `b62c683522b0480cb5cf56b57dc6ba77`
- **Zone ID**: `dc57ebbf78af9984015c7762b4fee21d`
- **Domain**: `aguakmze.ro`
- **D1 Database**: `h2os-fleet-db`

## Status Response Format

```json
{
  "status": "healthy|partial|offline",
  "systemd": {
    "groundwater-connection": true,
    "groundwater-genie-manager": true,
    "groundwater-updater": true
  },
  "processes": {
    "kmzero.sh": true,
    "groundwater.sh": true,
    "main.py": true
  },
  "running": 6,
  "total": 6,
  "uptime": "17d 1h"
}
```

## Services on Each Pi

| Service | Type | Purpose |
|---------|------|---------|
| cloudflared | systemd | Tunnel connection |
| h2os-status | systemd | Status endpoint (port 8081) |
| x11vnc | systemd | VNC server (port 5901) |
| novnc | systemd | WebSocket proxy (port 6080) |
| groundwater-genie-manager | systemd | H2OS application |
| groundwater-connection | systemd | H2OS connection |
| groundwater-updater | systemd | H2OS updater |

## Credentials

| Credential | Value | Used For |
|------------|-------|----------|
| Setup password | `Agua@rmada1` | Bootstrap script |
| SSH password | `soloagua1` | Device SSH (user: pizero) |
| Cloudflare Email | `tech@aguakmzero.com` | API auth |
| Cloudflare Global API Key | See Cosmo .env | API auth |

## Troubleshooting

### Device showing 502
1. Check if h2os-status service is running: `systemctl status h2os-status`
2. Check permissions: `sudo chmod 755 /opt/h2os-status.py`
3. Restart service: `sudo systemctl restart h2os-status`

### Cyclic dependency error
Use `WantedBy=default.target` not `multi-user.target` in service file.

### Screenshot fails
1. Ensure scrot, xdotool, imagemagick are installed
2. Check /opt/take-screenshot.sh exists and is executable
3. Verify DISPLAY=:0 and XAUTHORITY=/home/pizero/.Xauthority

### SSH connection slow/timeout
Normal - Pi Zeros are slow. Use shorter commands or check device connectivity.

## Current Fleet

| Device | Location | Status |
|--------|----------|--------|
| genie-dev-new | Barcelona Office | Test device |
| genie-1 | Barcelona Office | Production |
| genie-27 | Field | Production |
| genie-32 | Field | Production |
| genie-33 | Field | Production |
| genie-47 | Field | Production |
| genie-52 | CEM Poble Nou | Production |
