"""把参数画成一张球场 SVG —— 用户在保存前先"看一眼对不对"。

为什么要预览
------------
场地长宽、三分弧、底角距离这些数字，单看表格很难发现"底角 7.0 m 配 6.75 m
弧线"这种自相矛盾的组合；画出来一眼就能看出来。预览与判定共用同一份
``ActivityParams``，不存在"图画对了、判定却用另一套"的情况。

纯字符串拼接，不依赖 Pillow / matplotlib，API 直接返回 ``image/svg+xml``。
"""

from __future__ import annotations

import math
from typing import Iterable
from xml.sax.saxutils import escape

from .table import ActivityParams

_COURT_FILL = "#f7f3e8"
_COURT_LINE = "#8a6d3b"
_LANE_FILL = "#efe6d0"
_THREE_COLOR = "#c0392b"
_HOOP_COLOR = "#1f2937"
_TEXT = "#3d2f1f"
_MUTED = "#8b7a63"
_WARN = "#a15c00"


def _round(value: float) -> float:
    return round(value, 2)


def _near_three_point_points(params: ActivityParams) -> list[tuple[float, float]]:
    """三分线在"本方篮筐"坐标系里的折线点（篮筐在原点）。"""
    court = params.court
    three = params.three_point
    radius = three.radius_m
    x_min = -court.baseline_to_hoop_m
    y_half = court.y_half_m

    if not three.has_corners or three.corner_lateral_m is None:
        if radius <= abs(x_min):
            theta_base = math.pi / 2.0
        else:
            theta_base = math.acos(max(-1.0, min(1.0, x_min / radius)))
        y_at_base = radius * math.sin(theta_base)
        theta = theta_base if y_at_base <= y_half else math.asin(
            max(-1.0, min(1.0, y_half / radius))
        )
        steps = 48
        return [
            (
                radius * math.cos(-theta + 2 * theta * i / steps),
                radius * math.sin(-theta + 2 * theta * i / steps),
            )
            for i in range(steps + 1)
        ]

    corner = three.corner_lateral_m
    junction_x = three.corner_junction_x_m or math.sqrt(radius ** 2 - corner ** 2)
    phi = math.atan2(corner, junction_x)
    steps = 40
    points: list[tuple[float, float]] = [(x_min, -corner)]
    points.append((junction_x, -corner))
    for i in range(steps + 1):
        t = -phi + 2 * phi * i / steps
        points.append((radius * math.cos(t), radius * math.sin(t)))
    points.append((junction_x, corner))
    points.append((x_min, corner))
    return points


def _path_d(points: Iterable[tuple[float, float]], sx, sy) -> str:
    pts = [(sx(x), sy(y)) for x, y in points]
    head, *tail = pts
    return "M " + f"{head[0]:.1f} {head[1]:.1f}" + " L " + " L ".join(
        f"{x:.1f} {y:.1f}" for x, y in tail
    )


def _arc_points(cx_m: float, cy_m: float, radius_m: float,
                start: float, end: float, steps: int = 32) -> list[tuple[float, float]]:
    return [
        (
            cx_m + radius_m * math.cos(start + (end - start) * i / steps),
            cy_m + radius_m * math.sin(start + (end - start) * i / steps),
        )
        for i in range(steps + 1)
    ]


def _wrap(text: str, limit: int = 52) -> list[str]:
    return [text[i:i + limit] for i in range(0, len(text), limit)] or [""]


def render_court_svg(params: ActivityParams, width: int = 1000) -> str:
    """返回一张俯视球场 SVG。坐标单位在内部统一换算为像素。"""
    court = params.court
    three = params.three_point
    rules = params.rules
    marks = params.marks

    length = court.length_m
    width_m = court.width_m
    half = width_m / 2.0
    baseline = court.baseline_to_hoop_m

    margin_x = 56
    top = 96
    scale = (width - 2 * margin_x) / length
    height = round(top + width_m * scale + 96)

    def sx(x_m: float) -> float:
        return margin_x + (x_m + baseline) * scale

    def sy(y_m: float) -> float:
        return top + (y_m + half) * scale

    def ln(x: float) -> float:
        return x * scale

    x_left = sx(-baseline)
    x_right = sx(length - baseline)
    y_top = sy(-half)
    y_bottom = sy(half)

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="{escape(params.profile_label_zh or params.scope_label_zh)}">',
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        # 场地
        f'<rect x="{x_left:.1f}" y="{y_top:.1f}" width="{x_right - x_left:.1f}" '
        f'height="{y_bottom - y_top:.1f}" fill="{_COURT_FILL}" stroke="{_COURT_LINE}" '
        f'stroke-width="2"/>',
    ]

    # 中圈 / 中线
    if court.court_type.value == "FULL":
        center_x = sx(length / 2.0 - baseline)
        parts.append(
            f'<line x1="{center_x:.1f}" y1="{y_top:.1f}" x2="{center_x:.1f}" '
            f'y2="{y_bottom:.1f}" stroke="{_COURT_LINE}" stroke-width="2"/>'
        )
        parts.append(
            f'<circle cx="{center_x:.1f}" cy="{sy(0):.1f}" r="{ln(marks.center_circle_radius_m):.1f}" '
            f'fill="none" stroke="{_COURT_LINE}" stroke-width="2"/>'
        )

    # 两端：禁区 + 罚球圈 + 篮板 + 篮筐 + 无撞人半圆 + 三分线
    hoop_positions = [0.0]
    if court.court_type.value == "FULL":
        hoop_positions.append(length - 2 * baseline)

    center_x_m = length / 2.0 - baseline
    for hoop_x in hoop_positions:
        if hoop_x == 0:
            lane_x0 = sx(-baseline)
            lane_x1 = sx(-baseline + marks.free_throw_line_m)
        else:
            lane_x0 = sx(length - baseline)
            lane_x1 = sx(length - baseline - marks.free_throw_line_m)
        # 3x3 的半场同样带禁区与罚球圈（半场就是 FIBA 全场的一半）
        lane_h = ln(marks.restricted_area_width_m)
        lane_y = sy(-marks.restricted_area_width_m / 2.0)
        parts.append(
            f'<rect x="{min(lane_x0, lane_x1):.1f}" y="{lane_y:.1f}" '
            f'width="{abs(lane_x1 - lane_x0):.1f}" height="{lane_h:.1f}" '
            f'fill="{_LANE_FILL}" stroke="{_COURT_LINE}" stroke-width="1.5"/>'
        )
        parts.append(
            f'<circle cx="{lane_x1:.1f}" cy="{sy(0):.1f}" r="{ln(1.8):.1f}" '
            f'fill="none" stroke="{_COURT_LINE}" stroke-width="1.5" '
            f'stroke-dasharray="4 3"/>'
        )
        # 篮板
        board_x = sx(hoop_x + 1.2 if hoop_x == 0 else hoop_x - 1.2)
        parts.append(
            f'<line x1="{board_x:.1f}" y1="{sy(-0.9):.1f}" x2="{board_x:.1f}" '
            f'y2="{sy(0.9):.1f}" stroke="{_HOOP_COLOR}" stroke-width="5"/>'
        )
        # 篮筐
        parts.append(
            f'<circle cx="{sx(hoop_x):.1f}" cy="{sy(0):.1f}" r="{max(3.0, ln(0.225)):.1f}" '
            f'fill="none" stroke="{_HOOP_COLOR}" stroke-width="2.5"/>'
        )
        # 无撞人半圆（面向场内）
        if hoop_x == 0:
            start, end = -math.pi / 2, math.pi / 2
        else:
            start, end = math.pi / 2, 3 * math.pi / 2
        arc = _arc_points(hoop_x, 0.0, marks.no_charge_radius_m, start, end)
        parts.append(
            f'<path d="{_path_d(arc, sx, sy)}" fill="none" stroke="{_COURT_LINE}" '
            f'stroke-width="1.5"/>'
        )
        # 三分线（两端各画一条；远端以中线镜像）
        tp = _near_three_point_points(params)
        if hoop_x != 0:
            tp = [(2 * center_x_m - x, y) for x, y in tp]
        parts.append(
            f'<path d="{_path_d(tp, sx, sy)}" fill="none" stroke="{_THREE_COLOR}" '
            f'stroke-width="2.5"/>'
        )

    # 文案
    title = params.profile_label_zh or params.scope_label_zh
    subtitle = (
        f"{length:.2f} × {width_m:.2f} m · 三分 {three.radius_m:.2f} m"
        + (f" / 底角 {three.corner_lateral_m:.2f} m" if three.corner_lateral_m is not None
           else " / 纯弧线")
        + f" · {rules.period_count} × {rules.period_minutes:g} 分钟"
        + f" · 弧内 {rules.inside_arc_points} 分 / 弧外 {rules.outside_arc_points} 分"
    )
    parts.append(
        f'<text x="24" y="34" font-family="-apple-system, PingFang SC, Helvetica, Arial, sans-serif" '
        f'font-size="21" font-weight="600" fill="{_TEXT}">{escape(title)}</text>'
    )
    parts.append(
        f'<text x="24" y="60" font-family="-apple-system, PingFang SC, Helvetica, Arial, sans-serif" '
        f'font-size="13" fill="{_MUTED}">{escape(subtitle)}</text>'
    )

    legend_y = height - 34
    parts.append(
        f'<line x1="24" y1="{legend_y - 4}" x2="44" y2="{legend_y - 4}" '
        f'stroke="{_THREE_COLOR}" stroke-width="2.5"/>'
    )
    parts.append(
        f'<text x="50" y="{legend_y}" font-family="-apple-system, PingFang SC, Helvetica, Arial, sans-serif" '
        f'font-size="12" fill="{_MUTED}">三分线</text>'
    )
    parts.append(
        f'<line x1="112" y1="{legend_y - 4}" x2="132" y2="{legend_y - 4}" '
        f'stroke="{_COURT_LINE}" stroke-width="1.5"/>'
    )
    parts.append(
        f'<text x="138" y="{legend_y}" font-family="-apple-system, PingFang SC, Helvetica, Arial, sans-serif" '
        f'font-size="12" fill="{_MUTED}">场地标线（不参与分值判定）</text>'
    )

    warnings = list(params.warnings)
    if warnings:
        text = "；".join(warnings)
        lines = _wrap("注意：" + text, 58)[:2]
        for i, line in enumerate(lines):
            parts.append(
                f'<text x="{width - 24}" y="{height - 46 + i * 16}" text-anchor="end" '
                f'font-family="-apple-system, PingFang SC, Helvetica, Arial, sans-serif" '
                f'font-size="12" fill="{_WARN}">{escape(line)}</text>'
            )

    parts.append("</svg>")
    return "\n".join(parts)
