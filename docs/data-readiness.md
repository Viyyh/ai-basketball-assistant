# 实拍素材到来前的数据闭环

## 已补齐的流程

当前快照（2026-11-01）：43条最新人审中36通过、7驳回，当前修订队列0项；历史提案保留，但不再列入当前待确认队列。训练就绪0。

1. 审核意见转提案：`python3 scripts/organize_library.py` 后运行 `python3 scripts/prepare_revision_proposals.py`。提案关联具体用户审核版本和原标注哈希，不改原决定；新审核产生后旧提案自动失效。
2. 在本地审核页确认目标定义、出手方式、战术类别及时间。篮球框有局部放大，快速切换时不再把上一张迟到的图片贴到当前记录。
3. 来源和当前记录经过核验后，才可准备独立的任务数据 manifest。审核按钮通过不自动设置 training_eligible 或 exhaustive。
4. 导出训练快照：

```sh
python3 scripts/export_training.py --manifest datasets/manifest.json --out data/training-datasets/v1
```

当前种子集会明确拒绝导出：没有获准训练的穷尽样本，不使用测试集替代验证集。

## 导出质量门槛

- 至少各有一张获准的 train 和 val 图，排除 test、development、近似/局部/未审核标签。
- ID、坐标、图像尺寸和实际解码有效，媒体 SHA-256 与审核记录相符。
- 按来源/会话分组；相同文件内容不得重复导出或跨 train/val；带旋转EXIF的图片需规范化方向并重审坐标。
- 同时导出图片、YOLO标签、data.yaml 和来源/分组/哈希 provenance。
- 使用临时目录完成后原子发布；已有版本不覆盖。负样本为真正空标签，不额外写入伪目标。
- 标准库校验外，导出依赖 Pillow（本地测试12.0.0）。准备好数据不代表模型已泛化。

## 新实拍素材接收

```sh
python3 scripts/intake_video.py '/绝对路径/训练.mp4' --source-id phone-session-01 --group-id court-a-day-01
```

只生成 data/library/intake/ 内的来源登记、ffprobe信息和文件哈希，不移动视频、不分配测试用途、不自动批准训练。同一会话/场地的关联片段保留同一group。下一步抽帧和标注仍需检查完整目标、遮挡和真实动作。

## 报告可信度

API 写报告时现在调用 contracts/ 的唯一 JS 结构与语义校验器，检查活动参数快照和统计一致性；错误统计不能覆盖有效报告。没有 Node 时返回503，不绕过校验。Node可安装到系统，也可通过 BASKETBALL_NODE 指定；本机 data/tools/node 已校验官方SHA-256。

不要将本轮基础设施改进解释为识别率提升：没有新训练并部署模型，原先迁移实验未通过的结论不变。外部数据的未知时间记法、用途与媒体覆盖限制也不变。
