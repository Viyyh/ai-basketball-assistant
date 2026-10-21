"""场地几何与投篮判定。

坐标系约定（全场与半场统一）：
    原点 = 本方进攻的篮筐中心
    x 轴 = 沿进攻方向，从篮筐指向中场（篮筐处 x=0，底线处 x=-1.575）
    y 轴 = 横向，篮筐正对的中轴为 y=0

这个约定让全场与半场共用同一套判定逻辑，差别只在坐标的合法取值范围。

**唯一的分值判定入口**。契约硬规则 #2：pipeline 不得自行判断几何，
任何时候要一个新分值都必须走 ``CourtGeometry.judge()``。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .table import (
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
        return math.hypot(self.x_m, self.y_m)


@dataclass(frozen=True)
class ShotJudgement:
    distance_m: float
    behind_three_point_line: bool
    shot_value: int          # 命中时的分值与实际计分值（未中为 0 由调用方处理）
    points_if_made: int
    points_awarded: int
    label_zh: str            # 三分 / 二分 / 远投(2分) / 近投(1分)
    in_bounds: bool
    geometry: ThreePointGeometry


class CourtGeometry:
    """一块场地的几何。由 ActivityParams 构造，不接受散落的裸数字。"""

    def __init__(self, params: ActivityParams):
        self.params = params
        self.court = params.court
        self.tp = params.three_point

        self.x_min = -self.court.baseline_to_hoop_m
        self.x_max = self.court.length_m - self.court.baseline_to_hoop_m
        self.y_half = self.court.y_half_m

    # ---------- 边界 ----------

    def in_bounds(self, x_m: float, y_m: float) -> bool:
        """坐标是否落在场地内。越界说明标定出了问题，应当告警而不是静默采纳。"""
        eps = 1e-6
        return (self.x_min - eps <= x_m <= self.x_max + eps
                and abs(y_m) <= self.y_half + eps)

    # ---------- 三分线判定 ----------

    def behind_three_point_line(self, x_m: float, y_m: float) -> bool:
        """
        是否在三分线**外**（即三分中篮区域内）。

        FIBA 规则 2.5.4 明写"3 分线不是 3 分中篮区域的一部分"，
        所以踩线、线上、线内一律算两分 —— 边界比较必须是严格大于。

        半径 6.75 m 量到线的**外沿**，线宽 5 cm。用严格大于意味着
        (6.749, 0) 算两分、(6.751, 0) 算三分，与"线宽范围内的点都算线上"等价。

        PURE_ARC：距离 > 半径。

        ARC_AND_CORNERS：三分线由两段构成 —— 弧线（距篮筐 radius）与
        底角直线（|y| = corner_lateral，从底线延伸到与弧线交接处）。
        判定：(|y| > corner 且 x < 交接点) 或 (距离 > radius)。

        用错几何的后果：成人几何套到 5.80 m 小球场地上时，底角直线段（6.60 m）
        比弧线（5.80 m）还远，产生"弧线内却是三分"的矛盾判定，而且不报错。
        """
        if self.tp.geometry is ThreePointGeometry.PURE_ARC:
            return math.hypot(x_m, y_m) > self.tp.radius_m

        corner = self.tp.corner_lateral_m
        junction = self.tp.corner_junction_x_m
        if corner is None or junction is None:  # pragma: no cover - 构造期已保证
            raise ValueError("ARC_AND_CORNERS 几何缺少底角参数")

        if abs(y_m) > corner and x_m < junction:
            return True

        return math.hypot(x_m, y_m) > self.tp.radius_m

    # ---------- 完整判定 ----------

    def judge(self, shot: Shot) -> ShotJudgement:
        """对一次出手做完整判定：分值、界面标签、越界检查。"""
        behind = self.behind_three_point_line(shot.x_m, shot.y_m)
        rules = self.params.rules
        points = rules.outside_arc_points if behind else rules.inside_arc_points

        return ShotJudgement(
            distance_m=round(shot.distance_m, 3),
            behind_three_point_line=behind,
            shot_value=points,
            points_if_made=points,
            points_awarded=points if shot.made else 0,
            label_zh=self._label(behind, points),
            in_bounds=self.in_bounds(shot.x_m, shot.y_m),
            geometry=self.tp.geometry,
        )

    def _label(self, behind: bool, points: int) -> str:
        """
        界面标签。3x3 不能叫"三分"——它只值 2 分。

        统一由这里产出，避免前端各处自己拼文案（旧 demo 出现过"弧外命中率"
        与"三分"两套说法并存）。
        """
        if self.params.fmt.value == "3V3":
            return f"远投({points}分)" if behind else f"近投({points}分)"
        return "三分" if behind else "二分"

    # ---------- 绘图参数导出 ----------

    def svg_params(self) -> dict:
        """球场底图 SVG 的参数。前端不得画死一条 6.75 m 的弧线。"""
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
                round(self.tp.corner_junction_x_m, 4)
                if self.tp.corner_junction_x_m is not None else None
            ),
            "marks": self.params.marks.as_dict(),
        }


def build_court(params: ActivityParams) -> CourtGeometry:
    return CourtGeometry(params)
