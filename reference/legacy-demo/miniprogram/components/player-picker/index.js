/**
 * player-picker —— 选人浮层（P1-F04，服务于 P2-F03 补录）
 *
 * 对应界面设计 v0.1.1 屏 07 的硬性要求：
 *   · 网格排序：首发按名单顺序在前，替补在后（不随机）
 *   · 记住上一次选的人，同人连续得分时高亮提示"刚刚是这个人"
 *   · 必须含「不是我方」与「看不清」两个特殊选项
 *     —— 没有"看不清"，教练会被迫乱选，脏数据比空数据更糟
 *   · 选人即保存，没有单独的保存确认步骤
 *
 * 排序与特殊选项的构造逻辑在 utils/attribution.js 的 pickerOrder()，
 * 本组件只负责渲染与事件回传，便于单测覆盖。
 */

const { SPECIAL } = require('../../utils/attribution');

Component({
  properties: {
    /** pickerOrder() 的输出：[{kind, id, number, name, position, isLast}] */
    items: { type: Array, value: [] },
    /** 当前已选中的 id（球员 id 或特殊值） */
    selected: { type: String, value: '' },
    /** 每行几个 */
    columns: { type: Number, value: 4 },
    /** 是否禁用（如片段还在加载） */
    disabled: { type: Boolean, value: false },
  },

  data: {
    gridStyle: '',
    SPECIAL_UNKNOWN: SPECIAL.UNKNOWN,
    SPECIAL_NOT_OUR_TEAM: SPECIAL.NOT_OUR_TEAM,
  },

  observers: {
    columns(v) {
      const cols = Math.max(2, Math.min(6, v || 4));
      this.setData({ gridStyle: `grid-template-columns:repeat(${cols},1fr);` });
    },
  },

  lifetimes: {
    attached() {
      const cols = Math.max(2, Math.min(6, this.data.columns || 4));
      this.setData({ gridStyle: `grid-template-columns:repeat(${cols},1fr);` });
    },
  },

  methods: {
    /**
     * 选人即保存。
     *
     * 点一下就 triggerEvent('pick')，由页面层直接写入并跳下一个事件。
     * 不做二次确认 —— PRD 3.12：补录全程不得出现需要用户点"确定"的打断。
     */
    onPick(e) {
      if (this.data.disabled) return;
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      this.triggerEvent('pick', { id });
    },
  },
});
