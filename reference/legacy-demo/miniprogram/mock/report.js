/**
 * Mock 报告生成器 —— 对应开发计划 P1-B05「Mock Pipeline」的前端侧
 *
 * 作用：在后端与 AI pipeline 就绪之前，让 F 轨能独立开发全部页面，
 * 并让 B 轨能跑通上传→队列→报告→补录的全链路。
 *
 * ⚠️ 开发计划第十三节的关键要求：**Mock 必须真实响应 params**。
 *
 *   如果 Mock 永远返回同一份 5v5 成人报告，F 轨就测不到
 *   3x3 与青少年场景的界面降级，等真实 pipeline 接入时会集中爆雷。
 *
 *   因此本生成器：
 *     · 传 3V3 → 半场坐标范围、弧内 1 分弧外 2 分、label 为「远投(2分)」、
 *                无节次、无快攻事件、单节 21 分制
 *     · 传 U12 → 与一线同为 6.75 m 半径，弧顶 6.2 m 的球是两分
 *     · 传 SENIOR → 用 6.75 m + 底角直线几何判定
 *
 *   判定逻辑直接复用 utils/courtGeometry.js，与真实后端同源，
 *   这样 Mock 产出的 label_zh / shot_value 与生产环境语义一致。
 *
 * 契约版本：schema_version "1.0"，见 docs/contract/report-schema.json
 */

const { createCourt } = require('../utils/courtGeometry');
const { resolveParams } = require('./paramsMirror');

/** 确定性伪随机，保证每次生成的 Mock 报告一致，便于快照测试 */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * 生成一份符合契约的报告。
 *
 * @param {object} opts
 * @param {string} opts.format      '5V5' | '4V4' | '3V3' | 'CUSTOM'
 * @param {string} opts.ageGroup    'U8'|'U12'|'U15'|'U18'|'SENIOR'
 * @param {string} [opts.courtType] 4V4/CUSTOM 必填
 * @param {string} [opts.activityId]
 * @param {number} [opts.durationS] 录像时长
 * @param {number} [opts.seed]      伪随机种子
 * @param {number} [opts.eventCount]
 * @param {boolean} [opts.simulateFail] 模拟处理失败（开发计划第十三节）
 * @param {boolean} [opts.simulateBadCalibration] 模拟标定质量差
 */
function generateMockReport(opts = {}) {
  const {
    format = '5V5',
    ageGroup = 'U15',
    courtType = null,
    activityId = 'act_mock_001',
    durationS = 2712,           // 45:12
    seed = 20261015,
    eventCount = 34,
    simulateFail = false,
    simulateBadCalibration = false,
  } = opts;

  if (simulateFail) {
    return {
      ok: false,
      status: 'failed',
      activityId,
      error: 'MOCK_FAILURE: 模拟 pipeline 处理异常，用于验证 PRD 3.13 兜底',
      retryable: true,
    };
  }

  const params = resolveParams(format, ageGroup, courtType);
  const court = createCourt(params);
  const rng = makeRng(seed);

  const is3v3 = params.format === '3V3';
  const playersPerTeam = params.players_per_team;
  const periodCount = params.period_count;
  const periodMinutes = params.period_minutes;

  // ---------- periods ----------
  const periods = [];
  if (!is3v3) {
    const periodSec = periodMinutes * 60;
    for (let i = 0; i < periodCount; i += 1) {
      periods.push({ index: i + 1, start_s: i * periodSec, end_s: (i + 1) * periodSec });
    }
  } else {
    // 3x3 单节
    periods.push({ index: 1, start_s: 0, end_s: periodMinutes * 60 });
  }
  const totalPlaySec = periods[periods.length - 1].end_s;

  function periodAt(t) {
    const hit = periods.find((p) => t >= p.start_s && t < p.end_s);
    return hit ? hit.index : periods.length;
  }

  // ---------- events ----------
  const events = [];
  const warnings = [];

  // 出手点分布：青少年比赛集中在 5.5~6.7 m（PoC 第 4 步用的主力区），
  // 加上篮下与中距离，保证弧内弧外都有样本。
  // 出手点分布按 FIBA 6.75 m 弧线布置：篮下 / 中距离 / 弧顶 / 翼侧 / 底角三分，
  // 保证弧内弧外都有样本（底角三分靠 |y| > 6.60 的直线段判定）。
  const shotSpots = [
    { x: 1.8, y: 0.4 },   { x: 2.4, y: -1.2 }, { x: 3.2, y: 1.6 },
    { x: 4.1, y: -2.4 },  { x: 4.6, y: 2.8 },  { x: 5.4, y: -0.8 },
    { x: 5.9, y: 0.0 },   { x: 6.2, y: 0.3 },  { x: 6.4, y: -2.2 },
    { x: 6.9, y: 0.0 },   { x: 7.2, y: 3.1 },  { x: 8.1, y: 0.6 },
    { x: 0.5, y: 6.9 },   { x: 1.2, y: -6.9 }, { x: 7.6, y: -0.4 },
    { x: 2.0, y: 4.6 },   { x: 5.0, y: 4.4 },  { x: 6.8, y: 0.2 },
  ].filter((s) => court.inBounds(s.x, s.y));

  let shotMade = 0;
  let shotAtt = 0;
  let arcOutMade = 0;
  let arcOutAtt = 0;
  let fastBreaks = 0;
  let turnovers = 0;

  for (let i = 0; i < eventCount; i += 1) {
    const t = Math.round((totalPlaySec * (i + 0.5)) / eventCount + rng() * 20);
    const ts = Math.min(Math.max(t, 1), durationS - 2);
    const period = periodAt(ts);

    // 事件类型分布：投篮为主，穿插失误与快攻（3x3 不生成快攻）
    const roll = rng();
    let kind = 'SHOT';
    if (roll > 0.86) kind = 'TURNOVER';
    else if (roll > 0.78 && !is3v3 && params.fast_break_enabled) kind = 'FAST_BREAK';

    const id = `e${String(i + 1).padStart(3, '0')}`;

    if (kind === 'SHOT') {
      const spot = shotSpots[Math.floor(rng() * shotSpots.length)] || { x: 4, y: 0 };
      // 加一点抖动，避免所有点完全重叠
      const x = Number((spot.x + (rng() - 0.5) * 0.6).toFixed(2));
      const y = Number((spot.y + (rng() - 0.5) * 0.6).toFixed(2));

      const shot = { x_m: x, y_m: y, made: rng() < 0.44 };
      const j = court.judge(shot);

      shotAtt += 1;
      if (j.made) shotMade += 1;
      if (j.behind_three_point_line) {
        arcOutAtt += 1;
        if (j.made) arcOutMade += 1;
      }

      events.push({
        id,
        kind: 'SHOT',
        timestamp_s: ts,
        period,
        x_m: x,
        y_m: y,
        distance_m: j.distance_m,
        in_bounds: j.in_bounds,
        behind_three_point_line: j.behind_three_point_line,
        shot_value: j.points_if_made,
        made: j.made,
        // ⚠️ label_zh 由 judge() 产出（契约硬规则 #2），3x3 下自动是「远投(2分)」
        label_zh: j.label_zh,
        confidence: Number((0.62 + rng() * 0.36).toFixed(2)),
        clip_key: `clips/${activityId}/${id}.mp4`,
        clip_start_s: Math.max(0, ts - 4),
        clip_duration_s: 8 + Math.floor(rng() * 8),   // 契约要求 8~15
        player_id: null,                               // 硬规则 #3
        attribution_source: null,
      });
    } else if (kind === 'FAST_BREAK') {
      fastBreaks += 1;
      events.push({
        id,
        kind: 'FAST_BREAK',
        timestamp_s: ts,
        period,
        x_m: null, y_m: null, distance_m: null,
        in_bounds: true,
        behind_three_point_line: null,
        shot_value: null, made: null, label_zh: null,
        confidence: Number((0.55 + rng() * 0.4).toFixed(2)),
        clip_key: `clips/${activityId}/${id}.mp4`,
        clip_start_s: Math.max(0, ts - 5),
        clip_duration_s: 10 + Math.floor(rng() * 5),
        player_id: null,
        attribution_source: null,
      });
    } else {
      turnovers += 1;
      events.push({
        id,
        kind: 'TURNOVER',
        timestamp_s: ts,
        period,
        x_m: Number((1 + rng() * 8).toFixed(2)),
        y_m: Number(((rng() - 0.5) * 2 * court.yHalf * 0.8).toFixed(2)),
        distance_m: null,
        in_bounds: true,
        behind_three_point_line: null,
        shot_value: null, made: null, label_zh: null,
        confidence: Number((0.5 + rng() * 0.45).toFixed(2)),
        clip_key: `clips/${activityId}/${id}.mp4`,
        clip_start_s: Math.max(0, ts - 4),
        clip_duration_s: 9 + Math.floor(rng() * 5),
        player_id: null,
        attribution_source: null,
      });
    }
  }

  events.sort((a, b) => a.timestamp_s - b.timestamp_s);

  // ---------- formations ----------
  // 每 5 秒一次（PRD 5.3）；≥30% 的 label 为 null（PRD 9.2 #2.14）
  const formations = [];
  const FORMATION_LABELS = is3v3
    ? ['1-2 落位', '三角站位', '高位挡拆']
    : ['2-3 高位落位', '3-2 低位', '1-4 box', '菱形落位', '4-out 1-in'];

  for (let t = 5; t < Math.min(totalPlaySec, durationS); t += 5) {
    const positions = [];
    for (let k = 0; k < playersPerTeam; k += 1) {
      const angle = (k / playersPerTeam) * Math.PI * 1.1 + Math.PI * 0.45;
      const radius = 3.2 + rng() * 4.5;
      let x = radius * Math.cos(angle);
      let y = radius * Math.sin(angle);
      // 夹到场地范围内
      x = Math.min(Math.max(x, court.xMin + 0.3), court.xMax - 0.3);
      y = Math.min(Math.max(y, -court.yHalf + 0.3), court.yHalf - 0.3);
      positions.push([Number(x.toFixed(2)), Number(y.toFixed(2))]);
    }

    const confidence = Number((0.25 + rng() * 0.7).toFixed(2));
    formations.push({
      timestamp_s: t,
      period: periodAt(t),
      positions_m: positions,
      ball_m: [Number((2 + rng() * 6).toFixed(2)), Number(((rng() - 0.5) * 6).toFixed(2))],
      // 置信度低于 0.6 时不给阵型名（界面设计 v0.1 屏 08：宁可少标不要标错）
      label: confidence >= 0.6
        ? FORMATION_LABELS[Math.floor(rng() * FORMATION_LABELS.length)]
        : null,
      confidence,
    });
  }

  const nullLabelCount = formations.filter((f) => f.label === null).length;

  // ---------- calibration ----------
  const reproj = simulateBadCalibration ? 8.7 : Number((1.2 + rng() * 2.6).toFixed(2));
  const calibOk = reproj <= 5;
  if (!calibOk) {
    warnings.push(`场地标定重投影误差 ${reproj} px 超过 5 px 阈值（PRD 9.2 #2.1），坐标可能整体偏移`);
  }

  // ---------- warnings ----------
  // 开发计划第十三节：随机注入 1-2 条，验证前端告警条
  const oob = events.filter((e) => e.in_bounds === false);
  if (oob.length) {
    warnings.push(`${oob.length} 个事件坐标落在场地范围外，可能是标定偏移`);
  }
  if (rng() < 0.5) {
    warnings.push('第 3 节有约 40 秒画面被球员遮挡，该时段检测覆盖率偏低');
  }
  if (is3v3) {
    warnings.push('3x3 赛制 · 快攻识别已关闭（12 秒进攻时限下会大量误判），部分指标暂不适用');
  }

  // ---------- team_stats ----------
  // 只放 AI 能自动算的。篮板/助攻/抢断需补录，不在此（契约说明）
  const teamStats = {
    shots_made: shotMade,
    shots_attempted: shotAtt,
    arc_out_made: arcOutMade,
    arc_out_attempted: arcOutAtt,
    fast_breaks: is3v3 ? 0 : fastBreaks,
    possessions: Math.round(eventCount * 2.4),
    turnovers,
  };

  return {
    ok: true,
    status: 'done',
    report: {
      schema_version: '1.0',
      activity_id: activityId,
      pipeline_version: 'mock-1.0.0',
      generated_at: new Date().toISOString(),
      params,
      video: {
        key: `videos/${activityId}/raw.mp4`,
        duration_s: durationS,
        fps: 30,
        resolution: [1920, 1080],
      },
      calibration: {
        ok: calibOk,
        reproj_error_px: reproj,
        homography: null,
        note: calibOk ? '' : '标定质量不足，建议重新录制或改用手动四点标定',
      },
      events,
      formations,
      periods,
      team_stats: teamStats,
      warnings,
    },
    // Mock 自描述信息，供测试断言（不属于契约字段）
    _mock: {
      eventCount: events.length,
      arcOutRatio: shotAtt ? arcOutAtt / shotAtt : 0,
      formationCount: formations.length,
      nullLabelRatio: formations.length ? nullLabelCount / formations.length : 0,
      allPlayerIdsNull: events.every((e) => e.player_id === null),
      shotValueSet: Array.from(new Set(events.filter((e) => e.shot_value != null).map((e) => e.shot_value))).sort(),
      labelSet: Array.from(new Set(events.filter((e) => e.label_zh).map((e) => e.label_zh))).sort(),
      clipDurations: events.filter((e) => e.clip_duration_s != null).map((e) => e.clip_duration_s),
    },
  };
}

module.exports = { generateMockReport, makeRng };
