#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/models"
TARGET="$ROOT/models/ebard-yolov8n.pt"
EXPECTED=dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641
if [[ -f "$TARGET" ]] && [[ "$(shasum -a 256 "$TARGET" | cut -d ' ' -f 1)" == "$EXPECTED" ]]; then
  echo '篮球模型已就绪'; exit 0
fi
TMP="$(mktemp "$ROOT/models/ebard-download.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fL --max-time 120 'https://huggingface.co/GabrieleGiudici/E-BARD-detection-models/resolve/3f4789c/BODD_yolov8n_0001.pt' -o "$TMP"
ACTUAL="$(shasum -a 256 "$TMP" | cut -d ' ' -f 1)"
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo '模型校验失败' >&2; exit 1; }
mv "$TMP" "$TARGET"
echo '篮球模型下载并校验完成'
