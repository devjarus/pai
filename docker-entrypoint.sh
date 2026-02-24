#!/bin/sh
echo "=== PAI Container Starting ==="
echo "Node version: $(node --version)"
echo "Working directory: $(pwd)"
echo "Data dir: ${PAI_DATA_DIR:-/data}"
echo "PORT: ${PORT:-not set}"
echo "Files in /app/packages/server/dist:"
ls -la /app/packages/server/dist/ 2>&1 || echo "dist not found"
echo "Checking /data directory:"
ls -la /data 2>&1 || echo "/data not accessible"
echo "Creating /data if needed..."
mkdir -p "${PAI_DATA_DIR:-/data}" 2>&1
echo "Starting server..."
exec node packages/server/dist/index.js
