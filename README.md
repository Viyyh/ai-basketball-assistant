# AI Basketball Assistant

> 仓库名：`AI Basketball Assistant`（GitHub 上会规范成 `AI-Basketball-Assistant`）
> 本地路径：`/Users/victor/AI Basketball Assistant`

给青少年球队教练用的比赛视频分析工具：录一场球（或导入一段视频），拿到一份能看、能点开、能信的投篮与阵型报告，并逐步沉淀出每个球员的分析数据。

当前状态：**v1.1 骨架可运行**。契约、参数层、mock pipeline、HTTP API 都是真实代码且有测试；真实视频推理尚未开始。

---

## 目录

```
.
├── docs/
│   ├── prd.md                    收到的产品需求文档 v1.0（冻结，不改）
│   ├── plan.md                   开发计划 v1.0（冻结）
│   ├── scope-confirmation.md     第一版范围确认
│   ├── scope-v1.1.md             本版要做的增量范围（与 prd 冲突处以此为准）
│   ├── decisions.md              决策记录 ADR（含被否掉的方案与原因）
│   ├── fiba-conformance.md       FIBA 规则符合性对照（场地尺寸、三分线、标线）
│   └── architecture.md           仓库结构与数据流
├── design/                       界面与架构设计稿（v0.1，参考）
├── contracts/                    报告契约 v1.1 + 零依赖校验器 + 样例
├── packages/params/              参数层：赛制 × 年龄段 → 场地／三分线／规则
├── services/
│   ├── api/                      FastAPI：参数解析、活动、报告寄存
│   └── pipeline/                 mock 报告生成 CLI（真实几何判定，模拟事件）
├── reference/
│   ├── legacy-demo/              收到的 F 轨前端 demo（只读参考，不参与构建）
│   └── legacy-poc/               收到的参数层 PoC（历史材料）
└── scripts/verify.sh             一条命令跑完所有检查
```

## 快速开始

只依赖 **Node ≥ 20** 与 **Python ≥ 3.11**，不需要 `npm install`，也不需要虚拟环境（标准库 + 已装的 FastAPI）。

```bash
./scripts/verify.sh          # 全量检查：契约 + 参数层 + pipeline + API（共 76 项）
```

单独跑：

```bash
# 契约（结构与语义校验，26 项）
cd contracts && node --test test/validate.test.mjs

# 参数层（24 项）
cd packages/params && PYTHONPATH=. python3 -m unittest discover -s tests -t .

# mock pipeline（11 项，含跨语言契约校验）
cd services/pipeline && PYTHONPATH=../../packages/params:. \
  python3 -m unittest discover -s tests -t .

# HTTP API（15 项）
cd services/api && PYTHONPATH=../../packages/params:. \
  python3 -m unittest discover -s tests -t .

# 生成一份示例报告并校验
PYTHONPATH=packages/params:services/pipeline python3 -m basketball_pipeline sample \
  --out /tmp/report.json
node contracts/bin/validate-report.mjs /tmp/report.json

# 起服务（--factory：应用由 create_app() 构造，避免导入即建库）
cd services/api && PYTHONPATH=../../packages/params:. \
  python3 -m uvicorn app.main:create_app --factory --reload
```

## 三层可信度

| 东西 | 状态 | 说明 |
|---|---|---|
| `contracts/` | ✅ 可用 | 三方（AI / 后端 / 前端）共同遵守的数据形状，结构 + 语义双重校验 |
| `packages/params/` | ✅ 可用 | 赛制 × 年龄段参数表、三分线判定、分值标签，唯一真源 |
| `services/api/` | ✅ 可用 | 参数解析、活动增删查、报告寄存（SQLite） |
| `services/pipeline/` | 🟡 mock | 事件是脚本化的，但坐标、分值、统计都是真实计算 |
| `reference/legacy-demo/` | ⬜ 参考 | 20 页前端能跑，数据全 mock，且与本版需求已有偏差 |
| 真实视频推理 | ⬜ 未开始 | 逐人识别尚未验证，见下文"未验证的假设" |

## 两条底线

**1. 参数只有一个来源。** 三分线半径、场地尺寸、计分规则全部来自 `packages/params`，pipeline 只透传，前端不复制一份 JS 解析器。同一场比赛的报告与界面必须用同一份 `params` 段。

**2. 数字必须能被重算。** `contracts/validate.mjs` 的 R7 要求所有统计量等于「ACTIVE 事件重算」的结果，R8 要求 `coverage` 与事件数量一致。手填的 `points`、混进对手数据的 `shots_made` 都会被抓出来。这是本项目最容易犯、也最难发现的一类错——页面能打开，数字是错的。

## v1.1 要做的功能

完整表见 `docs/scope-v1.1.md`，用户能感知的变化：

**A 层 · 让数字可信**

1. **我方 / 对方分栏**——报告不再混算两队（原 demo 最危险的一处）
2. **进攻方向**——按节记录，热图不再镜像
3. **补一次出手 / 这不是投篮**——AI 漏检的 15% 与误检，教练都能修
4. **从相册导入**——不必现场用小程序录

**B 层 · 让球员可分析**

5. **球员数据卡**——出手分布、命中率、弧外命中率，每个数字可点开到片段
6. **三维评分**——终结 / 中远投 / 参与度，A–D 分档，样本不足显示 INSUFFICIENT
7. **数据完整度**——"基于 3/5 场"，缺数据时明确说缺

**C 层 · 缓做**（UI 保留、暂不接后端）：战术板、对手库、套路演练、实时分析、分享导出、3x3 完整规则

## 未验证的假设

按危险程度排：

1. **单机位能不能做出逐人分析**——产品成立的前提。号码即身份只是 v0 权宜，同场次跨帧跟踪还没验证过。
2. **相机长录是否可靠**——40 分钟、切后台、发热、中断，未真机验证。
3. **上传链路**——2GB 视频在弱网下的进度、断点、重试。
4. **单节时长的默认值**——参数表里 U8 6 分钟、U12/U15 8 分钟、U18/一线 10 分钟是默认值，需按实际联赛确认（会在 `unverified` 里提示）。

> 三分线口径已确认：**统一 FIBA 成人标准 6.75 m + 底角直线段 6.60 m**（ADR-011）。原 demo 里 U8~U15 的 5.80 m 假设作废。

## 授权

`reference/` 下的内容是他人交付物，未包含 LICENSE。商用前必须确认授权范围；在那之前仓库保持私有。
