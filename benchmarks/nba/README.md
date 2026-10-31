# NBA 官方事件基准（首批局部窗口）

这是真实比赛的外部答案，不是模型输出，也不导入产品统计。当前共 9 次运动战出手：G1 第一节 06:38–05:41 共 5 次；G3 第一节 06:47–06:10 共 4 次。官方 PDF 第 9 页逐项核对；来源见各 JSON。尚未导入全场数据。

原视频 600 秒的记分牌经人工查看：G1 Q1 06:43 BOS 14 DAL 13；G3 Q1 06:50 BOS 7 DAL 15。该锚点仅帮助定位，不能跨暂停、回放和剪辑线性外推。每次事件的 video_seconds 仍为空，需要对视频逐项核对；官方时钟通常对应记账时点，不保证等于出手瞬间。

运行对比：

```sh
python3 scripts/evaluate_nba.py --truth benchmarks/nba/0042300401.json --predictions /tmp/model-events.json
```

预测格式：`{"game_id":"0042300401","events":[{"period":1,"clock":"06:38","team":"DAL","points":2,"made":true}]}`。只输入所选窗口的预测，罚球不在本基准范围。默认按相同节次、球队、时钟差不超过 2 秒生成候选，按时间差贪心进行一对一匹配；这是初步评分方法，密集事件时需要人工复核，不宣称全局最优。分值与命中在匹配后独立计分。未匹配事件计漏报，重复预测计额外预测。

当前 pipeline 只有检测/跟踪和 mock 事件，无真实事件预测器，故没有真实模型事件准确率。官方记录不能验证球框、身份跟踪或场地坐标；这些仍需单独的画面标注。下一步先完成这 9 次事件的视频位置和可见性标注，再实现并评估候选投篮检测。基准应只在评估阶段使用，不得作为模型预测回填。

## 已完成的粗定位

9 次事件均已补充 `video_window`，并导出短片到 data/validation/。video_seconds 继续保持空值：尚未确认精确出手帧。data/validation/index.html 可在浏览器中打开，逐个播放核对。

重新导出：`python3 scripts/prepare_nba_cases.py`。本地视频路径目前按用户提供的 Downloads 路径配置。

运行球候选检查：`YOLO_CONFIG_DIR=/tmp/Ultralytics python3 scripts/check_nba_cases.py`。结果位于 data/validation/ball-availability.json；使用 YOLO11m、CPU、1280 输入、0.15 阈值、约 5fps。这里只记录有球候选的帧比例和多候选数量，尚未人工逐框核对，不能当成球召回率、投篮识别率或命中判断准确率。源短片为 960×540，上采样输入不恢复细节。
