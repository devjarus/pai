#!/usr/bin/env bash
set -euo pipefail

# Personal AI — Quick Install Script
# Supports Docker and from-source (local) installation

REPO="https://github.com/devjarus/pai.git"
INSTALL_DIR="${PAI_INSTALL_DIR:-$HOME/.personal-ai}"
REPO_DIR="$INSTALL_DIR/pai"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ──────────────────────────────────────────────────────────

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
need() { echo -e "  ${RED}✗ $1 is required but not installed.${NC}"; echo "    $2"; exit 1; }

# ── LLM Provider ─────────────────────────────────────────────────────

ask_llm_provider() {
  echo ""
  echo "How do you want to run your LLM?"
  echo ""
  echo "  1) Local with Ollama (default, private, no API key needed)"
  echo "  2) Cloud provider (OpenAI, Anthropic, Google, etc.)"
  echo ""
  read -rp "Choose [1/2]: " LLM_CHOICE
  LLM_CHOICE="${LLM_CHOICE:-1}"

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
    ok "Using $PROVIDER ($MODEL)"
  else
    PROVIDER="ollama"
    BASE_URL=""
    MODEL=""
    API_KEY=""
    ok "Using local Ollama"
  fi
}

# ── Clone / Update ───────────────────────────────────────────────────

clone_or_update() {
  mkdir -p "$INSTALL_DIR"

  if [ -d "$REPO_DIR/.git" ]; then
    echo ""
    echo "Updating repository..."
    git -C "$REPO_DIR" pull --ff-only 2>/dev/null || {
      warn "Could not fast-forward; using existing checkout"
    }
    ok "Repository updated"
  else
    echo ""
    echo "Cloning repository..."
    git clone "$REPO" "$REPO_DIR"
    ok "Repository cloned to $REPO_DIR"
  fi
}

# ── Write config.json (for local installs) ───────────────────────────

write_config_json() {
  local config_file="$INSTALL_DIR/config.json"
  local ollama_url="http://127.0.0.1:11434"

  cat > "$config_file" <<EOF
{
  "dataDir": "$INSTALL_DIR/data",
  "llm": {
    "provider": "${PROVIDER}",
    "baseUrl": "${BASE_URL:-$ollama_url}",
    "model": "${MODEL:-}",
    "apiKey": "${API_KEY:-}"
  }
}
EOF
  chmod 600 "$config_file"
  ok "Config written to $config_file"
}

# ── Docker Install ───────────────────────────────────────────────────

install_docker() {
  echo ""
  echo -e "${BOLD}Installing with Docker...${NC}"
  echo ""

  # Check Docker
  command -v docker &>/dev/null || need "Docker" "Install from https://docs.docker.com/get-docker/"
  docker info &>/dev/null 2>&1  || { err "Docker daemon is not running. Start Docker and try again."; exit 1; }
  docker compose version &>/dev/null 2>&1 || need "Docker Compose" "Install from https://docs.docker.com/compose/install/"

  ok "Docker is running"
  ok "Docker Compose is available"

  ask_llm_provider

  # Ask about code sandbox
  echo ""
  echo "Enable code execution sandbox? (Python/Node for charts and analysis)"
  echo ""
  echo "  1) No (default — lighter setup)"
  echo "  2) Yes (adds ~200MB container for chart generation)"
  echo ""
  read -rp "Choose [1/2]: " SANDBOX_CHOICE
  SANDBOX_CHOICE="${SANDBOX_CHOICE:-1}"

  clone_or_update

  # Write .env for docker compose
  local data_dir="$INSTALL_DIR/data"
  mkdir -p "$data_dir"

  local docker_base_url="${BASE_URL}"
  local compose_profiles=""

  if [ "$PROVIDER" = "ollama" ]; then
    docker_base_url="http://ollama:11434"
    compose_profiles="--profile local"
  fi

  if [ "$SANDBOX_CHOICE" = "2" ]; then
    compose_profiles="$compose_profiles --profile sandbox"
  fi

  cat > "$REPO_DIR/.env" <<EOF
PAI_HOST_DATA_DIR=$data_dir
PAI_LLM_PROVIDER=$PROVIDER
PAI_LLM_BASE_URL=${docker_base_url}
PAI_LLM_MODEL=${MODEL:-}
PAI_LLM_API_KEY=${API_KEY:-}
EOF

  if [ "$SANDBOX_CHOICE" = "2" ]; then
    echo "PAI_SANDBOX_URL=http://sandbox:8888" >> "$REPO_DIR/.env"
  fi

  chmod 600 "$REPO_DIR/.env"
  ok "Docker env saved"

  echo ""
  echo "Building and starting containers..."
  echo ""
  cd "$REPO_DIR"
  # shellcheck disable=SC2086
  docker compose $compose_profiles up -d --build

  echo ""
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Personal AI is running!${NC}"
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo ""
  echo "  Web UI:  http://localhost:3141"
  echo "  Search:  SearXNG (self-hosted, no API key needed)"
  if [ "$SANDBOX_CHOICE" = "2" ]; then
    echo "  Sandbox: Code execution enabled (Python + Node)"
  fi
  if [ "$PROVIDER" = "ollama" ]; then
    echo "  LLM:     Ollama (local inference)"
  fi
  echo "  Data:    $data_dir"
  echo ""
  echo "  Stop:    cd $REPO_DIR && docker compose down"
  echo "  Logs:    cd $REPO_DIR && docker compose logs -f"
  echo "  Update:  cd $REPO_DIR && git pull && docker compose up -d --build"
  echo ""
}

# ── Local (from source) Install ──────────────────────────────────────

install_local() {
  echo ""
  echo -e "${BOLD}Installing from source...${NC}"
  echo ""

  # Check git
  command -v git &>/dev/null || need "git" "Install from https://git-scm.com/"
  ok "git is available"

  # Check Node.js >= 20
  if ! command -v node &>/dev/null; then
    need "Node.js (v20+)" "Install from https://nodejs.org/"
  fi
  local node_major
  node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$node_major" -lt 20 ]; then
    err "Node.js v20+ is required (found v$(node -v | sed 's/^v//'))"
    echo "    Update from https://nodejs.org/"
    exit 1
  fi
  ok "Node.js $(node -v) is available"

  # Check pnpm
  if ! command -v pnpm &>/dev/null; then
    echo ""
    warn "pnpm is not installed."
    echo ""
    echo "    Install it with:  corepack enable && corepack prepare pnpm@latest --activate"
    echo "    Or visit:         https://pnpm.io/installation"
    echo ""
    read -rp "  Try running 'corepack enable' now? [Y/n]: " ENABLE_COREPACK
    ENABLE_COREPACK="${ENABLE_COREPACK:-Y}"
    if [[ "$ENABLE_COREPACK" =~ ^[Yy] ]]; then
      corepack enable
      if command -v pnpm &>/dev/null; then
        ok "pnpm enabled via corepack"
      else
        err "pnpm still not available after corepack enable."
        echo "    Try: corepack prepare pnpm@latest --activate"
        exit 1
      fi
    else
      exit 1
    fi
  else
    ok "pnpm is available"
  fi

  ask_llm_provider
  clone_or_update

  # Install dependencies and build
  echo ""
  echo "Installing dependencies..."
  cd "$REPO_DIR"
  pnpm install
  ok "Dependencies installed"

  echo ""
  echo "Building..."
  pnpm build
  ok "Build complete"

  # Write config
  write_config_json

  # Ollama check
  if [ "$PROVIDER" = "ollama" ]; then
    echo ""
    if command -v ollama &>/dev/null; then
      ok "Ollama is installed"
    else
      warn "Ollama is not installed."
      echo "    Install from: https://ollama.com/download"
      echo "    The server will start but LLM calls will fail until Ollama is running."
    fi
  fi

  # Start server
  echo ""
  echo "Starting server..."
  cd "$REPO_DIR"
  pnpm start

  echo ""
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Personal AI is running!${NC}"
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo ""
  echo "  Web UI:  http://localhost:3141"
  echo "  Data:    $INSTALL_DIR/data"
  echo "  Config:  $INSTALL_DIR/config.json"
  echo ""
  echo "  Stop:    cd $REPO_DIR && pnpm stop"
  echo "  Update:  cd $REPO_DIR && git pull && pnpm install && pnpm build && pnpm start"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────

echo ""
echo -e "  ${BLUE}${BOLD}Personal AI — Quick Installer${NC}"
echo "  =============================="
echo ""
echo "How do you want to install?"
echo ""
echo "  1) Docker (recommended — runs in containers)"
echo "  2) Local  (from source — Node.js + pnpm, no Docker needed)"
echo ""
read -rp "Choose [1/2]: " INSTALL_METHOD
INSTALL_METHOD="${INSTALL_METHOD:-1}"

case "$INSTALL_METHOD" in
  2) install_local ;;
  *) install_docker ;;
esac
