"""可配置的赛前参数：预设 + 逐项覆盖 + 校验 + 快照。

为什么要有这一层
----------------
`table.resolve()` 只认「赛制 × 年龄段」，三分线底角、场地长宽、节次时长都是
FIBA 默认值。真实使用中，教练面对的是 NBA、CBA、青少年联赛、校队小场、3x3
等不同规则；把每个联赛都写死成代码，既改不动，也无法让用户"按自己的比赛改"。

本模块把参数拆成 **字段（FieldSpec）**，每个字段带一组候选值：

    · 预设（Preset）只负责"一键填表"，不是唯一入口；
    · 用户可以对任意字段做覆盖（overrides），互不牵连；
    · 提交前做几何/规则耦合校验，矛盾直接报错，不静默降级；
    · 解析结果生成不可变快照（值 + 每项来源 + hash），报告据此复算。

优先级：manual（用户改的） > preset（预设带入的） > default（兜底值）。

"不知道"的处理
--------------
关键字段不允许为空；`unconfirmed` 里的字段仍会取预设值，但会被标成未确认并
写进 warnings —— 报告页必须显示这些警告，不能把未确认当成已核实。
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional

from .table import (
    AgeGroup,
    ActivityParams,
    CourtMarks,
    CourtSpec,
    CourtType,
    Format,
    RulesSpec,
    ThreePointGeometry,
    ThreePointSpec,
    TrackingSpec,
    PLAYERS_PER_TEAM,
)


# ============================================================
# 错误
# ============================================================

class ConfigError(ValueError):
    """参数配置不成立。``errors`` 里保留全部问题，方便一次改完。"""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            errors = [errors]
        self.errors = tuple(str(e) for e in errors)
        super().__init__("；".join(self.errors))


# ============================================================
# 字段定义
# ============================================================

GROUP_LABELS = {
    "court": "场地",
    "three_point": "三分线",
    "marks": "场地标线",
    "rules": "规则",
}


@dataclass(frozen=True)
class Choice:
    """一个候选值。``note_zh`` 用来写清楚它属于哪套规则。"""

    value: Any
    label_zh: str
    note_zh: str = ""

    def public(self) -> dict:
        return {"value": self.value, "label": self.label_zh, "note": self.note_zh}


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label_zh: str
    group: str
    kind: str                      # number / integer / bool / enum
    unit: str = ""
    choices: tuple[Choice, ...] = ()
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    nullable: bool = False
    required: bool = True
    advanced: bool = False
    help_zh: str = ""

    # ---------- 取值 ----------

    def coerce(self, raw: Any) -> Any:
        """把 JSON / 表单里的值收成规范类型，并做范围校验。"""
        if raw is None:
            if self.nullable:
                return None
            raise ConfigError(f"「{self.label_zh}」不能为空")

        if self.kind == "enum":
            values = [c.value for c in self.choices]
            if raw not in values:
                raise ConfigError(
                    f"「{self.label_zh}」只能是 {values} 之一，收到 {raw!r}"
                )
            return raw

        if self.kind == "bool":
            if isinstance(raw, bool):
                return raw
            if isinstance(raw, str) and raw.strip().lower() in {
                "true", "1", "yes", "on", "是", "开",
            }:
                return True
            if isinstance(raw, str) and raw.strip().lower() in {
                "false", "0", "no", "off", "否", "关",
            }:
                return False
            raise ConfigError(f"「{self.label_zh}」需要 true / false，收到 {raw!r}")

        if self.kind == "integer":
            if isinstance(raw, bool):
                raise ConfigError(f"「{self.label_zh}」需要整数，收到布尔值")
            try:
                number = float(raw)
            except (TypeError, ValueError) as exc:
                raise ConfigError(f"「{self.label_zh}」需要整数，收到 {raw!r}") from exc
            if not math.isfinite(number) or not number.is_integer():
                raise ConfigError(f"「{self.label_zh}」需要整数，收到 {raw!r}")
            value: Any = int(number)
        else:  # number
            if isinstance(raw, bool):
                raise ConfigError(f"「{self.label_zh}」需要数字，收到布尔值")
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise ConfigError(f"「{self.label_zh}」需要数字，收到 {raw!r}") from exc
            if not math.isfinite(value):
                raise ConfigError(f"「{self.label_zh}」需要有限数字，收到 {raw!r}")

        self._check_range(value)
        return value

    def _check_range(self, value: Any) -> None:
        if value is None:
            return
        if self.min_value is not None and value < self.min_value:
            raise ConfigError(
                f"「{self.label_zh}」不能小于 {self.min_value:g}{self.unit}"
            )
        if self.max_value is not None and value > self.max_value:
            raise ConfigError(
                f"「{self.label_zh}」不能大于 {self.max_value:g}{self.unit}"
            )

    def public(self) -> dict:
        return {
            "key": self.key,
            "label": self.label_zh,
            "group": self.group,
            "group_label": GROUP_LABELS[self.group],
            "kind": self.kind,
            "unit": self.unit,
            "choices": [c.public() for c in self.choices],
            "min": self.min_value,
            "max": self.max_value,
            "nullable": self.nullable,
            "required": self.required,
            "advanced": self.advanced,
            "help": self.help_zh,
        }


FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec(
        key="court_type", label_zh="场地类型", group="court", kind="enum",
        choices=(Choice("FULL", "全场"), Choice("HALF", "半场")),
        required=True,
        help_zh="全场双框 / 半场单框。半场长度填半场的实际长度，不要填 28 m。",
    ),
    FieldSpec(
        key="court_length_m", label_zh="场地长度", group="court", kind="number",
        unit="m", min_value=8.0, max_value=35.0, required=True,
        choices=(
            Choice(28.0, "FIBA / CBA", "28.00 m"),
            Choice(28.65, "NBA", "94 ft = 28.65 m"),
            Choice(26.0, "小场", "26.00 m"),
            Choice(11.0, "3x3", "11.00 m"),
            Choice(14.0, "半场", "28 m 场地的一半"),
        ),
        help_zh="FIBA 全场 28.00 m，NBA 全场 28.65 m；半场填半段长度。",
    ),
    FieldSpec(
        key="court_width_m", label_zh="场地宽度", group="court", kind="number",
        unit="m", min_value=8.0, max_value=20.0, required=True,
        choices=(
            Choice(15.0, "FIBA / CBA", "15.00 m"),
            Choice(15.24, "NBA", "50 ft = 15.24 m"),
            Choice(14.0, "小场", "14.00 m"),
        ),
        help_zh="FIBA 15.00 m，NBA 15.24 m。",
    ),
    FieldSpec(
        key="baseline_to_hoop_m", label_zh="篮筐到底线", group="court", kind="number",
        unit="m", min_value=0.5, max_value=3.0, required=True,
        choices=(
            Choice(1.575, "标准", "FIBA / NBA 均为 1.575 m"),
            Choice(1.20, "小场", "部分青少年场地"),
        ),
        help_zh="所有米制坐标的原点都从这里推算，选错会让全场距离系统性偏移。",
    ),
    FieldSpec(
        key="three_point_radius_m", label_zh="三分弧半径", group="three_point",
        kind="number", unit="m", min_value=4.0, max_value=10.0, required=True,
        choices=(
            Choice(6.75, "FIBA / CBA", "6.75 m"),
            Choice(7.24, "NBA", "23 ft 9 in = 7.24 m"),
            Choice(6.25, "旧规则", "部分老联赛 / 老场地"),
            Choice(5.80, "小球场", "青少年小场常见"),
        ),
        help_zh="弧线到篮筐中心的距离。底角距离要小于它，否则几何不成立。",
    ),
    FieldSpec(
        key="corner_lateral_m", label_zh="底角距离", group="three_point", kind="number",
        unit="m", min_value=0.0, max_value=10.0, nullable=True, required=False,
        choices=(
            Choice(6.60, "FIBA / CBA", "边线内沿 0.90 m"),
            Choice(6.71, "NBA", "22 ft = 6.71 m"),
            Choice(None, "无底角（纯弧线）", "半宽放不下底角的小场"),
        ),
        advanced=False,
        help_zh="底角直线段离中轴的距离。填「无底角」时三分线退化为纯弧线。",
    ),
    FieldSpec(
        key="free_throw_line_m", label_zh="罚球线距离", group="marks", kind="number",
        unit="m", min_value=2.0, max_value=12.0, required=False, advanced=True,
        choices=(
            Choice(5.80, "FIBA / CBA", "距端线内沿"),
            Choice(5.79, "NBA", "19 ft 距端线"),
            Choice(4.60, "小场", "青少年场地"),
        ),
        help_zh="只影响球场绘制，不参与二分/三分判定。",
    ),
    FieldSpec(
        key="restricted_area_width_m", label_zh="禁区宽度", group="marks", kind="number",
        unit="m", min_value=2.0, max_value=8.0, required=False, advanced=True,
        choices=(
            Choice(4.90, "FIBA / CBA", "4.90 m"),
            Choice(4.88, "NBA", "16 ft = 4.88 m"),
            Choice(3.60, "NCAA", "12 ft = 3.66 m 的近似值"),
            Choice(4.00, "小场", "部分青少年场地"),
        ),
        help_zh="只影响球场绘制。",
    ),
    FieldSpec(
        key="no_charge_radius_m", label_zh="无撞人半圆半径", group="marks",
        kind="number", unit="m", min_value=0.5, max_value=3.0, required=False,
        advanced=True,
        choices=(
            Choice(1.30, "FIBA / CBA", "1.30 m"),
            Choice(1.22, "NBA", "4 ft = 1.22 m"),
            Choice(1.25, "旧规则", "部分老场地"),
        ),
        help_zh="只影响球场绘制。",
    ),
    FieldSpec(
        key="period_count", label_zh="节数", group="rules", kind="integer",
        min_value=1, max_value=6, required=True,
        choices=(Choice(4, "四节"), Choice(2, "上下半场"), Choice(1, "单节")),
        help_zh="NBA / CBA / FIBA 为 4 节，NCAA 为 2 个半场，3x3 为 1 节。",
    ),
    FieldSpec(
        key="period_minutes", label_zh="单节时长", group="rules", kind="number",
        unit="分钟", min_value=1.0, max_value=30.0, required=True,
        choices=(
            Choice(12.0, "NBA / CBA", "12 分钟"),
            Choice(10.0, "FIBA / 3x3", "10 分钟"),
            Choice(8.0, "青少年", "U12 / U15"),
            Choice(6.0, "U8", "6 分钟"),
            Choice(20.0, "NCAA", "20 分钟半场"),
        ),
        help_zh="只影响按节切分与时间轴，不改变单次出手的分值。",
    ),
    FieldSpec(
        key="shot_clock_s", label_zh="进攻时限", group="rules", kind="integer",
        unit="秒", min_value=4, max_value=60, nullable=True, required=False,
        advanced=True,
        choices=(
            Choice(24, "24 秒", "FIBA / NBA / CBA"),
            Choice(30, "30 秒", "部分青年 / 女子联赛"),
            Choice(12, "12 秒", "3x3"),
            Choice(None, "无", "训练赛可不计"),
        ),
        help_zh="用于回合切分；不确定时选「无」，相关指标会标注不可计算。",
    ),
    FieldSpec(
        key="inside_arc_points", label_zh="弧内分值", group="rules", kind="integer",
        min_value=1, max_value=4, required=True, advanced=True,
        choices=(Choice(2, "2 分"), Choice(1, "1 分（3x3）")),
        help_zh="5v5 / 4v4 为 2 分，3x3 为 1 分。",
    ),
    FieldSpec(
        key="outside_arc_points", label_zh="弧外分值", group="rules", kind="integer",
        min_value=1, max_value=4, required=True, advanced=True,
        choices=(Choice(3, "3 分"), Choice(2, "2 分（3x3）")),
        help_zh="5v5 / 4v4 为 3 分，3x3 为 2 分。",
    ),
    FieldSpec(
        key="fast_break_enabled", label_zh="快攻识别", group="rules", kind="bool",
        required=False, advanced=True,
        choices=(Choice(True, "开启"), Choice(False, "关闭")),
        help_zh="3x3 第一版关闭。",
    ),
    FieldSpec(
        key="win_score", label_zh="目标分", group="rules", kind="integer",
        min_value=5, max_value=200, nullable=True, required=False, advanced=True,
        choices=(Choice(21, "21 分（3x3）"), Choice(None, "无")),
        help_zh="只有 3x3 等打到目标分的赛制才需要。",
    ),
)

FIELD_BY_KEY: dict[str, FieldSpec] = {f.key: f for f in FIELDS}

DEFAULT_VALUES: dict[str, Any] = {
    "court_type": "FULL",
    "court_length_m": 28.0,
    "court_width_m": 15.0,
    "baseline_to_hoop_m": 1.575,
    "three_point_radius_m": 6.75,
    "corner_lateral_m": 6.60,
    "free_throw_line_m": 5.80,
    "restricted_area_width_m": 4.90,
    "no_charge_radius_m": 1.30,
    "period_count": 4,
    "period_minutes": 10.0,
    "shot_clock_s": 24,
    "inside_arc_points": 2,
    "outside_arc_points": 3,
    "fast_break_enabled": True,
    "win_score": None,
}


# ============================================================
# 预设（一键填表，不是唯一入口）
# ============================================================

@dataclass(frozen=True)
class Preset:
    id: str
    label_zh: str
    description_zh: str
    fmt: Format
    age_group: AgeGroup
    values: Mapping[str, Any]

    def public(self) -> dict:
        return {
            "id": self.id,
            "label": self.label_zh,
            "description": self.description_zh,
            "format": self.fmt.value,
            "age_group": self.age_group.value,
            "values": dict(self.values),
        }


def _preset_values(**overrides: Any) -> dict[str, Any]:
    values = dict(DEFAULT_VALUES)
    values.update(overrides)
    return values


PRESETS: tuple[Preset, ...] = (
    Preset(
        id="fiba",
        label_zh="FIBA 成人",
        description_zh="28.00 × 15.00 m，三分 6.75 / 底角 6.60 m，4 × 10 分钟。",
        fmt=Format.FIVE_V_FIVE,
        age_group=AgeGroup.SENIOR,
        values=_preset_values(),
    ),
    Preset(
        id="nba",
        label_zh="NBA",
        description_zh="28.65 × 15.24 m，三分 7.24 / 底角 6.71 m，4 × 12 分钟。",
        fmt=Format.FIVE_V_FIVE,
        age_group=AgeGroup.SENIOR,
        values=_preset_values(
            court_length_m=28.65,
            court_width_m=15.24,
            three_point_radius_m=7.24,
            corner_lateral_m=6.71,
            free_throw_line_m=5.79,
            restricted_area_width_m=4.88,
            no_charge_radius_m=1.22,
            period_minutes=12.0,
        ),
    ),
    Preset(
        id="cba",
        label_zh="CBA",
        description_zh="FIBA 场地与三分线，4 × 12 分钟。",
        fmt=Format.FIVE_V_FIVE,
        age_group=AgeGroup.SENIOR,
        values=_preset_values(period_minutes=12.0),
    ),
    Preset(
        id="youth-u15",
        label_zh="青少年 U15",
        description_zh="FIBA 场地与三分线，4 × 8 分钟。",
        fmt=Format.FIVE_V_FIVE,
        age_group=AgeGroup.U15,
        values=_preset_values(period_minutes=8.0),
    ),
    Preset(
        id="three-x-three",
        label_zh="3x3",
        description_zh="11.00 × 15.00 m，三分 6.75 / 底角 6.60 m，1 节 10 分钟，12 秒，1/2 分，21 分制。",
        fmt=Format.THREE_V_THREE,
        age_group=AgeGroup.SENIOR,
        values=_preset_values(
            court_type="HALF",
            court_length_m=11.0,
            court_width_m=15.0,
            period_count=1,
            period_minutes=10.0,
            shot_clock_s=12,
            inside_arc_points=1,
            outside_arc_points=2,
            fast_break_enabled=False,
            win_score=21,
        ),
    ),
    Preset(
        id="half-court",
        label_zh="半场 4v4",
        description_zh="半场 14.00 × 15.00 m，4 × 10 分钟，适合训练赛。",
        fmt=Format.FOUR_V_FOUR,
        age_group=AgeGroup.U15,
        values=_preset_values(
            court_type="HALF",
            court_length_m=14.0,
            court_width_m=15.0,
            period_minutes=10.0,
        ),
    ),
)

PRESET_BY_ID: dict[str, Preset] = {p.id: p for p in PRESETS}
DEFAULT_BASE = "fiba"

UNVERIFIED_SOURCE = "unconfirmed"
MANUAL_SOURCE = "manual"


# ============================================================
# 解析结果
# ============================================================

@dataclass(frozen=True)
class ConfigResult:
    """一次解析的完整结果：可用的 ActivityParams + 可存库的快照。"""

    params: ActivityParams
    base: str
    label_zh: str
    values: Mapping[str, Any]
    sources: Mapping[str, str]
    overrides: tuple[str, ...]
    unconfirmed: tuple[str, ...]
    warnings: tuple[str, ...]
    config_hash: str

    def to_public(self) -> dict:
        return {
            "base": self.base,
            "label": self.label_zh,
            "hash": self.config_hash,
            "format": self.params.fmt.value,
            "age_group": self.params.age_group.value,
            "values": dict(self.values),
            "sources": dict(self.sources),
            "overrides": list(self.overrides),
            "unconfirmed": list(self.unconfirmed),
            "warnings": list(self.warnings),
        }


def _canonical_hash(base: str, fmt: Format, age: AgeGroup, values: Mapping[str, Any]) -> str:
    payload = {
        "base": base,
        "format": fmt.value,
        "age_group": age.value,
        "values": {k: values[k] for k in sorted(values)},
    }
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _label(base_label: str, values: Mapping[str, Any]) -> str:
    court_zh = "全场" if values["court_type"] == "FULL" else "半场"
    corner = values["corner_lateral_m"]
    three_zh = f"三分 {values['three_point_radius_m']:.2f} m"
    three_zh += f" / 底角 {corner:.2f} m" if corner is not None else " / 纯弧"
    return (
        f"{base_label} · {court_zh} {values['court_length_m']:.2f}×"
        f"{values['court_width_m']:.2f} m · {three_zh} · "
        f"{values['period_count']}×{values['period_minutes']:g} 分钟"
    )


def resolve_config(
    base: str = DEFAULT_BASE,
    overrides: Optional[Mapping[str, Any]] = None,
    *,
    fmt: Optional[Format] = None,
    age_group: Optional[AgeGroup] = None,
    unconfirmed: Iterable[str] = (),
) -> ConfigResult:
    """把「预设 + 覆盖项」解析成完整参数，并生成可复算的快照。

    :param base: 预设 id，见 ``PRESETS``。
    :param overrides: 只写要改的字段，例如 ``{"three_point_radius_m": 7.24}``。
    :param unconfirmed: 用户明确表示"不确定"的字段；仍取预设值，但会告警。
    :raises ConfigError: 字段未知、类型不对、或几何/规则互相矛盾。
    """
    preset = PRESET_BY_ID.get(base)
    if preset is None:
        raise ConfigError(
            f"未知预设 {base!r}，可选：{', '.join(p.id for p in PRESETS)}"
        )

    if fmt is not None and not isinstance(fmt, Format):
        fmt = Format(fmt)
    if age_group is not None and not isinstance(age_group, AgeGroup):
        age_group = AgeGroup(age_group)
    fmt = fmt or preset.fmt
    age = age_group or preset.age_group

    values: dict[str, Any] = {}
    sources: dict[str, str] = {}
    for key, default in DEFAULT_VALUES.items():
        if key in preset.values:
            values[key] = preset.values[key]
            sources[key] = f"preset:{preset.id}"
        else:
            values[key] = default
            sources[key] = "default"

    overrides = dict(overrides or {})
    unknown = sorted(set(overrides) - set(FIELD_BY_KEY))
    if unknown:
        raise ConfigError(
            f"未知字段：{', '.join(unknown)}；可用字段见 GET /v1/config/schema"
        )

    for key, raw in overrides.items():
        spec = FIELD_BY_KEY[key]
        values[key] = spec.coerce(raw)
        sources[key] = MANUAL_SOURCE

    unconfirmed = tuple(dict.fromkeys(str(k) for k in unconfirmed))
    unknown_unconfirmed = [k for k in unconfirmed if k not in FIELD_BY_KEY]
    if unknown_unconfirmed:
        raise ConfigError(f"未确认字段不存在：{', '.join(unknown_unconfirmed)}")

    warnings: list[str] = []
    for key in unconfirmed:
        sources[key] = UNVERIFIED_SOURCE
        warnings.append(f"「{FIELD_BY_KEY[key].label_zh}」尚未确认，取预设值，相关统计需人工复核")

    # ---------- 几何耦合校验 ----------

    length = values["court_length_m"]
    width = values["court_width_m"]
    baseline = values["baseline_to_hoop_m"]
    radius = values["three_point_radius_m"]
    corner = values["corner_lateral_m"]
    y_half = width / 2.0

    if values["court_type"] == "FULL" and length <= width:
        raise ConfigError(
            f"全场长度 {length:g} m 应大于宽度 {width:g} m；若这是半场，请把场地类型改成「半场」"
        )
    if values["court_type"] == "HALF" and length > 18.0:
        raise ConfigError(
            f"半场长度 {length:g} m 看起来是整场长度；半场请填半段长度（如 14 m）"
        )
    if baseline >= length / 2 or baseline >= width / 2:
        raise ConfigError(
            f"篮筐到底线 {baseline:g} m 超出场地范围（长 {length:g} / 宽 {width:g}）"
        )

    ft_line = values["free_throw_line_m"]
    if not (baseline < ft_line < length):
        raise ConfigError(
            f"罚球线距离 {ft_line:g} m 必须大于篮筐到底线 {baseline:g} m 且小于场地长度 {length:g} m"
        )
    if values["restricted_area_width_m"] >= width:
        raise ConfigError("禁区宽度不能超过场地宽度")

    if corner is not None:
        if corner >= radius:
            if sources["corner_lateral_m"] == MANUAL_SOURCE:
                raise ConfigError(
                    f"底角距离 {corner:g} m 不能大于等于三分弧半径 {radius:g} m；"
                    f"请改小底角，或把底角设为「无底角（纯弧线）」"
                )
            values["corner_lateral_m"] = None
            sources["corner_lateral_m"] = "derived"
            warnings.append(
                f"预设底角 {corner:g} m 与三分弧 {radius:g} m 冲突，已退化为纯弧线"
            )
            corner = None
        elif corner >= y_half:
            if sources["corner_lateral_m"] == MANUAL_SOURCE:
                raise ConfigError(
                    f"底角距离 {corner:g} m 超出场地半宽 {y_half:g} m"
                )
            values["corner_lateral_m"] = None
            sources["corner_lateral_m"] = "derived"
            warnings.append(
                f"预设底角 {corner:g} m 超出场地半宽 {y_half:g} m，已退化为纯弧线"
            )
            corner = None

    # ---------- 规则耦合校验 ----------

    clock = values["shot_clock_s"]
    if clock is not None and clock > values["period_minutes"] * 60:
        raise ConfigError("进攻时限不能长于单节时长")
    if values["outside_arc_points"] <= values["inside_arc_points"]:
        raise ConfigError(
            f"弧外分值 {values['outside_arc_points']} 必须大于弧内分值 {values['inside_arc_points']}"
        )

    if fmt is Format.THREE_V_THREE:
        if values["period_count"] != 1:
            warnings.append("3x3 通常为单节，当前节数不是 1")
        if values["shot_clock_s"] != 12:
            warnings.append("3x3 标准进攻时限为 12 秒，当前值不同")
        if (values["inside_arc_points"], values["outside_arc_points"]) != (1, 2):
            warnings.append("3x3 标准分值为弧内 1 分 / 弧外 2 分，当前值不同")
    elif values["win_score"] is not None:
        warnings.append("目标分只在 3x3 等赛制使用，当前赛制会忽略它")

    if values["no_charge_radius_m"] * 2 > values["restricted_area_width_m"]:
        warnings.append("无撞人半圆直径大于禁区宽度，请检查场地标线")

    # ---------- 组装 ----------

    court = CourtSpec(
        court_type=CourtType(values["court_type"]),
        length_m=length,
        width_m=width,
        hoop_count=2 if values["court_type"] == "FULL" else 1,
        baseline_to_hoop_m=baseline,
    )
    if corner is None:
        three_point = ThreePointSpec(
            geometry=ThreePointGeometry.PURE_ARC,
            radius_m=radius,
            corner_junction_x_m=None,
        )
    else:
        junction = math.sqrt(radius ** 2 - corner ** 2)
        three_point = ThreePointSpec(
            geometry=ThreePointGeometry.ARC_AND_CORNERS,
            radius_m=radius,
            corner_lateral_m=corner,
            corner_junction_x_m=junction,
        )

    rules = RulesSpec(
        inside_arc_points=int(values["inside_arc_points"]),
        outside_arc_points=int(values["outside_arc_points"]),
        shot_clock_s=None if clock is None else int(clock),
        period_count=int(values["period_count"]),
        period_minutes=float(values["period_minutes"]),
        fast_break_enabled=bool(values["fast_break_enabled"]),
        win_score=None if values["win_score"] is None else int(values["win_score"]),
    )
    marks = CourtMarks(
        free_throw_line_m=ft_line,
        restricted_area_length_m=ft_line,
        restricted_area_width_m=values["restricted_area_width_m"],
        no_charge_radius_m=values["no_charge_radius_m"],
    )
    players = PLAYERS_PER_TEAM[fmt]
    tracking = TrackingSpec(players_per_team=players, formation_points=players)

    config_hash = _canonical_hash(preset.id, fmt, age, values)
    label = _label(preset.label_zh, values)

    params = ActivityParams(
        fmt=fmt,
        age_group=age,
        court=court,
        three_point=three_point,
        rules=rules,
        tracking=tracking,
        marks=marks,
        unverified=tuple(warnings),
        base_preset=preset.id,
        profile_label_zh=preset.label_zh,
        provenance=tuple(sorted(sources.items())),
        overrides=tuple(sorted(overrides)),
        config_hash=config_hash,
        warnings=tuple(warnings),
    )

    return ConfigResult(
        params=params,
        base=preset.id,
        label_zh=label,
        values=dict(values),
        sources=dict(sources),
        overrides=tuple(sorted(overrides)),
        unconfirmed=unconfirmed,
        warnings=tuple(warnings),
        config_hash=config_hash,
    )


# ============================================================
# 给 UI / CLI 的元数据
# ============================================================

def fields_public() -> list[dict]:
    return [f.public() for f in FIELDS]


def presets_public() -> list[dict]:
    return [p.public() for p in PRESETS]


def schema_public() -> dict:
    return {
        "version": "1.0",
        "default_base": DEFAULT_BASE,
        "groups": [{"key": k, "label": v} for k, v in GROUP_LABELS.items()],
        "presets": presets_public(),
        "fields": fields_public(),
    }


def parse_scalar(text: str) -> Any:
    """CLI 用：把 ``key=value`` 的 value 转成 JSON 标量。"""
    raw = text.strip()
    if raw == "" or raw.lower() in {"none", "null"}:
        return None
    if raw.lower() in {"true", "false"}:
        return raw.lower() == "true"
    try:
        if raw.lstrip("-+").isdigit():
            return int(raw)
        return float(raw)
    except ValueError:
        return raw


def parse_override(text: str) -> tuple[str, Any]:
    if "=" not in text:
        raise ConfigError(f"--set 需要 key=value 形式，收到 {text!r}")
    key, value = text.split("=", 1)
    key = key.strip()
    if key not in FIELD_BY_KEY:
        raise ConfigError(f"未知字段 {key!r}；可用字段见 python -m basketball_pipeline config --list")
    return key, FIELD_BY_KEY[key].coerce(parse_scalar(value))
