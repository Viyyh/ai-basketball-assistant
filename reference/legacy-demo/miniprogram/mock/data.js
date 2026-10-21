/**
 * Mock 业务数据 —— 球队、名单、活动、对手、战术卡
 *
 * 供 utils/api.js 在后端就绪前返回。字段命名与 PRD 4.3 的数据实体一致，
 * 这样后端上线后只需换 api.js 的实现，页面不用改。
 */

const TEAM = {
  id: 'team_001',
  name: '雷霆 U16 青年队',
  coachName: '李教练',
  logoText: '雷',
  // 对应 PRD 5.1「球队资料中保存本队常用年龄段 + 常用赛制」
  default_age_group: 'U15',
  default_format: '5V5',
  playerCount: 15,
  tacticCount: 24,
  opponentCount: 8,
};

/** 球员名单。isStarter 决定补录选人网格的排序（PRD 屏 07） */
const ROSTER = [
  { id: 'p4',  number: 4,  name: '王', position: '控卫', height: 178, handedness: '右', isStarter: true,  status: 'active' },
  { id: 'p7',  number: 7,  name: '李', position: '分卫', height: 183, handedness: '右', isStarter: true,  status: 'active' },
  { id: 'p11', number: 11, name: '张', position: '小前', height: 188, handedness: '左', isStarter: true,  status: 'active' },
  { id: 'p23', number: 23, name: '陈', position: '大前', height: 192, handedness: '右', isStarter: true,  status: 'active' },
  { id: 'p32', number: 32, name: '周', position: '中锋', height: 198, handedness: '右', isStarter: true,  status: 'active' },
  { id: 'p8',  number: 8,  name: '孙', position: '分卫', height: 181, handedness: '右', isStarter: false, status: 'active' },
  { id: 'p15', number: 15, name: '吴', position: '中锋', height: 196, handedness: '左', isStarter: false, status: 'active' },
  { id: 'p2',  number: 2,  name: '赵', position: '控卫', height: 176, handedness: '右', isStarter: false, status: 'active' },
  { id: 'p6',  number: 6,  name: '钱', position: '小前', height: 186, handedness: '右', isStarter: false, status: 'active' },
  { id: 'p9',  number: 9,  name: '郑', position: '大前', height: 190, handedness: '右', isStarter: false, status: 'active' },
];

/**
 * 活动列表。
 *
 * status 取值：
 *   draft       新建未录制
 *   recording   录制中
 *   uploading   上传中
 *   processing  AI 处理中
 *   report_ready 报告已生成（可能仍待补录）
 *   complete    补录完成
 *   failed      处理失败
 */
const ACTIVITIES = [
  {
    id: 'act_1009',
    template: 'MATCH',
    name: '主场 vs 育才中学',
    playedAt: '2026-10-09',
    durationS: 2712,
    format: '5V5',
    ageGroup: 'U15',
    courtType: 'FULL',
    opponentId: 'opp_yucai',
    opponentName: '育才中学 U16',
    scoreFor: 78,
    scoreAgainst: 65,
    won: true,
    status: 'report_ready',
    eventCount: 87,
    attributedCount: 60,
    reportReadyAt: '2026-10-09T18:40:00+08:00',
  },
  {
    id: 'act_1007',
    template: 'ROUTINE',
    name: '挡拆套路训练',
    playedAt: '2026-10-07',
    durationS: 1920,
    format: '5V5',
    ageGroup: 'U15',
    courtType: 'FULL',
    status: 'complete',
    eventCount: 42,
    attributedCount: 42,
    routines: [
      { id: 'r1', name: '挡拆外弹', planned: 8, actual: 8, success: 6, avgSeconds: 7.2 },
      { id: 'r2', name: '底线交叉', planned: 5, actual: 5, success: 3, avgSeconds: 6.1 },
      { id: 'r3', name: '4-out 突分', planned: 6, actual: 4, success: 2, avgSeconds: 8.4 },
      { id: 'r4', name: '高位手递手', planned: 2, actual: 2, success: 1, avgSeconds: 5.5 },
    ],
  },
  {
    id: 'act_1005',
    template: 'SCRIMMAGE',
    name: '红蓝对抗',
    playedAt: '2026-10-05',
    durationS: 1680,
    format: '5V5',
    ageGroup: 'U15',
    courtType: 'FULL',
    status: 'complete',
    eventCount: 56,
    attributedCount: 56,
    groups: { red: ['p4', 'p7', 'p11', 'p23', 'p32'], blue: ['p8', 'p15', 'p2', 'p6', 'p9'] },
  },
  {
    id: 'act_1002',
    template: 'MATCH',
    name: '客场 vs 实验中学',
    playedAt: '2026-10-02',
    durationS: 2640,
    format: '5V5',
    ageGroup: 'U15',
    courtType: 'FULL',
    opponentId: 'opp_shiyan',
    opponentName: '实验中学 U16',
    scoreFor: 61,
    scoreAgainst: 70,
    won: false,
    status: 'report_ready',
    eventCount: 79,
    attributedCount: 41,
  },
  {
    id: 'act_0928',
    template: 'MATCH',
    name: '3v3 队内赛',
    playedAt: '2026-09-28',
    durationS: 720,
    format: '3V3',
    ageGroup: 'U15',
    courtType: 'HALF',
    scoreFor: 21,
    scoreAgainst: 18,
    won: true,
    status: 'report_ready',
    eventCount: 31,
    attributedCount: 31,
  },
  {
    id: 'act_0924',
    template: 'MATCH',
    name: '主场 vs 第一中学',
    playedAt: '2026-09-24',
    durationS: 2580,
    format: '5V5',
    ageGroup: 'U15',
    courtType: 'FULL',
    opponentId: 'opp_yizhong',
    opponentName: '第一中学 U16',
    scoreFor: 72,
    scoreAgainst: 68,
    won: true,
    status: 'complete',
    eventCount: 81,
    attributedCount: 81,
  },
  {
    id: 'act_1011',
    template: 'SCRIMMAGE',
    name: '3v3 半场对抗',
    playedAt: '2026-10-11',
    durationS: 900,
    format: '3V3',
    ageGroup: 'U15',
    courtType: 'HALF',
    status: 'processing',
    processStep: 3,
    queueAhead: 2,
    etaMinutes: 32,
  },
];

const OPPONENTS = [
  {
    id: 'opp_yucai',
    name: '育才中学 U16',
    shortName: '育',
    nextMatchAt: '2026-10-16',
    // 交手记录按赛制拆开（球队页设计 v0.2 屏 07）
    headToHead: [
      { format: '5V5', ageGroup: 'U15', played: 2, wins: 1, losses: 1, lastPlayedAt: '2026-10-09' },
      { format: '3V3', ageGroup: 'U15', played: 1, wins: 1, losses: 0, lastPlayedAt: '2026-09-30' },
    ],
    keyPlayers: [
      { id: 'kp1', number: 10, name: '赵XX', position: '控卫', threat: 'high',
        traits: '左撇子 · 突破强', note: '挡拆后第一选择是外弹三分',
        stats: { ppg: 18.4, arcOutPct: 0.41, apg: 5.2 } },
      { id: 'kp2', number: 23, name: '孙XX', position: '中锋', threat: 'mid',
        traits: '203 cm · 篮板机器', note: '给他上身体，别让他舒服接球',
        stats: { rpg: 11.2, secondChanceShare: 0.34 } },
      { id: 'kp3', number: 7, name: '周XX', position: '分卫', threat: 'low',
        traits: '三分投手', note: '', stats: { ppg: 9.1 } },
    ],
    formationUsage: [
      { label: '2-3 联防', pct: 0.46 },
      { label: '人盯人', pct: 0.36 },
      { label: '3-2 联防', pct: 0.18 },
    ],
    offensePreference: '45 度三分（占比 38%）',
    defensePreference: '禁区收缩（对手篮下出手占比仅 22%）',
    tactics: [
      { id: 'ot1', name: '2-3 联防站位', source: '交手比赛', durationS: 35, tag: '防守', at: '10/09 Q1' },
      { id: 'ot2', name: '挡拆外弹（10 号）', source: '交手比赛', durationS: 52, tag: '进攻', at: '10/09 Q1' },
      { id: 'ot3', name: '全场紧逼', source: '手动上传', durationS: 80, tag: '防守', at: '侦察录像' },
    ],
  },
  {
    id: 'opp_shiyan',
    name: '实验中学 U16',
    shortName: '实',
    headToHead: [
      { format: '5V5', ageGroup: 'U15', played: 2, wins: 0, losses: 2, lastPlayedAt: '2026-10-02' },
    ],
    keyPlayers: [],
    formationUsage: [{ label: '人盯人', pct: 0.72 }, { label: '2-3 联防', pct: 0.28 }],
    tactics: [],
  },
  {
    id: 'opp_yizhong',
    name: '第一中学 U16',
    shortName: '一',
    headToHead: [
      { format: '5V5', ageGroup: 'U15', played: 1, wins: 1, losses: 0, lastPlayedAt: '2026-09-24' },
    ],
    keyPlayers: [],
    formationUsage: [],
    tactics: [],
  },
];

const TACTICS = [
  { id: 't1', name: '挡拆外弹 · 1-5 号位', sourceType: 'MATCH', sourceActivityId: 'act_1009',
    durationS: 42, tags: ['进攻', '三分'], refCount: 4, at: 'Q2 08:12',
    note: '4 号位给 5 号位做掩护后外弹到 45 度，接球投三分' },
  { id: 't2', name: '底线交叉掩护', sourceType: 'SCRIMMAGE', sourceActivityId: 'act_1007',
    durationS: 75, tags: ['进攻'], refCount: 2, at: '团队对抗 10/07', note: '' },
  { id: 't3', name: '2-3 联防轮转', sourceType: 'MATCH', sourceActivityId: 'act_1002',
    durationS: 28, tags: ['防守'], refCount: 5, at: 'Q3 04:40', note: '弱侧底线要提前回收' },
  { id: 't4', name: '4-out 突分', sourceType: 'ROUTINE', sourceActivityId: 'act_1007',
    durationS: 63, tags: ['进攻', '训练'], refCount: 1, at: '套路演练', note: '' },
];

/** 处理中状态的六步 stepper（界面设计 v0.1.1 屏 05） */
const PIPELINE_STEPS = [
  { key: 'verify',   label: '视频校验' },
  { key: 'calib',    label: '场地标定' },
  { key: 'detect',   label: '目标检测与跟踪' },
  { key: 'event',    label: '事件识别' },
  { key: 'formation',label: '阵型采样' },
  { key: 'clip',     label: '视频切片' },
];

/** 待核实数值提示（PRD 9.5），在"我的"页展示给内测教练看 */
const UNVERIFIED_NOTICES = [
  '青少年三分线半径按 5.80 m 处理，各地联赛可能是 6.00 / 6.25 m，如与你所在联赛不符请告知',
  '各年龄段单节时长为默认值，可在新建活动时修改',
];

module.exports = {
  TEAM,
  ROSTER,
  ACTIVITIES,
  OPPONENTS,
  TACTICS,
  PIPELINE_STEPS,
  UNVERIFIED_NOTICES,
};
