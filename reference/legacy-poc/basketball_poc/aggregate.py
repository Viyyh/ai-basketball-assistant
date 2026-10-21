"""
聚合守卫 —— 禁止跨赛制合并统计。

对应范围确认 v0.2 第 5.2 节：
    所有场均/命中率类聚合查询必须按 format 分组，
    5对5 与 3对3 的数据不得合并计算。

以及球队页设计 v0.2 屏 02：
    赛制筛选没有"全部"选项。与其给一个看起来全面、实际错误的数字，
    不如强制选一个口径。

这条约束必须在数据层就挡住，不能只靠前端筛选——
前端漏一个入口，错误数字就会流到教练眼前。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .params import AgeGroup, Format


class CrossFormatAggregationError(ValueError):
    """试图把不同赛制的数据合并统计时抛出。"""


class CrossAgeGroupAggregationError(ValueError):
    """
    试图把不同年龄段的数据合并统计时抛出。

    U12 的场均 15 分和一线的场均 15 分完全不是一回事，
    混在一起统计没有意义（范围确认 v0.2 决策 10 说明）。
    """


@dataclass(frozen=True)
class GameStats:
    """一场比赛的原始统计。format 与 age_group 是聚合的强制分组键。"""
    game_id: str
    fmt: Format
    age_group: AgeGroup
    points_for: int
    points_against: int
    won: bool
    fgm: int = 0            # 命中投篮数
    fga: int = 0            # 出手数
    threes_made: int = 0    # 弧外命中数（3x3 下语义是"远投命中"）
    threes_att: int = 0     # 弧外出手数
    possession_count: int = 0


@dataclass(frozen=True)
class AggregateResult:
    """聚合结果。始终携带口径信息，不允许出现"无口径"的裸数字。"""
    fmt: Format
    age_group: AgeGroup
    games: int
    wins: int
    losses: int
    win_rate: float | None
    ppg: float              # 场均得分
    ppg_against: float      # 场均失分
    net_ppg: float          # 场均净胜分
    fg_pct: float | None
    three_pct: float | None

    @property
    def scope_label_zh(self) -> str:
        """界面口径说明文案，对应球队页设计 v0.2 屏 02 的常驻口径行。"""
        return f"{self.fmt.label_zh} · {self.age_group.label_zh} · {self.games} 场"


def aggregate(games: Sequence[GameStats],
              fmt: Format,
              age_group: AgeGroup) -> AggregateResult:
    """
    按指定口径聚合。

    显式传入口径、内部过滤，而不是"传进来什么就算什么"——
    这样调用方无法不小心把混合赛制的数据塞进来得到一个错误数字。
    """
    selected = [g for g in games
                if g.fmt is fmt and g.age_group is age_group]
    return _compute(selected, fmt, age_group)


def aggregate_guarded(games: Iterable[GameStats]) -> AggregateResult:
    """
    直接聚合一批数据，但如果这批数据跨赛制或跨年龄段就抛错。

    用于"我以为我已经筛过了"的调用点，把错误暴露在开发期而不是产出错数字。
    """
    games = list(games)
    if not games:
        raise ValueError("没有可聚合的数据")

    formats = {g.fmt for g in games}
    if len(formats) > 1:
        labels = "、".join(sorted(f.label_zh for f in formats))
        raise CrossFormatAggregationError(
            f"检测到跨赛制聚合：{labels}。"
            f"5对5 与 3对3 的人数、场地、时限、计分口径均不同，胜率与命中率不可比。"
            f"请分别指定 format 调用 aggregate()。"
        )

    ages = {g.age_group for g in games}
    if len(ages) > 1:
        labels = "、".join(sorted(a.label_zh for a in ages))
        raise CrossAgeGroupAggregationError(
            f"检测到跨年龄段聚合：{labels}。"
            f"不同年龄段的三分线半径与比赛强度不同，数据不可比。"
        )

    return _compute(games, games[0].fmt, games[0].age_group)


def _compute(games: Sequence[GameStats],
             fmt: Format,
             age_group: AgeGroup) -> AggregateResult:
    n = len(games)
    if n == 0:
        return AggregateResult(
            fmt=fmt, age_group=age_group, games=0, wins=0, losses=0,
            win_rate=None, ppg=0.0, ppg_against=0.0, net_ppg=0.0,
            fg_pct=None, three_pct=None,
        )

    wins = sum(1 for g in games if g.won)
    fga = sum(g.fga for g in games)
    fgm = sum(g.fgm for g in games)
    ta = sum(g.threes_att for g in games)
    tm = sum(g.threes_made for g in games)

    return AggregateResult(
        fmt=fmt,
        age_group=age_group,
        games=n,
        wins=wins,
        losses=n - wins,
        win_rate=round(wins / n, 4),
        ppg=round(sum(g.points_for for g in games) / n, 1),
        ppg_against=round(sum(g.points_against for g in games) / n, 1),
        net_ppg=round(
            (sum(g.points_for for g in games) - sum(g.points_against for g in games)) / n, 1
        ),
        fg_pct=round(fgm / fga, 4) if fga else None,
        three_pct=round(tm / ta, 4) if ta else None,
    )


def group_by_scope(games: Iterable[GameStats]) -> dict[tuple[Format, AgeGroup], list[GameStats]]:
    """
    按 (赛制, 年龄段) 分组。

    历史列表、球队页、对手详情都应当先分组再分别聚合，
    而不是聚合成一个总数。
    """
    buckets: dict[tuple[Format, AgeGroup], list[GameStats]] = {}
    for g in games:
        buckets.setdefault((g.fmt, g.age_group), []).append(g)
    return buckets
