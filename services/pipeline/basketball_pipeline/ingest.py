"""真实视频 ingest：抽帧 → 检测 → 跟踪 → 轨迹 JSON。

这一层只做"人在哪、球在哪"，不做任何篮球语义判断 ——
出手点、命中率、阵型都要等标定和事件提取之后才成立。

三条设计约束：

1. **重依赖延迟导入**。cv2 / ultralytics / torch 都只在真正跑视频时才 import，
   纯逻辑（抽帧调度、轨迹统计、序列化）可以在任何机器上测。
2. **检测器可注入**。`Detector` 是个协议，测试用假检测器喂脚本化的框，
   不需要模型权重、不需要 GPU、不需要网络。
3. **输出是轨迹而不是报告**。报告要过契约 v1.1，那得先有标定；
   轨迹只需要"视频里有哪些人、各自在哪几帧、框多大"。

产物结构见 `TRACKS_SCHEMA_VERSION`，渲染见 `render.py`。
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Protocol, Sequence

TRACKS_SCHEMA_VERSION = "tracks-1"

PERSON = "person"
SPORTS_BALL = "sports ball"

# COCO 里只关心这两类：0 = person，32 = sports ball
COCO_PERSON = 0
COCO_SPORTS_BALL = 32


# ---------------------------------------------------------------- 视频元信息


@dataclass(frozen=True)
class VideoMeta:
    """一段视频的基本事实。"""

    path: str
    width: int
    height: int
    fps: float
    frame_count: int

    @property
    def duration_s(self) -> float:
        if self.fps <= 0:
            return 0.0
        return self.frame_count / self.fps

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "width": self.width,
            "height": self.height,
            "fps": _round(self.fps, 3),
            "frame_count": self.frame_count,
            "duration_s": _round(self.duration_s, 3),
        }


def _cv2():
    """延迟导入 cv2，缺依赖时给出可读的错误。"""
    try:
        import cv2  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - 依赖环境
        raise RuntimeError(
            "需要 opencv-python 才能处理视频：pip install opencv-python"
        ) from exc
    return cv2


def probe_video(path: str | Path) -> VideoMeta:
    """读视频的头信息。手机视频常见 fps 缺失，这里退化成 30 fps 并保留原值。"""
    cv2 = _cv2()
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise FileNotFoundError(f"打不开视频：{path}")
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not math.isfinite(fps) or fps <= 1e-6:
            fps = 30.0
        return VideoMeta(
            path=str(path),
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0),
            height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0),
            fps=fps,
            frame_count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
        )
    finally:
        cap.release()


# ---------------------------------------------------------------- 抽帧调度


def sample_indices(frame_count: int, src_fps: float, target_fps: float) -> list[int]:
    """按目标帧率挑出要处理的帧号。

    抽帧而不是逐帧的原因：30 fps 的 10 分钟视频有 18000 帧，
    跟踪不需要那么密的采样，8 fps 已经把 0.125 s 的动作分得开。
    """
    if frame_count <= 0:
        return []
    if target_fps <= 0:
        raise ValueError("target_fps 必须为正数")
    if src_fps <= 0:
        raise ValueError("src_fps 必须为正数")
    if target_fps >= src_fps:
        return list(range(frame_count))

    step = src_fps / target_fps
    indices: list[int] = []
    k = 0
    while True:
        idx = int(round(k * step))
        if idx >= frame_count:
            break
        indices.append(idx)
        k += 1
    return indices


# ---------------------------------------------------------------- 检测结果


@dataclass(frozen=True)
class Box:
    """一帧里的一个检测框。"""

    xyxy: tuple[float, float, float, float]
    conf: float
    cls_name: str
    track_id: int | None = None

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.xyxy
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    @property
    def height(self) -> float:
        return self.xyxy[3] - self.xyxy[1]


class Detector(Protocol):
    """检测 + 跟踪的抽象。实现方负责在内部维持跟踪状态。"""

    def update(self, frame: Any, index: int) -> list[Box]:
        ...


class UltralyticsDetector:
    """YOLO + ByteTrack。默认 yolo11n，权重缺失时 ultralytics 会自己下载。"""

    def __init__(
        self,
        model: str = "yolo11n.pt",
        device: str | None = None,
        imgsz: int = 960,
        conf: float = 0.25,
        classes: Sequence[int] = (COCO_PERSON, COCO_SPORTS_BALL),
        tracker: str = "bytetrack.yaml",
    ) -> None:
        from ultralytics import YOLO  # noqa: PLC0415

        self.model = YOLO(model)
        self.device = _resolve_device(device)
        self.imgsz = imgsz
        self.conf = conf
        self.classes = list(classes)
        self.tracker = tracker
        self.names = dict(getattr(self.model, "names", {}) or {})

    def update(self, frame: Any, index: int) -> list[Box]:
        results = self.model.track(
            frame,
            persist=True,
            tracker=self.tracker,
            classes=self.classes,
            conf=self.conf,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
        )
        boxes: list[Box] = []
        for result in results:
            raw = getattr(result, "boxes", None)
            if raw is None or len(raw) == 0:
                continue
            ids = getattr(raw, "id", None)
            for i in range(len(raw)):
                cls_id = int(raw.cls[i].item())
                track_id = int(ids[i].item()) if ids is not None else None
                x1, y1, x2, y2 = (float(v) for v in raw.xyxy[i].tolist())
                boxes.append(
                    Box(
                        xyxy=(x1, y1, x2, y2),
                        conf=float(raw.conf[i].item()),
                        cls_name=self.names.get(cls_id, str(cls_id)),
                        track_id=track_id,
                    )
                )
        return boxes


def _resolve_device(device: str | None) -> str:
    if device and device != "auto":
        return device
    try:
        import torch  # noqa: PLC0415

        if torch.backends.mps.is_available():
            return "mps"
    except Exception:  # pragma: no cover - 无 torch 时走 cpu
        pass
    return "cpu"


# ---------------------------------------------------------------- 汇总


class _TrackAccumulator:
    """把逐帧检测攒成轨迹。"""

    def __init__(self) -> None:
        self.frames: dict[tuple[str, int], list[list[float]]] = {}
        self.confs: dict[tuple[str, int], list[float]] = {}
        self.heights: dict[tuple[str, int], list[float]] = {}
        self.detections = 0
        self.untracked = 0

    def add(self, box: Box, t: float, index: int) -> None:
        self.detections += 1
        if box.track_id is None:
            self.untracked += 1
            return
        key = (box.cls_name, int(box.track_id))
        x1, y1, x2, y2 = box.xyxy
        self.frames.setdefault(key, []).append(
            [index, _round(t, 3), _round(x1, 1), _round(y1, 1), _round(x2, 1), _round(y2, 1)]
        )
        self.confs.setdefault(key, []).append(box.conf)
        self.heights.setdefault(key, []).append(box.height)

    def to_tracks(self) -> list[dict[str, Any]]:
        tracks: list[dict[str, Any]] = []
        for (cls_name, track_id), frames in self.frames.items():
            heights = self.heights[(cls_name, track_id)]
            confs = self.confs[(cls_name, track_id)]
            first_t = frames[0][1]
            last_t = max(f[1] for f in frames)
            span = last_t - first_t
            grid = int(round(span * 1.0)) + 1
            tracks.append(
                {
                    "id": track_id,
                    "cls": cls_name,
                    "frames": frames,
                    "n": len(frames),
                    "first_t": first_t,
                    "last_t": last_t,
                    "span_s": _round(span, 3),
                    "density": _round(len(frames) / max(grid, len(frames)), 3),
                    "mean_conf": _round(sum(confs) / len(confs), 3),
                    "mean_height_px": _round(sum(heights) / len(heights), 1),
                }
            )
        tracks.sort(key=lambda t: (-t["span_s"], t["cls"], t["id"]))
        return tracks


def _health(
    summary: dict[str, Any], expected_players: int | None, duration_s: float
) -> dict[str, Any]:
    """给一句能直接看的判断，而不是让人对着数字猜。"""
    persons = summary["person_tracks"]
    notes: list[str] = []
    level = "ok"
    if expected_players:
        ratio = persons / expected_players
        if ratio > 1.8:
            level = "warn"
            notes.append(
                f"检测到 {persons} 条球员轨迹，约是场上人数 {expected_players} 的 {ratio:.1f} 倍，"
                "跟踪大概率在碎裂；先看轨迹图再谈统计。"
            )
        elif ratio < 0.6:
            level = "warn"
            notes.append(
                f"只有 {persons} 条球员轨迹，少于场上人数 {expected_players}，"
                "可能有漏检或相机没拍全。"
            )
    # 短视频里"活不过 5 秒"是必然的，不能拿来做判断
    short = summary["person_tracks_under_5s"]
    if duration_s >= 10.0 and persons and short / persons > 0.5:
        level = "warn"
        notes.append(f"{short}/{persons} 条轨迹活不过 5 秒，基本是误检或碎片。")
    if not persons:
        level = "empty"
        notes.append("没检测到任何球员，检查机位、分辨率和 --conf。")
    return {"level": level, "notes": notes}


# ---------------------------------------------------------------- 主流程


def ingest_video(
    video_path: str | Path,
    detector: Detector,
    *,
    sampled_fps: float = 8.0,
    max_seconds: float | None = None,
    snapshot_path: str | Path | None = None,
    expected_players: int | None = None,
    model_label: str | None = None,
    imgsz: int | None = None,
    conf_threshold: float | None = None,
    device: str | None = None,
) -> dict[str, Any]:
    """跑完一段视频，返回轨迹文档（可直接 json.dump）。"""
    cv2 = _cv2()
    started = time.time()
    meta = probe_video(video_path)

    if meta.frame_count > 0:
        wanted = set(sample_indices(meta.frame_count, meta.fps, sampled_fps))
        should_process = lambda i, t: i in wanted  # noqa: E731
    else:  # pragma: no cover - 少数容器不写帧数
        step_s = 1.0 / sampled_fps
        state = {"next": 0.0}

        def should_process(i: int, t: float) -> bool:
            if t + 1e-9 >= state["next"]:
                state["next"] += step_s
                return True
            return False

    acc = _TrackAccumulator()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"打不开视频：{video_path}")

    processed = 0
    best_count = -1
    best_frame = None
    best_index = 0
    index = 0
    try:
        while True:
            t = index / meta.fps if meta.fps else 0.0
            if max_seconds is not None and t > max_seconds:
                break
            take = should_process(index, t)

            ok = cap.grab()
            if not ok:
                break
            if not take:
                index += 1
                continue

            ok, frame = cap.retrieve()
            if not ok:
                break
            boxes = detector.update(frame, index)
            for box in boxes:
                acc.add(box, t, index)
            processed += 1

            person_count = sum(1 for b in boxes if b.cls_name == PERSON)
            if person_count > best_count:
                best_count = person_count
                best_frame = frame.copy()
                best_index = index

            index += 1
    finally:
        cap.release()

    if snapshot_path is not None and best_frame is not None:
        Path(snapshot_path).parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(snapshot_path), best_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])

    tracks = acc.to_tracks()
    persons = [t for t in tracks if t["cls"] == PERSON]
    balls = [t for t in tracks if t["cls"] == SPORTS_BALL]

    def _median(values: list[float]) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        mid = len(ordered) // 2
        if len(ordered) % 2:
            return ordered[mid]
        return (ordered[mid - 1] + ordered[mid]) / 2.0

    summary = {
        "processed_frames": processed,
        "detections": acc.detections,
        "untracked_detections": acc.untracked,
        "person_tracks": len(persons),
        "ball_tracks": len(balls),
        "person_tracks_under_5s": sum(1 for t in persons if t["span_s"] < 5.0),
        "longest_person_span_s": _round(max((t["span_s"] for t in persons), default=0.0), 3),
        "median_person_span_s": _round(_median([t["span_s"] for t in persons]), 3),
        "median_person_height_px": _round(_median([t["mean_height_px"] for t in persons]), 1),
    }

    return {
        "schema_version": TRACKS_SCHEMA_VERSION,
        "video": meta.to_dict(),
        "ingest": {
            "sampled_fps": sampled_fps,
            "max_seconds": max_seconds,
            "model": model_label or type(detector).__name__,
            "imgsz": imgsz,
            "conf": conf_threshold,
            "device": device,
            "elapsed_s": _round(time.time() - started, 2),
            "snapshot_frame": best_index,
        },
        "summary": summary,
        "health": _health(summary, expected_players, meta.duration_s),
        "tracks": tracks,
    }


# ---------------------------------------------------------------- 工具


def _round(value: float, digits: int) -> float:
    return float(f"{value:.{digits}f}")


def write_tracks(doc: dict[str, Any], out_path: str | Path) -> Path:
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


def read_tracks(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def format_summary(doc: dict[str, Any]) -> str:
    """命令行里给人看的一段话。"""
    video = doc.get("video", {})
    summary = doc.get("summary", {})
    health = doc.get("health", {})
    lines = [
        f"视频  {video.get('width')}×{video.get('height')}  {video.get('fps')} fps  "
        f"{_fmt_duration(video.get('duration_s', 0))}",
        f"处理  {summary.get('processed_frames')} 帧（采样 {doc.get('ingest', {}).get('sampled_fps')} fps）",
        f"轨迹  球员 {summary.get('person_tracks')} 条 / 球 {summary.get('ball_tracks')} 条"
        f"（未入轨检测 {summary.get('untracked_detections')} 个）",
        f"时长  最长 {summary.get('longest_person_span_s')} s  中位 {summary.get('median_person_span_s')} s  "
        f"人中位框高 {summary.get('median_person_height_px')} px",
    ]
    notes = health.get("notes") or []
    if notes:
        lines.append("")
        lines.extend(f"· {note}" for note in notes)
    return "\n".join(lines)


def _fmt_duration(seconds: float) -> str:
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


__all__ = [
    "TRACKS_SCHEMA_VERSION",
    "PERSON",
    "SPORTS_BALL",
    "Box",
    "Detector",
    "UltralyticsDetector",
    "VideoMeta",
    "format_summary",
    "ingest_video",
    "probe_video",
    "read_tracks",
    "sample_indices",
    "write_tracks",
]
