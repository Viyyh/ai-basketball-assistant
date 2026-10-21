"""
场地几何与投篮判定。

坐标系约定（全场与半场统一）：
    原点 = 本方进攻的篮筐中心
    x 轴 = 沿进攻方向，从篮筐指向中场（篮筐处 x=0，底线处 x = -baseline_to_hoop_m）
    y 轴 = 横向，篮筐正对的中轴为 y=0，向两侧边线为正负

这个约定让全场与半场共用同一套判定逻辑，
差别只在 x / y 的合法取值范围（由 CourtSpec 决定）。

对应范围确认 v0.2 第 5.3 节：
    场地标定按 format + age_group 参数驱动，不存在"默认按成人 5v5 处理"的隐式假设。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .params import (
    ActivityParams,
    CourtType,
    ThreePointGeometry,
)


@dataclass(frozen=True)
class Shot:
    """一次出手。坐标必须是标定后的米制坐标，不是像素。"""
    x_m: float
    y_m: float
    made: bool
    period: int = 1
    clock_s: float = 0.0

    @property
    def distance_m(self) -> float:
        """到篮筐中心的直线距离。"""
        return math.hypot(self.x_m, self.y_m)


@dataclass(frozen=True)
class ShotJudgement:
    """判定结果。"""
    shot: Shot
    distance_m: float
    behind_three_point_line: bool
    points_if_made: int
    points_awarded: int
    label_zh: str          # 界面显示用："三分" / "二分" / "远投(2分)" / "近投(1分)"
    in_bounds: bool
    geometry: ThreePointGeometry

    @property
    def made(self) -> bool:
        return self.shot.made


class CourtGeometry:
    """
    一块场地的几何。由 ActivityParams 构造，不接受散落的裸数字。

    这是界面侧"球场底图 SVG 必须参数化"那条要求（球队页设计 v0.2）
    在后端的对应物：同一个类同时服务于判定与绘图参数导出。
    """

    def __init__(self, params: ActivityParams):
        self.params = params
        self.court = params.court
        self.tp = params.three_point

        # x 的合法范围：底线（篮筐后方）到对侧
        self.x_min = -self.court.baseline_to_hoop_m
        if self.court.court_type is CourtType.FULL:
            self.x_max = self.court.length_m - self.court.baseline_to_hoop_m
        else:
            self.x_max = self.court.length_m - self.court.baseline_to_hoop_m

        self.y_half = self.court.width_m / 2.0

        # 底角直线段与弧线的交接点 x 坐标（仅"弧线+底角"几何有意义）
        self._corner_junction_x: float | None = None
        if (
            self.tp.geometry is ThreePointGeometry.ARC_AND_CORNERS
            and self.tp.corner_lateral_m is not None
            and self.tp.radius_m > self.tp.corner_lateral_m
        ):
            self._corner_junction_x = math.sqrt(
                self.tp.radius_m ** 2 - self.tp.corner_lateral_m ** 2
            )

    # ---------- 边界 ----------

    def in_bounds(self, x_m: float, y_m: float) -> bool:
        """坐标是否落在场地内。越界说明标定出了问题，应当告警而不是静默采纳。"""
        return (self.x_min - 1e-6 <= x_m <= self.x_max + 1e-6
                and abs(y_m) <= self.y_half + 1e-6)

    # ---------- 三分线判定 ----------

    def behind_three_point_line(self, x_m: float, y_m: float) -> bool:
        """
        是否在三分线外。

        两种几何分别处理，不能混用：

        ARC_AND_CORNERS（FIBA 成人 5v5）
            三分线由两段构成：
              · 弧线：距篮筐 radius_m
              · 底角直线：|y| = corner_lateral_m，从底线延伸到与弧线交接处
            判定：(|y| >= corner_lateral 且 x <= 交接点) 或 (距离 >= radius)

        PURE_ARC（FIBA 3x3；青少年小半径场地）
            判定：距离 >= radius

        用错几何的典型后果：
            成人几何套到 5.80 m 青少年场地上时，底角直线段（6.60 m）
            比弧线（5.80 m）还远，会产生"弧线内却是三分"的矛盾判定，
            而且不报错 —— 正是风险 7.4 描述的静默错误。
        """
        dist = math.hypot(x_m, y_m)

        if self.tp.geometry is ThreePointGeometry.PURE_ARC:
            return dist >= self.tp.radius_m

        # ARC_AND_CORNERS
        corner = self.tp.corner_lateral_m
        assert corner is not None, "ARC_AND_CORNERS 几何必须提供 corner_lateral_m"

        if self._corner_junction_x is not None and abs(y_m) >= corner \
                and x_m <= self._corner_junction_x:
            return True

        return dist >= self.tp.radius_m

    # ---------- 完整判定 ----------

    def judge(self, shot: Shot) -> ShotJudgement:
        """对一次出手做完整判定：分值、命中得分、界面标签、越界检查。"""
        behind = self.behind_three_point_line(shot.x_m, shot.y_m)
        rules = self.params.rules

        if behind:
            pts = rules.outside_arc_points
            label = self._outside_label()
        else:
            pts = rules.inside_arc_points
            label = self._inside_label()

        return ShotJudgement(
            shot=shot,
            distance_m=round(math.hypot(shot.x_m, shot.y_m), 3),
            behind_three_point_line=behind,
            points_if_made=pts,
            points_awarded=pts if shot.made else 0,
            label_zh=label,
            in_bounds=self.in_bounds(shot.x_m, shot.y_m),
            geometry=self.tp.geometry,
        )

    def _outside_label(self) -> str:
        """
        弧外得分的界面标签。

        3x3 不能叫"三分"——它只值 2 分。
        对应界面设计 v0.1.1 屏 02 与范围确认 v0.2 5.5 节的口径要求。
        """
        if self.params.fmt.value == "3V3":
            return "远投(2分)"
        return "三分"

    def _inside_label(self) -> str:
        if self.params.fmt.value == "3V3":
            return "近投(1分)"
        return "二分"

    # ---------- 绘图参数导出 ----------

    def svg_render_params(self) -> dict:
        """
        导出球场底图 SVG 需要的参数。

        对应球队页设计 v0.2 的要求：
        球场底图必须是参数化组件，接受 format 与 three_point_radius_m 入参，
        不能在代码里画死一条 6.75 m 的弧线。
        """
        return {
            "court_type": self.court.court_type.value,
            "length_m": self.court.length_m,
            "width_m": self.court.width_m,
            "hoop_count": self.court.hoop_count,
            "x_range_m": [round(self.x_min, 3), round(self.x_max, 3)],
            "y_half_m": round(self.y_half, 3),
            "three_point_geometry": self.tp.geometry.value,
            "three_point_radius_m": self.tp.radius_m,
            "corner_lateral_m": self.tp.corner_lateral_m,
            "corner_junction_x_m": (
                round(self._corner_junction_x, 3)
                if self._corner_junction_x is not None else None
            ),
        }


def build_court(params: ActivityParams) -> CourtGeometry:
    return CourtGeometry(params)
