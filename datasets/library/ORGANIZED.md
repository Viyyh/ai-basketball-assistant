# 当前数据库分类与待办

2026-11-01快照。运行 `python3 scripts/organize_library.py` 创建备份、刷新分类视图和待办，不修改人类决定或原标签；随后 `python3 scripts/prepare_revision_proposals.py` 刷新当前提案。

- 原片8段，来源与哈希保留，未完整逐帧审核。
- 43条最新人审：36通过、7驳回、0需修改。
- 限定用途发布候选36条；当前修改队列0项。旧任务与提案保留溯源，新决定后不再视为当前待办。
- 外部6408回合、31964事件；9个目标出手获人工确认，不扩展为全回合确认，20个代表样本缺少匹配视频。
- 模型候选5条独立隔离；训练就绪0，不将通过按钮等同于精确/穷尽训练标签。

查询入口：latest_human_reviews、revision_queue、release_candidates、rejected_records。最新运行摘要在 `data/library/organized-summary.json`，页面在 `data/library/organized.html`。

下一步是以实拍试片建立任务明确的完整标签、复核与独立会话评测，满足导出条件后冻结训练版本。无需重复审核全部既有素材；存在新标签或媒体版本变化时才重新核验。
