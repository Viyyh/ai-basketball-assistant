"""完整配置层测试：预设、覆盖、校验、快照、预览。"""

from __future__ import annotations

import unittest

from basketball_params import (
    ConfigError,
    DEFAULT_VALUES,
    FIELDS,
    Format,
    AgeGroup,
    PRESETS,
    parse_override,
    parse_scalar,
    resolve,
    resolve_config,
)
from basketball_params.preview import render_court_svg


class SchemaTest(unittest.TestCase):
    def test_every_default_has_a_field(self):
        self.assertEqual(set(DEFAULT_VALUES), {f.key for f in FIELDS})
        self.assertEqual(len({f.key for f in FIELDS}), len(FIELDS))

    def test_groups_and_required(self):
        groups = {f.group for f in FIELDS}
        self.assertEqual(groups, {"court", "three_point", "marks", "rules"})
        self.assertTrue(next(f for f in FIELDS if f.key == "court_length_m").required)

    def test_parse_scalar(self):
        self.assertEqual(parse_scalar("10"), 10)
        self.assertEqual(parse_scalar("10.5"), 10.5)
        self.assertIs(parse_scalar("true"), True)
        self.assertIsNone(parse_scalar("none"))
        self.assertEqual(parse_scalar("NBA"), "NBA")

    def test_parse_override_rejects_unknown(self):
        with self.assertRaises(ConfigError):
            parse_override("not_a_field=1")


class PresetTest(unittest.TestCase):
    def test_all_presets_resolve_and_cover_every_field(self):
        for preset in PRESETS:
            with self.subTest(preset=preset.id):
                result = resolve_config(preset.id)
                self.assertEqual(set(result.values), set(DEFAULT_VALUES))
                self.assertEqual(result.base, preset.id)
                self.assertTrue(result.config_hash)
                self.assertIn(preset.label_zh, result.label_zh)

    def test_nba_values(self):
        result = resolve_config("nba")
        self.assertAlmostEqual(result.values["court_length_m"], 28.65)
        self.assertAlmostEqual(result.values["court_width_m"], 15.24)
        self.assertAlmostEqual(result.values["three_point_radius_m"], 7.24)
        self.assertAlmostEqual(result.values["corner_lateral_m"], 6.71)
        self.assertEqual(result.params.three_point.geometry.value, "ARC_AND_CORNERS")
        self.assertAlmostEqual(result.params.three_point.corner_junction_x_m,
                               2.719099, places=5)

    def test_cba_only_changes_period_length(self):
        fiba = resolve_config("fiba")
        cba = resolve_config("cba")
        self.assertEqual(cba.values["period_minutes"], 12.0)
        self.assertEqual(cba.values["court_length_m"], fiba.values["court_length_m"])
        self.assertNotEqual(cba.config_hash, fiba.config_hash)

    def test_three_x_three(self):
        result = resolve_config("three-x-three")
        # 3x3 场地 15 m 宽，半宽 7.5 m > 6.60 m，保留底角直线段（ADR-014）
        self.assertEqual(result.params.three_point.geometry.value, "ARC_AND_CORNERS")
        self.assertAlmostEqual(result.params.three_point.corner_lateral_m, 6.60)
        self.assertEqual(result.values["inside_arc_points"], 1)
        self.assertEqual(result.values["outside_arc_points"], 2)
        self.assertEqual(result.values["period_count"], 1)
        self.assertEqual(result.values["shot_clock_s"], 12)
        self.assertEqual(result.values["win_score"], 21)
        self.assertFalse(result.values["fast_break_enabled"])

    def test_half_court_preset(self):
        result = resolve_config("half-court")
        self.assertEqual(result.values["court_type"], "HALF")
        self.assertEqual(result.params.court.hoop_count, 1)
        self.assertEqual(result.params.fmt, Format.FOUR_V_FOUR)


class OverrideTest(unittest.TestCase):
    def test_override_wins_and_is_marked_manual(self):
        result = resolve_config("nba", {"period_minutes": 10})
        self.assertEqual(result.values["period_minutes"], 10)
        self.assertEqual(result.sources["period_minutes"], "manual")
        self.assertEqual(result.overrides, ("period_minutes",))
        self.assertIn("4×10", result.label_zh)

    def test_override_can_turn_off_corners(self):
        result = resolve_config("fiba", {"corner_lateral_m": None})
        self.assertEqual(result.params.three_point.geometry.value, "PURE_ARC")
        self.assertIsNone(result.values["corner_lateral_m"])
        self.assertEqual(result.sources["corner_lateral_m"], "manual")

    def test_override_changes_hash_deterministically(self):
        a = resolve_config("fiba", {"period_minutes": 10})
        b = resolve_config("fiba", {"period_minutes": 10.0})
        c = resolve_config("fiba", {"period_minutes": 12})
        self.assertEqual(a.config_hash, b.config_hash)
        self.assertNotEqual(a.config_hash, c.config_hash)
        self.assertEqual(len(a.config_hash), 64)

    def test_unknown_override(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"three_point_radius": 6.75})

    def test_type_coercion(self):
        result = resolve_config("fiba", {"shot_clock_s": "24", "fast_break_enabled": "false"})
        self.assertEqual(result.values["shot_clock_s"], 24)
        self.assertFalse(result.values["fast_break_enabled"])

    def test_unconfirmed_keeps_value_but_warns(self):
        result = resolve_config("fiba", unconfirmed=["period_minutes"])
        self.assertEqual(result.values["period_minutes"], 10.0)
        self.assertEqual(result.sources["period_minutes"], "unconfirmed")
        self.assertEqual(result.unconfirmed, ("period_minutes",))
        self.assertTrue(any("尚未确认" in w for w in result.warnings))

    def test_to_public_contract(self):
        public = resolve_config("nba").to_public()
        self.assertEqual(
            set(public),
            {"base", "label", "hash", "format", "age_group", "values",
             "sources", "overrides", "unconfirmed", "warnings"},
        )


class ValidationTest(unittest.TestCase):
    def test_corner_must_be_smaller_than_radius(self):
        with self.assertRaises(ConfigError) as ctx:
            resolve_config("nba", {"corner_lateral_m": 7.5})
        self.assertIn("底角", str(ctx.exception))

    def test_preset_corner_degrades_when_court_too_narrow(self):
        result = resolve_config("fiba", {"court_width_m": 12.0})
        self.assertEqual(result.params.three_point.geometry.value, "PURE_ARC")
        self.assertTrue(any("超出场地半宽" in w for w in result.warnings))

    def test_manual_corner_outside_court_is_an_error(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"court_width_m": 9.0, "corner_lateral_m": 5.0})

    def test_full_court_must_be_longer_than_wide(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"court_length_m": 14.0})

    def test_half_court_length_sanity(self):
        with self.assertRaises(ConfigError):
            resolve_config("half-court", {"court_length_m": 28.0})

    def test_free_throw_line_must_be_inside(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"free_throw_line_m": 40.0})

    def test_shot_clock_cannot_exceed_period(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"period_minutes": 0.5, "shot_clock_s": 60})

    def test_points_order(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"inside_arc_points": 3, "outside_arc_points": 3})

    def test_range_limits(self):
        with self.assertRaises(ConfigError):
            resolve_config("fiba", {"court_width_m": 42})

    def test_3v3_value_consistency_warns_but_does_not_block(self):
        result = resolve_config("three-x-three", {"period_count": 4, "shot_clock_s": 24})
        joined = "；".join(result.warnings)
        self.assertIn("单节", joined)
        self.assertIn("12 秒", joined)


class ResolveLegacyTest(unittest.TestCase):
    """老入口保留；3x3 的几何与 5v5 一致，都是弧线 + 底角（ADR-014）。"""

    def test_5v5_keeps_corners(self):
        params = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
        self.assertEqual(params.three_point.geometry.value, "ARC_AND_CORNERS")

    def test_3v3_keeps_corners(self):
        params = resolve(Format.THREE_V_THREE, AgeGroup.U15)
        self.assertEqual(params.three_point.geometry.value, "ARC_AND_CORNERS")
        self.assertAlmostEqual(params.three_point.corner_lateral_m, 6.60)

    def test_explicit_corner_override(self):
        params = resolve(Format.FIVE_V_FIVE, AgeGroup.U15, corner_lateral_m=None)
        self.assertEqual(params.three_point.geometry.value, "PURE_ARC")


class PreviewTest(unittest.TestCase):
    def test_svg_has_title_and_closed_root(self):
        svg = render_court_svg(resolve_config("nba").params)
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn("NBA", svg)
        self.assertTrue(svg.rstrip().endswith("</svg>"))
        self.assertIn("7.24", svg)

    def test_3v3_has_lane_and_corners(self):
        params = resolve_config("three-x-three").params
        self.assertEqual(params.three_point.geometry.value, "ARC_AND_CORNERS")
        svg = render_court_svg(params)
        self.assertIn("底角 6.60", svg)
        self.assertIn("三分 6.75", svg)

    def test_preview_contains_all_presets(self):
        for preset in PRESETS:
            with self.subTest(preset=preset.id):
                svg = render_court_svg(resolve_config(preset.id).params, width=720)
                self.assertIn("<svg", svg)
                self.assertNotIn("NaN", svg)


if __name__ == "__main__":
    unittest.main()
