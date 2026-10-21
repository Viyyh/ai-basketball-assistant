"""API 测试。用临时 SQLite，不碰开发库。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


class ApiTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.client = TestClient(create_app(Path(self._tmp.name) / "test.db"))

    def tearDown(self):
        self._tmp.cleanup()

    # ---------- 基础 ----------

    def test_health(self):
        body = self.client.get("/health").json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["contract_version"], "1.1")

    # ---------- 参数 ----------

    def test_resolve_uses_fiba_radius(self):
        body = self.client.get(
            "/v1/params/resolve", params={"format": "5V5", "age_group": "U15"}
        ).json()
        self.assertEqual(body["params"]["three_point_radius_m"], 6.75)
        self.assertEqual(body["params"]["three_point_geometry"], "ARC_AND_CORNERS")
        self.assertIn("6.75", body["scope_label"])

    def test_resolve_exposes_court_marks_for_rendering(self):
        """前端画球场必须拿这些数字，不得自己写死 4.9 / 5.8 / 1.8。"""
        body = self.client.get(
            "/v1/params/resolve", params={"format": "5V5", "age_group": "U15"}
        ).json()
        svg = body["svg"]
        self.assertAlmostEqual(svg["three_point_radius_m"], 6.75)
        self.assertAlmostEqual(svg["marks"]["free_throw_line_m"], 5.80)
        self.assertAlmostEqual(svg["marks"]["restricted_area_width_m"], 4.90)
        self.assertAlmostEqual(svg["marks"]["center_circle_radius_m"], 1.80)
        self.assertAlmostEqual(svg["marks"]["no_charge_radius_m"], 1.30)

    def test_resolve_3v3_court_orientation(self):
        body = self.client.get(
            "/v1/params/resolve", params={"format": "3V3", "age_group": "U15"}
        ).json()
        # FIBA 3x3 场地 15 m 宽 × 11 m 长 → 半宽 7.5 m，底角直线段在场内
        self.assertEqual(body["params"]["three_point_geometry"], "ARC_AND_CORNERS")
        self.assertAlmostEqual(body["params"]["y_half_m"], 7.5)
        self.assertAlmostEqual(body["params"]["court_length_m"], 11.0)
        self.assertEqual(body["params"]["inside_arc_points"], 1)

    def test_resolve_4v4_requires_court_type(self):
        res = self.client.get(
            "/v1/params/resolve", params={"format": "4V4", "age_group": "U15"}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("court_type", res.json()["detail"])

    def test_resolve_rejects_unknown_format(self):
        res = self.client.get(
            "/v1/params/resolve", params={"format": "1V1", "age_group": "U15"}
        )
        self.assertEqual(res.status_code, 400)

    def test_radius_override_is_reported_as_unverified(self):
        body = self.client.get(
            "/v1/params/resolve",
            params={"format": "5V5", "age_group": "U12", "three_point_radius_m": 5.8},
        ).json()
        self.assertEqual(body["params"]["three_point_geometry"], "PURE_ARC")
        self.assertTrue(any("覆盖值" in u for u in body["unverified"]))

    # ---------- 活动 ----------

    def test_create_activity_persists_resolved_params(self):
        res = self.client.post("/v1/activities", json={
            "title": "10/09 主场 vs 育才中学",
            "opponent": "育才中学",
            "format": "5V5",
            "age_group": "U15",
        })
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertTrue(body["id"].startswith("act_"))
        self.assertEqual(body["params"]["three_point_radius_m"], 6.75)
        self.assertIn("5 对 5", body["scope_label"])
        self.assertFalse(body["has_report"])

        listed = self.client.get("/v1/activities").json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], body["id"])

    def test_create_activity_rejects_missing_title(self):
        res = self.client.post("/v1/activities", json={"format": "5V5", "age_group": "U15"})
        self.assertEqual(res.status_code, 422)

    def test_get_unknown_activity(self):
        self.assertEqual(self.client.get("/v1/activities/act_nope").status_code, 404)

    # ---------- 报告 ----------

    def _create(self) -> str:
        res = self.client.post("/v1/activities", json={
            "title": "测试比赛", "format": "5V5", "age_group": "U15",
        })
        return res.json()["id"]

    def _report(self, activity_id: str) -> dict:
        return {
            "schema_version": "1.1",
            "activity_id": activity_id,
            "pipeline_version": "mock-1.1.0",
            "params": {"format": "5V5"},
            "events": [],
            "periods": [],
            "team_stats": {},
            "warnings": [],
        }

    def test_report_roundtrip(self):
        activity_id = self._create()
        report = self._report(activity_id)

        saved = self.client.post(f"/v1/activities/{activity_id}/report", json=report)
        self.assertEqual(saved.status_code, 201, saved.text)

        fetched = self.client.get(f"/v1/activities/{activity_id}/report")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["activity_id"], activity_id)

        self.assertTrue(self.client.get(f"/v1/activities/{activity_id}").json()["has_report"])

    def test_report_rejects_wrong_contract_version(self):
        activity_id = self._create()
        report = self._report(activity_id) | {"schema_version": "1.0"}
        res = self.client.post(f"/v1/activities/{activity_id}/report", json=report)
        self.assertEqual(res.status_code, 422)

    def test_report_rejects_mismatched_activity(self):
        activity_id = self._create()
        res = self.client.post(
            f"/v1/activities/{activity_id}/report",
            json=self._report("act_other"),
        )
        self.assertEqual(res.status_code, 422)

    def test_report_rejects_missing_section(self):
        activity_id = self._create()
        report = self._report(activity_id)
        del report["team_stats"]
        res = self.client.post(f"/v1/activities/{activity_id}/report", json=report)
        self.assertEqual(res.status_code, 422)

    def test_report_not_found_before_upload(self):
        activity_id = self._create()
        self.assertEqual(
            self.client.get(f"/v1/activities/{activity_id}/report").status_code, 404
        )


if __name__ == "__main__":
    unittest.main()
