/**
 * 球队页屏 05 · 球队战术板（战术库）
 *
 * 已确认的形态（对话记录）：
 *   球队战术板由教练自行编辑，以「战术名称 + 视频」为主。
 *   素材可从团队对抗训练录像或比赛切片接入，教练命名并打标签。
 *   第一版**不做绘制**，点状动画演示是后期能力，只做占位卡展示路线图。
 *
 * 占位卡的价值（界面设计 v0.1.1 屏 05 注释）：
 *   教练看到路线图上有「点状动画演示」，会更愿意把战术卡攒起来 ——
 *   他知道这些素材未来会变成动画演示。占位卡不实现，但要展示。
 *
 * 对手战术板与本页面同构，只是归属对象不同，共用同一套组件与接口
 * （球队页设计 v0.2：工程上只做一次）。
 */

const api = require('../../utils/api');
const { clockTime } = require('../../utils/format');

const TAGS = ['全部', '进攻', '防守', '边线球', '训练'];

const SOURCE_LABEL = {
  MATCH: '比赛切片',
  SCRIMMAGE: '训练切片',
  ROUTINE: '套路演练',
  UPLOAD: '手动上传',
};

Page({
  data: {
    loading: true,
    tactics: [],
    filtered: [],

    tags: TAGS,
    activeTag: '全部',
    keyword: '',

    totalCount: 0,
    /** 归属：TEAM=球队战术板，OPPONENT=对手战术板（复用同一页） */
    owner: 'TEAM',
    opponentId: '',
    opponentName: '',
  },

  async onLoad(query) {
    const owner = (query && query.owner) || 'TEAM';
    const opponentId = (query && query.opponentId) || '';
    this.setData({ owner, opponentId });

    if (owner === 'OPPONENT' && opponentId) {
      const opp = await api.getOpponent(opponentId);
      this.setData({ opponentName: opp ? opp.name : '对手' });
      wx.setNavigationBarTitle({ title: '对手战术板' });
    }
    await this.load();
  },

  onShow() { if (!this.data.loading) this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });

    let list = [];
    try {
      if (this.data.owner === 'OPPONENT') {
        const opp = await api.getOpponent(this.data.opponentId);
        list = (opp && opp.tactics ? opp.tactics : []).map((t) => Object.assign({}, t, {
          sourceType: t.source === '手动上传' ? 'UPLOAD' : 'MATCH',
          tags: t.tag ? [t.tag] : [],
          at: t.at,
        }));
      } else {
        list = await api.listTactics();
      }
    } catch (e) {
      this.setData({ loading: false });
      return;
    }

    const decorated = list.map((t) => Object.assign({}, t, {
      durationText: clockTime(t.durationS || 0),
      sourceLabel: SOURCE_LABEL[t.sourceType] || '切片',
      tagText: (t.tags || []).join(' · '),
    }));

    this.setData({
      loading: false,
      tactics: decorated,
      totalCount: decorated.length,
    });
    this._applyFilter();
  },

  _applyFilter() {
    const { tactics, activeTag, keyword } = this.data;
    const k = (keyword || '').trim().toLowerCase();

    let list = tactics.slice();
    if (activeTag !== '全部') {
      list = list.filter((t) => (t.tags || []).includes(activeTag));
    }
    if (k) {
      list = list.filter((t) =>
        String(t.name).toLowerCase().includes(k)
        || (t.tags || []).some((tag) => tag.toLowerCase().includes(k))
      );
    }

    this.setData({ filtered: list });
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapTag(e) {
    this.setData({ activeTag: e.currentTarget.dataset.tag || '全部' });
    this._applyFilter();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this._applyFilter();
  },

  onNewTactic() {
    if (this.data.owner === 'OPPONENT') {
      wx.navigateTo({
        url: `/pages/tactic-new/index?owner=OPPONENT&opponentId=${this.data.opponentId}`,
      });
      return;
    }
    wx.navigateTo({ url: '/pages/tactic-new/index' });
  },

  onTapTactic(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.data.tactics.find((x) => x.id === id);
    if (!t) return;

    // 第一版点击直接播放片段；详情页留到第二版
    wx.showModal({
      title: t.name,
      content: [
        `来源：${t.sourceLabel}`,
        t.at ? `时间：${t.at}` : '',
        `时长：${t.durationText}`,
        t.tagText ? `标签：${t.tagText}` : '',
        t.note ? `\n要点：${t.note}` : '',
      ].filter(Boolean).join('\n'),
      confirmText: '播放片段',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm && t.sourceActivityId) {
          wx.navigateTo({ url: `/pages/events/index?activityId=${t.sourceActivityId}` });
        }
      },
    });
  },

  onShareTactic(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.data.tactics.find((x) => x.id === id);
    wx.showToast({
      title: t ? `「${t.name}」已可分享给球员` : '分享',
      icon: 'none',
    });
  },
});
