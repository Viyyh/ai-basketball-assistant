# 用户提供视频：篮筐定位实验 v0.1

五段视频的本地路径和 ffprobe 元数据位于 data/user-materials/inventory.json，原始文件不移动、不上传。总时长约 206 分钟，目前仅抽样检查，未标完整视频。

本轮人工标注 19 张裁剪图，只标篮圈与篮网的可见区域（hoop），不含篮板。标签是单人目视近似框，尚未双人复核，不能宣称高精度标准答案。

- train：杏林湾 6 张、FIBA 两场各 1 张，以及 FIBA 两张负样本，共 10 张。
- val：校园录像 3 张。
- test：张江室内录像 6 张；同一固定视角，帧间相关，代表性有限。
- 两段 FIBA 共享赛事/场地，因此同组同划分，不互作训练和验证。

手动裁剪仅保留目标篮筐周围区域，排除远端或相邻球场的篮筐。这是 ROI 内定位实验，不能作为自动全画面定位验收，也不用于训练篮球、球员或出手/命中分类。没有用模型预测作为人工框。

`hoop-v0.1.jsonl` 保存来源时间、原图裁剪坐标、框、审核方式、分组、划分和图片 SHA-256。媒体与 YOLO 标签位于 data/user-hoop-dataset。后续扩大数据仍须按场地/会话分组。

运行 `scripts/train_user_hoop.py` 训练独立单类实验模型，使用 E-BARD 初始化、冻结前 10 层、CPU、640 输入，最多 20 epochs、early stopping patience=6。它不替换四类默认模型，避免破坏篮球检测。best.pt 只由 val 选择，冻结哈希后用 `scripts/evaluate_user_hoop.py` 对 test 做一次比较。仅在冻结且评估通过后才可考虑部署，不因训练跑完自动替换。

## 首轮实测结果

CPU 训练触发 early stopping，在第 7 epoch 停止；训练日志、CSV 和权重在 data/training/hoop-v01。冻结 checkpoint SHA-256 已记录。

在固定 confidence=.25、IoU≥.5、640 输入下，原模型与实验模型均为 val 0/3、test 0/6。结果是未通过，不部署实验模型。该结果只针对手动裁剪区域，不等于全画面篮球/篮筐检出率为零。此次测试已经用于报告，未来模型在该来源上的重复测试不再称为盲测。

全部五段视频另外各运行原始 E-BARD 20 秒诊断，合计 400 帧，带框结果在 data/user-materials/diagnostics。球候选比例不能算准确率。最终本地报告为 data/user-materials/index.html，包括人工框复核、冻结测试和视频链接。

复现准备：运行 scripts/prepare_user_frames.py（依赖本机 inventory.json 路径清单），再运行 scripts/prepare_user_hoop.py。训练：scripts/train_user_hoop.py。校验：scripts/validate_user_dataset.py。评估入口只能在 best.pt 冻结后执行；已有结果时拒绝覆盖。没有以模型预测回填标注，也未将实验权重替换默认模型。
