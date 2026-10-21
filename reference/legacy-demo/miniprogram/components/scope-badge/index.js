/**
 * scope-badge —— 口径标识（PRD 9.4 #4.8：必须常驻）
 *
 * 报告页、球队比赛数据页、球员详情投篮分布图都要显示。
 *
 * 为什么这个小组件值得单独抽出来：
 *   PRD 风险 7.4 说参数取错会产生"看起来正常但全错"的数据。
 *   教练无法从数字本身察觉，唯一的自救手段是**能一眼核对当前口径**。
 *   所以口径标识必须常驻、必须显眼、必须全站一致。
 *
 * 数据来源：契约 params 段（format / age_group / court_type / three_point_radius_m）。
 * 本组件不查任何本地参数表，只渲染传入的 params。
 */

const { scopeLabelFromParams, FORMAT, COURT_TYPE_LABEL } = require('../../utils/params');

Component({
  properties: {
    /** 契约里的 params 段 */
    params: { type: Object, value: null },
    /** 场次数，用于"基于 N 场" */
    games: { type: Number, value: null },
    /** 已完成补录的场次，用于"基于 N/M 场"（PRD P2-25） */
    completeGames: { type: Number, value: null },
    /** 是否显示三分线半径（调试与教练核对用） */
    showRadius: { type: Boolean, value: false },
    /** 是否显示场地类型 */
    showCourt: { type: Boolean, value: true },
    /** 紧凑模式（用在图表角标） */
    compact: { type: Boolean, value: false },
  },

  data: {
    text: '',
    radiusText: '',
    courtText: '',
    is3v3: false,
    completenessText: '',
    incomplete: false,
  },

  observers: {
    'params, games, completeGames': function observe() { this._resolve(); },
  },

  lifetimes: { attached() { this._resolve(); } },

  methods: {
    _resolve() {
      const p = this.data.params;
      if (!p) {
        this.setData({ text: '', radiusText: '', courtText: '', completenessText: '' });
        return;
      }

      const text = scopeLabelFromParams(p, this.data.games);

      // 数据完整度标注（PRD P2-25）
      let completenessText = '';
      let incomplete = false;
      const total = this.data.games;
      const done = this.data.completeGames;
      if (total != null && done != null && done < total) {
        completenessText = `基于 ${done}/${total} 场 · ${total - done} 场待补录`;
        incomplete = true;
      }

      this.setData({
        text,
        is3v3: p.format === FORMAT.THREE_V_THREE,
        radiusText: p.three_point_radius_m ? `三分线 ${p.three_point_radius_m} m` : '',
        courtText: this.data.showCourt && p.court_type
          ? COURT_TYPE_LABEL[p.court_type] || p.court_type
          : '',
        completenessText,
        incomplete,
      });
    },
  },
});
