#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT/packages/params:$ROOT/services/api"
export BASKETBALL_DB="$ROOT/data/app.db"
export BASKETBALL_MEDIA_DIR="$ROOT/data/media"
printf '篮球助手后端：http://127.0.0.1:8000/docs\n请保持此窗口开启；按 Ctrl+C 停止。\n'
exec python3 -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
