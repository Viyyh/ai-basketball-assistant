"""Mock pipeline 命令行。

    python -m basketball_pipeline sample --out report.json
    python -m basketball_pipeline sample --format 3V3 --age U15 --out r3v3.json

产出物可直接交给 contracts/bin/validate-report.mjs 校验。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from basketball_params import AgeGroup, CourtType, Format

from .mock import build_report


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="basketball_pipeline", description="AI Basketball Assistant pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sample = sub.add_parser("sample", help="生成一份契约合法的示例报告")
    sample.add_argument("--format", default="5V5", choices=[f.value for f in Format])
    sample.add_argument("--age", default="U15", choices=[a.value for a in AgeGroup])
    sample.add_argument("--court-type", default=None, choices=[c.value for c in CourtType],
                        help="4v4 / 自定义赛制必须指定")
    sample.add_argument("--radius", type=float, default=None,
                        help="覆盖三分线半径（默认 6.75 m）")
    sample.add_argument("--out", default="-", help="输出路径，- 表示 stdout")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    if args.cmd == "sample":
        report = build_report(
            fmt=Format(args.format),
            age_group=AgeGroup(args.age),
            court_type=CourtType(args.court_type) if args.court_type else None,
            three_point_radius_m=args.radius,
        )
        text = json.dumps(report, ensure_ascii=False, indent=2)
        if args.out == "-":
            print(text)
        else:
            out = Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text + "\n", encoding="utf-8")
            print(f"已写入 {out}（{len(report['events'])} 个事件）", file=sys.stderr)
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
