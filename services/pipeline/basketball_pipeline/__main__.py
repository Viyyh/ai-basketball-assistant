"""pipeline 命令行。

    # 造一份契约合法的示例报告（不需要视频）
    python -m basketball_pipeline sample --out report.json

    # 真实视频 → 轨迹 JSON + 轨迹图（需要 opencv + ultralytics）
    python -m basketball_pipeline ingest --video data/raw/game01.mp4 --out data/tracks/game01.json

    # 只重画轨迹图
    python -m basketball_pipeline render --tracks data/tracks/game01.json --out data/tracks/game01.svg

`sample` 的产物可以直接交给 contracts/bin/validate-report.mjs 校验；
`ingest` 的产物是轨迹，还没到"报告"那一层。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from basketball_params import AgeGroup, CourtType, Format

from .ingest import format_summary, ingest_video, read_tracks, write_tracks
from .mock import build_report
from .render import guess_snapshot, render_tracks_svg


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="basketball_pipeline", description="AI Basketball Assistant pipeline"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    sample = sub.add_parser("sample", help="生成一份契约合法的示例报告")
    sample.add_argument("--format", default="5V5", choices=[f.value for f in Format])
    sample.add_argument("--age", default="U15", choices=[a.value for a in AgeGroup])
    sample.add_argument("--court-type", default=None, choices=[c.value for c in CourtType],
                        help="4v4 / 自定义赛制必须指定")
    sample.add_argument("--radius", type=float, default=None,
                        help="覆盖三分线半径（默认 6.75 m）")
    sample.add_argument("--out", default="-", help="输出路径，- 表示 stdout")

    ingest = sub.add_parser("ingest", help="真实视频 → 轨迹 JSON（检测 + 跟踪）")
    ingest.add_argument("--video", required=True, help="输入视频")
    ingest.add_argument("--out", required=True, help="轨迹 JSON 输出路径")
    ingest.add_argument("--fps", type=float, default=8.0, help="抽帧帧率，默认 8")
    ingest.add_argument("--max-seconds", type=float, default=None, help="只处理前 N 秒，用于试跑")
    ingest.add_argument("--model", default="yolo11n.pt", help="权重文件或模型名")
    ingest.add_argument("--imgsz", type=int, default=960, help="推理分辨率")
    ingest.add_argument("--conf", type=float, default=0.25, help="置信度阈值")
    ingest.add_argument("--device", default="auto", help="auto / cpu / mps / 0")
    ingest.add_argument("--expected-players", type=int, default=None,
                        help="场上人数，用来判断轨迹有没有碎裂")
    ingest.add_argument("--snapshot", default=None,
                        help="代表帧图片路径，默认与 --out 同名 .jpg")
    ingest.add_argument("--no-svg", action="store_true", help="不生成轨迹图")

    render = sub.add_parser("render", help="把轨迹 JSON 画成 SVG")
    render.add_argument("--tracks", required=True, help="轨迹 JSON")
    render.add_argument("--out", required=True, help="SVG 输出路径")
    render.add_argument("--snapshot", default=None, help="代表帧图片，默认找同名 .jpg")

    return parser.parse_args(argv)


def _cmd_sample(args: argparse.Namespace) -> int:
    report = build_report(
        fmt=Format(args.format),
        age_group=AgeGroup(args.age),
        court_type=CourtType(args.court_type) if args.court_type else None,
        three_point_radius_m=args.radius,
    )
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out == "-":
        print(text)
    else:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
        print(f"已写入 {out}（{len(report['events'])} 个事件）", file=sys.stderr)
    return 0


def _cmd_ingest(args: argparse.Namespace) -> int:
    from .ingest import UltralyticsDetector

    out = Path(args.out)
    snapshot = Path(args.snapshot) if args.snapshot else out.with_suffix(".jpg")

    try:
        detector = UltralyticsDetector(
            model=args.model, device=args.device, imgsz=args.imgsz, conf=args.conf
        )
    except Exception as exc:  # 依赖缺失或权重下载失败
        print(f"初始化检测器失败：{exc}", file=sys.stderr)
        print("需要：pip install ultralytics opencv-python", file=sys.stderr)
        return 1

    try:
        doc = ingest_video(
            args.video,
            detector,
            sampled_fps=args.fps,
            max_seconds=args.max_seconds,
            snapshot_path=snapshot,
            expected_players=args.expected_players,
            model_label=args.model,
            imgsz=args.imgsz,
            conf_threshold=args.conf,
            device=detector.device,
        )
    except FileNotFoundError as exc:
        print(f"{exc}", file=sys.stderr)
        return 1

    write_tracks(doc, out)
    print(format_summary(doc))
    print(f"\n轨迹  {out}")

    if not args.no_svg:
        svg = out.with_suffix(".svg")
        render_tracks_svg(doc, svg, snapshot=snapshot if snapshot.exists() else None)
        print(f"轨迹图 {svg}")

    if doc["summary"]["person_tracks"] == 0:
        print("\n没有检测到球员，先把 --conf 降到 0.15 或换更高的机位再试。", file=sys.stderr)
        return 1
    return 0


def _cmd_render(args: argparse.Namespace) -> int:
    doc = read_tracks(args.tracks)
    snapshot = Path(args.snapshot) if args.snapshot else guess_snapshot(args.tracks)
    out = render_tracks_svg(doc, args.out, snapshot=snapshot if snapshot.exists() else None)
    print(f"已写入 {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    if args.cmd == "sample":
        return _cmd_sample(args)
    if args.cmd == "ingest":
        return _cmd_ingest(args)
    if args.cmd == "render":
        return _cmd_render(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
