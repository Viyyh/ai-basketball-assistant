"""
赛制与年龄段参数表 —— 全系统唯一真源（single source of truth）。

对应《第一版范围确认 v0.2》5.5 节。

设计原则（对应风险 7.4 的应对措施第 3 条）：
    三分线半径、场地模板、进攻时限全部由本表驱动，
    业务代码与 AI pipeline 里不允许出现任何硬编码的魔法数字。

标注 [待核实] 的数值需要在开发前向实际执裁的联赛规则确认，
run_poc.py 会把它们汇总打印出来。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


# ============================================================
# 枚举
# ============================================================

class Format(str, Enum):
    """赛制。存库时用 .value（大写字符串），界面显示中文标签。"""
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
    """场地类型。决定使用哪一套标定模板。"""
    FULL = "FULL"   # 全场双框
    HALF = "HALF"   # 半场单框

    @property
    def label_zh(self) -> str:
        return {"FULL": "全场双框", "HALF": "半场单框"}[self.value]


class AgeGroup(str, Enum):
    """年龄段。存库时用 .value，界面显示中文标签。"""
    U8 = "U8"
    U12 = "U12"
    U15 = "U15"
    U18 = "U18"
    SENIOR = "SENIOR"

    @property
    def label_zh(self) -> str:
        return {
            "U8": "8岁以下",
            "U12": "12岁以下",
            "U15": "15岁以下",
            "U18": "18岁以下",
            "SENIOR": "一线",
        }[self.value]

    @property
    def is_minor(self) -> bool:
        """是否未成年人 —— 决定合规等级（范围确认 7.3）。"""
        return self is not AgeGroup.SENIOR


class ThreePointGeometry(str, Enum):
    """
    三分线几何形态。

    这是 PoC 阶段发现的关键细节：三分线不是"一个半径"就能描述的。
      ARC_AND_CORNERS —— 弧线 + 底角直线段（FIBA 5v5 成人标准）
      PURE_ARC        —— 纯弧线，无底角直线段（FIBA 3x3；以及半径小于底角横向距离的青少年场地）

    两种几何的判定逻辑不同，用错会产生"看起来正常但全错"的分值判定。
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
# 数据结构
# ============================================================

@dataclass(frozen=True)
class CourtSpec:
    """场地几何规格。坐标系原点 = 本方进攻的篮筐中心。"""
    court_type: CourtType
    length_m: float          # 沿进攻方向的场地长度
    width_m: float           # 横向宽度
    hoop_count: int          # 篮框数量（标定模板数量的依据）
    baseline_to_hoop_m: float  # 底线内沿到篮筐中心的距离，FIBA = 1.575


@dataclass(frozen=True)
class ThreePointSpec:
    """三分线规格。"""
    geometry: ThreePointGeometry
    radius_m: float                       # 弧线半径（从篮筐中心量起）
    corner_lateral_m: Optional[float]     # 底角直线段的横向距离；纯弧线时为 None
    verified: bool = False                # 数值是否已对照实际联赛规则核实
    note: str = ""


@dataclass(frozen=True)
class RulesSpec:
    """计分与时间规则。"""
    inside_arc_points: int     # 弧线内得分
    outside_arc_points: int    # 弧线外得分
    shot_clock_s: Optional[int]  # 进攻时限（秒）；无固定时限时为 None
    period_count: int          # 节数
    period_minutes: float      # 单节时长（分钟）
    fast_break_enabled: bool   # 第一版是否启用快攻识别
    fast_break_max_possession_s: Optional[float]  # 快攻判定的回合时长上限
    win_score: Optional[int]   # 得分获胜制（3x3 = 21）；无则为 None


@dataclass(frozen=True)
class TrackingSpec:
    """跟踪与阵型参数。"""
    players_per_team: int      # 每队人数
    formation_points: int      # 阵型快照点数
    max_tracked_targets: int   # 多目标跟踪的目标数上限
    formation_sample_interval_s: float  # 阵型采样间隔


@dataclass(frozen=True)
class ActivityParams:
    """
    一场活动的完整解析后参数。

    由 resolve() 根据 Format + AgeGroup 查表得出，是传给 AI pipeline 的唯一入参。
    pipeline 内部不允许再自行假设任何默认值。
    """
    fmt: Format
    age_group: AgeGroup
    court: CourtSpec
    three_point: ThreePointSpec
    rules: RulesSpec
    tracking: TrackingSpec
    unverified: tuple[str, ...]  # 本组参数中尚未核实的数值说明

    @property
    def three_point_radius_m(self) -> float:
        return self.three_point.radius_m

    @property
    def shot_clock_s(self) -> Optional[int]:
        return self.rules.shot_clock_s

    @property
    def court_type(self) -> CourtType:
        return self.court.court_type


# ============================================================
# 常量：FIBA 标准场地
# ============================================================

FIBA_BASELINE_TO_HOOP_M = 1.575   # 底线内沿到篮筐中心
FIBA_FULL_LENGTH_M = 28.0
FIBA_FULL_WIDTH_M = 15.0
FIBA_3X3_LENGTH_M = 15.0          # 3x3 半场：15 m（底线到中线）
FIBA_3X3_WIDTH_M = 11.0           # 3x3 半场：11 m 宽
FIBA_ADULT_3PT_RADIUS_M = 6.75
FIBA_CORNER_LATERAL_M = 6.60      # 底角直线段：距边线内沿 0.90 m → 15/2 - 0.90

COURT_FULL = CourtSpec(
    court_type=CourtType.FULL,
    length_m=FIBA_FULL_LENGTH_M,
    width_m=FIBA_FULL_WIDTH_M,
    hoop_count=2,
    baseline_to_hoop_m=FIBA_BASELINE_TO_HOOP_M,
)

COURT_HALF_3X3 = CourtSpec(
    court_type=CourtType.HALF,
    length_m=FIBA_3X3_LENGTH_M,
    width_m=FIBA_3X3_WIDTH_M,
    hoop_count=1,
    baseline_to_hoop_m=FIBA_BASELINE_TO_HOOP_M,
)


# ============================================================
# 三分线：几何形态判定
# ============================================================

def three_point_spec_for(fmt: Format, age_group: AgeGroup) -> ThreePointSpec:
    """
    查表得出三分线规格。

    几何形态的判定规则（这是 PoC 的核心发现之一）：
      1. 3x3 一律是纯弧线 —— FIBA 3x3 规则明确"整条弧都在 6.75 m"，无底角直线段
      2. 5v5 / 4v4 在成人半径（6.75 m）下是"弧线 + 底角直线"
      3. 青少年半径（5.80 m 等）小于底角横向距离 6.60 m 时，
         弧线永远碰不到底角直线的位置，几何上只能是纯弧线

    第 3 条如果没处理，会出现"底角直线段在弧线内侧"的自相矛盾几何，
    判定逻辑会给出错误结果且不报错。
    """
    # 3x3：FIBA 规则固定为纯弧 6.75 m
    if fmt is Format.THREE_V_THREE:
        return ThreePointSpec(
            geometry=ThreePointGeometry.PURE_ARC,
            radius_m=FIBA_ADULT_3PT_RADIUS_M,
            corner_lateral_m=None,
            verified=True,
            note="FIBA 3x3：整条弧 6.75 m，无底角直线段",
        )

    radius = _youth_or_adult_radius(age_group)
    verified = age_group in (AgeGroup.U18, AgeGroup.SENIOR)

    # 半径小于底角横向距离 → 只能是纯弧
    if radius < FIBA_CORNER_LATERAL_M:
        return ThreePointSpec(
            geometry=ThreePointGeometry.PURE_ARC,
            radius_m=radius,
            corner_lateral_m=None,
            verified=verified,
            note=(
                f"半径 {radius} m < 底角横向 {FIBA_CORNER_LATERAL_M} m，"
                f"几何上退化为纯弧线"
            ),
        )

    return ThreePointSpec(
        geometry=ThreePointGeometry.ARC_AND_CORNERS,
        radius_m=radius,
        corner_lateral_m=FIBA_CORNER_LATERAL_M,
        verified=verified,
        note="FIBA 成人标准：弧线 6.75 m + 底角直线段（横向 6.60 m）",
    )


def _youth_or_adult_radius(age_group: AgeGroup) -> float:
    """
    三分线半径查表。

    [待核实] U8 / U12 / U15 的 5.80 m 是《范围确认 v0.2》采用的假设值。
    各地青少年联赛标准并不统一（常见 5.80 m / 6.00 m / 6.25 m），
    必须在开发前向教练实际执裁的联赛规则核对，否则二分/三分判定会整场全错。
    """
    return {
        AgeGroup.U8: 5.80,
        AgeGroup.U12: 5.80,
        AgeGroup.U15: 5.80,
        AgeGroup.U18: FIBA_ADULT_3PT_RADIUS_M,
        AgeGroup.SENIOR: FIBA_ADULT_3PT_RADIUS_M,
    }[age_group]


# ============================================================
# 规则参数
# ============================================================

def rules_spec_for(fmt: Format, age_group: AgeGroup) -> RulesSpec:
    """查表得出计分与时间规则。"""
    if fmt is Format.THREE_V_THREE:
        return RulesSpec(
            inside_arc_points=1,          # FIBA 3x3：弧内 1 分
            outside_arc_points=2,         # FIBA 3x3：弧外 2 分
            shot_clock_s=12,              # FIBA 3x3：12 秒
            period_count=1,               # 单节
            period_minutes=10.0,          # 10 分钟
            fast_break_enabled=False,     # 范围确认 v0.2 第六节：第一版关闭
            fast_break_max_possession_s=None,
            win_score=21,                 # 先得 21 分获胜
        )

    period_minutes = _period_minutes(age_group)
    return RulesSpec(
        inside_arc_points=2,
        outside_arc_points=3,
        shot_clock_s=24,
        period_count=4,
        period_minutes=period_minutes,
        fast_break_enabled=True,
        fast_break_max_possession_s=8.0,  # [待核实] 24 秒时限下的经验阈值，需用真实录像标定
        win_score=None,
    )


def _period_minutes(age_group: AgeGroup) -> float:
    """
    单节时长默认值（分钟）。

    [待核实] 《范围确认 v0.2》5.5 节表中"一线 = 4 × 12 分钟"取自 NBA 口径；
    FIBA 官方成人比赛是 4 × 10 分钟。中国各级联赛口径不一。
    本表暂按 FIBA 官方值填写，并在 run_poc.py 的待核实清单中标出，
    需按教练实际执裁的联赛确认后调整。

    所有值都只是"新建活动时的默认填充"，教练可在界面上修改，
    修改后的值写入活动表，不回写本表。
    """
    return {
        AgeGroup.U8: 6.0,
        AgeGroup.U12: 8.0,
        AgeGroup.U15: 8.0,
        AgeGroup.U18: 10.0,
        AgeGroup.SENIOR: 10.0,   # FIBA 官方；范围确认表写 12.0，待核实
    }[age_group]


def tracking_spec_for(fmt: Format) -> TrackingSpec:
    """查表得出跟踪与阵型参数。"""
    players = {
        Format.FIVE_V_FIVE: 5,
        Format.FOUR_V_FOUR: 4,
        Format.THREE_V_THREE: 3,
        Format.CUSTOM: 5,   # 自定义赛制需教练显式指定，这里只是兜底
    }[fmt]

    return TrackingSpec(
        players_per_team=players,
        formation_points=players,
        max_tracked_targets=players * 2,   # 双方球员
        formation_sample_interval_s=5.0,   # 范围确认 v0.2：每 5 秒一次快照
    )


# ============================================================
# 解析入口
# ============================================================

def resolve(fmt: Format, age_group: AgeGroup,
            court_type: Optional[CourtType] = None) -> ActivityParams:
    """
    把 (赛制, 年龄段) 解析成一场活动的完整参数。

    这是 pipeline 的唯一入参构造点。任何地方都不应绕过它自行拼装参数。

    court_type 为 None 时按赛制推导；4对4 与自定义赛制必须显式传入
    （对应界面设计 v0.1.1：选 4对4 需追问"全场还是半场"）。
    """
    if fmt is Format.THREE_V_THREE:
        court = COURT_HALF_3X3
    elif fmt is Format.FIVE_V_FIVE:
        court = COURT_FULL
    elif fmt in (Format.FOUR_V_FOUR, Format.CUSTOM):
        if court_type is None:
            raise ValueError(
                f"{fmt.label_zh} 没有统一规则，必须显式指定 court_type（全场 / 半场）。"
                f"界面上应在选中后追问一次。"
            )
        court = COURT_FULL if court_type is CourtType.FULL else CourtSpec(
            court_type=CourtType.HALF,
            length_m=FIBA_FULL_LENGTH_M / 2,
            width_m=FIBA_FULL_WIDTH_M,
            hoop_count=1,
            baseline_to_hoop_m=FIBA_BASELINE_TO_HOOP_M,
        )
    else:
        raise ValueError(f"未知赛制：{fmt}")

    three_point = three_point_spec_for(fmt, age_group)
    rules = rules_spec_for(fmt, age_group)
    tracking = tracking_spec_for(fmt)

    unverified: list[str] = []
    if not three_point.verified:
        unverified.append(
            f"三分线半径 {three_point.radius_m} m（{age_group.label_zh}）"
            f"未对照实际联赛规则核实"
        )
    if fmt is not Format.THREE_V_THREE:
        unverified.append(
            f"单节时长 {rules.period_minutes} 分钟（{age_group.label_zh}）为默认值，待核实"
        )
        if rules.fast_break_max_possession_s is not None:
            unverified.append(
                f"快攻阈值 {rules.fast_break_max_possession_s} 秒为经验值，需用真实录像标定"
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


# ============================================================
# 三组 PoC 参数组合（范围确认 v0.2 第九节）
# ============================================================

POC_COMBOS: tuple[tuple[str, Format, AgeGroup, Optional[CourtType], str], ...] = (
    (
        "组合 A",
        Format.FIVE_V_FIVE,
        AgeGroup.U15,
        None,
        "基线精度：三分识别、快攻、阵型",
    ),
    (
        "组合 B",
        Format.FIVE_V_FIVE,
        AgeGroup.U12,
        None,
        "三分线半径 5.80 m 时判定是否仍准确",
    ),
    (
        "组合 C",
        Format.THREE_V_THREE,
        AgeGroup.U15,
        None,
        "半场单框标定能否跑通，坐标是否偏移",
    ),
)
