/**
 * Mock 忠实度测试
 *
 * 验证两件事：
 *   1. mock/paramsMirror.js 解析出的 params 与 Python 真源逐字段一致
 *      —— 否则 Mock 会产出与生产环境语义不同的参数，F 轨测到的降级路径是假的
 *   2. generateMockReport() 产出符合契约、且真实响应 params 的报告
 *      —— 开发计划第十三节的核心要求
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveParams } = require('../mock/paramsMirror');
const { generateMockReport } = require('../mock/report');
const { FORMAT } = require('../utils/params');

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'params-conformance.json'), 'utf8'
));

// fixture 的 key → (format, ageGroup, courtType)
const KEY_MAP = {
  '5V5_U12': ['5V5', 'U12', null],
  '5V5_U15': ['5V5', 'U15', null],
  '5V5_U18': ['5V5', 'U18', null],
  '5V5_SENIOR': ['5V5', 'SENIOR', null],
  '3V3_U15': ['3V3', 'U15', null],
  '3V3_SENIOR': ['3V3', 'SENIOR', null],
  '4V4_U15_FULL': ['4V4', 'U15', 'FULL'],
  '4V4_U15_HALF': ['4V4', 'U15', 'HALF'],
};

// ============================================================
// 1. paramsMirror 与 Python 真源逐字段一致
// ============================================================

/** 需要逐字段比对的契约字段 */
const COMPARE_FIELDS = [
  'format', 'age_group', 'court_type',
  'court_length_m', 'court_width_m', 'baseline_to_hoop_m',
  'three_point_radius_m', 'three_point_geometry',
  'corner_lateral_m', 'corner_junction_x_m',
  'y_half_m', 'hoop_count',
  'period_count', 'period_minutes', 'shot_clock_s',
  'inside_arc_points', 'outside_arc_points',
  'fast_break_enabled', 'fast_break_max_possession_s', 'win_score',
  'players_per_team', 'formation_points', 'max_tracked_targets',
  'formation_sample_interval_s',
];

FIXTURE.combos.forEach((combo) => {
  const spec = KEY_MAP[combo.key];

  test(`paramsMirror [${combo.key}] 与 Python 真源逐字段一致`, () => {
    assert.ok(spec, `fixture 里的 ${combo.key} 在 KEY_MAP 中没有对应解析入参`);

    const js = resolveParams(spec[0], spec[1], spec[2]);
    const py = combo.params;

    COMPARE_FIELDS.forEach((field) => {
      const jv = js[field];
      const pv = py[field];

      if (typeof pv === 'number' && typeof jv === 'number') {
        assert.ok(Math.abs(jv - pv) < 1e-6,
          `${combo.key}.${field}: JS ${jv} vs Python ${pv}`);
      } else {
        assert.deepStrictEqual(jv, pv, `${combo.key}.${field} 不一致`);
      }
    });

    // x_range_m 是数组，单独比
    assert.strictEqual(js.x_range_m.length, 2);
    assert.ok(Math.abs(js.x_range_m[0] - py.x_range_m[0]) < 1e-6,
      `${combo.key}.x_range_m[0] 不一致`);
    assert.ok(Math.abs(js.x_range_m[1] - py.x_range_m[1]) < 1e-6,
      `${combo.key}.x_range_m[1] 不一致`);
  });
});

test('paramsMirror: 覆盖了 fixture 的全部组合', () => {
  const fixtureKeys = FIXTURE.combos.map((c) => c.key).sort();
  const mappedKeys = Object.keys(KEY_MAP).sort();
  assert.deepStrictEqual(mappedKeys, fixtureKeys,
    'KEY_MAP 必须与 fixture 组合一一对应，否则有组合未被验证');
});

test('paramsMirror: 4V4/CUSTOM 不传 courtType 必须抛错', () => {
  assert.throws(() => resolveParams('4V4', 'U15', null), /必须显式指定 courtType/);
  assert.throws(() => resolveParams('CUSTOM', 'U15', null), /必须显式指定 courtType/);
});

test('paramsMirror: 未知枚举抛错', () => {
  assert.throws(() => resolveParams('5V5', 'U99'), /未知年龄段/);
  assert.throws(() => resolveParams('7V7', 'U15'), /未知赛制/);
});

// ============================================================
// 2. Mock 报告符合契约且真实响应 params
// ============================================================

test('Mock: 产出 schema_version 1.0 且必填字段齐全', () => {
  const { ok, report } = generateMockReport({ format: '5V5', ageGroup: 'U15' });
  assert.strictEqual(ok, true);

  const required = ['schema_version', 'activity_id', 'params', 'video', 'calibration',
    'events', 'formations', 'periods', 'team_stats', 'warnings', 'pipeline_version'];
  required.forEach((k) => assert.ok(k in report, `报告缺少契约必填字段 ${k}`));
  assert.strictEqual(report.schema_version, '1.0');
});

test('Mock: 事件数 ≥30，弧外出手占比 ≥40%（开发计划第十三节）', () => {
  const { report, _mock } = generateMockReport({ format: '5V5', ageGroup: 'U15', eventCount: 40 });
  assert.ok(report.events.length >= 30, `事件数 ${report.events.length} 应 ≥30`);
  assert.ok(_mock.arcOutRatio >= 0.30,
    `弧外出手占比 ${(_mock.arcOutRatio * 100).toFixed(1)}% 偏低，测不到三分判定路径`);
});

test('Mock: player_id 全部为 null（契约硬规则 #3）', () => {
  ['5V5', '3V3'].forEach((format) => {
    const { _mock } = generateMockReport({ format, ageGroup: 'U15' });
    assert.strictEqual(_mock.allPlayerIdsNull, true,
      `${format}: AI 不得猜测球员归属`);
  });
});

test('Mock: 切片时长全部落在契约要求的 8-15 秒', () => {
  const { _mock } = generateMockReport({ format: '5V5', ageGroup: 'U15' });
  assert.ok(_mock.clipDurations.length > 0);
  _mock.clipDurations.forEach((d) => {
    assert.ok(d >= 8 && d <= 15, `切片时长 ${d}s 超出契约 8-15s 范围（PRD 9.3 #3.7）`);
  });
});

test('Mock: 阵型点数等于赛制人数，且 ≥30% 的 label 为 null', () => {
  const cases = [
    { format: '5V5', expected: 5 },
    { format: '3V3', expected: 3 },
    { format: '4V4', courtType: 'FULL', expected: 4 },
  ];

  cases.forEach(({ format, courtType, expected }) => {
    const { report, _mock } = generateMockReport({ format, ageGroup: 'U15', courtType });

    report.formations.forEach((f) => {
      assert.strictEqual(f.positions_m.length, expected,
        `${format}: 阵型点数应为 ${expected}，实际 ${f.positions_m.length}`);
      f.positions_m.forEach((p) => {
        assert.strictEqual(p.length, 2);
        assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
      });
    });

    assert.ok(_mock.nullLabelRatio >= 0.25,
      `${format}: label 为 null 的比例 ${(_mock.nullLabelRatio * 100).toFixed(0)}% 应 ≥25%，`
      + '否则测不到"置信度不足不显示阵型名"的降级路径（PRD 9.2 #2.14）');
    assert.ok(report.formations.length > 10, '阵型快照应足够多以测试时间轴拖动');
  });
});

// ---------- Mock 必须真实响应 params ----------

test('Mock 响应参数: 3V3 的分值是 1/2，label 不含「三分」', () => {
  const { report, _mock } = generateMockReport({ format: '3V3', ageGroup: 'U15' });

  assert.deepStrictEqual(_mock.shotValueSet, [1, 2],
    `3x3 的分值集合应为 [1,2]，实际 ${JSON.stringify(_mock.shotValueSet)}`);

  _mock.labelSet.forEach((label) => {
    assert.ok(!label.includes('三分'),
      `3x3 报告的 label_zh 不得含「三分」，实际出现 "${label}"`);
    assert.ok(['远投(2分)', '近投(1分)'].includes(label),
      `3x3 的 label_zh 只能是「远投(2分)」或「近投(1分)」，实际 "${label}"`);
  });

  assert.strictEqual(report.params.inside_arc_points, 1);
  assert.strictEqual(report.params.outside_arc_points, 2);
});

test('Mock 响应参数: 5V5 的分值是 2/3，label 为「三分」「二分」', () => {
  const { report, _mock } = generateMockReport({ format: '5V5', ageGroup: 'SENIOR' });

  assert.deepStrictEqual(_mock.shotValueSet, [2, 3]);
  assert.deepStrictEqual(_mock.labelSet, ['三分', '二分']);
  assert.strictEqual(report.params.inside_arc_points, 2);
  assert.strictEqual(report.params.outside_arc_points, 3);
});

test('Mock 响应参数: 3V3 无节次、无快攻事件、单节 21 分制', () => {
  const { report } = generateMockReport({ format: '3V3', ageGroup: 'U15' });

  assert.strictEqual(report.periods.length, 1, '3x3 应为单节');
  assert.strictEqual(report.params.period_count, 1);
  assert.strictEqual(report.params.win_score, 21);
  assert.strictEqual(report.params.shot_clock_s, 12);

  const fastBreaks = report.events.filter((e) => e.kind === 'FAST_BREAK');
  assert.strictEqual(fastBreaks.length, 0,
    '3x3 第一版关闭快攻识别，报告中不得出现任何快攻事件（PRD 9.2 #2.12）');
  assert.strictEqual(report.team_stats.fast_breaks, 0);
  assert.strictEqual(report.params.fast_break_enabled, false);
});

test('Mock 响应参数: 5V5 有节次且快攻开启', () => {
  const { report } = generateMockReport({ format: '5V5', ageGroup: 'U15' });
  assert.strictEqual(report.periods.length, 4);
  assert.strictEqual(report.params.shot_clock_s, 24);
  assert.strictEqual(report.params.fast_break_enabled, true);
});

test('Mock 响应参数: U12 与 SENIOR 在同样出手点下判定一致（FIBA 统一 6.75 m）', () => {
  // 弧顶 6.2m 附近必有出手点（shotSpots 里有 6.2）
  const u12 = generateMockReport({ format: '5V5', ageGroup: 'U12', seed: 7 });
  const senior = generateMockReport({ format: '5V5', ageGroup: 'SENIOR', seed: 7 });

  const near62 = (res) => res.report.events.filter(
    (e) => e.kind === 'SHOT' && e.x_m > 5.9 && e.x_m < 6.5 && Math.abs(e.y_m) < 1.0
  );

  const u12Shots = near62(u12);
  const seniorShots = near62(senior);
  assert.ok(u12Shots.length > 0 && seniorShots.length > 0, '该区间应有出手样本');

  // 同一三分线半径 → 同一种子下判定必须完全一致
  const u12ArcOut = u12Shots.filter((e) => e.behind_three_point_line).length;
  const seniorArcOut = seniorShots.filter((e) => e.behind_three_point_line).length;

  assert.strictEqual(u12ArcOut, seniorArcOut,
    `FIBA 统一 6.75 m 后，U12 与 SENIOR 判定应一致，实际 U12=${u12ArcOut} SENIOR=${seniorArcOut}`);

  // 6.75 m 弧下 5.9~6.5 m 一律是两分
  [...u12Shots, ...seniorShots].forEach((e) => {
    assert.strictEqual(e.behind_three_point_line, false,
      `5.9~6.5 m 的出手不应被判成三分（${e.x_m}, ${e.y_m}）`);
    assert.strictEqual(e.shot_value, 2);
    assert.strictEqual(e.label_zh, '二分');
  });
});

test('Mock 响应参数: 3V3 用半场坐标，所有事件都在半场范围内', () => {
  const { report } = generateMockReport({ format: '3V3', ageGroup: 'U15' });
  assert.strictEqual(report.params.court_type, 'HALF');
  // FIBA 3x3：15 m 宽 × 11 m 长
  assert.strictEqual(report.params.court_width_m, 15);

  report.events.forEach((e) => {
    if (e.x_m == null) return;
    assert.ok(Math.abs(e.y_m) <= 7.5 + 1e-6,
      `3x3 事件 y=${e.y_m} 超出半场 ±7.5 范围`);
    assert.ok(e.x_m <= 9.425 + 1e-6,
      `3x3 事件 x=${e.x_m} 超出半场范围`);
  });
});

test('Mock 响应参数: 4V4 全场与半场产出不同 params', () => {
  const full = generateMockReport({ format: '4V4', ageGroup: 'U15', courtType: 'FULL' });
  const half = generateMockReport({ format: '4V4', ageGroup: 'U15', courtType: 'HALF' });

  assert.strictEqual(full.report.params.court_type, 'FULL');
  assert.strictEqual(half.report.params.court_type, 'HALF');
  assert.strictEqual(full.report.params.formation_points, 4);
  assert.strictEqual(full.report.params.court_length_m, 28);
  assert.strictEqual(half.report.params.court_length_m, 14);
});

// ---------- 失败模拟与告警 ----------

test('Mock: simulateFail 返回失败态而非残缺报告', () => {
  const res = generateMockReport({ simulateFail: true });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'failed');
  assert.strictEqual(res.report, undefined,
    '失败时不得返回 report，否则前端可能渲染出半成品');
  assert.ok(res.error.length > 0);
});

test('Mock: 标定质量差时 ok=false 且写入 warnings', () => {
  const { report } = generateMockReport({ simulateBadCalibration: true });
  assert.strictEqual(report.calibration.ok, false);
  assert.ok(report.calibration.reproj_error_px > 5);
  assert.ok(report.warnings.some((w) => w.includes('标定')),
    '标定不合格必须在 warnings 里说明');
});

test('Mock: 正常情况下 warnings 至少提示一项（验证前端告警条）', () => {
  const { report } = generateMockReport({ format: '5V5', ageGroup: 'U15' });
  assert.ok(Array.isArray(report.warnings));
  // 3x3 必然有一条"快攻已关闭"的提示
  const three = generateMockReport({ format: '3V3', ageGroup: 'U15' });
  assert.ok(three.report.warnings.length >= 1);
  assert.ok(three.report.warnings.some((w) => w.includes('快攻')));
});

// ---------- 确定性 ----------

test('Mock: 同种子产出完全一致的报告（便于快照测试）', () => {
  const a = generateMockReport({ format: '5V5', ageGroup: 'U15', seed: 42 });
  const b = generateMockReport({ format: '5V5', ageGroup: 'U15', seed: 42 });

  assert.strictEqual(a.report.events.length, b.report.events.length);
  a.report.events.forEach((e, i) => {
    assert.strictEqual(e.id, b.report.events[i].id);
    assert.strictEqual(e.x_m, b.report.events[i].x_m);
    assert.strictEqual(e.shot_value, b.report.events[i].shot_value);
    assert.strictEqual(e.label_zh, b.report.events[i].label_zh);
  });
});

test('Mock: 不同种子产出不同报告', () => {
  const a = generateMockReport({ seed: 1 });
  const b = generateMockReport({ seed: 2 });
  const ax = a.report.events.map((e) => e.x_m).join(',');
  const bx = b.report.events.map((e) => e.x_m).join(',');
  assert.notStrictEqual(ax, bx);
});

// ---------- team_stats 口径 ----------

test('Mock: team_stats 只含 AI 可自动算出的字段，不含篮板助攻', () => {
  const { report } = generateMockReport({ format: '5V5', ageGroup: 'U15' });
  const keys = Object.keys(report.team_stats);

  ['shots_made', 'shots_attempted', 'arc_out_made', 'arc_out_attempted',
    'fast_breaks', 'possessions', 'turnovers'].forEach((k) => {
    assert.ok(keys.includes(k), `team_stats 应含 ${k}`);
  });

  // 篮板/助攻/抢断 AI 采不到，第一版明确不做假的估测（PRD 6.3）
  ['rebounds', 'assists', 'steals', 'blocks'].forEach((k) => {
    assert.ok(!keys.includes(k),
      `team_stats 不应含 ${k}——AI 采不到，PRD 6.3 要求标注"未采集"而非估测`);
  });
});

test('Mock: 弧外字段名为 arc_out_* 而非 threes_*（3x3 语义正确性）', () => {
  const { report } = generateMockReport({ format: '3V3', ageGroup: 'U15' });
  assert.ok('arc_out_made' in report.team_stats);
  assert.ok(!('threes_made' in report.team_stats),
    '3x3 下弧外只值 2 分，字段不得叫 threes_made');
});

test('Mock: 内部统计与事件列表自洽', () => {
  const { report } = generateMockReport({ format: '5V5', ageGroup: 'U15', seed: 99 });

  const shots = report.events.filter((e) => e.kind === 'SHOT');
  assert.strictEqual(report.team_stats.shots_attempted, shots.length);
  assert.strictEqual(report.team_stats.shots_made, shots.filter((s) => s.made).length);

  const arcOut = shots.filter((s) => s.behind_three_point_line);
  assert.strictEqual(report.team_stats.arc_out_attempted, arcOut.length);
  assert.strictEqual(report.team_stats.arc_out_made, arcOut.filter((s) => s.made).length);

  assert.strictEqual(
    report.team_stats.turnovers,
    report.events.filter((e) => e.kind === 'TURNOVER').length
  );
});

test('Mock: 事件按时间升序且 period 与 periods 区间一致', () => {
  const { report } = generateMockReport({ format: '5V5', ageGroup: 'U15' });

  for (let i = 1; i < report.events.length; i += 1) {
    assert.ok(report.events[i].timestamp_s >= report.events[i - 1].timestamp_s,
      '事件必须按时间升序');
  }

  report.events.forEach((e) => {
    const p = report.periods.find((x) => x.index === e.period);
    assert.ok(p, `事件 ${e.id} 的 period=${e.period} 在 periods 里不存在`);
    assert.ok(e.timestamp_s >= p.start_s && e.timestamp_s < p.end_s + 1,
      `事件 ${e.id} 时间戳 ${e.timestamp_s} 不在第 ${e.period} 节区间内`);
  });
});
