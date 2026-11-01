# 从个人PDF到可纠错的视频复盘

2026-11-02。新工作台用于个人投篮回看和数据纠错；它是本地研发原型，不是自动完成全片身份识别和投篮统计的产品。

## 当前可用入口

```sh
# 本机已经准备好两段实拍的来源登记；新克隆没有这些私有文件。
python3 scripts/prepare_player_session.py
./scripts/start-player-review.sh
```

打开 http://127.0.0.1:8013/ 。默认SQLite为 `data/library/player-review.db`，独立于既有素材审核库和业务API库。只监听本机，不修改旧人审决定，不复制或公开原片。默认端口可用 `--port` 修改。

准备脚本检查完整源哈希，从本地 `data/library/player-session-proposals.local.json` 中的sources读取对应intake来源登记。同一复盘库只容纳一个关联来源组。私有候选说明和个人观察仅保存于Git忽略的data目录，只有助手观察线索，没有人类批准或精确真值。重复运行不覆盖用户后续修订；源内容变化则拒绝套用旧候选。新克隆可运行测试和空工作台，但不能播放未提供的私有素材。

## 使用流程

1. 填写审核者，查看衣着/号码和视频，逐人确认临时身份。可撤回身份确认，相关个人统计立即退出有效集。两段归为同一来源组，不能跨训练和盲测。
2. 选择原片和候选，播放器直接定位原片；浏览器当前播放时间可填入起止字段。前进/后退0.25秒是寻帧辅助，不承诺每次恰好一个源帧。
3. 修改球员、事件、动作、结果和状态，查看证据后提交。可以新增漏掉的事件；无法判定结果选unknown。非出手事件不能带命中/未中结果。尚未确认的候选不计正式统计。
4. 对完整看完并补齐全部出手的连续片段登记复核区间，包括没有出手的片段。重叠部分只计一次；误登记可撤回。登记范围不自动批准该段事件，也不是助手已全片审核的声明。
5. 个人报告从有效事件重算，统计包含来源与事件ID，可点击回到原片。导出JSON带修改历史，打印只输出个人报告。个人报告同时保留此前助手的动作观察和训练建议，明确标记为待确认观察；每人可展开候选回看入口，不混入已确认数字。打印和JSON是当前的交付方式，未实现自动个性化教练评分。

## 统计规则与失效规则

- 必须同时满足身份confirmed、事件confirmed、kind=shot、原片文件状态未变更，才进入该球员已确认出手集。未知归属单独保留，不擅自分给某人。
- made、missed、unknown分别列出；已知结果命中率 = made / (made+missed)，分母为0时为null，不显示0%。它只描述确认子集，不是全片命中率；每位球员的识别准确率仍为null。
- 只有人工确认过的子集为0，不表示真实球员0次出手。来源复核覆盖率显示连续看过的声明区间，占比不等于模型准确率。
- 同源两条已确认出手区间若重叠，则阻止双计，要求核对重复事件或缩小区间。相邻真实出手应各有独立的准确窗口，不用长窗口合并多个出手。
- 所有修改使用version乐观锁和数据库写事务；旧页面提交返回409。保存更正留before/after和审核者，不覆盖历史；导出使用同一数据库读快照。
- 来源在接收时计算完整SHA-256，并记录大小/mtime。服务端发现文件指纹变化/缺失后停止播放、统计及写入；相同大小且人为恢复mtime的内容篡改不能仅靠此轻量指纹检测，重新接收应重新核对完整哈希。没有声称每次HTTP请求都重新哈希大视频。
- HTTP文件回放采用框架原生Range响应，已用206字节区间测试。实现依据：[Starlette FileResponse官方文档](https://starlette.dev/responses/#fileresponse)。

## 两段实拍的展示时间戳检查

`index_video_timestamps.py` 对原片完整解码，记录best-effort display timestamps及源哈希，不转码：

```sh
python3 scripts/index_video_timestamps.py '/原片.mp4' --out data/my-pts.json
```

本次A为10151帧、B为9173帧；均无缺失、相邻重复或倒退展示时间戳。A相邻差约0.033322-0.033434秒，B约0.033233-0.033434秒。此前null输出DTS的2条警告不能直接证明源PTS损坏。两者记录分开保留，未“修复”或改写原片。当前播放器辅助回看不替代逐帧动作裁决。

## 如何实际测准确率

```sh
python3 scripts/evaluate_shot_events.py \
  --predictions data/predictions.json --reference data/reference.json \
  --tolerance 0.5 --out data/evaluation.json
```

两份输入都显式包含 `events` 数组。事件格式为 `{"id":"e1","source_id":"s1","time_s":12.34,"player_id":"L2","outcome":"made"}`。`time_s` 必须是核验过的球离手时间，不用回看窗口中点代替。

reference还必须包含 `exhaustive:true` 和 `reviewed_windows:[{"source_id":"s1","start":0,"end":30}]`；窗口按左闭右开处理，事件必须位于声明范围。真正负样本用显式空events。示例0.5秒是可配置匹配容差，不是已验证时间精度，应在评测前固定。

算法按同源、时间容差做最大数量的一对一匹配，不用球员/结果标签干预匹配；重复预测多出来的计FP。未审核范围的预测单独排除。分别给出出手precision/recall/F1、匹配事件身份准确率、已知结果准确率、拒答数、只在有回答时的准确率及匹配证据。

结果和身份准确率只覆盖匹配上的事件，不包含漏掉出手；不得当整体视频准确率。多种可能匹配会报告歧义数量，算法不保证最小总时间误差。工具不自行证明标签独立性或盲测地位；两段实拍已用于开发，不再作为新盲测。

当前只有9条待确认候选、4个待确认身份、0秒人类连续复核声明，没有直接拿它们计算识别准确率，也没有部署新训练模型。

## 验证

`test_player_workbench.py` 13项：鉴权、明确查看、版本冲突、未知结果分母、改错历史、身份撤回、重复出手、无归属事件、范围合并/撤回、媒体变化、Range回放、幂等准备等。

`test_shot_evaluation.py` 11项：一对一、非贪心最大匹配、拒答、身份分离、未知/负样本范围、漏报、无效时间与重复ID、显式空数组等。全部使用临时或合成数据，不替用户投真实票。CI和check-local均已纳入。

## 新会话配置格式（纯合成示意）

本地seed JSON包含sources（已有intake来源ID数组）、players（id/name/cue）、events（id/source_id/player_id/start/end/kind/action/note），可选assistant_observations。比如source-a、athlete-1和event-1等ID均由该会话指定。先用intake_video.py登记实际原片，再准备本地seed，使用 `prepare_player_session.py --seed /本地路径/session.local.json --db data/library/session.db` 导入。候选和人物观察不作为源码公开发布；测试完全使用合成会话。
