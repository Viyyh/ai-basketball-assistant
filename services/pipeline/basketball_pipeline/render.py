"""把轨迹文档渲染成一张 SVG：左上是轨迹覆盖图，左下是代表帧，右侧是轨迹清单。

为什么是 SVG 而不是 PNG：不引入 matplotlib / PIL，纯字符串拼装，
在没有任何图形库的机器上也能出图，并且可以直接在浏览器里看。

这张图要回答一个问题：**这 10 条轨迹是不是场上的那 10 个人。**
所以配色要能一眼分人，长度要能看出谁中途丢了。
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Iterable
from xml.sax.saxutils import escape

from .ingest import PERSON, SPORTS_BALL

PALETTE = [
    "#4C8DFF", "#FF7A45", "#36CFC9", "#F759AB", "#73D13D", "#9254DE",
    "#FFC53D", "#597EF7", "#FF85C0", "#5CDBD3", "#B37FEB", "#D3ADF7",
]
BG = "#0F172A"
PANEL = "#111C33"
TEXT = "#E6EDF7"
MUTED = "#8497B0"
GRID = "#1E2A44"


def render_tracks_svg(
    doc: dict[str, Any],
    out_path: str | Path,
    *,
    snapshot: str | Path | None = None,
    max_legend: int = 14,
) -> Path:
    video = doc.get("video", {})
    vid_w = float(video.get("width") or 1920)
    vid_h = float(video.get("height") or 1080)
    tracks = doc.get("tracks", [])
    persons = [t for t in tracks if t.get("cls") == PERSON]
    balls = [t for t in tracks if t.get("cls") == SPORTS_BALL]

    panel_w = 640.0
    panel_h = round(panel_w * vid_h / vid_w, 1)
    panel_h = min(panel_h, 400.0)

    top = 96.0
    gap = 44.0
    frame_y = top + panel_h + gap
    legend_x = 24.0 + panel_w + 40.0
    width = legend_x + 470.0
    height = frame_y + panel_h + 56.0

    colors = {id(t): PALETTE[i % len(PALETTE)] for i, t in enumerate(persons)}

    parts: list[str] = []
    parts.append(_header(doc, width))

    # --- 轨迹覆盖图
    parts.append(_panel(24.0, top, panel_w, panel_h, "轨迹覆盖（画面坐标）"))
    parts.append(_trajectories(persons, colors, vid_w, vid_h, 24.0, top, panel_w, panel_h))

    # --- 代表帧
    parts.append(_panel(24.0, frame_y, panel_w, panel_h, "代表帧（球员最多的一帧）"))
    if snapshot and Path(snapshot).exists():
        parts.append(_snapshot(Path(snapshot), doc, persons, colors, 24.0, frame_y, panel_w, panel_h))
    else:
        parts.append(
            f'<text x="{24 + panel_w / 2:.0f}" y="{frame_y + panel_h / 2:.0f}" fill="{MUTED}" '
            f'font-size="13" text-anchor="middle">未提供代表帧（--snapshot）</text>'
        )

    # --- 图例
    parts.append(_legend(doc, persons, balls, colors, legend_x, top, width - legend_x - 24.0, max_legend))

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
        f'viewBox="0 0 {width:.0f} {height:.0f}" font-family="-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif">'
        + f'<rect width="{width:.0f}" height="{height:.0f}" fill="{BG}"/>'
        + "".join(parts)
        + "</svg>"
    )

    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")
    return path


# ------------------------------------------------------------------ 分段


def _header(doc: dict[str, Any], width: float) -> str:
    video = doc.get("video", {})
    summary = doc.get("summary", {})
    health = doc.get("health", {})
    title = "轨迹体检"
    sub = (
        f"{video.get('width')}×{video.get('height')} · {_fmt_duration(video.get('duration_s', 0))} · "
        f"采样 {doc.get('ingest', {}).get('sampled_fps')} fps · "
        f"球员 {summary.get('person_tracks')} 条 / 球 {summary.get('ball_tracks')} 条 · "
        f"人中位框高 {summary.get('median_person_height_px')} px"
    )
    color = {"ok": "#73D13D", "warn": "#FFC53D", "empty": "#FF7875"}.get(health.get("level", "ok"), MUTED)
    note = " ".join(health.get("notes") or [])
    out = [
        f'<text x="24" y="42" fill="{TEXT}" font-size="21" font-weight="600">{escape(title)}</text>',
        f'<text x="24" y="68" fill="{MUTED}" font-size="13">{escape(sub)}</text>',
    ]
    if note:
        out.append(f'<text x="{width - 24:.0f}" y="68" fill="{color}" font-size="13" text-anchor="end">{escape(_clip(note, 46))}</text>')
    return "".join(out)


def _panel(x: float, y: float, w: float, h: float, title: str) -> str:
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{PANEL}"/>'
        f'<text x="{x + 14}" y="{y + 22}" fill="{MUTED}" font-size="12">{escape(title)}</text>'
    )


def _fit(vid_w: float, vid_h: float, box_w: float, box_h: float) -> tuple[float, float, float, float, float]:
    """等比缩放并居中，避免竖屏视频被拉扁。"""
    scale = min(box_w / vid_w, box_h / vid_h)
    draw_w, draw_h = vid_w * scale, vid_h * scale
    return scale, (box_w - draw_w) / 2.0, (box_h - draw_h) / 2.0, draw_w, draw_h


def _frame_box(x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    return (x + 14.0, y + 30.0, w - 28.0, h - 44.0)


def _trajectories(
    persons: list[dict[str, Any]],
    colors: dict[int, str],
    vid_w: float,
    vid_h: float,
    x: float,
    y: float,
    w: float,
    h: float,
) -> str:
    bx, by, bw, bh = _frame_box(x, y, w, h)
    scale, ox, oy, draw_w, draw_h = _fit(vid_w, vid_h, bw, bh)

    def project(px: float, py: float) -> tuple[float, float]:
        return (bx + ox + px * scale, by + oy + py * scale)

    out = [
        f'<rect x="{bx + ox:.1f}" y="{by + oy:.1f}" width="{draw_w:.1f}" height="{draw_h:.1f}" '
        f'fill="none" stroke="{GRID}"/>'
    ]

    for idx, track in enumerate(persons):
        pts = []
        for frame in track.get("frames", []):
            _, _, x1, y1, x2, y2 = frame[:6]
            cx, cy = project((x1 + x2) / 2.0, (y1 + y2) / 2.0)
            pts.append(f"{cx:.1f},{cy:.1f}")
        if len(pts) < 2:
            continue
        color = colors.get(id(track), PALETTE[idx % len(PALETTE)])
        out.append(
            f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="1.6" '
            f'stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round"/>'
        )
        first = pts[0].split(",")
        last = pts[-1].split(",")
        out.append(f'<circle cx="{first[0]}" cy="{first[1]}" r="3.2" fill="{color}"/>')
        out.append(
            f'<circle cx="{last[0]}" cy="{last[1]}" r="3.4" fill="none" stroke="{color}" stroke-width="1.6"/>'
        )
        if idx < 12:
            out.append(
                f'<text x="{float(last[0]) + 5:.0f}" y="{float(last[1]) - 5:.0f}" fill="{color}" '
                f'font-size="11" font-weight="600">#{track.get("id")}</text>'
            )
    return "".join(out)


def _snapshot(
    path: Path,
    doc: dict[str, Any],
    persons: list[dict[str, Any]],
    colors: dict[int, str],
    x: float,
    y: float,
    w: float,
    h: float,
) -> str:
    vid_w = float(doc.get("video", {}).get("width") or 1)
    vid_h = float(doc.get("video", {}).get("height") or 1)
    bx, by, bw, bh = _frame_box(x, y, w, h)
    _, ox, oy, draw_w, draw_h = _fit(vid_w, vid_h, bw, bh)
    ix, iy = bx + ox, by + oy

    data = base64.b64encode(path.read_bytes()).decode("ascii")
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    frame_index = doc.get("ingest", {}).get("snapshot_frame")
    out = [
        f'<clipPath id="frameClip"><rect x="{ix:.1f}" y="{iy:.1f}" width="{draw_w:.1f}" '
        f'height="{draw_h:.1f}" rx="6"/></clipPath>',
        f'<image href="data:{mime};base64,{data}" x="{ix:.1f}" y="{iy:.1f}" '
        f'width="{draw_w:.1f}" height="{draw_h:.1f}" preserveAspectRatio="none" clip-path="url(#frameClip)"/>',
    ]

    # 在这一帧上画出当时存在的框，颜色与轨迹一一对应
    for idx, track in enumerate(persons):
        box = next((f for f in track.get("frames", []) if f[0] == frame_index), None)
        if box is None:
            continue
        _, _, x1, y1, x2, y2 = box[:6]
        rx = ix + x1 / vid_w * draw_w
        ry = iy + y1 / vid_h * draw_h
        rw = (x2 - x1) / vid_w * draw_w
        rh = (y2 - y1) / vid_h * draw_h
        color = colors.get(id(track), PALETTE[idx % len(PALETTE)])
        out.append(
            f'<rect x="{rx:.1f}" y="{ry:.1f}" width="{rw:.1f}" height="{rh:.1f}" fill="none" '
            f'stroke="{color}" stroke-width="1.4"/>'
        )
        out.append(
            f'<text x="{rx:.1f}" y="{max(ry - 4, iy + 10):.1f}" fill="{color}" font-size="10">#{track.get("id")}</text>'
        )
    return "".join(out)


def _legend(
    doc: dict[str, Any],
    persons: list[dict[str, Any]],
    balls: list[dict[str, Any]],
    colors: dict[int, str],
    x: float,
    y: float,
    w: float,
    max_rows: int,
) -> str:
    summary = doc.get("summary", {})
    rows: list[str] = [
        f'<text x="{x}" y="{y + 16}" fill="{TEXT}" font-size="14" font-weight="600">球员轨迹</text>',
        f'<text x="{x}" y="{y + 38}" fill="{MUTED}" font-size="12">'
        f"按在场时长排序，前 {min(len(persons), max_rows)} 条</text>",
    ]

    row_y = y + 64
    for track in persons[:max_rows]:
        color = colors.get(id(track), PALETTE[0])
        rows.append(f'<rect x="{x}" y="{row_y - 9}" width="10" height="10" rx="3" fill="{color}"/>')
        rows.append(
            f'<text x="{x + 18}" y="{row_y}" fill="{TEXT}" font-size="12" font-weight="600">#{track.get("id")}</text>'
        )
        rows.append(
            f'<text x="{x + 66}" y="{row_y}" fill="{TEXT}" font-size="12">{track.get("span_s")} s</text>'
        )
        rows.append(
            f'<text x="{x + 150}" y="{row_y}" fill="{MUTED}" font-size="12">'
            f"{track.get('n')} 帧 · 框高 {track.get('mean_height_px')} px · 置信 {track.get('mean_conf')}</text>"
        )
        row_y += 26

    if len(persons) > max_rows:
        rows.append(
            f'<text x="{x}" y="{row_y + 6}" fill="{MUTED}" font-size="12">还有 {len(persons) - max_rows} 条未列出</text>'
        )
        row_y += 26

    row_y += 18
    rows.append(f'<line x1="{x}" y1="{row_y}" x2="{x + w}" y2="{row_y}" stroke="{GRID}"/>')
    row_y += 26
    rows.append(f'<text x="{x}" y="{row_y}" fill="{TEXT}" font-size="13" font-weight="600">怎么读这张图</text>')
    tips = [
        "圆点是轨迹起点，空心圈是终点。",
        "同一颜色的线断开，说明这个人在那段时间被跟丢了。",
        "线在画面里来回折返、长度远超其他人，通常是误检。",
        f"球轨迹 {len(balls)} 条、{summary.get('untracked_detections')} 个检测没进任何轨迹，属正常。",
    ]
    row_y += 22
    for tip in tips:
        rows.append(f'<text x="{x}" y="{row_y}" fill="{MUTED}" font-size="12">· {escape(tip)}</text>')
        row_y += 20
    return "".join(rows)


# ------------------------------------------------------------------ 工具


def _fmt_duration(seconds: float) -> str:
    total = int(round(float(seconds or 0)))
    return f"{total // 60}:{total % 60:02d}"


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def guess_snapshot(out_svg: str | Path) -> Path:
    """与 ingest 约定：轨迹 JSON 旁的 .jpg 就是代表帧。"""
    path = Path(out_svg)
    return path.with_suffix(".jpg")


def _unused(*_: Any) -> None:  # pragma: no cover - 占位，保持导入面稳定
    return None


__all__ = ["render_tracks_svg", "guess_snapshot"]
