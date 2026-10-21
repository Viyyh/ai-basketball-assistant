/**
 * event-card —— 事件卡片（服务于 P2-F03 事件列表）
 *
 * 界面设计 v0.1.1 屏 07：
 *   · 缩略图 + 类型 + 时间戳 + 已归属球员（或"未补录"）
 *   · 未补录卡片橙色左边线 + 底色，一眼可见
 *
 * ⚠️ 分值文案一律用后端给的 label_zh（契约硬规则 #2）。
 *    本组件不做任何"这球值几分"的推断。
 *    player_id 为 null 时显示「—」，不显示 0 或空字符串（PRD 3.6）。
 */

const { UNATTRIBUTED_PLACEHOLDER, SOURCE } = require('../../utils/attribution');

/** 事件类型的图标与中文 */
const KIND_META = {
  SHOT: { icon: '🏀', label: '投篮' },
  TURNOVER: { icon: '⚠', label: '失误' },
  FAST_BREAK: { icon: '⚡', label: '快攻' },
  REBOUND: { icon: '↕', label: '篮板' },
  OTHER: { icon: '·', label: '其他' },
};

Component({
  properties: {
    /** 契约里的单个 event */
    event: { type: Object, value: null },
    /** 已解析好的显示名（由页面层用 attribution.displayName 算好传入） */
    playerName: { type: String, value: '' },
    /** 时间戳展示文本，如 "Q1 08:12" */
    timeText: { type: String, value: '' },
    /** 缩略图地址 */
    thumb: { type: String, value: '' },
  },

  data: {
    kindIcon: '·',
    kindLabel: '事件',
    titleText: '',
    metaText: '',
    resolved: false,
    display: UNATTRIBUTED_PLACEHOLDER,
    isUnknown: false,
    isNotOurTeam: false,
    made: null,
  },

  observers: {
    'event, playerName': function observe() { this._resolve(); },
  },

  lifetimes: { attached() { this._resolve(); } },

  methods: {
    _resolve() {
      const ev = this.data.event;
      if (!ev) return;

      const meta = KIND_META[ev.kind] || KIND_META.OTHER;

      // 标题：投篮类带命中与分值文案，其余用类型名
      let title = meta.label;
      if (ev.kind === 'SHOT') {
        // label_zh 来自后端 judge()，3x3 下是"远投(2分)"/"近投(1分)"
        const score = ev.label_zh || '';
        const result = ev.made == null ? '' : (ev.made ? '命中' : '未中');
        title = [score, result].filter(Boolean).join(' · ') || meta.label;
      } else if (ev.kind === 'FAST_BREAK') {
        title = '快攻回合';
      }

      // 元信息：出手位置与距离
      const bits = [];
      if (Number.isFinite(ev.distance_m)) bits.push(`距筐 ${ev.distance_m.toFixed(1)} m`);
      if (ev.in_bounds === false) bits.push('⚠ 坐标越界');
      if (Number.isFinite(ev.confidence) && ev.confidence < 0.6) bits.push('低置信度');

      // 归属显示
      const isUnknown = ev.attribution_source === SOURCE.UNKNOWN;
      const isNotOurTeam = ev.attribution_source === SOURCE.NOT_OUR_TEAM;
      let display = UNATTRIBUTED_PLACEHOLDER;
      if (isNotOurTeam) display = '不是我方';
      else if (!isUnknown && this.data.playerName) display = this.data.playerName;

      const resolved = !!ev.player_id || isUnknown || isNotOurTeam || !!ev.skipped;

      this.setData({
        kindIcon: meta.icon,
        kindLabel: meta.label,
        titleText: title,
        metaText: bits.join(' · '),
        resolved,
        display,
        isUnknown,
        isNotOurTeam,
        made: ev.made == null ? null : !!ev.made,
      });
    },

    onTap() {
      const ev = this.data.event;
      if (!ev) return;
      this.triggerEvent('openevent', { id: ev.id, event: ev });
    },
  },
});
