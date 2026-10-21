/**
 * 历史页 —— PRD P1-13
 *
 * 检索维度：日期、类型（模板）、对手、**赛制、年龄段**。
 *
 * 赛制与年龄段作为筛选维度是 v0.2 新增的：既然数据不可跨赛制合并，
 * 检索时也必须能按口径过滤，否则教练会在一个列表里看到
 * 5对5 的 78 分和 3对3 的 21 分混排，无法比较。
 */

const api = require('../../utils/api');
const { shortDate, humanDuration, templateLabel } = require('../../utils/format');
const { FORMAT_LABEL, AGE_GROUP_LABEL, FORMAT, AGE_GROUP } = require('../../utils/params');

const TEMPLATES = [
  { key: 'ALL', label: '全部类型' },
  { key: 'MATCH', label: '比赛' },
  { key: 'SCRIMMAGE', label: '团队对抗' },
  { key: 'ROUTINE', label: '套路演练' },
];

Page({
  data: {
    loading: true,
    all: [],
    filtered: [],

    keyword: '',
    activeTemplate: 'ALL',
    activeFormat: 'ALL',
    activeAge: 'ALL',

    templates: TEMPLATES,
    formats: [{ key: 'ALL', label: '全部赛制' }].concat(
      Object.values(FORMAT).map((f) => ({ key: f, label: FORMAT_LABEL[f] }))
    ),
    ages: [{ key: 'ALL', label: '全部年龄段' }].concat(
      Object.values(AGE_GROUP).map((a) => ({ key: a, label: AGE_GROUP_LABEL[a] }))
    ),

    totalCount: 0,
    activeFilterCount: 0,
  },

  async onLoad() { await this.load(); },
  onShow() { if (!this.data.loading) this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });
    let list = [];
    try { list = await api.listActivities(); }
    catch (e) { this.setData({ loading: false }); return; }

    const decorated = list.map((a) => Object.assign({}, a, {
      dateText: shortDate(a.playedAt),
      templateText: templateLabel(a.template),
      durationText: a.durationS ? humanDuration(a.durationS) : '—',
      formatText: FORMAT_LABEL[a.format] || a.format || '—',
      ageText: AGE_GROUP_LABEL[a.ageGroup] || a.ageGroup || '—',
      hasScore: Number.isFinite(a.scoreFor),
      scoreText: Number.isFinite(a.scoreFor) ? `${a.scoreFor}:${a.scoreAgainst}` : '',
      isPending: a.status === 'report_ready' && a.attributedCount < a.eventCount,
      isComplete: a.status === 'complete',
      isProcessing: a.status === 'processing' || a.status === 'uploading',
      pendingCount: Math.max(0, (a.eventCount || 0) - (a.attributedCount || 0)),
    }));

    this.setData({ loading: false, all: decorated, totalCount: decorated.length });
    this._applyFilter();
  },

  _applyFilter() {
    const { all, keyword, activeTemplate, activeFormat, activeAge } = this.data;
    const k = (keyword || '').trim().toLowerCase();

    let list = all.slice();
    if (k) {
      list = list.filter((a) =>
        String(a.name || '').toLowerCase().includes(k)
        || String(a.opponentName || '').toLowerCase().includes(k)
        || String(a.playedAt || '').includes(k)
      );
    }
    if (activeTemplate !== 'ALL') list = list.filter((a) => a.template === activeTemplate);
    if (activeFormat !== 'ALL') list = list.filter((a) => a.format === activeFormat);
    if (activeAge !== 'ALL') list = list.filter((a) => a.ageGroup === activeAge);

    // 按日期倒序
    list.sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1));

    const activeFilterCount = [activeTemplate, activeFormat, activeAge]
      .filter((x) => x !== 'ALL').length + (k ? 1 : 0);

    this.setData({ filtered: list, activeFilterCount });
  },

  // ============================================================
  // 交互
  // ============================================================

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this._applyFilter();
  },

  onTapTemplate(e) {
    this.setData({ activeTemplate: e.currentTarget.dataset.key || 'ALL' });
    this._applyFilter();
  },

  onFormatChange(e) {
    const idx = Number(e.detail.value);
    const item = this.data.formats[idx];
    this.setData({ activeFormat: item ? item.key : 'ALL' });
    this._applyFilter();
  },

  onAgeChange(e) {
    const idx = Number(e.detail.value);
    const item = this.data.ages[idx];
    this.setData({ activeAge: item ? item.key : 'ALL' });
    this._applyFilter();
  },

  onResetFilter() {
    this.setData({
      keyword: '', activeTemplate: 'ALL', activeFormat: 'ALL', activeAge: 'ALL',
    });
    this._applyFilter();
  },

  onTapActivity(e) {
    const { id, status } = e.currentTarget.dataset;
    if (!id) return;
    if (status === 'processing' || status === 'uploading') {
      wx.navigateTo({ url: `/pages/processing/index?activityId=${id}` });
      return;
    }
    wx.navigateTo({ url: `/pages/report/index?activityId=${id}` });
  },

  onGoAttribution(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/events/index?activityId=${id}&filter=PENDING` });
  },

  onNewRecording() {
    wx.navigateTo({ url: '/pages/activity-new/index' });
  },
});
