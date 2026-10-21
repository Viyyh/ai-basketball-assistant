#!/usr/bin/env bash
#
# 一条命令跑完所有检查。
#
#   ./scripts/verify.sh
#
# 依赖：node ≥ 20、python ≥ 3.11。不需要 npm install，也不需要虚拟环境。
# 任何一步失败立刻退出（set -e），并在最后打印汇总。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
step() { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

command -v node >/dev/null || die "需要 node（≥ 20）"
command -v python3 >/dev/null || die "需要 python3（≥ 3.11）"

export PYTHONPATH="$ROOT/packages/params:$ROOT/services/pipeline:$ROOT/services/api"

step "1/5 契约：结构与语义校验"
(cd contracts && node --test test/validate.test.mjs >/tmp/verify-contracts.log 2>&1) \
  || { tail -40 /tmp/verify-contracts.log; die "契约测试失败"; }
ok "$(grep -Eo 'pass [0-9]+' /tmp/verify-contracts.log | head -1 | grep -Eo '[0-9]+') 项通过"

step "2/5 参数层：赛制 × 年龄段 / 三分线判定"
(cd packages/params && python3 -m unittest discover -s tests -t . >/tmp/verify-params.log 2>&1) \
  || { tail -40 /tmp/verify-params.log; die "参数层测试失败"; }
ok "$(grep -Eo 'Ran [0-9]+ tests' /tmp/verify-params.log | grep -Eo '[0-9]+') 项通过"

step "3/5 mock pipeline：产出物必须过真实契约校验"
(cd services/pipeline && python3 -m unittest discover -s tests -t . >/tmp/verify-pipeline.log 2>&1) \
  || { tail -40 /tmp/verify-pipeline.log; die "pipeline 测试失败"; }
ok "$(grep -Eo 'Ran [0-9]+ tests' /tmp/verify-pipeline.log | grep -Eo '[0-9]+') 项通过"

step "4/5 HTTP API：参数解析 / 活动 / 报告寄存"
(cd services/api && python3 -m unittest discover -s tests -t . >/tmp/verify-api.log 2>&1) \
  || { tail -40 /tmp/verify-api.log; die "API 测试失败"; }
ok "$(grep -Eo 'Ran [0-9]+ tests' /tmp/verify-api.log | grep -Eo '[0-9]+') 项通过"

step "5/5 样例报告：重新生成并与仓库中的 fixture 比对"
tmp="$(mktemp -t sample-report.XXXXXX.json)"
trap 'rm -f "$tmp"' EXIT
python3 -m basketball_pipeline sample --out "$tmp" 2>/dev/null
node contracts/bin/validate-report.mjs "$tmp" >/dev/null \
  || { node contracts/bin/validate-report.mjs "$tmp"; die "生成的示例报告未通过契约校验"; }

if ! diff -q "$tmp" contracts/fixtures/sample-report.json >/dev/null 2>&1; then
  printf '%s契约样例已漂移%s：参数层或 mock 改动后需要重新生成\n' "$RED" "$OFF" >&2
  printf '  %s\n' "PYTHONPATH=packages/params:services/pipeline python3 -m basketball_pipeline sample --out contracts/fixtures/sample-report.json"
  diff -u contracts/fixtures/sample-report.json "$tmp" | head -40 >&2 || true
  die "fixture 与当前代码不一致"
fi
ok "fixture 与参数层同步"

printf '\n%s全部通过%s  %s（契约 v1.1）%s\n' "$GREEN$BOLD" "$OFF" "$DIM" "$OFF"
