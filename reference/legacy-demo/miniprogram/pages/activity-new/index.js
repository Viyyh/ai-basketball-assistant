/**
 * 屏 02 · 新建活动 —— 模板 / 年龄段 / 赛制 / 名单
 *
 * 这一屏承载 PRD 决策 10、11 与风险 7.4 的第一道防线：
 *
 *   年龄段与赛制 **必填、不给默认值**。
 *   选中后立即显示"这会影响什么"，让教练理解而非机械点选。
 *
 * 联动规则（界面设计 v0.1.1 屏 02）：
 *   · 选赛制 → 首发名单格子数自动变（5对5=5 格，3对3=3 格）
 *   · 选 3对3 → 提示语转橙，明确"半场单框 / 12 秒 / 线内1分线外2分 / 报告用远投"
 *   · 选 4对4 或自定义 → 必须追问"全场还是半场"，否则无法标定
 *   · 选年龄段 → 自动填该年龄段默认节次时长（教练可改）
 *   · 切换赛制导致人数不匹配 → 多出的人自动转替补 + 明确告知 + 可撤销，
 *     **绝不静默丢弃教练已选的人**
 *   · 切换模板时年龄段与赛制保留不变
 *   · "从上一场复制"连同年龄段与赛制一起带出
 */

const api = require('../../utils/api');
const { resolveParams } = require('../../mock/paramsMirror');
const {
  FORMAT, AGE_GROUP, COURT_TYPE, TEMPLATE,
  FORMAT_LABEL, AGE_GROUP_LABEL, PLAYERS_PER_TEAM,
  requiresCourtTypeChoice, arcInsideLabel, arcOutsideLabel,
} = require('../../utils/params');

const AGE_OPTIONS = [
  { value: AGE_GROUP.U8, label: AGE_GROUP_LABEL.U8 },
  { value: AGE_GROUP.U12, label: AGE_GROUP_LABEL.U12 },
  { value: AGE_GROUP.U15, label: AGE_GROUP_LABEL.U15 },
  { value: AGE_GROUP.U18, label: AGE_GROUP_LABEL.U18 },
  { value: AGE_GROUP.SENIOR, label: AGE_GROUP_LABEL.SENIOR },
];

const FORMAT_OPTIONS = [
  { value: FORMAT.FIVE_V_FIVE, label: FORMAT_LABEL['5V5'] },
  { value: FORMAT.FOUR_V_FOUR, label: FORMAT_LABEL['4V4'] },
  { value: FORMAT.THREE_V_THREE, label: FORMAT_LABEL['3V3'] },
  { value: FORMAT.CUSTOM, label: FORMAT_LABEL.CUSTOM },
];

const TEMPLATE_OPTIONS = [
  { value: TEMPLATE.MATCH, label: '比赛' },
  { value: TEMPLATE.SCRIMMAGE, label: '团队对抗' },
  { value: TEMPLATE.ROUTINE, label: '套路演练' },
];

const COURT_OPTIONS = [
  { value: COURT_TYPE.FULL, label: '全场' },
  { value: COURT_TYPE.HALF, label: '半场' },
];

/** 套路演练的预置标签，教练也可自建 */
const ROUTINE_PRESETS = ['挡拆外弹', '底线交叉', '4-out 突分', '高位手递手', '全场紧逼', '2-3 联防轮转'];

Page({
  data: {
    // 选项
    templateOptions: TEMPLATE_OPTIONS,
    ageOptions: AGE_OPTIONS,
    formatOptions: FORMAT_OPTIONS,
    courtOptions: COURT_OPTIONS,
    routinePresets: ROUTINE_PRESETS,

    // 表单
    template: TEMPLATE.MATCH,
    name: '',
    playedAt: '',
    venue: '',
    opponentName: '',
    ageGroup: '',
    format: '',
    courtType: '',
    periodCount: 4,
    periodMinutes: 8,
    customPlayers: 5,

    // 名单
    roster: [],
    starters: [],        // 球员 id 数组
    bench: [],
    groups: { red: [], blue: [] },
    activeGroup: 'red',

    // 套路演练
    routines: [],        // [{name, planned}]
    routineInput: '',
    routinePlannedInput: '',

    // 派生
    needPlayers: 0,
    needCourtChoice: false,
    ageHint: '',
    formatHint: '',
    formatHintIsWarn: false,
    is3v3: false,
    isRoutine: false,
    isScrimmage: false,
    isMatch: true,

    // 赛制切换导致的人员调整提示（可撤销）
    reassignNotice: null,

    // 复制上一场
    canCopyLast: false,
    lastParamsText: '',

    submitting: false,
  },

  async onLoad(query) {
    const roster = await api.getRoster();
    const team = await api.getTeam();
    const app = getApp();
    const last = app.getLastParams ? app.getLastParams() : null;

    const today = new Date();
    const playedAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    this.setData({
      roster,
      playedAt,
      canCopyLast: !!last,
      lastParamsText: last
        ? `${AGE_GROUP_LABEL[last.ageGroup] || last.ageGroup} · ${FORMAT_LABEL[last.format] || last.format}`
        : '',
      // 球队默认值带出（PRD 5.1：球队资料存默认年龄段与赛制）
      ageGroup: (team && team.default_age_group) || '',
      format: (team && team.default_format) || '',
    });

    this._recompute();

    // 从"复制上一场"入口进来时预填
    if (query && query.copyLast === '1' && last) this.onCopyLast();
  },

  // ============================================================
  // 派生计算：所有联动都收在这里，避免散落各处
  // ============================================================

  _recompute() {
    const { template, ageGroup, format, courtType, customPlayers, roster } = this.data;

    const is3v3 = format === FORMAT.THREE_V_THREE;
    const needCourtChoice = requiresCourtTypeChoice(format);
    const needPlayers = format === FORMAT.CUSTOM
      ? (customPlayers || 5)
      : (PLAYERS_PER_TEAM[format] || 0);

    // ---------- 年龄段后果提示 ----------
    let ageHint = '';
    if (ageGroup) {
      // 节次时长与三分线半径都由参数层给出，不在页面里硬编码
      let p = null;
      try {
        p = resolveParams(format || FORMAT.FIVE_V_FIVE, ageGroup, courtType || COURT_TYPE.FULL);
      } catch (e) { p = null; }

      const radius = p ? p.three_point_radius_m : null;
      const minutes = p && !is3v3 ? p.period_minutes : null;
      const bits = [];
      if (is3v3) bits.push('单节 10 分钟或先得 21 分');
      else if (minutes) bits.push(`默认 ${p.period_count} 节 × ${minutes} 分钟`);
      if (radius) bits.push(`三分线 ${radius} m`);
      ageHint = `${AGE_GROUP_LABEL[ageGroup]}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
    }

    // ---------- 赛制后果提示 ----------
    let formatHint = '';
    let formatHintIsWarn = false;
    if (format) {
      if (is3v3) {
        // 3对3 是完全不同的规则集，提示转橙（界面设计 v0.1.1 变体 B）
        formatHint = `3 对 3 · 半场单框 15 × 11 m · 12 秒进攻时限\n`
          + `线内 ${arcInsideLabel(format)} / 线外 ${arcOutsideLabel(format)} · 报告用「远投」而非「三分」`;
        formatHintIsWarn = true;
      } else if (format === FORMAT.FOUR_V_FOUR) {
        formatHint = courtType
          ? `4 对 4 · ${courtType === COURT_TYPE.FULL ? '全场双框' : '半场单框'} · 无固定进攻时限`
          : '4 对 4 没有统一规则，请选择全场还是半场';
        formatHintIsWarn = !courtType;
      } else if (format === FORMAT.CUSTOM) {
        formatHint = courtType
          ? `自定义 · ${customPlayers} 人 · ${courtType === COURT_TYPE.FULL ? '全场' : '半场'}`
          : '自定义赛制请选择全场还是半场';
        formatHintIsWarn = !courtType;
      } else {
        formatHint = `5 对 5 · 全场双框 28 × 15 m · 24 秒进攻时限\n弧内 2 分 / 弧外 3 分`;
      }
    }

    this.setData({
      needPlayers,
      needCourtChoice,
      ageHint,
      formatHint,
      formatHintIsWarn,
      is3v3,
      isRoutine: template === TEMPLATE.ROUTINE,
      isScrimmage: template === TEMPLATE.SCRIMMAGE,
      isMatch: template === TEMPLATE.MATCH,
      periodCount: is3v3 ? 1 : (this.data.periodCount || 4),
    });

    this._syncRosterSlots();
  },

  /**
   * 名单格子数随赛制变化。
   *
   * 关键约束（界面设计 v0.1.1 变体 B）：
   * 人数变少时多出的人 **自动转替补 + 明确告知 + 可撤销**，
   * 绝不静默丢弃。
   */
  _syncRosterSlots() {
    const { template, starters, bench, groups, needPlayers } = this.data;
    if (!needPlayers) return;

    if (template === TEMPLATE.SCRIMMAGE) {
      const notice = [];
      ['red', 'blue'].forEach((side) => {
        const cur = groups[side] || [];
        if (cur.length > needPlayers) {
          const kept = cur.slice(0, needPlayers);
          const moved = cur.slice(needPlayers);
          groups[side] = kept;
          notice.push({ side, moved });
        }
      });
      this.setData({ groups });
      if (notice.length) this._setReassignNotice(notice, 'groups');
      return;
    }

    if (starters.length > needPlayers) {
      const kept = starters.slice(0, needPlayers);
      const moved = starters.slice(needPlayers);
      const newBench = Array.from(new Set(bench.concat(moved)));
      this.setData({ starters: kept, bench: newBench });
      this._setReassignNotice([{ moved }], 'starters');
    }
  },

  _setReassignNotice(entries, kind) {
    const names = [];
    entries.forEach((e) => {
      (e.moved || []).forEach((id) => {
        const p = this.data.roster.find((r) => r.id === id);
        if (p) names.push(`${p.number} 号 ${p.name}`);
      });
    });
    if (!names.length) return;

    const snapshot = kind === 'groups'
      ? { groups: JSON.parse(JSON.stringify(this.data.groups)) }
      : { starters: this.data.starters.slice(), bench: this.data.bench.slice() };

    this.setData({
      reassignNotice: {
        text: `已按新赛制保留前 ${this.data.needPlayers} 人，${names.join('、')} 转入替补`,
        snapshot,
        kind,
      },
    });
  },

  onUndoReassign() {
    const n = this.data.reassignNotice;
    if (!n) return;
    this.setData(Object.assign({}, n.snapshot, { reassignNotice: null }));
    wx.showToast({ title: '已撤销', icon: 'none' });
  },

  // ============================================================
  // 表单事件
  // ============================================================

  onPickTemplate(e) {
    // 切换模板时年龄段与赛制保留不变（界面设计 v0.1.1）
    this.setData({ template: e.currentTarget.dataset.value });
    this._recompute();
  },

  onPickAge(e) {
    this.setData({ ageGroup: e.currentTarget.dataset.value });
    this._recompute();
  },

  onPickFormat(e) {
    this.setData({ format: e.currentTarget.dataset.value });
    this._recompute();
  },

  onPickCourt(e) {
    this.setData({ courtType: e.currentTarget.dataset.value });
    this._recompute();
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: e.detail.value });
  },

  /** 日期选择器（picker 的 change 事件结构与 input 不同，单独处理） */
  onPickerDate(e) {
    this.setData({ playedAt: e.detail.value });
  },

  onCustomPlayersChange(e) {
    this.setData({ customPlayers: Number(e.detail.value) || 5 });
    this._recompute();
  },

  onPeriodChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: Number(e.detail.value) || 0 });
  },

  // ---------- 名单 ----------

  onTogglePlayer(e) {
    const { id, slot } = e.currentTarget.dataset;
    if (!id || !slot) return;

    const { starters, bench, groups, activeGroup, needPlayers } = this.data;

    if (slot === 'starter') {
      const has = starters.includes(id);
      if (has) {
        this.setData({ starters: starters.filter((x) => x !== id) });
      } else {
        if (starters.length >= needPlayers) {
          wx.showToast({ title: `${needPlayers} 人赛制首发已满`, icon: 'none' });
          return;
        }
        this.setData({ starters: starters.concat([id]) });
      }
      return;
    }

    if (slot === 'bench') {
      const has = bench.includes(id);
      this.setData({ bench: has ? bench.filter((x) => x !== id) : bench.concat([id]) });
      return;
    }

    if (slot === 'group') {
      const list = (groups[activeGroup] || []).slice();
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
      else {
        if (list.length >= needPlayers) {
          wx.showToast({ title: `${needPlayers} 人赛制每队 ${needPlayers} 人`, icon: 'none' });
          return;
        }
        list.push(id);
      }
      // 同一人不能同时在两队
      const other = activeGroup === 'red' ? 'blue' : 'red';
      groups[activeGroup] = list;
      groups[other] = (groups[other] || []).filter((x) => x !== id);
      this.setData({ groups });
    }
  },

  onSwitchGroup(e) {
    this.setData({ activeGroup: e.currentTarget.dataset.side });
  },

  // ---------- 套路清单 ----------

  onRoutineInput(e) { this.setData({ routineInput: e.detail.value }); },
  onRoutinePlannedInput(e) { this.setData({ routinePlannedInput: e.detail.value }); },

  onAddRoutine() {
    const name = (this.data.routineInput || '').trim();
    if (!name) { wx.showToast({ title: '请填写套路名称', icon: 'none' }); return; }
    if (this.data.routines.length >= 8) {
      wx.showToast({ title: '每场最多 8 个套路', icon: 'none' });
      return;
    }
    const planned = Number(this.data.routinePlannedInput) || 0;
    this.setData({
      routines: this.data.routines.concat([{ id: `r_${Date.now()}`, name, planned }]),
      routineInput: '',
      routinePlannedInput: '',
    });
  },

  onAddPresetRoutine(e) {
    const name = e.currentTarget.dataset.name;
    if (this.data.routines.some((r) => r.name === name)) return;
    if (this.data.routines.length >= 8) {
      wx.showToast({ title: '每场最多 8 个套路', icon: 'none' });
      return;
    }
    this.setData({ routines: this.data.routines.concat([{ id: `r_${Date.now()}`, name, planned: 0 }]) });
  },

  onRemoveRoutine(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ routines: this.data.routines.filter((r) => r.id !== id) });
  },

  // ---------- 复制上一场 ----------

  /**
   * 从上一场复制名单，**连同年龄段与赛制一起带出**
   * （界面设计 v0.1.1 屏 02 注释：同一支队这两个参数长期不变）。
   */
  async onCopyLast() {
    const app = getApp();
    const last = app.getLastParams ? app.getLastParams() : null;
    if (!last) { wx.showToast({ title: '没有可复制的上一场', icon: 'none' }); return; }

    const patch = {};
    if (last.ageGroup) patch.ageGroup = last.ageGroup;
    if (last.format) patch.format = last.format;
    if (last.courtType) patch.courtType = last.courtType;
    if (last.template) patch.template = last.template;
    if (Array.isArray(last.starters)) patch.starters = last.starters.slice();
    if (Array.isArray(last.bench)) patch.bench = last.bench.slice();
    if (last.groups) patch.groups = JSON.parse(JSON.stringify(last.groups));
    if (last.opponentName) patch.opponentName = last.opponentName;
    if (last.venue) patch.venue = last.venue;

    this.setData(patch);
    this._recompute();
    wx.showToast({ title: '已复制上一场配置', icon: 'success' });
  },

  // ============================================================
  // 提交
  // ============================================================

  async onSubmit() {
    if (this.data.submitting) return;

    const d = this.data;
    const payload = {
      template: d.template,
      name: (d.name || '').trim() || this._autoName(),
      playedAt: d.playedAt,
      venue: d.venue,
      opponentName: d.opponentName,
      ageGroup: d.ageGroup,
      format: d.format,
      courtType: d.courtType || null,
      customPlayers: d.format === FORMAT.CUSTOM ? d.customPlayers : null,
      periodCount: d.periodCount,
      periodMinutes: d.periodMinutes,
      starters: d.starters,
      bench: d.bench,
      groups: d.template === TEMPLATE.SCRIMMAGE ? d.groups : null,
      routines: d.template === TEMPLATE.ROUTINE ? d.routines : null,
    };

    // 前端先校验一次；后端会再校验一次（两层都要有，PRD 风险 7.4）
    const problems = api.validateActivityPayload(payload);
    if (problems.length) {
      wx.showModal({
        title: '还差一点',
        content: problems.join('\n'),
        showCancel: false,
        confirmText: '去修改',
      });
      return;
    }

    this.setData({ submitting: true });
    try {
      const activity = await api.createActivity(payload);

      // 记住本场参数，供下次"复制上一场"
      const app = getApp();
      if (app.rememberLastParams) {
        app.rememberLastParams({
          template: payload.template,
          ageGroup: payload.ageGroup,
          format: payload.format,
          courtType: payload.courtType,
          starters: payload.starters,
          bench: payload.bench,
          groups: payload.groups,
          opponentName: payload.opponentName,
          venue: payload.venue,
        });
      }

      wx.redirectTo({ url: `/pages/record/index?activityId=${activity.id}` });
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  _autoName() {
    const d = this.data;
    const label = { MATCH: '比赛', SCRIMMAGE: '团队对抗', ROUTINE: '套路演练' }[d.template] || '活动';
    return d.opponentName ? `${label} vs ${d.opponentName}` : `${d.playedAt} ${label}`;
  },
});
