"""轨迹层测试。

这里不碰模型、不碰真实比赛：用一个"假检测器"喂脚本化的框，
再加一段几秒钟的合成视频，验证抽帧调度、轨迹统计、健康判断和渲染。

真实效果只有真视频能回答 —— 这些测试保证的是"拿到了真视频，代码不会跑错"。
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from basketball_pipeline.ingest import (
    PERSON,
    SPORTS_BALL,
    Box,
    format_summary,
    ingest_video,
    parse_polygon,
    point_in_polygon,
    read_tracks,
    sample_indices,
    write_tracks,
)
from basketball_pipeline.render import render_tracks_svg

try:  # 没有 opencv 的机器上跳过视频相关用例
    import cv2

    HAS_CV2 = True
except ImportError:  # pragma: no cover
    HAS_CV2 = False


# ---------------------------------------------------------------- 抽帧调度


class TestSampleIndices(unittest.TestCase):
    def test_30fps_to_8fps(self) -> None:
        indices = sample_indices(300, 30.0, 8.0)
        self.assertEqual(indices[0], 0)
        self.assertEqual(len(indices), 80)  # 300 帧 / (30/8) = 80
        self.assertEqual(indices[1], 4)  # round(3.75) = 4
        self.assertTrue(all(a < b for a, b in zip(indices, indices[1:])), "帧号必须严格递增")
        self.assertLess(indices[-1], 300)

    def test_never_upsamples(self) -> None:
        self.assertEqual(sample_indices(10, 8.0, 30.0), list(range(10)))

    def test_same_rate_keeps_every_frame(self) -> None:
        self.assertEqual(sample_indices(5, 25.0, 25.0), [0, 1, 2, 3, 4])

    def test_empty_and_invalid(self) -> None:
        self.assertEqual(sample_indices(0, 30.0, 8.0), [])
        with self.assertRaises(ValueError):
            sample_indices(100, 30.0, 0.0)


# ---------------------------------------------------------------- 假检测器


class FakeDetector:
    """按帧号返回脚本化的框，用来替代 YOLO。"""

    def __init__(self) -> None:
        self.calls: list[int] = []

    def update(self, frame: Any, index: int) -> list[Box]:
        self.calls.append(index)
        boxes = [
            Box(xyxy=(10.0, 20.0, 60.0, 140.0), conf=0.9, cls_name=PERSON, track_id=1),
            Box(xyxy=(200.0, 30.0, 250.0, 150.0), conf=0.8, cls_name=PERSON, track_id=2),
            Box(xyxy=(120.0, 90.0, 135.0, 105.0), conf=0.4, cls_name=SPORTS_BALL, track_id=7),
            # 没有 id 的检测：被跟踪器丢弃的碎框
            Box(xyxy=(300.0, 30.0, 320.0, 120.0), conf=0.3, cls_name=PERSON, track_id=None),
        ]
        if index >= 40:  # 模拟 2 号中途被换下
            boxes = [b for b in boxes if b.track_id != 2]
        return boxes


def _make_video(path: Path, *, frames: int = 80, fps: float = 20.0) -> None:
    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (320, 240)
    )
    assert writer.isOpened(), "当前环境无法写 mp4"
    import numpy as np

    for i in range(frames):
        value = (i * 3) % 255
        writer.write(np.full((240, 320, 3), value, dtype="uint8"))
    writer.release()


# ---------------------------------------------------------------- 主流程


@unittest.skipUnless(HAS_CV2, "需要 opencv")
class TestIngest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.video = self.dir / "clip.mp4"
        _make_video(self.video)

    def test_tracks_and_stats(self) -> None:
        detector = FakeDetector()
        doc = ingest_video(self.video, detector, sampled_fps=8.0, expected_players=2)

        self.assertEqual(doc["schema_version"], "tracks-1")
        self.assertEqual(doc["video"]["width"], 320)
        self.assertEqual(doc["video"]["height"], 240)
        self.assertGreater(doc["summary"]["processed_frames"], 0)
        self.assertEqual(detector.calls, sorted(detector.calls), "帧必须按顺序喂给跟踪器")

        tracks = {t["id"]: t for t in doc["tracks"]}
        self.assertIn(1, tracks)
        self.assertIn(2, tracks)
        self.assertEqual(tracks[1]["cls"], PERSON)
        # 1 号全程在，2 号中途消失 —— 时长必须能区分开
        self.assertGreater(tracks[1]["span_s"], tracks[2]["span_s"])
        self.assertGreater(tracks[1]["mean_height_px"], 0)
        self.assertEqual(doc["summary"]["untracked_detections"], len(detector.calls))
        self.assertEqual(doc["tracks"], sorted(doc["tracks"], key=lambda t: -t["span_s"]))

    def test_max_seconds_stops_early(self) -> None:
        short = ingest_video(self.video, FakeDetector(), sampled_fps=8.0, max_seconds=1.0)
        full = ingest_video(self.video, FakeDetector(), sampled_fps=8.0)
        self.assertLess(short["summary"]["processed_frames"], full["summary"]["processed_frames"])
        self.assertEqual(short["ingest"]["max_seconds"], 1.0)

    def test_health_warns_on_fragmentation(self) -> None:
        doc = ingest_video(self.video, FakeDetector(), sampled_fps=8.0, expected_players=1)
        self.assertEqual(doc["health"]["level"], "warn")
        self.assertTrue(any("碎裂" in note for note in doc["health"]["notes"]))

    def test_health_flags_empty_result(self) -> None:
        class Blind:
            def update(self, frame: Any, index: int) -> list[Box]:
                return []

        doc = ingest_video(self.video, Blind(), sampled_fps=4.0)
        self.assertEqual(doc["summary"]["person_tracks"], 0)
        self.assertEqual(doc["health"]["level"], "empty")

    def test_snapshot_written(self) -> None:
        snap = self.dir / "snap.jpg"
        ingest_video(self.video, FakeDetector(), sampled_fps=8.0, snapshot_path=snap)
        self.assertTrue(snap.exists())
        self.assertGreater(snap.stat().st_size, 0)

    def test_summary_is_human_readable(self) -> None:
        doc = ingest_video(self.video, FakeDetector(), sampled_fps=8.0)
        text = format_summary(doc)
        self.assertIn("球员", text)

    def test_roundtrip_json(self) -> None:
        doc = ingest_video(self.video, FakeDetector(), sampled_fps=8.0)
        out = self.dir / "tracks.json"
        write_tracks(doc, out)
        again = read_tracks(out)
        self.assertEqual(again["summary"], doc["summary"])
        # 存盘后必须还能被 json 读回，且体积可控（紧凑格式）
        self.assertLess(out.stat().st_size, 200_000)


# ---------------------------------------------------------------- 渲染


class TestRender(unittest.TestCase):
    def _doc(self, persons: int = 3) -> dict[str, Any]:
        tracks = []
        for p in range(persons):
            frames = [[i, i * 0.125, 10.0 + p * 30, 20.0, 60.0 + p * 30, 140.0] for i in range(8)]
            tracks.append(
                {
                    "id": p + 1,
                    "cls": PERSON,
                    "frames": frames,
                    "n": len(frames),
                    "first_t": 0.0,
                    "last_t": 0.875,
                    "span_s": 0.875,
                    "density": 1.0,
                    "mean_conf": 0.9,
                    "mean_height_px": 120.0,
                }
            )
        return {
            "schema_version": "tracks-1",
            "video": {"path": "x.mp4", "width": 320, "height": 240, "fps": 20.0,
                      "frame_count": 80, "duration_s": 4.0},
            "ingest": {"sampled_fps": 8.0, "snapshot_frame": 3},
            "summary": {
                "processed_frames": 8, "detections": 24, "untracked_detections": 0,
                "person_tracks": persons, "ball_tracks": 1, "person_tracks_under_5s": persons,
                "longest_person_span_s": 0.875, "median_person_span_s": 0.875,
                "median_person_height_px": 120.0,
            },
            "health": {"level": "ok", "notes": []},
            "tracks": tracks,
        }

    def test_svg_has_one_polyline_per_person(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "t.svg"
            render_tracks_svg(self._doc(3), out)
            svg = out.read_text(encoding="utf-8")
            self.assertTrue(svg.startswith("<svg"))
            self.assertEqual(svg.count("<polyline"), 3)
            self.assertIn("轨迹体检", svg)

    def test_svg_survives_empty_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "t.svg"
            doc = self._doc(0)
            doc["tracks"] = []
            doc["health"] = {"level": "empty", "notes": ["没检测到任何球员"]}
            render_tracks_svg(doc, out)
            self.assertTrue(out.exists())

    def test_legend_truncates_long_lists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "t.svg"
            render_tracks_svg(self._doc(30), out, max_legend=5)
            svg = out.read_text(encoding="utf-8")
            self.assertIn("条未列出", svg)


class RoiTest(unittest.TestCase):
    POLY = [(300, 500), (1520, 495), (1600, 780), (260, 900)]

    def test_parse_polygon(self) -> None:
        self.assertEqual(parse_polygon("1,2;3,4;5,6"), [(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)])

    def test_parse_polygon_none(self) -> None:
        self.assertIsNone(parse_polygon(None))
        self.assertIsNone(parse_polygon(""))

    def test_parse_polygon_needs_three_points(self) -> None:
        with self.assertRaises(ValueError):
            parse_polygon("1,2;3,4")

    def test_parse_polygon_rejects_garbage(self) -> None:
        with self.assertRaises(ValueError):
            parse_polygon("1,2;3;5,6")

    def test_point_in_polygon(self) -> None:
        self.assertTrue(point_in_polygon(900, 650, self.POLY))
        self.assertFalse(point_in_polygon(900, 200, self.POLY))   # 观众席
        self.assertFalse(point_in_polygon(100, 950, self.POLY))   # 画面前景


if __name__ == "__main__":
    unittest.main()
