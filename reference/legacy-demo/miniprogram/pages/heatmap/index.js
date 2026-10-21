/**
 * 屏 09 · 热图
 *
 * PRD 3.3 屏 09 的三条判断：
 *   1. 三种热图：投篮点 / 跑动热区 / 命中密度
 *   2. **跑动热区默认不显示** —— B 级数据不区分个人，
 *      全队一起跑的热图教练其实读不出信息，做成主动切换才出现，
 *      避免报告页被无意义视觉填满
 *   3. 热图需要能截图 —— 教练 60% 的实际使用是"截图发群里/发给球员看"
 *
 * 3x3 赛制下只有半场单框图，且不提供"全场/半场"切换。
 *
 * ⚠️ 投篮点颜色只表示命中/未中，**不表示分值**。
 *    分值文案一律取 event.label_zh（契约硬规则 #2）。
 */

const api = require('../../utils/api');
const { rate, madeOverAttempt, pct } = require('../../utils/format');
const { FORMAT } = require('../../utils/params');

const MODES = [
  { key: 'SHOTS', label: '投篮点' },
  { key: 'MOVEMENT', label: '跑动热区' },
  { key: 'MADE_DENSITY', label: '命中密度' },
];

/** 三分区划分：底角 / 翼侧 / 弧顶，篮球战术分析的关键分区 */
const ZONES = [
  { key: 'corner', label: '底角' },
  { key: 'wing', label: '翼侧 45°' },
  { key: 'top', label: '弧顶' },
  { key: 'paint', label: '禁区' },
  { key: 'mid', label: '中距离' },
];

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: '',

    params: null,
    report: null,
    is3v3: false,

    modes: MODES,
    activeMode: 'SHOTS',
    /** 跑动热区默认折叠（PRD 3.3 屏 09） */
    movementCollapsed: true,

    // 图层数据
    shots: [],
    heat: [],

    // 筛选
    periodOptions: [],
    activePeriod: 'ALL',
    activeZone: 'ALL',
    onlyMade: false,

    // 分区统计
    zoneStats: [],

    // 汇总
    summary: null,

    // 长按取点
    pickedPoint: null,
    pickedEvents: [],
    showPicked: false,

    arcOutsideLabel: '三分',
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
    let res = null;
    try { res = await api.getReport(activityId); }
    catch (e) { this.setData({ loading: false, loadError: e.message || '加载失败' }); return; }

    if (!res || !res.report) { this.setData({ loading: false, loadError: '报告尚未生成' }); return; }

    const report = res.report;
    const params = report.params || {};
    const is3v3 = params.format === FORMAT.THREE_V_THREE;

    const periods = (report.periods || []).map((p) => ({
      key: `P${p.index}`, label: is3v3 ? '单节' : `Q${p.index}`,
    }));

    this.setData({
      loading: false,
      report,
      params,
      is3v3,
      periodOptions: [{ key: 'ALL', label: '全场' }].concat(periods),
      arcOutsideLabel: is3v3 ? '远投' : '三分',
      // 3x3 只有半场，跑动热区意义更小，保持折叠
      movementCollapsed: true,
    });

    this._recompute();
  },

  /** 按当前筛选重算图层与统计 */
  _recompute() {
    const report = this.data.report;
    if (!report) return;

    const params = this.data.params || {};
    const radius = this._threePointRadius(params);

    let shots = (report.events || []).filter((e) => e.kind === 'SHOT' && e.x_m != null);

    if (this.data.activePeriod !== 'ALL') {
      const idx = Number(this.data.activePeriod.slice(1));
      shots = shots.filter((e) => e.period === idx);
    }
    if (this.data.onlyMade) shots = shots.filter((e) => e.made === true);
    // 半径缺失时不做分区筛选，避免用错误的弧线圈定区域
    if (this.data.activeZone !== 'ALL' && radius != null) {
      shots = shots.filter((e) => this._zoneOf(e.x_m, e.y_m, radius) === this.data.activeZone);
    }

    // 图层
    const mode = this.data.activeMode;
    let heat = [];
    if (mode === 'MOVEMENT') {
      // 跑动热区来自阵型采样点位（B 级不区分个人）
      (report.formations || []).forEach((f) => {
        (f.positions_m || []).forEach((p) => {
          if (Array.isArray(p) && p.length >= 2) heat.push({ x_m: p[0], y_m: p[1], weight: 1 });
        });
      });
    } else if (mode === 'MADE_DENSITY') {
      heat = shots.filter((s) => s.made).map((s) => ({ x_m: s.x_m, y_m: s.y_m, weight: 1 }));
    }

    const shotDots = mode === 'MOVEMENT' ? [] : shots.map((s) => ({
      id: s.id, x_m: s.x_m, y_m: s.y_m, made: !!s.made,
    }));

    this.setData({
      shots: shotDots,
      heat,
      zoneStats: this._zoneStats(report, params, radius),
      summary: this._summary(shots, params),
    });
  },

  /** 按距离与横向位置分区 */
  _zoneOf(x, y, radius) {
    const dist = Math.hypot(x, y);
    const lateral = Math.abs(y);

    if (dist <= 4.9) return 'paint';
    if (dist >= radius) {
      // 弧外再分底角与弧顶/翼侧
      if (lateral >= 5.5) return 'corner';
      if (lateral >= 3.0) return 'wing';
      return 'top';
    }
    return 'mid';
  },

  /**
   * 取三分线半径。
   *
   * ⚠️ 不做 `|| 6.75` 兜底（PRD 4.4：球场几何必须从 params 取值）。
   *    参数缺失时宁可放弃分区统计，也不能悄悄用成人半径去判青少年比赛 ——
   *    那正是 PRD 风险 7.4 的"静默错误数据"。
   *    court-svg 组件在这种情况下也会拒绝渲染并给出原因。
   */
  _threePointRadius(params) {
    const r = params && params.three_point_radius_m;
    if (!Number.isFinite(r) || r <= 0) {
      if (!this._radiusWarned) {
        this._radiusWarned = true;
        wx.showToast({ title: '报告缺少三分线半径，分区统计不可用', icon: 'none', duration: 3000 });
      }
      return null;
    }
    return r;
  },

  _zoneStats(report, params, radius) {
    const shots = (report.events || []).filter((e) => e.kind === 'SHOT' && e.x_m != null);
    const buckets = {};
    ZONES.forEach((z) => { buckets[z.key] = { made: 0, att: 0 }; });

    // 半径缺失时全部标记为不可用，不做分区 ——
    // 否则 dist >= null 恒真，所有球都会被算成弧外，是典型的静默错误
    const usable = Number.isFinite(radius) && radius > 0;

    if (usable) {
      shots.forEach((e) => {
        const z = this._zoneOf(e.x_m, e.y_m, radius);
        if (!buckets[z]) return;
        buckets[z].att += 1;
        if (e.made) buckets[z].made += 1;
      });
    }

    return ZONES.map((z) => ({
      key: z.key,
      label: z.key === 'top' && this.data.is3v3 ? `${z.label}` : z.label,
      made: buckets[z.key].made,
      att: buckets[z.key].att,
      text: madeOverAttempt(buckets[z.key].made, buckets[z.key].att),
      rateText: rate(buckets[z.key].made, buckets[z.key].att),
      empty: !usable || buckets[z.key].att === 0,
      unavailable: !usable,
    }));
  },

  _summary(shots, params) {
    const att = shots.length;
    const made = shots.filter((s) => s.made).length;
    const arcOut = shots.filter((s) => s.behind_three_point_line);
    const arcOutMade = arcOut.filter((s) => s.made).length;
    const oob = shots.filter((s) => s.in_bounds === false).length;

    return {
      att, made,
      fgText: madeOverAttempt(made, att),
      fgRate: rate(made, att),
      arcOutText: madeOverAttempt(arcOutMade, arcOut.length),
      arcOutRate: rate(arcOutMade, arcOut.length),
      oobCount: oob,
    };
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapMode(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    // 跑动热区默认折叠，主动切换才展开（PRD 3.3 屏 09）
    this.setData({
      activeMode: key,
      movementCollapsed: key !== 'MOVEMENT',
    });
    this._recompute();
  },

  onTapPeriod(e) {
    this.setData({ activePeriod: e.currentTarget.dataset.key || 'ALL' });
    this._recompute();
  },

  onTapZone(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeZone: this.data.activeZone === key ? 'ALL' : key });
    this._recompute();
  },

  onToggleOnlyMade(e) {
    this.setData({ onlyMade: e.detail.value });
    this._recompute();
  },

  /**
   * 长按球场 → 找出该位置附近的事件，可播放片段。
   * 对应 PRD 3.4「长按点位 = 触发片段」。
   */
  onCourtTap(e) {
    // court-svg 透传点击详情；小程序 image 拿不到内部坐标，
    // 这里用点击位置相对容器的比例反算米制坐标。
    const detail = (e && e.detail) || {};
    if (!detail.detail || !this._courtLayout) return;

    const { x, y } = detail.detail;
    const { width, height, left, top } = this._courtLayout;
    if (!width || !height) return;

    // 与 utils/svgBuilder 的坐标变换保持一致
    const params = this.data.params;
    const xMin = params.x_range_m ? params.x_range_m[0] : -1.575;
    const xMax = params.x_range_m ? params.x_range_m[1] : 26.425;
    const yHalf = params.y_half_m || 7.5;

    const relX = (x - left) / width;
    const relY = (y - top) / height;
    const yM = relX * (2 * yHalf) - yHalf;
    const xM = relY * (xMax - xMin) + xMin;

    const near = (this.data.report.events || [])
      .filter((ev) => ev.x_m != null)
      .map((ev) => ({ ev, d: Math.hypot(ev.x_m - xM, ev.y_m - yM) }))
      .filter((x) => x.d <= 1.5)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.ev);

    this.setData({
      pickedPoint: { x_m: Number(xM.toFixed(2)), y_m: Number(yM.toFixed(2)) },
      pickedEvents: near,
      showPicked: true,
    });
  },

  onCourtRender(e) {
    // 记录球场容器布局，供长按反算坐标
    wx.createSelectorQuery().select('.hm-court').boundingClientRect((rect) => {
      if (rect) this._courtLayout = rect;
    }).exec();
  },

  onClosePicked() { this.setData({ showPicked: false }); },

  /** 阻止浮层内容区点击冒泡到遮罩 */
  noop() {},

  onTapPickedEvent(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ showPicked: false });
    wx.navigateTo({
      url: `/pages/events/index?activityId=${this.data.activityId}&focus=${id}`,
    });
  },

  /**
   * 截图分享。
   *
   * 界面设计 v0.1.1 屏 09：教练 60% 的实际使用是截图发群里/发给球员看。
   * 第一版走小程序原生截图能力（页面快照），不做 canvas 重绘。
   */
  onShare() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    wx.showToast({ title: '点右上角「···」可截图或转发', icon: 'none', duration: 2500 });
  },

  onShareAppMessage() {
    const a = this.data.report && this.data.activity;
    return {
      title: a && a.name ? `${a.name} · 投篮热图` : '投篮热图',
      path: `/pages/heatmap/index?activityId=${this.data.activityId}`,
    };
  },

  onBack() {
    wx.redirectTo({ url: `/pages/report/index?activityId=${this.data.activityId}` });
  },
});
