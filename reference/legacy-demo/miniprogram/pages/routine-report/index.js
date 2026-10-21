/**
 * 屏 10 · 套路演练专属报告
 *
 * 与比赛报告的差异（界面设计 v0.1.1 屏 10）：
 *   · 没有比分、没有时间轴、没有节次
 *   · 核心是「每个套路一行」，展开看该套路的所有演练片段
 *   · 成功率徽章分级：≥70% 绿 / 40-69% 橙 / <40% 红
 *   · 「平均耗时」是套路质量的重要指标 —— 7 秒内完成的挡拆
 *     比 12 秒的质量高得多，第一版就加上
 *
 * 边界情况：
 *   · 教练录了但没标套路起止 → 整段作为「未分类」，让他手动切
 *   · 标了但次数不匹配（预设 8 次实际演练 6 次）→ 显示"实际 6 / 预设 8"并提醒
 *
 * 补救路径（界面设计 v0.1.1 屏 10 注释）：
 *   第一版允许在报告页「新增套路 + 手动框选时间范围」，工作量不大但很实用。
 */

const api = require('../../utils/api');
const { clockTime, pct } = require('../../utils/format');

/** 成功率分级阈值 */
const GOOD_RATE = 0.70;
const MID_RATE = 0.40;

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: '',

    activity: null,
    params: null,

    // 汇总
    summary: { routineCount: 0, totalAttempts: 0, totalSuccess: 0, rateText: '—' },

    // 套路列表
    routines: [],
    expandedId: '',

    // 未分类片段（教练没标起止时的兜底）
    unclassified: null,

    // 新增套路（补救路径）
    adding: false,
    newName: '',
    newStartText: '',
    newEndText: '',
    newStartS: 0,
    newEndS: 0,
    durationS: 0,
  },

  async onLoad(query) {
    const activityId = (query && query.activityId) || '';
    this.setData({ activityId });
    await this.load();
  },

  async load() {
    const { activityId } = this.data;
    if (!activityId) { this.setData({ loading: false, loadError: '缺少活动 id' }); return; }

    this.setData({ loading: true });

    const [activity] = await Promise.all([api.getActivity(activityId)]);
    let res = null;
    try { res = await api.getReport(activityId); }
    catch (e) { this.setData({ loading: false, loadError: e.message || '加载失败' }); return; }

    if (!res || !res.report) {
      this.setData({ loading: false, loadError: '报告尚未生成' });
      return;
    }

    // 套路清单来自活动本身（录制前教练建的）
    const declared = (activity && activity.routines) || [];
    const report = res.report;

    const routines = this._buildRoutines(declared, report);
    const unclassified = this._buildUnclassified(declared, report);

    const totalAttempts = routines.reduce((s, r) => s + r.actual, 0);
    const totalSuccess = routines.reduce((s, r) => s + r.success, 0);

    this.setData({
      loading: false,
      activity,
      params: report.params || null,
      durationS: (report.video && report.video.duration_s) || (activity && activity.durationS) || 0,
      routines,
      unclassified,
      summary: {
        routineCount: routines.length,
        totalAttempts,
        totalSuccess,
        rateText: totalAttempts ? pct(totalSuccess / totalAttempts) : '—',
      },
    });
  },

  /**
   * 把声明的套路清单与报告事件对齐。
   *
   * 第一版 AI 不自动识别套路归属（那是后期能力），
   * 所以演练次数来自录制时教练打的标记；没标记则显示为待确认。
   */
  _buildRoutines(declared, report) {
    const events = report.events || [];

    return declared.map((r, idx) => {
      const actual = Number.isFinite(r.actual) ? r.actual : 0;
      const success = Number.isFinite(r.success) ? r.success : 0;
      const rateV = actual > 0 ? success / actual : null;

      // 该套路关联的片段（Mock 阶段按索引均匀分配，真实环境由标记时间范围决定）
      const clips = events
        .filter((e) => e.kind === 'SHOT' || e.kind === 'OTHER')
        .slice(idx * 2, idx * 2 + Math.max(1, actual))
        .map((e) => ({
          id: e.id,
          timeText: clockTime(e.timestamp_s),
          madeText: e.made == null ? '' : (e.made ? '命中' : '未中'),
          label: e.label_zh || '',
          clipKey: e.clip_key || '',
          durationS: e.clip_duration_s || 0,
        }));

      return {
        id: r.id || `r_${idx}`,
        name: r.name,
        planned: r.planned || 0,
        actual,
        success,
        rateV,
        rateText: rateV == null ? '—' : pct(rateV),
        tone: rateV == null ? 'na' : (rateV >= GOOD_RATE ? 'ok' : (rateV >= MID_RATE ? 'warn' : 'err')),
        avgSeconds: Number.isFinite(r.avgSeconds) ? r.avgSeconds : null,
        avgText: Number.isFinite(r.avgSeconds) ? `${r.avgSeconds.toFixed(1)} 秒` : '—',
        mismatch: r.planned > 0 && actual !== r.planned,
        clips,
        expanded: false,
      };
    });
  },

  /** 教练没标套路起止时的兜底：整段作为「未分类」 */
  _buildUnclassified(declared, report) {
    if (declared && declared.length) return null;
    const events = report.events || [];
    if (!events.length) return null;
    return {
      count: events.length,
      hint: '录制时没有标记套路起止，AI 无法自动分段。可以手动新增套路并框选时间范围。',
    };
  },

  // ============================================================
  // 交互
  // ============================================================

  onToggleRoutine(e) {
    const id = e.currentTarget.dataset.id;
    const expandedId = this.data.expandedId === id ? '' : id;
    this.setData({
      expandedId,
      routines: this.data.routines.map((r) => Object.assign({}, r, { expanded: r.id === expandedId })),
    });
  },

  // ---------- 新增套路（补救路径） ----------

  onOpenAdd() {
    this.setData({ adding: true, newName: '', newStartS: 0, newEndS: 60 });
    this._syncTimeText();
  },

  onCloseAdd() { this.setData({ adding: false }); },

  onNameInput(e) { this.setData({ newName: e.detail.value }); },

  onTimeInput(e) {
    const field = e.currentTarget.dataset.field;
    const v = Number(e.detail.value) || 0;
    this.setData({ [field]: v });
    this._syncTimeText();
  },

  _syncTimeText() {
    this.setData({
      newStartText: clockTime(this.data.newStartS),
      newEndText: clockTime(this.data.newEndS),
    });
  },

  onSwapTime() {
    const { newStartS, newEndS } = this.data;
    this.setData({ newStartS: newEndS, newEndS: newStartS });
    this._syncTimeText();
  },

  onSaveRoutine() {
    const name = (this.data.newName || '').trim();
    if (!name) { wx.showToast({ title: '请填写套路名称', icon: 'none' }); return; }

    let start = this.data.newStartS;
    let end = this.data.newEndS;
    if (end <= start) { wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' }); return; }
    if (this.data.durationS && end > this.data.durationS) {
      end = this.data.durationS;
    }

    const routines = this.data.routines.concat([{
      id: `r_manual_${Date.now()}`,
      name,
      planned: 0,
      actual: 0,
      success: 0,
      rateV: null,
      rateText: '—',
      tone: 'na',
      avgSeconds: null,
      avgText: '—',
      mismatch: false,
      clips: [],
      expanded: false,
      manualRange: { startS: start, endS: end },
    }]);

    this.setData({
      routines,
      adding: false,
      summary: Object.assign({}, this.data.summary, { routineCount: routines.length }),
    });

    wx.showToast({ title: '已新增，待确认演练次数', icon: 'none' });
  },

  /** 手动修正某套路的实际次数与成功次数 */
  onEditCount(e) {
    const { id, field } = e.currentTarget.dataset;
    const routines = this.data.routines.map((r) => {
      if (r.id !== id) return r;
      const next = Object.assign({}, r);
      next[field] = (next[field] || 0) + 1;
      if (next.actual > 0) {
        next.rateV = next.success / next.actual;
        next.rateText = pct(next.rateV);
        next.tone = next.rateV >= GOOD_RATE ? 'ok' : (next.rateV >= MID_RATE ? 'warn' : 'err');
      }
      return next;
    });

    const totalAttempts = routines.reduce((s, r) => s + r.actual, 0);
    const totalSuccess = routines.reduce((s, r) => s + r.success, 0);

    this.setData({
      routines,
      summary: Object.assign({}, this.data.summary, {
        totalAttempts, totalSuccess,
        rateText: totalAttempts ? pct(totalSuccess / totalAttempts) : '—',
      }),
    });
  },

  onTapClip(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/events/index?activityId=${this.data.activityId}&focus=${id}` });
  },

  onBack() {
    wx.redirectTo({ url: `/pages/report/index?activityId=${this.data.activityId}` });
  },

  noop() {},
});
