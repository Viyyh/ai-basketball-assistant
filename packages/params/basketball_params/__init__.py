"""参数层：预设 / 逐项覆盖 → 场地／三分线／规则／跟踪参数。

两种入口：

    # 1. 最小口径（历史用法，只认赛制 × 年龄段）
    from basketball_params import Format, AgeGroup, resolve, build_court

    params = resolve(Format.FIVE_V_FIVE, AgeGroup.U15)

    # 2. 完整配置（预设 + 逐项覆盖 + 校验 + 快照）
    from basketball_params import resolve_config

    result = resolve_config(
        "nba",
        {"period_minutes": 10},
        unconfirmed=["period_minutes"],
    )
    result.params          # ActivityParams
    result.config_hash     # 报告复算用的快照 hash
    result.to_public()     # 给 UI / 存库的 JSON

裁判口径（``Shot`` / ``ShotJudgement``）见 ``court.py``。
"""

from .court import CourtGeometry, Shot, ShotJudgement, build_court
from .config import (
    ConfigError,
    ConfigResult,
    DEFAULT_BASE,
    DEFAULT_VALUES,
    FIELDS,
    FIELD_BY_KEY,
    FieldSpec,
    PRESETS,
    PRESET_BY_ID,
    Preset,
    fields_public,
    parse_override,
    parse_scalar,
    presets_public,
    resolve_config,
    schema_public,
)
from .table import (
    AgeGroup,
    ActivityParams,
    CourtMarks,
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
    "ConfigError",
    "ConfigResult",
    "DEFAULT_VALUES",
    "CourtGeometry",
    "CourtMarks",
    "CourtSpec",
    "CourtType",
    "DEFAULT_BASE",
    "FIBA_3PT_RADIUS_M",
    "FIBA_CORNER_LATERAL_M",
    "FIELDS",
    "FIELD_BY_KEY",
    "FieldSpec",
    "Format",
    "PRESETS",
    "PRESET_BY_ID",
    "Preset",
    "RulesSpec",
    "Shot",
    "ShotJudgement",
    "ThreePointGeometry",
    "ThreePointSpec",
    "TrackingSpec",
    "build_court",
    "fields_public",
    "parse_override",
    "parse_scalar",
    "presets_public",
    "resolve",
    "resolve_config",
    "resolve_three_point",
    "schema_public",
]

__version__ = "1.2.0"
