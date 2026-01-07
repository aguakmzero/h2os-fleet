#!/bin/bash
# Deploy dashboard worker with git version injected
set -e

cd "$(dirname "$0")"

# Get git short hash
GIT_HASH=$(git rev-parse --short HEAD)

# Update version in wrangler.toml
sed -i '' "s/VERSION = \"'.*'\"/VERSION = \"'$GIT_HASH'\"/" wrangler.toml

echo "Deploying dashboard with version: $GIT_HASH"

# Deploy (requires CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL env vars)
# Source from fleet/.env: source ../../.env && export CLOUDFLARE_API_KEY=$CLOUDFLARE_GLOBAL_API_KEY
npx wrangler deploy

echo "Done! Version $GIT_HASH deployed."
