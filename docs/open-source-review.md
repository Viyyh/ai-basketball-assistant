# 面向大众训练的开源方案调研

检查日期：2026-10-31。以下为上游代码/文档检查，不是本仓库已复现的准确率。

|项目|参考价值|边界与接入决定|
|---|---|---|
|[NathanielRecto/Basketball-Shot-Tracker](https://github.com/NathanielRecto/Basketball-Shot-Tracker)|固定手机机位训练、球/篮筐检测、轨迹到投篮/命中、人工标签和开发/测试分离|最接近个人训练；优先核对其测试视频清单、模型来源与接口。上游 AGPL-3.0，代码和权重/素材条件需分开记录，暂未复制代码或下载视频。作者成绩不能当成本仓库成绩。|
|[avishah3/AI-Basketball-Shot-Detection-Tracker](https://github.com/avishah3/AI-Basketball-Shot-Detection-Tracker)|简单的球/篮筐检测与上、下区域状态；可作为容易解释的对照基线|已读 shot_detector.py：维护球/篮筐轨迹及 up/down 状态，不是跨机位泛化证明；入口固定模型和视频，不直接作为产品后端。|
|[nttcom/WASB-SBDT](https://github.com/nttcom/WASB-SBDT)|运动球检测/跟踪研究基线，官方预训练评估代码|公开仓库显示 MIT；优先做离线对照，先检查篮球权重、预处理及 CPU 成本，不整套替换现有 pipeline。|
|[Roboflow Basketball AI notebook](https://github.com/roboflow/notebooks/blob/main/notebooks/basketball-ai-how-to-detect-track-and-identify-basketball-players.ipynb)|检测、跟踪、球队与号码识别流程|更偏比赛分析；作者博客报告 SAM2 为主要瓶颈，T4 约 1–2FPS。个人投篮训练初期不接入号码与球队模块。|

## 结论

产品主线应从 NBA 比赛跟踪转向固定手机机位的个人投篮训练。固定机位是首版支持条件，不代表要求固定球队或固定场地。每次视频可以自动检测/重新校准篮筐位置；移动机位作为独立难度分组验收。

优先复用已有预训练检测器、跟踪器和成熟评估格式，补一层独立的投篮事件接口：候选出手、结果（命中/未中/不确定）、证据区间、失败原因。检测器输出与事件规则解耦。先用同一批视频比较，再决定替换哪些组件。

## 素材策略

YouTube/Bilibili 作为发现渠道，优先作者明确开放的原视频、CC 素材、数据集官方提供的媒体。公开视频链接不是可训练或可再分发的自动证明；记录作者、原链接、声明、用途和获取方式。代码许可不自动涵盖演示视频。访问受限、需要同意条款或用途不清楚的条目记录状态，不绕过限制。

来源目录为 benchmarks/public/sources.json。UVY 清单已下载；BASKET 有访问条款；BasketHAR 当前可见文件树没有视频文件。均不计作已完成的新视频标注。

新素材先按来源/用户/场地分组，去重后再分开发与验收集；标注前不看待评估模型的答案。模型预标注进入单独审核队列，审核完才提升为人工确认标签。保留“无法判断”，不强行填入命中结果。
