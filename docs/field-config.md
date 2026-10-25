# 可配置赛前参数：预设 + 逐项覆盖

> 面向教练与实施同学。目标：**任何一场比赛，都能在开赛前把场地和规则调成这场比赛的实际情况**，
> 而不是只有「FIBA 成人 5v5 + 6.75 m 三分线」一个口径。

## 1. 为什么需要这一层

原来的参数层只有两个输入：赛制（5v5 / 4v4 / 3v3）和年龄段。场地长宽、三分线、节次都被写死成 FIBA 默认值，
只有三分线半径可以覆盖。这带来三个实际问题：

1. **NBA / CBA 等联赛对不上**：NBA 场地 28.65 × 15.24 m，三分 7.24 m、底角 6.71 m，4 × 12 分钟；
   CBA 场地与 FIBA 相同但 4 × 12 分钟。只改半径不够，场地和节次也得一起变。
2. **小场 / 半场 / 训练赛对不上**：14 m 半场、12 m 宽的小学场地、纯弧线三分，都不是 FIBA 全场的子集。
3. **改一个值会牵动另一个值**：底角 6.71 m 配 6.75 m 弧线是成立的，配 6.60 m 弧线就不成立；
   节次 4 配进攻时限 60 秒也是矛盾的。这些关系必须在校验层一次性说清楚。

因此把参数从「表里查出来」改成「**字段 + 预设 + 覆盖 + 校验 + 快照**」：

```
预设（FIBA / NBA / CBA / 青少年 / 3x3 / 半场）
        │  一键填表
        ▼
字段默认值 ──► 用户逐项覆盖 ──► 耦合校验 ──► ActivityParams（唯一入参）
                                   │
                                   ├── 每项来源（manual / preset / default / derived）
                                   ├── 未确认项 warnings
                                   └── config_hash（报告复算依据）
```

**预设不是唯一入口，只是"一键填表"的快捷方式。** 用户选了 NBA 之后仍然可以把单节时长改成 10 分钟，
来源会分别记成 `preset:nba` 和 `manual`。

## 2. 字段（16 项）

| 分组 | 字段 | 说明 |
|---|---|---|
| 场地 | `court_type` | 全场 / 半场 |
| 场地 | `court_length_m` / `court_width_m` | 场地长宽；半场填半段长度 |
| 场地 | `baseline_to_hoop_m` | 篮筐到底线，米制坐标的原点 |
| 三分线 | `three_point_radius_m` | 弧线半径 |
| 三分线 | `corner_lateral_m` | 底角直线段离中轴距离；`null` = 纯弧线 |
| 标线 | `free_throw_line_m` | 罚球线距离（只影响绘图） |
| 标线 | `restricted_area_width_m` | 禁区宽度（只影响绘图） |
| 标线 | `no_charge_radius_m` | 无撞人半圆半径（只影响绘图） |
| 规则 | `period_count` / `period_minutes` | 节数与单节时长 |
| 规则 | `shot_clock_s` | 进攻时限；`null` = 不计 |
| 规则 | `inside_arc_points` / `outside_arc_points` | 弧内 / 弧外分值（3x3 是 1 / 2） |
| 规则 | `fast_break_enabled` | 是否做快攻识别 |
| 规则 | `win_score` | 目标分（3x3 21 分），其他赛制忽略 |

字段定义在 `packages/params/basketball_params/config.py` 的 `FIELDS`，带中文名、单位、候选值、范围、
是否必填、是否进阶。前端表单应直接读 `GET /v1/config/schema` 渲染，**不要在前端再写一份字段表**。

## 3. 内置预设

| id | 适用 | 场地 (m) | 三分 / 底角 (m) | 节次 | 弧内/外 | 进攻时限 |
|---|---|---|---|---|---|---|
| `fiba` | FIBA 成人 | 28.00 × 15.00 | 6.75 / 6.60 | 4 × 10 | 2 / 3 | 24 s |
| `nba` | NBA | 28.65 × 15.24 | 7.24 / 6.71 | 4 × 12 | 2 / 3 | 24 s |
| `cba` | CBA | 28.00 × 15.00 | 6.75 / 6.60 | 4 × 12 | 2 / 3 | 24 s |
| `youth-u15` | 青少年 U15 | 28.00 × 15.00 | 6.75 / 6.60 | 4 × 8 | 2 / 3 | 24 s |
| `three-x-three` | FIBA 3x3 | 11.00 × 15.00（半场，宽 > 长） | 6.75 / 6.60 | 1 × 10 | 1 / 2 | 12 s |
| `half-court` | 半场 4v4 / 训练赛 | 14.00 × 15.00（半场） | 6.75 / 6.60 | 4 × 10 | 2 / 3 | 24 s |

`win_score` 只有 3x3 预设会填 21，其余为 `null`。3x3 场地是 15 m 宽 × 11 m 长（宽 > 长），半宽 7.5 m > 6.60 m，所以和 5v5 一样是「弧线 + 底角」，不是纯弧线（ADR-014）。只有半宽放不下底角的小场，才用 `corner_lateral_m=null` 退化为纯弧。

**NBA 预设只覆盖与"判分 / 时间轴"相关的规则。** 防守三秒、干扰球、暂停数等 NBA 特有规则不在 v1 模型里，
不要因为选了 NBA 就以为所有规则都变成了 NBA。

## 4. 覆盖、来源与"不确定"

优先级：

```
manual（用户显式改的） > preset（预设带入的） > default（兜底）
```

- 每项来源写进快照的 `sources`：`manual` / `preset:nba` / `default` / `derived`。
- 用户说"这个我不确定"的字段放进 `unconfirmed`：**仍然取预设值**，但来源标成 `unconfirmed`，
  并写进 `warnings`。报告页必须显示这些警告，不能把未确认当成已核实。
- `derived` 目前只用于"预设底角与用户改过的场地冲突，自动退化为纯弧线"这一种情况。

## 5. 校验：矛盾直接报错

提交前统一校验，`ConfigError.errors` 里保留全部问题：

| 规则 | 例子 |
|---|---|
| 全场长度 > 宽度；半场长度 ≤ 18 m | 28 × 15 合法；14 × 15 却选"全场"会报错 |
| 篮筐到底线 < 半场长 / 半宽 | 防止原点跑到场外 |
| 罚球线在底线与中线之间 | 5.80 m 是 FIBA 默认，可改但必须在场内 |
| 底角 < 三分弧半径 | 底角 6.71 m 配 7.24 m 弧合法；配 6.60 m 弧报错 |
| 底角 < 场地半宽 | 12 m 宽场地不能有 6.60 m 底角 |
| 进攻时限 ≤ 单节时长 | 60 s 进攻时限配 0.5 分钟单节报错 |
| 弧外分值 > 弧内分值 | 防止 1/1 分这种无法判分的组合 |

**预设冲突与手动冲突区别对待：**

- 用户手动改出来的矛盾 → **报错**，不保存；
- 预设值与用户改过的场地不兼容（例如把 FIBA 场地宽度改成 12 m）→ 自动退化为纯弧线，并写 warning，
  因为用户改的是宽度，不是底角，直接报错会让人摸不着头脑。

3x3 的值不一致（4 节、24 秒、2/3 分）只给 warning，不阻断 —— 训练赛可能确实这么打。

## 6. 快照与 hash

解析结果 `ConfigResult` 同时给出：

- `params`：完整的 `ActivityParams`，pipeline 的唯一入参；
- `values` / `sources` / `overrides` / `unconfirmed` / `warnings`；
- `config_hash`：对「预设 id + 赛制 + 年龄段 + 全部最终值」做规范化 JSON 后的 SHA-256。

任何一项改动都会改变 hash。报告把它写进 `params` 快照后，可以回答两个问题：
"这份报告当时用的是哪套规则？"和"改了参数之后，哪些数字需要重算？"。

契约 `contracts/report.schema.json` **没有改动**：快照是活动 / API 层的附加信息，
`params` 段仍然是原来的 19 个键，旧报告和旧前端不受影响。

## 7. 用法

### HTTP

```bash
# 字段、分组、候选值、默认预设
curl 'http://127.0.0.1:8000/v1/config/schema'

# 预设列表
curl 'http://127.0.0.1:8000/v1/config/presets'

# NBA 预设，但单节改成 10 分钟，并标记为"尚未确认"
curl 'http://127.0.0.1:8000/v1/config/resolve?base=nba&set=period_minutes=10&unconfirmed=period_minutes'

# 球场预览（SVG，保存前先看一眼）
curl -o court.svg 'http://127.0.0.1:8000/v1/config/preview?base=nba'

# 用完整配置新建活动
curl -X POST 'http://127.0.0.1:8000/v1/activities' \
  -H 'content-type: application/json' \
  -d '{"title":"校联赛半决赛","format":"5V5","age_group":"SENIOR",
       "config_base":"nba","config_overrides":{"period_minutes":10},
       "config_unconfirmed":["period_minutes"]}'
```

`set` 可重复；值支持 `true/false/none`、整数、小数、字符串。
错误返回 400，`detail` 里是中文原因（例如"底角距离 8 m 不能大于等于三分弧半径 7.24 m"）。

### CLI

```bash
# 列出字段与预设
PYTHONPATH=packages/params:services/pipeline python3 -m basketball_pipeline config --list

# 解析并生成预览
PYTHONPATH=packages/params:services/pipeline python3 -m basketball_pipeline \
  config --base nba --set period_minutes=10 --unconfirmed period_minutes --svg court.svg
```

### 代码

```python
from basketball_params import resolve_config, ConfigError

result = resolve_config("nba", {"period_minutes": 10}, unconfirmed=["period_minutes"])
result.values["three_point_radius_m"]   # 7.24
result.params.three_point.geometry      # ARC_AND_CORNERS
result.warnings                         # ("「单节时长」尚未确认……",)
result.config_hash                      # 64 位 sha256
```

## 8. 与视频 ingest 的关系（尚未打通）

当前 `services/pipeline ingest` 仍然只认 `--format/--age/--radius` 这组旧参数，
**没有**把配置快照传给检测/跟踪。下一步分三档，按投入从低到高：

1. **直接映射**（1 天级）：`ingest --config activity.json`，把 `expected_players`、
   ROI 建议、快攻开关读出来。不改变检测算法，只让 ingest 与报告用同一份口径。
2. **半自动标定**（1~2 周）：用户点四个场地角点 → 单应矩阵 → 像素轨迹落成米制坐标；
   同时用场地线检测给出角点初值。这是"用户自适应"里最值得先做的一档：
   不要求识别联赛，只要求把这场地的几何对齐。
3. **规则/赛事识别**（研究项，不排期）：从记分牌 OCR、场地线间距、罚球圈位置推断
   三分线半径与联赛。广播镜头会切、会摇，单帧推断不可靠，**不要作为 v1 的阻塞项**。

在 1 完成之前，任何"配置 → 检测"的联动都不要声称已经生效。

## 9. 已知边界（v1 明确不做）

- 不做用户自定义预设的持久化（"保存为我的联赛"）。当前预设是代码常量；
  每场活动的快照已经存库，后续做"从某场复制配置"只差一个接口。
- 不做球员/球队级规则（例如某队使用不同三分线）。
- 不做罚球次数、暂停、犯规上限等完整规则引擎，只做与**判分、时间轴、场地几何**相关的部分。
- 不做自动从视频推断规则。
- 球场预览是俯视示意图，不追求与真实场地纹理一致；它用来发现几何矛盾，不用于转播包装。

## 10. 测试与验收

```bash
./scripts/verify.sh
```

- 参数层 56 项：旧口径 25 项 + 配置 31 项（预设、覆盖、校验、hash、预览、3x3 几何）；
- API 21 项：新增 schema / resolve / preview / 带快照建活动；
- 契约 26 项、pipeline 30 项不变 —— 证明契约没有被参数层改动破坏。

新增一个联赛预设时，只需要在 `config.py` 的 `PRESETS` 里加一条，并在
`packages/params/tests/test_config.py` 里补一个数值断言；不要改 `table.py` 的 FIBA 默认值。
