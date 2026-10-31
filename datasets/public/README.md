# 外部数据接入记录

2026-11-01 已从 PL-NBA 官方 GitHub 下载约 4.5MB 标注压缩包，解析并导入同一个 SQLite 的独立外部区：

- external_sources：来源、声明用途、压缩包 SHA-256。
- external_records：6,408 个回合、32 个比赛分组、原始 JSON 与成员哈希。
- external_events：通过 JSON 展开的动作视图，不是审核通过的训练标签。

原始数据包含 31,964 条事件，18 种原始标签。PutBack/Putback 在视图中统一为 PutBack，4 条 nan 映射 unknown；原始 JSON 不修改。运球、传球、上篮等单人动作不自动等同于挡拆、溜底线等团队战术。

这些数据状态全部为 external_unverified，媒体尚未获取、时间记法尚未核实、training_ready=0。作者声明 CC BY-NC 4.0，当前仅作本地研究候选，不直接进入面向商业产品的训练集。不能用第三方公开成绩替代本仓库测试。

此轮其他来源检查：

- UVY：已有篮球素材清单，尝试只读取 ZIP 篮球部分时服务器返回的 Range 数据长度不符，安全中止；没有把未获取的图像算作入库。
- MultiSports：官方提供 HF 下载入口，篮球 trainval/test 包分别约 15.5GB/6.8GB，尚未下载；声明为非商业研究许可。
- clee9/bball_game：当前 Parquet 字段只含本地图片路径字符串和框，未发现实际媒体或许可说明；不视作可用图片数据集。

复现导入：`python3 scripts/import_public_annotations.py`（需事先准备 data/public-sources/pl-nba-annotations.zip）。相同来源成员 ID 幂等写入，不增加重复记录，不写 human_decisions、annotations 或人工确认视图。正式扩充流程仍为来源筛选 → 媒体取得 → 去重/分组 → 外部标签清洗 → 画面复核 → 审批用途。

你的工作应集中在训练重点选择和有歧义的篮球语义确认。下载、格式转换、来源追溯、去重、尺寸/时间合法性检查、预标注与异常筛选由工具完成。
