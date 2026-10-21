/**
 * 球队页屏 04 · 球员个人详情
 *
 * 这页的实际用途是「沟通工具」：教练拿着手机跟球员说
 * "你看你三分全在弧顶，底角一个没投过"。所以每个数字都要能追溯到具体片段。
 *
 * 球队页设计 v0.2 的四条赛制/年龄段约束：
 *   1. 投篮分布图必须标注当前口径（"5 对 5 · 12 场"）。
 *      3对3 的出手点全在半场，和 5对5 的全场分布放一起看会严重误导。
 *   2. **三分弧线半径随年龄段变化**。U15 用 5.80 m 画弧，一线用 6.75 m。
 *      如果底图按成人标准硬画，教练会看到"这球员三分线外一步就投了"的错误结论。
 *      → 弧线由 court-svg 组件按 params 渲染，本页不硬编码半径。
 *   3. 3对3 口径下"三分"改称"远投"，计分值是 2 分不是 3 分。
 *   4. 赛季场均数据按赛制分组，不合并成一个"场均得分"。
 *
 * 数据诚实性：篮板/助攻 AI 采不到 → null → 显示「—」，不编造。
 */

const api = require('../../utils/api');
const { num, pct, rate, madeOverAttempt, shortDate } = require('../../utils/format');
const { FORMAT, FORMAT_LABEL, AGE_GROUP_LABEL } = require('../../utils/params');

Page({
  data: {
    playerId: '',
    loading: true,
    notFound: false,

    player: null,

    // 口径：可能同时有 5对5 与 3对3 两组数据
    scopes: [],
    activeScope: null,
    scopeText: '',
    is3v3: false,
    arcOutsideLabel: '三分',

    // 赛季数据
    season: null,
    metrics: [],
    metricsNote: '',

    // 投篮分布
    shotParams: null,     // 传给 court-svg 的 params
    shotDots: [],
    shotSummary: null,
    zoneStats: [],

    // 趋势
    trend: [],
    trendPoints: '',

    // 逐场记录
    gameLog: [],
  },

  async onLoad(query) {
    const playerId = (query && query.id) || '';
    this.setData({ playerId });
    await this.load();
  },

  async load() {
    const { playerId } = this.data;
    if (!playerId) { this.setData({ loading: false, notFound: true }); return; }

    this.setData({ loading: true });

    const player = await api.getPlayer(playerId);
    if (!player) { this.setData({ loading: false, notFound: true }); return; }

    // 收集这名球员参与过的活动，按赛制分组
    const activities = await api.listActivities();
    const played = activities.filter(
      (a) => a.status === 'complete' || a.status === 'report_ready'
    );

    const scopeMap = new Map();
    played.forEach((a) => {
      const key = `${a.format}|${a.ageGroup}`;
      if (!scopeMap.has(key)) scopeMap.set(key, { format: a.format, ageGroup: a.ageGroup, activities: [] });
      scopeMap.get(key).activities.push(a);
    });

    const scopes = Array.from(scopeMap.values()).map((s) => ({
      format: s.format,
      ageGroup: s.ageGroup,
      count: s.activities.length,
      label: `${FORMAT_LABEL[s.format] || s.format} · ${AGE_GROUP_LABEL[s.ageGroup] || s.ageGroup} · ${s.activities.length} 场`,
    }));

    this.setData({ loading: false, player, scopes });

    if (scopes.length) this._applyScope(scopes[0]);
    else this._applyNoData();
  },

  _applyNoData() {
    this.setData({
      activeScope: null,
      scopeText: '',
      season: null,
      metrics: [],
      metricsNote: '还没有已完成补录的比赛，球员数据将在补录后自动汇总。',
      shotParams: null,
      shotDots: [],
      shotSummary: null,
      zoneStats: [],
      trend: [],
      trendPoints: '',
      gameLog: [],
    });
  },

  async _applyScope(scope) {
    const is3v3 = scope.format === FORMAT.THREE_V_THREE;

    // 逐场拉报告，取出该球员的出手点
    // ⚠️ 真实环境下这些应由后端聚合接口返回，前端不该逐场拉报告。
    //    Mock 阶段这样做是为了让"投篮分布按口径分组"这条逻辑真实跑起来。
    const activities = await api.listActivities();
    const inScope = activities.filter(
      (a) => a.format === scope.format && a.ageGroup === scope.ageGroup
        && (a.status === 'complete' || a.status === 'report_ready')
    );

    const dots = [];
    const gameLog = [];
    let made = 0;
    let att = 0;
    let arcOutMade = 0;
    let arcOutAtt = 0;
    let shotParams = null;

    for (const a of inScope) {
      let res = null;
      try { res = await api.getReport(a.id); } catch (e) { res = null; }
      if (!res || !res.report) continue;

      if (!shotParams) shotParams = res.report.params;

      const mine = (res.report.events || []).filter(
        (ev) => ev.kind === 'SHOT' && ev.player_id === this.data.playerId
      );

      let gMade = 0;
      mine.forEach((ev) => {
        att += 1;
        if (ev.made) { made += 1; gMade += 1; }
        if (ev.behind_three_point_line) {
          arcOutAtt += 1;
          if (ev.made) arcOutMade += 1;
        }
        if (ev.x_m != null) {
          dots.push({ id: ev.id, x_m: ev.x_m, y_m: ev.y_m, made: !!ev.made });
        }
      });

      gameLog.push({
        id: a.id,
        dateText: shortDate(a.playedAt),
        opponent: a.opponentName || a.name,
        shots: mine.length,
        made: gMade,
        // 分值口径随赛制变化：3x3 下弧外是 2 分
        points: mine.reduce((s, ev) => s + (ev.made ? (ev.shot_value || 0) : 0), 0),
      });
    }

    const ppg = gameLog.length ? Number((gameLog.reduce((s, g) => s + g.points, 0) / gameLog.length).toFixed(1)) : null;

    this.setData({
      activeScope: scope,
      scopeText: scope.label,
      is3v3,
      arcOutsideLabel: is3v3 ? '远投' : '三分',
      shotParams,
      shotDots: dots,
      shotSummary: {
        att, made,
        text: madeOverAttempt(made, att),
        rateText: rate(made, att),
        arcOutText: madeOverAttempt(arcOutMade, arcOutAtt),
        arcOutRate: rate(arcOutMade, arcOutAtt),
      },
      zoneStats: this._zoneStats(dots, shotParams),
      metrics: [
        { key: 'ppg', label: '场均得分', value: ppg != null ? num(ppg, 1) : '—' },
        // 篮板/助攻 AI 采不到 → null → 「—」，不编造
        { key: 'rpg', label: '篮板', value: '—', na: true },
        { key: 'apg', label: '助攻', value: '—', na: true },
        { key: 'fg', label: '命中率', value: att ? rate(made, att) : '—' },
      ],
      metricsNote: att
        ? `基于 ${gameLog.length} 场已补录数据 · 篮板助攻第一版不采集`
        : '该口径下还没有已补录的出手数据',
      trend: gameLog.slice().reverse(),
      trendPoints: this._trendPoints(gameLog.slice().reverse()),
      gameLog: gameLog.sort((a, b) => (a.dateText < b.dateText ? 1 : -1)),
    });
  },

  _trendPoints(log) {
    if (log.length < 2) return '';
    const vals = log.map((g) => g.points);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    return log.map((g, i) => {
      const nx = (i / (log.length - 1)) * 260 + 10;
      const ny = 62 - ((g.points - min) / span) * 46;
      return `${nx.toFixed(1)},${ny.toFixed(1)}`;
    }).join(' ');
  },

  /**
   * 分区统计。
   *
   * ⚠️ 弧线半径一律从 params 取，**不做 `|| 6.75` 兜底**（PRD 4.4）。
   *    参数缺失时返回空数组，页面显示「—」，
   *    而不是悄悄用成人半径去判青少年比赛（PRD 风险 7.4）。
   */
  _zoneStats(dots, params) {
    const radius = params && params.three_point_radius_m;
    if (!dots.length || !Number.isFinite(radius) || radius <= 0) return [];

    const label = this.data.is3v3 ? '远投' : '三分';

    const arcOut = dots.filter((d) => Math.hypot(d.x_m, d.y_m) >= radius);
    const arcIn = dots.filter((d) => Math.hypot(d.x_m, d.y_m) < radius);
    // 底角判定用横向距离，与 courtGeometry 的 ARC_AND_CORNERS 分支同口径
    const cornerLateral = params.corner_lateral_m;
    const corner = Number.isFinite(cornerLateral)
      ? arcOut.filter((d) => Math.abs(d.y_m) >= cornerLateral)
      : arcOut.filter((d) => Math.abs(d.y_m) >= radius * 0.74);

    return [
      { key: 'arcOut', label, made: arcOut.filter((d) => d.made).length, att: arcOut.length },
      { key: 'corner', label: '底角', made: corner.filter((d) => d.made).length, att: corner.length },
      { key: 'arcIn', label: this.data.is3v3 ? '近投' : '二分', made: arcIn.filter((d) => d.made).length, att: arcIn.length },
    ].map((z) => Object.assign(z, {
      text: madeOverAttempt(z.made, z.att),
      rateText: rate(z.made, z.att),
      empty: z.att === 0,
    }));
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapScope(e) {
    const idx = e.currentTarget.dataset.index;
    const scope = this.data.scopes[idx];
    if (scope) this._applyScope(scope);
  },

  /** 点逐场记录 → 跳该场报告的事件列表，并已按这个球员过滤 */
  onTapGame(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/events/index?activityId=${id}&playerId=${this.data.playerId}`,
    });
  },

  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/team/index' }) }); },
});
