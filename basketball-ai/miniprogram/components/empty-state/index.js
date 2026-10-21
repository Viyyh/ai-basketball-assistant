/**
 * empty-state —— 空状态（P4-F06）
 *
 * PRD 3.6：空状态永远有 CTA。
 * 四种场景的文案与动作已内置，页面只需传 scene。
 *
 * ⚠️ 数字缺失一律用「—」不用「0」——
 *    0 会被教练误读为"球员得分为 0"，而不是"还没数据"。
 */

const PRESETS = {
  // 球队主页 · 0 场比赛
  noGames: {
    icon: '🏀',
    title: '还没有比赛记录',
    desc: '录第一场比赛，开启你的球队数据。录制只需把手机架在场边高处，中途不用管。',
    action: '开始新录制',
    actionUrl: '/pages/activity-new/index',
  },
  // 球员数据库 · 无数据
  noPlayers: {
    icon: '👥',
    title: '球员名单还是空的',
    desc: '先添加球员，之后录制比赛时就能直接勾选首发。也可以从上一场复制名单。',
    action: '添加球员',
    actionUrl: '',
  },
  // 战术板 · 空库
  noTactics: {
    icon: '📋',
    title: '战术库还是空的',
    desc: '从比赛的精彩片段里存一张战术卡试试——AI 会推荐本场值得做成战术的回合。',
    action: '从比赛里选片段',
    actionUrl: '',
  },
  // 对手记录 · 空档案
  noOpponents: {
    icon: '🎯',
    title: '还没有对手档案',
    desc: '录一场与某支球队的比赛，对手数据会自动生成。也可以手动添加还没交手过的对手。',
    action: '手动添加对手',
    actionUrl: '',
  },
  // 通用：无搜索结果
  noResult: {
    icon: '🔍',
    title: '没有匹配的结果',
    desc: '换个关键词或清空筛选条件试试。',
    action: '清空筛选',
    actionUrl: '',
  },
  // 通用：报告未生成
  noReport: {
    icon: '⏳',
    title: '报告还没生成',
    desc: '视频处理完成后会通过微信通知你，可以先离开小程序。',
    action: '查看处理进度',
    actionUrl: '',
  },
  // 通用：数据不完整
  incomplete: {
    icon: '📝',
    title: '数据还不完整',
    desc: '这场比赛还有事件没补录。补录完成后球员数据与球队统计才会更新。',
    action: '去补录',
    actionUrl: '',
  },
};

Component({
  properties: {
    /** 预设场景键，见 PRESETS */
    scene: { type: String, value: '' },
    /** 覆盖标题 */
    title: { type: String, value: '' },
    /** 覆盖描述 */
    desc: { type: String, value: '' },
    /** 覆盖按钮文案 */
    action: { type: String, value: '' },
    /** 覆盖图标 */
    icon: { type: String, value: '' },
    /** 是否显示按钮 */
    showAction: { type: Boolean, value: true },
  },

  data: {
    vIcon: '',
    vTitle: '',
    vDesc: '',
    vAction: '',
    vActionUrl: '',
  },

  observers: {
    'scene, title, desc, action, icon': function observe() { this._resolve(); },
  },

  lifetimes: { attached() { this._resolve(); } },

  methods: {
    _resolve() {
      const preset = PRESETS[this.data.scene] || {};
      this.setData({
        vIcon: this.data.icon || preset.icon || '📄',
        vTitle: this.data.title || preset.title || '暂无数据',
        vDesc: this.data.desc || preset.desc || '',
        vAction: this.data.action || preset.action || '',
        vActionUrl: preset.actionUrl || '',
      });
    },

    onAction() {
      // 有预设跳转地址且页面未自定义处理时，直接跳
      if (this.data.vActionUrl) {
        wx.navigateTo({ url: this.data.vActionUrl, fail: () => {} });
      }
      this.triggerEvent('action', { scene: this.data.scene });
    },
  },
});
