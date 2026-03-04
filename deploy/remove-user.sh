#!/usr/bin/env bash
set -euo pipefail

# remove-user.sh — Remove a user from the multi-user PAI deployment
#
# Usage:
#   ./deploy/remove-user.sh <username>
#
# This stops the user's container, removes their service definition from
# docker-compose.multi.yml, and optionally deletes their data volume.

COMPOSE_FILE="docker-compose.multi.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_PATH="$PROJECT_DIR/$COMPOSE_FILE"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ $# -lt 1 ]; then
  echo "Usage: $0 <username>"
  exit 1
fi

USERNAME="$1"

if [ ! -f "$COMPOSE_PATH" ]; then
  echo -e "${RED}Error: $COMPOSE_FILE not found.${NC}"
  exit 1
fi

if ! grep -q "container_name: pai-${USERNAME}" "$COMPOSE_PATH"; then
  echo -e "${RED}Error: User '${USERNAME}' not found in ${COMPOSE_FILE}${NC}"
  exit 1
fi

# Stop the container if running
echo "Stopping pai-${USERNAME}..."
docker compose -f "$COMPOSE_PATH" stop "$USERNAME" 2>/dev/null || true
docker compose -f "$COMPOSE_PATH" rm -f "$USERNAME" 2>/dev/null || true

# Remove service block (from "  <username>:" to next service or section)
# Use awk to remove the service block
TEMP_FILE=$(mktemp)
awk -v user="  ${USERNAME}:" '
  BEGIN { skip = 0 }
  $0 == user { skip = 1; next }
  skip && /^  [a-z]/ && !/^    / { skip = 0 }
  skip && /^[a-z]/ { skip = 0 }
  skip && /^$/ { next }
  !skip { print }
' "$COMPOSE_PATH" > "$TEMP_FILE"
mv "$TEMP_FILE" "$COMPOSE_PATH"

# Remove volume declaration
VOLUME_NAME="pai-${USERNAME}-data"
sed -i "/^  ${VOLUME_NAME}:/d" "$COMPOSE_PATH"

echo -e "${GREEN}Removed user '${USERNAME}' from ${COMPOSE_FILE}${NC}"
echo ""

# Ask about data volume
echo -e "${YELLOW}The data volume '${VOLUME_NAME}' still exists.${NC}"
echo "To delete it (PERMANENTLY removes all user data):"
echo "  docker volume rm ${VOLUME_NAME}"
