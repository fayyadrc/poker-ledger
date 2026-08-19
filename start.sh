#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d ".venv" ]]; then
  echo "No .venv found. Create one first:"
  echo "  python3.12 -m venv .venv"
  echo "  source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

source .venv/bin/activate

if [[ ! -d "frontend/node_modules" ]]; then
  echo "==> Installing frontend dependencies"
  (cd frontend && npm install)
fi

echo "==> Running migrations"
(cd backend && python manage.py migrate --no-input)

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

BACKEND_PORT="${BACKEND_PORT:-8000}"
while lsof -Pi ":$BACKEND_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; do
  if [[ "$BACKEND_PORT" -ge 8010 ]]; then
    echo "No free port found between 8000 and 8010. Stop conflicting processes or set BACKEND_PORT."
    exit 1
  fi
  echo "Port $BACKEND_PORT is in use, trying next..."
  BACKEND_PORT=$((BACKEND_PORT + 1))
done
export BACKEND_PORT

echo "==> Starting backend (http://127.0.0.1:$BACKEND_PORT)"
(cd backend && python manage.py runserver "127.0.0.1:$BACKEND_PORT") &
BACKEND_PID=$!

sleep 2

echo "==> Starting frontend (http://127.0.0.1:5173 → API :$BACKEND_PORT)"
(cd frontend && BACKEND_PORT="$BACKEND_PORT" npm run dev -- --host --port 5173) &
FRONTEND_PID=$!

echo ""
echo "Poker Ledger is running:"
echo "  App:  http://127.0.0.1:5173"
echo "  API:  http://127.0.0.1:$BACKEND_PORT/api/"
echo "  Vite proxies /api → :$BACKEND_PORT"
echo ""
echo "Press Ctrl+C to stop both servers."

wait
