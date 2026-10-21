/**
 * 屏 06 · 报告总览 —— 比赛 / 团队对抗
 *
 * 教练 80% 的时间会花在这页 + 屏 07（事件补录）。
 *
 * 承载的硬约束：
 *   · PRD 9.4 #4.8：口径标识（赛制 + 年龄段 + 场次）必须常驻
 *   · 契约 x-frontend-consumption-notes：warnings 非空时必须显示告警条；
 *     calibration.ok 为 false 时必须阻断，不得展示可能错误的坐标数据
 *   · PRD 6.3：篮板/助攻/抢断 AI 采不到，标注"未采集"，**不做假的估测**
 *   · PRD 3.3 屏 06：3对3 时比分卡改为 21 分制/单节，时间轴不分 4 节，
 *     "三分"文案全部改"远投"
 *   · 补录进度条常驻底部：没补完就一直提醒
 */

const api = require('../../utils/api');
const {
  clockTime, eventTimeText, humanDuration, madeOverAttempt, num, pct, rate,
  shortDate, scoreLabels, templateLabel,
} = require('../../utils/format');
const { FORMAT } = require('../../utils/params');

Page({
  data: {
    activityId: '',
    loading: true,
    notFound: false,
    stillProcessing: false,

    activity: null,
    report: null,
    params: null,

    // 口径与告警
    scopeText: '',
    warnings: [],
    calibrationBlocked: false,
    calibrationNote: '',

    // 顶部比分
    is3v3: false,
    isMatch: false,
    scoreHeader: null,

    // 时间轴
    periods: [],
    timeline: [],

    // 关键指标
    metrics: [],
    metricsNote: '',

    // 补录进度
    attribution: { total: 0, resolved: 0, pending: 0, percent: 0, complete: false },

    // 入口卡
    entries: [],

    // 标签文案随赛制变化
    arcOutsideLabel: '三分',
    arcInsideLabel: '二分',
  },

  onLoad(query) {
    this.setData({ activityId: (query && query.activityId) || '' });
  },

  onShow() {
    // 从补录页返回时进度可能变了，每次显示都重算
    if (this.data.activityId) this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    const { activityId } = this.data;
    if (!activityId) { this.setData({ loading: false, notFound: true }); return; }

    this.setData({ loading: true });

    let res = null;
    try {
      res = await api.getReport(activityId);
    } catch (e) {
      this.setData({ loading: false, notFound: true });
      return;
    }

    if (!res) { this.setData({ loading: false, notFound: true }); return; }

    // 还在上传/处理中 → 引导去处理进度页
    if (res.status === 'processing' || res.status === 'uploading' || !res.report) {
      this.setData({ loading: false, stillProcessing: true });
      return;
    }

    const report = res.report;
    const params = report.params || {};
    const activity = res.activity || {};
    const is3v3 = params.format === FORMAT.THREE_V_THREE;

    // 标定不合格 → 阻断，不展示可能错误的坐标数据
    const calib = report.calibration || {};
    if (calib.ok === false) {
      this.setData({
        loading: false,
        report,
        params,
        activity,
        calibrationBlocked: true,
        calibrationNote: calib.note || `重投影误差 ${calib.reproj_error_px} px 超过 5 px 阈值`,
        warnings: report.warnings || [],
      });
      return;
    }

    const labels = scoreLabels(params.format);

    this.setData({
      loading: false,
      report,
      params,
      activity,
      is3v3,
      isMatch: activity.template === 'MATCH',
      arcOutsideLabel: labels.outside,
      arcInsideLabel: labels.inside,
      scopeText: this._scopeText(params, activity),
      warnings: report.warnings || [],
      calibrationBlocked: false,
      scoreHeader: this._buildScoreHeader(activity, params, report, is3v3),
      periods: report.periods || [],
      timeline: this._buildTimeline(report, is3v3),
      metrics: this._buildMetrics(report, params, is3v3),
      metricsNote: this._metricsNote(report),
      attribution: this._buildAttribution(report),
      entries: this._buildEntries(params, is3v3),
    });
  },

  // ============================================================
  // 口径
  // ============================================================

  /** 口径标识常驻（PRD 9.4 #4.8） */
  _scopeText(params, activity) {
    const bits = [];
    if (params.format) bits.push({ '5V5': '5 对 5', '4V4': '4 对 4', '3V3': '3 对 3', CUSTOM: '自定义' }[params.format] || params.format);
    if (params.age_group) {
      bits.push({ U8: '8岁以下', U12: '12岁以下', U15: '15岁以下', U18: '18岁以下', SENIOR: '一线' }[params.age_group] || params.age_group);
    }
    if (params.three_point_radius_m) bits.push(`三分线 ${params.three_point_radius_m} m`);
    if (activity && activity.playedAt) bits.unshift(shortDate(activity.playedAt));
    return bits.join(' · ');
  },

  // ============================================================
  // 顶部比分
  // ============================================================

  _buildScoreHeader(activity, params, report, is3v3) {
    const stats = report.team_stats || {};

    if (is3v3) {
      // 3x3：21 分制 / 单节 10 分钟，不显示 4 节比分
      return {
        mode: '3v3',
        left: activity.name || '我方',
        right: activity.opponentName || '对手',
        scoreFor: activity.scoreFor != null ? activity.scoreFor : null,
        scoreAgainst: activity.scoreAgainst != null ? activity.scoreAgainst : null,
        meta: `单节 ${params.period_minutes || 10} 分钟或先得 ${params.win_score || 21} 分 · 12 秒进攻时限`,
        note: '弧内 1 分 / 弧外 2 分',
      };
    }

    return {
      mode: '5v5',
      left: '我方',
      right: activity.opponentName || '对手',
      scoreFor: activity.scoreFor != null ? activity.scoreFor : null,
      scoreAgainst: activity.scoreAgainst != null ? activity.scoreAgainst : null,
      meta: [
        `${params.period_count || 4} 节 × ${params.period_minutes || 10} 分钟`,
        activity.durationS ? humanDuration(activity.durationS) : '',
        activity.venue || '',
      ].filter(Boolean).join(' · '),
      note: `${params.shot_clock_s || 24} 秒进攻时限`,
    };
  },

  // ============================================================
  // 时间轴
  // ============================================================

  /**
   * 每节一条色带，事件按命中/未中着色。
   * 3x3 无节次，只出一条整体色带。
   */
  _buildTimeline(report, is3v3) {
    const events = report.events || [];
    const periods = report.periods || [];
    if (!periods.length) return [];

    return periods.map((p) => {
      const inPeriod = events.filter((e) => e.timestamp_s >= p.start_s && e.timestamp_s < p.end_s);
      const span = Math.max(1, p.end_s - p.start_s);

      const marks = inPeriod.map((e) => {
        const pos = ((e.timestamp_s - p.start_s) / span) * 100;
        let tone = 'neutral';
        if (e.kind === 'SHOT') tone = e.made ? 'made' : 'miss';
        else if (e.kind === 'TURNOVER') tone = 'miss';
        else if (e.kind === 'FAST_BREAK') tone = 'made';
        return { id: e.id, pos: Math.max(0, Math.min(100, pos)), tone };
      });

      return {
        index: p.index,
        label: is3v3 ? '单节' : `Q${p.index}`,
        startText: clockTime(p.start_s),
        endText: clockTime(p.end_s),
        eventCount: inPeriod.length,
        marks,
      };
    });
  },

  // ============================================================
  // 关键指标
  // ============================================================

  /**
   * 4 个 tile。
   *
   * ⚠️ PRD 6.3：篮板 / 助攻 / 抢断 AI 采不到，第一版标注"未采集"，
   *    **不做假的估测**。这里给 null，页面显示「—」。
   */
  _buildMetrics(report, params, is3v3) {
    const s = report.team_stats || {};
    const labels = scoreLabels(params.format);

    return [
      {
        key: 'arcOut',
        label: is3v3 ? '远投(2分)' : '三分',
        value: madeOverAttempt(s.arc_out_made, s.arc_out_attempted),
        sub: rate(s.arc_out_made, s.arc_out_attempted),
        source: 'ai',
        available: true,
      },
      {
        key: 'fg',
        label: '投篮命中',
        value: madeOverAttempt(s.shots_made, s.shots_attempted),
        sub: rate(s.shots_made, s.shots_attempted),
        source: 'ai',
        available: true,
      },
      {
        key: 'fastBreak',
        label: '快攻',
        value: is3v3 ? '不适用' : num(s.fast_breaks),
        sub: is3v3 ? '12 秒时限下已关闭' : '回合数',
        source: 'ai',
        available: !is3v3,
      },
      {
        key: 'turnover',
        label: '失误',
        value: num(s.turnovers),
        sub: '需补录归属',
        source: 'mixed',
        available: true,
      },
    ];
  },

  /** 篮板/助攻/抢断的诚实说明 */
  _metricsNote(report) {
    return '篮板、助攻、抢断、盖帽需 AI 逐人识别，第一版暂不采集；'
      + '可在事件列表中手动补录归属后由后端汇总。';
  },

  // ============================================================
  // 补录进度
  // ============================================================

  _buildAttribution(report) {
    const events = report.events || [];
    const total = events.length;
    const resolved = events.filter((e) =>
      e.player_id || e.attribution_source === 'UNKNOWN'
      || e.attribution_source === 'NOT_OUR_TEAM' || e.skipped
    ).length;
    const pending = total - resolved;
    return {
      total,
      resolved,
      pending,
      percent: total ? Math.round((resolved / total) * 100) : 0,
      complete: total > 0 && pending === 0,
    };
  },

  // ============================================================
  // 入口卡
  // ============================================================

  /**
   * 入口顺序按教练使用频率排（界面设计 v0.1.1 屏 06 注释）：
   * 事件列表 > 热图 > 精彩片段 > 阵型
   */
  _buildEntries(params, is3v3) {
    const a = this.data.attribution;
    return [
      {
        key: 'events', icon: '📝', title: '事件列表',
        sub: a.pending > 0 ? `待补录 ${a.pending}` : `共 ${a.total} 个`,
        tone: a.pending > 0 ? 'warn' : 'fill',
        url: `/pages/events/index?activityId=${this.data.activityId}`,
      },
      {
        key: 'heatmap', icon: '🔥', title: '投篮热图',
        sub: is3v3 ? '半场单框视角' : '按点 · 分区域',
        tone: 'fill',
        url: `/pages/heatmap/index?activityId=${this.data.activityId}`,
      },
      {
        key: 'clips', icon: '🎬', title: '精彩片段',
        sub: '按快攻 / 连中筛选',
        tone: 'fill',
        url: `/pages/events/index?activityId=${this.data.activityId}&filter=FAST_BREAK`,
        disabled: is3v3,
        disabledReason: '3x3 赛制第一版关闭快攻识别',
      },
      {
        key: 'formation', icon: '📍', title: '阵型快照',
        sub: `每 ${params.formation_sample_interval_s || 5} 秒一次`,
        tone: 'fill',
        url: `/pages/formation/index?activityId=${this.data.activityId}`,
      },
    ];
  },

  // ============================================================
  // 交互
  // ============================================================

  onTapEntry(e) {
    const { url, disabled, reason } = e.currentTarget.dataset;
    if (disabled) {
      wx.showToast({ title: reason || '该赛制下暂不可用', icon: 'none' });
      return;
    }
    if (url) wx.navigateTo({ url });
  },

  /** 补录进度条 → 直接跳事件列表的"未补录"筛选 */
  onTapAttribution() {
    wx.navigateTo({
      url: `/pages/events/index?activityId=${this.data.activityId}&filter=PENDING`,
    });
  },

  /** 时间轴点节次 → 跳到该节首个事件 */
  onTapPeriod(e) {
    const index = e.currentTarget.dataset.index;
    wx.navigateTo({
      url: `/pages/events/index?activityId=${this.data.activityId}&period=${index}`,
    });
  },

  onGoProcessing() {
    wx.redirectTo({ url: `/pages/processing/index?activityId=${this.data.activityId}` });
  },

  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) }); },
});
