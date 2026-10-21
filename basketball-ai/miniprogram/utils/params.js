/**
 * 参数层前端镜像 —— 只含表单级元数据。
 *
 * ⚠️ 架构约束（对应开发计划第十二节「契约三条硬规则」与 PRD 4.5）：
 *
 *   本文件 **不得** 包含任何用于判定投篮分值、三分线几何、场地尺寸的常量。
 *   那些数据一律从报告 JSON 的 `params` 段读取，而 `params` 由后端
 *   packages/params 的 resolve() 产出（硬规则 #1）。
 *
 *   前端只保留三类东西：
 *     1. 枚举的中文标签（界面显示用）
 *     2. 表单联动所需的元数据（名单人数、默认节次时长）
 *     3. 口径文案生成（scope label）
 *
 *   这样做的理由：如果前端也存一份三分线半径表，就变成了
 *   「前端一套参数、后端一套参数、AI 一套参数」三份真源，
 *   正是 PRD 风险 7.4 的温床。
 */

/** 赛制枚举 */
const FORMAT = Object.freeze({
  FIVE_V_FIVE: '5V5',
  FOUR_V_FOUR: '4V4',
  THREE_V_THREE: '3V3',
  CUSTOM: 'CUSTOM',
});

/** 年龄段枚举 */
const AGE_GROUP = Object.freeze({
  U8: 'U8',
  U12: 'U12',
  U15: 'U15',
  U18: 'U18',
  SENIOR: 'SENIOR',
});

/** 场地类型枚举 */
const COURT_TYPE = Object.freeze({
  FULL: 'FULL',
  HALF: 'HALF',
});

/** 三分线几何枚举（渲染分支用，判定逻辑不在此） */
const TP_GEOMETRY = Object.freeze({
  ARC_AND_CORNERS: 'ARC_AND_CORNERS',
  PURE_ARC: 'PURE_ARC',
});

/** 赛制中文标签 */
const FORMAT_LABEL = Object.freeze({
  '5V5': '5 对 5',
  '4V4': '4 对 4',
  '3V3': '3 对 3',
  CUSTOM: '自定义',
});

/** 年龄段中文标签 */
const AGE_GROUP_LABEL = Object.freeze({
  U8: '8岁以下',
  U12: '12岁以下',
  U15: '15岁以下',
  U18: '18岁以下',
  SENIOR: '一线',
});

/** 场地类型中文标签 */
const COURT_TYPE_LABEL = Object.freeze({
  FULL: '全场双框',
  HALF: '半场单框',
});

/** 三分线几何中文标签 */
const TP_GEOMETRY_LABEL = Object.freeze({
  ARC_AND_CORNERS: '弧线 + 底角直线',
  PURE_ARC: '纯弧线',
});

/**
 * 每队人数（表单联动用：决定名单格子数）。
 * 注意：这不是判定依据，判定用的 formation_points 来自报告 params。
 */
const PLAYERS_PER_TEAM = Object.freeze({
  '5V5': 5,
  '4V4': 4,
  '3V3': 3,
  CUSTOM: 5,
});

/**
 * 默认节次配置（新建活动时的表单预填值，教练可改）。
 *
 * ⚠️ 这些是 PRD 9.5 #5.3 标注的「待核实」默认值，
 *    实际以教练在新建活动时确认的为准，写回活动表。
 *    后端 packages/params 有同名表，两处若需修改必须同步。
 */
const DEFAULT_PERIODS = Object.freeze({
  U8: { count: 4, minutes: 6 },
  U12: { count: 4, minutes: 8 },
  U15: { count: 4, minutes: 8 },
  U18: { count: 4, minutes: 10 },
  SENIOR: { count: 4, minutes: 10 },
});

/** 3x3 固定为单节（FIBA 3x3 规则），不随年龄段变化 */
const THREE_V_THREE_PERIODS = Object.freeze({ count: 1, minutes: 10, winScore: 21 });

/** 活动模板 */
const TEMPLATE = Object.freeze({
  MATCH: 'MATCH',
  SCRIMMAGE: 'SCRIMMAGE',
  ROUTINE: 'ROUTINE',
});

const TEMPLATE_LABEL = Object.freeze({
  MATCH: '比赛',
  SCRIMMAGE: '团队对抗',
  ROUTINE: '套路演练',
});

/**
 * 哪些赛制需要追问场地类型。
 * 对应 PRD 屏 02：4对4 与自定义没有统一规则，必须显式指定全场/半场。
 */
function requiresCourtTypeChoice(format) {
  return format === FORMAT.FOUR_V_FOUR || format === FORMAT.CUSTOM;
}

/** 是否半场赛制（3x3 恒为半场） */
function isHalfCourt(format, courtType) {
  if (format === FORMAT.THREE_V_THREE) return true;
  return courtType === COURT_TYPE.HALF;
}

/**
 * 生成口径说明文案。
 *
 * 对应 PRD 9.4 #4.8「口径标识常驻」与球队页设计 v0.2 屏 02。
 * 例："5 对 5 · 15岁以下 · 12 场"
 *
 * @param {object} opts
 * @param {string} opts.format
 * @param {string} opts.ageGroup
 * @param {number} [opts.games] 场次数，省略则不显示
 * @returns {string}
 */
function scopeLabel({ format, ageGroup, games }) {
  const parts = [];
  if (format && FORMAT_LABEL[format]) parts.push(FORMAT_LABEL[format]);
  if (ageGroup && AGE_GROUP_LABEL[ageGroup]) parts.push(AGE_GROUP_LABEL[ageGroup]);
  let label = parts.join(' · ');
  if (typeof games === 'number' && games >= 0) {
    label = label ? `${label} · ${games} 场` : `${games} 场`;
  }
  return label;
}

/**
 * 从报告 params 段生成口径标识。
 * 与 scopeLabel 的区别：入参是契约里的 params 对象（大写下划线字段）。
 */
function scopeLabelFromParams(params, games) {
  if (!params) return '';
  return scopeLabel({
    format: params.format,
    ageGroup: params.age_group,
    games,
  });
}

/**
 * 弧外得分的界面文案。
 *
 * 对应契约 x-frontend-consumption-notes：
 * 3x3 下不得出现「三分」字样。
 *
 * 判定本身仍以 event.label_zh（由后端 judge() 产出）为准，
 * 本函数只用于没有 label_zh 时的表头/图例等静态文案。
 */
function arcOutsideLabel(format) {
  return format === FORMAT.THREE_V_THREE ? '远投' : '三分';
}

/** 弧内得分的界面文案 */
function arcInsideLabel(format) {
  return format === FORMAT.THREE_V_THREE ? '近投' : '二分';
}

/**
 * 该赛制下哪些报告模块不可用。
 *
 * 对应 PRD 6.3 降级处理：
 *   - 3x3 关闭快攻识别
 *   - B 级数据不区分个人，跑动热区默认折叠
 */
function disabledModules(params) {
  const disabled = {};
  if (!params) return disabled;

  if (!params.fast_break_enabled) {
    disabled.fastBreak = '3x3 赛制下第一版不提供快攻识别（12 秒时限会大量误判）';
  }
  // 跑动热区在所有赛制下都默认折叠，但 3x3 半场下意义更小
  disabled.movementHeatmapDefaultCollapsed = true;

  return disabled;
}

module.exports = {
  FORMAT,
  AGE_GROUP,
  COURT_TYPE,
  TP_GEOMETRY,
  FORMAT_LABEL,
  AGE_GROUP_LABEL,
  COURT_TYPE_LABEL,
  TP_GEOMETRY_LABEL,
  PLAYERS_PER_TEAM,
  DEFAULT_PERIODS,
  THREE_V_THREE_PERIODS,
  TEMPLATE,
  TEMPLATE_LABEL,
  requiresCourtTypeChoice,
  isHalfCourt,
  scopeLabel,
  scopeLabelFromParams,
  arcOutsideLabel,
  arcInsideLabel,
  disabledModules,
};
