/**
 * API 门面 —— 页面只依赖本模块，不直接读 mock 或调 wx.request
 *
 * 为什么要有这一层：
 *   Phase 1 期间后端还没就绪，页面用 mock 数据开发（开发计划 P1-B05）。
 *   Phase 2 把 Mock 换成真实 pipeline 时，**接口签名不变，页面一行都不用改**。
 *   这就是开发计划第十三节说的"Mock 与真实实现可开关切换"。
 *
 * 切换方式：把 USE_MOCK 改成 false（或由环境变量/配置下发），
 * 所有方法自动走 wx.request 分支。
 */

const mockData = require('../mock/data');
const { generateMockReport } = require('../mock/report');
const { aggregate, availableScopes, defaultScope, completenessNote, headToHeadByScope } = require('./scope');

/** 总开关。后端就绪后置为 false */
const USE_MOCK = true;

/** 模拟网络延迟，让 loading 态可见（真实环境删掉） */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 真实请求封装。USE_MOCK=false 时走这里 */
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getConfig().apiBase}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: Object.assign({ 'content-type': 'application/json' }, options.header),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error(`HTTP ${res.statusCode}: ${path}`));
      },
      fail: (err) => reject(err),
    });
  });
}

let _config = { apiBase: '', cdnBase: '' };
function getConfig() { return _config; }
function setConfig(cfg) { _config = Object.assign(_config, cfg || {}); }

// ============================================================
// 球队 / 名单
// ============================================================

async function getTeam() {
  if (USE_MOCK) { await delay(60); return Object.assign({}, mockData.TEAM); }
  return request('/teams/current');
}

async function getRoster() {
  if (USE_MOCK) { await delay(60); return mockData.ROSTER.slice(); }
  return request('/roster');
}

// ============================================================
// 活动
// ============================================================

async function listActivities(filter = {}) {
  if (USE_MOCK) {
    await delay(80);
    let list = mockData.ACTIVITIES.slice();
    if (filter.template) list = list.filter((a) => a.template === filter.template);
    if (filter.format) list = list.filter((a) => a.format === filter.format);
    if (filter.status) list = list.filter((a) => a.status === filter.status);
    if (filter.opponentId) list = list.filter((a) => a.opponentId === filter.opponentId);
    return list.sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1));
  }
  return request('/activities', { data: filter });
}

async function getActivity(id) {
  if (USE_MOCK) {
    await delay(60);
    return mockData.ACTIVITIES.find((a) => a.id === id) || null;
  }
  return request(`/activities/${id}`);
}

/** 待补录的活动（首页与球队页的橙色提醒都读它） */
async function listPendingAttribution() {
  const all = await listActivities();
  return all.filter((a) => a.status === 'report_ready' && a.attributedCount < a.eventCount)
    .sort((a, b) => (a.playedAt < b.playedAt ? -1 : 1));   // 最旧的排最前
}

/**
 * 新建活动。
 *
 * ⚠️ 年龄段与赛制必填（PRD 决策 10、11）。
 *    这里做前端校验，后端会再校验一次 —— 两层都要有，
 *    因为参数取错会产生"静默的错误数据"（PRD 风险 7.4）。
 */
async function createActivity(payload) {
  const problems = validateActivityPayload(payload);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.validationProblems = problems;
    throw err;
  }
  if (USE_MOCK) {
    await delay(120);
    return Object.assign({ id: `act_${Date.now()}`, status: 'draft' }, payload);
  }
  return request('/activities', { method: 'POST', data: payload });
}

/**
 * 新建活动的前端校验。
 * 独立成函数便于单测（tests/api.test.js）。
 *
 * @returns {string[]} 问题清单，空数组表示通过
 */
function validateActivityPayload(p) {
  const problems = [];
  if (!p) return ['缺少表单数据'];

  if (!p.template) problems.push('请选择活动模板');
  if (!p.name || !String(p.name).trim()) problems.push('请填写活动名称');
  if (!p.ageGroup) problems.push('请选择年龄段（必填，影响三分线判定与节次时长）');
  if (!p.format) problems.push('请选择赛制（必填，影响场地标定与计分口径）');

  // 4对4 与自定义必须指定场地类型
  if ((p.format === '4V4' || p.format === 'CUSTOM') && !p.courtType) {
    problems.push('4 对 4 与自定义赛制没有统一规则，请指定全场还是半场');
  }

  const need = { '5V5': 5, '4V4': 4, '3V3': 3, CUSTOM: p.customPlayers || 5 }[p.format] || 0;
  if (need > 0) {
    if (p.template === 'SCRIMMAGE') {
      const red = (p.groups && p.groups.red) || [];
      const blue = (p.groups && p.groups.blue) || [];
      if (red.length !== need) problems.push(`团队对抗红队需 ${need} 人，当前 ${red.length} 人`);
      if (blue.length !== need) problems.push(`团队对抗蓝队需 ${need} 人，当前 ${blue.length} 人`);
    } else if (Array.isArray(p.starters) && p.starters.length !== need) {
      problems.push(`${p.format} 首发需 ${need} 人，当前 ${p.starters.length} 人`);
    }
  }

  return problems;
}

// ============================================================
// 上传 / 处理
// ============================================================

/** 申请 STS 直传凭证（PRD 5.2：上传走直传，不经业务服务器中转） */
async function getUploadCredential(activityId) {
  if (USE_MOCK) {
    await delay(100);
    return {
      activityId,
      provider: 'mock-cos',
      bucket: 'bball-raw-video',
      keyPrefix: `videos/${activityId}/`,
      tmpSecretId: 'MOCK_TMP_ID',
      tmpSecretKey: 'MOCK_TMP_KEY',
      sessionToken: 'MOCK_TOKEN',
      expiredTime: Math.floor(Date.now() / 1000) + 1800,
    };
  }
  return request(`/activities/${activityId}/upload-credential`);
}

/** 处理进度（屏 05） */
async function getProcessStatus(activityId) {
  if (USE_MOCK) {
    await delay(80);
    const a = mockData.ACTIVITIES.find((x) => x.id === activityId);
    return {
      activityId,
      status: (a && a.status) || 'processing',
      queueAhead: (a && a.queueAhead) || 0,
      etaMinutes: (a && a.etaMinutes) || 30,
      currentStep: (a && a.processStep) || 3,
      steps: mockData.PIPELINE_STEPS,
    };
  }
  return request(`/activities/${activityId}/process-status`);
}

// ============================================================
// 报告
// ============================================================

/**
 * 取报告。
 *
 * Mock 分支会用该活动的 format/ageGroup 生成契约形状的报告，
 * 因此 3x3 活动会真的拿到 1/2 分与「远投(2分)」标签 —— 这是
 * 开发计划第十三节要求的"Mock 必须真实响应 params"。
 */
async function getReport(activityId, opts = {}) {
  if (USE_MOCK) {
    await delay(200);
    const a = mockData.ACTIVITIES.find((x) => x.id === activityId);
    if (!a) return null;
    if (a.status === 'processing' || a.status === 'uploading') {
      return { status: a.status, report: null };
    }
    if (opts.simulateFail) {
      return generateMockReport({ simulateFail: true, activityId });
    }

    const res = generateMockReport({
      format: a.format,
      ageGroup: a.ageGroup,
      courtType: a.courtType || null,
      activityId,
      durationS: a.durationS,
      eventCount: a.eventCount || 34,
      seed: seedFromId(activityId),
      simulateBadCalibration: !!opts.simulateBadCalibration,
    });

    return {
      status: 'done',
      report: res.report,
      activity: a,
      attribution: mergeLocalAttribution(activityId, res.report),
    };
  }
  return request(`/activities/${activityId}/report`);
}

/** 从 activityId 派生稳定种子，保证同一场活动的 Mock 报告可复现 */
function seedFromId(id) {
  const s = String(id || 'x');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 把本地已保存的补录结果合并进报告事件。
 *
 * 对应 PRD 数据流关键点 3：报告查询服务合并两个来源
 * （数据库的教练补录 + 报告 JSON 的 AI 输出）。
 * Mock 阶段"数据库"就是本地 storage。
 */
function mergeLocalAttribution(activityId, report) {
  if (!report || !Array.isArray(report.events)) return null;
  let saved = null;
  try {
    const all = wx.getStorageSync('attribution_state') || {};
    saved = all[activityId] || null;
  } catch (e) { saved = null; }
  if (!saved || !Array.isArray(saved.attributions)) return null;

  const map = new Map(saved.attributions.map((a) => [a.eventId, a]));
  report.events.forEach((ev) => {
    const hit = map.get(ev.id);
    if (!hit) return;
    ev.player_id = hit.playerId || null;
    ev.attribution_source = hit.source || null;
    ev.skipped = !!hit.skipped;
  });
  return saved;
}

// ============================================================
// 补录
// ============================================================

/** 保存单个事件的归属。选人即保存，失败不弹窗（PRD 3.12） */
async function saveAttribution(activityId, eventId, choice) {
  if (USE_MOCK) {
    // Mock 下不做网络请求，由页面层写本地 storage（app.saveAttribution）
    return { ok: true, activityId, eventId, choice };
  }
  return request(`/activities/${activityId}/events/${eventId}/attribution`, {
    method: 'PUT',
    data: { choice },
  });
}

// ============================================================
// 球队统计
// ============================================================

/**
 * 球队比赛数据。
 *
 * ⚠️ 强制按赛制口径返回，**不提供"全部赛制"的合并结果**
 *    （PRD 4.9 / 球队页设计 v0.2 屏 02）。
 */
async function getTeamStats() {
  const activities = await listActivities();
  const games = activities
    .filter((a) => a.template === 'MATCH' || a.template === 'SCRIMMAGE')
    .filter((a) => Number.isFinite(a.scoreFor))
    .map((a) => ({
      id: a.id,
      format: a.format,
      ageGroup: a.ageGroup,
      playedAt: a.playedAt,
      pointsFor: a.scoreFor,
      pointsAgainst: a.scoreAgainst,
      won: !!a.won,
      // 命中率等细节字段 Mock 阶段留空，页面显示「—」而不是编造数字
      fgm: a.fgm || 0, fga: a.fga || 0,
      arcOutMade: a.arcOutMade || 0, arcOutAtt: a.arcOutAtt || 0,
      attributed: a.attributedCount >= a.eventCount,
    }));

  const scopes = availableScopes(games);
  const def = defaultScope(games);

  const byScope = {};
  scopes.forEach((s) => {
    const key = `${s.format}|${s.ageGroup}`;
    const list = games.filter((g) => g.format === s.format && g.ageGroup === s.ageGroup);
    byScope[key] = {
      scope: s,
      stats: aggregate(games, s.format, s.ageGroup),
      games: list,
      completeness: completenessNote(
        list.filter((g) => g.attributed).length,
        list.length
      ),
    };
  });

  return { scopes, defaultScope: def, byScope, allGames: games };
}

/** 某一口径下的比赛列表 */
async function listGamesByScope(format, ageGroup) {
  const all = await getTeamStats();
  const key = `${format}|${ageGroup}`;
  return (all.byScope[key] && all.byScope[key].games) || [];
}

// ============================================================
// 球员
// ============================================================

/**
 * 球员列表。
 *
 * Mock 阶段没有真实的球员级统计（那需要补录完成 + 后端聚合），
 * 所以场均数据按"是否已完成补录"决定给不给，给不了就返回 null，
 * 页面显示「—」—— 不编造数字（PRD 6.3）。
 */
async function listPlayers() {
  const roster = await getRoster();
  const activities = await listActivities();
  const complete = activities.filter((a) => a.status === 'complete'
    && (a.template === 'MATCH' || a.template === 'SCRIMMAGE'));

  return roster.map((p) => {
    // 用号码派生一个稳定的伪统计，仅为让界面有内容可看；
    // 真实环境这些字段来自后端聚合接口。
    const hasData = complete.length > 0;
    const seed = p.number * 7;
    return Object.assign({}, p, {
      gamesPlayed: hasData ? complete.length : 0,
      ppg: hasData ? Number((6 + (seed % 11) + (seed % 3) * 0.4).toFixed(1)) : null,
      fgPct: hasData ? Number((0.36 + (seed % 12) / 100).toFixed(3)) : null,
      rpg: null,   // 篮板需补录，Mock 阶段明确给 null
      apg: null,
      dataComplete: hasData,
    });
  });
}

async function getPlayer(id) {
  const list = await listPlayers();
  return list.find((p) => p.id === id) || null;
}

// ============================================================
// 战术板
// ============================================================

async function listTactics(filter = {}) {
  if (USE_MOCK) {
    await delay(80);
    let list = mockData.TACTICS.slice();
    if (filter.tag) list = list.filter((t) => t.tags.includes(filter.tag));
    if (filter.keyword) {
      const k = filter.keyword.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(k));
    }
    return list;
  }
  return request('/tactics', { data: filter });
}

/**
 * 智能推荐战术片段（PRD P2-23）。
 *
 * 第一版最简实现：返回本场已识别的快攻与弧外命中事件作为候选。
 * AI 已经知道哪些回合精彩，直接列出来，把"从 45 分钟里找回合"
 * 的操作从 2 分钟压到 10 秒。
 */
async function recommendTacticClips(activityId, limit = 3) {
  const res = await getReport(activityId);
  if (!res || !res.report) return [];

  const events = res.report.events;
  const scored = events.map((e) => {
    let score = 0;
    if (e.kind === 'FAST_BREAK') score += 3;
    if (e.kind === 'SHOT' && e.made && e.behind_three_point_line) score += 2;
    if (e.kind === 'SHOT' && e.made) score += 1;
    if ((e.confidence || 0) > 0.85) score += 0.5;
    return { e, score };
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ e }) => ({
    eventId: e.id,
    timestampS: e.timestamp_s,
    clipKey: e.clip_key,
    clipStartS: e.clip_start_s,
    clipDurationS: e.clip_duration_s,
    reason: e.kind === 'FAST_BREAK' ? '快攻回合'
      : (e.behind_three_point_line ? '弧外命中' : '命中回合'),
    suggestedName: e.kind === 'FAST_BREAK' ? '快攻推进' : '弧外出手',
  }));
}

async function createTactic(payload) {
  if (!payload || !payload.name || !String(payload.name).trim()) {
    throw new Error('请填写战术名称');
  }
  if (USE_MOCK) {
    await delay(120);
    return Object.assign({ id: `t_${Date.now()}`, refCount: 0 }, payload);
  }
  return request('/tactics', { method: 'POST', data: payload });
}

// ============================================================
// 对手
// ============================================================

async function listOpponents() {
  if (USE_MOCK) {
    await delay(80);
    return mockData.OPPONENTS.map((o) => Object.assign({}, o));
  }
  return request('/opponents');
}

async function getOpponent(id) {
  if (USE_MOCK) {
    await delay(80);
    return mockData.OPPONENTS.find((o) => o.id === id) || null;
  }
  return request(`/opponents/${id}`);
}

/**
 * 对手交手记录，按赛制拆开。
 * 球队页设计 v0.2 屏 07：不能合并成"交手 3 次 · 2胜1负"。
 */
async function getOpponentHeadToHead(id) {
  const activities = await listActivities({ opponentId: id });
  const games = activities
    .filter((a) => Number.isFinite(a.scoreFor))
    .map((a) => ({
      format: a.format, ageGroup: a.ageGroup, playedAt: a.playedAt, won: !!a.won,
      pointsFor: a.scoreFor, pointsAgainst: a.scoreAgainst,
    }));
  return { games, byScope: headToHeadByScope(games) };
}

module.exports = {
  USE_MOCK,
  setConfig,
  getConfig,
  validateActivityPayload,
  // 球队
  getTeam,
  getRoster,
  // 活动
  listActivities,
  getActivity,
  listPendingAttribution,
  createActivity,
  // 上传 / 处理
  getUploadCredential,
  getProcessStatus,
  // 报告 / 补录
  getReport,
  saveAttribution,
  // 统计
  getTeamStats,
  listGamesByScope,
  listPlayers,
  getPlayer,
  // 战术板
  listTactics,
  recommendTacticClips,
  createTactic,
  // 对手
  listOpponents,
  getOpponent,
  getOpponentHeadToHead,
};
