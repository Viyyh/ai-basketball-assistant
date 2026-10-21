"""HTTP 边界层。

只做三件事：解析赛制参数、存取活动、寄存 pipeline 产出的报告。
不在这里做任何几何计算 —— 那是 ``basketball_params`` 的职责。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from basketball_params import AgeGroup, CourtType, Format, resolve
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from .schemas import (
    ActivityCreate,
    ActivityOut,
    HealthOut,
    ParamsOut,
)
from .storage import Storage

API_VERSION = "0.1.0"
CONTRACT_VERSION = "1.1"

FORMAT_ZH = {"5V5": "5 对 5", "4V4": "4 对 4", "3V3": "3 对 3", "CUSTOM": "自定义"}
AGE_ZH = {"U8": "8 岁以下", "U12": "12 岁以下", "U15": "15 岁以下",
          "U18": "18 岁以下", "SENIOR": "一线"}


def scope_label(params: dict) -> str:
    """口径标识：赛制 + 年龄段 + 三分线。必须常驻报告页。"""
    return (
        f"{FORMAT_ZH.get(params['format'], params['format'])} · "
        f"{AGE_ZH.get(params['age_group'], params['age_group'])} · "
        f"三分线 {params['three_point_radius_m']:.2f} m"
    )


def create_app(db_path: Optional[str | Path] = None) -> FastAPI:
    app = FastAPI(
        title="AI 篮球分析 API",
        version=API_VERSION,
        description=(
            "教练端后端。参数层是唯一真源，报告契约见 contracts/report.schema.json。"
        ),
    )

    store = Storage(db_path or os.environ.get("BASKETBALL_DB", "data/app.db"))
    store.init()
    app.state.store = store

    # ---------- 基础 ----------

    @app.get("/health", response_model=HealthOut, tags=["ops"])
    def health() -> HealthOut:
        return HealthOut(status="ok", version=API_VERSION, contract_version=CONTRACT_VERSION)

    # ---------- 参数 ----------

    @app.get("/v1/params/resolve", response_model=ParamsOut, tags=["params"])
    def resolve_params(
        format: str = "5V5",
        age_group: str = "U15",
        court_type: Optional[str] = None,
        three_point_radius_m: Optional[float] = None,
    ) -> ParamsOut:
        """把（赛制 × 年龄段）解析成完整参数。前端不自己算。"""
        try:
            params = resolve(
                Format(format),
                AgeGroup(age_group),
                court_type=CourtType(court_type) if court_type else None,
                three_point_radius_m=three_point_radius_m,
            )
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

        return ParamsOut(
            params=params.to_contract(),
            scope_label=params.scope_label_zh,
            unverified=list(params.unverified),
        )

    # ---------- 活动 ----------

    def _to_out(activity: dict) -> ActivityOut:
        return ActivityOut(
            id=activity["id"],
            title=activity["title"],
            opponent=activity["opponent"],
            params=activity["params"],
            scope_label=scope_label(activity["params"]),
            has_report=activity["has_report"],
            created_at=activity["created_at"],
        )

    @app.post("/v1/activities", response_model=ActivityOut,
              status_code=201, tags=["activities"])
    def create_activity(body: ActivityCreate) -> ActivityOut:
        try:
            params = resolve(
                Format(body.format),
                AgeGroup(body.age_group),
                court_type=CourtType(body.court_type) if body.court_type else None,
                three_point_radius_m=body.three_point_radius_m,
            )
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

        activity = store.create_activity(
            title=body.title,
            opponent=body.opponent,
            params=params.to_contract(),
        )
        return _to_out(activity)

    @app.get("/v1/activities", response_model=list[ActivityOut], tags=["activities"])
    def list_activities(limit: int = 50) -> list[ActivityOut]:
        return [_to_out(a) for a in store.list_activities(limit=limit)]

    @app.get("/v1/activities/{activity_id}", response_model=ActivityOut, tags=["activities"])
    def get_activity(activity_id: str) -> ActivityOut:
        activity = store.get_activity(activity_id)
        if activity is None:
            raise HTTPException(status_code=404, detail="活动不存在")
        return _to_out(activity)

    # ---------- 报告 ----------

    @app.post("/v1/activities/{activity_id}/report", status_code=201, tags=["reports"])
    def save_report(activity_id: str, report: dict) -> JSONResponse:
        activity = store.get_activity(activity_id)
        if activity is None:
            raise HTTPException(status_code=404, detail="活动不存在")

        if report.get("schema_version") != CONTRACT_VERSION:
            raise HTTPException(
                status_code=422,
                detail=f"契约版本应为 {CONTRACT_VERSION}，收到 {report.get('schema_version')!r}",
            )
        if report.get("activity_id") != activity_id:
            raise HTTPException(status_code=422, detail="report.activity_id 与路径不一致")
        for key in ("params", "events", "periods", "team_stats", "warnings"):
            if key not in report:
                raise HTTPException(status_code=422, detail=f"缺少必填段 {key}")

        store.save_report(activity_id, report)
        return JSONResponse(status_code=201, content={"activity_id": activity_id, "saved": True})

    @app.get("/v1/activities/{activity_id}/report", tags=["reports"])
    def get_report(activity_id: str) -> dict:
        if store.get_activity(activity_id) is None:
            raise HTTPException(status_code=404, detail="活动不存在")
        report = store.get_report(activity_id)
        if report is None:
            raise HTTPException(status_code=404, detail="该活动还没有报告")
        return report

    return app
