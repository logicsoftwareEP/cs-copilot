#!/usr/bin/env bash
# deploy.sh — Fast build & deploy cs-copilot backend to Azure (zip deploy)
set -e

RESOURCE_GROUP="customersuccess"
FUNCTION_APP="cs-copilot-func"

cd "$(dirname "$0")/.."

echo "==> Building TypeScript..."
npx tsc

echo "==> Stripping dev dependencies..."
npm install --omit=dev --silent

echo "==> Creating deploy.zip..."
rm -f deploy.zip
# Use `python` (works on Windows via py launcher + Linux/macOS if python3 is symlinked).
# Windows Git Bash's `python3` resolves to a Microsoft Store stub that prints a
# "Python was not found" message and exits without running anything.
PYTHON_BIN="$(command -v python || command -v python3)"
"$PYTHON_BIN" -c "
import zipfile, os
with zipfile.ZipFile('deploy.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
    for folder in ['dist', 'node_modules']:
        for root, dirs, files in os.walk(folder):
            for f in files:
                zf.write(os.path.join(root, f))
    zf.write('host.json')
    zf.write('package.json')
"

echo "==> Deploying to Azure..."
az functionapp deployment source config-zip \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --src deploy.zip \
  --output none

echo "==> Restoring dev dependencies..."
npm install --silent

echo "==> Deployed!"
