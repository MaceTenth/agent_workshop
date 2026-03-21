#!/usr/bin/env zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

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

# ── 5. Open browser after a short delay ──────────────────────────────────────
(sleep 2 && open "http://127.0.0.1:8000") &

# ── 6. Start the server ───────────────────────────────────────────────────────
echo ""
echo "Starting Agent Workshop → http://127.0.0.1:8000"
echo "Press Ctrl+C to stop."
echo ""
uvicorn main:app --reload --host 127.0.0.1 --port 8000
