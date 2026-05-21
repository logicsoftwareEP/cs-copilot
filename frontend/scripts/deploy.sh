#!/usr/bin/env bash
# deploy.sh — Build & deploy cs-copilot frontend to Azure Static Web Apps
set -e

DEPLOYMENT_TOKEN="${SWA_DEPLOYMENT_TOKEN:-}"
APP_NAME="cs-copilot-ui"

cd "$(dirname "$0")/.."

if [ -z "$DEPLOYMENT_TOKEN" ]; then
  echo "==> No SWA_DEPLOYMENT_TOKEN set, fetching from Azure..."
  DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name "$APP_NAME" --query "properties.apiKey" -o tsv)
fi

if [ -z "$DEPLOYMENT_TOKEN" ]; then
  echo "ERROR: Could not get deployment token. Set SWA_DEPLOYMENT_TOKEN or login with az." >&2
  exit 1
fi

echo "==> Building frontend..."
npm run build

echo "==> Deploying to Azure Static Web Apps ($APP_NAME)..."
swa deploy dist \
  --deployment-token "$DEPLOYMENT_TOKEN" \
  --env production

echo "==> Deployed!"
