/**
 * 球队页屏 06 · 新建战术（从录像切片）
 *
 * 三步流程（界面设计 v0.1.1 屏 06）：
 *   Step 1 选片段 —— 从已有录像（比赛/训练）拖时间区间，或本地上传
 *   Step 2 命名   —— 战术名（必填）+ 战术要点（选填，纯文本）
 *   Step 3 打标签 —— 进攻 / 防守 / 边线球 + 自定义
 *
 * ⭐「智能推荐片段」是这一屏的关键设计（PRD P2-23）：
 *   教练从 45 分钟录像里找一个回合很麻烦，得自己拉时间轴。
 *   但 AI 已经知道哪几段是快攻、哪几段是进球 —— 直接推荐 3 个候选，
 *   教练点一个就行。**操作从 2 分钟降到 10 秒。**
 *
 *   注意区分：推荐候选（第一版就做）和自动提取战术（后期）是两件事。
 *
 * 边界情况：
 *   · 选了超过 3 分钟 → 提示"建议控制在 2 分钟内"，但允许保存
 *   · 选段与已存在战术卡重叠 → 提示并询问是否继续
 *   · 视频还在处理中 → "从比赛/训练"入口灰显，只能本地上传
 *
 * 对手战术板复用本页（owner=OPPONENT），仅归属对象不同 —— 工程上只做一次。
 */

const api = require('../../utils/api');
const { clockTime } = require('../../utils/format');

const SOURCES = [
  { key: 'MATCH', label: '从比赛' },
  { key: 'TRAINING', label: '从训练' },
  { key: 'UPLOAD', label: '本地上传' },
];

const PRESET_TAGS = ['进攻', '防守', '边线球', '三分', '快攻', '联防'];

/** 战术卡建议时长上限（秒） */
const RECOMMENDED_MAX_S = 120;
/** 硬上限：超过 3 分钟给提示但仍允许保存 */
const HARD_MAX_S = 180;

Page({
  data: {
    owner: 'TEAM',
    opponentId: '',

    step: 1,
    sources: SOURCES,
    activeSource: 'MATCH',

    // 素材来源
    activities: [],
    activityIndex: -1,
    selectedActivity: null,
    activityDurationS: 0,
    activityDisabled: false,

    // 时间区间
    startS: 0,
    endS: 30,
    startText: '00:00',
    endText: '00:30',
    durationText: '30 秒',
    tooLong: false,
    overHardLimit: false,

    // 智能推荐
    recommendations: [],
    loadingRecommend: false,

    // 命名与要点
    name: '',
    note: '',

    // 标签
    presetTags: PRESET_TAGS,
    selectedTags: [],
    customTagInput: '',

    // 重叠检测
    overlapWarning: '',

    submitting: false,
  },

  async onLoad(query) {
    const owner = (query && query.owner) || 'TEAM';
    const opponentId = (query && query.opponentId) || '';
    const activityId = (query && query.activityId) || '';
    const eventId = (query && query.eventId) || '';

    this.setData({ owner, opponentId });
    wx.setNavigationBarTitle({ title: owner === 'OPPONENT' ? '剪辑对手战术' : '新建战术' });

    await this._loadActivities(owner, activityId);

    // 从报告页/事件页「存为战术卡」进来时，预填时间区间
    if (activityId) {
      const idx = this.data.activities.findIndex((a) => a.id === activityId);
      if (idx >= 0) {
        this.setData({ activityIndex: idx });
        await this.onSelectActivity({ currentTarget: { dataset: { index: idx } } });
      }
      if (eventId) this._prefillFromEvent(activityId, eventId);
    }
  },

  async _loadActivities(owner, preferredId) {
    let all = [];
    try {
      all = owner === 'OPPONENT' && this.data.opponentId
        ? (await api.listActivities({ opponentId: this.data.opponentId }))
        : await api.listActivities();
    } catch (e) { all = []; }

    // 只有报告已生成的活动才能作为素材源
    const usable = all.filter((a) => a.status === 'report_ready' || a.status === 'complete');
    const processing = all.filter((a) => a.status === 'processing' || a.status === 'uploading');

    this.setData({
      activities: usable.map((a) => ({
        id: a.id,
        label: `${a.playedAt} · ${a.name}`,
        durationS: a.durationS || 0,
        template: a.template,
      })),
      activityDisabled: !usable.length,
      processingCount: processing.length,
    });
  },

  async _prefillFromEvent(activityId, eventId) {
    try {
      const res = await api.getReport(activityId);
      if (!res || !res.report) return;
      const ev = (res.report.events || []).find((e) => e.id === eventId);
      if (!ev) return;
      const start = Math.max(0, (ev.clip_start_s != null ? ev.clip_start_s : ev.timestamp_s - 4));
      const end = start + (ev.clip_duration_s || 10);
      this.setData({ startS: start, endS: end });
      this._syncTimeText();
      if (!this.data.name && ev.label_zh) {
        this.setData({ name: `${ev.label_zh}回合` });
      }
    } catch (e) { /* 预填失败不阻塞 */ }
  },

  // ============================================================
  // Step 1 选片段
  // ============================================================

  onTapSource(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'UPLOAD') {
      wx.showModal({
        title: '本地上传',
        content: '第一版暂不支持本地上传视频作为战术素材，可以先从比赛或训练录像里切片。',
        showCancel: false,
      });
      return;
    }
    this.setData({ activeSource: key });
  },

  async onSelectActivity(e) {
    const index = Number(e.currentTarget.dataset.index);
    const act = this.data.activities[index];
    if (!act) return;

    this.setData({ activityIndex: index, selectedActivity: act, activityDurationS: act.durationS || 0 });

    // 拉智能推荐
    this.setData({ loadingRecommend: true, recommendations: [] });
    try {
      const recs = await api.recommendTacticClips(act.id, 3);
      this.setData({
        recommendations: recs.map((r) => Object.assign({}, r, {
          timeText: clockTime(r.timestampS),
          durationText: `${r.clipDurationS || 10} 秒`,
        })),
        loadingRecommend: false,
      });
    } catch (err) {
      this.setData({ loadingRecommend: false });
    }
  },

  /**
   * 采纳一个推荐候选。
   *
   * 这是把"从 45 分钟里找回合"压缩到 10 秒的关键动作：
   * 点一下就把时间区间、战术名建议都填好。
   */
  onUseRecommendation(e) {
    const id = e.currentTarget.dataset.id;
    const rec = this.data.recommendations.find((r) => r.eventId === id);
    if (!rec) return;

    const start = rec.clipStartS != null ? rec.clipStartS : Math.max(0, rec.timestampS - 4);
    const end = start + (rec.clipDurationS || 10);

    this.setData({
      startS: start,
      endS: end,
      // 名称留空让教练自己命名，但给一个建议占位
      name: this.data.name || rec.suggestedName || '',
    });
    this._syncTimeText();
    wx.showToast({ title: '已填入时间区间', icon: 'success' });
  },

  onTimeInput(e) {
    const field = e.currentTarget.dataset.field;
    const v = Number(e.detail.value) || 0;
    this.setData({ [field]: v });
    this._syncTimeText();
  },

  onSwapTime() {
    const { startS, endS } = this.data;
    this.setData({ startS: endS, endS: startS });
    this._syncTimeText();
  },

  /** 拖动选取：小程序 slider 只给一个值，用双 slider 模拟区间 */
  onStartSlider(e) {
    let v = e.detail.value;
    if (v >= this.data.endS) v = Math.max(0, this.data.endS - 1);
    this.setData({ startS: v });
    this._syncTimeText();
  },

  onEndSlider(e) {
    let v = e.detail.value;
    if (v <= this.data.startS) v = this.data.startS + 1;
    this.setData({ endS: v });
    this._syncTimeText();
  },

  _syncTimeText() {
    const { startS, endS, activityDurationS } = this.data;
    const duration = Math.max(0, endS - startS);
    this.setData({
      startText: clockTime(startS),
      endText: clockTime(endS),
      durationText: duration >= 60
        ? `${Math.floor(duration / 60)} 分 ${duration % 60} 秒`
        : `${duration} 秒`,
      tooLong: duration > RECOMMENDED_MAX_S,
      overHardLimit: duration > HARD_MAX_S,
    });
    this._checkOverlap();
  },

  /**
   * 重叠检测：选段与已存在战术卡重叠时提示，但允许继续。
   * 第一版只做提示，不做自动合并。
   */
  async _checkOverlap() {
    const act = this.data.selectedActivity;
    if (!act) { this.setData({ overlapWarning: '' }); return; }

    try {
      const list = await api.listTactics();
      const hit = list.find((t) =>
        t.sourceActivityId === act.id
        && t.startS != null && t.endS != null
        && t.startS < this.data.endS && t.endS > this.data.startS
      );
      this.setData({
        overlapWarning: hit
          ? `这段时间已被用于「${hit.name}」，是否继续创建新卡？`
          : '',
      });
    } catch (e) { this.setData({ overlapWarning: '' }); }
  },

  // ============================================================
  // Step 2 / 3
  // ============================================================

  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },

  onToggleTag(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    const cur = this.data.selectedTags.slice();
    const idx = cur.indexOf(tag);
    if (idx >= 0) cur.splice(idx, 1);
    else {
      // 最多 2 个标签（界面设计 v0.1.1 屏 05）
      if (cur.length >= 2) {
        wx.showToast({ title: '最多选 2 个标签', icon: 'none' });
        return;
      }
      cur.push(tag);
    }
    this.setData({ selectedTags: cur });
  },

  onCustomTagInput(e) { this.setData({ customTagInput: e.detail.value }); },

  onAddCustomTag() {
    const tag = (this.data.customTagInput || '').trim();
    if (!tag) return;
    if (this.data.selectedTags.length >= 2) {
      wx.showToast({ title: '最多选 2 个标签', icon: 'none' });
      return;
    }
    this.setData({
      selectedTags: this.data.selectedTags.concat([tag]),
      presetTags: Array.from(new Set(this.data.presetTags.concat([tag]))),
      customTagInput: '',
    });
  },

  // ============================================================
  // 提交
  // ============================================================

  async onSubmit() {
    if (this.data.submitting) return;

    const d = this.data;
    const name = (d.name || '').trim();

    if (!name) { wx.showToast({ title: '请填写战术名称', icon: 'none' }); return; }
    if (d.activeSource !== 'UPLOAD' && d.activityIndex < 0) {
      wx.showToast({ title: '请选择素材来源', icon: 'none' }); return;
    }
    if (d.endS <= d.startS) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' }); return;
    }

    this.setData({ submitting: true });
    try {
      await api.createTactic({
        name,
        note: (d.note || '').trim(),
        owner: d.owner,
        opponentId: d.owner === 'OPPONENT' ? d.opponentId : null,
        sourceType: d.activeSource,
        sourceActivityId: d.selectedActivity ? d.selectedActivity.id : null,
        startS: d.startS,
        endS: d.endS,
        durationS: d.endS - d.startS,
        tags: d.selectedTags,
      });

      wx.showToast({ title: '战术卡已保存', icon: 'success' });
      setTimeout(() => {
        if (d.owner === 'OPPONENT') {
          wx.redirectTo({ url: `/pages/opponent-detail/index?id=${d.opponentId}&tab=tactics` });
        } else {
          wx.redirectTo({ url: '/pages/tactics/index' });
        }
      }, 700);
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onCancel() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/team/index' }) }); },
});
