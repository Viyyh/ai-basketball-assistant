# 篮球战术参考索引（2026-11-04）

本轮新增6个一级来源索引、14个主题定位。来源数不等于已下载视频数；视频目录与手册章节也不当成14个独立视频片段。未下载、未逐段观看、未产生训练真值。WABC两个视频目录搜索索引可见，直接读取返回403，已保留状态，不绕过访问限制。

|主题|章节|标注提示|
|---|---|---|
|传切|wabc-l1 2.1.1|传球后切入；回传和终结结果分别标注。|
|进攻空间|wabc-l1 2.1.1–2.1.3|记录站位与移动时机；不从单帧认定好坏。|
|切入后补位|wabc-l1 2.1.2|记录切入者和补位者连续路径。|
|转移球|wabc-l1 2.1.4|记录出球者、接球者和方向，区分成功与未知。|
|突破与接应|wabc-l1 2.1.5|突破、接应位置和分球作为关联事件。|
|无球掩护|wabc-l1 2.2.1–2.2.5|至少记录掩护者、使用者和相关防守者。|
|卷切|wabc-l1 2.2.3|用连续路径确认绕掩护向内切入。|
|反跑切入|wabc-l1 2.2.4|记录切入方向和防守者位置，不靠标题判定。|
|外弹切出|wabc-l1 2.2.5|区分向外切出与普通走位。|
|掩护后外弹|wabc-l1 2.2.6|先确认掩护，再确认后续外弹。|
|持球掩护选择|wabc-l1 2.2.10|掩护动作与持球者后续决策分开。|
|攻防转换|wabc-l1 2.3|记录转换起点、推进、传球与落位。|
|手递手配合|wabc-l2 2.1.1|交接球和跑动关系一起核验。|
|中路挡拆|wabc-l2 2.2.1|掩护、持球推进与顺下分别标注并关联。|

## 一级来源
- [FIBA/WABC一级教练手册](https://assets.fiba.basketball/image/upload/documents-corporate-wabc-coaching-level-manuals-level-1-eng.pdf)：search_index_inspected。
- [FIBA/WABC二级教练手册](https://assets.fiba.basketball/image/upload/documents-corporate-wabc-coaching-manual-level-2-eng.pdf)：search_index_inspected。
- [WABC官方教学视频目录](https://about.fiba.basketball/en/wabc-videos)：search_index_inspected_direct_fetch_403。
- [WABC教练发展视频系列](https://about.fiba.basketball/en/wabc-coaching-development-project)：search_index_inspected_direct_fetch_403。
- [FineSports官方仓库](https://github.com/PKU-ICST-MIPL/FineSports_CVPR2024)：repository_page_inspected。
- [BASKET官方仓库](https://github.com/yulupan00/BASKET)：repository_page_inspected。

## 当前真正的缺口

不是网络讲解太少，而是已经核验、能与实际视频时间和参与者对应的标签不足。现有检测器主要输出目标框；无球跑动、传接球和战术关系需要连续轨迹与时序模型。不断增加视频而不补关系标签，不能自动解决这个问题。

优先顺序：传接球 → 无球切入 → 掩护与挡拆。每类同时收正例、相似但非该动作的反例、失败配合、遮挡未知；按来源会话分组，独立复核后再训练。公共研究数据集可用于预训练/方法对照，仍需核对任务定义、获取条件与来源用途，不能默认等同于大众手机实拍。

后续获取阶段须单独登记实际文件哈希、时长、获取状态、允许用途、视频起止、参与者与复核决定。当前索引不增加training_ready数量，不改人审数据库，不表示模型性能已经提高。
