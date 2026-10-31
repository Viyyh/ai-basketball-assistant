# AI Basketball Assistant

面向大众篮球训练的视频分析项目。目标是从不同场地、机位的视频中提取可回看的投篮与配合信息，让用户能够确认、纠错并持续积累可信数据。

**当前阶段：本地检测、数据整理与人工审核。** 已运行真实模型推理、小规模迁移训练和外部标注审查；完整投篮识别、命中判断、战术识别与逐人统计尚未通过验收。小程序保留为原型。

## 当前数据状态

| 数据层 | 当前规模 | 使用边界 |
| --- | --- | --- |
| 原始素材 | 8 段，约 6.73 小时 | 原片完整哈希已记录，未逐帧审核全片 |
| 本地人工审核 | 43 条：14 通过、3 驳回、26 需修改 | 保留全部决定和意见 |
| 限定用途发布候选 | 12 条 | 另 2 条已通过战术存在标签一致性待办；不等于训练金标准 |
| 外部 PL-NBA | 6,408 回合、31,964 事件 | 原始标注保留，非商业研究待核验区 |
| 外部结构审查 | 6,262 无所检结构问题、19 隔离、127 需复核 | 不是画面准确率 |
| 外部目标出手复核 | 9 条候选视频对照均经用户确认 | 仅确认该目标事件，不批准整个回合；抛投意见已保留 |
| 外部代表队列 | 29 条，剩余 20 条无匹配视频 | 无视频不能提交视觉通过 |
| 训练就绪 | 0 条 | 不把按钮通过、结构合法或候选框自动转换成训练答案 |

数据库为 `data/library/library.db`，媒体、权重、数据库、密码和实验输出均保留本地，不提交 Git。新克隆不包含这些运行产物。详细状态见 [数据库与审核](datasets/library/README.md)、[整理说明](datasets/library/ORGANIZED.md)、[外部全量审查](datasets/public/AUDIT.md)。

## 常用入口

### 运行视频检测

需要 Python 3.11+、ffmpeg；实际验证环境为 Python 3.12、CPU。

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-local-tested.txt
./scripts/download-basketball-model.sh
./scripts/run-local-analysis.sh \
  --video '/绝对路径/比赛.mp4' --start 0 --seconds 30 --fps 4 \
  --out data/my-analysis
```

打开 `data/my-analysis/index.html` 查看带框 MP4 与逐帧 JSON。篮球专用模型检测 basketball、hoop、player、referee；黄色关联和检测框仍需核对。可选 `--tiled` 进行重叠分块，当前小诊断集未证明有收益，默认关闭。见 [本地分析说明](docs/local-analysis.md) 与 [模型来源](benchmarks/nba/MODEL_SOURCES.md)。

### 审核素材

```bash
python3 -m pip install 'fastapi>=0.110' 'uvicorn>=0.27' 'httpx>=0.27'
./scripts/start-review.sh             # 本地素材审核，端口 8010
python3 scripts/review_external.py    # 外部代表样本审核，端口 8012
```

打开 <http://127.0.0.1:8010/> 或 <http://127.0.0.1:8012/>。填写审核者，查看证据后提交；所有决定直接写入数据库，版本变化要求重审。模型候选与人工答案分开管理。

外部审核最新9条已确认结果可重新汇总：

```bash
python3 scripts/finalize_external_reviews.py
python3 scripts/organize_library.py
```

结果分别保存到 `confirmed_external_targets` 和 `review_tasks`，不会改写原始标注或审核决定。用途仍受标签精度、视频覆盖及数据来源条件限制。

远程第二轮审核使用独立的 `data/library/external-review.db`，不与主库自动合并。临时分享工具及访问凭据保存在本地，临时公网地址不写入 README。见 [人工审核操作](datasets/library/HUMAN_REVIEW.md)。

### 数据库查询与校验

```bash
python3 scripts/library_db.py status
python3 scripts/library_db.py list --admission accepted_scoped
python3 scripts/check_material_library.py
python3 scripts/validate_user_dataset.py
```

`library_db.py status` 统计原片和基础标注；外部审查、用户审核和后续任务是独立表，不混算。具体结构见 [数据库说明](datasets/library/DATABASE.md)。`import` 是显式同步入口，不是“自动批准”操作。

### API 与小程序原型

```bash
./scripts/start-local.sh
```

API 文档：<http://127.0.0.1:8000/docs>。业务库为 `data/app.db`，与素材库分开。小程序位于 `apps/miniprogram`，仅包含测试片段与人工投篮复核；上传、登录、部署及开发者工具验收尚未完成。见 [原型说明](apps/miniprogram/README.md)。

## 仓库结构

```text
apps/miniprogram/          小程序人工复核原型
services/api/             FastAPI 与业务 SQLite
services/pipeline/        检测、球候选关联、事件候选、渲染与 mock 报告
packages/params/          场地、赛制、预设和参数快照
contracts/                报告契约、语义校验器和样例
datasets/                 版本化标注、来源、审查规范与历史快照
benchmarks/               NBA 基准、模型来源与公开来源目录
scripts/                  分析、数据导入、审核、训练与验证工具
tools/                    本地审核页面和 macOS OCR
docs/                     产品范围、架构、实验与运行文档
design/、reference/       设计与历史实现参考
data/、models/            本地运行产物（Git 忽略）
```

脚本按功能整理在 [命令索引](scripts/README.md)，保留原路径，避免破坏现有操作和复现说明。

## 实验结果与限制

- 两段 NBA 窗口共 120 秒、480 帧：通用模型有球候选 171 帧，专用模型 365 帧。候选可用性提高不等于准确率提高。
- 五段用户视频各运行 20 秒检测，另人工标注 19 张篮筐裁剪图，执行一次迁移训练。该小规模训练未通过定位对照验收，未替换默认模型。
- 记分牌 OCR 在局部窗口识别到 6 次与官方记录对应的得分变化；不能识别未中投篮，也不能代替无记分牌的手拍分析。
- 外部9条出手已经人工核验，但全回合、精确时间及其余事件仍未获得视觉确认。

实验原始说明见 [NBA 测试记录](docs/nba-test-results.md) 与 [用户素材实验](datasets/user-videos/README.md)。

## 验证

```bash
./scripts/verify.sh         # 原有全量检查，需要 Node ≥ 20
./scripts/check-local.sh    # Python 检查及具备本地数据时的审核工具测试
```

最近实际检查：**125 项通过、4 项跨语言测试因无 Node 跳过**。另完成数据库完整性/外键、审核快照、导入幂等与视频产物检查。测试通过不代表真实视频识别准确。

## 开发原则

参数由 `packages/params` 统一提供；正式统计由有效事件重算。区分模型候选、助手复核、用户确认、训练可用与独立验收。保留原始标签和修改历史，不擅自转换未知时间记法，不把集锦标题当动作答案，不用已参与调试的素材宣称新盲测。

当前重点是把审核意见转成结构化修订、扩大有效标注并冻结可复现的数据版本，再验证候选投篮与命中判断。背景文档：[架构](docs/architecture.md) · [开源参考](docs/open-source-review.md) · [范围](docs/scope-v1.1.md)。
