/**
 * 跨语言一致性测试 —— Python 参数层 vs JS 球场几何
 *
 * 为什么这个测试最重要：
 *
 *   后端用 Python 的 CourtGeometry.judge() 判定分值并写进报告的
 *   shot_value / label_zh（契约硬规则 #2）；前端用 JS 的
 *   courtGeometry.js 画三分线。如果两者的几何理解不一致，
 *   教练会看到「球明明画在弧线内，却标成三分」。
 *
 *   这是 PRD 风险 7.4 的界面版：报告看起来完全正常，数字和图却对不上，
 *   而且没人会怀疑是前后端几何实现有分歧。
 *
 * 基准数据来源：
 *   scripts/gen_conformance_fixture.py 调用 Python 参数层生成
 *   tests/fixtures/params-conformance.json（8 组合 × 25 探测点）
 *
 * ⚠️ 修改 packages/params 后必须重跑生成脚本，否则本测试失去意义。
 *    scripts/verify-params.sh 会把两步串起来。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { createCourt } = require('../utils/courtGeometry');
const { FORMAT, AGE_GROUP, TP_GEOMETRY, FORMAT_LABEL, AGE_GROUP_LABEL } = require('../utils/params');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'params-conformance.json');

assert.ok(fs.existsSync(FIXTURE_PATH),
  `找不到基准数据 ${FIXTURE_PATH}。请先运行：py scripts/gen_conformance_fixture.py`);

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

test('基准数据自描述', () => {
  assert.strictEqual(fixture.schema_version, '1.0');
  assert.strictEqual(fixture._generated_by, 'scripts/gen_conformance_fixture.py');
  assert.ok(Array.isArray(fixture.combos) && fixture.combos.length >= 6,
    '基准数据应至少覆盖 6 种参数组合');
});

test('所有组合的 Python 侧参数自检均无问题', () => {
  fixture.combos.forEach((combo) => {
    assert.deepStrictEqual(
      combo.validation_problems, [],
      `${combo.key}: Python 侧 validate_params_for_pipeline 报告了问题`
    );
  });
});

// ============================================================
// 逐组合、逐探测点断言
// ============================================================

fixture.combos.forEach((combo) => {
  const court = createCourt(combo.params);

  test(`[${combo.key}] 坐标范围与 Python 一致`, () => {
    const [xMin, xMax] = combo.params.x_range_m;
    assert.ok(Math.abs(court.xMin - xMin) < 1e-6,
      `xMin: JS ${court.xMin} vs Python ${xMin}`);
    assert.ok(Math.abs(court.xMax - xMax) < 1e-6,
      `xMax: JS ${court.xMax} vs Python ${xMax}`);
    assert.ok(Math.abs(court.yHalf - combo.params.y_half_m) < 1e-6,
      `yHalf: JS ${court.yHalf} vs Python ${combo.params.y_half_m}`);
  });

  test(`[${combo.key}] 底角交接点与 Python 一致`, () => {
    const expected = combo.params.corner_junction_x_m;
    if (expected === null || expected === undefined) {
      assert.strictEqual(court.cornerJunctionX, null,
        '纯弧线几何不应有底角交接点');
    } else {
      assert.ok(court.cornerJunctionX !== null, '应有底角交接点');
      assert.ok(Math.abs(court.cornerJunctionX - expected) < 1e-6,
        `cornerJunctionX: JS ${court.cornerJunctionX} vs Python ${expected}`);
    }
  });

  combo.probes.forEach((probe) => {
    const where = `[${combo.key}] ${probe.label} (${probe.x_m}, ${probe.y_m})`;

    test(`${where} 三分线内外判定一致`, () => {
      assert.strictEqual(
        court.behindThreePointLine(probe.x_m, probe.y_m),
        probe.behind,
        `Python 判 behind=${probe.behind}，JS 判 ${court.behindThreePointLine(probe.x_m, probe.y_m)}`
      );
    });

    test(`${where} 距离计算一致`, () => {
      const d = Math.hypot(probe.x_m, probe.y_m);
      assert.ok(Math.abs(d - probe.distance_m) < 5e-3,
        `distance: JS ${d} vs Python ${probe.distance_m}`);
    });

    test(`${where} 场地边界判定一致`, () => {
      assert.strictEqual(court.inBounds(probe.x_m, probe.y_m), probe.in_bounds);
    });

    test(`${where} 计分口径与赛制一致`, () => {
      // 前端不做分值判定（硬规则 #2），但要验证"如果按 params 推导，
      // 结果与 Python 一致" —— 这保证前端画的线和后端判的分同源。
      const expectedPoints = probe.behind
        ? combo.params.outside_arc_points
        : combo.params.inside_arc_points;
      assert.strictEqual(probe.points, expectedPoints,
        `${combo.key} 下 behind=${probe.behind} 应得 ${expectedPoints} 分，Python 给了 ${probe.points}`);
    });
  });
});

// ============================================================
// 3x3 的口径特例（契约 x-frontend-consumption-notes）
// ============================================================

test('3x3 组合的界面文案不含「三分」', () => {
  const threeV3 = fixture.combos.filter((c) => c.params.format === FORMAT.THREE_V_THREE);
  assert.ok(threeV3.length >= 1, '基准数据应包含 3x3 组合');

  threeV3.forEach((combo) => {
    combo.probes.forEach((probe) => {
      assert.ok(!probe.label_zh.includes('三分'),
        `${combo.key} ${probe.label}: label_zh="${probe.label_zh}" 含「三分」，3x3 下必须用「远投/近投」`);
      const allowed = ['远投(2分)', '近投(1分)'];
      assert.ok(allowed.includes(probe.label_zh),
        `${combo.key} ${probe.label}: label_zh="${probe.label_zh}" 不在允许集合内`);
    });
    assert.strictEqual(combo.params.inside_arc_points, 1);
    assert.strictEqual(combo.params.outside_arc_points, 2);
    assert.strictEqual(combo.params.fast_break_enabled, false,
      '3x3 第一版必须关闭快攻识别');
  });
});

test('5v5 组合的计分口径为 2/3', () => {
  fixture.combos
    .filter((c) => c.params.format === FORMAT.FIVE_V_FIVE)
    .forEach((combo) => {
      assert.strictEqual(combo.params.inside_arc_points, 2);
      assert.strictEqual(combo.params.outside_arc_points, 3);
      assert.strictEqual(combo.params.shot_clock_s, 24);
    });
});

// ============================================================
// 两种三分线几何的分野
// ============================================================

test('FIBA 2.5.4：所有赛制统一「弧线 + 底角」（6.75 m + 6.60 m）', () => {
  ['5V5_SENIOR', '5V5_U12', '5V5_U15', '3V3_U15'].forEach((key) => {
    const c = fixture.combos.find((x) => x.key === key);
    assert.strictEqual(c.params.three_point_radius_m, 6.75, `${key}: 半径应为 6.75 m`);
    assert.strictEqual(c.params.three_point_geometry, TP_GEOMETRY.ARC_AND_CORNERS,
      `${key}: 半径 6.75 > 底角横向 6.60，应为「弧线 + 底角直线」`);
    assert.strictEqual(c.params.corner_lateral_m, 6.60);
    assert.ok(c.params.corner_junction_x_m > 0);
  });
});

test('同一物理出手点在任何年龄段判定一致（口径统一）', () => {
  const u12 = fixture.combos.find((c) => c.key === '5V5_U12');
  const senior = fixture.combos.find((c) => c.key === '5V5_SENIOR');

  const probeAt = (combo, x, y) => combo.probes.find(
    (p) => Math.abs(p.x_m - x) < 1e-9 && Math.abs(p.y_m - y) < 1e-9
  );

  const p62u = probeAt(u12, 6.2, 0.0);
  const p62s = probeAt(senior, 6.2, 0.0);
  assert.ok(p62u && p62s, '基准数据应包含弧顶 6.2m 探测点');

  // 6.75 m 弧下 6.2 m 是两分，与年龄段无关
  assert.strictEqual(p62u.behind, false, 'U12（弧 6.75m）下 6.2m 应在弧内');
  assert.strictEqual(p62u.points, 2);
  assert.strictEqual(p62s.behind, false, '一线（弧 6.75m）下 6.2m 应在弧内');
  assert.strictEqual(p62s.points, 2);

  const p69u = probeAt(u12, 6.8, 0.0);
  const p69s = probeAt(senior, 6.8, 0.0);
  if (p69u && p69s) {
    assert.strictEqual(p69u.behind, true, '6.8m 应在弧外');
    assert.strictEqual(p69u.points, 3);
    assert.strictEqual(p69s.points, 3);
  }

  // 前端两侧都必须画对线，否则图与分不符
  const cU12 = createCourt(u12.params);
  const cSenior = createCourt(senior.params);
  assert.strictEqual(cU12.behindThreePointLine(6.2, 0.0), false);
  assert.strictEqual(cSenior.behindThreePointLine(6.2, 0.0), false);
});

test('3x3 场地更短：越界点被检出', () => {
  const full = fixture.combos.find((c) => c.key === '5V5_SENIOR');
  const half = fixture.combos.find((c) => c.key === '3V3_U15');

  assert.strictEqual(full.params.court_type, 'FULL');
  assert.strictEqual(half.params.court_type, 'HALF');
  // FIBA 3x3：15 m 宽（与 5v5 同宽）× 11 m 长
  assert.strictEqual(half.params.court_width_m, 15);
  assert.strictEqual(half.params.y_half_m, 7.5);
  assert.strictEqual(full.params.y_half_m, 7.5);

  const cHalf = createCourt(half.params);
  // x=10.0 在全场合法，在 3x3 半场（长 11 m，x_max 9.425）越界
  assert.strictEqual(cHalf.inBounds(10.0, 3.0), false);
  assert.strictEqual(createCourt(full.params).inBounds(10.0, 3.0), true);
  // y=8.0 两种场地都越界（半宽 7.5）
  assert.strictEqual(cHalf.inBounds(3.0, 8.0), false);
});

// ============================================================
// 前端参数镜像与后端枚举一致
// ============================================================

test('前端枚举与契约一致', () => {
  assert.deepStrictEqual(
    Object.values(FORMAT).sort(),
    ['3V3', '4V4', '5V5', 'CUSTOM'].sort()
  );
  assert.deepStrictEqual(
    Object.values(AGE_GROUP).sort(),
    ['SENIOR', 'U12', 'U15', 'U18', 'U8'].sort()
  );
  assert.deepStrictEqual(Object.values(TP_GEOMETRY).sort(),
    ['ARC_AND_CORNERS', 'PURE_ARC'].sort());

  // 基准数据里出现的每个枚举值，前端都必须有对应中文标签
  fixture.combos.forEach((combo) => {
    assert.ok(FORMAT_LABEL[combo.params.format],
      `前端缺少 format=${combo.params.format} 的中文标签`);
    assert.ok(AGE_GROUP_LABEL[combo.params.age_group],
      `前端缺少 age_group=${combo.params.age_group} 的中文标签`);
  });
});
