/**
 * 屏 08 · 阵型快照
 *
 * PRD 3.3 屏 08 的降级要求：
 *   阵型识别第一版准确率可能只有 60-70%，教练会觉得"不准"。
 *   折中方案：**只显示密集度，不给具体阵型名**。
 *   阵型名作为可选标签，低于置信度就不显示 —— 宁可少标不要标错。
 *
 *   契约层面这条已被强制：formations[].label 在置信度不足时必须为 null
 *   （PRD 9.2 #2.14），Mock 也刻意让 ≥25% 的 label 为 null 以覆盖此路径。
 *
 * 3x3 赛制下阵型点数为 3 而非 5（params.formation_points 驱动）。
 */

const api = require('../../utils/api');
const { clockTime, eventTimeText } = require('../../utils/format');
const { FORMAT } = require('../../utils/params');

/** 低于此置信度不显示阵型名 */
const LABEL_CONFIDENCE = 0.6;

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: '',

    params: null,
    report: null,
    is3v3: false,

    // 时段筛选
    scopes: [],
    activeScope: 'ALL',

    // 时间轴
    frames: [],          // 过滤后的阵型帧
    frameIndex: 0,
    totalFrames: 0,
    sliderMax: 0,

    // 当前帧
    currentFrame: null,
    currentTimeText: '',
    currentLabel: '',
    currentConfidence: 0,
    labelSuppressed: false,   // 置信度不足被抑制
    positions: [],
    numbers: [],
    ball: null,

    playing: false,
    sampleInterval: 5,

    // 收藏
    collected: [],
  },

  async onLoad(query) {
    const activityId = (query && query.activityId) || '';
    this.setData({ activityId });
    await this.load();
  },

  onUnload() { this._stopPlay(); },
  onHide() { this._stopPlay(); },

  async load() {
    const { activityId } = this.data;
    if (!activityId) { this.setData({ loading: false, loadError: '缺少活动 id' }); return; }

    this.setData({ loading: true });
    let res = null;
    try { res = await api.getReport(activityId); }
    catch (e) { this.setData({ loading: false, loadError: e.message || '加载失败' }); return; }

    if (!res || !res.report || !res.report.formations || !res.report.formations.length) {
      this.setData({ loading: false, loadError: '本场没有阵型数据' });
      return;
    }

    const report = res.report;
    const params = report.params || {};
    const is3v3 = params.format === FORMAT.THREE_V_THREE;

    // 时段筛选：本节 / 全场 / 进攻 / 防守
    const periods = report.periods || [];
    const scopes = [{ key: 'ALL', label: is3v3 ? '全场' : '全场' }];
    if (!is3v3) {
      periods.forEach((p) => scopes.push({ key: `P${p.index}`, label: `Q${p.index}` }));
    }

    // 球员号码，按名单顺序对应阵型点位
    const roster = await api.getRoster();
    const starters = roster.filter((p) => p.isStarter).slice(0, params.formation_points || 5);
    const numbers = starters.map((p) => String(p.number));

    this.setData({
      loading: false,
      report,
      params,
      is3v3,
      scopes,
      numbers,
      sampleInterval: params.formation_sample_interval_s || 5,
    });

    this._applyScope('ALL');
  },

  _applyScope(key) {
    const report = this.data.report;
    if (!report) return;

    let frames = report.formations.slice();
    if (key !== 'ALL' && key.startsWith('P')) {
      const idx = Number(key.slice(1));
      frames = frames.filter((f) => f.period === idx);
    }

    if (!frames.length) {
      this.setData({ activeScope: key, frames: [], totalFrames: 0, sliderMax: 0, currentFrame: null });
      return;
    }

    frames.sort((a, b) => a.timestamp_s - b.timestamp_s);

    this.setData({
      activeScope: key,
      frames,
      totalFrames: frames.length,
      sliderMax: frames.length - 1,
      frameIndex: 0,
    });
    this._renderFrame(0);
  },

  /**
   * 渲染指定帧。
   *
   * ⚠️ label 为 null 时不显示阵型名，只显示"密集度"（PRD 3.3 屏 08）。
   *    这里的判断与契约约束一致，且额外用 LABEL_CONFIDENCE 兜一层：
   *    即使后端误给了 label，置信度不够也不显示。
   */
  _renderFrame(index) {
    const frames = this.data.frames;
    if (!frames.length) return;

    const i = Math.max(0, Math.min(frames.length - 1, index));
    const f = frames[i];

    const confidence = Number.isFinite(f.confidence) ? f.confidence : 0;
    const labelSuppressed = !f.label || confidence < LABEL_CONFIDENCE;

    this.setData({
      frameIndex: i,
      currentFrame: f,
      currentTimeText: eventTimeText(f.timestamp_s, this.data.report.periods, this.data.params.format),
      currentLabel: labelSuppressed ? '' : f.label,
      currentConfidence: confidence,
      labelSuppressed,
      positions: f.positions_m || [],
      ball: f.ball_m || null,
    });
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapScope(e) {
    const key = e.currentTarget.dataset.key;
    if (key) this._applyScope(key);
  },

  onSliderChange(e) {
    this._renderFrame(e.detail.value);
  },

  onStepPrev() { this._renderFrame(this.data.frameIndex - 1); },
  onStepNext() { this._renderFrame(this.data.frameIndex + 1); },

  /** 播放阵型演变：按采样间隔连续播放 */
  onTogglePlay() {
    if (this.data.playing) { this._stopPlay(); return; }
    if (this.data.frames.length < 2) {
      wx.showToast({ title: '帧数不足，无法播放', icon: 'none' });
      return;
    }
    this.setData({ playing: true });
    this._playTimer = setInterval(() => {
      const next = this.data.frameIndex + 1;
      if (next >= this.data.frames.length) { this._stopPlay(); return; }
      this._renderFrame(next);
    }, 320);
  },

  _stopPlay() {
    if (this._playTimer) { clearInterval(this._playTimer); this._playTimer = null; }
    if (this.data.playing) this.setData({ playing: false });
  },

  /**
   * 收藏这一帧。
   *
   * 界面设计 v0.1.1 屏 08 注释：教练常常想截图发到群里讨论战术。
   * 第一版做成"截图保存到相册 + 记录到本地收藏列表"。
   */
  onCollect() {
    const f = this.data.currentFrame;
    if (!f) return;

    const collected = this.data.collected.concat([{
      activityId: this.data.activityId,
      timestampS: f.timestamp_s,
      timeText: this.data.currentTimeText,
      label: this.data.currentLabel || '未识别阵型',
      at: Date.now(),
    }]);
    this.setData({ collected });

    try { wx.setStorageSync(`formations_collected_${this.data.activityId}`, collected); }
    catch (e) { /* storage 满不影响主流程 */ }

    wx.showToast({ title: '已收藏这一帧', icon: 'success' });
  },

  onBack() {
    wx.redirectTo({ url: `/pages/report/index?activityId=${this.data.activityId}` });
  },
});
