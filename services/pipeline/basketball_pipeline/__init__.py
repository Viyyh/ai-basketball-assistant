"""AI Basketball Assistant 的 pipeline 包。

`mock` 造报告（不需要视频），`ingest` 处理真实视频（需要 opencv / ultralytics），
`render` 把轨迹画成 SVG。
"""

from .ingest import (
    PERSON,
    SPORTS_BALL,
    TRACKS_SCHEMA_VERSION,
    Box,
    VideoMeta,
    format_summary,
    ingest_video,
    probe_video,
    read_tracks,
    sample_indices,
    write_tracks,
)
from .mock import build_report
from .render import render_tracks_svg

__all__ = [
    "PERSON",
    "SPORTS_BALL",
    "TRACKS_SCHEMA_VERSION",
    "Box",
    "VideoMeta",
    "build_report",
    "format_summary",
    "ingest_video",
    "probe_video",
    "read_tracks",
    "render_tracks_svg",
    "sample_indices",
    "write_tracks",
]
__version__ = "1.1.0"
