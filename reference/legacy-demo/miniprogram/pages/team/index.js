/**
 * 球队页屏 01 · 球队主页 / 中枢
 *
 * 从首页底部导航「球队」进入的落地页。
 * 目标：一眼看清球队资产，四个模块一眼可达。
 *
 * 球队页设计 v0.2 的两处关键改动：
 *   1. 球队头卡上的「默认年龄段 / 默认赛制」标签 —— 对应球队资料里的
 *      default_age_group 与 default_format，新建活动时自动带出，
 *      教练只需确认而不用每次重选（青训队一整年往往都是同一套参数）
 *   2. 比赛数据入口副标题**按赛制拆开写**（"5对5 12 场 · 3对3 4 场"），
 *      不能写成"16 场比赛"。这是"数据不可跨赛制合并"这条原则
 *      在 UI 上的第一道体现 —— 从入口开始就让教练习惯分开看。
 *
 * 模块颜色即导航（PRD 3.5）：
 *   蓝 → 比赛数据   青 → 球员库   紫 → 战术板   橙 → 对手记录
 */

const api = require('../../utils/api');
const { shortDate, daysSince, templateLabel } = require('../../utils/format');
const { AGE_GROUP_LABEL, FORMAT_LABEL } = require('../../utils/params');

/** 超过这个天数未补录，提醒变红 */
const OVERDUE_DAYS = 7;

Page({
  data: {
    loading: true,
    team: null,
    defaultAgeLabel: '',
    defaultFormatLabel: '',

    pending: null,
    pendingCount: 0,
    pendingOverdue: false,

    // 四个模块的入口数据
    modules: [],

    recent: [],
    seasonRecord: { wins: 0, losses: 0, ppg: '—', fgPct: '—' },
  },

  onShow() { this.load(); },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });

    try {
      const [team, roster, activities, tactics, opponents, pending, stats] = await Promise.all([
        api.getTeam(),
        api.getRoster(),
        api.listActivities(),
        api.listTactics(),
        api.listOpponents(),
        api.listPendingAttribution(),
        api.getTeamStats(),
      ]);

      // 默认口径的战绩（不跨赛制合并）
      const def = stats.defaultScope;
      const defStats = def ? stats.byScope[`${def.format}|${def.ageGroup}`] : null;

      // 比赛数据入口副标题：按赛制拆开
      const scopeCounts = stats.scopes.map((s) => `${FORMAT_LABEL[s.format]} ${s.count} 场`);
      const incomplete = activities.filter(
        (a) => a.status === 'report_ready' && a.attributedCount < a.eventCount
      ).length;

      const firstPending = pending[0] || null;
      const pendingDays = firstPending ? (daysSince(firstPending.playedAt) || 0) : 0;

      const recent = activities.slice(0, 3).map((a) => ({
        id: a.id,
        name: a.name,
        dateText: shortDate(a.playedAt),
        templateText: templateLabel(a.template),
        hasScore: Number.isFinite(a.scoreFor),
        scoreText: Number.isFinite(a.scoreFor) ? `${a.scoreFor}:${a.scoreAgainst}` : '',
        won: !!a.won,
        isPending: a.status === 'report_ready' && a.attributedCount < a.eventCount,
        isComplete: a.status === 'complete',
        isProcessing: a.status === 'processing' || a.status === 'uploading',
        status: a.status,
      }));

      this.setData({
        loading: false,
        team,
        defaultAgeLabel: team && team.default_age_group ? AGE_GROUP_LABEL[team.default_age_group] : '',
        defaultFormatLabel: team && team.default_format ? FORMAT_LABEL[team.default_format] : '',
        pending: firstPending ? Object.assign({}, firstPending, {
          dateText: shortDate(firstPending.playedAt),
          remaining: firstPending.eventCount - firstPending.attributedCount,
        }) : null,
        pendingCount: pending.length,
        pendingOverdue: pendingDays > OVERDUE_DAYS,
        seasonRecord: defStats ? {
          wins: defStats.stats.wins,
          losses: defStats.stats.losses,
          ppg: defStats.stats.ppg || '—',
          fgPct: defStats.stats.fgPct != null ? `${(defStats.stats.fgPct * 100).toFixed(1)}%` : '—',
          scopeLabel: defStats.stats.label,
        } : { wins: 0, losses: 0, ppg: '—', fgPct: '—', scopeLabel: '' },
        modules: [
          {
            key: 'stats', tone: 'stats', icon: '📊', title: '球队比赛数据',
            sub: scopeCounts.length ? scopeCounts.join(' · ') : '暂无比赛',
            extra: incomplete ? ` · ${incomplete} 项待完善` : '',
            url: '/pages/team-stats/index',
          },
          {
            key: 'players', tone: 'player', icon: '👥', title: '球员数据库',
            sub: `${roster.length} 名球员`,
            extra: '',
            url: '/pages/players/index',
          },
          {
            key: 'tactics', tone: 'tactic', icon: '📋', title: '球队战术板',
            sub: `${tactics.length} 张战术卡`,
            extra: '',
            url: '/pages/tactics/index',
          },
          {
            key: 'opponents', tone: 'opponent', icon: '🎯', title: '对手记录',
            sub: `${opponents.length} 支球队`,
            extra: this._nextOpponentText(opponents),
            url: '/pages/opponents/index',
          },
        ],
        recent,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
    }
  },

  _nextOpponentText(opponents) {
    const next = opponents.find((o) => o.nextMatchAt);
    return next ? ` · 下次对阵 ${next.name}` : '';
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapModule(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  /** 待补录提醒 → 直接跳最旧那一份的补录页 */
  onGoPending() {
    const p = this.data.pending;
    if (!p) return;
    wx.navigateTo({ url: `/pages/events/index?activityId=${p.id}&filter=PENDING` });
  },

  onTapActivity(e) {
    const { id, status } = e.currentTarget.dataset;
    if (!id) return;
    if (status === 'processing' || status === 'uploading') {
      wx.navigateTo({ url: `/pages/processing/index?activityId=${id}` });
    } else if (status === 'report_ready' || status === 'complete') {
      wx.navigateTo({ url: `/pages/report/index?activityId=${id}` });
    }
  },

  /** 编辑球队资料（含默认年龄段与赛制） */
  onEditTeam() {
    wx.showToast({ title: '球队资料编辑见「我的」页', icon: 'none' });
    wx.switchTab({ url: '/pages/profile/index' });
  },

  onNewRecording() {
    wx.navigateTo({ url: '/pages/activity-new/index?copyLast=1' });
  },
});
