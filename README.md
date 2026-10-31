# AI Basketball Assistant

面向球队教练的篮球录像分析项目：从比赛视频中提取可核对的数据，让每个统计数字都能回到对应片段。

**当前重心是本地模型验证。** 已跑通篮球专用检测、可视化、记分牌 OCR 和测试基准；完整投篮识别、命中判断与逐人统计仍在开发。微信小程序保留为人工复核原型，暂不作为主线。

## 现在能做什么

| 能力 | 当前状态 |
| --- | --- |
| 真实视频分析 | 本地 CPU 推理，支持指定时间区间 |
| 篮球、篮筐、球员、裁判检测 | 已接入 E-BARD 专用模型，仍有漏检、误检 |
| 球候选关联与可视化 | 输出逐帧 JSON、带框 MP4、HTML 报告；关联未经逐帧验收 |
| 转播记分牌 OCR | macOS Vision，本地运行；裁剪针对当前 ESPN 素材 |
| 官方事件对照 | 两场 NBA 的局部出手答案、短片和评分脚本 |
| 参数与报告契约 | 场地/规则配置、快照、结构及统计一致性校验 |
| HTTP API | 活动、参数、报告寄存，以及人工投篮复核 |
| 微信小程序 | 两段测试视频播放、人工记录、统计和回看；未完成开发工具验收 |

尚不支持可靠的全场自动投篮/命中统计、跨镜头身份识别、回放去重和手拍视频泛化。官方数据仅用于事后对照，不输入模型预测。

## 快速开始：分析本地视频

需要 Python 3.11+、ffmpeg；本机已在 Python 3.12、CPU 环境验证。建议使用独立虚拟环境。

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-local-tested.txt
./scripts/download-basketball-model.sh
./scripts/run-local-analysis.sh \
  --video '/绝对路径/比赛.mp4' \
  --start 0 --seconds 30 --fps 4 \
  --out data/my-analysis
```

打开 `data/my-analysis/index.html` 查看结果：

- `annotated.mp4`：带检测框的视频；黄圈为暂定球关联。
- `analysis.json`：配置、逐帧候选、实体与诊断统计。
- `index.html`：本地结果页。

下载脚本固定专用模型版本并校验 SHA-256。可选 `--tiled` 开启重叠分块推理；当前小样本未显示收益，默认关闭。完整说明见 [本地分析说明](docs/local-analysis.md)。

## 当前实测结论

使用 2024 年 NBA 总决赛 G1、G3 的局部录像，共 **120 秒、480 帧**：

| 检查 | 结果 | 含义 |
| --- | --- | --- |
| 通用 YOLO11m 有球候选的帧数 | 171 / 480 | 候选可用性，不是准确率 |
| E-BARD 有球候选的帧数 | 365 / 480 | 漏检有所改善，但候选也可能错误 |
| 人工近似球框诊断集 | 通用模型 1/3；专用模型 3/3 | IoU ≥ 0.25，仅 3 张图，不能推断泛化性能 |
| 记分牌得分变化 | 6 次与窗口内官方命中对应 | 更新滞后 1–3 秒，不能识别另外 3 次未中 |

这不是完整两场的验收，也不是投篮识别准确率。未在这个小诊断集上训练模型，外部模型的训练数据是否与素材重叠尚未确认。

本机最终报告位于 `data/final/index.html`。视频、模型权重、数据库和分析输出不提交到 Git；新克隆不会自带实验媒体。实验过程和边界见 [测试记录](docs/nba-test-results.md)，官方数据与模型来源见 [基准说明](benchmarks/nba/README.md) 和 [模型来源](benchmarks/nba/MODEL_SOURCES.md)。

## 启动 API 与人工复核原型

```bash
python3 -m pip install 'fastapi>=0.110' 'uvicorn>=0.27' 'httpx>=0.27'
./scripts/start-local.sh
```

接口文档：<http://127.0.0.1:8000/docs>。启动脚本仅监听本机，数据库存入 `data/app.db`。macOS 也可双击根目录的 `启动篮球助手.command`。

小程序源码在 `apps/miniprogram/`，导入与调试方式见 [小程序说明](apps/miniprogram/README.md)。两段本地播放素材需另行准备在 `data/media/`，上传、登录和部署尚未实现。

## 仓库结构

```text
apps/miniprogram/          微信小程序人工复核原型
services/api/             FastAPI 与 SQLite
services/pipeline/        视频检测、候选关联、轨迹渲染、mock 报告
packages/params/          场地、规则、预设与配置快照
contracts/                报告 JSON Schema、语义校验器和样例
benchmarks/nba/            官方局部事件、人工近似框、来源记录
scripts/                  启动、分析、导出、评估与检查入口
tools/                    macOS Vision OCR 工具
docs/                     产品范围、架构、实验及运行文档
design/                   界面与架构设计参考
reference/                历史原型与实现参考
data/                     本地媒体、数据库与实验输出（Git 忽略）
models/                   本地模型权重（Git 忽略）
```

## 测试

完整检查需要 Node ≥ 20、Python ≥ 3.11，以及 API 测试依赖：

```bash
./scripts/verify.sh
```

仅运行 Python 测试：

```bash
(cd packages/params && PYTHONPATH=. python3 -m unittest discover -s tests -t .)
(cd services/pipeline && PYTHONPATH=../../packages/params:. python3 -m unittest discover -s tests -t .)
(cd services/api && PYTHONPATH=../../packages/params:. python3 -m unittest discover -s tests -t .)
```

最近本地验证：**106 项通过、4 项跨语言测试因无 Node 跳过**。另检查了报告链接、MP4 解码、输出帧数与 Python 语法。单元测试通过不代表真实视频识别准确。

## 开发原则与后续重点

- 场地与计分参数统一由 `packages/params` 提供；报告与界面共用快照。
- 正式统计需要从有效事件重算；mock 数据与模型输出明确区分。
- 不确定的检测保留为候选，缺失轨迹不补造成真实结果。
- 优先完善独立标注集、投篮事件检测、命中判断与回放去重，再恢复小程序主线。

更多背景：[架构](docs/architecture.md) · [范围](docs/scope-v1.1.md) · [决策记录](docs/decisions.md) · [手拍素材规范](docs/video-delivery-spec.md)
