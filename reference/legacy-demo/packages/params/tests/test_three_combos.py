"""
三组参数组合的验收测试。

对应范围确认 v0.2 第九节：
    PoC 不能只跑一种参数组合，必须至少覆盖三种，
    用来验证 7.4 节的风险（参数取错导致静默的错误数据）是否真实存在。

运行：
    py -m unittest discover -s poc/tests -v
或：
    py poc/run_poc.py        # 会额外打印可读的 PoC 报告
"""

from __future__ import annotations

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from basketball_params.aggregate import (
    CrossAgeGroupAggregationError,
    CrossFormatAggregationError,
    GameStats,
    aggregate,
    aggregate_guarded,
    group_by_scope,
)
from basketball_params.court import CourtGeometry, Shot, build_court
from basketball_params.params import (
    AgeGroup,
    CourtType,
    Format,
    ThreePointGeometry,
    resolve,
)
from basketball_params.pipeline_contract import validate_params_for_pipeline


# ============================================================
# 组合 A：U15 + 5对5 全场（基线）
# ============================================================

class TestComboA_U15_5v5(unittest.TestCase):
    """验证目标：基线精度所需的参数是否正确解析。"""

    @classmethod
    def setUpClass(cls):
        cls.p = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        cls.court = build_court(cls.p)

    def test_court_is_full_double_hoop(self):
        self.assertIs(self.p.court.court_type, CourtType.FULL)
        self.assertEqual(self.p.court.length_m, 28.0)
        self.assertEqual(self.p.court.width_m, 15.0)
        self.assertEqual(self.p.court.hoop_count, 2)

    def test_rules_are_5v5_standard(self):
        self.assertEqual(self.p.rules.shot_clock_s, 24)
        self.assertEqual(self.p.rules.period_count, 4)
        self.assertEqual(self.p.rules.inside_arc_points, 2)
        self.assertEqual(self.p.rules.outside_arc_points, 3)
        self.assertTrue(self.p.rules.fast_break_enabled)

    def test_tracking_matches_5_players(self):
        self.assertEqual(self.p.tracking.players_per_team, 5)
        self.assertEqual(self.p.tracking.formation_points, 5)
        self.assertEqual(self.p.tracking.max_tracked_targets, 10)

    def test_three_point_radius_is_fiba_standard(self):
        """FIBA 2.5.4：三分弧 6.75 m，不按年龄段分档。"""
        self.assertAlmostEqual(self.p.three_point.radius_m, 6.75, places=2)

    def test_fiba_radius_uses_arc_and_corners(self):
        """
        半径 6.75 > 底角横向 6.60，场地半宽 7.5 > 6.60，
        所以 5v5 一定是"弧线 + 底角直线"两段几何。
        """
        self.assertIs(self.p.three_point.geometry, ThreePointGeometry.ARC_AND_CORNERS)
        self.assertAlmostEqual(self.p.three_point.corner_lateral_m, 6.60, places=2)

    def test_small_radius_override_degenerates_to_pure_arc(self):
        """
        若某联赛自定 5.80 m 少年线，必须退化为纯弧线。

        半径小于底角横向 6.60 m 时仍硬套"弧线+底角直线"，底角直线段会落在
        弧线内侧，产生自相矛盾的判定且不报错 —— 静默错误数据的典型来源。
        """
        small = build_court(
            resolve(Format.FIVE_V_FIVE, AgeGroup.U15, three_point_radius_m=5.80)
        )
        self.assertIs(small.params.three_point.geometry, ThreePointGeometry.PURE_ARC)
        self.assertIsNone(small.params.three_point.corner_lateral_m)
        self.assertFalse(small.params.three_point.verified)

    def test_coordinate_bounds_full_court(self):
        self.assertAlmostEqual(self.court.x_min, -1.575, places=3)
        self.assertAlmostEqual(self.court.x_max, 26.425, places=3)
        self.assertAlmostEqual(self.court.y_half, 7.5, places=3)

    def test_params_pass_pipeline_validation(self):
        self.assertEqual(validate_params_for_pipeline(self.p), [])


# ============================================================
# 组合 B：U12 + 5对5 全场（三分线半径敏感性）
# ============================================================

class TestComboB_U12_3pt_sensitivity(unittest.TestCase):
    """
    验证目标：FIBA 统一 6.75 m 之后，中距离不会被误记成三分。

    这是整个 PoC 最关键的一组测试。它证明的是：
    **同一个物理出手点，参数取错就会得到不同的分值判定。**
    早期假设青少年 5.80 m，会把 5.8~6.75 m 的中距离全部算成三分 ——
    报告看起来完全正常，数字却全错（风险 7.4）。
    """

    @classmethod
    def setUpClass(cls):
        cls.u12 = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U12))
        cls.u15 = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U15))
        cls.senior = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR))

    def test_same_shot_same_value_across_age_groups(self):
        """FIBA 统一 6.75 m：弧顶 6.20 m 在任何年龄段都是二分。"""
        shot = Shot(x_m=6.20, y_m=0.0, made=True)

        for court in (self.u12, self.u15, self.senior):
            j = court.judge(shot)
            self.assertFalse(j.behind_three_point_line)
            self.assertEqual(j.points_awarded, 2)

        just_outside = Shot(x_m=6.90, y_m=0.0, made=True)
        for court in (self.u12, self.u15, self.senior):
            self.assertEqual(court.judge(just_outside).points_awarded, 3)

    def test_5_80_assumption_would_overcount_threes(self):
        """
        量化"用错参数"的后果 —— 这就是风险 7.4 的实证。

        构造一组 5.8 ~ 6.7 m 的出手点，分别用旧假设（5.80 m）与 FIBA 半径
        （6.75 m）判定，统计被误记成三分的数量。
        """
        old = build_court(
            resolve(Format.FIVE_V_FIVE, AgeGroup.U12, three_point_radius_m=5.80)
        )
        # 青少年比赛中常见的中远距离出手（5.8 ~ 6.7 m 之间）
        shots = [
            Shot(5.90, 0.0, True), Shot(6.10, 0.5, True), Shot(6.30, -0.4, False),
            Shot(6.00, 1.2, True), Shot(6.50, 0.8, True), Shot(5.95, -1.0, False),
            Shot(6.20, 2.0, True), Shot(6.60, 0.0, True), Shot(5.85, 3.0, False),
            Shot(6.40, -2.5, True),
        ]

        correct_threes = sum(
            1 for s in shots if self.u12.behind_three_point_line(s.x_m, s.y_m)
        )
        inflated_threes = sum(
            1 for s in shots if old.behind_three_point_line(s.x_m, s.y_m)
        )

        self.assertGreater(inflated_threes, correct_threes,
                           "按 5.80 m 判定会把中距离误记成三分")
        # 记录差距，run_poc.py 会把它打印成可读结论
        TestComboB_U12_3pt_sensitivity.misjudged = inflated_threes - correct_threes
        TestComboB_U12_3pt_sensitivity.total = len(shots)

    def test_u12_and_u15_share_same_radius(self):
        """所有年龄段都用 FIBA 6.75 m，判定必须完全一致。"""
        shot = Shot(x_m=6.00, y_m=0.0, made=True)
        self.assertEqual(
            self.u12.judge(shot).points_awarded,
            self.u15.judge(shot).points_awarded,
        )

    def test_boundary_shot_just_inside_and_outside(self):
        """弧线边界的两侧各取一点，确认没有 off-by-one。"""
        r = self.u12.params.three_point.radius_m

        just_inside = Shot(x_m=r - 0.05, y_m=0.0, made=True)
        just_outside = Shot(x_m=r + 0.05, y_m=0.0, made=True)

        self.assertFalse(self.u12.behind_three_point_line(just_inside.x_m, 0.0))
        self.assertEqual(self.u12.judge(just_inside).points_awarded, 2)

        self.assertTrue(self.u12.behind_three_point_line(just_outside.x_m, 0.0))
        self.assertEqual(self.u12.judge(just_outside).points_awarded, 3)

    def test_params_pass_pipeline_validation(self):
        self.assertEqual(validate_params_for_pipeline(self.u12.params), [])


# ============================================================
# 组合 C：3对3 半场（完全不同的规则集）
# ============================================================

class TestComboC_3v3_halfcourt(unittest.TestCase):
    """验证目标：半场单框标定能否跑通，坐标是否偏移。"""

    @classmethod
    def setUpClass(cls):
        cls.p = resolve(Format.THREE_V_THREE, AgeGroup.U15)
        cls.court = build_court(cls.p)

    def test_court_is_half_single_hoop(self):
        self.assertIs(self.p.court.court_type, CourtType.HALF)
        # FIBA 3x3：场地 15 m 宽 × 11 m 长（宽 > 长）
        self.assertEqual(self.p.court.length_m, 11.0)
        self.assertEqual(self.p.court.width_m, 15.0)
        self.assertEqual(self.p.court.hoop_count, 1)

    def test_coordinate_bounds_half_court(self):
        """半场坐标范围必须与全场不同，否则标定会整体偏移。"""
        self.assertAlmostEqual(self.court.x_min, -1.575, places=3)
        self.assertAlmostEqual(self.court.x_max, 9.425, places=3)
        self.assertAlmostEqual(self.court.y_half, 7.5, places=3)

    def test_shot_clock_is_12_seconds(self):
        self.assertEqual(self.p.rules.shot_clock_s, 12)

    def test_scoring_is_1_and_2_not_2_and_3(self):
        """FIBA 3x3：弧内 1 分，弧外 2 分。"""
        inside = self.court.judge(Shot(x_m=3.0, y_m=0.0, made=True))
        outside = self.court.judge(Shot(x_m=8.0, y_m=0.0, made=True))

        self.assertEqual(inside.points_awarded, 1)
        self.assertEqual(outside.points_awarded, 2)

    def test_labels_never_say_three_point(self):
        """
        3x3 报告不能出现"三分"字样 —— 它只值 2 分，叫三分会让教练困惑。
        对应界面设计 v0.1.1 与范围确认 v0.2 5.5 节的口径要求。
        """
        outside = self.court.judge(Shot(x_m=8.0, y_m=0.0, made=True))
        inside = self.court.judge(Shot(x_m=3.0, y_m=0.0, made=True))

        self.assertEqual(outside.label_zh, "远投(2分)")
        self.assertEqual(inside.label_zh, "近投(1分)")
        self.assertNotIn("三分", outside.label_zh)

    def test_three_point_line_is_arc_and_corners(self):
        """FIBA 2.5.4 对所有赛制统一：弧线 6.75 m + 底角直线（横向 6.60 m）。"""
        self.assertIs(self.p.three_point.geometry, ThreePointGeometry.ARC_AND_CORNERS)
        self.assertAlmostEqual(self.p.three_point.radius_m, 6.75, places=2)
        self.assertAlmostEqual(self.p.three_point.corner_lateral_m, 6.60, places=2)

    def test_fast_break_disabled_in_v1(self):
        """范围确认 v0.2 第六节：3对3 第一版关闭快攻识别。"""
        self.assertFalse(self.p.rules.fast_break_enabled)
        self.assertIsNone(self.p.rules.fast_break_max_possession_s)

    def test_tracking_matches_3_players(self):
        self.assertEqual(self.p.tracking.players_per_team, 3)
        self.assertEqual(self.p.tracking.formation_points, 3)
        self.assertEqual(self.p.tracking.max_tracked_targets, 6)

    def test_single_period_and_win_score_21(self):
        self.assertEqual(self.p.rules.period_count, 1)
        self.assertEqual(self.p.rules.period_minutes, 10.0)
        self.assertEqual(self.p.rules.win_score, 21)

    def test_params_pass_pipeline_validation(self):
        self.assertEqual(validate_params_for_pipeline(self.p), [])


# ============================================================
# 几何形态：成人 5v5 的"弧线 + 底角直线"
# ============================================================

class TestAdultCornerGeometry(unittest.TestCase):
    """
    成人 5v5 的三分线是两段几何，不是单一半径。
    底角三分（6.60 m）比弧顶三分（6.75 m）更近 —— 这是真实规则。
    """

    @classmethod
    def setUpClass(cls):
        cls.p = resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR)
        cls.court = build_court(cls.p)

    def test_geometry_is_arc_and_corners(self):
        self.assertIs(self.p.three_point.geometry, ThreePointGeometry.ARC_AND_CORNERS)
        self.assertAlmostEqual(self.p.three_point.corner_lateral_m, 6.60, places=2)

    def test_corner_junction_x(self):
        """弧线与底角直线的交接点：sqrt(6.75² - 6.60²) ≈ 1.415 m。"""
        expected = math.sqrt(6.75 ** 2 - 6.60 ** 2)
        self.assertAlmostEqual(self.court._corner_junction_x, expected, places=3)
        self.assertAlmostEqual(expected, 1.415, places=2)

    def test_corner_three_is_closer_than_top_of_key(self):
        """底角三分比弧顶三分近 —— 用错几何会让底角三分被判成二分。"""
        corner = Shot(x_m=0.0, y_m=7.0, made=True)      # 底角，距筐 7.0 m 横向
        top_of_key = Shot(x_m=6.80, y_m=0.0, made=True)  # 弧顶 6.80 m

        self.assertTrue(self.court.behind_three_point_line(corner.x_m, corner.y_m),
                        "底角 |y|=7.0 >= 6.60 且 x=0 <= 交接点，应为三分")
        self.assertTrue(self.court.behind_three_point_line(top_of_key.x_m, 0.0),
                        "弧顶 6.80 >= 6.75，应为三分")

    def test_just_inside_corner_is_two(self):
        """底角稍内侧（|y|=6.0）应为二分。"""
        shot = Shot(x_m=0.0, y_m=6.0, made=True)
        self.assertFalse(self.court.behind_three_point_line(shot.x_m, shot.y_m))
        self.assertEqual(self.court.judge(shot).points_awarded, 2)

    def test_wing_shot_at_45_degrees(self):
        """45 度翼侧：6.36 m 为二分，7.07 m 为三分。"""
        near = Shot(x_m=4.5, y_m=4.5, made=True)    # dist ≈ 6.364
        far = Shot(x_m=5.0, y_m=5.0, made=True)     # dist ≈ 7.071

        self.assertFalse(self.court.behind_three_point_line(near.x_m, near.y_m))
        self.assertTrue(self.court.behind_three_point_line(far.x_m, far.y_m))

    def test_labels_say_three_point(self):
        outside = self.court.judge(Shot(x_m=8.0, y_m=0.0, made=True))
        self.assertEqual(outside.label_zh, "三分")
        self.assertEqual(outside.points_awarded, 3)


# ============================================================
# 参数自检：能否挡住错误配置
# ============================================================

class TestParamValidation(unittest.TestCase):
    """验证 validate_params_for_pipeline 能抓住矛盾配置。"""

    def test_all_three_combos_pass(self):
        for fmt, age in [
            (Format.FIVE_V_FIVE, AgeGroup.U15),
            (Format.FIVE_V_FIVE, AgeGroup.U12),
            (Format.THREE_V_THREE, AgeGroup.U15),
        ]:
            with self.subTest(fmt=fmt.value, age=age.value):
                self.assertEqual(validate_params_for_pipeline(resolve(fmt, age)), [])

    def test_contradictory_geometry_is_caught(self):
        """
        人为构造"弧线+底角"但半径小于底角横向距离的矛盾配置，
        自检必须报错，而不是静默产出错误判定。
        """
        from basketball_params.params import (
            ActivityParams, ThreePointSpec,
        )
        base = resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR)
        broken = ActivityParams(
            fmt=base.fmt,
            age_group=base.age_group,
            court=base.court,
            three_point=ThreePointSpec(
                geometry=ThreePointGeometry.ARC_AND_CORNERS,
                radius_m=5.80,
                corner_lateral_m=6.60,
                verified=False,
                note="人为构造的矛盾配置",
            ),
            rules=base.rules,
            tracking=base.tracking,
            unverified=(),
        )
        problems = validate_params_for_pipeline(broken)
        self.assertTrue(any("几何矛盾" in p for p in problems),
                        f"应检出几何矛盾，实际：{problems}")

    def test_4v4_requires_explicit_court_type(self):
        """4对4 没有统一规则，必须显式指定全场/半场。"""
        with self.assertRaises(ValueError) as ctx:
            resolve(Format.FOUR_V_FOUR, AgeGroup.U15)
        self.assertIn("court_type", str(ctx.exception))

        # 显式指定后可以解析
        full = resolve(Format.FOUR_V_FOUR, AgeGroup.U15, CourtType.FULL)
        half = resolve(Format.FOUR_V_FOUR, AgeGroup.U15, CourtType.HALF)
        self.assertIs(full.court.court_type, CourtType.FULL)
        self.assertIs(half.court.court_type, CourtType.HALF)
        self.assertEqual(full.tracking.players_per_team, 4)


# ============================================================
# 聚合守卫
# ============================================================

class TestAggregationGuard(unittest.TestCase):
    """对应球队页设计 v0.2 屏 02：赛制筛选没有"全部"选项。"""

    def _games(self):
        return [
            GameStats("g1", Format.FIVE_V_FIVE, AgeGroup.U15, 78, 65, True,
                      fgm=28, fga=64, threes_made=8, threes_att=22),
            GameStats("g2", Format.FIVE_V_FIVE, AgeGroup.U15, 61, 70, False,
                      fgm=22, fga=61, threes_made=5, threes_att=19),
            GameStats("g3", Format.THREE_V_THREE, AgeGroup.U15, 21, 18, True,
                      fgm=9, fga=18, threes_made=4, threes_att=8),
        ]

    def test_cross_format_aggregation_raises(self):
        with self.assertRaises(CrossFormatAggregationError):
            aggregate_guarded(self._games())

    def test_scoped_aggregation_works(self):
        result = aggregate(self._games(), Format.FIVE_V_FIVE, AgeGroup.U15)
        self.assertEqual(result.games, 2)
        self.assertEqual(result.wins, 1)
        self.assertAlmostEqual(result.win_rate, 0.5, places=2)
        self.assertAlmostEqual(result.ppg, 69.5, places=1)
        self.assertIn("5 对 5", result.scope_label_zh)

    def test_cross_age_group_aggregation_raises(self):
        games = [
            GameStats("g1", Format.FIVE_V_FIVE, AgeGroup.U12, 50, 45, True),
            GameStats("g2", Format.FIVE_V_FIVE, AgeGroup.SENIOR, 80, 75, True),
        ]
        with self.assertRaises(CrossAgeGroupAggregationError):
            aggregate_guarded(games)

    def test_merged_win_rate_would_be_meaningless(self):
        """
        实证：合并统计会得到一个在篮球意义上无效的数字。
        5v5 的 1胜1负 与 3v3 的 1胜0负 合并成 "2胜1负 · 66.7%"，
        这个胜率不可比 —— 所以 UI 上不能提供"全部赛制"选项。
        """
        games = self._games()
        buckets = group_by_scope(games)

        self.assertEqual(len(buckets), 2, "应分成两个口径")

        five = aggregate(games, Format.FIVE_V_FIVE, AgeGroup.U15)
        three = aggregate(games, Format.THREE_V_THREE, AgeGroup.U15)

        self.assertAlmostEqual(five.win_rate, 0.5, places=2)
        self.assertAlmostEqual(three.win_rate, 1.0, places=2)

        naive_merged = sum(1 for g in games if g.won) / len(games)
        self.assertAlmostEqual(naive_merged, 0.6667, places=3)
        # 三个数字互不相同，证明"合并"会产出第四个无意义的口径
        self.assertNotAlmostEqual(naive_merged, five.win_rate, places=2)
        self.assertNotAlmostEqual(naive_merged, three.win_rate, places=2)


# ============================================================
# 绘图参数化
# ============================================================

class TestSvgParamsAreNotHardcoded(unittest.TestCase):
    """对应球队页设计 v0.2：球场底图 SVG 必须参数化，不能画死 6.75 m 弧线。"""

    def test_different_combos_yield_different_render_params(self):
        """
        FIBA 统一半径后，三分线不再随年龄段变化，差异只来自场地本身。
        底图仍必须参数化：全场 / 半场的长度、篮筐数、x 范围各不相同。
        """
        a = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR)).svg_render_params()
        b = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U12)).svg_render_params()
        c = build_court(resolve(Format.THREE_V_THREE, AgeGroup.U15)).svg_render_params()

        # 三分线：所有组合同一半径、同一几何
        for p in (a, b, c):
            self.assertAlmostEqual(p["three_point_radius_m"], 6.75, places=2)
            self.assertEqual(p["three_point_geometry"], "ARC_AND_CORNERS")
            self.assertAlmostEqual(p["corner_lateral_m"], 6.60, places=2)

        # 场地差异：全场 vs 半场
        self.assertEqual(a["court_type"], "FULL")
        self.assertEqual(c["court_type"], "HALF")
        self.assertEqual(a["hoop_count"], 2)
        self.assertEqual(c["hoop_count"], 1)
        self.assertAlmostEqual(a["length_m"], 28.0, places=2)
        self.assertAlmostEqual(c["length_m"], 11.0, places=2)
        self.assertAlmostEqual(a["y_half_m"], 7.5, places=2)
        self.assertAlmostEqual(c["y_half_m"], 7.5, places=2)
        self.assertAlmostEqual(a["x_range_m"][1], 26.425, places=2)
        self.assertAlmostEqual(c["x_range_m"][1], 9.425, places=2)

    def test_out_of_bounds_shot_is_flagged(self):
        """越界坐标说明标定有问题，必须被标记而不是静默采纳。"""
        court = build_court(resolve(Format.THREE_V_THREE, AgeGroup.U15))
        # 3x3 场地 15 m 宽 → 半宽 ±7.5，y=8.0 越界
        j = court.judge(Shot(x_m=5.0, y_m=8.0, made=True))
        self.assertFalse(j.in_bounds)


if __name__ == "__main__":
    unittest.main(verbosity=2)
