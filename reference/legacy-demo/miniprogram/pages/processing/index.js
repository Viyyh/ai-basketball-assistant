/**
 * 屏 05 · 处理中 —— AI Pipeline 状态
 *
 * 这一屏解决两个问题：为什么这么慢、什么时候能好。
 *
 * 界面设计 v0.1.1 屏 05 的硬要求：
 *   · 队列位置必须诚实。内测期一台 GPU 服务器串行处理，
 *     同时 5 场上传时最后一场要等 4-5 小时。
 *     **宁可显示"预计 3 小时"也不要给虚假的"30 分钟"。**
 *   · "为什么这么慢"说明卡常驻，透明化处理时长，降低心理阻力
 *   · 失败兜底：超 90 分钟无进展或步骤抛异常 → 切"处理异常"态，
 *     展示重试/联系客服，同时后台保留原视频不删除（PRD 3.13）
 */

const api = require('../../utils/api');
const { humanDuration } = require('../../utils/format');

/** 轮询间隔 */
const POLL_MS = 15 * 1000;
/** 超过这个分钟数无进展判定为异常（PRD 3.13） */
const STALL_MINUTES = 90;

Page({
  data: {
    activityId: '',
    activityName: '',

    status: 'processing',   // processing | done | failed
    queueAhead: 0,
    etaMinutes: 0,
    etaText: '',
    finishAtText: '',

    steps: [],
    currentStep: 0,
    currentStepPct: 0,

    subscribed: false,
    canSubscribe: true,

    stalled: false,
    errorText: '',
    elapsedMinutes: 0,

    videoDurationText: '',
  },

  async onLoad(query) {
    const activityId = (query && query.activityId) || '';
    const activity = activityId ? await api.getActivity(activityId) : null;

    this.setData({
      activityId,
      activityName: (activity && activity.name) || '录像',
      videoDurationText: activity && activity.durationS ? humanDuration(activity.durationS) : '',
      subscribed: this._hasSubscribed(),
    });

    this._startedAt = Date.now();
    await this.refresh();
    this._startPolling();
  },

  onUnload() { this._stopPolling(); },

  onHide() { this._stopPolling(); },
  onShow() { if (this.data.status === 'processing') this._startPolling(); },

  async refresh() {
    try {
      const st = await api.getProcessStatus(this.data.activityId);

      const steps = (st.steps || []).map((s, i) => {
        let state = 'todo';
        if (i + 1 < st.currentStep) state = 'done';
        else if (i + 1 === st.currentStep) state = 'doing';
        return Object.assign({}, s, { state, index: i + 1 });
      });

      // 诚实的预计时间：队列位置 × 单场处理时长 + 本场剩余
      const etaMinutes = st.etaMinutes || 0;
      const finishAt = new Date(Date.now() + etaMinutes * 60 * 1000);
      const finishAtText = etaMinutes
        ? `${String(finishAt.getHours()).padStart(2, '0')}:${String(finishAt.getMinutes()).padStart(2, '0')}`
        : '';

      const elapsedMinutes = Math.round((Date.now() - this._startedAt) / 60000);

      this.setData({
        status: st.status === 'done' ? 'done' : (st.status === 'failed' ? 'failed' : 'processing'),
        queueAhead: st.queueAhead || 0,
        etaMinutes,
        etaText: this._etaText(etaMinutes),
        finishAtText,
        steps,
        currentStep: st.currentStep || 0,
        elapsedMinutes,
        stalled: elapsedMinutes > STALL_MINUTES && (st.currentStep || 0) <= this._lastStep,
      });

      this._lastStep = st.currentStep || 0;

      if (st.status === 'done') {
        this._stopPolling();
        this._onReportReady();
      } else if (st.status === 'failed') {
        this._stopPolling();
        this.setData({ errorText: 'AI 处理过程中出现异常。原始录像已保留，可以重试。' });
      }
    } catch (e) {
      // 轮询失败不切换状态，只记录。避免网络抖动就把教练吓到。
      this.setData({ errorText: '' });
    }
  },

  _etaText(minutes) {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} 分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  },

  _startPolling() {
    this._stopPolling();
    this._poll = setInterval(() => this.refresh(), POLL_MS);
  },

  _stopPolling() {
    if (this._poll) { clearInterval(this._poll); this._poll = null; }
  },

  _onReportReady() {
    wx.showToast({ title: '报告已生成', icon: 'success' });
    setTimeout(() => {
      wx.redirectTo({ url: `/pages/report/index?activityId=${this.data.activityId}` });
    }, 800);
  },

  // ============================================================
  // 订阅消息
  // ============================================================

  _hasSubscribed() {
    try { return !!wx.getStorageSync('subscribed_report'); } catch (e) { return false; }
  },

  /**
   * 开启微信订阅消息。
   *
   * 走 wx.requestSubscribeMessage。模板 id 需要在小程序后台申请
   * （开发计划 P0-04），Mock 阶段用占位 id 走通交互即可。
   */
  onSubscribe() {
    const tmplIds = ['MOCK_TMPL_REPORT_READY'];
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        const accepted = tmplIds.some((id) => res[id] === 'accept');
        this.setData({ subscribed: accepted, canSubscribe: !accepted });
        if (accepted) {
          try { wx.setStorageSync('subscribed_report', true); } catch (e) { /* noop */ }
          wx.showToast({ title: '已开启，完成后通知你', icon: 'success' });
        } else {
          wx.showToast({ title: '未授权，可稍后在设置中开启', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ canSubscribe: false });
        wx.showToast({ title: '当前环境不支持订阅消息', icon: 'none' });
      },
    });
  },

  // ============================================================
  // 交互
  // ============================================================

  /** 处理是异步的，教练可以随时离开（PRD 3.4：异步任务永远可退出） */
  onLeave() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  onRetry() {
    this.setData({ status: 'processing', errorText: '', stalled: false });
    this._startedAt = Date.now();
    this.refresh();
    this._startPolling();
  },

  onContact() {
    wx.showModal({
      title: '联系支持',
      content: '内测阶段可直接联系产品负责人，请附上活动名称与大致时间，便于定位日志。',
      showCancel: false,
    });
  },

  onGoReport() {
    wx.redirectTo({ url: `/pages/report/index?activityId=${this.data.activityId}` });
  },
});
