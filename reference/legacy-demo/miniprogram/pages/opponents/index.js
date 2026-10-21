/**
 * 球队页屏 07 · 对手球队列表
 *
 * 赛前准备入口。教练点开对手，是要在赛前 30 分钟迅速复习一遍。
 *
 * 球队页设计 v0.2 的赛制维度约束：
 *   **交手记录必须按赛制拆开。** 和育才中学打过 2 场 5对5、1 场 3对3，
 *   不能合并显示成"交手 3 次 · 2胜1负" —— 3对3 那场的胜负和 5对5 完全不可比。
 *
 *   正确做法：副标题写成「5对5 交手 2 次 · 1胜1负 | 3对3 交手 1 次 · 1胜」；
 *   右侧战绩只统计**下次对阵所用赛制**的那部分。
 *
 * 对手数据来源（两个）：
 *   ① 自动 —— 教练录了自己球队的比赛后，AI 识别的对手信息自动归到该对手名下
 *   ② 手动 —— 教练去现场录对手的比赛，上传时指定"这是 XX 队的比赛"
 *
 *   路径 ② 是产品从"自己队工具"变成"侦察工具"的关键。
 */

const api = require('../../utils/api');
const { shortDate, daysSince } = require('../../utils/format');
const { FORMAT_LABEL, AGE_GROUP_LABEL } = require('../../utils/params');

Page({
  data: {
    loading: true,
    opponents: [],
    filtered: [],

    keyword: '',
    nextOpponent: null,
    totalCount: 0,
  },

  async onLoad() { await this.load(); },
  onShow() { if (!this.data.loading) this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });

    let list = [];
    try { list = await api.listOpponents(); }
    catch (e) { this.setData({ loading: false }); return; }

    // 拉真实交手记录（按赛制拆开）
    const withH2H = [];
    for (const o of list) {
      let h2h = [];
      try {
        const res = await api.getOpponentHeadToHead(o.id);
        h2h = (res && res.byScope) || [];
      } catch (e) { h2h = []; }

      // Mock 数据里已有 headToHead 时优先用真实计算结果，否则回退
      const scopes = h2h.length ? h2h : (o.headToHead || []).map((h) => Object.assign({}, h, {
        label: `${FORMAT_LABEL[h.format] || h.format} · ${AGE_GROUP_LABEL[h.ageGroup] || h.ageGroup}`,
      }));

      const totalPlayed = scopes.reduce((s, x) => s + (x.played || 0), 0);
      const lastPlayedAt = scopes.reduce(
        (max, x) => ((x.lastPlayedAt || '') > max ? x.lastPlayedAt : max), ''
      );

      withH2H.push(Object.assign({}, o, {
        scopes,
        totalPlayed,
        lastPlayedAt,
        lastPlayedText: lastPlayedAt ? `最近 ${shortDate(lastPlayedAt)}` : '尚未交手',
        h2hText: scopes.length
          ? scopes.map((s) => `${FORMAT_LABEL[s.format] || s.format} ${s.played} 次 ${s.wins}胜${s.losses}负`).join(' | ')
          : '尚无交手记录',
        nextMatchText: o.nextMatchAt
          ? `${shortDate(o.nextMatchAt)} 对阵${daysSince(o.nextMatchAt, Date.now() + 86400000) >= 0 ? '' : ''}`
          : '',
        isNext: !!o.nextMatchAt,
        keyPlayerCount: (o.keyPlayers || []).length,
        tacticCount: (o.tactics || []).length,
        formationCount: (o.formationUsage || []).length,
      }));
    }

    // 下次对阵置顶
    withH2H.sort((a, b) => {
      if (a.isNext && !b.isNext) return -1;
      if (!a.isNext && b.isNext) return 1;
      return b.totalPlayed - a.totalPlayed;
    });

    this.setData({
      loading: false,
      opponents: withH2H,
      totalCount: withH2H.length,
      nextOpponent: withH2H.find((o) => o.isNext) || null,
    });
    this._applyFilter();
  },

  _applyFilter() {
    const k = (this.data.keyword || '').trim().toLowerCase();
    const list = k
      ? this.data.opponents.filter((o) => String(o.name).toLowerCase().includes(k))
      : this.data.opponents;
    this.setData({ filtered: list });
  },

  // ============================================================
  // 交互
  // ============================================================

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this._applyFilter();
  },

  onTapOpponent(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/opponent-detail/index?id=${id}` });
  },

  /** 长按：重命名 / 合并 / 删除 */
  onLongPressOpponent(e) {
    const id = e.currentTarget.dataset.id;
    const o = this.data.opponents.find((x) => x.id === id);
    if (!o) return;

    wx.showActionSheet({
      itemList: ['查看对手详情', '录一场与该对手的比赛', '重命名'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/opponent-detail/index?id=${id}` });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/activity-new/index' });
        } else if (res.tapIndex === 2) {
          this._rename(id, o.name);
        }
      },
    });
  },

  _rename(id, oldName) {
    wx.showModal({
      title: '重命名对手',
      editable: true,
      placeholderText: oldName,
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const opponents = this.data.opponents.map((o) =>
          (o.id === id ? Object.assign({}, o, { name: res.content.trim() }) : o)
        );
        this.setData({ opponents });
        this._applyFilter();
        wx.showToast({ title: '已重命名（本地）', icon: 'none' });
      },
    });
  },

  /**
   * 手动添加对手。
   * 用于还没交手过的对手（侦察比赛录像），或对手学校名变更的情况。
   */
  onAddOpponent() {
    wx.showModal({
      title: '添加对手',
      editable: true,
      placeholderText: '输入对手球队名称',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }

        const id = `opp_local_${Date.now()}`;
        const opponents = this.data.opponents.concat([{
          id, name, shortName: name.slice(0, 1),
          scopes: [], totalPlayed: 0, lastPlayedText: '尚未交手',
          h2hText: '尚无交手记录', isNext: false,
          keyPlayerCount: 0, tacticCount: 0, formationCount: 0,
        }]);
        this.setData({ opponents, totalCount: opponents.length });
        this._applyFilter();
        wx.showToast({ title: '已添加（本地）', icon: 'success' });
      },
    });
  },

  onTapNext() {
    const o = this.data.nextOpponent;
    if (o) wx.navigateTo({ url: `/pages/opponent-detail/index?id=${o.id}` });
  },

  onNewRecording() {
    wx.navigateTo({ url: '/pages/activity-new/index' });
  },
});
