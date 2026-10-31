# 本地素材数据库

数据库文件：`data/library/library.db`，SQLite，独立于小程序/API 的 `data/app.db`。只存目录、标签、审核和候选，不把大视频写入数据库，也不上传媒体。

## 数据表

- sources：原片路径、来源分组、文件大小、SHA-256 和元数据。
- annotations：当前审核状态、标签用途、媒体校验、原始框/事件/战术标注 JSON。保留单人审核与精度限制，不冒充金标准。
- reviews：按内容哈希保存审核版本，保留此前原片缺失时的历史记录。
- candidates：单独隔离模型候选，不进入人工标签表。
- imports：内容指纹与导入记录，重复导入相同数据不会增加记录。
- training_annotations：只返回明确获准训练的接纳记录，当前为空。

## 使用

```sh
python3 scripts/library_db.py status
python3 scripts/library_db.py list --admission accepted_scoped
python3 scripts/library_db.py import --rehash-originals
python3 scripts/test_library_db.py
```

导入前检查审核快照、标注媒体哈希、原片存在与大小；`--rehash-originals` 另完整读取并校验 8 段原片。写入使用事务和外键，失败回滚；已有审核版本不被覆盖。隔离/限制记录不能以 training_ready=true 写入。

这次建立数据库不等于完成 6.73 小时原片的逐帧视觉审核。当前仅 25 条限定用途接纳、6 条遮挡参考、12 条战术待审核；所有训练就绪和精确金标准标记仍为 false。

原始标注源文件仍是审核版本的来源；当前数据库通过显式 import 同步，不提供绕过审核的直接编辑或自动批准流程。数据库保存在 Git 忽略目录，代码和文档可提交，个人视频路径不会随数据库推送。

## 后续数据表与当前入口

- human_decisions：本地逐条审核的完整操作历史；human_clean_annotations 为版本匹配的最新通过记录。
- review_tasks / revision_queue：关联具体审核版本的修改待办，不改写用户决定。
- release_candidates：排除当前未解决一致性问题的限定用途候选，不等于可训练。
- external_sources / external_records / external_events：隔离保存外部来源、原始回合与动作视图。
- external_quality：外部全量结构检查结果，不是画面准确率。
- external_review_samples / external_sample_reviews：代表样本及人工目标事件复核。
- confirmed_external_targets：显式整理时生成的目标事件确认快照；需重跑 finalize_external_reviews.py 才刷新，不用于自动训练。

最新总览见 docs/STATUS.md；初始审核统计和实验记录保留其发生时点，不代表当前用户审核状态。
