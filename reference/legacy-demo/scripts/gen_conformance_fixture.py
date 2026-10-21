#!/usr/bin/env python
"""
生成跨语言一致性测试的基准数据（fixture）。

用途：
    F 轨（小程序）的 utils/courtGeometry.js 必须与 A/B 轨共用的
    packages/params 几何判定完全一致。如果不一致，教练会看到
    "球画在弧线内、却标成三分" —— PRD 风险 7.4 的界面版。

    本脚本用 Python 参数层算出期望值写成 JSON，
    JS 测试 (tests/courtGeometry.test.js) 读取并逐点断言。

运行：
    py scripts/gen_conformance_fixture.py

输出：
    miniprogram/tests/fixtures/params-conformance.json

⚠️ 修改 packages/params 后必须重跑本脚本，否则一致性测试会失去意义。
"""

from __future__ import annotations

import io
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "packages", "params"))

from basketball_params import (          # noqa: E402
    AgeGroup,
    CourtType,
    Format,
    Shot,
    build_court,
    resolve,
    validate_params_for_pipeline,
)

OUT = os.path.join(ROOT, "miniprogram", "tests", "fixtures",
                   "params-conformance.json")

# 探测点：覆盖弧顶、翼侧、底角、近框、边界内外、越界
PROBES = [
    ("篮下正面",        2.00,  0.00),
    ("禁区边缘",        4.50,  0.00),
    ("弧顶 5.7m",       5.70,  0.00),
    ("弧顶 5.8m",       5.80,  0.00),
    ("弧顶 5.9m",       5.90,  0.00),
    ("弧顶 6.2m",       6.20,  0.00),
    ("弧顶 6.7m",       6.70,  0.00),
    ("弧顶 6.75m",      6.75,  0.00),
    ("弧顶 6.8m",       6.80,  0.00),
    ("弧顶 7.5m",       7.50,  0.00),
    ("翼侧45° 5.0m",    3.54,  3.54),
    ("翼侧45° 6.4m",    4.53,  4.53),
    ("翼侧45° 7.0m",    4.95,  4.95),
    ("底角 y=5.0",      0.00,  5.00),
    ("底角 y=5.5",      0.00,  5.50),
    ("底角 y=6.0",      0.00,  6.00),
    ("底角 y=6.6",      0.00,  6.60),
    ("底角 y=7.0",      0.00,  7.00),
    ("底角 y=7.5",      0.00,  7.50),
    ("底角 x=-1.5 y=6", -1.50, 6.00),
    ("篮筐后方",       -1.50,  0.00),
    ("交接点 x=1.415",  1.415, 6.60),
    ("中场附近",       12.00,  0.00),
    ("越界 y=8.0",      3.00,  8.00),
    ("越界 x=27.0",    27.00,  0.00),
]

# 需要生成基准的参数组合
COMBOS = [
    ("5V5_U12",     Format.FIVE_V_FIVE,    AgeGroup.U12,    None),
    ("5V5_U15",     Format.FIVE_V_FIVE,    AgeGroup.U15,    None),
    ("5V5_U18",     Format.FIVE_V_FIVE,    AgeGroup.U18,    None),
    ("5V5_SENIOR",  Format.FIVE_V_FIVE,    AgeGroup.SENIOR, None),
    ("3V3_U15",     Format.THREE_V_THREE,  AgeGroup.U15,    None),
    ("3V3_SENIOR",  Format.THREE_V_THREE,  AgeGroup.SENIOR, None),
    ("4V4_U15_FULL", Format.FOUR_V_FOUR,   AgeGroup.U15,    "FULL"),
    ("4V4_U15_HALF", Format.FOUR_V_FOUR,   AgeGroup.U15,    "HALF"),
]


def build_combo(name, fmt, age, court_type_str):
    ct = CourtType(court_type_str) if court_type_str else None
    p = resolve(fmt, age, ct)
    court = build_court(p)

    probes = []
    for label, x, y in PROBES:
        shot = Shot(x_m=x, y_m=y, made=True)
        j = court.judge(shot)
        probes.append({
            "label": label,
            "x_m": x,
            "y_m": y,
            "distance_m": j.distance_m,
            "behind": j.behind_three_point_line,
            "points": j.points_if_made,
            "label_zh": j.label_zh,
            "in_bounds": j.in_bounds,
        })

    render = court.svg_render_params()

    # 输出严格按 docs/contract/report-schema.json 的 params 段字段名，
    # 这样 JS 侧拿到的是它真实会收到的形状，而不是一份需要再映射的中间结构。
    contract_params = {
        "format": p.fmt.value,
        "age_group": p.age_group.value,
        "court_type": render["court_type"],
        "court_length_m": render["length_m"],
        "court_width_m": render["width_m"],
        "baseline_to_hoop_m": p.court.baseline_to_hoop_m,
        "three_point_radius_m": render["three_point_radius_m"],
        "three_point_geometry": render["three_point_geometry"],
        "corner_lateral_m": render["corner_lateral_m"],
        "corner_junction_x_m": render["corner_junction_x_m"],
        "x_range_m": render["x_range_m"],
        "y_half_m": render["y_half_m"],
        "hoop_count": render["hoop_count"],
        "period_count": p.rules.period_count,
        "period_minutes": p.rules.period_minutes,
        "shot_clock_s": p.rules.shot_clock_s,
        "inside_arc_points": p.rules.inside_arc_points,
        "outside_arc_points": p.rules.outside_arc_points,
        "fast_break_enabled": p.rules.fast_break_enabled,
        "fast_break_max_possession_s": p.rules.fast_break_max_possession_s,
        "win_score": p.rules.win_score,
        "players_per_team": p.tracking.players_per_team,
        "formation_points": p.tracking.formation_points,
        "max_tracked_targets": p.tracking.max_tracked_targets,
        "formation_sample_interval_s": p.tracking.formation_sample_interval_s,
    }

    return {
        "key": name,
        "params": contract_params,
        "validation_problems": validate_params_for_pipeline(p),
        "probes": probes,
    }


def main():
    fixture = {
        "_generated_by": "scripts/gen_conformance_fixture.py",
        "_note": "Python 参数层算出的基准值。JS 侧 courtGeometry.js 必须逐点一致。"
                 "修改 packages/params 后必须重跑本脚本。",
        "schema_version": "1.0",
        "combos": [build_combo(n, f, a, c) for n, f, a, c in COMBOS],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh, ensure_ascii=False, indent=2)

    total_probes = sum(len(c["probes"]) for c in fixture["combos"])
    print(f"已生成 {OUT}")
    print(f"  组合数 {len(fixture['combos'])} · 探测点 {total_probes} · "
          f"断言总数 {total_probes * 4}")


if __name__ == "__main__":
    main()
