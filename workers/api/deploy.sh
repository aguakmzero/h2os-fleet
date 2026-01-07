#!/bin/bash
# Deploy API worker
# Uses tech@aguakmzero.com Cloudflare account (work/H2OS)
set -e

cd "$(dirname "$0")"

# Load Cloudflare credentials from fleet/.env
if [ -f "../../.env" ]; then
  source ../../.env
  export CLOUDFLARE_API_KEY=$CLOUDFLARE_GLOBAL_API_KEY
  export CLOUDFLARE_EMAIL
else
  echo "Error: ../../.env not found. Need Cloudflare credentials."
  exit 1
fi

echo "Deploying API worker..."
npx wrangler deploy

echo "Done! API deployed."
