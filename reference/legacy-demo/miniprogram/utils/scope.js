/**
 * 口径守卫（前端镜像）—— 服务于 P4-F02 球队比赛数据页
 *
 * 对应 PRD 4.9「聚合无跨赛制」与球队页设计 v0.2 屏 02：
 *   赛制筛选不提供"全部"选项。与其给一个看起来全面、实际错误的数字，
 *   不如强制教练选一个口径。
 *
 * ⚠️ 为什么前端也要有一份守卫？
 *
 *   后端 packages/params/aggregate.py 的 aggregate_guarded() 是主防线。
 *   但前端会在本地做即时聚合（列表页统计、筛选后的小计），
 *   如果前端自己合并了不同赛制的数据再显示，后端的守卫就绕过去了。
 *   PRD 风险 7.4 的教训是：这类错误报告上看不出来，只能靠每一层都拦。
 *
 *   两份实现的判定规则必须完全一致，tests/scope.test.js 会做交叉验证。
 */

const { FORMAT, AGE_GROUP, FORMAT_LABEL, AGE_GROUP_LABEL, scopeLabel } = require('./params');

/** 跨赛制聚合 */
class CrossFormatAggregationError extends Error {
  constructor(formats) {
    const labels = formats.map((f) => FORMAT_LABEL[f] || f).join('、');
    super(
      `检测到跨赛制聚合：${labels}。`
      + '5对5 与 3对3 的人数、场地、时限、计分口径均不同，胜率与命中率不可比。'
      + '请分别指定 format 调用 aggregate()。'
    );
    this.name = 'CrossFormatAggregationError';
    this.formats = formats;
  }
}

/** 跨年龄段聚合 */
class CrossAgeGroupAggregationError extends Error {
  constructor(ageGroups) {
    const labels = ageGroups.map((a) => AGE_GROUP_LABEL[a] || a).join('、');
    super(
      `检测到跨年龄段聚合：${labels}。`
      + '不同年龄段的三分线半径与比赛强度不同，数据不可比。'
    );
    this.name = 'CrossAgeGroupAggregationError';
    this.ageGroups = ageGroups;
  }
}

/**
 * 可选口径列表。
 *
 * ⚠️ 永远不包含"全部"。这是产品决定，不是技术限制。
 * 只返回数据里实际出现过的赛制，避免出现空口径的筛选项。
 *
 * @param {Array} games
 * @returns {Array<{format:string, ageGroup:string, label:string, count:number}>}
 */
function availableScopes(games) {
  const map = new Map();
  games.forEach((g) => {
    const key = `${g.format}|${g.ageGroup}`;
    if (!map.has(key)) {
      map.set(key, { format: g.format, ageGroup: g.ageGroup, count: 0 });
    }
    map.get(key).count += 1;
  });

  return Array.from(map.values())
    .map((s) => Object.assign({}, s, {
      label: scopeLabel({ format: s.format, ageGroup: s.ageGroup, games: s.count }),
    }))
    .sort((a, b) => b.count - a.count || a.format.localeCompare(b.format));
}

/**
 * 默认口径。
 *
 * 规则：取场次最多的口径；并列时优先 5对5（主流赛制）。
 * 页面首次进入必须有明确口径，不能是"全部"。
 */
function defaultScope(games) {
  const scopes = availableScopes(games);
  if (scopes.length === 0) return null;
  const sorted = scopes.slice().sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const rank = (f) => (f === FORMAT.FIVE_V_FIVE ? 0 : 1);
    return rank(a.format) - rank(b.format);
  });
  return { format: sorted[0].format, ageGroup: sorted[0].ageGroup };
}

/**
 * 按 (赛制, 年龄段) 分组。
 * @returns {Map<string, Array>} key 为 `${format}|${ageGroup}`
 */
function groupByScope(games) {
  const buckets = new Map();
  games.forEach((g) => {
    const key = `${g.format}|${g.ageGroup}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g);
  });
  return buckets;
}

function pct(n, d, digits = 4) {
  if (!d) return null;
  const v = n / d;
  return Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
}

function round1(n) {
  return Number.isFinite(n) ? Number(n.toFixed(1)) : 0;
}

/**
 * 按指定口径聚合。
 *
 * 显式传入口径、内部过滤 —— 调用方无法不小心把混合数据塞进来得到一个错数字。
 *
 * ⚠️ 弧外命中的字段名用 arcOut 而非 threes：
 *    3x3 下弧外只值 2 分，叫 threes 会让教练困惑（契约 team_stats 同理）。
 *
 * @param {Array} games [{format, ageGroup, pointsFor, pointsAgainst, won, fgm, fga, arcOutMade, arcOutAtt}]
 * @param {string} format
 * @param {string} ageGroup
 */
function aggregate(games, format, ageGroup) {
  if (!format || !ageGroup) {
    throw new Error('aggregate: 必须显式指定 format 与 ageGroup，不允许"全部"');
  }

  const selected = games.filter((g) => g.format === format && g.ageGroup === ageGroup);
  return compute(selected, format, ageGroup);
}

/**
 * 直接聚合一批数据，但跨赛制或跨年龄段时抛错。
 *
 * 用于"我以为我已经筛过了"的调用点，把错误暴露在开发期而不是产出错数字。
 */
function aggregateGuarded(games) {
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error('aggregateGuarded: 没有可聚合的数据');
  }

  const formats = Array.from(new Set(games.map((g) => g.format)));
  if (formats.length > 1) throw new CrossFormatAggregationError(formats);

  const ages = Array.from(new Set(games.map((g) => g.ageGroup)));
  if (ages.length > 1) throw new CrossAgeGroupAggregationError(ages);

  return compute(games, games[0].format, games[0].ageGroup);
}

function compute(games, format, ageGroup) {
  const n = games.length;
  const base = {
    format,
    ageGroup,
    label: scopeLabel({ format, ageGroup, games: n }),
    games: n,
    wins: 0,
    losses: 0,
    winRate: null,
    ppg: 0,
    ppgAgainst: 0,
    netPpg: 0,
    fgPct: null,
    arcOutPct: null,
  };

  if (n === 0) return base;

  const wins = games.filter((g) => g.won).length;
  const fga = games.reduce((s, g) => s + (g.fga || 0), 0);
  const fgm = games.reduce((s, g) => s + (g.fgm || 0), 0);
  const aoa = games.reduce((s, g) => s + (g.arcOutAtt || 0), 0);
  const aom = games.reduce((s, g) => s + (g.arcOutMade || 0), 0);
  const pf = games.reduce((s, g) => s + (g.pointsFor || 0), 0);
  const pa = games.reduce((s, g) => s + (g.pointsAgainst || 0), 0);

  return Object.assign(base, {
    wins,
    losses: n - wins,
    winRate: pct(wins, n),
    ppg: round1(pf / n),
    ppgAgainst: round1(pa / n),
    netPpg: round1((pf - pa) / n),
    fgPct: pct(fgm, fga),
    arcOutPct: pct(aom, aoa),
  });
}

/**
 * 数据完整度标注。
 *
 * 对应 PRD P2-25「所有聚合数据旁标注"基于 N/M 场"」与
 * 球队页设计 v0.2 屏 02 的诚实性问题注释：
 * 有场次未补录时数字会偏低，必须让教练看到分母。
 *
 * @param {number} completeGames 已完成补录的场次
 * @param {number} totalGames    该口径下总场次
 * @returns {{text:string, incomplete:boolean, missing:number}}
 */
function completenessNote(completeGames, totalGames) {
  const missing = Math.max(0, totalGames - completeGames);
  if (missing === 0) {
    return { text: `基于 ${totalGames} 场`, incomplete: false, missing: 0 };
  }
  return {
    text: `基于 ${completeGames}/${totalGames} 场 · ${missing} 场待补录`,
    incomplete: true,
    missing,
  };
}

/**
 * 按赛制拆分的对手交手记录。
 *
 * 对应球队页设计 v0.2 屏 07 的「赛制维度」注释：
 * 和育才中学打过 2 场 5对5、1 场 3对3，不能合并显示成"交手 3 次 · 2胜1负"。
 *
 * @param {Array} games 与该对手的所有交手
 * @returns {Array<{format:string, ageGroup:string, label:string, played:number, wins:number, losses:number}>}
 */
function headToHeadByScope(games) {
  const buckets = groupByScope(games);
  return Array.from(buckets.entries()).map(([key, list]) => {
    const [format, ageGroup] = key.split('|');
    const wins = list.filter((g) => g.won).length;
    return {
      format,
      ageGroup,
      label: scopeLabel({ format, ageGroup }),
      played: list.length,
      wins,
      losses: list.length - wins,
      lastPlayedAt: list.reduce((max, g) => (g.playedAt > max ? g.playedAt : max), ''),
    };
  }).sort((a, b) => b.played - a.played);
}

module.exports = {
  CrossFormatAggregationError,
  CrossAgeGroupAggregationError,
  availableScopes,
  defaultScope,
  groupByScope,
  aggregate,
  aggregateGuarded,
  completenessNote,
  headToHeadByScope,
};
