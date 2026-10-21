# F 轨（小程序前端）交付说明

| 项 | 内容 |
|---|---|
| **角色** | F —— 小程序前端 |
| **版本** | v1.0 |
| **日期** | 2026-10-15 |
| **依据** | `docs/PRD.md` v1.0 · `docs/开发计划.md` v1.0 |
| **状态** | Phase 0 / Phase 1 / Phase 2 / Phase 4 的 F 轨任务已完成，全部自检通过 |

---

## 一、怎么跑起来

### 1.1 一键校验（提交前必须全绿）

```bash
cd basketball-ai
node scripts/verify.js
```

四步串行，任一步失败即非零退出：

```
✓ 生成基准数据          Python 参数层 → tests/fixtures/params-conformance.json
✓ Python 参数层（37 项）  PRD 9.1 的 16 条验收
✓ JS 测试（995 项）      含跨语言一致性、上传、补录、口径守卫、Mock 忠实度、SVG
✓ 静态完整性检查         504 项：文件齐全 / 引用可解析 / 事件绑定存在 / 无硬编码几何
```

### 1.2 单独跑各部分

```bash
cd miniprogram
npm test                        # 全部 JS 测试（node --test 自动发现）
npm run test:conformance        # 只跑跨语言一致性（824 项）
npm run static                  # 只跑静态完整性检查

cd packages/params
py -m unittest discover -s tests -v    # Python 参数层
```

### 1.3 环境

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20（本次用 v24.20.0） | 自带 `node:test`，**无需安装任何 npm 依赖** |
| Python | ≥ 3.10（本次用 3.13） | 参数层只依赖标准库 |
| npm 依赖 | **零** | `dependencies` 与 `devDependencies` 都是空的 |

> 零依赖是有意为之：F 轨的核心逻辑（几何、分片、补录状态机、口径守卫）全部用标准库实现，
> 因此可以在任何机器上立刻跑测试，也避免了小程序端引入构建链。

### 1.4 在微信开发者工具里打开

`project.config.json` 的 `appid` 是占位值 `TO_BE_FILLED_P0_04`，
需要填入 P0-04 申请到的小程序 AppID 后才能真机预览。
`miniprogramRoot` 即 `miniprogram/` 目录。

---

## 二、交付清单

### 2.1 对应开发计划的 F 轨任务

| 任务 ID | 内容 | 状态 |
|---|---|---|
| **P0-06** | 报告 JSON 契约定稿并冻结 | ✅ `docs/contract/report-schema.json`，含三条硬规则与前端消费约束 |
| **P1-F01** | 设计系统落地 | ✅ `styles/variables.wxss`（PRD 3.5 状态色系）+ `styles/common.wxss` |
| **P1-F02** | 参数化球场 SVG 组件 | ✅ `components/court-svg/` + `utils/courtGeometry.js` + `utils/svgBuilder.js` |
| **P1-F03** | 片段播放器组件 | ✅ `components/clip-player/` |
| **P1-F04** | 选人浮层组件 | ✅ `components/player-picker/` |
| **P1-F05** | 状态标签组件 | ✅ `components/status-tag/` |
| **P1-F06** | 首页 / 新建活动 / 录制页 | ✅ 含年龄段赛制必填与 3对3 联动 |
| **P1-F07** | 上传中 / 处理中 | ✅ 分片 + 断点续传 + 后台存活；队列位置 + 六步 stepper + 停滞兜底 |
| **P1-F08** | 报告总览 | ✅ 口径常驻 + 告警条 + 标定阻断 + 3对3 降级 |
| **P2-F01** | 录制页真机联调 | ⚠️ 代码完成，**需真机验证**（camera 组件行为无法在 Node 下测） |
| **P2-F02** | 上传模块 | ✅ `utils/upload.js`，31 项测试覆盖 PRD 3.1~3.3 |
| **P2-F03** | 事件列表 + 补录浮层 | ✅ 14 条 checklist 见下方 2.3 |
| **P2-F04** | 报告 + 热图 + 阵型 | ✅ 三态热图、跑动热区默认折叠、阵型置信度门槛 |
| **P3-04** | 补录体验打磨 | ⚠️ 代码层已把路径压到 2 次点击，**PRD 3.10 的 ≤5 秒需真人实测** |
| **P4-F01** | 球队主页 | ✅ 默认参数标签 + 四色模块导航 + 待补录提醒 |
| **P4-F02** | 球队比赛数据 | ✅ **赛制口径筛选无「全部」选项** |
| **P4-F03** | 球员库 + 球员详情 | ✅ 空数据显示「—」不显示 0；投篮分布图口径标注 |
| **P4-F04** | 战术板 2 屏 | ✅ 含智能推荐候选（PRD P2-23）与点状动画占位卡 |
| **P4-F05** | 对手记录 2 屏 | ✅ 4 tab + 交手按赛制拆开 + 免责提示常驻 |
| **P4-F06** | 空状态与引导全覆盖 | ✅ `components/empty-state/` 内置 7 种场景 |

### 2.2 文件结构

```
basketball-ai/
├── docs/
│   ├── PRD.md                     开发依据
│   ├── 开发计划.md
│   └── contract/
│       └── report-schema.json     ★ 契约（冻结，改动需三方确认）
├── packages/params/               ★ 全系统唯一真源（从 poc/ 迁入并正式包化）
│   ├── pyproject.toml
│   ├── basketball_params/
│   │   ├── params.py              赛制与年龄段参数表 + resolve()
│   │   ├── court.py               场地几何 + judge()
│   │   ├── aggregate.py           聚合守卫
│   │   └── pipeline_contract.py   pipeline 五阶段契约 + 参数自检
│   └── tests/test_three_combos.py 37 项
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json / sitemap.json / package.json
│   ├── styles/                    variables.wxss + common.wxss
│   ├── utils/                     ★ 纯逻辑，全部可单测
│   │   ├── params.js              枚举与中文标签（不含判定常量）
│   │   ├── courtGeometry.js       球场几何 + judge()（与 Python 同源）
│   │   ├── svgBuilder.js          SVG 路径生成（底图/投篮点/热区/阵型）
│   │   ├── upload.js              分片计划 + 断点续传 + 滚动速率估算
│   │   ├── attribution.js         补录状态机
│   │   ├── scope.js               口径守卫（跨赛制聚合抛错）
│   │   ├── format.js              时间与数值格式化（缺失显示「—」）
│   │   └── api.js                 API 门面（USE_MOCK 开关切换）
│   ├── components/                7 个公用组件
│   │   ├── court-svg/             ★ 参数化球场底图
│   │   ├── clip-player/
│   │   ├── player-picker/
│   │   ├── status-tag/
│   │   ├── event-card/
│   │   ├── empty-state/
│   │   └── scope-badge/           口径标识（PRD 9.4 #4.8 常驻）
│   ├── pages/                     20 个页面
│   ├── mock/
│   │   ├── report.js              Mock 报告生成器（真实响应 params）
│   │   ├── paramsMirror.js        ⚠️ 仅限 mock/tests 引用
│   │   └── data.js                球队/名单/活动/对手/战术卡
│   └── tests/                     995 项
│       ├── conformance.test.js    ★ 跨语言一致性（824 项）
│       ├── upload.test.js         31 项
│       ├── attribution.test.js    40 项
│       ├── scope.test.js          29 项
│       ├── mock.test.js           32 项
│       ├── svgBuilder.test.js     39 项
│       └── fixtures/params-conformance.json
└── scripts/
    ├── gen_conformance_fixture.py 生成跨语言基准
    ├── static-check.js            静态完整性 + 架构约束扫描
    └── verify.js                  一键校验
```

### 2.3 补录 UI 的 14 条 checklist（开发计划 6.3）

| # | 要求 | 落地位置 | 状态 |
|---|---|---|---|
| 1 | 事件卡片流：缩略图+类型+时间戳+归属 | `components/event-card/` | ✅ |
| 2 | 未补录橙色左边线+底色 | `event-card/index.wxss` `.ev--pending` | ✅ |
| 3 | 顶部筛选：全部/未补录/三分(远投)/快攻/失误 | `attribution.filterDefs()` | ✅ 3x3 自动改文案并禁用快攻 |
| 4 | 点卡片→底部弹层，自动播放预览 | `pages/events/` + `clip-player` `autoplay` | ✅ |
| 5 | 出手位置元数据一行显示 | `pages/events/index.js` `_openSheet` | ✅ |
| 6 | 选人网格：首发顺序固定+记住上次选择 | `attribution.pickerOrder()` | ✅ `isLast` 标记 + "刚选"角标 |
| 7 | 含「不是我方」「看不清」 | `attribution.SPECIAL` | ✅ 两者都保持 `player_id = null` |
| 8 | **「保存·下一个→」一键跳转** | `attribution.nextPending()` 环形查找 | ✅ 2 次点击完成一个事件 |
| 9 | 跳过按钮 | `attribution.skip()` | ✅ 计入已处理但不计已归属 |
| 10 | 撤销（单步+连续） | `attribution.undo()/undoMany()` | ✅ 栈上限 200 |
| 11 | 选人即保存，无「保存失败」弹窗 | `pages/events/index.js` `_saveToBackend` | ✅ 失败静默入重传队列 |
| 12 | 断网/杀进程后重进完整保留 | `app.js saveAttribution` + debounce 落盘 | ✅ `onHide`/`onUnload` 强制 flush |
| 13 | 补录进度条实时反映 | `attribution.progress()` | ✅ 列表页与报告页共用 |
| 14 | **实测单个补录 ≤5 秒（PRD 3.10）** | — | ⚠️ **需真人内测**，代码层已压到 2 次点击 |

---

## 三、三个架构决定（需要 A / B 轨知晓）

### 3.1 前端不持有参数表

`utils/params.js` **只有**枚举中文标签、名单人数、默认节次时长、口径文案生成。
**没有**任何三分线半径、场地尺寸、进攻时限、计分值的判定常量。

那些数据一律从报告 JSON 的 `params` 段读取，而 `params` 由后端
`packages/params` 的 `resolve()` 产出（契约硬规则 #1）。

理由：如果前端也存一份半径表，就变成"前端一套、后端一套、AI 一套"三份真源，
正是 PRD 风险 7.4 的温床。

**唯一例外**是 `mock/paramsMirror.js`，它模拟后端产出契约形状的 `params`。
文件头有醒目警告：**只允许 `mock/` 与 `tests/` 引用，页面与组件不得 import**。
`tests/mock.test.js` 用 Python 生成的 fixture 对它做**逐字段比对**（8 组合 × 24 字段），
证明这份镜像与真源一致。修改 `packages/params` 后必须重新生成 fixture，否则比对失效。

### 3.2 三分线有两种几何，不能共用一套判定

这是 PoC 阶段发现、并在 F 轨落地的关键点：

| 几何 | 适用 | 判定 |
|---|---|---|
| `ARC_AND_CORNERS` | FIBA 成人 5v5（半径 6.75） | 弧线 + 底角直线段（横向 6.60）。**底角三分比弧顶三分更近** |
| `PURE_ARC` | FIBA 3x3（整条弧 6.75）；青少年小半径场地 | 仅判 `距离 ≥ 半径` |

青少年半径 5.80 < 底角横向 6.60，弧线永远碰不到底角直线的位置，
**几何上必须退化为纯弧线**。若强行套用成人几何，会产生
"底角直线段落在弧线内侧"的矛盾配置 —— 判定给出错误结果且**不报错**。

`court-svg` 组件的 `_validate()` 会拦住这种配置并拒绝渲染（宁可不出图，
也不画一张几何错误的场地图糊弄教练），同时 `triggerEvent('invalid')`。

### 3.3 `judge()` 在前端存在，但不得用于显示

`utils/courtGeometry.js` 的 `judge()` 与 Python 的 `CourtGeometry.judge()` 同源，
但契约硬规则 #2 规定：**界面上的分值文案必须直接取 `event.label_zh` 与
`event.shot_value`**（后端产出）。

前端 `judge()` 的合法用途只有两个，都写在文件头注释里：
1. `mock/report.js` 模拟后端产出契约字段（此时它就"是"后端）
2. `tests/` 里验证前端几何理解与 Python 一致

一致性测试（824 项）保证：**JS 画的三分线位置与 Python 判的分值同源**。
如果两者分歧，教练会看到"球画在弧线内、却标成三分"—— PRD 风险 7.4 的界面版。

---

## 四、静态检查额外守住的三条架构约束

`scripts/static-check.js` 除了常规的文件完整性，还扫三条架构红线：

1. **页面与组件不得出现硬编码几何**（`6.75`、`28×15` 等）
   → 已抓到并修掉两处 `params.three_point_radius_m || 6.75` 兜底。
   这类兜底最阴险：参数缺失时悄悄用成人半径，报告看起来完全正常。
   现在改为**拒绝计算 + 明确提示**（`_threePointRadius()` 返回 null，分区统计显示「—」）。

2. **不得给 `player_id` 赋猜测值**（契约硬规则 #3）
   白名单只有 `attribution.js`（教练补录）与 `utils/api.js` 的
   `mergeLocalAttribution`（合并数据库补录结果，即 PRD 数据流关键点 3）。

3. **wxml 里绑定的处理函数必须在 js 中存在**
   小程序不会在编译期报这类错，只会在真机上点了没反应。

---

## 五、已知未完成项（诚实清单）

F 轨代码层完成，但以下**必须在真机与联调阶段验证**，Node 环境下测不了：

| 项 | 为什么测不了 | 验收依据 |
|---|---|---|
| `camera` 组件真机行为 | 需要真实摄像头 | PRD 9.3 #3.13、9.4 #4.10 |
| 后台上传存活 ≥10 分钟 | 需要真机 + 微信运行时 | PRD 9.3 #3.3 |
| 断点续传真实网络表现 | Mock 分支用定时器模拟分片 | PRD 9.3 #3.2 |
| 片段起播 ≤1.5 秒 | 需要真实 CDN | PRD 9.3 #3.9 |
| 报告首屏 ≤3 秒（4G） | 需要真机测速 | PRD 9.3 #3.8 |
| **单个补录 ≤5 秒** | 需真人操作计时 | PRD 9.3 #3.10 |
| 订阅消息下发 | 需要真实模板 ID（P0-04） | PRD 9.4 #4.10 |
| SVG data URI 在真机的渲染性能 | 开发者工具与真机表现可能不同 | — |

另外两项**依赖 B 轨**：

- `utils/api.js` 的 `USE_MOCK = false` 分支只写了调用签名，
  真实端点路径需与 B 轨对齐后填 `setConfig({ apiBase, cdnBase })`
- `wx.uploadFile` 的分片上传在 Mock 下走定时器；接 COS SDK 时
  `_uploadChunk()` 需要替换为 SDK 的分片接口，但**会话状态机不用改**

---

## 六、给 A / B 轨的接口约定

### 6.1 B 轨需要提供的端点

`utils/api.js` 已按这些签名调用，路径可协商但**响应结构必须符合契约**：

```
GET  /teams/current
GET  /roster
GET  /activities?template=&format=&status=&opponentId=
GET  /activities/:id
POST /activities                          ← 必须服务端再校验年龄段与赛制必填
GET  /activities/:id/upload-credential    ← STS 临时凭证
GET  /activities/:id/process-status       ← {status, queueAhead, etaMinutes, currentStep, steps}
GET  /activities/:id/report               ← 契约 report-schema.json
PUT  /activities/:id/events/:eid/attribution
GET  /tactics / POST /tactics
GET  /opponents / GET /opponents/:id
```

### 6.2 A 轨产出报告的三条硬规则

见 `docs/contract/report-schema.json` 的 `x-hard-rules`：

1. `params` 段由 `resolve()` 产出，pipeline 只透传
2. `shot_value` 与 `label_zh` 由 `CourtGeometry.judge()` 产出，pipeline 不得自行判断几何
3. `player_id` 恒为 `null`，归属由教练补录写入

前端已按这三条实现，并有测试守住。**A 轨若违反，前端会显示错乱但不会报错**，
所以请在 pipeline 侧也加断言。

### 6.3 Mock 的切换点

`miniprogram/utils/api.js` 顶部：

```js
const USE_MOCK = true;   // B 轨就绪后改为 false
```

改为 `false` 后所有方法自动走 `wx.request` 分支，**页面代码一行都不用改**。
这是开发计划第十三节"Mock 与真实实现可开关切换"的落地。

---

## 七、下一步

按开发计划，F 轨接下来的工作依赖两个外部条件：

1. **P0-04 小程序 AppID** → 才能真机预览与验证 camera / 后台上传 / 订阅消息
2. **B 轨的 COS 凭证接口** → 才能把 `_uploadChunk()` 从定时器换成真实分片上传

在此之前 F 轨可以独立推进的：

- 用微信开发者工具做一轮视觉走查（20 屏 × 3 种参数组合 = 60 个状态）
- 补 `pages/report` 的时间轴双指缩放（PRD 3.4 交互模式，当前只有点击跳节次）
- 补录批量归属（checklist 之外的第二版能力，入口已留 `onBatchAttribute`）

---

**文档结束**
