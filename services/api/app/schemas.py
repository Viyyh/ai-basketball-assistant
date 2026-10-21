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


class ActivityOut(BaseModel):
    id: str
    title: str
    opponent: Optional[str]
    params: dict
    scope_label: str
    has_report: bool
    created_at: str


class ParamsOut(BaseModel):
    params: dict
    scope_label: str
    unverified: list[str]


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str
    contract_version: str
