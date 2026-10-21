/**
 * 小程序全局入口
 *
 * 职责（刻意保持很薄）：
 *   1. 内测告知同意状态（PRD 3.7 / 9.4 #4.10）
 *   2. 本地存储键名统一管理
 *   3. 「取消上传 ≠ 删除」的本地视频找回入口（界面设计 v0.1.1 屏 04）
 *   4. 补录进度的落盘与恢复（PRD 3.11）
 *
 * 业务状态不放这里，各页面自持；跨页共享的只有下面这几项。
 */

const { LOCAL_RETENTION_MS } = require('./utils/upload');

/**
 * 本地存储键名。集中定义，避免各页面拼字符串导致读写不一致。
 */
const STORAGE_KEYS = Object.freeze({
  CONSENT: 'consent_accepted_at',        // 内测告知同意时间戳
  TEAM: 'team_profile',                  // 球队资料（含默认年龄段/赛制）
  ROSTER: 'roster',                      // 球员名单
  UPLOAD_STATE: 'upload_state',          // 断点续传状态
  ATTRIBUTION: 'attribution_state',      // 补录进度（按 activityId 分桶）
  PENDING_LOCAL: 'pending_local_videos', // 已取消/未完成上传的本地视频
  ACTIVITY_DRAFT: 'activity_draft',      // 新建活动的草稿
  LAST_PARAMS: 'last_activity_params',   // 上一场的年龄段与赛制，用于"复制上一场"
});

/** 补录进度的存储桶上限，避免长期使用后 storage 无限增长 */
const MAX_ATTRIBUTION_BUCKETS = 30;

App({
  globalData: {
    /** 当前球队资料 */
    team: null,
    /** 待补录场次（首页与球队页的提醒都读它） */
    pendingAttributionCount: 0,
    /** 是否已同意内测告知 */
    consented: false,
  },

  onLaunch() {
    this.globalData.consented = !!wx.getStorageSync(STORAGE_KEYS.CONSENT);
    this.globalData.team = wx.getStorageSync(STORAGE_KEYS.TEAM) || null;
    this.refreshPendingCount();
    this.cleanupExpiredLocalVideos();
  },

  // ============================================================
  // 内测告知（PRD 3.7）
  // ============================================================

  /**
   * 记录同意。同意后不再弹（PRD 9.4 #4.10）。
   *
   * ⚠️ 未同意时录制页必须拒绝开始录制，这个校验在 pages/record 里做，
   *    不在这里做——因为只有录制这一个动作需要它。
   */
  acceptConsent() {
    const at = Date.now();
    wx.setStorageSync(STORAGE_KEYS.CONSENT, at);
    this.globalData.consented = true;
    return at;
  },

  hasConsented() {
    return !!wx.getStorageSync(STORAGE_KEYS.CONSENT);
  },

  // ============================================================
  // 补录进度落盘（PRD 3.11：断网/杀进程后重进完整保留）
  // ============================================================

  /**
   * 保存某场活动的补录进度。
   *
   * 按 activityId 分桶存储，这样教练在多场之间来回切换不会互相覆盖。
   */
  saveAttribution(activityId, state) {
    if (!activityId || !state) return;
    const all = wx.getStorageSync(STORAGE_KEYS.ATTRIBUTION) || {};
    all[activityId] = state;

    // 超出上限时按 savedAt 淘汰最旧的
    const keys = Object.keys(all);
    if (keys.length > MAX_ATTRIBUTION_BUCKETS) {
      keys
        .map((k) => ({ k, at: (all[k] && all[k].savedAt) || 0 }))
        .sort((a, b) => a.at - b.at)
        .slice(0, keys.length - MAX_ATTRIBUTION_BUCKETS)
        .forEach(({ k }) => { delete all[k]; });
    }

    wx.setStorageSync(STORAGE_KEYS.ATTRIBUTION, all);
    this.refreshPendingCount();
  },

  loadAttribution(activityId) {
    const all = wx.getStorageSync(STORAGE_KEYS.ATTRIBUTION) || {};
    return all[activityId] || null;
  },

  /**
   * 统计待补录场次。
   *
   * 首页与球队页的橙色提醒都读这个数（PRD 屏 01：待补录提醒置顶）。
   */
  refreshPendingCount() {
    const all = wx.getStorageSync(STORAGE_KEYS.ATTRIBUTION) || {};
    const activities = wx.getStorageSync('activities') || [];
    let n = 0;
    activities.forEach((a) => {
      const st = all[a.id];
      // 有报告但补录未完成 → 计入待补录
      if (a.status === 'report_ready' && (!st || !st.complete)) n += 1;
    });
    this.globalData.pendingAttributionCount = n;
    return n;
  },

  // ============================================================
  // 取消上传 ≠ 删除（界面设计 v0.1.1 屏 04 红色注释）
  // ============================================================

  /**
   * 登记一个"已取消/未完成上传"的本地视频。
   * 保留 24 小时，期间可从首页"未上传"入口找回。
   */
  registerPendingLocalVideo(entry) {
    const list = wx.getStorageSync(STORAGE_KEYS.PENDING_LOCAL) || [];
    list.push(Object.assign({ registeredAt: Date.now() }, entry));
    wx.setStorageSync(STORAGE_KEYS.PENDING_LOCAL, list);
  },

  /** 列出仍在保留期内的本地视频 */
  listPendingLocalVideos() {
    const list = wx.getStorageSync(STORAGE_KEYS.PENDING_LOCAL) || [];
    const now = Date.now();
    return list.filter((v) => now - (v.registeredAt || 0) < LOCAL_RETENTION_MS);
  },

  /** 清理超过 24 小时的登记项（不主动删文件，只清登记） */
  cleanupExpiredLocalVideos() {
    const kept = this.listPendingLocalVideos();
    wx.setStorageSync(STORAGE_KEYS.PENDING_LOCAL, kept);
    return kept.length;
  },

  // ============================================================
  // 通用存储
  // ============================================================

  setTeam(team) {
    wx.setStorageSync(STORAGE_KEYS.TEAM, team);
    this.globalData.team = team;
  },

  getTeam() {
    if (!this.globalData.team) {
      this.globalData.team = wx.getStorageSync(STORAGE_KEYS.TEAM) || null;
    }
    return this.globalData.team;
  },

  /**
   * 记住上一场的年龄段与赛制。
   *
   * 对应界面设计 v0.1.1 屏 02 的注释：
   * "复制上一场"时应同时复制年龄段与赛制 —— 同一支队这两个参数长期不变。
   */
  rememberLastParams(params) {
    wx.setStorageSync(STORAGE_KEYS.LAST_PARAMS, params);
  },

  getLastParams() {
    return wx.getStorageSync(STORAGE_KEYS.LAST_PARAMS) || null;
  },

  STORAGE_KEYS,
});
