/**
 * 报告契约校验器 —— 零依赖。
 *
 * 两个层次：
 *   1. validate(schema, data)  —— JSON Schema 子集校验（足够覆盖 report.schema.json 用到的关键字）
 *   2. checkSemantics(report)  —— 无法用 JSON Schema 表达的跨字段规则（硬规则 #1~#5）
 *
 * 为什么自己写而不用 ajv：契约是三方（AI / 后端 / 前端）共同依赖的东西，
 * 它必须在"新克隆的仓库、只装了 node"的环境里能跑，不希望引入运行期依赖。
 */

const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const check = TYPE_CHECKS[expected];
  if (!check) return true;
  // integer 也满足 number
  if (expected === 'number' && Number.isInteger(value)) return true;
  return check(value);
}

function walk(schema, data, path, issues) {
  if (schema === true || schema === undefined) return;

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    if (data !== schema.const) {
      issues.push({ path, message: `应为常量 ${JSON.stringify(schema.const)}，实际 ${JSON.stringify(data)}` });
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    issues.push({ path, message: `不在允许取值 [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}] 内，实际 ${JSON.stringify(data)}` });
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => matchesType(data, t))) {
      issues.push({ path, message: `类型应为 ${expected.join(' | ')}，实际 ${typeOf(data)}` });
      return; // 类型都不对，继续往下查没有意义
    }
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      issues.push({ path, message: `应 ≥ ${schema.minimum}，实际 ${data}` });
    }
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      issues.push({ path, message: `应 > ${schema.exclusiveMinimum}，实际 ${data}` });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      issues.push({ path, message: `应 ≤ ${schema.maximum}，实际 ${data}` });
    }
  }

  if (typeof data === 'string' && schema.minLength !== undefined && data.length < schema.minLength) {
    issues.push({ path, message: `长度应 ≥ ${schema.minLength}，实际 ${data.length}` });
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      issues.push({ path, message: `元素数应 ≥ ${schema.minItems}，实际 ${data.length}` });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      issues.push({ path, message: `元素数应 ≤ ${schema.maxItems}，实际 ${data.length}` });
    }
    if (schema.items) {
      data.forEach((item, i) => walk(schema.items, item, `${path}[${i}]`, issues));
    }
    return;
  }

  if (TYPE_CHECKS.object(data)) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        issues.push({ path, message: `缺少必填字段 ${key}` });
      }
    }
    const props = schema.properties ?? {};
    for (const [key, value] of Object.entries(data)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        walk(props[key], value, `${path}.${key}`, issues);
      } else if (schema.additionalProperties === false) {
        issues.push({ path: `${path}.${key}`, message: '不允许的额外字段（契约 additionalProperties:false）' });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        walk(schema.additionalProperties, value, `${path}.${key}`, issues);
      }
    }
  }
}

/**
 * @param {object} schema 契约
 * @param {unknown} data 待校验对象
 * @returns {{path: string, message: string}[]} 空数组表示通过
 */
export function validate(schema, data) {
  const issues = [];
  walk(schema, data, '$', issues);
  return issues;
}

const isShot = (e) => e.kind === 'SHOT';
const isActive = (e) => e.status === 'ACTIVE';
const hasCoords = (e) => typeof e.x_m === 'number' && typeof e.y_m === 'number';

/**
 * 跨字段语义规则。这些是"模型能跑通、JSON 合法、但数字是错的"唯一防线。
 * @param {object} report
 * @returns {{rule: string, path: string, message: string}[]}
 */
export function checkSemantics(report) {
  const issues = [];
  const add = (rule, path, message) => issues.push({ rule, path, message });

  const events = Array.isArray(report.events) ? report.events : [];
  const periods = Array.isArray(report.periods) ? report.periods : [];
  const params = report.params ?? {};
  const periodIndexes = new Set(periods.map((p) => p.index));

  // R1 · 3x3 规则集
  if (params.format === '3V3') {
    if (params.fast_break_enabled === true) {
      add('R1', '$.params.fast_break_enabled', '3V3 下必须为 false（PRD 6.3）');
    }
    for (const e of events) {
      if (e.kind === 'FAST_BREAK') {
        add('R1', `$.events[${e.id}].kind`, '3V3 下不得出现 FAST_BREAK 事件（PRD 9.2 #2.12）');
      }
      if (typeof e.label_zh === 'string' && e.label_zh.includes('三分')) {
        add('R1', `$.events[${e.id}].label_zh`, `3V3 下不得出现「三分」字样，实际「${e.label_zh}」（PRD 9.1 #1.9）`);
      }
    }
    if (report.team_stats?.fast_breaks) {
      add('R1', '$.team_stats.fast_breaks', '3V3 下必须为 0');
    }
  }

  // R2 · 越界坐标必须在 warnings 里留痕
  const warningsText = (report.warnings ?? []).join('\n');
  for (const e of events) {
    if (e.in_bounds === false && !warningsText.includes(e.id)) {
      add('R2', `$.events[${e.id}].in_bounds`, `坐标为越界但 warnings 未提及事件 ${e.id}，教练将无从察觉`);
    }
  }

  // R3 · 对方球员不得出现在我方名单
  for (const e of events) {
    if (e.team_side === 'OPPONENT' && e.player_id !== null) {
      add('R3', `$.events[${e.id}].player_id`, 'team_side=OPPONENT 时 player_id 必须为 null');
    }
  }

  // R4 · attribution_source 与 team_side 必须一致
  for (const e of events) {
    const src = e.attribution_source ?? null;
    if (src === 'NOT_OUR_TEAM' && e.team_side !== 'OPPONENT') {
      add('R4', `$.events[${e.id}].team_side`, 'attribution_source=NOT_OUR_TEAM 时 team_side 必须为 OPPONENT');
    }
    if (src === 'UNKNOWN' && e.team_side !== 'UNKNOWN') {
      add('R4', `$.events[${e.id}].team_side`, 'attribution_source=UNKNOWN（看不清）时 team_side 必须为 UNKNOWN');
    }
    if (src === 'COACH' && e.team_side === 'UNKNOWN') {
      add('R4', `$.events[${e.id}].team_side`, '教练已归属（attribution_source=COACH）但 team_side 仍为 UNKNOWN');
    }
  }

  // R5 · 事件所属节次必须存在
  for (const e of events) {
    if (!periodIndexes.has(e.period)) {
      add('R5', `$.events[${e.id}].period`, `第 ${e.period} 节不存在于 periods`);
    }
  }

  // R6 · 出手专属字段只属于 SHOT
  for (const e of events) {
    if (isShot(e)) continue;
    for (const key of ['shot_value', 'made', 'behind_three_point_line', 'label_zh']) {
      if (e[key] !== null && e[key] !== undefined) {
        add('R6', `$.events[${e.id}].${key}`, `kind=${e.kind} 的事件不应有 ${key}（只有 SHOT 才有）`);
      }
    }
  }

  // R7 · 统计数字必须能从事件重算出来（对不上就是静默错误）
  const active = events.filter(isActive);
  const ourShots = active.filter((e) => isShot(e) && e.team_side === 'OURS');
  const oppShots = active.filter((e) => isShot(e) && e.team_side === 'OPPONENT');

  const expect = (rule, statPath, statValue, actual, label) => {
    if (statValue !== undefined && statValue !== actual) {
      add(rule, statPath, `${label}应为 ${actual}（由事件重算），契约里写的是 ${statValue}`);
    }
  };

  expect('R7', '$.team_stats.shots_attempted', report.team_stats?.shots_attempted, ourShots.length, '我方出手数');
  expect('R7', '$.team_stats.shots_made', report.team_stats?.shots_made, ourShots.filter((e) => e.made === true).length, '我方命中数');
  expect('R7', '$.team_stats.arc_out_attempted', report.team_stats?.arc_out_attempted, ourShots.filter((e) => e.behind_three_point_line === true).length, '我方弧外出手数');
  expect('R7', '$.team_stats.arc_out_made', report.team_stats?.arc_out_made, ourShots.filter((e) => e.behind_three_point_line === true && e.made === true).length, '我方弧外命中数');
  expect('R7', '$.team_stats.points', report.team_stats?.points, ourShots.reduce((s, e) => s + (e.made === true ? (e.shot_value ?? 0) : 0), 0), '我方得分');

  expect('R7', '$.opponent_stats.shots_attempted', report.opponent_stats?.shots_attempted, oppShots.length, '对方出手数');
  expect('R7', '$.opponent_stats.shots_made', report.opponent_stats?.shots_made, oppShots.filter((e) => e.made === true).length, '对方命中数');
  expect('R7', '$.opponent_stats.points', report.opponent_stats?.points, oppShots.reduce((s, e) => s + (e.made === true ? (e.shot_value ?? 0) : 0), 0), '对方得分');
  expect('R7', '$.opponent_stats.turnovers', report.opponent_stats?.turnovers, active.filter((e) => e.kind === 'TURNOVER' && e.team_side === 'OPPONENT').length, '对方失误数');

  // R8 · coverage 必须与事件对得上
  const cov = report.coverage;
  if (cov) {
    expect('R8', '$.coverage.events_total', cov.events_total, events.length, '事件总数');
    expect('R8', '$.coverage.events_excluded', cov.events_excluded, events.filter((e) => e.status === 'EXCLUDED').length, '被排除事件数');
    expect('R8', '$.coverage.events_side_unknown', cov.events_side_unknown, active.filter((e) => e.team_side === 'UNKNOWN').length, '阵营未标注事件数');
    expect('R8', '$.coverage.events_attributed', cov.events_attributed, active.filter((e) => e.player_id !== null).length, '已归属事件数');
  }

  // R9 · 全场 5v5 必须有进攻方向，否则热图会镜像
  if (params.court_type === 'FULL' && params.format !== '3V3') {
    for (const p of periods) {
      if (!p.attacking_basket) {
        add('R9', `$.periods[${p.index}].attacking_basket`, '全场比赛的每一节都必须有进攻方向（v1.1 契约新增）');
      }
    }
  }

  // R10 · 出手必须有坐标才能进热图
  for (const e of ourShots) {
    if (!hasCoords(e) && e.status === 'ACTIVE') {
      add('R10', `$.events[${e.id}]`, '我方出手缺少坐标，无法进入热图与分区统计');
    }
  }

  return issues;
}

export default { validate, checkSemantics };
