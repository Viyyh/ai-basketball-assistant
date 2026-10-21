"""参数层测试。

这些用例是"改一个常量要改一批期望值"的护栏 —— 尤其是三分线半径，
它一旦错了，整场报告的二分/三分判定会系统性偏移且不报错。
"""

from __future__ import annotations

import math
import unittest

from basketball_params import (
    AgeGroup,
    CourtType,
    FIBA_3PT_RADIUS_M,
    Format,
    Shot,
    ThreePointGeometry,
    build_court,
    resolve,
    resolve_three_point,
)


class TestResolve(unittest.TestCase):
    def test_5v5_u15_uses_fiba_radius_and_corners(self):
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        self.assertEqual(p.three_point.radius_m, 6.75)
        self.assertEqual(p.three_point.geometry, ThreePointGeometry.ARC_AND_CORNERS)
        self.assertEqual(p.three_point.corner_lateral_m, 6.60)
        self.assertEqual(p.court.court_type, CourtType.FULL)
        self.assertEqual(p.rules.period_count, 4)
        self.assertEqual(p.rules.outside_arc_points, 3)

    def test_unified_radius_across_all_age_groups(self):
        """2026-10-21 确认：所有年龄段统一 6.75 m（原 5.80 假设作废）。"""
        for age in AgeGroup:
            with self.subTest(age=age):
                p = resolve(Format.FIVE_V_FIVE, age)
                self.assertEqual(p.three_point.radius_m, FIBA_3PT_RADIUS_M)

    def test_corner_junction_matches_fiba(self):
        """交接点应落在距底线 2.99 m 处 —— FIBA 标准几何的自检。"""
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR)
        junction = p.three_point.corner_junction_x_m
        baseline = p.court.baseline_to_hoop_m
        self.assertAlmostEqual(junction + baseline, 2.99, places=2)

    def test_3x3_court_orientation(self):
        """FIBA 3x3 场地是 15 m 宽 × 11 m 长 —— 宽比长大，不是反过来。

        写反了 y_half 会变成 5.5 m，几何判定随之退化成纯弧线，
        整场 3x3 的底角两分会被算成一分。
        """
        p = resolve(Format.THREE_V_THREE, AgeGroup.U15)
        self.assertEqual(p.court.length_m, 11.0)
        self.assertEqual(p.court.width_m, 15.0)
        self.assertEqual(p.court.y_half_m, 7.5)
        self.assertEqual(p.three_point.geometry, ThreePointGeometry.ARC_AND_CORNERS)
        self.assertEqual(p.rules.inside_arc_points, 1)
        self.assertEqual(p.rules.outside_arc_points, 2)
        self.assertEqual(p.rules.shot_clock_s, 12)
        self.assertFalse(p.rules.fast_break_enabled)

    def test_4v4_requires_court_type(self):
        with self.assertRaises(ValueError):
            resolve(Format.FOUR_V_FOUR, AgeGroup.U15)

    def test_4v4_half_court_keeps_corners(self):
        p = resolve(Format.FOUR_V_FOUR, AgeGroup.U15, court_type=CourtType.HALF)
        self.assertEqual(p.court.width_m, 15.0)
        self.assertEqual(p.three_point.geometry, ThreePointGeometry.ARC_AND_CORNERS)

    def test_radius_override_degrades_to_pure_arc(self):
        """某个联赛打小球时显式覆盖半径，几何自动退化，不需要特判。"""
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.U12, three_point_radius_m=5.80)
        self.assertEqual(p.three_point.geometry, ThreePointGeometry.PURE_ARC)
        self.assertTrue(any("覆盖值" in u for u in p.unverified))

    def test_rejects_non_positive_radius(self):
        with self.assertRaises(ValueError):
            resolve_three_point(0, resolve(Format.FIVE_V_FIVE, AgeGroup.U15).court)


class TestCourtGeometry(unittest.TestCase):
    def setUp(self):
        self.court = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U15))

    def test_arc_boundary(self):
        self.assertFalse(self.court.behind_three_point_line(6.74, 0.0))
        self.assertTrue(self.court.behind_three_point_line(6.76, 0.0))

    def test_line_itself_counts_as_two(self):
        """FIBA 2.5.4：3 分线不是 3 分中篮区域的一部分 —— 踩线算两分。"""
        on_line = self.court.judge(Shot(x_m=6.75, y_m=0.0, made=True))
        self.assertFalse(on_line.behind_three_point_line)
        self.assertEqual(on_line.shot_value, 2)

        just_out = self.court.judge(Shot(x_m=6.7501, y_m=0.0, made=True))
        self.assertTrue(just_out.behind_three_point_line)
        self.assertEqual(just_out.shot_value, 3)

        just_in = self.court.judge(Shot(x_m=6.7499, y_m=0.0, made=True))
        self.assertFalse(just_in.behind_three_point_line)

    def test_corner_line_itself_counts_as_two(self):
        """底角直线段的 |y| = 6.60 是线的外沿，压线同样算两分。"""
        on_corner = self.court.judge(Shot(x_m=1.0, y_m=6.60, made=True))
        self.assertFalse(on_corner.behind_three_point_line)
        self.assertEqual(on_corner.shot_value, 2)

        outside = self.court.judge(Shot(x_m=1.0, y_m=6.61, made=True))
        self.assertTrue(outside.behind_three_point_line)

    def test_old_demo_point_is_no_longer_a_three(self):
        """原 demo 认为 6.20 m 是三分；按 6.75 m 口径它只是两分。"""
        j = self.court.judge(Shot(x_m=6.2, y_m=0.0, made=True))
        self.assertFalse(j.behind_three_point_line)
        self.assertEqual(j.shot_value, 2)
        self.assertEqual(j.label_zh, "二分")

    def test_corner_three(self):
        """底角：|y| > 6.60 且未过交接点，距离 6.70 m 仍算三分。"""
        j = self.court.judge(Shot(x_m=1.0, y_m=6.70, made=True))
        self.assertTrue(j.behind_three_point_line)
        self.assertEqual(j.shot_value, 3)

    def test_corner_inside_line(self):
        j = self.court.judge(Shot(x_m=1.0, y_m=6.50, made=True))
        self.assertFalse(j.behind_three_point_line)
        self.assertEqual(j.shot_value, 2)

    def test_geometry_stays_continuous_at_junction(self):
        """交接点两侧不应出现"更远却算两分"的矛盾。"""
        junction = self.court.tp.corner_junction_x_m
        # 只测底角线之外的 y：6.60 正好压线，按规则是两分，不参与连续性判断
        for y in (6.66, 6.70, 6.90):
            with self.subTest(y=y):
                near = self.court.behind_three_point_line(junction - 0.01, y)
                far = self.court.behind_three_point_line(junction + 0.01, y)
                self.assertTrue(near)
                self.assertTrue(far)

    def test_out_of_bounds(self):
        self.assertFalse(self.court.judge(Shot(x_m=-2.0, y_m=0.0, made=False)).in_bounds)
        self.assertFalse(self.court.judge(Shot(x_m=5.0, y_m=8.0, made=False)).in_bounds)
        self.assertTrue(self.court.judge(Shot(x_m=5.0, y_m=7.4, made=False)).in_bounds)

    def test_3x3_labels_never_say_three(self):
        court = build_court(resolve(Format.THREE_V_THREE, AgeGroup.U15))
        outside = court.judge(Shot(x_m=6.9, y_m=0.0, made=True))
        inside = court.judge(Shot(x_m=2.0, y_m=0.0, made=True))
        self.assertEqual(outside.shot_value, 2)
        self.assertEqual(outside.label_zh, "远投(2分)")
        self.assertEqual(inside.shot_value, 1)
        self.assertEqual(inside.label_zh, "近投(1分)")
        for j in (outside, inside):
            self.assertNotIn("三分", j.label_zh)


class TestContractParams(unittest.TestCase):
    def test_contract_keys(self):
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        expected = {
            "format", "age_group", "court_type", "three_point_radius_m",
            "three_point_geometry", "corner_lateral_m", "corner_junction_x_m",
            "period_count", "period_minutes", "shot_clock_s",
            "inside_arc_points", "outside_arc_points", "fast_break_enabled",
            "formation_points", "court_length_m", "court_width_m",
            "baseline_to_hoop_m", "x_range_m", "y_half_m",
        }
        self.assertEqual(set(p.to_contract()), expected)

    def test_contract_values(self):
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        c = p.to_contract()
        self.assertEqual(c["format"], "5V5")
        self.assertEqual(c["three_point_geometry"], "ARC_AND_CORNERS")
        self.assertAlmostEqual(c["x_range_m"][0], -1.575)
        self.assertAlmostEqual(c["y_half_m"], 7.5)

    def test_svg_params_follow_radius(self):
        court = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U15))
        svg = court.svg_params()
        self.assertEqual(svg["three_point_radius_m"], 6.75)
        self.assertAlmostEqual(svg["corner_junction_x_m"], math.sqrt(6.75**2 - 6.60**2), places=3)

    def test_scope_label(self):
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        self.assertIn("三分线 6.75 m", p.scope_label_zh)


class TestFibaCourtMarks(unittest.TestCase):
    """场地标线尺寸 —— 画错不会报错，只会让教练觉得"这球场怪怪的"。"""

    def test_mark_dimensions(self):
        p = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        m = p.marks
        self.assertAlmostEqual(m.free_throw_line_m, 5.80)
        self.assertAlmostEqual(m.restricted_area_length_m, 5.80)
        self.assertAlmostEqual(m.restricted_area_width_m, 4.90)   # 不是罚球线长 3.60
        self.assertAlmostEqual(m.center_circle_radius_m, 1.80)
        self.assertAlmostEqual(m.no_charge_radius_m, 1.30)
        self.assertAlmostEqual(m.throw_in_line_offset_m, 8.325)
        self.assertAlmostEqual(m.line_width_m, 0.05)

    def test_svg_params_expose_marks(self):
        court = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U15))
        svg = court.svg_params()
        self.assertIn("marks", svg)
        self.assertAlmostEqual(svg["marks"]["restricted_area_width_m"], 4.90)
        self.assertAlmostEqual(svg["marks"]["free_throw_line_m"], 5.80)

    def test_3x3_svg_uses_correct_orientation(self):
        """3x3 底图：长 11 m、宽 15 m，半宽 7.5 m。"""
        court = build_court(resolve(Format.THREE_V_THREE, AgeGroup.U15))
        svg = court.svg_params()
        self.assertEqual(svg["length_m"], 11.0)
        self.assertEqual(svg["width_m"], 15.0)
        self.assertEqual(svg["y_half_m"], 7.5)
        self.assertEqual(svg["three_point_geometry"], "ARC_AND_CORNERS")


if __name__ == "__main__":
    unittest.main()
