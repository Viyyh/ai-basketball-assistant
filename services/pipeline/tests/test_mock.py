"""Mock pipeline 测试。

重点不是"能生成 JSON"，而是生成的 JSON 能被**独立的**契约校验器接受 ——
校验器是 JS 写的，这里通过子进程调用，等于一次跨语言的端到端检查。
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from basketball_pipeline import build_report
from basketball_params import AgeGroup, CourtType, Format

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "contracts" / "bin" / "validate-report.mjs"


def run_validator(report: dict) -> subprocess.CompletedProcess:
    """把报告写进临时文件，交给 node 校验器。"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "report.json"
        path.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        return subprocess.run(
            ["node", str(VALIDATOR), str(path)],
            capture_output=True, text=True, cwd=ROOT, check=False,
        )


@unittest.skipIf(shutil.which("node") is None, "需要 node 才能跑契约校验")
class TestMockReport(unittest.TestCase):
    def assert_valid(self, report: dict) -> None:
        result = run_validator(report)
        self.assertEqual(
            result.returncode, 0,
            f"契约校验未通过：\n{result.stdout}\n{result.stderr}",
        )

    def test_default_report_is_contract_valid(self):
        self.assert_valid(build_report())

    def test_3v3_report_is_contract_valid(self):
        self.assert_valid(build_report(fmt=Format.THREE_V_THREE))

    def test_4v4_half_court_is_contract_valid(self):
        self.assert_valid(build_report(fmt=Format.FOUR_V_FOUR, court_type=CourtType.HALF))

    def test_deterministic(self):
        self.assertEqual(build_report(), build_report())


class TestMockContent(unittest.TestCase):
    def test_uses_resolved_params_not_hardcoded(self):
        report = build_report()
        self.assertEqual(report["params"]["three_point_radius_m"], 6.75)
        self.assertEqual(report["params"]["three_point_geometry"], "ARC_AND_CORNERS")

    def test_score_matches_shot_value(self):
        """得分必须由 shot_value × made 累加，不能手填。"""
        report = build_report()
        made_points = sum(
            e["shot_value"] for e in report["events"]
            if e["kind"] == "SHOT" and e["team_side"] == "OURS"
            and e["status"] == "ACTIVE" and e["made"]
        )
        self.assertEqual(report["team_stats"]["points"], made_points)

    def test_3v3_never_says_three_points(self):
        report = build_report(fmt=Format.THREE_V_THREE)
        labels = [e["label_zh"] for e in report["events"] if e["label_zh"]]
        self.assertTrue(labels)
        for label in labels:
            self.assertNotIn("三分", label)
        # 3x3 场地 15 m 宽 × 11 m 长，半宽 7.5 m > 6.60 m，底角直线段在场内
        self.assertEqual(report["params"]["three_point_geometry"], "ARC_AND_CORNERS")
        self.assertEqual(report["params"]["y_half_m"], 7.5)
        self.assertEqual(len(report["periods"]), 1)

    def test_every_period_has_attacking_basket(self):
        report = build_report()
        for period in report["periods"]:
            self.assertIn(period["attacking_basket"], ("LEFT", "RIGHT"))

    def test_coverage_is_consistent(self):
        report = build_report()
        cov = report["coverage"]
        active = [e for e in report["events"] if e["status"] == "ACTIVE"]
        self.assertEqual(cov["events_total"], len(report["events"]))
        self.assertEqual(cov["events_excluded"], len(report["events"]) - len(active))
        self.assertEqual(cov["events_side_unknown"],
                         len([e for e in active if e["team_side"] == "UNKNOWN"]))

    def test_unknown_side_is_not_counted_for_either_team(self):
        report = build_report()
        our_shots = [e for e in report["events"]
                     if e["kind"] == "SHOT" and e["status"] == "ACTIVE"
                     and e["team_side"] == "OURS"]
        self.assertEqual(report["team_stats"]["shots_attempted"], len(our_shots))


class TestCli(unittest.TestCase):
    def test_cli_writes_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            result = subprocess.run(
                [sys.executable, "-m", "basketball_pipeline", "sample",
                 "--format", "3V3", "--out", str(out)],
                capture_output=True, text=True, cwd=ROOT / "services" / "pipeline",
                env={"PYTHONPATH": f"{ROOT / 'packages' / 'params'}:{ROOT / 'services' / 'pipeline'}",
                     "PATH": "/usr/bin:/bin:/usr/local/bin"},
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(out.exists())
            self.assertEqual(json.loads(out.read_text())["params"]["format"], "3V3")


if __name__ == "__main__":
    unittest.main()
