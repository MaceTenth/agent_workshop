#!/usr/bin/env zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ── Parse flags ───────────────────────────────────────────────────────────────
SHARE=false
WORKERS=4
PORT=8000

for arg in "$@"; do
  case $arg in
    --share) SHARE=true ;;
    --workers=*) WORKERS="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
  esac
done

# ── 1. Create .venv if it doesn't exist ──────────────────────────────────────
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

# ── 2. Activate ───────────────────────────────────────────────────────────────
source .venv/bin/activate

# ── 3. Install / upgrade requirements ────────────────────────────────────────
echo "Installing requirements..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

# ── 4. Check for .env ─────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo ""
  echo "⚠️  No .env file found. Create one with:"
  echo "    echo 'OPENAI_API_KEY=sk-...' > .env"
  echo "    echo 'OPENAI_MODEL=gpt-4o-mini' >> .env"
  echo ""
fi

# ── 5. Share mode: check for ngrok, start tunnel ─────────────────────────────
if [[ "$SHARE" == "true" ]]; then

  if ! command -v ngrok &>/dev/null; then
    echo ""
    echo "❌  ngrok not found. Install it first:"
    echo "    brew install ngrok/ngrok/ngrok"
    echo "    ngrok config add-authtoken <your-token>  # free at https://ngrok.com"
    echo ""
    exit 1
  fi

  echo ""
  echo "🌐 Share mode — starting ngrok tunnel on port $PORT with $WORKERS workers"
  echo ""

  # Start ngrok in background
  ngrok http "$PORT" > /dev/null 2>&1 &
  NGROK_PID=$!

  # Wait for ngrok API to come up and extract the public URL
  PUBLIC_URL=""
  for i in $(seq 1 20); do
    sleep 0.5
    PUBLIC_URL=$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | python3 -c "
import sys, json
try:
    tunnels = json.load(sys.stdin)['tunnels']
    print(next((t['public_url'] for t in tunnels if t['public_url'].startswith('https')), ''))
except Exception:
    pass
" 2>/dev/null || true)
    [[ -n "$PUBLIC_URL" ]] && break
  done

  if [[ -z "$PUBLIC_URL" ]]; then
    echo "⚠️  Could not detect public URL automatically."
    echo "    Check http://127.0.0.1:4040 in your browser for the ngrok URL."
  else
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  🚀 Share this URL with participants:                ║"
    echo "║  $PUBLIC_URL"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""
    # Copy to clipboard on macOS
    echo "$PUBLIC_URL" | pbcopy 2>/dev/null && echo "   (copied to clipboard)"
    echo ""
    (sleep 1 && open "$PUBLIC_URL") &
  fi

  # Cleanup ngrok on exit
  trap "kill $NGROK_PID 2>/dev/null; echo ''; echo 'Tunnel closed.'" EXIT INT TERM

  echo "Starting server with $WORKERS workers (no --reload in share mode)..."
  echo "Press Ctrl+C to stop everything."
  echo ""
  uvicorn main:app --workers "$WORKERS" --host 127.0.0.1 --port "$PORT"

else
  # ── 6. Local mode ──────────────────────────────────────────────────────────
  (sleep 2 && open "http://127.0.0.1:$PORT") &

  echo ""
  echo "Starting Agent Workshop → http://127.0.0.1:$PORT"
  echo "Tip: run './start.sh --share' to create a public ngrok tunnel."
  echo "Press Ctrl+C to stop."
  echo ""
  uvicorn main:app --reload --host 127.0.0.1 --port "$PORT"
fi

