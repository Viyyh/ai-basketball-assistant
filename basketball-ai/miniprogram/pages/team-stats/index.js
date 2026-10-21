/**
 * 球队页屏 02 · 球队比赛数据
 *
 * 球队页设计 v0.2 的核心约束：**赛制筛选不提供「全部」选项**。
 *
 *   5对5 的 8胜4负 和 3对3 的 3胜1负 合并成"11胜5负 · 胜率 69%"，
 *   这个数字在篮球意义上完全无效 —— 两种赛制的人数、场地、时限、
 *   计分口径都不同，胜率不可比。3对3 的"远投 2 分"和 5对5 的"三分"
 *   混在一起算命中率也是错的。
 *
 *   与其给一个看起来全面、实际错误的数字，不如强制教练选一个口径。
 *   这条约束在数据库查询层也有守卫（utils/scope.js 的 aggregateGuarded，
 *   对应后端 packages/params/aggregate.py），前端不能只靠筛选器。
 *
 * 其他要求：
 *   · 口径说明常驻："当前口径：5 对 5 · 15岁以下 · 12 场 | 另有 3 对 3 共 4 场"
 *   · 趋势图只画当前口径场次，跨赛制的点不能连成一条线
 *   · 聚合数据旁标注"基于 N/M 场"（PRD P2-25 诚实性问题）
 *   · 只有一种赛制时筛选条自动隐藏，但口径说明保留
 */

const api = require('../../utils/api');
const { num, pct, signedNum, rate, madeOverAttempt, shortDate } = require('../../utils/format');
const { FORMAT_LABEL } = require('../../utils/params');

const TIME_RANGES = [
  { key: 'SEASON', label: '本赛季' },
  { key: 'LAST10', label: '近 10 场' },
  { key: 'CUSTOM', label: '自定义' },
];

Page({
  data: {
    loading: true,
    loadError: '',

    // 口径
    scopes: [],
    activeScope: null,      // {format, ageGroup}
    scopeText: '',
    otherScopesText: '',
    showScopeFilter: false,  // 只有一种赛制时隐藏筛选条
    scopeLabel: '',

    // 时间范围
    timeRanges: TIME_RANGES,
    activeRange: 'SEASON',

    // 数据
    record: null,
    completeness: null,
    trend: [],
    trendPoints: '',
    metrics: [],
    deepEntries: [],
    games: [],
  },

  async onLoad() { await this.load(); },
  onShow() { if (!this.data.loading) this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true, loadError: '' });

    let stats = null;
    try { stats = await api.getTeamStats(); }
    catch (e) { this.setData({ loading: false, loadError: e.message || '加载失败' }); return; }

    if (!stats || !stats.scopes.length) {
      this.setData({ loading: false, scopes: [], activeScope: null, games: [] });
      return;
    }

    // 默认口径：场次最多的那个；并列时优先 5对5
    const activeScope = this.data.activeScope && stats.scopes.some(
      (s) => s.format === this.data.activeScope.format && s.ageGroup === this.data.activeScope.ageGroup
    ) ? this.data.activeScope : stats.defaultScope;

    this.setData({ loading: false, scopes: stats.scopes });
    this._stats = stats;
    this._applyScope(activeScope);
  },

  _applyScope(scope) {
    if (!scope || !this._stats) return;
    const key = `${scope.format}|${scope.ageGroup}`;
    const bucket = this._stats.byScope[key];
    if (!bucket) return;

    const s = bucket.stats;

    // 口径说明：当前口径 + 其他口径的场次提示
    const others = this._stats.scopes
      .filter((x) => `${x.format}|${x.ageGroup}` !== key)
      .map((x) => `${FORMAT_LABEL[x.format]} ${x.count} 场`);

    // 只有一种赛制时隐藏筛选条，但口径说明保留
    const showScopeFilter = this._stats.scopes.length > 1;

    this.setData({
      activeScope: scope,
      showScopeFilter,
      scopeLabel: s.label,
      otherScopesText: others.length ? `另有 ${others.join('、')}` : '',
      record: {
        wins: s.wins,
        losses: s.losses,
        winRate: s.winRate != null ? `${Math.round(s.winRate * 100)}%` : '—',
      },
      completeness: bucket.completeness,
      metrics: this._metrics(s),
      trend: this._trend(bucket.games),
      trendPoints: this._trendPoints(bucket.games),
      games: bucket.games.map((g) => ({
        id: g.id,
        dateText: shortDate(g.playedAt),
        won: g.won,
        scoreText: `${g.pointsFor}:${g.pointsAgainst}`,
        attributed: g.attributed,
      })),
      deepEntries: [
        { key: 'shots', icon: '🏀', label: '投篮分布', url: '' },
        { key: 'fastbreak', icon: '⚡', label: '快攻统计', url: '',
          disabled: scope.format === '3V3', reason: '3x3 第一版关闭快攻识别' },
        { key: 'turnover', icon: '📉', label: '失误分布', url: '' },
      ],
    });
  },

  _metrics(s) {
    return [
      { key: 'ppg', label: '场均得分', value: num(s.ppg, 1) },
      { key: 'ppgA', label: '场均失分', value: num(s.ppgAgainst, 1) },
      { key: 'net', label: '净胜分', value: signedNum(s.netPpg, 1) },
      { key: 'fg', label: '命中率', value: s.fgPct != null ? pct(s.fgPct, 1) : '—' },
      { key: 'arcOut', label: '弧外命中率', value: s.arcOutPct != null ? pct(s.arcOutPct, 1) : '—' },
      { key: 'games', label: '场次', value: num(s.games) },
    ];
  },

  /**
   * 得分趋势。
   *
   * ⚠️ 只画当前赛制口径下的场次，跨赛制的点不能连成一条线
   *   （球队页设计 v0.2 屏 02 注释）。
   *   第一版只做单线得分趋势 —— 多线图在数据完整度不够时会一团乱麻。
   */
  _trend(games) {
    const sorted = games.slice().sort((a, b) => (a.playedAt < b.playedAt ? -1 : 1));
    if (!sorted.length) return [];
    const vals = sorted.map((g) => g.pointsFor);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    return sorted.map((g, i) => ({
      id: g.id,
      dateText: shortDate(g.playedAt),
      value: g.pointsFor,
      // 归一化到 0-100 供折线绘制
      nx: sorted.length > 1 ? (i / (sorted.length - 1)) * 100 : 50,
      ny: 100 - ((g.pointsFor - min) / span) * 100,
    }));
  },

  /** 生成 SVG polyline 的 points 字符串 */
  _trendPoints(games) {
    const t = this._trend(games);
    if (t.length < 2) return '';
    return t.map((p) => `${(p.nx * 2.6).toFixed(1)},${(p.ny * 0.56 + 6).toFixed(1)}`).join(' ');
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapScope(e) {
    const { format, agegroup } = e.currentTarget.dataset;
    if (!format || !agegroup) return;
    this._applyScope({ format, ageGroup: agegroup });
  },

  onTapRange(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (key === 'CUSTOM') {
      wx.showToast({ title: '自定义时间范围第二版提供', icon: 'none' });
      return;
    }
    this.setData({ activeRange: key });
    // 近 10 场：截取当前口径下最近 10 场
    if (this._stats && this.data.activeScope) {
      const key2 = `${this.data.activeScope.format}|${this.data.activeScope.ageGroup}`;
      const bucket = this._stats.byScope[key2];
      if (bucket) {
        const games = bucket.games.slice()
          .sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1))
          .slice(0, key === 'LAST10' ? 10 : bucket.games.length);
        this.setData({
          games: games.map((g) => ({
            id: g.id, dateText: shortDate(g.playedAt), won: g.won,
            scoreText: `${g.pointsFor}:${g.pointsAgainst}`, attributed: g.attributed,
          })),
          trend: this._trend(games),
          trendPoints: this._trendPoints(games),
        });
      }
    }
  },

  onTapDeep(e) {
    const { disabled, reason, key } = e.currentTarget.dataset;
    if (disabled) { wx.showToast({ title: reason || '该赛制下暂不可用', icon: 'none' }); return; }
    // 深度数据页第一版复用热图与事件列表
    const aid = this.data.games.length ? this.data.games[0].id : '';
    if (key === 'shots' && aid) wx.navigateTo({ url: `/pages/heatmap/index?activityId=${aid}` });
    else wx.showToast({ title: '该维度需先补录完当前口径的全部场次', icon: 'none' });
  },

  onTapGame(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/report/index?activityId=${id}` });
  },

  onGoAttribution() {
    const g = this.data.games.find((x) => !x.attributed);
    if (g) wx.navigateTo({ url: `/pages/events/index?activityId=${g.id}&filter=PENDING` });
  },
});
