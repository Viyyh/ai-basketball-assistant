# 本地分析交付说明

先打开 `data/final/index.html` 查看实测报告，含两场带检测框的视频、得分变化、对照数据和限制。媒体与输出不进入 Git。

## 已运行的能力

- 本地 CPU 视频推理，支持指定时间区间与任意本地文件。
- E-BARD 篮球、篮筐、球员、裁判专用检测，球候选短时关联；输出 JSON、带框 MP4 和 HTML。
- 可选重叠分块推理与候选去重。小诊断集上未证明优于全帧，默认关闭。
- macOS Vision 本地 OCR，读取这两场 ESPN 转播的记分牌并提取稳定得分变化。此路径不能替代无记分牌的手拍比赛分析。
- NBA 官方记录与输出事后对比，预测路径不读取官方答案。

## 一条命令处理新片段

```bash
./scripts/download-basketball-model.sh
./scripts/run-local-analysis.sh --video '/绝对路径/比赛.mp4' --start 0 --seconds 30 --fps 4 --out data/my-analysis
```

打开 `data/my-analysis/index.html`。参数 `--tiled` 启用重叠分块，代价是更多推理；`--exclude-bottom 0.1` 可以排除底部 10% 内的球候选中心，仅在确定此处是遮挡字幕时使用。默认不裁掉任何区域。模型源见 benchmarks/nba/MODEL_SOURCES.md；下载脚本固定版本并验证 SHA-256。

Python 依赖版本在 requirements-local-tested.txt，另需 ffmpeg。当前机器实际使用 Python 3.12、CPU；检测到 MPS 不可用，未声称已验证 GPU。

## 重复 NBA 实验

```bash
YOLO_CONFIG_DIR=/tmp/Ultralytics python3 scripts/benchmark_local.py
python3 scripts/prepare_nba_cases.py
YOLO_CONFIG_DIR=/tmp/Ultralytics python3 scripts/check_nba_cases.py
```

`compare_ball.py` 依赖 data/labels/ 内已提取的原图。人工近似框保存在 benchmarks/nba/ball-labels.json，仅 3 张清晰球图，不能作为足够的训练集或独立验收集。

记分牌功能为 macOS 特定实现：

```bash
CLANG_MODULE_CACHE_PATH=/tmp/basketball-clang swiftc -module-cache-path /tmp/basketball-swift tools/ocr_scoreboard.swift -o /tmp/basketball-ocr
python3 scripts/scoreboard_local.py --prepare
python3 scripts/scoreboard_local.py
python3 scripts/validate_scoreboard.py
python3 scripts/build_local_report.py
```

Vision 在受限沙箱中会失败，需要允许本地 OCR 进程运行。无外部 OCR 服务、无 API key。记分牌裁剪目前针对提供的 1920×1080 ESPN 素材，不是通用 OCR 定位器。

## 实测边界

已测试连续片段合计 120 秒，不是完整两场。事件答案共 9 次，其中 6 次命中、3 次未中。记分牌检出的 6 次变化与这 6 次命中对应，允许 4 秒比赛时钟滞后；不能把它宣传为整体投篮 100% 准确率。

通用 YOLO11m 输出球候选的帧数为 171/480，专用模型为 365/480。这是候选可用性，不是逐框正确性；专用模型也有多候选和误检。两种模型的暂定关联实现与切镜阈值版本不同，不比较轨迹段数。切镜标志是保守启发式，未验收；没有标志也不表示没有切镜。

尚未完成真实画面的投篮/命中分类、未中事件自动识别、回放去重、球员身份与逐人分析。不会用官方答案回填预测，也不会从缺失球轨迹推算命中率。未对 3 张图进行训练，避免制造过拟合结果。

验证记录：参数层 56 项通过，API 22 项通过，pipeline 32 项中 28 项通过、4 项因缺少 Node 跳过；106 通过、4 跳过。报告链接、MP4 解码、480 帧输出一致性、Python 语法与 diff 空白检查通过。
