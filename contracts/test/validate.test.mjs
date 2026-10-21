import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validate, checkSemantics } from '../validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '..', 'report.schema.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'sample-report.json'), 'utf8'));

/** 深拷贝，避免用例之间互相污染 */
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 在 fixture 上就地改一处再返回副本 */
function mutate(fn) {
  const r = clone(fixture);
  fn(r);
  return r;
}

const rules = (report) => checkSemantics(report).map((i) => i.rule);

// ── 正向：样例报告必须干净通过两道关 ────────────────────────────────
test('样例报告通过 schema 校验', () => {
  assert.deepEqual(validate(schema, fixture), []);
});

test('样例报告通过语义规则', () => {
  assert.deepEqual(checkSemantics(fixture), []);
});

// ── schema 层 ──────────────────────────────────────────────────────
test('缺少必填字段会被指出', () => {
  const r = mutate((x) => delete x.team_stats);
  const issues = validate(schema, r);
  assert.ok(issues.some((i) => i.message.includes('team_stats')), JSON.stringify(issues));
});

test('额外字段会被拒绝（additionalProperties:false）', () => {
  const r = mutate((x) => { x.events[0].备注 = 'ai 随手加的'; });
  const issues = validate(schema, r);
  assert.ok(issues.some((i) => i.path.includes('备注')), JSON.stringify(issues));
});

test('schema_version 必须是 1.1（防止 pipeline 仍产出 1.0）', () => {
  const r = mutate((x) => { x.schema_version = '1.0'; });
  const issues = validate(schema, r);
  assert.ok(issues.some((i) => i.path === '$.schema_version'), JSON.stringify(issues));
});

test('team_side 取值受枚举约束', () => {
  const r = mutate((x) => { x.events[0].team_side = 'WE'; });
  const issues = validate(schema, r);
  assert.ok(issues.some((i) => i.path.endsWith('.team_side')), JSON.stringify(issues));
});

test('坐标类型错误会被抓出（字符串混进数字）', () => {
  const r = mutate((x) => { x.events[0].x_m = '6.2'; });
  const issues = validate(schema, r);
  assert.ok(issues.some((i) => i.path.endsWith('.x_m')), JSON.stringify(issues));
});

// ── 语义层：3x3 规则集 ────────────────────────────────────────────
test('R1 · 3x3 不允许出现快攻', () => {
  const r = mutate((x) => {
    x.params.format = '3V3';
    x.params.court_type = 'HALF';
    x.params.fast_break_enabled = true;
    x.params.three_point_radius_m = 6.75;
    x.events[9].kind = 'FAST_BREAK';
  });
  const found = rules(r);
  assert.ok(found.includes('R1'));
});

test('R1 · 3x3 不允许出现「三分」字样（应为远投 2 分）', () => {
  const r = mutate((x) => {
    x.params.format = '3V3';
    x.params.court_type = 'HALF';
    x.params.fast_break_enabled = false;
    x.params.inside_arc_points = 1;
    x.params.outside_arc_points = 2;
    x.events[0].label_zh = '三分·命中';
    x.events[0].shot_value = 2;
  });
  const found = rules(r);
  assert.ok(found.includes('R1'));
});

// ── 语义层：阵营收口 ──────────────────────────────────────────────
test('R2 · 越界坐标必须在 warnings 里留痕', () => {
  const r = mutate((x) => {
    x.events[0].in_bounds = false;
    x.events[0].x_m = 31.2;
  });
  const found = rules(r);
  assert.ok(found.includes('R2'));
});

test('R3 · 对方球员不得出现在我方名单', () => {
  const r = mutate((x) => { x.events[4].player_id = 'p01'; });
  const found = rules(r);
  assert.ok(found.includes('R3'));
});

test('R4 · 「不是我方」必须落到 OPPONENT', () => {
  const r = mutate((x) => { x.events[4].team_side = 'OURS'; });
  const found = rules(r);
  assert.ok(found.includes('R4'));
});

test('R4 · 「看不清」必须落到 UNKNOWN', () => {
  const r = mutate((x) => { x.events[10].team_side = 'OURS'; });
  const found = rules(r);
  assert.ok(found.includes('R4'));
});

test('R4 · 教练已归属却仍是 UNKNOWN 会被抓出', () => {
  const r = mutate((x) => { x.events[0].team_side = 'UNKNOWN'; });
  const found = rules(r);
  assert.ok(found.includes('R4'));
});

// ── 语义层：结构完整性 ────────────────────────────────────────────
test('R5 · 事件引用了不存在的节次', () => {
  const r = mutate((x) => { x.events[0].period = 7; });
  const found = rules(r);
  assert.ok(found.includes('R5'));
});

test('R6 · 非出手事件不得带出手字段', () => {
  const r = mutate((x) => { x.events[6].shot_value = 2; });
  const found = rules(r);
  assert.ok(found.includes('R6'));
});

test('R9 · 全场比赛每节都要有进攻方向', () => {
  const r = mutate((x) => { delete x.periods[2].attacking_basket; });
  const found = rules(r);
  assert.ok(found.includes('R9'));
});

test('R10 · 我方出手必须有坐标', () => {
  const r = mutate((x) => { delete x.events[0].x_m; delete x.events[0].y_m; });
  const found = rules(r);
  assert.ok(found.includes('R10'));
});

// ── 语义层：数字必须能重算（这是"静默错误"的唯一防线）─────────────
test('R7 · 统计数字与事件对不上会被抓出', () => {
  const r = mutate((x) => { x.team_stats.shots_made = 4; });
  const issues = checkSemantics(r);
  const hit = issues.find((i) => i.rule === 'R7');
  assert.ok(hit, JSON.stringify(issues));
  assert.match(hit.message, /我方命中数/);
});

test('R7 · 得分不能手填（必须由 shot_value × made 累加）', () => {
  const r = mutate((x) => { x.team_stats.points = 9; });
  const found = rules(r);
  assert.ok(found.includes('R7'));
});

test('R8 · coverage 与事件数量对不上会被抓出', () => {
  const r = mutate((x) => { x.coverage.events_attributed = 99; });
  const found = rules(r);
  assert.ok(found.includes('R8'));
});

// ── 排除机制 ──────────────────────────────────────────────────────
test('被排除的事件不计入统计，但仍在 events_total 里', () => {
  const r = mutate((x) => {
    x.events[8].status = 'EXCLUDED';
    x.events[8].exclude_reason = '误检';
  });
  // 原本 e09 就是 EXCLUDED，这里再排除一次不改数字；验证扣除后仍然自洽
  assert.deepEqual(checkSemantics(r), []);
});

test('把已排除事件改回 ACTIVE 却不改统计 → 必须报错', () => {
  const r = mutate((x) => {
    x.events[8].status = 'ACTIVE';
    x.events[8].exclude_reason = null;
  });
  const found = rules(r);
  assert.ok(found.includes('R7'), '恢复事件后统计应随之变化，否则就是静默错误');
  assert.ok(found.includes('R8'));
});

// ── 校验器自身 ────────────────────────────────────────────────────
test('校验不会修改输入对象', () => {
  const before = JSON.stringify(fixture);
  validate(schema, fixture);
  checkSemantics(fixture);
  assert.equal(JSON.stringify(fixture), before);
});
