#!/bin/bash
#
# Deploy all fleet workers to Cloudflare
#
# Usage: ./deploy.sh [worker]
#   ./deploy.sh         - Deploy all workers
#   ./deploy.sh api     - Deploy only api worker
#   ./deploy.sh setup   - Deploy only setup worker
#   ./deploy.sh dashboard - Deploy only dashboard worker
#

set -e

cd "$(dirname "$0")"

# Check for credentials
if [ -z "$CLOUDFLARE_API_KEY" ] || [ -z "$CLOUDFLARE_EMAIL" ]; then
  echo "Error: Set CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL environment variables"
  echo ""
  echo "Example:"
  echo "  CLOUDFLARE_API_KEY=<key> CLOUDFLARE_EMAIL=tech@aguakmzero.com ./deploy.sh"
  exit 1
fi

export CLOUDFLARE_API_KEY
export CLOUDFLARE_EMAIL

deploy_worker() {
  local name=$1
  echo "=========================================="
  echo "Deploying $name worker..."
  echo "=========================================="
  cd "workers/$name"
  npx wrangler deploy
  cd ../..
  echo ""
}

if [ -n "$1" ]; then
  # Deploy specific worker
  deploy_worker "$1"
else
  # Deploy all workers
  deploy_worker "api"
  deploy_worker "setup"
  deploy_worker "dashboard"

  echo "=========================================="
  echo "All workers deployed!"
  echo "=========================================="
  echo ""
  echo "URLs:"
  echo "  Dashboard: https://fleet.aguakmze.ro/dashboard"
  echo "  Setup:     https://fleet.aguakmze.ro/setup"
  echo "  API:       https://fleet.aguakmze.ro/api/*"
fi
