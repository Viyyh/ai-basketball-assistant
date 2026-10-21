/**
 * 屏 01 · 首页 / 教练工作台
 *
 * 目标：三秒内看到"该干什么"。
 *
 * 界面设计 v0.1.1 屏 01 的三条要求：
 *   1. 大按钮"开始新录制"占首屏 C 位 —— 产品最高频动作
 *   2. 待补录提醒：橙色高亮，永远显示"最紧急那一场"，把教练往补录页推
 *      超过 7 天未补录 → 变红并置顶（PRD 屏 01）
 *   3. 实时分析入口灰显占位，标"内测中"，不新开一屏
 */

const api = require('../../utils/api');
const { shortDate, templateLabel, daysSince } = require('../../utils/format');

/** 超过这个天数未补录，提醒从橙变红 */
const OVERDUE_DAYS = 7;

Page({
  data: {
    loading: true,
    greeting: '',
    coachName: '',
    weekCount: 0,

    /** 待补录提醒 */
    pending: null,          // 最紧急那一场
    pendingCount: 0,
    pendingOverdue: false,
    pendingDays: 0,

    recent: [],
    /** 未上传的本地视频（取消 ≠ 删除，24 小时内可找回） */
    pendingLocal: [],

    /** 实时入口占位 */
    realtimePlaceholder: true,
  },

  onLoad() {
    const h = new Date().getHours();
    const greeting = h < 6 ? '夜深了' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '下午好' : '晚上好';
    this.setData({ greeting });
  },

  onShow() {
    // 每次回到首页都刷新，因为补录进度可能在别的页面变了
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      const [team, pending, activities] = await Promise.all([
        api.getTeam(),
        api.listPendingAttribution(),
        api.listActivities(),
      ]);

      // 待补录：取最旧的一场（listPendingAttribution 已按日期升序）
      const first = pending[0] || null;
      const pendingDays = first ? (daysSince(first.playedAt) || 0) : 0;

      // 本周录制场次
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      const weekCount = activities.filter(
        (a) => new Date(a.playedAt).getTime() >= weekAgo
      ).length;

      const app = getApp();
      const pendingLocal = app && app.listPendingLocalVideos ? app.listPendingLocalVideos() : [];

      this.setData({
        loading: false,
        coachName: team.coachName || '教练',
        weekCount,
        pending: first ? this._decorate(first) : null,
        pendingCount: pending.length,
        pendingOverdue: pendingDays > OVERDUE_DAYS,
        pendingDays,
        recent: activities.slice(0, 4).map((a) => this._decorate(a)),
        pendingLocal,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
    }
  },

  /** 给活动补上界面需要的展示字段 */
  _decorate(a) {
    return Object.assign({}, a, {
      dateText: shortDate(a.playedAt),
      templateText: templateLabel(a.template),
      durationText: a.durationS ? `${Math.round(a.durationS / 60)} 分钟` : '—',
      isPending: a.status === 'report_ready' && a.attributedCount < a.eventCount,
      isComplete: a.status === 'complete',
      isProcessing: a.status === 'processing' || a.status === 'uploading',
      hasScore: Number.isFinite(a.scoreFor) && Number.isFinite(a.scoreAgainst),
    });
  },

  // ---------- 交互 ----------

  onNewRecording() {
    wx.navigateTo({ url: '/pages/activity-new/index' });
  },

  /**
   * 待补录提醒 → 直接跳到最旧那一份未完成报告的补录页。
   * 不是跳报告总览，是跳事件列表 —— 缩短路径，减少放弃。
   */
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
      return;
    }
    if (status === 'report_ready' || status === 'complete') {
      wx.navigateTo({ url: `/pages/report/index?activityId=${id}` });
      return;
    }
    wx.navigateTo({ url: `/pages/report/index?activityId=${id}` });
  },

  /** 找回被取消上传的本地视频 */
  onResumeLocal(e) {
    const { path, activityid } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/upload/index?activityId=${activityid}&localPath=${encodeURIComponent(path || '')}`,
    });
  },

  onDismissLocal(e) {
    const { path } = e.currentTarget.dataset;
    const app = getApp();
    const list = (app.listPendingLocalVideos() || []).filter((v) => v.filePath !== path);
    wx.setStorageSync(app.STORAGE_KEYS.PENDING_LOCAL, list);
    this.setData({ pendingLocal: list });
  },

  /**
   * 实时分析入口：灰显占位，点了只说明状态，不跳转。
   * PRD 决策 3：第一版不做实时，入口占位。
   */
  onTapRealtime() {
    wx.showModal({
      title: '实时分析 · 内测中',
      content: '第一版暂不支持比赛实时上传与分析。当前流程为：录制结束后上传，云端处理完成会通知你。实时能力会在后续版本开放。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onGoTeam() { wx.switchTab({ url: '/pages/team/index' }); },
  onGoHistory() { wx.switchTab({ url: '/pages/history/index' }); },
});
