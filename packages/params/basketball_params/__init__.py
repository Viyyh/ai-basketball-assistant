"""参数层：赛制 × 年龄段 → 场地／三分线／规则／跟踪参数。

用法::

    from basketball_params import Format, AgeGroup, resolve, Shot, build_court

    params = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)
    court = build_court(params)
    judgement = court.judge(Shot(x_m=7.0, y_m=0.0, made=True))
    judgement.shot_value      # 3
    judgement.label_zh        # "三分"
"""

from .court import CourtGeometry, Shot, ShotJudgement, build_court
from .table import (
    AgeGroup,
    ActivityParams,
    CourtSpec,
    CourtType,
    FIBA_3PT_RADIUS_M,
    FIBA_CORNER_LATERAL_M,
    Format,
    RulesSpec,
    ThreePointGeometry,
    ThreePointSpec,
    TrackingSpec,
    resolve,
    resolve_three_point,
)

__all__ = [
    "AgeGroup",
    "ActivityParams",
    "CourtGeometry",
    "CourtSpec",
    "CourtType",
    "FIBA_3PT_RADIUS_M",
    "FIBA_CORNER_LATERAL_M",
    "Format",
    "RulesSpec",
    "Shot",
    "ShotJudgement",
    "ThreePointGeometry",
    "ThreePointSpec",
    "TrackingSpec",
    "build_court",
    "resolve",
    "resolve_three_point",
]

__version__ = "1.1.0"
