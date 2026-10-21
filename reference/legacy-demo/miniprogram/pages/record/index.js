/**
 * 屏 03 · 录制页
 *
 * 设计原则（界面设计 v0.1.1 屏 03 红色注释）：
 *   按下去之后教练就不该再操作手机。屏幕只做两件事：给你信心 + 让你能停。
 *   **禁止一切分心元素** —— 不放实时分数、不放热图、不放"当前阵型"。
 *
 * 合规闸门（PRD 3.7 / 9.4 #4.10）：
 *   未同意《内测告知》不得开始录制；同意后状态存本地，不再弹。
 *
 * 边界情况：
 *   · 微信切后台 → 录制继续，顶部提示"退出会中断，请尽快回来"
 *   · 电量 < 20% → 红色提示
 *   · 存储不足 → 直接拒绝开始
 *   · 意外崩溃 → 下次进入询问"是否恢复上一段"
 *
 * 套路演练模板额外提供"标记套路起止"浮动按钮（不做也能跑，做了精度更高）。
 */

const api = require('../../utils/api');
const { clockTime } = require('../../utils/format');

/** 电量低于此值给红色提示 */
const LOW_BATTERY = 20;
/** 预估每分钟 1080p 录像占用（MB），用于存储空间校验 */
const MB_PER_MINUTE = 130;

Page({
  data: {
    activityId: '',
    activity: null,
    activityLabel: '',

    /** 是否已同意内测告知 */
    consented: false,
    showConsent: false,

    /** 录制状态 */
    recording: false,
    paused: false,
    elapsedS: 0,
    elapsedText: '00:00:00',

    /** 设备状态 */
    battery: 100,
    lowBattery: false,
    networkType: '',
    storageShort: false,

    /** 切后台提示 */
    hidden: false,

    /** 可恢复的上一段 */
    recoverable: null,

    /** 套路演练标记 */
    isRoutine: false,
    routineMarks: [],
    marking: false,

    /** 赛制标识（录制页顶部信息条） */
    scopeText: '',

    stopping: false,
  },

  async onLoad(query) {
    const activityId = (query && query.activityId) || '';
    const app = getApp();

    let activity = null;
    if (activityId) activity = await api.getActivity(activityId);

    this.setData({
      activityId,
      activity,
      activityLabel: activity ? activity.name : '未命名活动',
      isRoutine: activity && activity.template === 'ROUTINE',
      scopeText: activity
        ? [activity.format, activity.ageGroup].filter(Boolean).join(' · ')
        : '',
      consented: app.hasConsented ? app.hasConsented() : false,
    });

    this._checkDevice();
    this._checkRecoverable();
  },

  onUnload() {
    this._clearTimer();
    // 页面被销毁但仍在录制 → 记录可恢复状态
    if (this.data.recording && this.ctx) {
      this._saveRecoverable();
    }
  },

  onHide() {
    // 微信切后台：录制继续，但提示教练尽快回来
    this.setData({ hidden: true });
  },

  onShow() {
    if (this.data.hidden) this.setData({ hidden: false });
  },

  // ============================================================
  // 设备与环境检查
  // ============================================================

  _checkDevice() {
    try {
      wx.getSystemInfo({
        success: (info) => {
          const battery = info.batteryLevel != null ? info.batteryLevel : 100;
          this.setData({ battery, lowBattery: battery < LOW_BATTERY });
        },
      });
    } catch (e) { /* 拿不到电量不阻塞录制 */ }

    try {
      wx.getNetworkType({
        success: (res) => this.setData({ networkType: res.networkType || '' }),
      });
    } catch (e) { /* 同上 */ }
  },

  /**
   * 存储空间校验。
   * 不足时**直接拒绝开始** —— 录到一半存不下会丢失整场数据。
   */
  _checkStorage() {
    return new Promise((resolve) => {
      wx.getStorageInfo({
        success: (info) => {
          // info.limitSize 单位 KB；预估 60 分钟录像需要约 7.8 GB
          const limitMB = (info.limitSize || 0) / 1024;
          const currentMB = (info.currentSize || 0) / 1024;
          const freeMB = Math.max(0, limitMB - currentMB);
          const needMB = MB_PER_MINUTE * 60;
          const short = freeMB < needMB;
          this.setData({ storageShort: short });
          resolve({ ok: !short, freeMB });
        },
        fail: () => resolve({ ok: true, freeMB: null }),   // 查不到就不拦
      });
    });
  },

  _checkRecoverable() {
    let rec = null;
    try { rec = wx.getStorageSync('recoverable_recording') || null; } catch (e) { rec = null; }
    if (rec && rec.activityId) this.setData({ recoverable: rec });
  },

  _saveRecoverable() {
    try {
      wx.setStorageSync('recoverable_recording', {
        activityId: this.data.activityId,
        activityName: this.data.activityLabel,
        elapsedS: this.data.elapsedS,
        savedAt: Date.now(),
      });
    } catch (e) { /* storage 写失败不影响录制 */ }
  },

  _clearRecoverable() {
    try { wx.removeStorageSync('recoverable_recording'); } catch (e) { /* noop */ }
  },

  onDismissRecoverable() {
    this._clearRecoverable();
    this.setData({ recoverable: null });
  },

  onRestoreRecoverable() {
    const rec = this.data.recoverable;
    if (!rec) return;
    // 第一版不做真正的续录（camera 组件无法追加到已有文件），
    // 只能引导教练去上传已录好的那段。
    this._clearRecoverable();
    this.setData({ recoverable: null });
    wx.showModal({
      title: '发现未完成的录制',
      content: `${rec.activityName || '录像'} 已录 ${clockTime(rec.elapsedS || 0)}。`
        + '小程序无法在原文件上续录，你可以把已录的部分上传，或重新开始录一场。',
      confirmText: '上传已录部分',
      cancelText: '重新录制',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: `/pages/upload/index?activityId=${rec.activityId}` });
        }
      },
    });
  },

  // ============================================================
  // 合规闸门
  // ============================================================

  /**
   * 点"开始录制"。
   *
   * 顺序：合规同意 → 存储检查 → 摄像头授权 → 开始。
   * 任何一步不过都不进入录制态。
   */
  async onStart() {
    if (this.data.recording) return;

    // 1. 内测告知（PRD 9.4 #4.10：未同意无法开始录制）
    if (!this.data.consented) {
      this.setData({ showConsent: true });
      return;
    }

    // 2. 存储空间
    const st = await this._checkStorage();
    if (!st.ok) {
      wx.showModal({
        title: '存储空间不足',
        content: `剩余约 ${Math.round(st.freeMB / 1024)} GB，录满 60 分钟需要约 8 GB。`
          + '请清理微信缓存后重试。',
        showCancel: false,
      });
      return;
    }

    // 3. 摄像头授权
    const ok = await this._ensureCameraAuth();
    if (!ok) return;

    this._beginRecording();
  },

  _ensureCameraAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.camera']) { resolve(true); return; }
          if (res.authSetting['scope.camera'] === false) {
            // 之前拒绝过，只能引导去设置页
            wx.showModal({
              title: '需要摄像头权限',
              content: '录制比赛需要摄像头权限，请在设置中开启。',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting({ success: () => resolve(false) });
                else resolve(false);
              },
            });
            return;
          }
          wx.authorize({
            scope: 'scope.camera',
            success: () => resolve(true),
            fail: () => resolve(false),
          });
        },
        fail: () => resolve(false),
      });
    });
  },

  onConsentAgree() {
    const app = getApp();
    if (app.acceptConsent) app.acceptConsent();
    this.setData({ consented: true, showConsent: false });
    // 同意后直接继续开始录制，不让教练再点一次
    this.onStart();
  },

  onConsentDecline() {
    this.setData({ showConsent: false });
    wx.showToast({ title: '需同意后才能录制', icon: 'none' });
  },

  // ============================================================
  // 录制
  // ============================================================

  _beginRecording() {
    // camera 组件的 context
    this.ctx = wx.createCameraContext();
    this.setData({ recording: true, elapsedS: 0, elapsedText: '00:00:00' });

    this.ctx.startRecord({
      success: () => { this._startTimer(); },
      fail: (err) => {
        this.setData({ recording: false });
        wx.showModal({
          title: '无法开始录制',
          content: (err && err.errMsg) || '摄像头启动失败，请确认权限已开启且未被其他应用占用。',
          showCancel: false,
        });
      },
    });
  },

  _startTimer() {
    this._clearTimer();
    this._timer = setInterval(() => {
      const s = this.data.elapsedS + 1;
      this.setData({ elapsedS: s, elapsedText: clockTime(s) });
      // 每 30 秒落一次可恢复状态，崩溃后能知道录到哪
      if (s % 30 === 0) this._saveRecoverable();
    }, 1000);
  },

  _clearTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  /** camera 组件报错（被其他应用占用、硬件异常等） */
  onCameraError(e) {
    this._clearTimer();
    this.setData({ recording: false, stopping: false });
    const msg = (e && e.detail && e.detail.errMsg) || '摄像头不可用';
    wx.showModal({
      title: '摄像头异常',
      content: `${msg}\n\n请确认：\n1. 相机权限已开启\n2. 没有其他应用正在使用摄像头\n3. 手机存储充足`,
      showCancel: false,
    });
  },

  /**
   * 结束录制。
   *
   * ⚠️ 界面设计 v0.1.1 屏 03：这是录制页唯一允许的交互。
   *    不要加二次确认 —— 教练在场边，多点一次都是负担；
   *    误触的代价（重录）小于每次确认的代价（打断节奏）。
   */
  onStop() {
    if (!this.data.recording || this.data.stopping) return;
    this.setData({ stopping: true });
    this._clearTimer();

    this.ctx.stopRecord({
      success: (res) => {
        this._clearRecoverable();
        this.setData({ recording: false, stopping: false });

        const elapsedS = this.data.elapsedS;
        // 直接进入上传页，把临时文件路径带过去
        const path = encodeURIComponent(res.tempThumbPath || res.tempVideoPath || '');
        wx.redirectTo({
          url: `/pages/upload/index?activityId=${this.data.activityId}`
             + `&localPath=${path}&elapsedS=${elapsedS}`,
        });
      },
      fail: (err) => {
        this.setData({ stopping: false });
        wx.showModal({
          title: '保存录像失败',
          content: (err && err.errMsg) || '录像未能保存。已录内容可能丢失，请重新开始。',
          showCancel: false,
        });
      },
    });
  },

  // ============================================================
  // 套路演练标记
  // ============================================================

  /**
   * 标记套路起止。
   *
   * 界面设计 v0.1.1 屏 03 注释：每段套路开始时点一下，结束时再点一下，
   * 报告才能按套路分段。不点也能跑（AI 用启发式识别），但精度会下降。
   */
  onMarkRoutine() {
    const marks = this.data.routineMarks.slice();
    const now = this.data.elapsedS;

    if (this.data.marking) {
      // 结束当前段
      const last = marks[marks.length - 1];
      if (last && last.endS == null) {
        last.endS = now;
        last.durationS = now - last.startS;
      }
      this.setData({ routineMarks: marks, marking: false });
      wx.showToast({ title: '本段结束', icon: 'none' });
    } else {
      marks.push({ index: marks.length + 1, startS: now, endS: null, durationS: null });
      this.setData({ routineMarks: marks, marking: true });
      wx.showToast({ title: `第 ${marks.length} 段开始`, icon: 'none' });
    }
  },
});
