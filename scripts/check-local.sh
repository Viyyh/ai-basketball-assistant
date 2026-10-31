#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ -x "$ROOT/data/tools/node/bin/node" ]]; then export PATH="$ROOT/data/tools/node/bin:$PATH"; fi
(cd packages/params && PYTHONPATH=. python3 -m unittest discover -s tests -t .)
(cd services/pipeline && PYTHONPATH=../../packages/params:. python3 -m unittest discover -s tests -t .)
(cd services/api && PYTHONPATH=../../packages/params:. python3 -m unittest discover -s tests -t .)
python3 scripts/test_dataset.py
python3 scripts/test_library_db.py
python3 scripts/test_training_export.py
if [[ -f data/library/library.db && -f data/public-sources/pl-nba-audit/samples.json ]]; then
  python3 scripts/test_review_workbench.py
  python3 scripts/test_external_audit.py
  python3 scripts/test_revision_proposals.py
else
  echo '跳过依赖本地素材数据库与外部样本的审核集成测试。'
fi
