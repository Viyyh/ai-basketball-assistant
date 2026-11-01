# 脚本命令索引

均从仓库根目录运行。脚本保留原路径；原视频和实验产物位于本地 data/。

| 任务 | 入口 | 说明 |
| --- | --- | --- |
| 任意本地视频检测 | `run-local-analysis.sh` → `analyze_local.py` | MP4 / JSON / HTML |
| 模型准备 | `download-basketball-model.sh` | 固定版本和哈希 |
| 启动业务 API | `start-local.sh` | 8000，data/app.db |
| 素材人工审核 | `start-review.sh` → `review_materials.py` | 8010，主素材库 |
| 独立远程二审 | `share_review.py` | 8011，独立数据库和本地密码 |
| 外部代表样本审核 | `review_external.py` | 8012，仅有视频才能视觉确认 |
| 基础数据集校验 | `dataset.py`、`test_dataset.py` | 种子数据集，不直接训练 |
| 用户素材准备 | `prepare_user_frames.py`、`prepare_user_hoop.py` | 依赖本地 inventory.json |
| 用户实验训练与评估 | `train_user_hoop.py`、`evaluate_user_hoop.py` | 独立实验，不替换默认模型 |
| 用户数据校验 | `validate_user_dataset.py` | 哈希、坐标与分组 |
| 素材目录复核 | `audit_material_library.py`、`check_material_library.py` | 检查审核输入快照与来源 |
| 素材目录页 | `build_material_library_report.py` | data/library/index.html |
| SQLite 同步与查询 | `library_db.py` | import / status / list |
| 任务整理 | `organize_library.py` | 备份、分类、修改任务，不改人工决定 |
| 公开标注导入 | `import_public_annotations.py` | PL-NBA 外部区，不混入确认库 |
| 外部全量审查 | `audit_external_annotations.py` | 结构检查与代表样本，不是准确率 |
| 外部用户确认归档 | `finalize_external_reviews.py` | 仅发布当前版本的目标出手确认 |
| 公开素材试取 | `fetch_public_basketball.py` | 有下载预算；不兼容 Range 时安全停止，非已获取媒体证明 |
| NBA 诊断 | `benchmark_local.py`、`compare_ball.py`、`check_nba_cases.py` | 对照实验，不用于宣称总体准确率 |
| NBA 片段与事件对比 | `prepare_nba_cases.py`、`evaluate_nba.py` | 粗窗口与游戏时钟空间评估 |
| 球候选／事件候选 | `ingest.sh`、`extract_candidates.py` | 轨迹与待审核事件 |
| 记分牌 | `scoreboard_local.py`、`validate_scoreboard.py` | macOS OCR，特定 ESPN 裁剪 |
| NBA 结果汇总 | `build_local_report.py` | data/final/index.html |
| 验证 | `verify.sh`、`check-local.sh`、`test_*.py` | 区分纯逻辑与本地媒体集成测试 |

实验脚本输入/输出详见各文件顶部说明及 datasets/、docs/ 对应文档。不要在不了解标签用途、媒体可用性和训练批准状态时直接启动训练。

新增：`prepare_revision_proposals.py` 生成待确认修订；`export_training.py` 导出不可覆盖的训练快照；`intake_video.py` 登记新原片；`test_training_export.py` 和 `test_revision_proposals.py` 检查质量门槛及不自动批准。

拍摄任务书：`python3 scripts/build_shooting_guide.py --font /path/to/CJK.ttf` 从 `docs/video-delivery-spec.md` 生成 `output/pdf/shooting-task-v2.pdf`，需另装reportlab（非推理运行依赖）。默认字体路径适用于本机macOS；其他环境通过 `--font` 指定支持中文的TrueType字体。审阅PDF渲染后，将同一文件复制到 `docs/shooting-task-v2.pdf` 发布；原始私有附件不入库。

个人复盘：`prepare_player_session.py` 幂等导入版本化的助手候选和本地来源；`start-player-review.sh` 启动8013工作台；`index_video_timestamps.py` 检查全片展示时间戳；`evaluate_shot_events.py` 对完整审核范围计算一对一事件指标。格式与使用边界见 [说明](../docs/player-review-workbench.md)。

远程审核：`review_gateway.py` 管理本地白名单与受保护代理；`remote_review_supervisor.py` 守护专用后端和临时隧道；`install_remote_review_agent.py` 安装/移除当前用户登录启动项。账号、网址和密码只保存在data/access；操作说明见 [远程访问](../docs/remote-review-access.md)。

按需远程控制：`review_remote.py start|stop|status`；仓库根目录三个中文.command文件可在Finder双击。当前默认不用登录自启动工具。
