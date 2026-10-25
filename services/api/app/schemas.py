"""API 的请求／响应模型。

与 ``contracts/report.schema.json`` 的关系：这里只描述 HTTP 边界上的字段，
报告本身仍然由契约的 JSON Schema 管辖 —— 不要在两处各写一份报告模型。
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

FormatLiteral = Literal["5V5", "4V4", "3V3", "CUSTOM"]
AgeLiteral = Literal["U8", "U12", "U15", "U18", "SENIOR"]
CourtTypeLiteral = Literal["FULL", "HALF"]


class ActivityCreate(BaseModel):
    title: str = Field(min_length=1, max_length=60, description="例如「10/09 主场 vs 育才中学」")
    opponent: Optional[str] = Field(default=None, max_length=60)
    format: FormatLiteral = "5V5"
    age_group: AgeLiteral = "U15"
    court_type: Optional[CourtTypeLiteral] = Field(
        default=None, description="4V4 与自定义赛制必填"
    )
    three_point_radius_m: Optional[float] = Field(
        default=None, gt=0, le=10,
        description="覆盖三分线半径。默认 6.75 m，仅在联赛确实打小球时传",
    )
    #: 走完整配置时的预设 id（fiba / nba / cba / youth-u15 / three-x-three / half-court）。
    #: 不传则退回旧的 resolve() 口径。
    config_base: Optional[str] = Field(default=None, max_length=40)
    #: 预设之上的逐项覆盖，例如 {"period_minutes": 10, "corner_lateral_m": 6.71}
    config_overrides: Optional[dict] = Field(
        default=None, description="只写要改的字段；字段名见 GET /v1/config/schema"
    )
    #: 用户明确表示"不确定"的字段。仍取预设值，但报告会带警告。
    config_unconfirmed: Optional[list[str]] = None


class ActivityOut(BaseModel):
    id: str
    title: str
    opponent: Optional[str]
    params: dict
    scope_label: str
    has_report: bool
    created_at: str
    #: 完整配置快照（值 + 来源 + hash + 警告）；旧数据为 None。
    config: Optional[dict] = None


class ParamsOut(BaseModel):
    params: dict
    scope_label: str
    unverified: list[str]
    svg: dict = Field(
        default_factory=dict,
        description="球场底图绘制参数（含场地标线）。前端不得自己写死尺寸",
    )
    config: Optional[dict] = Field(
        default=None,
        description="参数快照（含每项来源与 hash）。旧版接口不返回，前端需兼容 None",
    )


class ConfigResolveOut(BaseModel):
    base: str
    label: str
    hash: str
    format: str
    age_group: str
    values: dict
    sources: dict
    overrides: list[str]
    unconfirmed: list[str]
    warnings: list[str]
    params: dict = Field(description="契约 params 段，可直接写入报告")


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str
    contract_version: str
