#!/usr/bin/env python3
"""
H2OS Fleet Status Endpoint
- GET /status - Returns service status as JSON
- GET /screenshot - Full screen screenshot
- GET /screenshot/terminal - Terminal window screenshot
- GET /screenshot/chromium - Chromium window screenshot
"""

import http.server
import json
import subprocess
import socketserver
import os
import tempfile

PORT = 8081

# X11 environment for screenshot commands
X11_ENV = {
    'DISPLAY': ':0',
    'XAUTHORITY': '/home/pizero/.Xauthority'
}

def check_systemd_service(service_name):
    """Check if a systemd service is active"""
    try:
        result = subprocess.run(
            ['systemctl', 'is-active', service_name],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip() == 'active'
    except Exception:
        return False

def check_process(pattern):
    """Check if a process matching pattern is running"""
    try:
        result = subprocess.run(
            ['pgrep', '-f', pattern],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except Exception:
        return False

def get_uptime():
    """Get system uptime"""
    try:
        with open('/proc/uptime', 'r') as f:
            uptime_seconds = float(f.readline().split()[0])
            days = int(uptime_seconds // 86400)
            hours = int((uptime_seconds % 86400) // 3600)
            if days > 0:
                return f"{days}d {hours}h"
            return f"{hours}h"
    except Exception:
        return "unknown"

def get_window_id(pattern):
    """Get window ID matching pattern using wmctrl or xdotool"""
    try:
        # Try xdotool first
        result = subprocess.run(
            ['xdotool', 'search', '--name', pattern],
            capture_output=True,
            text=True,
            timeout=5,
            env={**os.environ, **X11_ENV}
        )
        if result.returncode == 0 and result.stdout.strip():
            # Return first matching window
            return result.stdout.strip().split('\n')[0]
    except Exception:
        pass
    return None

def take_screenshot(window_id=None):
    """Take a screenshot, optionally of a specific window"""
    try:
        # Create temp path but delete file first - scrot won't overwrite
        temp_path = tempfile.mktemp(suffix='.png')

        if window_id:
            # Screenshot specific window using import (ImageMagick)
            env = {**os.environ, **X11_ENV}
            result = subprocess.run(
                ['import', '-window', window_id, temp_path],
                capture_output=True,
                timeout=10,
                env=env
            )
        else:
            # Full screen screenshot using wrapper script
            result = subprocess.run(
                ['/opt/take-screenshot.sh', temp_path],
                capture_output=True,
                timeout=10
            )

        if result.returncode == 0 and os.path.exists(temp_path):
            with open(temp_path, 'rb') as f:
                data = f.read()
            if data:  # Only return if we got actual data
                os.unlink(temp_path)
                return data

        # Debug: log the error
        print(f"Screenshot failed: rc={result.returncode}, stderr={result.stderr}, stdout={result.stdout}", flush=True)
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        return None
    except Exception as e:
        print(f"Screenshot exception: {e}", flush=True)
        return None

class StatusHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress logging

    def do_GET(self):
        if self.path == '/status' or self.path == '/':
            self.handle_status()
        elif self.path == '/screenshot':
            self.handle_screenshot()
        elif self.path == '/screenshot/terminal':
            self.handle_screenshot_terminal()
        elif self.path == '/screenshot/chromium':
            self.handle_screenshot_chromium()
        else:
            self.send_response(404)
            self.end_headers()

    def handle_status(self):
        # Systemd services
        systemd_services = {
            'groundwater-connection': check_systemd_service('groundwater-connection'),
            'groundwater-genie-manager': check_systemd_service('groundwater-genie-manager'),
            'groundwater-updater': check_systemd_service('groundwater-updater'),
        }

        # Process checks
        processes = {
            'kmzero.sh': check_process('kmzero.sh'),
            'groundwater.sh': check_process('groundwater.sh'),
            'main.py': check_process('main.py'),
        }

        all_services = {**systemd_services, **processes}
        running_count = sum(1 for v in all_services.values() if v)
        total_count = len(all_services)

        if running_count == total_count:
            overall = 'healthy'
        elif running_count > 0:
            overall = 'partial'
        else:
            overall = 'offline'

        response = {
            'status': overall,
            'systemd': systemd_services,
            'processes': processes,
            'running': running_count,
            'total': total_count,
            'uptime': get_uptime()
        }

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def handle_screenshot(self):
        """Full screen screenshot"""
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

    def handle_screenshot_terminal(self):
        """Screenshot of terminal window running kmzero.sh"""
        # Find terminal window
        window_id = get_window_id('kmzero')
        if not window_id:
            window_id = get_window_id('LXTerminal')
        if not window_id:
            window_id = get_window_id('Terminal')

        if window_id:
            data = take_screenshot(window_id)
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
                return

        # Fallback to full screenshot if can't find terminal
        self.handle_screenshot()

    def handle_screenshot_chromium(self):
        """Screenshot of Chromium browser window"""
        window_id = get_window_id('Chromium')
        if not window_id:
            window_id = get_window_id('Chrome')

        if window_id:
            data = take_screenshot(window_id)
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
                return

        # Return 404 if no Chromium found
        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'error': 'Chromium not running'}).encode())

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    with ReusableTCPServer(('', PORT), StatusHandler) as httpd:
        print(f"Status server running on port {PORT}")
        httpd.serve_forever()
