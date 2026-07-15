#!/bin/bash
# Supervisor script: runs Pinchtab (browser automation) and the code execution entrypoint.
# Code execution on :8888 is the deploy-critical process. Pinchtab/Chrome is best-effort
# and is restarted if it dies — otherwise Railway/container deploys fail when Chrome
# cannot start (common without /.dockerenv / --no-sandbox / enough /dev/shm).

set -u

# Generate PinchTab config — relax IDPI domain guard so the sandbox can
# navigate to external sites.  Keep content scanning enabled for safety.
PINCHTAB_CFG="${PINCHTAB_CONFIG:-/tmp/pinchtab-config.json}"
cat > "$PINCHTAB_CFG" <<'PTCFG'
{
  "security": {
    "idpi": {
      "enabled": true,
      "allowedDomains": ["*"],
      "strictMode": false,
      "scanContent": true
    }
  }
}
PTCFG
export PINCHTAB_CONFIG="$PINCHTAB_CFG"

if [ ! -e /.dockerenv ]; then
  echo "WARN: /.dockerenv missing — PinchTab may not enable --no-sandbox; Chrome may fail to start" >&2
fi

start_pinchtab() {
  # PinchTab launches Chrome internally with --no-sandbox when it detects a container
  # (via /.dockerenv) or runs as root. See sandbox/Dockerfile.
  pinchtab &
  PINCHTAB_PID=$!
}

start_pinchtab

# Start code execution server on :8888 (or $PORT)
python3 -u /app/entrypoint.py &
ENTRYPOINT_PID=$!

RESTART_DELAY=2
MAX_RESTART_DELAY=30

# Keep the code server alive. Restart Pinchtab if it exits.
while kill -0 "$ENTRYPOINT_PID" 2>/dev/null; do
  if ! kill -0 "$PINCHTAB_PID" 2>/dev/null; then
    echo "WARN: pinchtab exited; restarting in ${RESTART_DELAY}s" >&2
    sleep "$RESTART_DELAY"
    if [ "$RESTART_DELAY" -lt "$MAX_RESTART_DELAY" ]; then
      RESTART_DELAY=$((RESTART_DELAY * 2))
      if [ "$RESTART_DELAY" -gt "$MAX_RESTART_DELAY" ]; then
        RESTART_DELAY=$MAX_RESTART_DELAY
      fi
    fi
    start_pinchtab
    continue
  fi
  # Reset backoff while pinchtab stays healthy
  RESTART_DELAY=2
  sleep 1
done

echo "ERROR: code execution server exited" >&2
kill "$PINCHTAB_PID" 2>/dev/null || true
wait "$ENTRYPOINT_PID" 2>/dev/null || true
exit 1
