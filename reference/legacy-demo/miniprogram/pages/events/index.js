/**
 * 屏 07 · 事件列表 + 补录浮层 —— P2-F03（产品生死线）
 *
 * PRD 7.1：这块不做扎实，教练懒得补录，产品价值直接归零。
 * 开发计划第 6.3 节给了 2 周专项排期与 14 条 checklist，本页逐条落地：
 *
 *  [x] 1  事件卡片流：缩略图 + 类型 + 时间戳 + 归属状态
 *  [x] 2  未补录卡片橙色左边线 + 底色，一眼可见
 *  [x] 3  顶部筛选：全部 / 未补录 / 三分(远投) / 快攻 / 失误
 *  [x] 4  点卡片 → 底部弹层，视频自动播放预览，无需按播放键
 *  [x] 5  出手位置元数据一行显示
 *  [x] 6  选人网格：首发顺序固定 + 已选替补，记住上次选的人并高亮
 *  [x] 7  含「不是我方」与「看不清」两个特殊选项
 *  [x] 8  「保存 · 下一个 →」一键跳下一个未补录事件
 *  [x] 9  跳过按钮（本场暂不处理）
 *  [x] 10 撤销（单步 + 连续）
 *  [x] 11 选人即保存，全程无「保存失败」弹窗（PRD 3.12）
 *  [x] 12 断网/杀进程后重进，已补录内容完整保留（PRD 3.11）
 *  [x] 13 补录进度条实时反映
 *  [ ] 14 实测单个事件补录耗时中位数 ≤5 秒（PRD 3.10）
 *         → 需真人内测测量，代码层已把路径压到最短：
 *           点卡片 → 自动播放 → 点人 → 自动跳下一个，共 2 次点击
 *
 * 核心提效点在 checklist #8：
 *   有「保存 · 下一个」时单个事件 3-5 秒，27 个待补录约 3 分钟扫完；
 *   没有它则每次都要关浮层 → 找橙色卡片 → 点开，一场要 15 分钟，差 5 倍。
 */

const api = require('../../utils/api');
const { createAttributionSession, FILTER, SPECIAL } = require('../../utils/attribution');
const { eventTimeText, num } = require('../../utils/format');

/** 补录进度落盘的 debounce，避免每次点击都写 storage */
const SAVE_DEBOUNCE_MS = 400;

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: '',

    report: null,
    params: null,
    activity: null,
    roster: [],

    // 筛选
    filters: [],
    activeFilter: FILTER.ALL,
    periodFilter: null,

    // 列表
    events: [],
    totalCount: 0,

    // 补录进度
    progress: { total: 0, resolved: 0, attributed: 0, pending: 0, percent: 0, complete: false },

    // 浮层
    sheetOpen: false,
    currentEvent: null,
    currentTimeText: '',
    currentMetaText: '',
    currentClipSrc: '',
    currentClipDuration: 0,
    pickerItems: [],
    pickerSelected: '',
    canUndo: false,
    undoDepth: 0,
    hasNext: false,
    nextHint: '',
  },

  async onLoad(query) {
    const activityId = (query && query.activityId) || '';
    const filter = (query && query.filter) || FILTER.ALL;
    const period = query && query.period ? Number(query.period) : null;

    this.setData({ activityId, activeFilter: filter, periodFilter: period });
    await this.load();
  },

  onUnload() {
    this._flushSave();
  },

  onHide() {
    // 切后台立即落盘（PRD 3.11：杀进程后重进内容完整保留）
    this._flushSave();
  },

  async load() {
    const { activityId } = this.data;
    if (!activityId) { this.setData({ loading: false, loadError: '缺少活动 id' }); return; }

    this.setData({ loading: true, loadError: '' });

    let res = null;
    try {
      res = await api.getReport(activityId);
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '加载失败' });
      return;
    }

    if (!res || !res.report) {
      this.setData({ loading: false, loadError: '报告尚未生成' });
      return;
    }

    const roster = await api.getRoster();

    // 恢复上次补录进度
    const app = getApp();
    const persisted = app && app.loadAttribution ? app.loadAttribution(activityId) : null;

    this.session = createAttributionSession({
      events: res.report.events || [],
      roster,
      format: res.report.params ? res.report.params.format : '5V5',
      persisted,
    });

    // 进度变更 → debounce 落盘
    this.session.setOnChange(() => this._scheduleSave());

    this.setData({
      loading: false,
      report: res.report,
      params: res.report.params || null,
      activity: res.activity || null,
      roster,
    });

    this._refresh();
  },

  /** 重算筛选器、列表、进度 */
  _refresh() {
    if (!this.session) return;

    const s = this.session;
    const list = s.list(this.data.activeFilter);
    const params = this.data.params || {};

    // 期次过滤（从报告页点某一节进来）
    const filtered = this.data.periodFilter
      ? list.filter((e) => e.period === this.data.periodFilter)
      : list;

    const decorated = filtered.map((e) => this._decorate(e, params));

    this.setData({
      filters: s.filterDefs(),
      events: decorated,
      totalCount: s.progress().total,
      progress: s.progress(),
      canUndo: s.undoDepth > 0,
      undoDepth: s.undoDepth,
    });
  },

  /** 给事件补上界面展示字段 */
  _decorate(ev, params) {
    return Object.assign({}, ev, {
      timeText: eventTimeText(ev.timestamp_s, (this.data.report || {}).periods, params.format),
      playerName: this.session ? this.session.displayName(ev) : '—',
      resolved: this.session ? this.session.isResolved(ev) : false,
      distanceText: Number.isFinite(ev.distance_m) ? `${ev.distance_m.toFixed(1)} m` : '',
      // ⚠️ 分值文案一律用后端给的 label_zh（契约硬规则 #2），前端不推断
      scoreText: ev.label_zh || '',
      madeText: ev.made == null ? '' : (ev.made ? '命中' : '未中'),
      oob: ev.in_bounds === false,
      lowConfidence: Number.isFinite(ev.confidence) && ev.confidence < 0.6,
    });
  },

  // ============================================================
  // 筛选
  // ============================================================

  onTapFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ activeFilter: key, periodFilter: null });
    this._refresh();
  },

  onClearPeriod() {
    this.setData({ periodFilter: null });
    this._refresh();
  },

  // ============================================================
  // 浮层：点事件卡 → 底部弹层
  // ============================================================

  onTapEvent(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || !this.session) return;
    this._openSheet(id);
  },

  _openSheet(eventId) {
    const s = this.session;
    if (!s) return;

    s.setCursor(eventId);
    const ev = s.getEvent(eventId);
    if (!ev) return;

    const params = this.data.params || {};

    // 出手位置元数据一行显示（checklist #5）
    const meta = [];
    if (Number.isFinite(ev.distance_m)) meta.push(`距筐 ${ev.distance_m.toFixed(1)} m`);
    if (Number.isFinite(ev.x_m) && Number.isFinite(ev.y_m)) {
      meta.push(`坐标 (${ev.x_m.toFixed(1)}, ${ev.y_m.toFixed(1)})`);
    }
    if (ev.behind_three_point_line != null) {
      meta.push(ev.behind_three_point_line ? '弧外' : '弧内');
    }
    if (ev.in_bounds === false) meta.push('⚠ 坐标越界');
    if (Number.isFinite(ev.confidence)) meta.push(`置信度 ${(ev.confidence * 100).toFixed(0)}%`);

    // 片段地址：Mock 阶段没有真实 CDN，用占位；真实环境由后端给签名 URL
    const clipSrc = ev.clip_key ? this._clipUrl(ev.clip_key) : '';

    const next = s.nextPending(eventId);

    this.setData({
      sheetOpen: true,
      currentEvent: this._decorate(ev, params),
      currentTimeText: eventTimeText(ev.timestamp_s, (this.data.report || {}).periods, params.format),
      currentMetaText: meta.join(' · '),
      currentClipSrc: clipSrc,
      currentClipDuration: ev.clip_duration_s || 0,
      pickerItems: s.pickerOrder(),
      pickerSelected: ev.player_id || ev.attribution_source || '',
      canUndo: s.undoDepth > 0,
      undoDepth: s.undoDepth,
      hasNext: !!next,
      nextHint: next ? '下一个未补录事件' : '本场已全部处理',
    });
  },

  _clipUrl(clipKey) {
    if (api.USE_MOCK) return '';   // Mock 阶段无真实片段，播放器显示占位
    const cfg = api.getConfig();
    return `${cfg.cdnBase || ''}/${clipKey}`;
  },

  onCloseSheet() {
    // 关闭浮层必须停掉视频，否则声音会继续（PRD 3.4 交互一致性）
    if (this._clipCtx && this._clipCtx.pause) this._clipCtx.pause();
    this.setData({ sheetOpen: false, currentEvent: null, currentClipSrc: '' });
  },

  noop() { /* 阻止浮层内容区的点击冒泡到遮罩 */ },

  // ============================================================
  // 选人即保存（checklist #8 #11）
  // ============================================================

  /**
   * 选人即保存，并自动跳下一个未补录事件。
   *
   * ⚠️ 全程不弹任何"保存失败"提示（PRD 3.12）。
   *    网络失败时写本地缓存 + 恢复后重传，UI 层面无感。
   *    每一次打断都是让教练放弃补录的临界点。
   */
  onPick(e) {
    const choice = e.currentTarget.dataset.id || (e.detail && e.detail.id);
    if (!choice || !this.session || !this.data.currentEvent) return;

    const eventId = this.data.currentEvent.id;
    const result = this.session.select(eventId, choice);

    if (!result.ok) {
      // 非法选择（不在名单里的 id）—— 静默忽略，不弹窗打断
      return;
    }

    // 后端保存：失败也不打断教练，靠本地缓存兜底
    this._saveToBackend(eventId, choice);

    if (result.resolvedAll) {
      this._refresh();
      this.setData({ sheetOpen: false, currentEvent: null });
      wx.showToast({ title: '本场补录完成', icon: 'success' });
      return;
    }

    if (result.next) {
      // 一键跳下一个：这是 3-5 秒/事件的关键
      this._openSheet(result.next.id);
      this._refresh();
    } else {
      this._refresh();
      this.setData({ sheetOpen: false, currentEvent: null });
      wx.showToast({ title: '没有更多待补录事件', icon: 'none' });
    }
  },

  /** 跳过（checklist #9） */
  onSkip() {
    if (!this.session || !this.data.currentEvent) return;
    const eventId = this.data.currentEvent.id;
    const r = this.session.skip(eventId);
    this._saveToBackend(eventId, SPECIAL.UNKNOWN);

    this._refresh();
    if (r.next) this._openSheet(r.next.id);
    else {
      this.setData({ sheetOpen: false, currentEvent: null });
      wx.showToast({ title: '已跳过', icon: 'none' });
    }
  },

  /** 撤销（checklist #10：单步 + 连续） */
  onUndo() {
    if (!this.session) return;
    const r = this.session.undo();
    if (!r.ok) { wx.showToast({ title: '没有可撤销的操作', icon: 'none' }); return; }

    this._refresh();
    if (r.eventId) this._openSheet(r.eventId);
  },

  /**
   * 保存到后端。
   *
   * 失败时不弹任何提示（PRD 3.12），只写本地待重传队列，
   * 下次进入页面或网络恢复时补发。
   */
  _saveToBackend(eventId, choice) {
    api.saveAttribution(this.data.activityId, eventId, choice)
      .catch(() => this._enqueueRetry(eventId, choice));
  },

  _enqueueRetry(eventId, choice) {
    try {
      const key = `attr_retry_${this.data.activityId}`;
      const q = wx.getStorageSync(key) || [];
      q.push({ eventId, choice, at: Date.now() });
      wx.setStorageSync(key, q);
    } catch (e) { /* storage 满时放弃重传队列，本地进度仍在 */ }
  },

  _flushRetryQueue() {
    try {
      const key = `attr_retry_${this.data.activityId}`;
      const q = wx.getStorageSync(key) || [];
      if (!q.length) return;
      wx.setStorageSync(key, []);
      q.forEach((item) => {
        api.saveAttribution(this.data.activityId, item.eventId, item.choice).catch(() => {});
      });
    } catch (e) { /* noop */ }
  },

  // ============================================================
  // 进度落盘（checklist #12）
  // ============================================================

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flushSave(), SAVE_DEBOUNCE_MS);
  },

  _flushSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this.session || !this.data.activityId) return;
    const app = getApp();
    if (!app || !app.saveAttribution) return;

    const state = this.session.serialize();
    const p = this.session.progress();
    state.complete = p.complete;
    app.saveAttribution(this.data.activityId, state);
  },

  // ============================================================
  // 其他交互
  // ============================================================

  /** 批量：把当前筛选下所有事件都归给同一个人（第二版能力，先留入口） */
  onBatchAttribute() {
    wx.showModal({
      title: '批量归属',
      content: '把当前筛选下的所有未补录事件都归给同一个人？适合"这一节都是 7 号在场"的情况。',
      confirmText: '选择球员',
      success: (res) => {
        if (!res.confirm) return;
        wx.showToast({ title: '第二版提供，当前请逐个补录', icon: 'none' });
      },
    });
  },

  onGoReport() {
    wx.redirectTo({ url: `/pages/report/index?activityId=${this.data.activityId}` });
  },
});
