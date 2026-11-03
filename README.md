# AI Basketball Assistant

面向大众篮球训练的视频分析项目。目标是从不同场地、机位的视频中提取可回看的投篮与配合信息，让用户能够确认、纠错并持续积累可信数据。

**当前阶段：本地检测、数据整理与人工审核。** 已运行真实模型推理、小规模迁移训练和外部标注审查；完整投篮识别、命中判断、战术识别与逐人统计尚未通过验收。小程序保留为原型。

## 从这里开始

- **完整说明**：[项目完整说明与操作指南](docs/PROJECT_GUIDE.md)，包含功能边界、数据库、审核流程、目录与下一步。
- **自己审核**：Finder双击根目录“开启本地审核.command”，打开本机8015统一入口。
- **协作审核**：双击“开启远程审核.command”；结束后双击“关闭远程审核.command”。当前为按需模式，不登录自动开启。
- **当前新增**：[个性化设置](docs/submission-preferences.md)、[篮球事件与战术扩展](docs/video-event-learning.md)。

## 当前数据状态

以下为本轮整理时快照；用户继续审核时，以页面和数据库实时结果为准。

| 数据层 | 当前规模 | 使用边界 |
| --- | --- | --- |
| 原始素材 | 8 段，约 6.73 小时 | 原片完整哈希已记录，未逐帧审核全片 |
| 本地人工审核 | 43 条：36 通过、7 驳回、0 需修改 | 保留全部决定和意见 |
| 限定用途发布候选 | 36 条 | 当前修订队列为空；不等于训练金标准 |
| 外部 PL-NBA | 6,408 回合、31,964 事件 | 原始标注保留，非商业研究待核验区 |
| 外部结构审查 | 6,262 无所检结构问题、19 隔离、127 需复核 | 不是画面准确率 |
| 外部目标出手复核 | 9 条候选视频对照均经用户确认 | 仅确认该目标事件，不批准整个回合；抛投意见已保留 |
| 外部代表队列 | 29 条，剩余 20 条无匹配视频 | 无视频不能提交视觉通过 |
| 训练就绪 | 0 条 | 不把按钮通过、结构合法或候选框自动转换成训练答案 |

数据库为 `data/library/library.db`，媒体、权重、数据库、密码和实验输出均保留本地，不提交 Git。新克隆不包含这些运行产物。详细状态见 [数据库与审核](datasets/library/README.md)、[整理说明](datasets/library/ORGANIZED.md)、[外部全量审查](datasets/public/AUDIT.md)。

## 常用入口

### 运行视频检测

视频分析需要 Python 3.11+、ffmpeg；API 报告入库另需 Node ≥20。实际验证环境为 Python 3.12、CPU。

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

最近实际检查：**209 项通过，跨语言检查已运行，无跳过**。另完成数据库完整性/外键、审核快照、导入幂等与视频产物检查。测试通过不代表真实视频识别准确。

## 开发原则

参数由 `packages/params` 统一提供；正式统计由有效事件重算。区分模型候选、助手复核、用户确认、训练可用与独立验收。保留原始标签和修改历史，不擅自转换未知时间记法，不把集锦标题当动作答案，不用已参与调试的素材宣称新盲测。

当前重点是接收首批实拍试片、扩大按任务完整核验的标注并冻结可复现的数据版本，再验证候选投篮与命中判断。背景文档：[架构](docs/architecture.md) · [开源参考](docs/open-source-review.md) · [范围](docs/scope-v1.1.md)。

## 实拍到来前的准备

已补齐审核修订提案、目标框放大、出手方式字段、训练快照质量门槛与新视频接收入口。见 [数据准备闭环](docs/data-readiness.md)。审核页会随着新决定动态刷新，静态数据数量是整理时快照；不会自动将用户通过记录升级为训练金标准。

## 实拍要求与项目进度

最新采集依据为 [完整实拍任务书](docs/video-delivery-spec.md) 与 [8页可打印PDF](docs/shooting-task-v2.pdf)，原任务书修订理由见 [审阅说明](docs/shooting-guide-review.md)。先交30–60秒原片试拍，不必先拍整场；个人训练1080p可试用，半场远景优先4K，按实际清晰度验收。

[当前进度与下一阶段](docs/STATUS.md) 明确区分已实现工具、实验结果和未验收功能。训练标注、事件真值与独立实拍测试仍是主要缺口。

## 个人视频复盘工作台（2026-11-02）

本机两段实拍已准备为4名待确认球员、9条待确认动作候选，独立保存在本地新库，候选与个人观察配置也仅保存在Git忽略的data目录。运行 `./scripts/start-player-review.sh`，打开 <http://127.0.0.1:8013/>，可直接拖动原片、确认身份、添加/修订事件、声明连续复核范围，并生成带证据的个人统计。未知结果不混入命中率分母；更正保留历史，来源变更后停止计数。

新增真实展示时间戳索引与一对一出手评测工具。具体操作、数据格式、当前统计边界和13+11项新增测试见 [个人复盘闭环](docs/player-review-workbench.md)。尚未完成全片人工事件标注，尚未测得这两段的模型准确率，没有训练或部署新模型。新克隆不含原片、SQLite或人物截图。

## 受保护的外网审核

统一远程入口已加入账号白名单、管理员/审核者/只读权限、提交者署名、访问日志和按需开启/关闭。个人复盘与独立二审可协作，普通审核者不能进入主库或导出数据；原片、账号密码和SQLite不进入GitHub。当前临时网址与密码仅保存本机，查看 [远程访问说明](docs/remote-review-access.md)。当前不再登录自动开启：在Finder中双击根目录“开启远程审核.command”或“关闭远程审核.command”。开启期间进程异常自动恢复；休眠/断网会中断，重新开启可能更换网址。

2026-11-03更新：独立二审43条已提交（34通过、2驳回、7不确定）；实拍4人身份已确认、剩4条动作待处理。23个连续分段仍待复核。上述主库和二审统计分开管理。

## 外部片段扩充（2026-11-04）

已实际取得第一批28个作者公开样例窗口，约6分57秒，独立进入待审核区。开启本地审核后进入“新采集片段审核”（8017），支持多标签、参与者与时间区间；不会自动并入训练集。取得的文件仅保存本地。来源、采集范围及边界见 [外部片段接收](docs/external-clip-intake.md)，其他教学/研究来源见 [战术参考索引](docs/tactics-reference-library.md)。
