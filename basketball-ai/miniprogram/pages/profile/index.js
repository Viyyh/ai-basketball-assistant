/**
 * 我的页
 *
 * 除常规账号信息外，这一页承担三件第一版特有的事：
 *
 *   1. **球队默认参数**（default_age_group / default_format）
 *      新建活动时自动带出，青训队一整年往往都是同一套参数，
 *      不该每次都重选（界面设计 v0.1.1 屏 02 注释）。
 *
 *   2. **《内测告知》重新查看**（PRD 3.7 / 7.3）
 *      合规浮层同意后不再弹，但教练需要能随时回看条款。
 *
 *   3. **待核实数值反馈入口**（PRD 9.5）
 *      青少年三分线半径 5.80 m 是假设值，各地联赛可能是 6.00 / 6.25 m；
 *      一线单节时长 FIBA 是 10 分钟、范围文档写的是 12 分钟。
 *      这两个数值错了会导致整份报告分值系统性偏差且教练察觉不到，
 *      所以要主动请内测教练核对并反馈。
 */

const api = require('../../utils/api');
const mockData = require('../../mock/data');
const { AGE_GROUP, FORMAT, AGE_GROUP_LABEL, FORMAT_LABEL } = require('../../utils/params');
const { bytes } = require('../../utils/format');

const AGE_OPTIONS = Object.values(AGE_GROUP).map((k) => ({ key: k, label: AGE_GROUP_LABEL[k] }));
const FORMAT_OPTIONS = Object.values(FORMAT).map((k) => ({ key: k, label: FORMAT_LABEL[k] }));

/** 数据保留期（PRD 7.3：内测期默认 30 天） */
const RETENTION_DAYS = 30;

Page({
  data: {
    team: null,
    coachName: '',

    ageOptions: AGE_OPTIONS,
    formatOptions: FORMAT_OPTIONS,
    ageIndex: 0,
    formatIndex: 0,

    consentedAt: '',
    subscribed: false,

    retentionDays: RETENTION_DAYS,
    storageUsedText: '—',

    pendingLocal: [],
    pendingLocalCount: 0,

    unverifiedNotices: [],

    pendingAttributionCount: 0,
    version: '0.1.0',
    isMock: true,
  },

  onLoad() {
    this.setData({
      unverifiedNotices: mockData.UNVERIFIED_NOTICES || [],
      isMock: api.USE_MOCK,
    });
  },

  onShow() { this.load(); },

  async load() {
    const app = getApp();
    let team = null;
    try { team = await api.getTeam(); } catch (e) { team = app.getTeam ? app.getTeam() : null; }

    const consentedAt = wx.getStorageSync(app.STORAGE_KEYS.CONSENT) || '';
    const pendingLocal = app.listPendingLocalVideos ? app.listPendingLocalVideos() : [];

    let storageUsedText = '—';
    try {
      const info = wx.getStorageInfoSync();
      storageUsedText = `${info.currentSize || 0} KB / ${info.limitSize || 0} KB`;
    } catch (e) { /* 拿不到不阻塞 */ }

    const ageIndex = Math.max(0, AGE_OPTIONS.findIndex((o) => team && o.key === team.default_age_group));
    const formatIndex = Math.max(0, FORMAT_OPTIONS.findIndex((o) => team && o.key === team.default_format));

    this.setData({
      team,
      coachName: (team && team.coachName) || '教练',
      ageIndex: ageIndex >= 0 ? ageIndex : 0,
      formatIndex: formatIndex >= 0 ? formatIndex : 0,
      consentedAt: consentedAt ? new Date(consentedAt).toLocaleDateString('zh-CN') : '',
      subscribed: !!wx.getStorageSync('subscribed_report'),
      pendingLocal,
      pendingLocalCount: pendingLocal.length,
      storageUsedText,
      pendingAttributionCount: app.globalData ? app.globalData.pendingAttributionCount : 0,
    });
  },

  // ============================================================
  // 球队默认参数
  // ============================================================

  onAgeChange(e) {
    const idx = Number(e.detail.value);
    const opt = AGE_OPTIONS[idx];
    if (!opt) return;
    this.setData({ ageIndex: idx });
    this._saveTeamDefault({ default_age_group: opt.key });
  },

  onFormatChange(e) {
    const idx = Number(e.detail.value);
    const opt = FORMAT_OPTIONS[idx];
    if (!opt) return;
    this.setData({ formatIndex: idx });
    this._saveTeamDefault({ default_format: opt.key });
  },

  _saveTeamDefault(patch) {
    const app = getApp();
    const team = Object.assign({}, this.data.team || {}, patch);
    this.setData({ team });
    if (app.setTeam) app.setTeam(team);
    wx.showToast({ title: '已保存为默认', icon: 'success' });
  },

  onEditTeamName() {
    wx.showModal({
      title: '修改球队名称',
      editable: true,
      placeholderText: (this.data.team && this.data.team.name) || '',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) return;
        this._saveTeamDefault({ name });
      },
    });
  },

  // ============================================================
  // 合规与通知
  // ============================================================

  /** 《内测告知》随时可回看（PRD 3.7） */
  onViewConsent() {
    wx.showModal({
      title: '内测告知',
      content: '· 仅内测使用，录像不用于任何公开传播\n'
        + '· 报告仅本人可见\n'
        + `· 内测期数据保留 ${RETENTION_DAYS} 天\n`
        + '· 后续商用前会另行征求授权\n'
        + '· 录像可能包含对手球员与观众，请确认在允许的场合录制',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onToggleSubscribe(e) {
    const on = e.detail.value;
    if (!on) {
      wx.removeStorageSync('subscribed_report');
      this.setData({ subscribed: false });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: ['MOCK_TMPL_REPORT_READY'],
      success: (res) => {
        const accepted = Object.keys(res).some((k) => res[k] === 'accept');
        this.setData({ subscribed: accepted });
        if (accepted) wx.setStorageSync('subscribed_report', true);
        else wx.showToast({ title: '未授权', icon: 'none' });
      },
      fail: () => {
        this.setData({ subscribed: false });
        wx.showToast({ title: '当前环境不支持', icon: 'none' });
      },
    });
  },

  /**
   * 待核实数值反馈（PRD 9.5）。
   *
   * 这两个数值错了会导致整份报告分值系统性偏差且教练察觉不到，
   * 所以主动请内测教练核对。
   */
  onFeedbackParams() {
    wx.showModal({
      title: '帮 we 核对两个数值',
      content: '1. 你带的队打的是哪个联赛？三分线是多少米？（我们暂按 5.80 m 处理青少年组）\n\n'
        + '2. 单节几分钟？（我们暂按 FIBA 成人 10 分钟、U15 8 分钟）\n\n'
        + '数值错了会导致整份报告的分值判定系统性偏差，而且从报告上看不出来。',
      confirmText: '复制问题去反馈',
      success: (res) => {
        if (!res.confirm) return;
        wx.setClipboardData({
          data: '【篮球数据小程序 · 参数核对】\n'
            + '1. 联赛名称：\n2. 三分线距离（米）：\n3. 单节时长（分钟）：\n4. 年龄段：',
          success: () => wx.showToast({ title: '已复制，请发给产品负责人', icon: 'none' }),
        });
      },
    });
  },

  // ============================================================
  // 本地数据管理
  // ============================================================

  onResumeLocal(e) {
    const { path, activityid } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/upload/index?activityId=${activityid}&localPath=${encodeURIComponent(path || '')}`,
    });
  },

  onClearLocal() {
    wx.showModal({
      title: '清理本地登记',
      content: '只会清除"未上传录像"的登记记录，不会删除已生成的报告与补录数据。',
      confirmText: '清理',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        const app = getApp();
        wx.setStorageSync(app.STORAGE_KEYS.PENDING_LOCAL, []);
        this.setData({ pendingLocal: [], pendingLocalCount: 0 });
        wx.showToast({ title: '已清理', icon: 'success' });
      },
    });
  },

  onGoPending() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: `AI 篮球训练/比赛数据采集与分析\n版本 ${this.data.version}\n`
        + (this.data.isMock ? '\n当前为 Mock 数据模式，后端与 AI Pipeline 尚未接入。' : ''),
      showCancel: false,
    });
  },
});
