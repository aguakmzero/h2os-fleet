# H2OS Fleet

Remote management infrastructure for H2OS Raspberry Pi groundwater monitoring devices.

## Features

- **Dashboard**: Web UI showing all devices, status, and quick actions
- **Remote Access**: SSH and VNC through Cloudflare Tunnels
- **Status Monitoring**: Real-time service health checks
- **Screenshots**: Capture device displays remotely
- **Auto Setup**: One-command bootstrap for new devices

## Quick Start

### Setup New Device
```bash
curl -sL https://fleet.aguakmze.ro/setup -o /tmp/setup.sh && sudo bash /tmp/setup.sh
```

### Access Dashboard
https://fleet.aguakmze.ro/dashboard

### SSH to Device
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" pizero@DEVICE-fleet.aguakmze.ro
```

## Structure

```
├── worker/           # Cloudflare Worker (dashboard, API, setup script)
│   ├── worker.js     # Main worker code
│   └── wrangler.toml # Deployment config
├── scripts/          # Pi-side scripts
│   └── pi-status-server.py  # Status endpoint reference
└── CLAUDE.md         # Full documentation
```

## Documentation

See [CLAUDE.md](CLAUDE.md) for complete documentation including:
- Architecture overview
- All endpoints and commands
- Deployment instructions
- Troubleshooting guide
