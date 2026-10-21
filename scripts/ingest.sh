#!/usr/bin/env bash
#
# 真实视频 → 轨迹 JSON + 轨迹图。
#
#   ./scripts/ingest.sh --video data/raw/game01.mp4 --out data/tracks/game01.json
#
# 需要 opencv-python 与 ultralytics；其余依赖与 verify.sh 相同（无需虚拟环境）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PYTHONPATH="$ROOT/packages/params:$ROOT/services/pipeline"

exec python3 -m basketball_pipeline ingest "$@"
