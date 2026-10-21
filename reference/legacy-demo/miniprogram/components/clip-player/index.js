/**
 * clip-player —— 事件片段播放器（P1-F03）
 *
 * PRD 4.4：四个地方共用（补录浮层、热图长按、战术卡、对手战术板）。
 *
 * 关键行为（界面设计 v0.1.1 屏 07）：
 *   · 打开即自动播放 1.5 秒预览，教练不需要按播放键
 *   · 片段固定 8-15 秒（契约 clip_duration_s 的约束）
 *   · 循环播放，方便教练反复看同一个动作
 */

Component({
  properties: {
    /** 片段地址（CDN） */
    src: { type: String, value: '' },
    /** 契约里的 clip_start_s，仅用于展示时间戳 */
    startAt: { type: Number, value: 0 },
    /** 契约里的 clip_duration_s */
    duration: { type: Number, value: 0 },
    /** 是否自动播放 */
    autoplay: { type: Boolean, value: true },
    /** 是否循环 */
    loop: { type: Boolean, value: true },
    /** 左上角来源标签，如"比赛切片""训练切片" */
    sourceTag: { type: String, value: '' },
    /** 是否显示进度条 */
    showControls: { type: Boolean, value: true },
  },

  data: {
    currentTime: 0,
    durationText: '00:00',
    progressPct: 0,
    failed: false,
    loading: true,
  },

  observers: {
    src() {
      // 换片段时重置状态，避免上一段的进度残留
      this.setData({ currentTime: 0, progressPct: 0, failed: false, loading: true });
    },
    duration(v) {
      this.setData({ durationText: this._fmt(v) });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ durationText: this._fmt(this.data.duration) });
      // 契约要求片段 8-15 秒，超出说明切片服务有问题
      const d = this.data.duration;
      if (d && (d < 8 || d > 15)) {
        this.triggerEvent('contractwarn', {
          reason: `片段时长 ${d}s 不在契约要求的 8-15s 范围内（PRD 9.3 #3.7）`,
        });
      }
    },
  },

  methods: {
    _fmt(sec) {
      if (!Number.isFinite(sec) || sec < 0) return '00:00';
      const s = Math.floor(sec);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    },

    onTimeUpdate(e) {
      const cur = e.detail.currentTime || 0;
      const total = e.detail.duration || this.data.duration || 0;
      this.setData({
        currentTime: cur,
        loading: false,
        progressPct: total > 0 ? Math.min(100, (cur / total) * 100) : 0,
      });
    },

    onEnded() {
      this.triggerEvent('ended');
    },

    onError(e) {
      this.setData({ failed: true, loading: false });
      this.triggerEvent('error', { detail: e.detail });
    },

    onLoaded() {
      this.setData({ loading: false });
      this.triggerEvent('loaded');
    },

    /** 供父组件调用：暂停（浮层关闭时必须停，否则声音会继续） */
    pause() {
      const ctx = wx.createVideoContext('clip-video', this);
      if (ctx) ctx.pause();
    },

    play() {
      const ctx = wx.createVideoContext('clip-video', this);
      if (ctx) ctx.play();
    },
  },
});
