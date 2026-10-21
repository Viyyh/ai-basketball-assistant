"""
basketball_params —— 赛制与年龄段参数层。

全系统唯一真源（single source of truth）。

对应 PRD 4.5 与开发计划第十二节「契约三条硬规则」：

    硬规则 #1  params 段由本包的 resolve() 产出，pipeline 只透传，不得自行填写
    硬规则 #2  shot_value 与 label_zh 由 CourtGeometry.judge() 产出
    硬规则 #3  player_id 恒为 null，归属由教练补录写入

本包被 services/api、services/worker、services/pipeline 三个服务
以 editable 方式共同安装（pip install -e packages/params）。

⚠️ 任何服务都不得复制一份参数表。三份真源正是 PRD 风险 7.4 的温床。

本包只依赖 Python 标准库。
"""

from __future__ import annotations

from .aggregate import (
    AggregateResult,
    CrossAgeGroupAggregationError,
    CrossFormatAggregationError,
    GameStats,
    aggregate,
    aggregate_guarded,
    group_by_scope,
)
from .court import CourtGeometry, Shot, ShotJudgement, build_court
from .params import (
    POC_COMBOS,
    ActivityParams,
    AgeGroup,
    CourtSpec,
    CourtType,
    Format,
    RulesSpec,
    ThreePointGeometry,
    ThreePointSpec,
    TrackingSpec,
    resolve,
    rules_spec_for,
    three_point_spec_for,
    tracking_spec_for,
)
from .pipeline_contract import (
    AnalysisPipeline,
    CalibrationResult,
    DetectedEvent,
    FormationSnapshot,
    ReportJson,
    TrackedFrame,
    pipeline_readiness,
    validate_params_for_pipeline,
)

__version__ = "1.0.0"

__all__ = [
    # params
    "Format",
    "AgeGroup",
    "CourtType",
    "ThreePointGeometry",
    "CourtSpec",
    "ThreePointSpec",
    "RulesSpec",
    "TrackingSpec",
    "ActivityParams",
    "resolve",
    "three_point_spec_for",
    "rules_spec_for",
    "tracking_spec_for",
    "POC_COMBOS",
    # court
    "CourtGeometry",
    "Shot",
    "ShotJudgement",
    "build_court",
    # aggregate
    "GameStats",
    "AggregateResult",
    "CrossFormatAggregationError",
    "CrossAgeGroupAggregationError",
    "aggregate",
    "aggregate_guarded",
    "group_by_scope",
    # pipeline contract
    "AnalysisPipeline",
    "CalibrationResult",
    "TrackedFrame",
    "DetectedEvent",
    "FormationSnapshot",
    "ReportJson",
    "validate_params_for_pipeline",
    "pipeline_readiness",
]
