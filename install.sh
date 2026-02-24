#!/usr/bin/env bash
set -euo pipefail

# Personal AI — Quick Install Script
# Requires: Docker and Docker Compose

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "  Personal AI — Quick Installer"
echo "  =============================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Error: Docker is not installed.${NC}"
  echo "Install Docker from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &> /dev/null 2>&1; then
  echo -e "${RED}Error: Docker daemon is not running.${NC}"
  echo "Start Docker and try again."
  exit 1
fi

# Check Docker Compose
if ! docker compose version &> /dev/null 2>&1; then
  echo -e "${RED}Error: Docker Compose is not available.${NC}"
  echo "Install Docker Compose: https://docs.docker.com/compose/install/"
  exit 1
fi

echo -e "${GREEN}✓${NC} Docker is running"
echo -e "${GREEN}✓${NC} Docker Compose is available"
echo ""

# Choose LLM mode
echo "How do you want to run your LLM?"
echo ""
echo "  1) Local with Ollama (default, private, no API key needed)"
echo "  2) Cloud provider (OpenAI, Anthropic, Google, etc.)"
echo ""
read -rp "Choose [1/2]: " LLM_CHOICE
LLM_CHOICE="${LLM_CHOICE:-1}"

COMPOSE_PROFILES=""
EXTRA_ENV=""

if [ "$LLM_CHOICE" = "2" ]; then
  echo ""
  echo "Which provider?"
  echo "  1) OpenAI"
  echo "  2) Anthropic"
  echo "  3) Google AI"
  echo "  4) Other (OpenAI-compatible)"
  echo ""
  read -rp "Choose [1/2/3/4]: " PROVIDER_CHOICE

  case "$PROVIDER_CHOICE" in
    1)
      PROVIDER="openai"
      BASE_URL="https://api.openai.com/v1"
      MODEL="gpt-4o"
      ;;
    2)
      PROVIDER="anthropic"
      BASE_URL="https://api.anthropic.com"
      MODEL="claude-sonnet-4-20250514"
      ;;
    3)
      PROVIDER="google"
      BASE_URL="https://generativelanguage.googleapis.com/v1beta"
      MODEL="gemini-2.0-flash"
      ;;
    *)
      PROVIDER="openai"
      read -rp "Base URL: " BASE_URL
      read -rp "Model name: " MODEL
      ;;
  esac

  read -rp "API key: " API_KEY
  echo ""

  EXTRA_ENV="PAI_LLM_PROVIDER=$PROVIDER PAI_LLM_BASE_URL=$BASE_URL PAI_LLM_MODEL=$MODEL PAI_LLM_API_KEY=$API_KEY"
  echo -e "${GREEN}✓${NC} Using $PROVIDER ($MODEL)"
else
  COMPOSE_PROFILES="--profile local"
  echo -e "${GREEN}✓${NC} Using local Ollama"
fi

echo ""

# Set up data directory
DATA_DIR="${PAI_DATA_DIR:-$HOME/.personal-ai/data}"
mkdir -p "$DATA_DIR"
echo -e "${GREEN}✓${NC} Data directory: $DATA_DIR"

# Download docker-compose.yml if not present
INSTALL_DIR="${HOME}/.personal-ai"
mkdir -p "$INSTALL_DIR"

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  echo "Downloading docker-compose.yml..."
  REPO_URL="https://raw.githubusercontent.com/devjarus/personal-ai/main/docker-compose.yml"
  if curl -fsSL "$REPO_URL" -o "$INSTALL_DIR/docker-compose.yml" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Downloaded docker-compose.yml"
  else
    echo -e "${YELLOW}Could not download from GitHub. Using local copy...${NC}"
    if [ -f "docker-compose.yml" ]; then
      cp docker-compose.yml "$INSTALL_DIR/docker-compose.yml"
    else
      echo -e "${RED}Error: No docker-compose.yml found.${NC}"
      exit 1
    fi
  fi
else
  echo -e "${GREEN}✓${NC} docker-compose.yml already exists"
fi

# Save Docker env vars for container restarts
# (After first run, use the Settings page at http://localhost:3141 to change config)
touch "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"
cat > "$INSTALL_DIR/.env" <<EOF
PAI_HOST_DATA_DIR=$DATA_DIR
PAI_LLM_PROVIDER=${PROVIDER:-ollama}
PAI_LLM_BASE_URL=${BASE_URL:-http://ollama:11434}
PAI_LLM_MODEL=${MODEL:-}
PAI_LLM_API_KEY=${API_KEY:-}
EOF
echo -e "${GREEN}✓${NC} Docker env saved to $INSTALL_DIR/.env"

echo ""
echo "Starting Personal AI..."
echo ""

# Pull and start
cd "$INSTALL_DIR"
docker compose $COMPOSE_PROFILES pull
docker compose $COMPOSE_PROFILES up -d

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Personal AI is running!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "  Web UI:  http://localhost:3141"
echo "  Data:    $DATA_DIR"
echo ""
echo "  Stop:    cd $INSTALL_DIR && docker compose down"
echo "  Logs:    cd $INSTALL_DIR && docker compose logs -f"
echo "  Update:  cd $INSTALL_DIR && docker compose pull && docker compose up -d"
echo ""
