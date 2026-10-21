/**
 * 球队页屏 03 · 球员数据库（列表）
 *
 * 把"全队"拆成"个体"。教练看这页是想找"谁在进步、谁拖后腿"。
 *
 * 关键约束：
 *   · 数据不完整的球员用虚线边框 + 橙字，一眼看出哪些人需要补录
 *   · **空数据用「—」不用「0」**（PRD 3.6：0 会被误读为"得分为 0"）
 *   · 篮板/助攻第一版 AI 采不到，一律 null → 显示「—」，不编造
 *   · 新教练刚注册时全是空数据，此时应引导"先录一场比赛"，
 *     而不是一堆「—」让人沮丧
 */

const api = require('../../utils/api');
const { num, pct } = require('../../utils/format');

const POSITIONS = [
  { key: 'ALL', label: '全部' },
  { key: '后卫', label: '后卫' },
  { key: '前锋', label: '前锋' },
  { key: '中锋', label: '中锋' },
];

const SORTS = [
  { key: 'ppg', label: '场均得分' },
  { key: 'fgPct', label: '命中率' },
  { key: 'number', label: '号码' },
  { key: 'gamesPlayed', label: '出场场次' },
];

/** 位置归类：控卫/分卫 → 后卫，小前/大前 → 前锋 */
function positionGroup(position) {
  if (!position) return '';
  if (position.includes('卫')) return '后卫';
  if (position.includes('前')) return '前锋';
  if (position.includes('中')) return '中锋';
  return position;
}

Page({
  data: {
    loading: true,
    players: [],
    filtered: [],

    keyword: '',
    activePosition: 'ALL',
    activeSort: 'ppg',
    positions: POSITIONS,
    sorts: SORTS,
    showSortMenu: false,

    incompleteCount: 0,
    totalCount: 0,
    hasAnyData: false,
  },

  async onLoad() { await this.load(); },
  onShow() { if (!this.data.loading) this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });
    let players = [];
    try { players = await api.listPlayers(); }
    catch (e) { this.setData({ loading: false }); return; }

    const decorated = players.map((p) => Object.assign({}, p, {
      group: positionGroup(p.position),
      ppgText: p.ppg != null ? num(p.ppg, 1) : '—',
      fgPctText: p.fgPct != null ? pct(p.fgPct, 1) : '—',
      gamesText: p.gamesPlayed ? `${p.gamesPlayed} 场` : '未出场',
      incomplete: !p.dataComplete,
      // 篮板/助攻第一版 AI 采不到，永远是 null → 显示「—」
      rpgText: p.rpg != null ? num(p.rpg, 1) : '—',
      apgText: p.apg != null ? num(p.apg, 1) : '—',
    }));

    this.setData({
      loading: false,
      players: decorated,
      totalCount: decorated.length,
      incompleteCount: decorated.filter((p) => p.incomplete).length,
      hasAnyData: decorated.some((p) => p.dataComplete),
    });
    this._applyFilter();
  },

  _applyFilter() {
    const { players, keyword, activePosition, activeSort } = this.data;
    const k = (keyword || '').trim().toLowerCase();

    let list = players.slice();

    if (k) {
      list = list.filter((p) =>
        String(p.name).toLowerCase().includes(k) || String(p.number).includes(k)
      );
    }
    if (activePosition !== 'ALL') {
      list = list.filter((p) => p.group === activePosition);
    }

    // 排序：数据缺失的排最后，不让「—」占满首屏
    const val = (p) => {
      const v = p[activeSort];
      return v == null ? -Infinity : v;
    };
    if (activeSort === 'number') {
      list.sort((a, b) => a.number - b.number);
    } else {
      list.sort((a, b) => val(b) - val(a));
    }

    this.setData({ filtered: list });
  },

  // ============================================================
  // 交互
  // ============================================================

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this._applyFilter();
  },

  onTapPosition(e) {
    this.setData({ activePosition: e.currentTarget.dataset.key || 'ALL' });
    this._applyFilter();
  },

  onToggleSortMenu() {
    this.setData({ showSortMenu: !this.data.showSortMenu });
  },

  onTapSort(e) {
    this.setData({ activeSort: e.currentTarget.dataset.key, showSortMenu: false });
    this._applyFilter();
  },

  onTapPlayer(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/player-detail/index?id=${id}` });
  },

  onAddPlayer() {
    wx.showToast({ title: '第一版名单在新建活动时录入', icon: 'none' });
  },

  /** 数据不完整时引导去补录，而不是留一堆「—」 */
  onGoAttribution() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  onNewRecording() {
    wx.navigateTo({ url: '/pages/activity-new/index' });
  },
});
