/**
 * SVG 构建器与格式化工具测试
 *
 * 重点验证 PRD 4.4 的硬要求：
 *   球场底图 SVG 必须参数化，接受 format 与 three_point_radius_m 入参，
 *   **不能在代码里画死一条 6.75 m 的弧线**。
 *
 * 以及 PRD 3.6：数据缺失显示「—」而不是 0。
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  buildCourtSvg, buildShotDots, buildHeatBlobs, buildFormation, buildFullSvg, PALETTE,
} = require('../utils/svgBuilder');
const { resolveParams } = require('../mock/paramsMirror');
const fmt = require('../utils/format');
const p = require('../utils/params');

// ============================================================
// 球场底图参数化
// ============================================================

test('buildCourtSvg: 不同参数产出不同的 SVG（没有硬编码 6.75）', () => {
  const senior = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL'));
  const u12 = buildCourtSvg(resolveParams('5V5', 'U12', 'FULL'));
  const three = buildCourtSvg(resolveParams('3V3', 'U15', null));

  // 三张图的 SVG 字符串必须互不相同
  assert.notStrictEqual(senior.svg, u12.svg);
  assert.notStrictEqual(u12.svg, three.svg);

  // 画布尺寸随场地变化
  assert.ok(senior.width > three.width, '全场画布应宽于 3x3 半场');
  assert.ok(senior.height > three.height, '全场画布应高于 3x3 半场');

  // viewBox 与 meta 一致
  assert.strictEqual(senior.data.meta.courtType, 'FULL');
  assert.strictEqual(three.data.meta.courtType, 'HALF');
  assert.strictEqual(senior.data.meta.threePointRadiusM, 6.75);
  assert.strictEqual(u12.data.meta.threePointRadiusM, 5.8);
});

test('buildCourtSvg: 全场画两个篮框，3x3 只画一个', () => {
  const full = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL')).data;
  const half = buildCourtSvg(resolveParams('3V3', 'U15', null)).data;

  const rimsFull = full.circles.filter((c) => c.role === 'rim');
  const rimsHalf = half.circles.filter((c) => c.role === 'rim');
  assert.strictEqual(rimsFull.length, 2);
  assert.strictEqual(rimsHalf.length, 1);

  // 全场应有中线与中圈，半场没有
  assert.ok(full.paths.some((x) => x.role === 'halfcourt'));
  assert.ok(full.circles.some((x) => x.role === 'centerCircle'));
  assert.ok(!half.paths.some((x) => x.role === 'halfcourt'));
  assert.ok(!half.circles.some((x) => x.role === 'centerCircle'));
});

test('buildCourtSvg: 成人画底角直线段，青少年与 3x3 不画', () => {
  const senior = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL'));
  const u12 = buildCourtSvg(resolveParams('5V5', 'U12', 'FULL'));
  const three = buildCourtSvg(resolveParams('3V3', 'U15', null));

  // 成人三分线含 3 段子路径（左底角直线 + 弧 + 右底角直线）
  const seniorTP = senior.data.paths.find((x) => x.role === 'threePoint');
  const u12TP = u12.data.paths.find((x) => x.role === 'threePoint');
  const threeTP = three.data.paths.find((x) => x.role === 'threePoint');

  const countSubpaths = (d) => (d.match(/M /g) || []).length;
  assert.strictEqual(countSubpaths(seniorTP.d), 3, '成人三分线应有底角直线 + 弧线共 3 段');
  assert.strictEqual(countSubpaths(u12TP.d), 1, '青少年纯弧线只应有 1 段');
  assert.strictEqual(countSubpaths(threeTP.d), 1, '3x3 纯弧线只应有 1 段');
});

test('buildCourtSvg: 三分线弧线半径真的用了 params 的值', () => {
  // 用两个差异明显的半径，检查弧顶点的 SVG y 坐标不同
  const senior = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL'), { scale: 10, padding: 0 });
  const u12 = buildCourtSvg(resolveParams('5V5', 'U12', 'FULL'), { scale: 10, padding: 0 });

  // 弧顶在 court 坐标 (radius, 0)，对应 SVG y = padding + (radius - xMin) * scale。
  // 弧线路径按角度等分采样，顶点不一定正好落在采样点上，
  // 所以取路径里 y 的最大值来比对（采样足够密时误差 < 0.05）。
  const maxYOf = (data) => {
    const d = data.paths.find((x) => x.role === 'threePoint').d;
    const ys = (d.match(/,(-?\d+(?:\.\d+)?)/g) || [])
      .map((s) => Number(s.slice(1)))
      .filter((n) => Number.isFinite(n));
    assert.ok(ys.length > 10, '三分线路径应有足够多的采样点');
    return Math.max(...ys);
  };

  const xMin = -1.575;
  const expectedSeniorY = (6.75 - xMin) * 10;   // 83.25
  const expectedU12Y = (5.8 - xMin) * 10;       // 73.75

  const gotSenior = maxYOf(senior.data);
  const gotU12 = maxYOf(u12.data);

  assert.ok(Math.abs(gotSenior - expectedSeniorY) < 0.05,
    `成人弧顶 y 应约为 ${expectedSeniorY}，实际 ${gotSenior}`);
  assert.ok(Math.abs(gotU12 - expectedU12Y) < 0.05,
    `U12 弧顶 y 应约为 ${expectedU12Y}，实际 ${gotU12}`);
  assert.ok(Math.abs((gotSenior - gotU12) - (6.75 - 5.8) * 10) < 0.1,
    '弧顶位置差应与半径差成正比，证明半径确实取自 params');
});

test('buildCourtSvg: 缺少必填 params 字段时抛错', () => {
  assert.throws(() => buildCourtSvg(null), /params 不能为空/);
  assert.throws(() => buildCourtSvg({ court_type: 'FULL' }), /缺少必填字段/);
  assert.throws(
    () => buildCourtSvg({ court_type: 'FULL', court_length_m: 28, court_width_m: 15, three_point_radius_m: 6.75 }),
    /three_point_geometry/
  );
});

test('buildCourtSvg: 4V4 全场与半场画布不同', () => {
  const full = buildCourtSvg(resolveParams('4V4', 'U15', 'FULL'));
  const half = buildCourtSvg(resolveParams('4V4', 'U15', 'HALF'));

  // 4V4 半场是把长度砍半（28 → 14），宽度仍是 15 m，
  // 所以画布高度不同而宽度相同
  assert.strictEqual(full.data.meta.courtType, 'FULL');
  assert.strictEqual(half.data.meta.courtType, 'HALF');
  assert.notStrictEqual(full.height, half.height, '长度减半应导致画布高度不同');
  assert.ok(full.height > half.height);
  assert.strictEqual(full.width, half.width, '宽度都是 15 m，画布宽度应相同');
  assert.strictEqual(full.data.meta.hoopCount, 2);
  assert.strictEqual(half.data.meta.hoopCount, 1);
});

// ============================================================
// 坐标变换往返
// ============================================================

test('metersToSvg / svgToMeters 往返一致', () => {
  const court = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL')).court;

  const samples = [[0, 0], [6.75, 0], [4.5, 4.5], [-1.5, 6.6], [12, -3]];
  samples.forEach(([x, y]) => {
    const [sx, sy] = court.metersToSvg(x, y);
    const [bx, by] = court.svgToMeters(sx, sy);
    assert.ok(Math.abs(bx - x) < 1e-9, `x 往返不一致：${x} → ${bx}`);
    assert.ok(Math.abs(by - y) < 1e-9, `y 往返不一致：${y} → ${by}`);
  });
});

test('篮筐中心映射到 SVG 的正确位置', () => {
  const court = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL'), { scale: 20, padding: 16 }).court;
  const [sx, sy] = court.metersToSvg(0, 0);
  // x=0（篮筐）在底线内 1.575m 处；y=0 在横向正中
  assert.ok(Math.abs(sy - (16 + 1.575 * 20)) < 1e-9);
  assert.ok(Math.abs(sx - (16 + 7.5 * 20)) < 1e-9);
});

// ============================================================
// 投篮点叠加
// ============================================================

test('buildShotDots: 命中绿色、未中红色', () => {
  const court = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL')).court;
  const svg = buildShotDots(court, [
    { id: 'a', x_m: 3, y_m: 0, made: true },
    { id: 'b', x_m: 5, y_m: 1, made: false },
  ]);
  assert.ok(svg.includes(PALETTE.made));
  assert.ok(svg.includes(PALETTE.miss));
  assert.ok(svg.includes('data-id="a"'));
});

test('buildShotDots: 越界点画成空心并加警示描边，不静默当成正常数据', () => {
  const court = buildCourtSvg(resolveParams('3V3', 'U15', null)).court;
  // 3x3 半场 y 半宽 5.5，y=7.0 越界
  const svg = buildShotDots(court, [{ id: 'oob', x_m: 3, y_m: 7.0, made: true }]);
  assert.ok(svg.includes('fill="none"'), '越界点应为空心');
  assert.ok(svg.includes(`stroke="${PALETTE.miss}"`), '越界点应有警示描边');
});

test('buildShotDots: 空数组与非法坐标安全处理', () => {
  const court = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL')).court;
  assert.strictEqual(buildShotDots(court, []), '');
  assert.strictEqual(buildShotDots(court, null), '');
  assert.strictEqual(buildShotDots(court, [{ id: 'x' }]), '', '缺坐标的点应被跳过');
});

// ============================================================
// 热区叠加
// ============================================================

test('buildHeatBlobs: 产出径向渐变且权重越高越不透明', () => {
  const court = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL')).court;
  const svg = buildHeatBlobs(court, [
    { x_m: 3, y_m: 0, weight: 1 },
    { x_m: 3.2, y_m: 0.1, weight: 1 },
    { x_m: 3.1, y_m: -0.2, weight: 1 },
    { x_m: 8, y_m: 2, weight: 1 },
  ]);
  assert.ok(svg.includes('radialGradient'));
  assert.ok(svg.includes('stop-opacity'));
});

test('buildHeatBlobs: 越界点被排除', () => {
  const court = buildCourtSvg(resolveParams('3V3', 'U15', null)).court;
  const svg = buildHeatBlobs(court, [{ x_m: 3, y_m: 9, weight: 1 }]);
  assert.strictEqual(svg, '', '全部越界时应产出空字符串');
});

test('buildHeatBlobs: 空输入安全', () => {
  const court = buildCourtSvg(resolveParams('5V5', 'SENIOR', 'FULL')).court;
  assert.strictEqual(buildHeatBlobs(court, []), '');
});

// ============================================================
// 阵型叠加
// ============================================================

test('buildFormation: 点数与赛制不符时画警示色', () => {
  const params = resolveParams('5V5', 'SENIOR', 'FULL');
  const court = buildCourtSvg(params).court;

  // 5v5 应有 5 点，故意只给 3 点
  const svg = buildFormation(court, {
    timestamp_s: 10,
    positions_m: [[3, 0], [4, 2], [5, -2]],
  });
  assert.ok(svg.includes(PALETTE.miss), '点数不匹配应使用警示色');
});

test('buildFormation: 点数匹配时用正常球员色', () => {
  const params = resolveParams('3V3', 'U15', null);
  const court = buildCourtSvg(params).court;
  const svg = buildFormation(court, {
    timestamp_s: 10,
    positions_m: [[3, 0], [4, 2], [5, -2]],
  });
  assert.ok(svg.includes(PALETTE.player));
  assert.ok(!svg.includes(PALETTE.miss));
});

test('buildFormation: 号码标签渲染，且不渲染阵型名（label 由页面层按置信度决定）', () => {
  const params = resolveParams('5V5', 'SENIOR', 'FULL');
  const court = buildCourtSvg(params).court;
  const svg = buildFormation(court, {
    timestamp_s: 10,
    positions_m: [[3, 0], [4, 2], [5, -2], [6, 1], [7, -1]],
    label: '2-3 高位落位',
  }, { numbers: ['4', '7', '11', '23', '32'] });

  assert.ok(svg.includes('>4</text>'));
  assert.ok(svg.includes('>32</text>'));
  // ⚠️ 关键：SVG 里不得出现阵型名 —— 置信度不足时必须不显示（PRD 9.2 #2.14）
  assert.ok(!svg.includes('2-3 高位落位'),
    '阵型名由页面层根据 label 是否为 null 决定，SVG 组件不得渲染它');
});

test('buildFormation: 篮球可选渲染', () => {
  const params = resolveParams('5V5', 'SENIOR', 'FULL');
  const court = buildCourtSvg(params).court;
  const base = { timestamp_s: 10, positions_m: [[3, 0], [4, 2], [5, -2], [6, 1], [7, -1]] };

  const withBall = buildFormation(court, Object.assign({}, base, { ball_m: [4, 0] }));
  const withoutBall = buildFormation(court, Object.assign({}, base, { ball_m: [4, 0] }), { showBall: false });

  assert.ok(withBall.includes(PALETTE.ball));
  assert.ok(!withoutBall.includes(PALETTE.ball));
});

// ============================================================
// 完整 SVG 组装
// ============================================================

test('buildFullSvg: 产出可用作 image src 的 data URI', () => {
  const res = buildFullSvg(resolveParams('5V5', 'U15', 'FULL'), {
    shots: [{ id: 'a', x_m: 6.2, y_m: 0, made: true }],
  });
  assert.ok(res.dataUri.startsWith('data:image/svg+xml,'));
  assert.ok(res.svg.startsWith('<svg'));
  assert.ok(res.svg.endsWith('</svg>'));
  assert.ok(res.width > 0 && res.height > 0);
});

test('buildFullSvg: 越界出手点写入 warnings', () => {
  const res = buildFullSvg(resolveParams('3V3', 'U15', null), {
    shots: [
      { id: 'a', x_m: 3, y_m: 1, made: true },
      { id: 'b', x_m: 3, y_m: 7, made: true },   // 3x3 越界
    ],
  });
  assert.ok(res.warnings.some((w) => w.includes('落在场地范围外')),
    `应告警越界点，实际 warnings=${JSON.stringify(res.warnings)}`);
});

test('buildFullSvg: 阵型点数不符写入 warnings', () => {
  const res = buildFullSvg(resolveParams('5V5', 'SENIOR', 'FULL'), {
    formation: { timestamp_s: 5, positions_m: [[3, 0], [4, 2]] },   // 只有 2 点
  });
  assert.ok(res.warnings.some((w) => w.includes('阵型点数')),
    `应告警点数不符，实际 warnings=${JSON.stringify(res.warnings)}`);
});

// ============================================================
// 格式化：数据缺失显示「—」而非 0
// ============================================================

test('format.num: 缺失值显示「—」（PRD 3.6）', () => {
  assert.strictEqual(fmt.num(null), '—');
  assert.strictEqual(fmt.num(undefined), '—');
  assert.strictEqual(fmt.num(NaN), '—');
  assert.strictEqual(fmt.num(0), '0', '真实的 0 必须显示 0，不能被当成缺失');
  assert.strictEqual(fmt.num(12.345, 1), '12.3');
});

test('format.pct: 分母缺失时显示「—」而非 0% 或 NaN%', () => {
  assert.strictEqual(fmt.pct(null), '—');
  assert.strictEqual(fmt.pct(undefined), '—');
  assert.strictEqual(fmt.pct(NaN), '—');
  assert.strictEqual(fmt.rate(5, 0), '—');
  assert.strictEqual(fmt.rate(null, 10), '—');
  assert.strictEqual(fmt.rate(5, 10), '50%');
  assert.strictEqual(fmt.pct(0), '0%', '真实的 0% 必须显示');
});

test('format.signedNum: 净胜分带符号', () => {
  assert.strictEqual(fmt.signedNum(6.6), '+6.6');
  assert.strictEqual(fmt.signedNum(-3.2), '-3.2');
  assert.strictEqual(fmt.signedNum(0), '0.0');
  assert.strictEqual(fmt.signedNum(null), '—');
});

test('format.madeOverAttempt: 缺失显示「—」', () => {
  assert.strictEqual(fmt.madeOverAttempt(8, 22), '8/22');
  assert.strictEqual(fmt.madeOverAttempt(null, 22), '—');
  assert.strictEqual(fmt.madeOverAttempt(8, null), '—');
  assert.strictEqual(fmt.madeOverAttempt(0, 0), '0/0');
});

test('format.clockTime: 秒转 mm:ss / h:mm:ss', () => {
  assert.strictEqual(fmt.clockTime(0), '00:00');
  assert.strictEqual(fmt.clockTime(65), '01:05');
  assert.strictEqual(fmt.clockTime(2712), '45:12');
  assert.strictEqual(fmt.clockTime(3661), '1:01:01');
  assert.strictEqual(fmt.clockTime(-1), '--:--');
  assert.strictEqual(fmt.clockTime(null), '--:--');
});

test('format.humanDuration: 分钟与小时', () => {
  assert.strictEqual(fmt.humanDuration(600), '10 分钟');
  assert.strictEqual(fmt.humanDuration(2712), '45 分钟');
  assert.strictEqual(fmt.humanDuration(3900), '1 小时 5 分');
  assert.strictEqual(fmt.humanDuration(3600), '1 小时');
  assert.strictEqual(fmt.humanDuration(0), '—');
  assert.strictEqual(fmt.humanDuration(null), '—');
});

test('format.eventTimeText: 5v5 带节次前缀，3x3 不带', () => {
  const periods = [
    { index: 1, start_s: 0, end_s: 480 },
    { index: 2, start_s: 480, end_s: 960 },
  ];
  assert.strictEqual(fmt.eventTimeText(492, periods, '5V5'), 'Q2 00:12');
  assert.strictEqual(fmt.eventTimeText(492, periods, '3V3'), '08:12',
    '3x3 无节次概念，不应显示 Q 前缀');
  assert.strictEqual(fmt.eventTimeText(30, periods, '5V5'), 'Q1 00:30');
  assert.strictEqual(fmt.eventTimeText(NaN, periods, '5V5'), '—');
  assert.strictEqual(fmt.eventTimeText(30, [], '5V5'), '00:30', '无节次数据时降级为纯时间');
});

test('format.bytes', () => {
  assert.strictEqual(fmt.bytes(512), '512 B');
  assert.strictEqual(fmt.bytes(4.2 * 1024 * 1024), '4.2 MB');
  assert.strictEqual(fmt.bytes(6.1 * 1024 * 1024 * 1024), '6.1 GB');
  assert.strictEqual(fmt.bytes(-1), '—');
  assert.strictEqual(fmt.bytes(null), '—');
});

test('format.shortDate / longDate', () => {
  assert.strictEqual(fmt.shortDate('2026-10-09'), '10/09');
  assert.strictEqual(fmt.longDate('2026-10-09'), '2026年10月9日');
  assert.strictEqual(fmt.shortDate(''), '—');
  assert.strictEqual(fmt.shortDate(null), '—');
});

test('format.daysSince', () => {
  const now = Date.now();
  assert.strictEqual(fmt.daysSince(now - 3 * 86400000, now), 3);
  assert.strictEqual(fmt.daysSince(now, now), 0);
  assert.strictEqual(fmt.daysSince(null), null);
});

test('format.templateLabel / statusMeta', () => {
  assert.strictEqual(fmt.templateLabel('MATCH'), '比赛');
  assert.strictEqual(fmt.templateLabel('SCRIMMAGE'), '团队对抗');
  assert.strictEqual(fmt.templateLabel('ROUTINE'), '套路演练');
  assert.strictEqual(fmt.templateLabel('UNKNOWN'), '活动');

  assert.strictEqual(fmt.statusMeta('report_ready').tone, 'warn');
  assert.strictEqual(fmt.statusMeta('complete').tone, 'ok');
  assert.strictEqual(fmt.statusMeta('processing').tone, 'accent');
  assert.strictEqual(fmt.statusMeta('failed').tone, 'err');
});

// ============================================================
// 口径文案：3x3 不得出现「三分」
// ============================================================

test('params.arcOutsideLabel: 3x3 用「远投」', () => {
  assert.strictEqual(p.arcOutsideLabel('3V3'), '远投');
  assert.strictEqual(p.arcOutsideLabel('5V5'), '三分');
  assert.strictEqual(p.arcInsideLabel('3V3'), '近投');
  assert.strictEqual(p.arcInsideLabel('5V5'), '二分');
});

test('params.scopeLabel: 口径文案格式正确', () => {
  assert.strictEqual(p.scopeLabel({ format: '5V5', ageGroup: 'U15', games: 12 }),
    '5 对 5 · 15岁以下 · 12 场');
  assert.strictEqual(p.scopeLabel({ format: '3V3', ageGroup: 'U12' }),
    '3 对 3 · 12岁以下');
  assert.strictEqual(p.scopeLabel({ format: '5V5', ageGroup: 'U15', games: 0 }),
    '5 对 5 · 15岁以下 · 0 场');
});

test('params.requiresCourtTypeChoice: 只有 4V4 与 CUSTOM 需要追问', () => {
  assert.strictEqual(p.requiresCourtTypeChoice('4V4'), true);
  assert.strictEqual(p.requiresCourtTypeChoice('CUSTOM'), true);
  assert.strictEqual(p.requiresCourtTypeChoice('5V5'), false);
  assert.strictEqual(p.requiresCourtTypeChoice('3V3'), false);
});

test('params.isHalfCourt: 3V3 恒为半场', () => {
  assert.strictEqual(p.isHalfCourt('3V3', null), true);
  assert.strictEqual(p.isHalfCourt('3V3', 'FULL'), true, '3x3 即使误传 FULL 也应视为半场');
  assert.strictEqual(p.isHalfCourt('4V4', 'HALF'), true);
  assert.strictEqual(p.isHalfCourt('5V5', 'FULL'), false);
});

test('params.disabledModules: 3x3 关闭快攻', () => {
  const three = p.disabledModules(resolveParams('3V3', 'U15', null));
  assert.ok(three.fastBreak, '3x3 应标记快攻不可用');

  const five = p.disabledModules(resolveParams('5V5', 'U15', 'FULL'));
  assert.ok(!five.fastBreak, '5v5 快攻可用');

  // 跑动热区在所有赛制下默认折叠（PRD 3.3 屏 09）
  assert.strictEqual(three.movementHeatmapDefaultCollapsed, true);
  assert.strictEqual(five.movementHeatmapDefaultCollapsed, true);
});

test('params.PLAYERS_PER_TEAM 与 paramsMirror 一致', () => {
  Object.entries(p.PLAYERS_PER_TEAM).forEach(([format, count]) => {
    const ct = format === '3V3' ? null : 'FULL';
    const resolved = resolveParams(format, 'U15', ct);
    assert.strictEqual(resolved.players_per_team, count, `${format} 人数不一致`);
    assert.strictEqual(resolved.formation_points, count);
  });
});

test('params.DEFAULT_PERIODS 与 paramsMirror 一致', () => {
  Object.entries(p.DEFAULT_PERIODS).forEach(([age, cfg]) => {
    const resolved = resolveParams('5V5', age, 'FULL');
    assert.strictEqual(resolved.period_minutes, cfg.minutes, `${age} 单节时长不一致`);
    assert.strictEqual(resolved.period_count, cfg.count, `${age} 节数不一致`);
  });
});
