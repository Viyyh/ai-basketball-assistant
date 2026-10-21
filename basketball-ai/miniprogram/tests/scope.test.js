/**
 * 口径守卫单元测试 —— 服务于 P4-F02 球队比赛数据页
 *
 * 对应 PRD 4.9「聚合无跨赛制」与球队页设计 v0.2 屏 02：
 *   赛制筛选不提供"全部"选项。
 *
 * 前端这份守卫是后端 aggregate_guarded() 的镜像。
 * 两侧判定规则必须一致，否则前端本地小计会绕过后端防线。
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  CrossAgeGroupAggregationError,
  CrossFormatAggregationError,
  aggregate,
  aggregateGuarded,
  availableScopes,
  completenessNote,
  defaultScope,
  groupByScope,
  headToHeadByScope,
} = require('../utils/scope');
const { AGE_GROUP, FORMAT } = require('../utils/params');

// ---------- 夹具：3 场 5v5(U15) + 2 场 3v3(U15) + 1 场 5v5(U12) ----------

const GAMES = [
  { id: 'g1', format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-09-24',
    pointsFor: 78, pointsAgainst: 65, won: true, fgm: 28, fga: 64, arcOutMade: 8, arcOutAtt: 22 },
  { id: 'g2', format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-02',
    pointsFor: 61, pointsAgainst: 70, won: false, fgm: 22, fga: 61, arcOutMade: 5, arcOutAtt: 19 },
  { id: 'g3', format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-09',
    pointsFor: 72, pointsAgainst: 68, won: true, fgm: 26, fga: 60, arcOutMade: 7, arcOutAtt: 20 },
  { id: 'g4', format: FORMAT.THREE_V_THREE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-11',
    pointsFor: 21, pointsAgainst: 18, won: true, fgm: 9, fga: 18, arcOutMade: 4, arcOutAtt: 8 },
  { id: 'g5', format: FORMAT.THREE_V_THREE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-13',
    pointsFor: 17, pointsAgainst: 19, won: false, fgm: 7, fga: 19, arcOutMade: 3, arcOutAtt: 9 },
  { id: 'g6', format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U12, playedAt: '2026-10-14',
    pointsFor: 54, pointsAgainst: 50, won: true, fgm: 20, fga: 50, arcOutMade: 4, arcOutAtt: 12 },
];

// ============================================================
// 口径枚举：永远不含"全部"
// ============================================================

test('availableScopes: 只返回数据里实际出现过的口径', () => {
  const scopes = availableScopes(GAMES);
  assert.strictEqual(scopes.length, 3);

  const keys = scopes.map((s) => `${s.format}|${s.ageGroup}`).sort();
  assert.deepStrictEqual(keys, ['3V3|U15', '5V5|U12', '5V5|U15']);
});

test('availableScopes: 绝不包含"全部赛制"这一项', () => {
  const scopes = availableScopes(GAMES);
  scopes.forEach((s) => {
    assert.ok(s.format, '每个口径必须有明确的 format');
    assert.ok(s.ageGroup, '每个口径必须有明确的 ageGroup');
    assert.ok(!/全部|所有|ALL/i.test(s.label), `口径标签不得含"全部"：${s.label}`);
  });
});

test('availableScopes: 按场次降序，标签含赛制与年龄段', () => {
  const scopes = availableScopes(GAMES);
  assert.strictEqual(scopes[0].format, FORMAT.FIVE_V_FIVE);
  assert.strictEqual(scopes[0].ageGroup, AGE_GROUP.U15);
  assert.strictEqual(scopes[0].count, 3);
  assert.ok(scopes[0].label.includes('5 对 5'));
  assert.ok(scopes[0].label.includes('15岁以下'));
  assert.ok(scopes[0].label.includes('3 场'));
});

test('defaultScope: 取场次最多的口径', () => {
  const d = defaultScope(GAMES);
  assert.strictEqual(d.format, FORMAT.FIVE_V_FIVE);
  assert.strictEqual(d.ageGroup, AGE_GROUP.U15);
});

test('defaultScope: 场次并列时优先 5对5（主流赛制）', () => {
  const tied = [
    { format: FORMAT.THREE_V_THREE, ageGroup: AGE_GROUP.U15 },
    { format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15 },
  ];
  const d = defaultScope(tied);
  assert.strictEqual(d.format, FORMAT.FIVE_V_FIVE);
});

test('defaultScope: 空数据返回 null（页面应走空状态）', () => {
  assert.strictEqual(defaultScope([]), null);
});

// ============================================================
// 聚合守卫
// ============================================================

test('aggregateGuarded: 跨赛制直接抛错', () => {
  assert.throws(() => aggregateGuarded(GAMES), CrossFormatAggregationError);
});

test('aggregateGuarded: 错误信息点明是哪几种赛制，并说明为何不可比', () => {
  try {
    aggregateGuarded(GAMES);
    assert.fail('应当抛错');
  } catch (e) {
    assert.ok(e instanceof CrossFormatAggregationError);
    assert.ok(e.message.includes('5 对 5'), e.message);
    assert.ok(e.message.includes('3 对 3'), e.message);
    assert.ok(e.message.includes('不可比'), e.message);
  }
});

test('aggregateGuarded: 同赛制但跨年龄段也抛错', () => {
  const mixed = GAMES.filter((g) => g.format === FORMAT.FIVE_V_FIVE);
  assert.throws(() => aggregateGuarded(mixed), CrossAgeGroupAggregationError,
    'U15 与 U12 的数据同样不可合并');
});

test('aggregateGuarded: 单一口径正常返回', () => {
  const only5v5u15 = GAMES.filter(
    (g) => g.format === FORMAT.FIVE_V_FIVE && g.ageGroup === AGE_GROUP.U15
  );
  const r = aggregateGuarded(only5v5u15);
  assert.strictEqual(r.games, 3);
  assert.strictEqual(r.wins, 2);
});

test('aggregateGuarded: 空数据抛错而非返回全 0', () => {
  assert.throws(() => aggregateGuarded([]), /没有可聚合的数据/);
});

test('aggregate: 必须显式传口径，不允许省略', () => {
  assert.throws(() => aggregate(GAMES, null, AGE_GROUP.U15), /必须显式指定/);
  assert.throws(() => aggregate(GAMES, FORMAT.FIVE_V_FIVE, null), /必须显式指定/);
});

test('aggregate: 传入口径后内部过滤，混合输入也只得该口径的结果', () => {
  const r = aggregate(GAMES, FORMAT.FIVE_V_FIVE, AGE_GROUP.U15);
  assert.strictEqual(r.games, 3, '即使传入混合数据，也只应统计指定口径的 3 场');
  assert.strictEqual(r.format, FORMAT.FIVE_V_FIVE);
  assert.strictEqual(r.ageGroup, AGE_GROUP.U15);
});

// ============================================================
// 实证：合并统计会得到无意义数字
// ============================================================

test('实证：分开算与合并算的胜率互不相同，合并值在篮球意义上无效', () => {
  const five = aggregate(GAMES, FORMAT.FIVE_V_FIVE, AGE_GROUP.U15);
  const three = aggregate(GAMES, FORMAT.THREE_V_THREE, AGE_GROUP.U15);

  assert.strictEqual(five.games, 3);
  assert.strictEqual(five.wins, 2);
  assert.strictEqual(five.winRate, Number((2 / 3).toFixed(4)));

  assert.strictEqual(three.games, 2);
  assert.strictEqual(three.wins, 1);
  assert.strictEqual(three.winRate, 0.5);

  // 天真合并（这就是 UI 上"全部赛制"会算出来的东西）
  const fiveAndThree = GAMES.filter((g) => g.ageGroup === AGE_GROUP.U15);
  const naiveWins = fiveAndThree.filter((g) => g.won).length;
  const naiveRate = naiveWins / fiveAndThree.length;

  assert.strictEqual(naiveRate, 0.6, '3胜2负 = 60%');
  assert.notStrictEqual(naiveRate, five.winRate, '合并值 ≠ 5v5 口径值');
  assert.notStrictEqual(naiveRate, three.winRate, '合并值 ≠ 3v3 口径值');
});

test('实证：3v3 的 21 分与 5v5 的 78 分平均在一起毫无意义', () => {
  const five = aggregate(GAMES, FORMAT.FIVE_V_FIVE, AGE_GROUP.U15);
  const three = aggregate(GAMES, FORMAT.THREE_V_THREE, AGE_GROUP.U15);

  assert.strictEqual(five.ppg, 70.3);      // (78+61+72)/3
  assert.strictEqual(three.ppg, 19.0);     // (21+17)/2

  const fiveAndThree = GAMES.filter((g) => g.ageGroup === AGE_GROUP.U15);
  const naivePpg = fiveAndThree.reduce((s, g) => s + g.pointsFor, 0) / fiveAndThree.length;
  assert.ok(naivePpg > 40 && naivePpg < 60,
    `合并场均 ${naivePpg} 落在两种赛制之间，既不代表 5v5 也不代表 3v3`);
});

// ============================================================
// 分组
// ============================================================

test('groupByScope: 正确分桶', () => {
  const buckets = groupByScope(GAMES);
  assert.strictEqual(buckets.size, 3);
  assert.strictEqual(buckets.get('5V5|U15').length, 3);
  assert.strictEqual(buckets.get('3V3|U15').length, 2);
  assert.strictEqual(buckets.get('5V5|U12').length, 1);
});

test('groupByScope: 空输入返回空 Map', () => {
  assert.strictEqual(groupByScope([]).size, 0);
});

// ============================================================
// 聚合数值正确性
// ============================================================

test('aggregate: 场均、净胜、命中率计算正确', () => {
  const r = aggregate(GAMES, FORMAT.FIVE_V_FIVE, AGE_GROUP.U15);

  assert.strictEqual(r.ppg, Number(((78 + 61 + 72) / 3).toFixed(1)));
  assert.strictEqual(r.ppgAgainst, Number(((65 + 70 + 68) / 3).toFixed(1)));
  assert.strictEqual(r.netPpg, Number((((78 + 61 + 72) - (65 + 70 + 68)) / 3).toFixed(1)));
  assert.strictEqual(r.fgPct, Number(((28 + 22 + 26) / (64 + 61 + 60)).toFixed(4)));
  assert.strictEqual(r.arcOutPct, Number(((8 + 5 + 7) / (22 + 19 + 20)).toFixed(4)));
});

test('aggregate: 弧外命中率字段名为 arcOutPct 而非 threePct', () => {
  const r = aggregate(GAMES, FORMAT.THREE_V_THREE, AGE_GROUP.U15);
  assert.ok('arcOutPct' in r, '3x3 下弧外只值 2 分，字段不得叫 threePct');
  assert.ok(!('threePct' in r));
  assert.strictEqual(r.arcOutPct, Number((7 / 17).toFixed(4)));
});

test('aggregate: 该口径无数据时返回全零而非 null 崩溃', () => {
  const r = aggregate(GAMES, FORMAT.FOUR_V_FOUR, AGE_GROUP.U15);
  assert.strictEqual(r.games, 0);
  assert.strictEqual(r.wins, 0);
  assert.strictEqual(r.winRate, null);
  assert.strictEqual(r.fgPct, null, '分母为 0 时命中率应为 null，界面显示「—」');
  assert.strictEqual(r.ppg, 0);
});

test('aggregate: 出手数为 0 时命中率不为 NaN', () => {
  const r = aggregate(
    [{ format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, pointsFor: 70, pointsAgainst: 60, won: true }],
    FORMAT.FIVE_V_FIVE, AGE_GROUP.U15
  );
  assert.strictEqual(r.fgPct, null);
  assert.ok(!Number.isNaN(r.fgPct));
});

test('aggregate: label 携带完整口径说明', () => {
  const r = aggregate(GAMES, FORMAT.FIVE_V_FIVE, AGE_GROUP.U15);
  assert.strictEqual(r.label, '5 对 5 · 15岁以下 · 3 场');
});

// ============================================================
// 数据完整度标注（PRD P2-25）
// ============================================================

test('completenessNote: 全部补录完时只显示场次', () => {
  const n = completenessNote(12, 12);
  assert.strictEqual(n.text, '基于 12 场');
  assert.strictEqual(n.incomplete, false);
  assert.strictEqual(n.missing, 0);
});

test('completenessNote: 有未补录时明示分母与缺口', () => {
  const n = completenessNote(10, 12);
  assert.strictEqual(n.text, '基于 10/12 场 · 2 场待补录');
  assert.strictEqual(n.incomplete, true);
  assert.strictEqual(n.missing, 2);
});

test('completenessNote: 完全没补录也不崩溃', () => {
  const n = completenessNote(0, 5);
  assert.strictEqual(n.missing, 5);
  assert.ok(n.text.includes('0/5'));
});

test('completenessNote: 完成数超过总数时不产生负缺口', () => {
  const n = completenessNote(15, 12);
  assert.strictEqual(n.missing, 0);
  assert.strictEqual(n.incomplete, false);
});

// ============================================================
// 对手交手记录按赛制拆开（球队页设计 v0.2 屏 07）
// ============================================================

test('headToHeadByScope: 同一对手的 5v5 与 3v3 交手分开统计', () => {
  const vsOpponent = [
    { format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-09-24', won: true },
    { format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-09', won: false },
    { format: FORMAT.THREE_V_THREE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-11', won: true },
  ];

  const rows = headToHeadByScope(vsOpponent);
  assert.strictEqual(rows.length, 2, '必须拆成两行，不得合并成"交手 3 次"');

  const five = rows.find((r) => r.format === FORMAT.FIVE_V_FIVE);
  const three = rows.find((r) => r.format === FORMAT.THREE_V_THREE);

  assert.strictEqual(five.played, 2);
  assert.strictEqual(five.wins, 1);
  assert.strictEqual(five.losses, 1);
  assert.strictEqual(five.lastPlayedAt, '2026-10-09');

  assert.strictEqual(three.played, 1);
  assert.strictEqual(three.wins, 1);
  assert.strictEqual(three.label, '3 对 3 · 15岁以下');
});

test('headToHeadByScope: 总场次不等于任一口径场次（防止误合并）', () => {
  const vsOpponent = [
    { format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-09-24', won: true },
    { format: FORMAT.FIVE_V_FIVE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-09', won: false },
    { format: FORMAT.THREE_V_THREE, ageGroup: AGE_GROUP.U15, playedAt: '2026-10-11', won: true },
  ];
  const rows = headToHeadByScope(vsOpponent);
  const sumPlayed = rows.reduce((s, r) => s + r.played, 0);
  assert.strictEqual(sumPlayed, 3, '各行相加才等于总交手数');
  rows.forEach((r) => assert.ok(r.played < 3, '任何单行都不应是合并后的总数'));
});

test('headToHeadByScope: 按场次降序，无交手时返回空数组', () => {
  assert.deepStrictEqual(headToHeadByScope([]), []);
});
