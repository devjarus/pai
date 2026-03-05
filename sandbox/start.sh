#!/bin/bash
# Supervisor script: runs both Pinchtab (browser automation) and the code execution entrypoint.
# Exits if either process dies.

set -e

# Launch Chromium with --no-sandbox (required in containers that drop capabilities).
# The container itself is sandboxed (cap_drop: ALL, no-new-privileges, non-root user).
chromium \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  &
CHROME_PID=$!

# Wait for Chrome DevTools Protocol to be ready
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Start Pinchtab connected to the pre-launched Chrome instance
CDP_URL="ws://127.0.0.1:9222" pinchtab &
PINCHTAB_PID=$!

# Start code execution server on :8888
python3 -u /app/entrypoint.py &
ENTRYPOINT_PID=$!

# Wait for any process to exit
wait -n

# If we get here, one process died — kill the others and exit
kill $CHROME_PID $PINCHTAB_PID $ENTRYPOINT_PID 2>/dev/null || true
exit 1
