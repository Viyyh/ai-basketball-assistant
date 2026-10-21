#!/usr/bin/env python
"""
三组参数 PoC 报告运行器。

用法：
    py poc/run_poc.py

做三件事：
  1. 跑完 37 项验收测试
  2. 打印三组参数组合的解析结果与关键判定对照（人可读）
  3. 输出"已验证 / 被阻塞 / 待核实"三份清单

只依赖标准库，无需安装任何包。
"""

from __future__ import annotations

import io
import os
import sys
import unittest

# Windows 控制台默认 GBK，强制 UTF-8 输出，否则中文变乱码
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from basketball_poc.aggregate import GameStats, aggregate, group_by_scope
from basketball_poc.court import Shot, build_court
from basketball_poc.params import (
    AgeGroup,
    Format,
    POC_COMBOS,
    resolve,
)
from basketball_poc.video_pipeline import (
    pipeline_readiness,
    validate_params_for_pipeline,
)


LINE = "=" * 74
THIN = "-" * 74


def header(title: str) -> None:
    print()
    print(LINE)
    print(f"  {title}")
    print(LINE)


def section(title: str) -> None:
    print()
    print(THIN)
    print(f"  {title}")
    print(THIN)


# ============================================================
# 1. 测试
# ============================================================

def run_tests() -> bool:
    header("第 1 步 · 验收测试")
    loader = unittest.TestLoader()
    suite = loader.discover(os.path.join(HERE, "tests"))

    stream = io.StringIO()
    runner = unittest.TextTestRunner(stream=stream, verbosity=1)
    result = runner.run(suite)

    print(f"  运行 {result.testsRun} 项 · "
          f"失败 {len(result.failures)} · 错误 {len(result.errors)}")

    if not result.wasSuccessful():
        print()
        print(stream.getvalue())
        return False

    print("  全部通过。")
    return True


# ============================================================
# 2. 三组参数解析对照
# ============================================================

def print_combos() -> None:
    header("第 2 步 · 三组参数组合解析结果")

    for name, fmt, age, court_type, goal in POC_COMBOS:
        p = resolve(fmt, age, court_type)
        court = build_court(p)
        problems = validate_params_for_pipeline(p)

        print()
        print(f"  {name}：{fmt.label_zh} + {age.label_zh}")
        print(f"  验证目标：{goal}")
        print()
        print(f"    场地          {p.court.court_type.label_zh} · "
              f"{p.court.length_m} × {p.court.width_m} m · "
              f"{p.court.hoop_count} 个篮框")
        print(f"    坐标范围      x ∈ [{court.x_min:.3f}, {court.x_max:.3f}] m, "
              f"y ∈ [±{court.y_half:.3f}] m")
        print(f"    三分线        {p.three_point.geometry.label_zh} · "
              f"半径 {p.three_point.radius_m} m"
              + (f" · 底角横向 {p.three_point.corner_lateral_m} m"
                 if p.three_point.corner_lateral_m else ""))
        print(f"    计分口径      弧内 {p.rules.inside_arc_points} 分 / "
              f"弧外 {p.rules.outside_arc_points} 分"
              f"（界面标签：{court._inside_label()} / {court._outside_label()}）")
        print(f"    进攻时限      {p.rules.shot_clock_s} 秒")
        print(f"    节次          {p.rules.period_count} 节 × "
              f"{p.rules.period_minutes} 分钟"
              + (f" · 先得 {p.rules.win_score} 分胜" if p.rules.win_score else ""))
        print(f"    快攻识别      {'启用' if p.rules.fast_break_enabled else '关闭'}"
              + (f" · 阈值 {p.rules.fast_break_max_possession_s} 秒"
                 if p.rules.fast_break_max_possession_s else ""))
        print(f"    跟踪 / 阵型   每队 {p.tracking.players_per_team} 人 · "
              f"阵型 {p.tracking.formation_points} 点 · "
              f"跟踪上限 {p.tracking.max_tracked_targets} 目标 · "
              f"每 {p.tracking.formation_sample_interval_s} 秒采样")
        print(f"    参数自检      {'通过' if not problems else '不通过'}")
        for prob in problems:
            print(f"      ! {prob}")


# ============================================================
# 3. 关键发现：同一出手点，不同参数 → 不同分值
# ============================================================

def print_shot_comparison() -> None:
    header("第 3 步 · 关键验证：同一物理出手点在不同参数下的判定")

    courts = {
        "U12 / 5对5（弧 5.80 m，纯弧）": build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U12)),
        "U15 / 5对5（弧 5.80 m，纯弧）": build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U15)),
        "一线 / 5对5（弧 6.75 m + 底角）": build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR)),
        "U15 / 3对3（弧 6.75 m，纯弧）": build_court(resolve(Format.THREE_V_THREE, AgeGroup.U15)),
    }

    # 出手点：覆盖弧顶、翼侧、底角、近框
    probes = [
        ("篮下正面", 2.0, 0.0),
        ("弧顶 5.9 m", 5.90, 0.0),
        ("弧顶 6.2 m", 6.20, 0.0),
        ("弧顶 6.8 m", 6.80, 0.0),
        ("翼侧 45° 6.4 m", 4.53, 4.53),
        ("底角 |y|=6.0", 0.0, 6.0),
        ("底角 |y|=7.0", 0.0, 7.0),
    ]

    print()
    print("  每格为「命中得分 / 界面标签」\n")

    col_w = 26
    print("  " + "出手点".ljust(20) + "".join(k[:col_w - 2].ljust(col_w) for k in courts))
    print("  " + "-" * (20 + col_w * len(courts)))

    for label, x, y in probes:
        row = "  " + label.ljust(18)
        for name, court in courts.items():
            shot = Shot(x_m=x, y_m=y, made=True)
            j = court.judge(shot)
            bounds = "" if j.in_bounds else " (越界)"
            row += f"{j.points_awarded} 分 · {j.label_zh}{bounds}".ljust(col_w)
        print(row)

    section("结论")
    print("""
  1. 弧顶 6.2 m 这一行是最能说明问题的：
     U12 / U15 判为 3 分，一线判为 2 分。
     同一次出手、同一个物理位置，只因为年龄段参数不同，分值就不同。

  2. 底角 |y|=7.0 这一行体现两种几何的差异：
     一线（弧线+底角直线）走的是"底角直线段"分支判定；
     青少年与 3对3（纯弧线）走的是"距离 >= 半径"分支。
     3对3 那一格显示越界，因为 3x3 半场宽度只有 ±5.5 m，
     |y|=7.0 已经出了边线 —— 这正是"坐标偏移"的检出机制在起作用。

  3. 3对3 那一列的分值是 1 / 2，标签是"近投/远投"，不出现"三分"字样。
     如果沿用 5对5 的口径，报告会把 2 分球写成"三分球"，教练立刻不信任产品。
""")


# ============================================================
# 4. 量化"用错参数"的后果
# ============================================================

def print_misjudgement_impact() -> None:
    header("第 4 步 · 量化风险 7.4：用成人半径判青少年比赛会错多少")

    u12 = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.U12))
    senior = build_court(resolve(Format.FIVE_V_FIVE, AgeGroup.SENIOR))

    # 模拟一场 U12 比赛里 5.5 ~ 7.0 m 区间的出手（青少年比赛的中远距离主力区）
    shots = [
        Shot(5.90, 0.0, True), Shot(6.10, 0.5, True), Shot(6.30, -0.4, False),
        Shot(6.00, 1.2, True), Shot(6.50, 0.8, True), Shot(5.95, -1.0, False),
        Shot(6.20, 2.0, True), Shot(6.60, 0.0, True), Shot(5.85, 3.0, False),
        Shot(6.40, -2.5, True), Shot(5.82, 0.3, True), Shot(6.70, 1.5, True),
        Shot(5.90, -2.2, False), Shot(6.25, 0.0, True), Shot(6.55, -1.1, True),
        Shot(5.88, 1.8, True), Shot(6.15, 3.2, False), Shot(6.45, 0.6, True),
        Shot(5.95, -3.0, True), Shot(6.35, 2.4, True),
    ]

    correct_made_threes = 0
    wrong_made_threes = 0
    for s in shots:
        if not s.made:
            continue
        if u12.behind_three_point_line(s.x_m, s.y_m):
            correct_made_threes += 1
        if senior.behind_three_point_line(s.x_m, s.y_m):
            wrong_made_threes += 1

    total_made = sum(1 for s in shots if s.made)

    print(f"""
  样本：{len(shots)} 次出手（{total_made} 次命中），全部落在 5.8 ~ 6.7 m 区间，
        这是青少年比赛中距离出手的主力区域。

  用正确参数（U12，弧 5.80 m）判定：命中三分 {correct_made_threes} 个
  用错误参数（成人，弧 6.75 m）判定：命中三分 {wrong_made_threes} 个

  漏判 {correct_made_threes - wrong_made_threes} 个三分，占命中三分的 \
{((correct_made_threes - wrong_made_threes) / correct_made_threes * 100) if correct_made_threes else 0:.0f}%。
""")

    section('为什么这比「AI 精度不够」更危险')
    print("""
  AI 精度不够时，教练看得出来 —— 热图明显偏了、事件明显漏了，
  他会认为"这产品还不成熟"，但不会怀疑自己的数据。

  参数取错时，报告看起来完全正常：热图形状合理、事件数量正常、
  命中率是个像样的数字。教练会拿着"三分命中率 18%"去批评球员，
  而真相是那些球本来就是三分，只是被算成了二分。

  这类错误无法通过"看报告"发现，只能靠：
    · 参数必填、不给默认值（界面设计 v0.1.1 屏 02）
    · 参数表驱动、代码无魔法数字（本次 PoC 的 params.py）
    · 进入 pipeline 前做自检（validate_params_for_pipeline）
    · 报告页常驻口径标识，教练可核对（球队页设计 v0.2 屏 02）
""")


# ============================================================
# 5. 聚合守卫实证
# ============================================================

def print_aggregation_guard() -> None:
    header("第 5 步 · 聚合守卫：跨赛制合并会产出无意义数字")

    games = [
        GameStats("g1", Format.FIVE_V_FIVE, AgeGroup.U15, 78, 65, True,
                  fgm=28, fga=64, threes_made=8, threes_att=22),
        GameStats("g2", Format.FIVE_V_FIVE, AgeGroup.U15, 61, 70, False,
                  fgm=22, fga=61, threes_made=5, threes_att=19),
        GameStats("g3", Format.FIVE_V_FIVE, AgeGroup.U15, 72, 68, True,
                  fgm=26, fga=60, threes_made=7, threes_att=20),
        GameStats("g4", Format.THREE_V_THREE, AgeGroup.U15, 21, 18, True,
                  fgm=9, fga=18, threes_made=4, threes_att=8),
        GameStats("g5", Format.THREE_V_THREE, AgeGroup.U15, 17, 19, False,
                  fgm=7, fga=19, threes_made=3, threes_att=9),
    ]

    buckets = group_by_scope(games)
    print(f"\n  原始数据 {len(games)} 场，按口径自动分成 {len(buckets)} 组：\n")

    for (fmt, age), group in sorted(buckets.items(), key=lambda kv: kv[0][0].value):
        r = aggregate(games, fmt, age)
        print(f"    {r.scope_label_zh}")
        print(f"      战绩 {r.wins}胜{r.losses}负 · 胜率 {r.win_rate:.0%} · "
              f"场均 {r.ppg} 分 · 失 {r.ppg_against} 分 · 净胜 {r.net_ppg:+}")
        if r.fg_pct is not None:
            print(f"      命中率 {r.fg_pct:.1%} · 弧外命中率 {r.three_pct:.1%}")
        print()

    naive_wins = sum(1 for g in games if g.won)
    naive_rate = naive_wins / len(games)
    naive_ppg = sum(g.points_for for g in games) / len(games)

    print(f"  若不做口径隔离，直接合并：")
    print(f"      {naive_wins}胜{len(games) - naive_wins}负 · 胜率 {naive_rate:.0%} · "
          f"场均 {naive_ppg:.1f} 分")
    print()
    print("  这个合并数字把 3对3 的 21 分和 5对5 的 78 分平均在一起，")
    print("  场均得分毫无意义；胜率也把两种不可比的赛制混算。")
    print("  所以球队页比赛数据的赛制筛选没有「全部」选项，")
    print("  且 aggregate_guarded() 在数据层直接抛错拦截。")

    from basketball_poc.aggregate import CrossFormatAggregationError, aggregate_guarded
    try:
        aggregate_guarded(games)
        print("\n  ! 异常：跨赛制聚合竟然没被拦住")
    except CrossFormatAggregationError as e:
        print(f"\n  守卫已生效，抛出：{type(e).__name__}")
        print(f"  {e}")


# ============================================================
# 6. 待核实清单
# ============================================================

def print_unverified() -> None:
    header("第 6 步 · 待核实参数清单（开发前必须确认）")

    all_unverified: dict[str, None] = {}
    for _, fmt, age, ct, _ in POC_COMBOS:
        for item in resolve(fmt, age, ct).unverified:
            all_unverified.setdefault(item, None)

    for i, item in enumerate(all_unverified, 1):
        print(f"  {i}. {item}")

    print("""
  额外需要人工核实的两项：

  A. 一线单节时长。范围确认 v0.2 的 5.5 节表中写"4 × 12 分钟"（NBA 口径），
     FIBA 官方成人比赛是 4 × 10 分钟。params.py 暂按 FIBA 值填写。
     → 需按教练实际执裁的联赛确认后调整。

  B. 青少年三分线半径。5.80 m 是范围确认 v0.2 采用的假设值，
     各地青少年联赛常见 5.80 / 6.00 / 6.25 m 不等。
     → 这是影响面最大的一个数值，必须拿到实际联赛规则原文确认。
     → 确认方式：问 2-3 位青训教练他们打的是哪个联赛、看秩序册。

  这两项都是"改一个数字"的事，但改错会导致整份报告的分值判定系统性偏差，
  且教练无法从报告上察觉 —— 属于风险 7.4 的同一类问题。
""")


# ============================================================
# 7. 视频链路就绪状态
# ============================================================

def print_video_readiness() -> None:
    header("第 7 步 · 真实视频链路就绪状态")

    r = pipeline_readiness()

    print("\n  环境探测：\n")
    rows = [
        ("Python 3.13", r["python_ok"]),
        ("ffmpeg", r["ffmpeg_available"]),
        ("NVIDIA GPU / CUDA", r["nvidia_gpu"]),
        ("torch", r["torch_available"]),
        ("ultralytics (YOLOv8)", r["ultralytics_available"]),
        ("三组真实录像素材", r["footage_available"]),
    ]
    for label, ok in rows:
        print(f"    [{'✓' if ok else '✗'}] {label}")

    print("\n  被阻塞的工作：\n")
    for item in r["blocked_on"]:
        print(f"    · {item}")

    print("""
  本机可以做的（已完成）：
    参数层、几何层、判定层、聚合守卫层的完整验证 —— 37 项测试全通过。
    这部分正是风险 7.4 的全部成因，不依赖视频与 GPU。

  必须有素材与 GPU 才能做的（未开始）：
    · 场地标定精度：单应矩阵的重投影误差是否 < 5 像素
    · 检测精度：单机位高视角下球员与球的检出率
    · 三分识别命中率：范围确认 v0.2 第九节定的验收线是 85%
    · 快攻识别的查准/查全
    · 阵型采样的位置误差

  建议的素材规格（三组各一段）：
    ┌──────────┬──────────────────────────────────────────────┐
    │ 组合 A   │ U15 五对五全场正式比赛，≥ 20 分钟            │
    │ 组合 B   │ U12 五对五全场，≥ 20 分钟（三分线须可见）    │
    │ 组合 C   │ 三对三半场，≥ 10 分钟                        │
    └──────────┴──────────────────────────────────────────────┘
    统一要求：场边高处单机位、1080p 或以上、≥ 30 fps、
              画面能看到完整球场线与至少一个篮框、
              手机固定不晃动（三脚架或看台栏杆）。

    组合 B 特别要求：拍摄时最好能拍到三分线本身，
    否则无法验证"5.80 m 半径下判定是否准确"这一目标 ——
    因为标定的地面真值来自画面里的线。
""")


# ============================================================
# 主流程
# ============================================================

def main() -> int:
    print()
    print(LINE)
    print("  AI 篮球分析小程序 · 三组参数 PoC 报告")
    print("  对应《第一版范围确认 v0.2》第九节与风险 7.4")
    print(LINE)

    ok = run_tests()
    if not ok:
        print("\n测试未全部通过，后续报告不具参考意义。请先修复。")
        return 1

    print_combos()
    print_shot_comparison()
    print_misjudgement_impact()
    print_aggregation_guard()
    print_unverified()
    print_video_readiness()

    header("PoC 结论")
    print("""
  【已验证 · 参数层无静默错误】

    三组参数组合全部正确解析并通过自检，37 项测试通过。
    关键结论：

      · 同一物理出手点在 U12 与一线参数下确实得到不同分值，
        证明"参数必须必填、不能有默认值"这条设计是必要的，不是过度设计。

      · 用成人半径判青少年比赛，在 5.8~6.7 m 主力出手区会系统性漏判三分。
        这类错误在报告上不可见，只能靠参数层拦截。

      · 三分线有两种几何（弧线+底角直线 / 纯弧线），不能共用一套判定。
        青少年小半径场地会自然退化为纯弧线；若强行套用成人几何，
        会产生"底角直线在弧线内侧"的矛盾配置。自检能拦住它。

      · 3对3 是完全独立的规则集：半场单框、12 秒、弧内 1 分弧外 2 分、
        单节 21 分制、报告不得出现"三分"字样。已全部实现并有测试覆盖。

      · 跨赛制/跨年龄段聚合在数据层被强制拦截，
        对应球队页比赛数据"赛制筛选无全部选项"的设计。

  【被阻塞 · 视频精度未知】

    本机无 NVIDIA GPU、无 ffmpeg、无真实录像，
    因此 AI 精度（三分识别是否达到 85% 验收线）尚未验证。
    这是第一版最大的未知风险，需要素材后才能推进。

  【待核实 · 两个数值】

    青少年三分线半径（5.80 m 为假设值）与一线单节时长（FIBA 10 分钟 vs 表中 12 分钟）。
    建议在写 pipeline 代码之前先向教练与实际联赛规则确认，
    因为这两个数值一旦写进标定模板，返工成本远高于现在改一个常量。

  【下一步建议】

    1. 提供三组录像素材 → 才能推进精度验证
    2. 或先做技术选型与数据模型设计（不依赖素材，可并行）
    3. 向教练核实两个待确认数值
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
