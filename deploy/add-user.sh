#!/usr/bin/env bash
set -euo pipefail

# add-user.sh — Add a new user to the multi-user PAI deployment
#
# Usage:
#   ./deploy/add-user.sh <username> [port]
#
# Examples:
#   ./deploy/add-user.sh alice          # auto-assigns next available port
#   ./deploy/add-user.sh bob 3200       # explicit port
#
# This script appends a service definition to docker-compose.multi.yml
# and creates the corresponding named volume for the user's data.

COMPOSE_FILE="docker-compose.multi.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_PATH="$PROJECT_DIR/$COMPOSE_FILE"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  echo "Usage: $0 <username> [port]"
  echo ""
  echo "  username   Alphanumeric name for the user (e.g., alice)"
  echo "  port       Host port to expose (default: auto-assigned from 3142+)"
  echo ""
  echo "Examples:"
  echo "  $0 alice"
  echo "  $0 bob 3200"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

USERNAME="$1"

# Validate username: alphanumeric + hyphens only
if ! [[ "$USERNAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo -e "${RED}Error: Username must be lowercase alphanumeric (with optional hyphens)${NC}"
  exit 1
fi

# Check compose file exists
if [ ! -f "$COMPOSE_PATH" ]; then
  echo -e "${RED}Error: $COMPOSE_FILE not found. Run from the project root.${NC}"
  exit 1
fi

# Check if user already exists
if grep -q "container_name: pai-${USERNAME}" "$COMPOSE_PATH"; then
  echo -e "${YELLOW}User '${USERNAME}' already exists in ${COMPOSE_FILE}${NC}"
  exit 1
fi

# Determine port
if [ $# -ge 2 ]; then
  PORT="$2"
else
  # Find the highest port currently in use and increment
  LAST_PORT=$(grep -oP '"\K\d+(?=:3141")' "$COMPOSE_PATH" 2>/dev/null | sort -n | tail -1)
  if [ -z "$LAST_PORT" ]; then
    PORT=3142
  else
    PORT=$((LAST_PORT + 1))
  fi
fi

# Check port isn't already used in the compose file
if grep -q "\"${PORT}:3141\"" "$COMPOSE_PATH"; then
  echo -e "${RED}Error: Port ${PORT} is already in use in ${COMPOSE_FILE}${NC}"
  exit 1
fi

VOLUME_NAME="pai-${USERNAME}-data"

# Append service definition
cat >> "$COMPOSE_PATH" << EOF

  ${USERNAME}:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: pai-${USERNAME}
    ports:
      - "${PORT}:3141"
    volumes:
      - ${VOLUME_NAME}:/data
    environment:
      - PAI_HOST=0.0.0.0
      - PAI_DATA_DIR=/data
      - PAI_LLM_PROVIDER=\${PAI_LLM_PROVIDER:-ollama}
      - PAI_LLM_BASE_URL=\${PAI_LLM_BASE_URL:-http://ollama:11434}
      - PAI_LLM_MODEL=\${PAI_LLM_MODEL:-}
      - PAI_LLM_API_KEY=\${PAI_LLM_API_KEY:-}
      - PAI_SEARCH_URL=http://searxng:8080
      - PAI_SANDBOX_URL=http://sandbox:8888
      - NODE_ENV=production
    depends_on:
      searxng:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - pai-shared
EOF

# Append volume under the volumes section
# We need to add the volume name before the last line or after existing volumes
if grep -q "^  ${VOLUME_NAME}:" "$COMPOSE_PATH"; then
  : # Volume already declared
else
  # Append volume declaration at the end of the volumes section
  sed -i "/^volumes:/a\\  ${VOLUME_NAME}:" "$COMPOSE_PATH"
fi

echo -e "${GREEN}Added user '${USERNAME}' on port ${PORT}${NC}"
echo ""
echo "  Start:   docker compose -f $COMPOSE_FILE up -d ${USERNAME}"
echo "  Access:  http://localhost:${PORT}"
echo "  Logs:    docker compose -f $COMPOSE_FILE logs -f ${USERNAME}"
echo "  Remove:  Remove the '${USERNAME}:' service block from $COMPOSE_FILE"
echo ""
echo "  To start all users: docker compose -f $COMPOSE_FILE up -d"
