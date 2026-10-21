/**
 * paramsMirror —— Python resolve() 的前端镜像
 *
 * ⚠️⚠️ 使用范围严格受限 ⚠️⚠️
 *
 *   本文件 **只允许被 mock/ 与 tests/ 引用**，任何页面或组件都不得 import。
 *
 *   原因：生产环境的 params 一律来自后端 packages/params 的 resolve()，
 *   随报告 JSON 下发（契约硬规则 #1）。如果页面自己也有一份参数表，
 *   就变成"前端一套、后端一套、AI 一套"三份真源 —— 正是 PRD 风险 7.4 的温床。
 *
 *   本镜像存在的唯一理由是：Mock Pipeline 要模拟后端产出契约形状的 params，
 *   否则 F 轨在后端就绪前无法开发页面（开发计划 P1-B05 / 第十三节）。
 *
 *   tests/paramsMirror.test.js 会用 Python 生成的 fixture 逐字段比对，
 *   证明这份镜像与真源一致。**修改 packages/params 后必须重新生成 fixture。**
 */

const FIBA_BASELINE_TO_HOOP = 1.575;
const FIBA_FULL_LENGTH = 28.0;
const FIBA_FULL_WIDTH = 15.0;
const FIBA_3X3_LENGTH = 11.0;
const FIBA_3X3_WIDTH = 15.0;
const FIBA_ADULT_3PT = 6.75;
const FIBA_CORNER_LATERAL = 6.60;

const GEOMETRY = { ARC_AND_CORNERS: 'ARC_AND_CORNERS', PURE_ARC: 'PURE_ARC' };

/** 三分线半径表：FIBA 2.5.4 统一 6.75 m，与 packages/params/params.py 同步 */
const THREE_PT_RADIUS = {
  U8: FIBA_ADULT_3PT,
  U12: FIBA_ADULT_3PT,
  U15: FIBA_ADULT_3PT,
  U18: FIBA_ADULT_3PT,
  SENIOR: FIBA_ADULT_3PT,
};

/** 单节时长默认值（分钟）。[待核实] 与 Python _period_minutes 同步 */
const PERIOD_MINUTES = {
  U8: 6.0,
  U12: 8.0,
  U15: 8.0,
  U18: 10.0,
  SENIOR: 10.0,
};

const PLAYERS = { '5V5': 5, '4V4': 4, '3V3': 3, CUSTOM: 5 };

/**
 * 解析出契约 params 段。
 *
 * @param {string} format    '5V5' | '4V4' | '3V3' | 'CUSTOM'
 * @param {string} ageGroup  'U8'|'U12'|'U15'|'U18'|'SENIOR'
 * @param {string|null} courtType  'FULL'|'HALF'，4V4/CUSTOM 必填
 * @param {number|null} radiusM   非标准三分线半径（某联赛自定少年线时才传）
 * @returns {object} 契约 params 段
 */
function resolveParams(format, ageGroup, courtType = null, radiusM = null) {
  if (!THREE_PT_RADIUS[ageGroup]) {
    throw new Error(`resolveParams: 未知年龄段 ${ageGroup}`);
  }
  if (!PLAYERS[format]) {
    throw new Error(`resolveParams: 未知赛制 ${format}`);
  }

  // ---------- 场地 ----------
  let court;
  if (format === '3V3') {
    court = { type: 'HALF', length: FIBA_3X3_LENGTH, width: FIBA_3X3_WIDTH, hoops: 1 };
  } else if (format === '5V5') {
    court = { type: 'FULL', length: FIBA_FULL_LENGTH, width: FIBA_FULL_WIDTH, hoops: 2 };
  } else {
    // 4V4 / CUSTOM 没有统一规则，必须显式指定（PRD 屏 02）
    if (!courtType) {
      throw new Error(`${format} 没有统一规则，必须显式指定 courtType（全场/半场）`);
    }
    court = courtType === 'FULL'
      ? { type: 'FULL', length: FIBA_FULL_LENGTH, width: FIBA_FULL_WIDTH, hoops: 2 }
      : { type: 'HALF', length: FIBA_FULL_LENGTH / 2, width: FIBA_FULL_WIDTH, hoops: 1 };
  }

  // ---------- 三分线几何 ----------
  // 与 Python three_point_spec_for 严格对应（FIBA 2.5.4）：
  //   底角直线段存在的充要条件：半径 > 6.60 且场地半宽 > 6.60
  //   6.75 m + 7.5 m 半宽 → 弧线 + 底角直线（5v5 / 4v4 / 3x3 全场皆然）
  //   半径或半宽 ≤ 6.60 → 弧线碰不到底角线的位置，退化为纯弧
  let geometry;
  let radius = radiusM == null ? THREE_PT_RADIUS[ageGroup] : radiusM;
  let cornerLateral = null;
  let cornerJunctionX = null;

  if (radius > FIBA_CORNER_LATERAL && court.width / 2 > FIBA_CORNER_LATERAL) {
    geometry = GEOMETRY.ARC_AND_CORNERS;
    cornerLateral = FIBA_CORNER_LATERAL;
  } else {
    geometry = GEOMETRY.PURE_ARC;
  }

  if (geometry === GEOMETRY.ARC_AND_CORNERS && cornerLateral != null && radius > cornerLateral) {
    cornerJunctionX = Math.sqrt(radius * radius - cornerLateral * cornerLateral);
  }

  // ---------- 规则 ----------
  const is3v3 = format === '3V3';
  const players = PLAYERS[format];

  const xMin = -FIBA_BASELINE_TO_HOOP;
  const xMax = court.length - FIBA_BASELINE_TO_HOOP;

  const r3 = (n) => (n == null ? null : Number(Number(n).toFixed(3)));

  return {
    format,
    age_group: ageGroup,
    court_type: court.type,
    court_length_m: court.length,
    court_width_m: court.width,
    baseline_to_hoop_m: FIBA_BASELINE_TO_HOOP,
    three_point_radius_m: radius,
    three_point_geometry: geometry,
    corner_lateral_m: cornerLateral,
    corner_junction_x_m: r3(cornerJunctionX),
    x_range_m: [r3(xMin), r3(xMax)],
    y_half_m: court.width / 2,
    hoop_count: court.hoops,
    period_count: is3v3 ? 1 : 4,
    period_minutes: is3v3 ? 10.0 : PERIOD_MINUTES[ageGroup],
    shot_clock_s: is3v3 ? 12 : 24,
    inside_arc_points: is3v3 ? 1 : 2,
    outside_arc_points: is3v3 ? 2 : 3,
    fast_break_enabled: !is3v3,
    fast_break_max_possession_s: is3v3 ? null : 8.0,
    win_score: is3v3 ? 21 : null,
    players_per_team: players,
    formation_points: players,
    max_tracked_targets: players * 2,
    formation_sample_interval_s: 5.0,
  };
}

module.exports = {
  resolveParams,
  GEOMETRY,
  // 常量导出仅供测试比对，页面不得使用
  _constants: {
    FIBA_BASELINE_TO_HOOP,
    FIBA_FULL_LENGTH,
    FIBA_FULL_WIDTH,
    FIBA_3X3_LENGTH,
    FIBA_3X3_WIDTH,
    FIBA_ADULT_3PT,
    FIBA_CORNER_LATERAL,
    THREE_PT_RADIUS,
    PERIOD_MINUTES,
  },
};
