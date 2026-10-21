"""赛制与年龄段参数表 —— 全系统唯一真源。

设计原则：三分线半径、场地模板、计分规则全部由本表驱动，业务代码与 AI
pipeline 里不允许出现任何硬编码的魔法数字（否则同一场比赛的报告与界面会各算一套）。

三分线口径（2026-10-21 由产品负责人确认）：
    **统一使用 FIBA 成人标准 6.75 m + 底角直线段（横向 6.60 m）**。
    原 demo 里 U8~U15 的 5.80 m 假设值作废。
    若某梯队确实打小球（5.80 / 6.00 / 6.25 等），在新建活动时显式传入
    ``three_point_radius_m`` 覆盖，不要改这里的表 —— 改表会让所有历史报告一起变。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ============================================================
# 枚举
# ============================================================

class Format(str, Enum):
    """赛制。存库用 value，界面显示 label_zh。"""

    FIVE_V_FIVE = "5V5"
    FOUR_V_FOUR = "4V4"
    THREE_V_THREE = "3V3"
    CUSTOM = "CUSTOM"

    @property
    def label_zh(self) -> str:
        return {
            "5V5": "5 对 5",
            "4V4": "4 对 4",
            "3V3": "3 对 3",
            "CUSTOM": "自定义",
        }[self.value]


class CourtType(str, Enum):
    """场地类型。决定使用哪一套标定模板与球场底图。"""

    FULL = "FULL"
    HALF = "HALF"

    @property
    def label_zh(self) -> str:
        return {"FULL": "全场双框", "HALF": "半场单框"}[self.value]


class AgeGroup(str, Enum):
    U8 = "U8"
    U12 = "U12"
    U15 = "U15"
    U18 = "U18"
    SENIOR = "SENIOR"

    @property
    def label_zh(self) -> str:
        return {
            "U8": "8 岁以下",
            "U12": "12 岁以下",
            "U15": "15 岁以下",
            "U18": "18 岁以下",
            "SENIOR": "一线",
        }[self.value]

    @property
    def is_minor(self) -> bool:
        """是否未成年人 —— 决定合规等级（监护人同意、保留期）。"""
        return self is not AgeGroup.SENIOR


class ThreePointGeometry(str, Enum):
    """
    三分线几何形态。

    三分线不是"一个半径"能描述的：
        ARC_AND_CORNERS —— 弧线 + 底角直线段（FIBA 成人标准）
        PURE_ARC        —— 纯弧线，无底角直线段（3x3、窄场地、小半径青少年场地）

    两者判定逻辑不同，混用会产生"看起来正常但全错"的分值判定。
    """

    ARC_AND_CORNERS = "ARC_AND_CORNERS"
    PURE_ARC = "PURE_ARC"

    @property
    def label_zh(self) -> str:
        return {
            "ARC_AND_CORNERS": "弧线 + 底角直线",
            "PURE_ARC": "纯弧线",
        }[self.value]


# ============================================================
# FIBA 常量
# ============================================================

FIBA_BASELINE_TO_HOOP_M = 1.575
FIBA_FULL_LENGTH_M = 28.0
FIBA_FULL_WIDTH_M = 15.0
# FIBA 3x3 场地是 **15 m 宽 × 11 m 长**（宽 > 长，与 5v5 的 28×15 同宽）
FIBA_3X3_LENGTH_M = 11.0
FIBA_3X3_WIDTH_M = 15.0
FIBA_3PT_RADIUS_M = 6.75
FIBA_CORNER_LATERAL_M = 6.60   # 边线内沿 0.90 m 处 → 15/2 - 0.90

# 场地标线（FIBA 规则 2.5）。只用于绘图，不参与分值判定。
FIBA_FREETHROW_LINE_M = 5.80        # 罚球线外沿距端线内沿
FIBA_RESTRICTED_AREA_WIDTH_M = 4.90 # 限制区宽 = 2 × 2.45
FIBA_CENTER_CIRCLE_RADIUS_M = 1.80  # 中圈半径（外沿丈量）
FIBA_NO_CHARGE_RADIUS_M = 1.30      # 无撞人半圆区半径
FIBA_THROW_IN_LINE_M = 8.325        # 掷球入界线外沿距最近端线内沿
FIBA_LINE_WIDTH_M = 0.05            # 所有标线宽 5 cm


# ============================================================
# 数据结构
# ============================================================

@dataclass(frozen=True)
class CourtSpec:
    """场地几何。坐标系原点 = 本方进攻的篮筐中心。"""

    court_type: CourtType
    length_m: float
    width_m: float
    hoop_count: int
    baseline_to_hoop_m: float

    @property
    def y_half_m(self) -> float:
        return self.width_m / 2.0


@dataclass(frozen=True)
class ThreePointSpec:
    geometry: ThreePointGeometry
    radius_m: float
    corner_lateral_m: Optional[float] = None
    corner_junction_x_m: Optional[float] = None

    @property
    def has_corners(self) -> bool:
        return self.geometry is ThreePointGeometry.ARC_AND_CORNERS


@dataclass(frozen=True)
class RulesSpec:
    inside_arc_points: int
    outside_arc_points: int
    shot_clock_s: Optional[int]
    period_count: int
    period_minutes: float
    fast_break_enabled: bool
    win_score: Optional[int] = None


@dataclass(frozen=True)
class CourtMarks:
    """
    场地标线尺寸（FIBA 规则 2.5）。

    这些数字决定"球场画得对不对"，不参与二分/三分判定 ——
    判定只看三分线（`ThreePointSpec`）。分开是因为两者的变更理由不同：
    线宽/圆圈属于装饰，三分线一改就会动到分值。
    """

    free_throw_line_m: float = FIBA_FREETHROW_LINE_M
    restricted_area_length_m: float = FIBA_FREETHROW_LINE_M
    restricted_area_width_m: float = FIBA_RESTRICTED_AREA_WIDTH_M
    center_circle_radius_m: float = FIBA_CENTER_CIRCLE_RADIUS_M
    no_charge_radius_m: float = FIBA_NO_CHARGE_RADIUS_M
    throw_in_line_offset_m: float = FIBA_THROW_IN_LINE_M
    line_width_m: float = FIBA_LINE_WIDTH_M

    def as_dict(self) -> dict:
        return {
            "free_throw_line_m": self.free_throw_line_m,
            "restricted_area_length_m": self.restricted_area_length_m,
            "restricted_area_width_m": self.restricted_area_width_m,
            "center_circle_radius_m": self.center_circle_radius_m,
            "no_charge_radius_m": self.no_charge_radius_m,
            "throw_in_line_offset_m": self.throw_in_line_offset_m,
            "line_width_m": self.line_width_m,
        }


@dataclass(frozen=True)
class TrackingSpec:
    players_per_team: int
    formation_points: int
    formation_sample_interval_s: float = 5.0


@dataclass(frozen=True)
class ActivityParams:
    """一场活动解析后的完整参数 —— pipeline 的唯一入参。"""

    fmt: Format
    age_group: AgeGroup
    court: CourtSpec
    three_point: ThreePointSpec
    rules: RulesSpec
    tracking: TrackingSpec
    marks: CourtMarks = field(default_factory=CourtMarks)
    unverified: tuple[str, ...] = ()

    @property
    def scope_label_zh(self) -> str:
        """口径标识，必须常驻报告页与球队数据页。"""
        return (
            f"{self.fmt.label_zh} · {self.age_group.label_zh} · "
            f"三分线 {self.three_point.radius_m:.2f} m"
        )

    def to_contract(self) -> dict:
        """导出契约 params 段。字段名与 contracts/report.schema.json 一一对应。"""
        x_min = -self.court.baseline_to_hoop_m
        x_max = self.court.length_m - self.court.baseline_to_hoop_m
        return {
            "format": self.fmt.value,
            "age_group": self.age_group.value,
            "court_type": self.court.court_type.value,
            "three_point_radius_m": self.three_point.radius_m,
            "three_point_geometry": self.three_point.geometry.value,
            "corner_lateral_m": self.three_point.corner_lateral_m,
            "corner_junction_x_m": (
                round(self.three_point.corner_junction_x_m, 4)
                if self.three_point.corner_junction_x_m is not None
                else None
            ),
            "period_count": self.rules.period_count,
            "period_minutes": self.rules.period_minutes,
            "shot_clock_s": self.rules.shot_clock_s,
            "inside_arc_points": self.rules.inside_arc_points,
            "outside_arc_points": self.rules.outside_arc_points,
            "fast_break_enabled": self.rules.fast_break_enabled,
            "formation_points": self.tracking.formation_points,
            "court_length_m": self.court.length_m,
            "court_width_m": self.court.width_m,
            "baseline_to_hoop_m": self.court.baseline_to_hoop_m,
            "x_range_m": [round(x_min, 3), round(x_max, 3)],
            "y_half_m": round(self.court.y_half_m, 3),
        }


# ============================================================
# 表格
# ============================================================

COURT_FULL = CourtSpec(CourtType.FULL, FIBA_FULL_LENGTH_M, FIBA_FULL_WIDTH_M, 2,
                       FIBA_BASELINE_TO_HOOP_M)
COURT_HALF_FULL_COURT = CourtSpec(CourtType.HALF, FIBA_FULL_LENGTH_M / 2,
                                  FIBA_FULL_WIDTH_M, 1, FIBA_BASELINE_TO_HOOP_M)
COURT_3X3 = CourtSpec(CourtType.HALF, FIBA_3X3_LENGTH_M, FIBA_3X3_WIDTH_M, 1,
                      FIBA_BASELINE_TO_HOOP_M)

#: 三分线半径默认值。已确认统一 6.75 m；保留字典是为了将来按联赛分组。
THREE_POINT_RADIUS_BY_AGE: dict[AgeGroup, float] = {
    AgeGroup.U8: FIBA_3PT_RADIUS_M,
    AgeGroup.U12: FIBA_3PT_RADIUS_M,
    AgeGroup.U15: FIBA_3PT_RADIUS_M,
    AgeGroup.U18: FIBA_3PT_RADIUS_M,
    AgeGroup.SENIOR: FIBA_3PT_RADIUS_M,
}

#: 单节时长默认值（分钟）。教练可在新建活动时修改，不回写本表。
PERIOD_MINUTES_BY_AGE: dict[AgeGroup, float] = {
    AgeGroup.U8: 6.0,
    AgeGroup.U12: 8.0,
    AgeGroup.U15: 8.0,
    AgeGroup.U18: 10.0,
    AgeGroup.SENIOR: 10.0,
}

PLAYERS_PER_TEAM: dict[Format, int] = {
    Format.FIVE_V_FIVE: 5,
    Format.FOUR_V_FOUR: 4,
    Format.THREE_V_THREE: 3,
    Format.CUSTOM: 5,
}


# ============================================================
# 几何形态判定
# ============================================================

def resolve_three_point(radius_m: float, court: CourtSpec) -> ThreePointSpec:
    """
    由「半径 + 场地」推出三分线几何形态。

    底角直线段能存在的充要条件：
        1. 半径 > 底角横向距离。否则弧线永远碰不到底角线的位置，
           会出现"底角直线段落在弧线内侧"的自相矛盾几何。
        2. 场地半宽 > 底角横向距离。窄场地（半宽 ≤ 6.60 m）上底角直线段
           根本不在场内，例如 12 m 宽的青少年场地、26×14 的旧规格球场。

    任何一条不满足就退化为纯弧线。这条规则同时覆盖了
    "3x3 用纯弧"和"青少年小球场地用纯弧"两种情况，不需要分支特判。
    """
    if radius_m <= 0:
        raise ValueError(f"三分线半径必须为正数，收到 {radius_m}")

    has_corners = (
        radius_m > FIBA_CORNER_LATERAL_M
        and court.y_half_m > FIBA_CORNER_LATERAL_M
    )

    if not has_corners:
        return ThreePointSpec(
            geometry=ThreePointGeometry.PURE_ARC,
            radius_m=radius_m,
            corner_lateral_m=None,
            corner_junction_x_m=None,
        )

    junction = math.sqrt(radius_m ** 2 - FIBA_CORNER_LATERAL_M ** 2)
    return ThreePointSpec(
        geometry=ThreePointGeometry.ARC_AND_CORNERS,
        radius_m=radius_m,
        corner_lateral_m=FIBA_CORNER_LATERAL_M,
        corner_junction_x_m=junction,
    )


# ============================================================
# 解析入口
# ============================================================

def resolve(
    fmt: Format,
    age_group: AgeGroup,
    court_type: Optional[CourtType] = None,
    three_point_radius_m: Optional[float] = None,
) -> ActivityParams:
    """
    把 (赛制, 年龄段) 解析成一场活动的完整参数。

    :param court_type: 4v4 与自定义赛制必须显式指定（界面上选中后追问一次）。
    :param three_point_radius_m: 覆盖默认 6.75 m。仅在某个联赛确实打小球时使用。
    """
    if fmt is Format.THREE_V_THREE:
        court = COURT_3X3
    elif fmt is Format.FIVE_V_FIVE:
        court = COURT_FULL
    elif fmt in (Format.FOUR_V_FOUR, Format.CUSTOM):
        if court_type is None:
            raise ValueError(
                f"{fmt.label_zh} 没有统一规则，必须显式指定 court_type（全场 / 半场）"
            )
        court = COURT_FULL if court_type is CourtType.FULL else COURT_HALF_FULL_COURT
    else:
        raise ValueError(f"未知赛制：{fmt}")

    radius = three_point_radius_m or THREE_POINT_RADIUS_BY_AGE[age_group]
    three_point = resolve_three_point(radius, court)

    if fmt is Format.THREE_V_THREE:
        rules = RulesSpec(
            inside_arc_points=1,
            outside_arc_points=2,
            shot_clock_s=12,
            period_count=1,
            period_minutes=10.0,
            fast_break_enabled=False,   # 3x3 第一版不做快攻识别
            win_score=21,
        )
    else:
        rules = RulesSpec(
            inside_arc_points=2,
            outside_arc_points=3,
            shot_clock_s=24,
            period_count=4,
            period_minutes=PERIOD_MINUTES_BY_AGE[age_group],
            fast_break_enabled=True,
        )

    players = PLAYERS_PER_TEAM[fmt]
    tracking = TrackingSpec(players_per_team=players, formation_points=players)

    unverified: list[str] = []
    if fmt is not Format.THREE_V_THREE:
        unverified.append(
            f"单节时长 {rules.period_minutes:g} 分钟（{age_group.label_zh}）为默认值，"
            f"需按实际联赛确认"
        )
    if three_point_radius_m is not None and three_point_radius_m != FIBA_3PT_RADIUS_M:
        unverified.append(
            f"三分线半径 {three_point_radius_m:g} m 为人工覆盖值，非默认 6.75 m"
        )

    return ActivityParams(
        fmt=fmt,
        age_group=age_group,
        court=court,
        three_point=three_point,
        rules=rules,
        tracking=tracking,
        unverified=tuple(unverified),
    )
