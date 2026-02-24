#!/bin/sh
set -e

echo "=== PAI Container Starting ==="
echo "Node version: $(node --version)"
echo "Working directory: $(pwd)"
echo "Data dir: ${PAI_DATA_DIR:-/data}"
echo "PORT: ${PORT:-not set}"

DATA_DIR="${PAI_DATA_DIR:-/data}"

# Fix volume permissions: Railway volumes may have files owned by root
# from previous deployments that ran as a different user.
if [ "$(id -u)" = "0" ]; then
  echo "Running as root — fixing data directory permissions..."
  mkdir -p "$DATA_DIR"
  chown -R pai:pai "$DATA_DIR" 2>/dev/null || true
  echo "Dropping to pai user..."
  exec su -s /bin/sh pai -c "exec node packages/server/dist/index.js"
else
  echo "Running as $(whoami) (uid=$(id -u))"
  mkdir -p "$DATA_DIR" 2>/dev/null || true
  exec node packages/server/dist/index.js
fi
