"""Mock 报告生成器。

用途：在没有录像、没有模型的时候，产出一份**契约合法**的报告，
让前端、后端、校验器先跑起来。

它不是"假数据" —— 坐标、分值、标签都由真实的参数层与几何判定产出，
唯一假的是"这些出手发生过"。
"""

from __future__ import annotations

from typing import Iterable

from basketball_params import (
    ActivityParams,
    AgeGroup,
    CourtGeometry,
    CourtType,
    Format,
    Shot,
    build_court,
    resolve,
)

SCHEMA_VERSION = "1.1"
PIPELINE_VERSION = "mock-1.1.0"

#: 脚本化的事件。坐标是米制（原点=篮筐中心，x 沿进攻方向指向中场）。
RAW_EVENTS: tuple[dict, ...] = (
    {"id": "e01", "kind": "SHOT", "t": 42.5, "period": 1, "x": 6.2, "y": 0.0,
     "made": True, "side": "OURS", "player": "p01"},
    {"id": "e02", "kind": "SHOT", "t": 96.0, "period": 1, "x": 1.0, "y": 6.70,
     "made": False, "side": "OURS", "player": "p02"},
    {"id": "e03", "kind": "FAST_BREAK", "t": 130.0, "period": 1,
     "side": "OURS", "player": "p05"},
    {"id": "e04", "kind": "SHOT", "t": 188.0, "period": 1, "x": 7.0, "y": 1.0,
     "made": True, "side": "OURS", "player": "p03"},
    {"id": "e05", "kind": "SHOT", "t": 240.0, "period": 1, "x": 6.8, "y": 0.2,
     "made": True, "side": "OPPONENT", "player": None},
    {"id": "e06", "kind": "SHOT", "t": 302.0, "period": 1, "x": 3.0, "y": 3.0,
     "made": False, "side": "OPPONENT", "player": None},
    {"id": "e07", "kind": "TURNOVER", "t": 340.0, "period": 1,
     "side": "OURS", "player": "p04"},
    {"id": "e08", "kind": "SHOT", "t": 508.0, "period": 2, "x": 4.0, "y": -1.0,
     "made": True, "side": "OURS", "player": "p01"},
    {"id": "e09", "kind": "SHOT", "t": 602.0, "period": 2, "x": 7.1, "y": -2.0,
     "made": False, "side": "OURS", "player": None},
    {"id": "e10", "kind": "SHOT", "t": 660.0, "period": 2, "x": 6.9, "y": 0.0,
     "made": False, "side": "OURS", "player": "p02"},
    {"id": "e11", "kind": "SHOT", "t": 712.0, "period": 2, "x": 3.0, "y": 3.0,
     "made": True, "side": "UNKNOWN", "player": None},
)

#: 被教练标记为误检的事件（保留在数据里，不进统计）
EXCLUDED = {
    "e12": {
        "id": "e12", "kind": "SHOT", "t": 735.0, "period": 2, "x": 7.1, "y": -2.0,
        "made": False, "side": "OURS", "player": None,
        "exclude_reason": "误检：实为传球出界",
    }
}


def _event_payload(raw: dict, court: CourtGeometry) -> dict:
    """把一条原始事件补齐成契约要求的事件对象。"""
    is_shot = raw["kind"] == "SHOT"
    payload = {
        "id": raw["id"],
        "kind": raw["kind"],
        "timestamp_s": raw["t"],
        "period": raw["period"],
        "in_bounds": True,
        "confidence": 0.9,
        "clip_key": f"clips/{raw['id']}.mp4",
        "clip_start_s": max(0.0, raw["t"] - 5.0),
        "clip_duration_s": 10.0,
        "player_id": raw.get("player"),
        "attribution_source": _attribution(raw),
        "team_side": raw["side"],
        "source": "COACH" if raw["id"] in EXCLUDED else "AI",
        "status": "EXCLUDED" if raw["id"] in EXCLUDED else "ACTIVE",
        "exclude_reason": EXCLUDED.get(raw["id"], {}).get("exclude_reason"),
    }

    if is_shot:
        shot = Shot(x_m=raw["x"], y_m=raw["y"], made=raw["made"], period=raw["period"])
        j = court.judge(shot)
        payload.update(
            x_m=raw["x"],
            y_m=raw["y"],
            distance_m=j.distance_m,
            in_bounds=j.in_bounds,
            behind_three_point_line=j.behind_three_point_line,
            shot_value=j.shot_value,
            made=raw["made"],
            label_zh=f"{j.label_zh}·{'命中' if raw['made'] else '未中'}",
        )
    else:
        payload.update(
            x_m=None, y_m=None, distance_m=None,
            behind_three_point_line=None, shot_value=None,
            made=None, label_zh=None,
        )
    return payload


def _attribution(raw: dict) -> str | None:
    if raw["side"] == "OPPONENT":
        return "NOT_OUR_TEAM"
    if raw["side"] == "UNKNOWN":
        return "UNKNOWN"
    return "COACH" if raw.get("player") else None


def _select_raws(params: ActivityParams, court: CourtGeometry) -> list[dict]:
    """
    挑出这组参数下仍然成立的脚本事件。

    两条过滤都是"几何/规则说了算"，不是为了让 mock 好看：
      · 3x3 不识别快攻 → 快攻事件不存在
      · 坐标落在场外 → 说明标定或素材不适用，不编造
    """
    out = []
    for raw in RAW_EVENTS:
        if raw["kind"] == "FAST_BREAK" and not params.rules.fast_break_enabled:
            continue
        if raw["kind"] == "SHOT" and not court.in_bounds(raw["x"], raw["y"]):
            continue
        out.append(raw)
    return out


def _select_excluded(params: ActivityParams, court: CourtGeometry) -> list[dict]:
    out = []
    for raw in EXCLUDED.values():
        if raw["kind"] == "SHOT" and not court.in_bounds(raw["x"], raw["y"]):
            continue
        out.append(raw)
    return out


def _fit_to_periods(events: list[dict], params: ActivityParams) -> None:
    """单节赛制（3x3）把时间轴压回一节，避免出现不存在的第 2 节。"""
    if params.rules.period_count != 1:
        return
    length = params.rules.period_minutes * 60
    for e in events:
        e["period"] = 1
        e["timestamp_s"] = float(e["timestamp_s"]) % length


def _periods(params: ActivityParams) -> list[dict]:
    """按节切分时间轴，并给出我方进攻方向（上下半场换边）。"""
    minutes = params.rules.period_minutes
    count = params.rules.period_count
    out = []
    for i in range(1, count + 1):
        start = (i - 1) * minutes * 60
        # 1、3 节攻左，2、4 节攻右；3x3 单节固定左
        basket = "LEFT" if i % 2 == 1 else "RIGHT"
        out.append({
            "index": i,
            "start_s": start,
            "end_s": start + minutes * 60,
            "attacking_basket": "LEFT" if count == 1 else basket,
        })
    return out


def _aggregate(events: Iterable[dict], side: str) -> dict:
    shots = [e for e in events
             if e["kind"] == "SHOT" and e["team_side"] == side and e["status"] == "ACTIVE"]
    made = [e for e in shots if e["made"]]
    arc = [e for e in shots if e["behind_three_point_line"]]
    arc_made = [e for e in arc if e["made"]]
    return {
        "shots_made": len(made),
        "shots_attempted": len(shots),
        "arc_out_made": len(arc_made),
        "arc_out_attempted": len(arc),
        "turnovers": len([e for e in events
                          if e["kind"] == "TURNOVER" and e["team_side"] == side
                          and e["status"] == "ACTIVE"]),
        "points": sum(e["shot_value"] for e in made),
    }


def build_report(
    fmt: Format = Format.FIVE_V_FIVE,
    age_group: AgeGroup = AgeGroup.U15,
    court_type: CourtType | None = None,
    three_point_radius_m: float | None = None,
) -> dict:
    """生成一份契约合法的示例报告。"""
    params = resolve(
        fmt, age_group,
        court_type=court_type,
        three_point_radius_m=three_point_radius_m,
    )
    court = build_court(params)

    raws = _select_raws(params, court)
    events = [_event_payload(raw, court) for raw in raws]
    events += [_event_payload(raw, court) for raw in _select_excluded(params, court)]
    _fit_to_periods(events, params)

    our = _aggregate(events, "OURS")
    opp = _aggregate(events, "OPPONENT")

    periods = _periods(params)
    active = [e for e in events if e["status"] == "ACTIVE"]

    team_stats = {
        **our,
        "fast_breaks": len([e for e in active
                            if e["kind"] == "FAST_BREAK" and e["team_side"] == "OURS"]),
        "possessions": len(active),
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "activity_id": f"act_mock_{fmt.value.lower()}_{age_group.value.lower()}",
        "pipeline_version": PIPELINE_VERSION,
        "generated_at": "2026-10-21T20:00:00+08:00",
        "params": params.to_contract(),
        "video": {
            "key": f"videos/mock/{fmt.value.lower()}.mp4",
            "duration_s": periods[-1]["end_s"],
            "fps": 25,
            "resolution": [1920, 1080],
            "source": "ALBUM",
        },
        "calibration": {
            "ok": True,
            "reproj_error_px": 2.4,
            "homography": [12.4, 0.8, -1820.5, -0.3, 11.9, -640.2, 0.0008, 0.0011, 1],
            "note": "示例数据：标定为模拟值",
        },
        "events": events,
        "formations": [{
            "timestamp_s": 120.0,
            "period": 1,
            "positions_m": [[5.6, 0.0], [4.2, -5.2], [4.2, 5.2], [1.9, -2.4], [1.9, 2.4]],
            "ball_m": [5.6, 0.0],
            "label": None,
            "confidence": 0.47,
        }],
        "periods": periods,
        "team_stats": team_stats,
        "opponent_stats": opp,
        "coverage": {
            "events_total": len(events),
            "events_attributed": len([e for e in active if e["player_id"] is not None]),
            "events_excluded": len([e for e in events if e["status"] == "EXCLUDED"]),
            "events_side_unknown": len([e for e in active if e["team_side"] == "UNKNOWN"]),
        },
        "warnings": [
            "示例数据：由 mock pipeline 生成，坐标与分值真实计算，事件本身为模拟",
        ],
    }
