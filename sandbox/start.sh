#!/bin/bash
# Supervisor script: runs both Pinchtab (browser automation) and the code execution entrypoint.
# Exits if either process dies.

set -e

# Launch Chromium with --no-sandbox (required in containers that drop capabilities).
# The container itself is sandboxed (cap_drop: ALL, no-new-privileges, non-root user).
chromium \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-software-rasterizer \
  --disable-extensions \
  --disable-background-networking \
  --no-first-run \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  about:blank \
  2>/dev/null &
CHROME_PID=$!

# Wait for Chrome DevTools Protocol to be ready
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Get the browser-specific WebSocket URL (required by chromedp's remote allocator).
# Just ws://host:port won't work — Pinchtab needs the full /devtools/browser/{id} path.
CDP_WS=$(curl -sf http://127.0.0.1:9222/json/version | grep -o '"webSocketDebuggerUrl":"[^"]*"' | cut -d'"' -f4)
if [ -z "$CDP_WS" ]; then
  echo "ERROR: Could not get webSocketDebuggerUrl from Chrome" >&2
  exit 1
fi

# Start Pinchtab connected to the pre-launched Chrome instance
CDP_URL="$CDP_WS" pinchtab &
PINCHTAB_PID=$!

# Start code execution server on :8888
python3 -u /app/entrypoint.py &
ENTRYPOINT_PID=$!

# Wait for any process to exit
wait -n

# If we get here, one process died — kill the others and exit
kill $CHROME_PID $PINCHTAB_PID $ENTRYPOINT_PID 2>/dev/null || true
exit 1
