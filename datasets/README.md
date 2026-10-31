# 标注集 v0.1

这是正式版本管理的种子标注集，不是足够训练或独立验收的数据集。媒体保存在 Git 忽略的 data/；这里只保存元数据和人工标注。

## 当前数量与质量

- 2 个来源，均为已用于调试的 NBA 转播，全部归 development。
- 9 个官方出手结果及人工核对的粗视频区间；出手帧尚未精确标注。
- 3 张人工近似球框图，非穷尽框选，不把未标注对象当作背景。
- 0 个独立验收来源，0 张训练可用的穷尽标注图。
- 新篮筐穿越模块在现有模型输出上生成 G1 4 个、G3 1 个候选；未审核，保存在 data/final 对应目录，不进入人工标签。

## 审核规范

篮球框只画实际可见部分；遮挡、运动模糊无法可靠定位时标记待复核，不补造球框。篮筐框统一覆盖篮圈，不混入整个篮板或网。逐帧训练标签须穷尽标记目标类别并复核，不能只标出容易看到的球。

事件标记应包含准备、离手、接近篮圈和结果证据；精确出手时间取球与手分离的首个可辨帧。看不清结果取 unknown。传球、上篮、扣篮、捡球、无投篮片段应单独覆盖；回放标记重复，不计新事件。

proposed → reviewed / rejected；粗区间使用 reviewed_coarse，近似不完整球框使用 reviewed_approximate。这两类不能自动升级成训练标签。

同一视频、用户、拍摄会话的相关片段应共用 group_id。先按来源与会话划分 train/val/test，再抽帧去重；开发过的测试来源不可重新宣称盲测。每个来源独立记录可用范围。

## 命令

```sh
python3 scripts/dataset.py
python3 scripts/test_dataset.py
python3 scripts/dataset.py --export-labels data/yolo-labels
```

最后一条当前会明确拒绝导出：没有满足来源可训练、train/val 划分、reviewed 且 exhaustive=true 的样本。它只导出标签，不自动复制媒体或启动训练。

候选事件可独立重算：

```sh
python3 scripts/extract_candidates.py data/final/game1-basketball/analysis.json --out data/final/game1-basketball/event-candidates.json
```

该规则参考公开项目的几何/时序思路，从头实现；未复制第三方源码。篮筐穿越不等于出手或命中，不能以候选数量计算命中率。算法目前未经独立视频验收。

后续用户素材、战术、素材库审核及外部数据分支已分别放入 user-videos/、tactics/、library/、public/。本页上方是最初种子集的说明，当前全局状态以 docs/STATUS.md 与根目录 README 为准。
