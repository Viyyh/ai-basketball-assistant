/**
 * 事件补录状态机 —— P2-F03
 *
 * PRD 7.1：这块不做扎实，教练懒得补录，产品价值直接归零。
 *
 * 对应开发计划第 6.3 节的 14 条 checklist，本模块负责其中可纯逻辑验证的部分：
 *   · 选人即保存，无显式保存步骤、无失败弹窗（PRD 3.12）
 *   · "保存 · 下一个 →" 一键跳下一个未补录事件（PRD 屏 07 核心）
 *   · 跳过（本场暂不处理）
 *   · 撤销（单步 + 连续）
 *   · 进度自动保存 / 断网杀进程后重进完整保留（PRD 3.11）
 *   · "不是我方" 与 "看不清" 两个特殊选项，且不回填假球员
 *   · 记住上次选的人
 *   · 选人网格排序：首发顺序固定 + 已选替补
 *   · 未补录显示「—」，不显示 0 或空字符串（PRD 3.6）
 *
 * 设计：纯状态机，不含任何 wx.* 调用。持久化通过 serialize()/restore() 完成，
 * 由页面层负责落地到 wx.setStorage。这样可以在 Node 下完整单测。
 */

const { FORMAT, arcOutsideLabel } = require('./params');

/** 归属来源，与契约 events[].attribution_source 一致 */
const SOURCE = Object.freeze({
  AI: 'AI',
  COACH: 'COACH',
  UNKNOWN: 'UNKNOWN',              // 教练选了"看不清"
  NOT_OUR_TEAM: 'NOT_OUR_TEAM',    // 教练选了"不是我方"
});

/** 特殊选项的取值（不是球员 id） */
const SPECIAL = Object.freeze({
  UNKNOWN: '__unknown__',
  NOT_OUR_TEAM: '__not_our_team__',
});

/** 事件筛选器 */
const FILTER = Object.freeze({
  ALL: 'ALL',
  PENDING: 'PENDING',
  ARC_OUT: 'ARC_OUT',     // 界面文案随赛制变："三分" 或 "远投"
  FAST_BREAK: 'FAST_BREAK',
  TURNOVER: 'TURNOVER',
});

/** 未归属时界面显示的占位符（PRD 3.6：不得用 0 或空字符串） */
const UNATTRIBUTED_PLACEHOLDER = '—';

function isSpecialChoice(choice) {
  return choice === SPECIAL.UNKNOWN || choice === SPECIAL.NOT_OUR_TEAM;
}

/**
 * 判断一个事件是否"已处理"。
 *
 * 已处理 = 已归属到球员，或已明确标记为"不是我方"/"看不清"，或已跳过。
 * 只有 PENDING 状态的事件才会出现在"下一个"跳转里。
 */
function isResolved(ev) {
  if (!ev) return false;
  if (ev.player_id) return true;
  if (ev.attribution_source === SOURCE.UNKNOWN) return true;
  if (ev.attribution_source === SOURCE.NOT_OUR_TEAM) return true;
  if (ev.skipped) return true;
  return false;
}

/**
 * 事件的界面显示名。
 *
 * 契约 x-frontend-consumption-notes 要求：
 * player_id 为 null 或 attribution_source 为 UNKNOWN 时显示「—」，
 * 不得显示 0、空字符串或任何猜测的球员。
 */
function displayPlayerName(ev, rosterById) {
  if (!ev) return UNATTRIBUTED_PLACEHOLDER;
  if (ev.attribution_source === SOURCE.NOT_OUR_TEAM) return '不是我方';
  if (ev.attribution_source === SOURCE.UNKNOWN) return UNATTRIBUTED_PLACEHOLDER;
  if (!ev.player_id) return UNATTRIBUTED_PLACEHOLDER;
  const p = rosterById.get(ev.player_id);
  return p ? `${p.number} 号 ${p.name}` : UNATTRIBUTED_PLACEHOLDER;
}

/**
 * 创建补录会话。
 *
 * @param {object} opts
 * @param {Array}  opts.events   契约里的 events 数组（会被浅拷贝，不改原对象）
 * @param {Array}  opts.roster   球员名单 [{id, number, name, position, isStarter}]
 * @param {string} [opts.format] 赛制，决定筛选器文案（3x3 下"三分"→"远投"）
 * @param {object} [opts.persisted] 上次 serialize() 的结果，用于恢复
 * @param {Function} [opts.now]  时间源，测试可注入
 */
function createAttributionSession({ events, roster = [], format = FORMAT.FIVE_V_FIVE, persisted = null, now = () => Date.now() }) {
  if (!Array.isArray(events)) throw new Error('createAttributionSession: events 必须是数组');

  // 内部副本：以 id 为键，避免直接改契约对象
  /** @type {Map<string, object>} */
  const store = new Map();
  events.forEach((ev) => {
    if (!ev || !ev.id) return;
    store.set(ev.id, Object.assign({}, ev, {
      player_id: ev.player_id || null,
      attribution_source: ev.attribution_source || null,
      skipped: false,
    }));
  });

  const rosterById = new Map(roster.map((p) => [p.id, p]));

  /** 撤销栈：每项 {eventId, before, at} */
  const undoStack = [];

  /** 当前聚焦的事件 id */
  let cursorId = null;
  /** 上一次选中的球员 id（"记住上次选的人"） */
  let lastPlayerId = null;
  /** 变更回调，页面层用它触发进度自动保存 */
  let onChange = null;

  // ---------- 恢复 ----------

  if (persisted && Array.isArray(persisted.attributions)) {
    persisted.attributions.forEach((a) => {
      const ev = store.get(a.eventId);
      if (!ev) return;   // 报告重新生成后事件 id 可能变，忽略对不上的
      ev.player_id = a.playerId || null;
      ev.attribution_source = a.source || null;
      ev.skipped = !!a.skipped;
    });
    lastPlayerId = persisted.lastPlayerId || null;
    cursorId = persisted.cursorId && store.has(persisted.cursorId) ? persisted.cursorId : null;
  }

  function emit() {
    if (typeof onChange === 'function') onChange(serialize());
  }

  // ---------- 查询 ----------

  function allEvents() {
    return Array.from(store.values());
  }

  function getEvent(id) {
    return store.get(id) || null;
  }

  /**
   * 按筛选器取事件列表。
   *
   * 排序：按时间戳升序（教练按时间顺序补录最自然）。
   * PRD 10.2 开放问题 #1 问过"按时间还是按类型"，第一版先按时间，
   * 筛选器提供按类型切片的能力作为折中。
   */
  function list(filter = FILTER.ALL) {
    let arr = allEvents();
    switch (filter) {
      case FILTER.PENDING:
        arr = arr.filter((ev) => !isResolved(ev));
        break;
      case FILTER.ARC_OUT:
        arr = arr.filter((ev) => ev.kind === 'SHOT' && ev.behind_three_point_line === true);
        break;
      case FILTER.FAST_BREAK:
        arr = arr.filter((ev) => ev.kind === 'FAST_BREAK');
        break;
      case FILTER.TURNOVER:
        arr = arr.filter((ev) => ev.kind === 'TURNOVER');
        break;
      case FILTER.ALL:
      default:
        break;
    }
    return arr.slice().sort((a, b) => a.timestamp_s - b.timestamp_s);
  }

  /** 筛选器的展示定义（文案随赛制变化） */
  function filterDefs() {
    const pendingCount = list(FILTER.PENDING).length;
    return [
      { key: FILTER.ALL, label: `全部 ${store.size}` },
      { key: FILTER.PENDING, label: `未补录 ${pendingCount}`, highlight: pendingCount > 0 },
      { key: FILTER.ARC_OUT, label: `${arcOutsideLabel(format)} ${list(FILTER.ARC_OUT).length}` },
      { key: FILTER.FAST_BREAK, label: `快攻 ${list(FILTER.FAST_BREAK).length}`,
        disabled: format === FORMAT.THREE_V_THREE },   // 3x3 第一版关闭快攻
      { key: FILTER.TURNOVER, label: `失误 ${list(FILTER.TURNOVER).length}` },
    ];
  }

  /**
   * 补录进度。
   *
   * 报告页底部常驻进度条用它（PRD 屏 06）。
   * 注意 done 包含"不是我方""看不清""已跳过"——它们都是教练的明确处理结果，
   * 不该一直挂在待办里。
   */
  function progress() {
    const total = store.size;
    const resolved = allEvents().filter(isResolved).length;
    const attributed = allEvents().filter((ev) => !!ev.player_id).length;
    const pending = total - resolved;
    return {
      total,
      resolved,
      attributed,
      pending,
      percent: total > 0 ? Math.round((resolved / total) * 100) : 0,
      complete: total > 0 && pending === 0,
    };
  }

  /**
   * 选人网格的排序与标记。
   *
   * 规则（界面设计 v0.1.1 屏 07 注释）：
   *   · 首发按名单顺序固定在前
   *   · 替补在后
   *   · 上一次选过的人打 isLast 标记，界面高亮提示"刚刚是这个人"
   * 末尾追加两个特殊选项。
   */
  function pickerOrder() {
    const starters = roster.filter((p) => p.isStarter);
    const subs = roster.filter((p) => !p.isStarter);
    const ordered = starters.concat(subs);
    const items = ordered.map((p) => ({
      kind: 'player',
      id: p.id,
      number: p.number,
      name: p.name,
      position: p.position,
      isLast: p.id === lastPlayerId,
    }));
    items.push({ kind: 'special', id: SPECIAL.NOT_OUR_TEAM, label: '不是我方', isLast: false });
    items.push({ kind: 'special', id: SPECIAL.UNKNOWN, label: '看不清', isLast: false });
    return items;
  }

  function current() {
    return cursorId ? getEvent(cursorId) : null;
  }

  function setCursor(id) {
    if (store.has(id)) { cursorId = id; emit(); return true; }
    return false;
  }

  /**
   * 下一个未补录事件。
   *
   * 从当前游标之后开始找（环形），找不到返回 null。
   * 这是"保存 · 下一个 →"按钮的目标，PRD 屏 07 说这个动作让
   * 单事件补录从 30 秒降到 3-5 秒，差 5 倍效率。
   */
  function nextPending(fromId = cursorId) {
    const ordered = list(FILTER.ALL);
    if (ordered.length === 0) return null;

    const pending = ordered.filter((ev) => !isResolved(ev));
    if (pending.length === 0) return null;

    if (!fromId) return pending[0];

    const fromIdx = ordered.findIndex((ev) => ev.id === fromId);
    if (fromIdx < 0) return pending[0];

    // 先从游标之后找，再从头找（环形）
    for (let i = fromIdx + 1; i < ordered.length; i += 1) {
      if (!isResolved(ordered[i])) return ordered[i];
    }
    for (let i = 0; i < fromIdx; i += 1) {
      if (!isResolved(ordered[i])) return ordered[i];
    }
    return null;
  }

  // ---------- 变更 ----------

  function pushUndo(eventId, before) {
    undoStack.push({ eventId, before, at: now() });
    // 撤销栈设上限，避免长时间补录内存无界增长
    if (undoStack.length > 200) undoStack.shift();
  }

  /**
   * 选人即保存。
   *
   * ⚠️ 这是"选人即保存"语义：调用即落库，没有单独的 save 步骤，
   * 也不返回需要用户确认的错误（PRD 3.12）。
   * 网络失败时由页面层写本地缓存并重试，UI 不弹任何提示。
   *
   * @param {string} eventId
   * @param {string} choice 球员 id，或 SPECIAL.UNKNOWN / SPECIAL.NOT_OUR_TEAM
   * @returns {{ok:boolean, event:object|null, next:object|null, resolvedAll:boolean}}
   */
  function select(eventId, choice) {
    const ev = store.get(eventId);
    if (!ev) return { ok: false, event: null, next: null, resolvedAll: false };
    if (!choice) return { ok: false, event: null, next: null, resolvedAll: false };

    // 校验：非特殊选项必须是名单里的真实球员，防止写入脏 id
    if (!isSpecialChoice(choice) && !rosterById.has(choice)) {
      return { ok: false, event: null, next: null, resolvedAll: false };
    }

    pushUndo(eventId, {
      player_id: ev.player_id,
      attribution_source: ev.attribution_source,
      skipped: ev.skipped,
    });

    if (choice === SPECIAL.UNKNOWN) {
      // "看不清"：player_id 保持 null，界面显示「—」，不得回填假球员
      ev.player_id = null;
      ev.attribution_source = SOURCE.UNKNOWN;
    } else if (choice === SPECIAL.NOT_OUR_TEAM) {
      ev.player_id = null;
      ev.attribution_source = SOURCE.NOT_OUR_TEAM;
    } else {
      ev.player_id = choice;
      ev.attribution_source = SOURCE.COACH;
      lastPlayerId = choice;
    }
    ev.skipped = false;

    const next = nextPending(eventId);
    if (next) cursorId = next.id;

    emit();
    return {
      ok: true,
      event: Object.assign({}, ev),
      next: next ? Object.assign({}, next) : null,
      resolvedAll: progress().pending === 0,
    };
  }

  /**
   * 跳过（本场暂不处理）。
   *
   * 跳过的事件不再出现在"下一个"里，但仍算未归属，
   * 报告里显示「—」。进度条把它算作已处理，避免教练被无限待办困住。
   */
  function skip(eventId) {
    const ev = store.get(eventId);
    if (!ev) return { ok: false, next: null };

    pushUndo(eventId, {
      player_id: ev.player_id,
      attribution_source: ev.attribution_source,
      skipped: ev.skipped,
    });

    ev.skipped = true;
    const next = nextPending(eventId);
    if (next) cursorId = next.id;

    emit();
    return { ok: true, next: next ? Object.assign({}, next) : null };
  }

  /**
   * 撤销一步。
   * @returns {{ok:boolean, eventId:string|null, restored:object|null, remaining:number}}
   */
  function undo() {
    if (undoStack.length === 0) {
      return { ok: false, eventId: null, restored: null, remaining: 0 };
    }
    const entry = undoStack.pop();
    const ev = store.get(entry.eventId);
    if (!ev) return { ok: false, eventId: null, restored: null, remaining: undoStack.length };

    ev.player_id = entry.before.player_id;
    ev.attribution_source = entry.before.attribution_source;
    ev.skipped = entry.before.skipped;
    cursorId = entry.eventId;

    emit();
    return {
      ok: true,
      eventId: entry.eventId,
      restored: Object.assign({}, ev),
      remaining: undoStack.length,
    };
  }

  /** 连续撤销 n 步 */
  function undoMany(n) {
    const results = [];
    for (let i = 0; i < n; i += 1) {
      const r = undo();
      results.push(r);
      if (!r.ok) break;
    }
    return results;
  }

  function clearUndo() {
    undoStack.length = 0;
  }

  function setOnChange(fn) {
    onChange = typeof fn === 'function' ? fn : null;
  }

  // ---------- 持久化 ----------

  /**
   * 导出可持久化状态。
   *
   * 页面层应在每次变更后 debounce 写入 wx.setStorage，
   * 这是 PRD 3.11「断网/杀进程后重进，已补录内容完整保留」的实现基础。
   */
  function serialize() {
    return {
      cursorId,
      lastPlayerId,
      attributions: allEvents()
        .filter((ev) => ev.player_id || ev.attribution_source || ev.skipped)
        .map((ev) => ({
          eventId: ev.id,
          playerId: ev.player_id,
          source: ev.attribution_source,
          skipped: ev.skipped,
        })),
      savedAt: now(),
    };
  }

  return {
    // 查询
    allEvents,
    getEvent,
    list,
    filterDefs,
    progress,
    pickerOrder,
    current,
    setCursor,
    nextPending,
    displayName: (ev) => displayPlayerName(ev, rosterById),
    isResolved,
    // 变更
    select,
    skip,
    undo,
    undoMany,
    clearUndo,
    setOnChange,
    get undoDepth() { return undoStack.length; },
    get lastPlayerId() { return lastPlayerId; },
    // 持久化
    serialize,
  };
}

module.exports = {
  SOURCE,
  SPECIAL,
  FILTER,
  UNATTRIBUTED_PLACEHOLDER,
  isResolved,
  displayPlayerName,
  createAttributionSession,
};
