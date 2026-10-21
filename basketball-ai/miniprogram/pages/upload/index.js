/**
 * 屏 04 · 上传中 —— P2-F02
 *
 * 验收对应 PRD 9.3：
 *   #3.1 40 分钟 1080p 上传成功率 ≥ 95%
 *   #3.2 中断 3 次内仍能完成，已传分片不重传
 *   #3.3 小程序切后台 ≥ 10 分钟上传不中断
 *
 * 界面设计 v0.1.1 屏 04 的两条硬要求：
 *   · 剩余时间用「滚动 30 秒平均速率」，不用整体平均（网络波动时估算会跳变）
 *   · 「取消」不是删除：只中止上传，本地视频保留 24 小时，可从首页找回
 *
 * 核心信息优先级：进度百分比 > 剩余时间 > "可以离开"绿色卡片
 */

const api = require('../../utils/api');
const {
  createUploadSession,
  formatBytes,
  formatDuration,
  DEFAULT_CHUNK_SIZE,
} = require('../../utils/upload');

/** 轮询/推进间隔 */
const TICK_MS = 1000;
/** 单分片上传超时 */
const CHUNK_TIMEOUT_MS = 60 * 1000;

Page({
  data: {
    activityId: '',
    activityName: '',
    filePath: '',
    fileSize: 0,

    status: 'preparing',   // preparing | uploading | paused | done | failed | cancelled
    percent: 0,
    uploadedText: '0 B',
    totalText: '0 B',
    etaText: '计算中…',
    etaUnstable: false,
    rateText: '',

    uploadedChunks: 0,
    totalChunks: 0,

    /** 已中断次数（用于验证 PRD 3.2） */
    interruptionCount: 0,

    wifiOnly: false,
    networkType: '',
    networkBlocked: false,

    canLeave: true,
    errorText: '',
  },

  async onLoad(query) {
    const activityId = (query && query.activityId) || '';
    const filePath = query && query.localPath ? decodeURIComponent(query.localPath) : '';
    const elapsedS = Number((query && query.elapsedS) || 0);

    let activity = null;
    if (activityId) activity = await api.getActivity(activityId);

    this.setData({
      activityId,
      activityName: (activity && activity.name) || '未命名录像',
      filePath,
    });

    // 尝试恢复上次的断点（PRD 3.2 / 3.11）
    this._restoreSession(activityId);

    if (filePath) {
      this._statFile(filePath, elapsedS);
    } else {
      // 没有本地路径（例如从首页"继续上传"进来但文件已失效）
      this.setData({
        status: 'failed',
        errorText: '找不到本地录像文件。可能已超过 24 小时保留期，需要重新录制。',
      });
    }
  },

  onUnload() {
    this._stopTicking();
    // 页面销毁时把断点存盘，下次进来能续传
    this._persist();
  },

  onHide() {
    // 切后台：上传继续（PRD 3.3）。这里只落盘一次断点，不停止。
    this._persist();
  },

  // ============================================================
  // 会话初始化与恢复
  // ============================================================

  _restoreSession(activityId) {
    if (!activityId) return;
    let persisted = null;
    try {
      const all = wx.getStorageSync('upload_state') || {};
      persisted = all[activityId] || null;
    } catch (e) { persisted = null; }

    if (persisted && Array.isArray(persisted.uploadedIndices) && persisted.uploadedIndices.length) {
      this._persistedSeed = persisted;
      this.setData({
        uploadedChunks: persisted.uploadedIndices.length,
        interruptionCount: (persisted.interruptionCount || 0),
      });
    }
  },

  _statFile(filePath, elapsedS) {
    wx.getFileInfo({
      filePath,
      success: (info) => {
        const fileSize = info.size || this._estimateSize(elapsedS);
        this._initSession(filePath, fileSize);
      },
      fail: () => {
        // 拿不到真实大小就用录像时长估算（1080p 约 130 MB/分钟）
        const fileSize = this._estimateSize(elapsedS);
        if (fileSize > 0) this._initSession(filePath, fileSize);
        else this.setData({ status: 'failed', errorText: '无法读取录像文件信息' });
      },
    });
  },

  _estimateSize(elapsedS) {
    if (!elapsedS || elapsedS <= 0) return 0;
    return Math.round((elapsedS / 60) * 130 * 1024 * 1024);
  },

  async _initSession(filePath, fileSize) {
    // 先取 STS 直传凭证（PRD 5.2：直传对象存储，不经业务服务器中转）
    let cred = null;
    try {
      cred = await api.getUploadCredential(this.data.activityId);
    } catch (e) {
      this.setData({ status: 'failed', errorText: `获取上传凭证失败：${e.message || e}` });
      return;
    }
    this._cred = cred;

    this.session = createUploadSession({
      activityId: this.data.activityId,
      filePath,
      fileSize,
      chunkSize: DEFAULT_CHUNK_SIZE,
      persisted: this._persistedSeed || null,
    });

    const p = this.session.progress();
    this.setData({
      status: 'uploading',
      fileSize,
      totalText: formatBytes(fileSize),
      uploadedText: formatBytes(p.uploadedBytes),
      percent: p.percent,
      uploadedChunks: p.uploadedChunks,
      totalChunks: p.totalChunks,
    });

    this.session.start();
    this._startTicking();
    this._pumpNext();
  },

  // ============================================================
  // 上传推进
  // ============================================================

  /**
   * 取下一个分片并上传。
   *
   * 串行推进（一次一片）：小程序并发上传容易触发限流，
   * 而且串行对断点续传最友好 —— 恢复后只需从第一个缺口继续。
   */
  _pumpNext() {
    if (!this.session) return;
    if (this.data.status === 'paused' || this.data.status === 'cancelled') return;

    const chunk = this.session.nextChunk();
    if (!chunk) {
      if (this.session.isComplete()) this._onComplete();
      return;
    }

    this._uploadChunk(chunk);
  },

  _uploadChunk(chunk) {
    this._inflight = true;

    // 真实实现：wx.uploadFile 或 COS SDK 的分片上传接口。
    // Mock 分支下用定时器模拟分片耗时，让 UI 与断点逻辑可被完整验证。
    if (api.USE_MOCK) {
      const bytesPerSec = 3.2 * 1024 * 1024;   // 模拟 3.2 MB/s
      const ms = Math.max(300, (chunk.size / bytesPerSec) * 1000);
      this._mockTimer = setTimeout(() => {
        this._inflight = false;
        this._onChunkDone(chunk.index);
      }, Math.min(ms, 1500));   // 演示时压缩到最长 1.5 秒
      return;
    }

    const url = `${this._cred.uploadUrl || ''}`;
    this._uploadTask = wx.uploadFile({
      url,
      filePath: this.data.filePath,
      name: 'file',
      formData: {
        key: `${this._cred.keyPrefix}part_${chunk.index}`,
        partNumber: chunk.index + 1,
        uploadId: this._cred.uploadId || '',
      },
      timeout: CHUNK_TIMEOUT_MS,
      success: () => { this._inflight = false; this._onChunkDone(chunk.index); },
      fail: (err) => { this._inflight = false; this._onChunkFail(chunk.index, err); },
    });
  },

  _onChunkDone(index) {
    if (!this.session) return;
    const done = this.session.markUploaded(index);
    this._persist();
    this._refreshProgress();
    if (done) this._onComplete();
    else this._pumpNext();
  },

  _onChunkFail(index, err) {
    if (!this.session) return;
    const verdict = this.session.markChunkFailed(index);
    this._persist();

    if (verdict === 'exhausted') {
      this.setData({
        status: 'failed',
        interruptionCount: this.data.interruptionCount + 1,
        errorText: '该分片连续 3 次上传失败。已保留断点，网络恢复后可从首页「未上传」继续。',
      });
      this._stopTicking();
      this._registerPendingLocal();
      return;
    }

    // 还能重试：短暂退避后继续
    wx.showToast({ title: '网络波动，重试中', icon: 'none', duration: 1200 });
    setTimeout(() => this._pumpNext(), 1500);
  },

  _startTicking() {
    this._stopTicking();
    this._ticker = setInterval(() => this._refreshProgress(), TICK_MS);
  },

  _stopTicking() {
    if (this._ticker) { clearInterval(this._ticker); this._ticker = null; }
    if (this._mockTimer) { clearTimeout(this._mockTimer); this._mockTimer = null; }
  },

  /**
   * 刷新进度与剩余时间。
   *
   * ⚠️ 剩余时间用滚动 30 秒窗口速率（session.eta 内部实现），
   *    不用整体平均。速率不稳时显示"网络波动中，估算可能不准"
   *    而不是给一个跳变的假数字。
   */
  _refreshProgress() {
    if (!this.session) return;
    const p = this.session.progress();
    const e = this.session.eta();

    let etaText = '计算中…';
    if (e.reason === 'stalled') etaText = '网络停滞，等待恢复…';
    else if (e.seconds != null) etaText = `剩余约 ${formatDuration(e.seconds)}`;

    this.setData({
      percent: p.percent,
      uploadedText: formatBytes(p.uploadedBytes),
      totalText: formatBytes(p.totalBytes),
      uploadedChunks: p.uploadedChunks,
      totalChunks: p.totalChunks,
      etaText,
      etaUnstable: !!e.unstable,
      rateText: e.rate ? `${formatBytes(e.rate)}/s` : '',
      status: this.session.status === 'done' ? 'done' : this.data.status,
    });
  },

  _onComplete() {
    this._stopTicking();
    this._clearPersisted();
    this.setData({ status: 'done', percent: 100 });
    wx.showToast({ title: '上传完成', icon: 'success' });

    // 进入处理中页
    setTimeout(() => {
      wx.redirectTo({ url: `/pages/processing/index?activityId=${this.data.activityId}` });
    }, 700);
  },

  // ============================================================
  // 持久化（断点续传的基础）
  // ============================================================

  _persist() {
    if (!this.session || !this.data.activityId) return;
    try {
      const all = wx.getStorageSync('upload_state') || {};
      all[this.data.activityId] = Object.assign(
        this.session.serialize(),
        { interruptionCount: this.data.interruptionCount, savedAt: Date.now() }
      );
      wx.setStorageSync('upload_state', all);
    } catch (e) { /* storage 满时不阻塞上传 */ }
  },

  _clearPersisted() {
    try {
      const all = wx.getStorageSync('upload_state') || {};
      delete all[this.data.activityId];
      wx.setStorageSync('upload_state', all);
    } catch (e) { /* noop */ }
  },

  /**
   * 登记未完成上传的本地视频。
   * 对应「取消 ≠ 删除」：本地保留 24 小时，可从首页找回。
   */
  _registerPendingLocal() {
    const app = getApp();
    if (!app || !app.registerPendingLocalVideo) return;
    app.registerPendingLocalVideo({
      activityId: this.data.activityId,
      activityName: this.data.activityName,
      filePath: this.data.filePath,
      fileSize: this.data.fileSize,
      uploadedChunks: this.data.uploadedChunks,
      totalChunks: this.data.totalChunks,
    });
  },

  // ============================================================
  // 交互
  // ============================================================

  /**
   * 取消上传。
   *
   * ⚠️ 界面设计 v0.1.1 屏 04 红色注释：取消不是删除。
   *    只中止上传，本地视频保留 24 小时，误点可从首页「未上传」找回。
   *    **绝对不能默默删除用户本地视频。**
   */
  onCancel() {
    wx.showModal({
      title: '中止本次上传？',
      content: '录像会保留在手机本地 24 小时，你可以稍后从首页「未上传」入口继续上传。'
        + '已上传的分片不会浪费。',
      confirmText: '中止上传',
      cancelText: '继续上传',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        this._stopTicking();
        if (this._uploadTask && this._uploadTask.abort) this._uploadTask.abort();
        if (this.session) this.session.cancel();
        this._persist();
        this._registerPendingLocal();
        this.setData({ status: 'cancelled' });
      },
    });
  },

  onRetry() {
    this.setData({ status: 'uploading', errorText: '' });
    if (this.session) {
      this.session.resume();
      this._startTicking();
      this._pumpNext();
    } else {
      this._statFile(this.data.filePath, 0);
    }
  },

  onPause() {
    if (!this.session) return;
    this._stopTicking();
    if (this._uploadTask && this._uploadTask.abort) this._uploadTask.abort();
    this.session.pause();
    this._persist();
    this.setData({ status: 'paused' });
  },

  onResume() {
    if (!this.session) return;
    this.session.resume();
    this.setData({ status: 'uploading', errorText: '' });
    this._startTicking();
    this._pumpNext();
  },

  /** 仅 Wi-Fi 上传开关 */
  onToggleWifiOnly(e) {
    const wifiOnly = e.detail.value;
    this.setData({ wifiOnly });
    if (wifiOnly && this.data.networkType && this.data.networkType !== 'wifi') {
      this.setData({ networkBlocked: true });
      this.onPause();
    } else {
      this.setData({ networkBlocked: false });
      if (this.data.status === 'paused') this.onResume();
    }
  },

  onGoHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  onGoProcessing() {
    wx.redirectTo({ url: `/pages/processing/index?activityId=${this.data.activityId}` });
  },
});
