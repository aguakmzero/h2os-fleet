/**
 * Setup Worker
 * Serves the device bootstrap script at /setup
 *
 * This is the only thing this worker does - returns the bash script
 * that provisions new Raspberry Pi devices into the fleet.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only handle /setup
    if (url.pathname !== '/setup') {
      return new Response('Not found', { status: 404 });
    }

    return new Response(getBootstrapScript(), {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

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
echo "VNC Account (for remote access billing):"
echo "  1) VNC1"
echo "  2) VNC2"
echo "  3) Skip (set later)"
echo -n "Choice [1/2/3]: "
read VNC_CHOICE
case "$VNC_CHOICE" in
  1) VNC_ACCOUNT="VNC1" ;;
  2) VNC_ACCOUNT="VNC2" ;;
  *) VNC_ACCOUNT="" ;;
esac

echo ""
echo "Registering device and creating tunnel..."

# Step 3: Register (creates tunnel, returns token)
REGISTER_RESULT=$(curl -s -X POST "$SETUP_URL/register" \\
  -H "Content-Type: application/json" \\
  -d "{\\"password\\":\\"$PASSWORD\\",\\"name\\":\\"$DEVICE_NAME\\",\\"friendlyName\\":\\"$FRIENDLY_NAME\\",\\"location\\":\\"$LOCATION\\",\\"vncAccount\\":\\"$VNC_ACCOUNT\\",\\"reassign\\":$REASSIGN}")

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

# Step 6: Setup SSH deploy key for GitHub
echo ""
echo "Setting up SSH deploy key for groundwater repo..."

SSH_DIR="/home/pizero/.ssh"
KEY_NAME="deploy_key_groundwater"
KEY_PATH="$SSH_DIR/$KEY_NAME"
GITHUB_ALIAS="github-groundwater"
SSH_KEY_OK=false

# Ensure SSH directory exists with correct permissions
mkdir -p $SSH_DIR
chown pizero:pizero $SSH_DIR
chmod 700 $SSH_DIR

# Check if deploy key exists on GitHub
GITHUB_KEY_CHECK=$(curl -s "$SETUP_URL/api/deploy-keys/$DEVICE_NAME?password=$PASSWORD")
GITHUB_KEY_EXISTS=$(echo "$GITHUB_KEY_CHECK" | grep -o '"exists":true' || true)

# Check if local key exists
if [ -f "$KEY_PATH" ]; then
  LOCAL_KEY_EXISTS=true
  echo "  Local SSH key exists"
else
  LOCAL_KEY_EXISTS=false
  echo "  No local SSH key found"
fi

# Determine action
NEED_NEW_KEY=false
REPLACE_GITHUB=false

if [ "$LOCAL_KEY_EXISTS" = false ]; then
  NEED_NEW_KEY=true
  if [ -n "$GITHUB_KEY_EXISTS" ]; then
    echo "  GitHub has deploy key but device doesn't - will generate new key and replace on GitHub"
    REPLACE_GITHUB=true
  else
    echo "  No keys anywhere - will generate new key and add to GitHub"
  fi
elif [ -z "$GITHUB_KEY_EXISTS" ]; then
  echo "  Device has key but GitHub doesn't - will add to GitHub"
fi

# Generate new key if needed
if [ "$NEED_NEW_KEY" = true ]; then
  echo "  Generating new SSH key..."
  sudo -u pizero ssh-keygen -t ed25519 -C "$KEY_NAME" -f "$KEY_PATH" -N "" -q
  chown pizero:pizero "$KEY_PATH" "$KEY_PATH.pub"
  chmod 600 "$KEY_PATH"
  chmod 644 "$KEY_PATH.pub"
  echo -e "  \${GREEN}✓ SSH key generated\${NC}"
fi

# Setup SSH config for GitHub alias
SSH_CONFIG="$SSH_DIR/config"
if ! grep -q "Host $GITHUB_ALIAS" "$SSH_CONFIG" 2>/dev/null; then
  cat >> "$SSH_CONFIG" << SSHCONFIGEOF
Host $GITHUB_ALIAS
    Hostname github.com
    User git
    IdentityFile $KEY_PATH
    IdentitiesOnly yes
SSHCONFIGEOF
  chown pizero:pizero "$SSH_CONFIG"
  chmod 600 "$SSH_CONFIG"
  echo "  SSH config updated"
fi

# Add/replace key on GitHub if needed
if [ "$NEED_NEW_KEY" = true ] || [ -z "$GITHUB_KEY_EXISTS" ]; then
  PUBLIC_KEY=$(cat "$KEY_PATH.pub")

  if [ "$REPLACE_GITHUB" = true ]; then
    echo "  Replacing deploy key on GitHub..."
    DEPLOY_RESULT=$(curl -s -X POST "$SETUP_URL/api/deploy-keys" \\
      -H "Content-Type: application/json" \\
      -d "{\\"password\\":\\"$PASSWORD\\",\\"deviceId\\":\\"$DEVICE_NAME\\",\\"publicKey\\":\\"$PUBLIC_KEY\\",\\"replace\\":true}")
  else
    echo "  Adding deploy key to GitHub..."
    DEPLOY_RESULT=$(curl -s -X POST "$SETUP_URL/api/deploy-keys" \\
      -H "Content-Type: application/json" \\
      -d "{\\"password\\":\\"$PASSWORD\\",\\"deviceId\\":\\"$DEVICE_NAME\\",\\"publicKey\\":\\"$PUBLIC_KEY\\",\\"replace\\":false}")
  fi

  DEPLOY_SUCCESS=$(echo "$DEPLOY_RESULT" | grep -o '"success":true' || true)
  if [ -n "$DEPLOY_SUCCESS" ]; then
    SSH_KEY_OK=true
    echo -e "  \${GREEN}✓ Deploy key configured on GitHub\${NC}"
  else
    DEPLOY_ERROR=$(echo "$DEPLOY_RESULT" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || true)
    echo -e "  \${YELLOW}⚠ Failed to configure GitHub deploy key: $DEPLOY_ERROR\${NC}"
  fi
else
  SSH_KEY_OK=true
  echo -e "  \${GREEN}✓ SSH deploy key already configured\${NC}"
fi

# Track installation results
VNC_OK=false
STATUS_OK=false

# Step 7: Install VNC (x11vnc + noVNC)
echo ""
echo "Installing VNC support..."

apt-get update --allow-releaseinfo-change -qq 2>/dev/null || true
if apt-get install -y -qq x11vnc novnc python3-websockify 2>/dev/null; then
  echo "  VNC packages installed"
else
  echo -e "\${YELLOW}  ⚠ VNC packages failed to install (apt-get error)\${NC}"
fi

# Create x11vnc service on port 5901
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

# Create noVNC websocket proxy service
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

if systemctl is-active --quiet x11vnc && systemctl is-active --quiet novnc; then
  VNC_OK=true
  echo -e "\${GREEN}✓ VNC services running\${NC}"
else
  echo -e "\${YELLOW}⚠ VNC services not running (check: systemctl status x11vnc novnc)\${NC}"
fi

# Step 8: Install status endpoint with screenshot support
echo ""
echo "Installing status endpoint with screenshot support..."

if apt-get install -y -qq scrot xdotool imagemagick 2>/dev/null; then
  echo "  Screenshot tools installed"
else
  echo -e "\${YELLOW}  ⚠ Screenshot tools failed (apt-get error)\${NC}"
fi

# Create screenshot wrapper script
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
        with open('/proc/uptime', 'r') as f:
            secs = int(float(f.read().split()[0]))
        days, rem = divmod(secs, 86400)
        hours, rem = divmod(rem, 3600)
        mins = rem // 60
        if days > 0: return f'{days}d {hours}h'
        if hours > 0: return f'{hours}h {mins}m'
        return f'{mins}m'
    except: return 'unknown'

def get_window_id(name):
    try:
        r = subprocess.run(['xdotool', 'search', '--name', name], capture_output=True, text=True, env={**os.environ, **X11_ENV}, timeout=5)
        wids = r.stdout.strip().split('\\n')
        return wids[0] if wids and wids[0] else None
    except: return None

def take_screenshot(wid=None):
    try:
        temp_path = tempfile.mktemp(suffix='.png')
        if wid:
            r = subprocess.run(['import', '-window', wid, temp_path], capture_output=True, env={**os.environ, **X11_ENV}, timeout=10)
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
                'groundwater-connection': check_service('groundwater-connection'),
                'groundwater-genie-manager': check_service('groundwater-genie-manager'),
                'groundwater-updater': check_service('groundwater-updater'),
                'kmzero.sh': check_process('kmzero.sh'),
                'groundwater.sh': check_process('groundwater.sh'),
                'main.py': check_process('main.py')
            }
            running = sum(1 for v in svcs.values() if v)
            status = 'healthy' if running == 6 else 'partial' if running else 'offline'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': status, 'services': svcs, 'running': running, 'total': 6, 'uptime': get_uptime()}).encode())
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

# Create systemd service for status server
cat > /etc/systemd/system/h2os-status.service << 'SERVICEEOF'
[Unit]
Description=H2OS Fleet Status Server
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/h2os-status.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
SERVICEEOF

systemctl daemon-reload
systemctl enable h2os-status
systemctl start h2os-status

if systemctl is-active --quiet h2os-status; then
  STATUS_OK=true
  echo -e "\${GREEN}✓ Status server running on port 8081\${NC}"
else
  echo -e "\${YELLOW}⚠ Status server not running (check: systemctl status h2os-status)\${NC}"
fi

# Summary
HOSTNAME="$DEVICE_NAME-fleet.aguakmze.ro"
echo ""
echo "======================================"
echo "  Setup Complete!"
echo "======================================"
echo ""
echo -e "Device: \${GREEN}$DEVICE_NAME\${NC}"
echo -e "Hostname: \${GREEN}$HOSTNAME\${NC}"
echo ""

if [ "$VNC_OK" = true ]; then
  echo -e "VNC: https://$HOSTNAME/vnc.html"
fi

if [ "$STATUS_OK" = true ]; then
  echo -e "Status: https://$HOSTNAME/status"
fi

if [ "$SSH_KEY_OK" = true ]; then
  echo -e "GitHub Deploy Key: \${GREEN}Configured\${NC}"
else
  echo -e "GitHub Deploy Key: \${YELLOW}Not configured\${NC}"
fi

echo ""
echo "SSH: ssh -o ProxyCommand=\\"cloudflared access ssh --hostname %h\\" pizero@$HOSTNAME"
echo ""

if [ "$VNC_OK" = false ] || [ "$STATUS_OK" = false ] || [ "$SSH_KEY_OK" = false ]; then
  echo -e "\${YELLOW}Some services failed. Debug commands:\${NC}"
  if [ "$VNC_OK" = false ]; then
    echo "  systemctl status x11vnc novnc"
  fi
  if [ "$STATUS_OK" = false ]; then
    echo "  systemctl status h2os-status"
    echo "  journalctl -u h2os-status -n 50"
  fi
  if [ "$SSH_KEY_OK" = false ]; then
    echo "  Check /home/pizero/.ssh/deploy_key_groundwater"
    echo "  Manually add key to GitHub if needed"
  fi
fi
`;
}
