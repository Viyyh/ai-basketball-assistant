"""HTTP 边界层。

只做三件事：解析赛制参数、存取活动、寄存 pipeline 产出的报告。
不在这里做任何几何计算 —— 那是 ``basketball_params`` 的职责。

参数有两条路：
    · ``/v1/params/resolve`` —— 最小口径（赛制 × 年龄段），历史接口；
    · ``/v1/config/*``        —— 预设 + 逐项覆盖，带校验、来源与快照 hash。
新建活动时传 ``config_base`` 就走完整配置，不传则退回旧口径。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from basketball_params import (
    DEFAULT_BASE,
    AgeGroup,
    ConfigError,
    CourtType,
    Format,
    build_court,
    parse_override,
    presets_public,
    resolve,
    resolve_config,
    schema_public,
)
from basketball_params.preview import render_court_svg
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, Response

from .schemas import (
    ActivityCreate,
    ActivityOut,
    ConfigResolveOut,
    HealthOut,
    ParamsOut,
)
from .storage import Storage

API_VERSION = "0.2.0"
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


def _config_query(
    base: str,
    overrides: list[str],
    unconfirmed: list[str],
):
    parsed: dict[str, object] = {}
    for item in overrides:
        key, value = parse_override(item)
        parsed[key] = value
    return resolve_config(base, parsed, unconfirmed=unconfirmed)


def create_app(db_path: Optional[str | Path] = None) -> FastAPI:
    app = FastAPI(
        title="AI Basketball Assistant API",
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

    # ---------- 参数（最小口径） ----------

    @app.get("/v1/params/resolve", response_model=ParamsOut, tags=["params"])
    def resolve_params(
        format: str = "5V5",
        age_group: str = "U15",
        court_type: Optional[str] = None,
        three_point_radius_m: Optional[float] = None,
        base: Optional[str] = None,
    ) -> ParamsOut:
        """把（赛制 × 年龄段）解析成完整参数。前端不自己算。

        传 ``base``（如 ``nba``）时改为按预设解析，返回的 ``config`` 段带快照。
        """
        if base:
            try:
                result = resolve_config(
                    base,
                    {},
                    fmt=Format(format),
                    age_group=AgeGroup(age_group),
                )
            except ConfigError as err:
                raise HTTPException(status_code=400, detail="；".join(err.errors)) from err
            return ParamsOut(
                params=result.params.to_contract(),
                scope_label=result.label_zh,
                unverified=list(result.warnings),
                svg=build_court(result.params).svg_params(),
                config=result.to_public(),
            )

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
            svg=build_court(params).svg_params(),
            unverified=list(params.unverified),
        )

    # ---------- 参数（完整配置） ----------

    @app.get("/v1/config/schema", tags=["config"])
    def config_schema() -> dict:
        """字段、分组、候选值与默认预设。前端据此渲染表单，不写死字段。"""
        return schema_public()

    @app.get("/v1/config/presets", tags=["config"])
    def config_presets() -> dict:
        return {"default": DEFAULT_BASE, "presets": presets_public()}

    @app.get("/v1/config/resolve", response_model=ConfigResolveOut, tags=["config"])
    def config_resolve(
        base: str = DEFAULT_BASE,
        overrides: list[str] = Query(default=[], alias="set",
                                     description="k=v 形式，可重复，例如 set=period_minutes=10"),
        unconfirmed: list[str] = Query(default=[]),
    ) -> ConfigResolveOut:
        try:
            result = _config_query(base, overrides, unconfirmed)
        except ConfigError as err:
            raise HTTPException(status_code=400, detail="；".join(err.errors)) from err
        return ConfigResolveOut(**result.to_public(), params=result.params.to_contract())

    @app.get("/v1/config/preview", tags=["config"])
    def config_preview(
        base: str = DEFAULT_BASE,
        overrides: list[str] = Query(default=[], alias="set"),
        unconfirmed: list[str] = Query(default=[]),
        width: int = Query(default=1000, ge=480, le=2000),
    ) -> Response:
        """球场预览 SVG。保存前先看一眼，几何矛盾在图上很显眼。"""
        try:
            result = _config_query(base, overrides, unconfirmed)
        except ConfigError as err:
            raise HTTPException(status_code=400, detail="；".join(err.errors)) from err
        svg = render_court_svg(result.params, width=width)
        return Response(content=svg, media_type="image/svg+xml")

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
            config=activity.get("config"),
        )

    @app.post("/v1/activities", response_model=ActivityOut,
              status_code=201, tags=["activities"])
    def create_activity(body: ActivityCreate) -> ActivityOut:
        config_payload: Optional[dict] = None

        if body.config_base:
            overrides = dict(body.config_overrides or {})
            if body.court_type:
                overrides.setdefault("court_type", body.court_type)
            if body.three_point_radius_m is not None:
                overrides.setdefault("three_point_radius_m", body.three_point_radius_m)
            try:
                result = resolve_config(
                    body.config_base,
                    overrides,
                    fmt=Format(body.format),
                    age_group=AgeGroup(body.age_group),
                    unconfirmed=body.config_unconfirmed or (),
                )
            except ConfigError as err:
                raise HTTPException(status_code=400, detail="；".join(err.errors)) from err
            params = result.params
            config_payload = result.to_public()
        else:
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
            config=config_payload,
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
