/**
 * 球队页屏 08 · 对手详情（侦察手册）
 *
 * 四个 tab：使用阵型 / 球队数据 / 重点球员 / 对手战术板
 *
 * 关键约束（球队页设计 v0.2）：
 *   1. 顶部要有赛制口径切换，四个 tab 的数据都跟着口径走
 *   2. Tab 3 底部**必须常驻免责提示**：
 *      "对手球员数据来自我校与其交手的比赛，非对手真实全量数据"
 *      —— 诚实让产品更可信，避免教练误以为我们能拿到对手训练数据
 *   3. 对手战术板由教练从比赛录像里剪辑并命名，与球队战术板
 *      **共用同一个编辑器**，只是归属对象不同（工程上只做一次）
 *   4. 空档案要有友好空状态："还没有与 XX 的交手记录，去录一场吧"
 *
 * 数据来源：
 *   · 使用阵型 —— AI 从交手比赛聚合（自动）
 *   · 球队数据 —— AI 从交手比赛聚合（自动）
 *   · 重点球员 —— 教练手动标记 + 交手数据自动填充
 *   · 对手战术板 —— 教练手动剪辑命名（后期 AI 自动提取）
 */

const api = require('../../utils/api');
const { num, pct, rate, shortDate, clockTime } = require('../../utils/format');
const { FORMAT_LABEL, AGE_GROUP_LABEL } = require('../../utils/params');

const TABS = [
  { key: 'formation', label: '阵型' },
  { key: 'stats', label: '数据' },
  { key: 'players', label: '球员' },
  { key: 'tactics', label: '战术' },
];

const THREAT_META = {
  high: { label: '高威胁', tone: 'err' },
  mid: { label: '中威胁', tone: 'warn' },
  low: { label: '普通', tone: 'muted' },
};

Page({
  data: {
    opponentId: '',
    loading: true,
    notFound: false,

    opponent: null,
    tabs: TABS,
    activeTab: 'formation',

    // 赛制口径
    scopes: [],
    activeScope: null,
    scopeText: '',

    // Tab 1 阵型
    formations: [],
    offensePreference: '',
    defensePreference: '',

    // Tab 2 数据
    stats: null,
    statsNote: '',

    // Tab 3 重点球员
    keyPlayers: [],
    disclaimer: '对手球员数据来自我校与其交手的比赛，非对手真实全量数据',

    // Tab 4 战术板
    tactics: [],

    // 交手记录
    headToHead: [],
    totalPlayed: 0,
    hasAnyData: false,
  },

  async onLoad(query) {
    const opponentId = (query && query.id) || '';
    const tab = (query && query.tab) || 'formation';
    this.setData({ opponentId, activeTab: tab });
    await this.load();
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    const { opponentId } = this.data;
    if (!opponentId) { this.setData({ loading: false, notFound: true }); return; }

    this.setData({ loading: true });

    let opponent = null;
    let h2h = { games: [], byScope: [] };
    try {
      opponent = await api.getOpponent(opponentId);
      h2h = await api.getOpponentHeadToHead(opponentId);
    } catch (e) {
      this.setData({ loading: false, notFound: true });
      return;
    }

    if (!opponent) { this.setData({ loading: false, notFound: true }); return; }

    wx.setNavigationBarTitle({ title: opponent.name });

    // 口径来自真实交手记录；没有交手记录时回退到 mock 的 headToHead
    let scopes = (h2h.byScope || []).map((s) => ({
      format: s.format,
      ageGroup: s.ageGroup,
      label: `${FORMAT_LABEL[s.format] || s.format} ${s.played} 场`,
      played: s.played,
      wins: s.wins,
      losses: s.losses,
    }));

    if (!scopes.length && opponent.headToHead) {
      scopes = opponent.headToHead.map((h) => ({
        format: h.format,
        ageGroup: h.ageGroup,
        label: `${FORMAT_LABEL[h.format] || h.format} ${h.played} 场`,
        played: h.played,
        wins: h.wins,
        losses: h.losses,
      }));
    }

    const activeScope = scopes[0] || null;

    this.setData({
      loading: false,
      opponent,
      scopes,
      activeScope,
      scopeText: activeScope ? activeScope.label : '',
      headToHead: scopes,
      totalPlayed: scopes.reduce((s, x) => s + x.played, 0),
      hasAnyData: scopes.length > 0,
      formations: (opponent.formationUsage || []).map((f) => ({
        label: f.label,
        pct: f.pct,
        pctText: pct(f.pct),
        barWidth: Math.round(f.pct * 100),
      })),
      offensePreference: opponent.offensePreference || '',
      defensePreference: opponent.defensePreference || '',
      keyPlayers: (opponent.keyPlayers || []).map((p) => Object.assign({}, p, {
        threatLabel: (THREAT_META[p.threat] || THREAT_META.low).label,
        threatTone: (THREAT_META[p.threat] || THREAT_META.low).tone,
        statsText: this._playerStatsText(p.stats),
      })),
      tactics: (opponent.tactics || []).map((t) => Object.assign({}, t, {
        durationText: clockTime(t.durationS || 0),
      })),
    });

    if (activeScope) this._applyScope(activeScope);
    else this._applyNoData();
  },

  _playerStatsText(stats) {
    if (!stats) return '';
    const bits = [];
    if (stats.ppg != null) bits.push(`场均 ${num(stats.ppg, 1)} 分`);
    if (stats.rpg != null) bits.push(`${num(stats.rpg, 1)} 篮板`);
    if (stats.apg != null) bits.push(`${num(stats.apg, 1)} 助攻`);
    if (stats.arcOutPct != null) bits.push(`弧外 ${pct(stats.arcOutPct)}`);
    if (stats.secondChanceShare != null) bits.push(`二次进攻占 ${pct(stats.secondChanceShare)}`);
    return bits.join(' · ');
  },

  async _applyScope(scope) {
    // 球队数据来自该口径下的交手比赛聚合
    let stats = null;
    try {
      const all = await api.getTeamStats();
      const games = all.allGames || [];
      // 这里取"与该对手交手且属于该口径"的场次
      const h2h = await api.getOpponentHeadToHead(this.data.opponentId);
      const ids = (h2h.games || [])
        .filter((g) => g.format === scope.format)
        .map((g) => `${g.playedAt}|${g.pointsFor}`);

      const matched = games.filter((g) =>
        ids.includes(`${g.playedAt}|${g.pointsFor}`)
      );

      if (matched.length) {
        const n = matched.length;
        const pf = matched.reduce((s, g) => s + g.pointsFor, 0);
        const pa = matched.reduce((s, g) => s + g.pointsAgainst, 0);
        stats = {
          games: n,
          ppg: num(pf / n, 1),
          ppgAgainst: num(pa / n, 1),
          wins: matched.filter((g) => g.won).length,
          losses: matched.filter((g) => !g.won).length,
        };
      }
    } catch (e) { stats = null; }

    this.setData({
      activeScope: scope,
      scopeText: scope.label,
      stats,
      statsNote: stats
        ? `与我校交手 ${stats.games} 场（${scope.label}）· 数据为我校视角`
        : '该口径下暂无可聚合的交手数据',
    });
  },

  _applyNoData() {
    this.setData({
      stats: null,
      statsNote: '还没有交手记录，录一场与该对手的比赛后数据会自动生成。',
    });
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key || 'formation' });
  },

  onTapScope(e) {
    const idx = e.currentTarget.dataset.index;
    const scope = this.data.scopes[idx];
    if (scope) this._applyScope(scope);
  },

  /** 对手战术板与球队战术板共用同一个编辑器，只是 owner 不同 */
  onNewOpponentTactic() {
    wx.navigateTo({
      url: `/pages/tactic-new/index?owner=OPPONENT&opponentId=${this.data.opponentId}`,
    });
  },

  onEditKeyPlayers() {
    wx.showToast({ title: '长按球员可编辑威胁等级与备注', icon: 'none' });
  },

  onLongPressPlayer(e) {
    const id = e.currentTarget.dataset.id;
    const p = this.data.keyPlayers.find((x) => x.id === id);
    if (!p) return;

    wx.showActionSheet({
      itemList: ['标记为高威胁', '标记为中威胁', '标记为普通', '编辑备注'],
      success: (res) => {
        const levels = ['high', 'mid', 'low'];
        if (res.tapIndex < 3) {
          const level = levels[res.tapIndex];
          const keyPlayers = this.data.keyPlayers.map((x) =>
            (x.id === id ? Object.assign({}, x, {
              threat: level,
              threatLabel: THREAT_META[level].label,
              threatTone: THREAT_META[level].tone,
            }) : x)
          );
          this.setData({ keyPlayers });
          wx.showToast({ title: '已更新威胁等级', icon: 'success' });
        } else {
          this._editNote(id, p);
        }
      },
    });
  },

  _editNote(id, p) {
    wx.showModal({
      title: `备注 · ${p.number} 号 ${p.name}`,
      editable: true,
      placeholderText: p.note || '如：挡拆后第一选择是外弹三分',
      success: (res) => {
        if (!res.confirm) return;
        const keyPlayers = this.data.keyPlayers.map((x) =>
          (x.id === id ? Object.assign({}, x, { note: (res.content || '').trim() }) : x)
        );
        this.setData({ keyPlayers });
      },
    });
  },

  onAddKeyPlayer() {
    wx.showModal({
      title: '添加重点球员',
      editable: true,
      placeholderText: '号码 姓名，如：10 赵XX',
      success: (res) => {
        if (!res.confirm) return;
        const text = (res.content || '').trim();
        if (!text) return;
        const parts = text.split(/\s+/);
        const keyPlayers = this.data.keyPlayers.concat([{
          id: `kp_local_${Date.now()}`,
          number: Number(parts[0]) || 0,
          name: parts.slice(1).join('') || text,
          position: '',
          threat: 'mid',
          threatLabel: THREAT_META.mid.label,
          threatTone: THREAT_META.mid.tone,
          traits: '',
          note: '',
          statsText: '',
        }]);
        this.setData({ keyPlayers });
        wx.showToast({ title: '已添加（本地）', icon: 'success' });
      },
    });
  },

  onTapTactic(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.data.tactics.find((x) => x.id === id);
    if (!t) return;
    wx.showModal({
      title: t.name,
      content: `来源：${t.source || '交手比赛'}\n时间：${t.at || '—'}\n时长：${t.durationText}`,
      showCancel: false,
    });
  },

  onNewRecording() {
    wx.navigateTo({ url: '/pages/activity-new/index' });
  },

  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/team/index' }) }); },
});
