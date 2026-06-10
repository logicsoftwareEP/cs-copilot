#!/usr/bin/env bash
# deploy.sh — Fast build & deploy cs-copilot backend to Azure (zip deploy / run-from-package)
# Builds the package in .deploy-stage/ — never mutates the working tree's node_modules.
set -e

RESOURCE_GROUP="customersuccess"
FUNCTION_APP="cs-copilot-func"

cd "$(dirname "$0")/.."

STAGE=".deploy-stage"

echo "==> Building TypeScript..."
npx tsc

echo "==> Staging production dependencies..."
mkdir -p "$STAGE"
cp package.json package-lock.json "$STAGE/"
# npm ci only when the lockfile changed since the last staged install
if [ ! -f "$STAGE/.lock-hash" ] || ! sha256sum --check --status "$STAGE/.lock-hash" 2>/dev/null; then
  (cd "$STAGE" && npm ci --omit=dev --silent)
  sha256sum package-lock.json > "$STAGE/.lock-hash"
else
  echo "    lockfile unchanged — reusing cached production node_modules"
fi

echo "==> Copying build output..."
rm -rf "$STAGE/dist"
cp -r dist "$STAGE/dist"
cp host.json "$STAGE/"

echo "==> Creating deploy.zip..."
rm -f deploy.zip
# Use `python` (works on Windows via py launcher + Linux/macOS if python3 is symlinked).
# Windows Git Bash's `python3` resolves to a Microsoft Store stub that prints a
# "Python was not found" message and exits without running anything.
PYTHON_BIN="$(command -v python || command -v python3)"
"$PYTHON_BIN" -c "
import zipfile, os
os.chdir('$STAGE')
with zipfile.ZipFile('../deploy.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
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
  --src deploy.zip

echo "==> Deployed!"
