#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export YOLO_CONFIG_DIR="$ROOT/data/ultralytics"
mkdir -p "$YOLO_CONFIG_DIR"
exec python3 scripts/analyze_local.py "$@"
