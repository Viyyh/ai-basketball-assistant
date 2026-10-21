"""
视频处理管线接口 —— 占位实现。

本文件定义 AI pipeline 必须遵守的契约，但**不包含真实推理**。
真实推理需要两个当前环境不具备的前提：

  1. 真实录像素材（三组参数各需一段，见 README）
  2. GPU 环境（本机为 AMD 核显，无 CUDA；PyTorch 只能 CPU 推理，
     40 分钟全场视频逐帧处理在 CPU 上不现实）

契约本身是有价值的：它把"参数如何流入 pipeline"固定下来，
使得参数层（params / court / aggregate）可以先被完整验证，
而不用等视频链路就绪。

对应范围确认 v0.2 第 5.3 节：
    pipeline 的所有环节都以活动的 format + age_group 作为参数输入，
    不存在"默认按成人 5对5 处理"的隐式假设。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Sequence

from .court import CourtGeometry, Shot, ShotJudgement, build_court
from .params import ActivityParams, Format


# ============================================================
# pipeline 各阶段的输出契约
# ============================================================

@dataclass
class CalibrationResult:
    """场地标定结果：像素 → 米制的映射。"""
    params: ActivityParams
    homography: tuple[float, ...] | None = None   # 3x3 单应矩阵，展平存放
    mean_reproj_error_px: float | None = None     # 重投影误差，标定质量指标
    ok: bool = False
    note: str = ""


@dataclass
class TrackedFrame:
    """单帧跟踪结果。不要求 ID 跨全场稳定（范围确认：B 级不做 ReID）。"""
    timestamp_s: float
    player_positions_m: list[tuple[float, float]] = field(default_factory=list)
    ball_position_m: tuple[float, float] | None = None


@dataclass
class DetectedEvent:
    """识别出的事件。shot 字段只在投篮类事件上有值。"""
    kind: str                       # SHOT / TURNOVER / FAST_BREAK / ...
    timestamp_s: float
    period: int = 1
    shot: Shot | None = None
    judgement: ShotJudgement | None = None
    confidence: float = 0.0


@dataclass
class FormationSnapshot:
    """阵型快照。点数必须等于 tracking.formation_points。"""
    timestamp_s: float
    positions_m: list[tuple[float, float]]
    label: str | None = None        # 阵型名，置信度不足时应为 None（界面设计 v0.1 屏 08）


@dataclass
class ReportJson:
    """最终报告。这是"上传 → AI 处理 → 出报告 JSON"闭环的终点产物。"""
    activity_id: str
    params: ActivityParams
    calibration: CalibrationResult | None = None
    events: list[DetectedEvent] = field(default_factory=list)
    formations: list[FormationSnapshot] = field(default_factory=list)
    clips: list[dict] = field(default_factory=list)   # 事件切片元数据
    warnings: list[str] = field(default_factory=list)


# ============================================================
# 管线接口
# ============================================================

class AnalysisPipeline(Protocol):
    """真实 pipeline 需实现这五个阶段。顺序与范围确认 5.3 节一致。"""

    def calibrate(self, video_path: str, params: ActivityParams) -> CalibrationResult: ...
    def detect_and_track(self, video_path: str,
                         params: ActivityParams,
                         calib: CalibrationResult) -> Sequence[TrackedFrame]: ...
    def recognize_events(self, frames: Sequence[TrackedFrame],
                         params: ActivityParams,
                         court: CourtGeometry) -> Sequence[DetectedEvent]: ...
    def sample_formations(self, frames: Sequence[TrackedFrame],
                          params: ActivityParams) -> Sequence[FormationSnapshot]: ...
    def cut_clips(self, video_path: str,
                  events: Sequence[DetectedEvent]) -> Sequence[dict]: ...


# ============================================================
# 参数校验：不需要视频就能跑的那部分
# ============================================================

def validate_params_for_pipeline(params: ActivityParams) -> list[str]:
    """
    在把参数交给 pipeline 之前做一次自检，返回问题清单（空列表 = 通过）。

    这是风险 7.4 应对措施第 3、4 条的落地点：
    参数在进入 AI 之前先被检查一遍，避免"看起来正常但全错"的处理结果。
    """
    problems: list[str] = []

    # 1. 3x3 必须是半场单框
    if params.fmt is Format.THREE_V_THREE:
        if params.court.hoop_count != 1:
            problems.append("3对3 必须是单框场地，当前 hoop_count="
                            f"{params.court.hoop_count}")
        if params.court.court_type.value != "HALF":
            problems.append("3对3 必须是半场，当前 court_type="
                            f"{params.court.court_type.value}")
        if params.rules.shot_clock_s != 12:
            problems.append(f"3对3 进攻时限应为 12 秒，当前 "
                            f"{params.rules.shot_clock_s}")
        if params.rules.fast_break_enabled:
            problems.append("3对3 第一版应关闭快攻识别（12 秒时限下会大量误判）")
        if (params.rules.inside_arc_points, params.rules.outside_arc_points) != (1, 2):
            problems.append("3对3 计分应为弧内 1 分 / 弧外 2 分，当前 "
                            f"{params.rules.inside_arc_points}/"
                            f"{params.rules.outside_arc_points}")

    # 2. 5v5 必须是全场双框
    if params.fmt is Format.FIVE_V_FIVE:
        if params.court.hoop_count != 2:
            problems.append("5对5 应为双框全场")
        if params.rules.shot_clock_s != 24:
            problems.append(f"5对5 进攻时限应为 24 秒，当前 {params.rules.shot_clock_s}")

    # 3. 三分线几何自洽性 —— 这条最关键
    tp = params.three_point
    if tp.geometry.value == "ARC_AND_CORNERS":
        if tp.corner_lateral_m is None:
            problems.append("弧线+底角几何必须提供 corner_lateral_m")
        elif tp.radius_m <= tp.corner_lateral_m:
            problems.append(
                f"几何矛盾：弧线半径 {tp.radius_m} m <= 底角横向 {tp.corner_lateral_m} m，"
                f"底角直线段会落在弧线内侧，判定结果不可信。应退化为纯弧线。"
            )
    elif tp.corner_lateral_m is not None:
        problems.append("纯弧线几何不应携带 corner_lateral_m")

    # 4. 阵型点数与赛制人数一致
    if params.tracking.formation_points != params.tracking.players_per_team:
        problems.append("阵型点数应等于每队人数")

    # 5. 场地范围合理性
    if params.court.length_m <= 0 or params.court.width_m <= 0:
        problems.append("场地尺寸非法")

    return problems


def pipeline_readiness() -> dict:
    """
    报告真实视频链路的就绪状态。

    run_poc.py 会调用它，明确区分"已验证"与"被阻塞"两部分，
    避免让人误以为整个 PoC 都跑通了。
    """
    import shutil

    return {
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
        "python_ok": True,
        "nvidia_gpu": False,          # 本机为 AMD 核显，已确认无 CUDA
        "torch_available": _module_available("torch"),
        "ultralytics_available": _module_available("ultralytics"),
        "footage_available": False,   # 三组素材均待用户提供
        "blocked_on": [
            "真实录像素材（U15 5v5 全场 / U12 5v5 全场 / 3v3 半场，各一段场边高机位）",
            "GPU 环境（或接受 CPU 抽帧降速验证）",
            "ffmpeg（视频切片与抽帧依赖）",
            "ultralytics + torch（YOLOv8 推理依赖）",
        ],
    }


def _module_available(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False
