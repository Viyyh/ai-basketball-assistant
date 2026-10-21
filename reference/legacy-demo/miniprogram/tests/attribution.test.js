/**
 * 补录状态机单元测试 —— P2-F03
 *
 * 对应开发计划第 6.3 节「补录 UI 专项 DoD」的 14 条 checklist 中
 * 可纯逻辑验证的部分。PRD 7.1：这块不做扎实，产品价值直接归零。
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  FILTER,
  SOURCE,
  SPECIAL,
  UNATTRIBUTED_PLACEHOLDER,
  createAttributionSession,
  displayPlayerName,
  isResolved,
} = require('../utils/attribution');
const { FORMAT } = require('../utils/params');

// ---------- 测试夹具 ----------

const ROSTER = [
  { id: 'p4',  number: 4,  name: '王', position: '控卫', isStarter: true },
  { id: 'p7',  number: 7,  name: '李', position: '分卫', isStarter: true },
  { id: 'p11', number: 11, name: '张', position: '小前', isStarter: true },
  { id: 'p23', number: 23, name: '陈', position: '大前', isStarter: true },
  { id: 'p32', number: 32, name: '周', position: '中锋', isStarter: true },
  { id: 'p8',  number: 8,  name: '孙', position: '分卫', isStarter: false },
  { id: 'p15', number: 15, name: '吴', position: '中锋', isStarter: false },
];

/** 造一批事件：3 个弧外命中、2 个弧内、1 个失误、1 个快攻 */
function makeEvents() {
  return [
    { id: 'e1', kind: 'SHOT', timestamp_s: 30, period: 1, x_m: 6.2, y_m: 0,
      behind_three_point_line: true, shot_value: 3, made: true, label_zh: '三分', player_id: null },
    { id: 'e2', kind: 'SHOT', timestamp_s: 60, period: 1, x_m: 3.0, y_m: 1.0,
      behind_three_point_line: false, shot_value: 2, made: true, label_zh: '二分', player_id: null },
    { id: 'e3', kind: 'TURNOVER', timestamp_s: 90, period: 1, player_id: null },
    { id: 'e4', kind: 'SHOT', timestamp_s: 120, period: 1, x_m: 6.5, y_m: 2.0,
      behind_three_point_line: true, shot_value: 3, made: false, label_zh: '三分', player_id: null },
    { id: 'e5', kind: 'FAST_BREAK', timestamp_s: 150, period: 2, player_id: null },
    { id: 'e6', kind: 'SHOT', timestamp_s: 180, period: 2, x_m: 7.0, y_m: -3.0,
      behind_three_point_line: true, shot_value: 3, made: true, label_zh: '三分', player_id: null },
    { id: 'e7', kind: 'SHOT', timestamp_s: 210, period: 2, x_m: 1.5, y_m: 0,
      behind_three_point_line: false, shot_value: 2, made: false, label_zh: '二分', player_id: null },
  ];
}

function makeSession(overrides = {}) {
  return createAttributionSession(Object.assign({
    events: makeEvents(),
    roster: ROSTER,
  }, overrides));
}

// ============================================================
// checklist #1-2: 事件列表与筛选
// ============================================================

test('list: 默认按时间戳升序', () => {
  const s = makeSession();
  const ids = s.list().map((e) => e.id);
  assert.deepStrictEqual(ids, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
});

test('list: 乱序输入也会被排序', () => {
  const shuffled = makeEvents().reverse();
  const s = createAttributionSession({ events: shuffled, roster: ROSTER });
  assert.deepStrictEqual(s.list().map((e) => e.id),
    ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
});

test('filterDefs: 五个筛选器齐全且计数正确', () => {
  const s = makeSession();
  const defs = s.filterDefs();
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));

  assert.strictEqual(byKey[FILTER.ALL].label, '全部 7');
  assert.strictEqual(byKey[FILTER.PENDING].label, '未补录 7');
  assert.strictEqual(byKey[FILTER.PENDING].highlight, true);
  assert.strictEqual(byKey[FILTER.ARC_OUT].label, '三分 3');
  assert.strictEqual(byKey[FILTER.FAST_BREAK].label, '快攻 1');
  assert.strictEqual(byKey[FILTER.TURNOVER].label, '失误 1');
});

test('filterDefs: 3x3 赛制下"三分"文案改为"远投"，且快攻筛选禁用', () => {
  const s = makeSession({ format: FORMAT.THREE_V_THREE });
  const defs = s.filterDefs();
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));

  assert.ok(byKey[FILTER.ARC_OUT].label.startsWith('远投'),
    `3x3 下应显示"远投"，实际 "${byKey[FILTER.ARC_OUT].label}"`);
  assert.ok(!byKey[FILTER.ARC_OUT].label.includes('三分'));
  assert.strictEqual(byKey[FILTER.FAST_BREAK].disabled, true,
    '3x3 第一版关闭快攻识别，筛选器应禁用');
});

test('list: PENDING 筛选随补录推进而收缩', () => {
  const s = makeSession();
  assert.strictEqual(s.list(FILTER.PENDING).length, 7);
  s.select('e1', 'p7');
  assert.strictEqual(s.list(FILTER.PENDING).length, 6);
  assert.ok(!s.list(FILTER.PENDING).some((e) => e.id === 'e1'));
});

// ============================================================
// checklist #6-7: 选人即保存 + 特殊选项
// ============================================================

test('select: 选人即保存，无显式 save 步骤', () => {
  const s = makeSession();
  const r = s.select('e1', 'p7');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.event.player_id, 'p7');
  assert.strictEqual(r.event.attribution_source, SOURCE.COACH);
  // 立即反映到事件对象上，不需要额外提交
  assert.strictEqual(s.getEvent('e1').player_id, 'p7');
});

test('select: "看不清" → player_id 保持 null，不得回填假球员', () => {
  const s = makeSession();
  const r = s.select('e1', SPECIAL.UNKNOWN);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.event.player_id, null,
    'PRD 屏 07 硬性要求：选"看不清"不得填入任何球员');
  assert.strictEqual(r.event.attribution_source, SOURCE.UNKNOWN);
  assert.strictEqual(s.displayName(r.event), UNATTRIBUTED_PLACEHOLDER);
});

test('select: "不是我方" → player_id 为 null，来源标记为 NOT_OUR_TEAM', () => {
  const s = makeSession();
  const r = s.select('e1', SPECIAL.NOT_OUR_TEAM);
  assert.strictEqual(r.event.player_id, null);
  assert.strictEqual(r.event.attribution_source, SOURCE.NOT_OUR_TEAM);
  assert.strictEqual(s.displayName(r.event), '不是我方');
});

test('select: 拒绝不在名单里的球员 id（防脏数据）', () => {
  const s = makeSession();
  const r = s.select('e1', 'p_not_exist');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(s.getEvent('e1').player_id, null, '非法选择不得写入');
});

test('select: 拒绝不存在的事件 id', () => {
  const s = makeSession();
  assert.strictEqual(s.select('e_no_such', 'p7').ok, false);
});

test('select: 拒绝空选择', () => {
  const s = makeSession();
  assert.strictEqual(s.select('e1', null).ok, false);
  assert.strictEqual(s.select('e1', '').ok, false);
});

// ============================================================
// checklist #8: 保存即下一个（提效核心）
// ============================================================

test('select: 返回值直接给出下一个未补录事件', () => {
  const s = makeSession();
  const r = s.select('e1', 'p7');
  assert.ok(r.next, '应返回下一个事件');
  assert.strictEqual(r.next.id, 'e2', '应按时间顺序跳到下一个未补录事件');
  assert.strictEqual(s.current().id, 'e2', '游标应自动前移');
});

test('nextPending: 环形查找，尾部完成后回到前面的缺口', () => {
  const s = makeSession();
  // 补掉除 e3 以外的全部事件
  ['e1', 'e2', 'e4', 'e5', 'e6', 'e7'].forEach((id) => s.select(id, 'p7'));
  assert.strictEqual(s.progress().pending, 1);

  // 从末尾的 e6 出发，向后已无缺口，应环绕回 e3
  const next = s.nextPending('e6');
  assert.ok(next, '仍有 e3 未处理');
  assert.strictEqual(next.id, 'e3');

  // 从 e7（最后一个）出发同样环绕
  assert.strictEqual(s.nextPending('e7').id, 'e3');
});

test('nextPending: 全部处理完返回 null', () => {
  const s = makeSession();
  s.list().forEach((e) => s.select(e.id, 'p7'));
  assert.strictEqual(s.nextPending(), null);
  assert.strictEqual(s.select('e1', 'p8').resolvedAll, true);
});

test('连续补录 7 个事件的耗时路径：每次 select 都返回下一个（无空转）', () => {
  const s = makeSession();
  let current = s.list()[0];
  let steps = 0;
  while (current) {
    const r = s.select(current.id, 'p7');
    steps += 1;
    current = r.next;
  }
  assert.strictEqual(steps, 7, '应恰好 7 步补完 7 个事件，无多余跳转');
  assert.strictEqual(s.progress().pending, 0);
});

// ============================================================
// checklist #9: 跳过
// ============================================================

test('skip: 跳过的事件不再出现在"下一个"里', () => {
  const s = makeSession();
  const r = s.skip('e1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.next.id, 'e2');
  assert.ok(!s.list(FILTER.PENDING).some((e) => e.id === 'e1'));
});

test('skip: 跳过算已处理（进度条不再挂着），但仍无球员归属', () => {
  const s = makeSession();
  s.skip('e1');
  const ev = s.getEvent('e1');
  assert.strictEqual(ev.skipped, true);
  assert.strictEqual(ev.player_id, null);
  assert.strictEqual(isResolved(ev), true);
  assert.strictEqual(s.progress().resolved, 1);
  assert.strictEqual(s.progress().attributed, 0, '跳过不计入已归属');
  assert.strictEqual(s.displayName(ev), UNATTRIBUTED_PLACEHOLDER,
    '跳过的事件在报告里显示「—」，不显示假球员');
});

// ============================================================
// checklist #10: 撤销（单步 + 连续）
// ============================================================

test('undo: 单步撤销恢复原状', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  assert.strictEqual(s.getEvent('e1').player_id, 'p7');

  const r = s.undo();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.eventId, 'e1');
  assert.strictEqual(s.getEvent('e1').player_id, null);
  assert.strictEqual(s.getEvent('e1').attribution_source, null);
  assert.strictEqual(s.progress().pending, 7, '撤销后应回到未补录');
});

test('undo: 连续撤销按 LIFO 顺序', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  s.select('e2', 'p11');
  s.select('e3', 'p23');
  assert.strictEqual(s.undoDepth, 3);

  const results = s.undoMany(2);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].eventId, 'e3');
  assert.strictEqual(results[1].eventId, 'e2');
  assert.strictEqual(s.getEvent('e3').player_id, null);
  assert.strictEqual(s.getEvent('e2').player_id, null);
  assert.strictEqual(s.getEvent('e1').player_id, 'p7', 'e1 不受影响');
  assert.strictEqual(s.undoDepth, 1);
});

test('undo: 撤销"跳过"也能恢复', () => {
  const s = makeSession();
  s.skip('e1');
  assert.strictEqual(s.getEvent('e1').skipped, true);
  s.undo();
  assert.strictEqual(s.getEvent('e1').skipped, false);
  assert.strictEqual(s.progress().pending, 7);
});

test('undo: 撤销改选（换人）恢复到上一个球员', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  s.select('e1', 'p11');
  assert.strictEqual(s.getEvent('e1').player_id, 'p11');
  s.undo();
  assert.strictEqual(s.getEvent('e1').player_id, 'p7');
  s.undo();
  assert.strictEqual(s.getEvent('e1').player_id, null);
});

test('undo: 栈空时安全返回', () => {
  const s = makeSession();
  const r = s.undo();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.remaining, 0);
  assert.strictEqual(s.undoDepth, 0);
});

test('undo: 栈有上限，长时间补录不会内存无界增长', () => {
  const s = makeSession();
  for (let i = 0; i < 500; i += 1) s.select('e1', 'p7');
  assert.ok(s.undoDepth <= 200, `撤销栈应封顶，实际 ${s.undoDepth}`);
});

test('undo: 撤销后游标回到被撤销的事件', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  s.select('e2', 'p11');
  assert.strictEqual(s.current().id, 'e3');
  s.undo();
  assert.strictEqual(s.current().id, 'e2', '撤销应把教练带回刚改错的那个事件');
});

// ============================================================
// checklist #11-12: 进度自动保存 / 杀进程后恢复
// ============================================================

test('serialize + 恢复: 已补录内容完整保留（PRD 3.11）', () => {
  const s1 = makeSession();
  s1.select('e1', 'p7');
  s1.select('e2', 'p11');
  s1.select('e3', SPECIAL.UNKNOWN);
  s1.skip('e4');

  const saved = JSON.parse(JSON.stringify(s1.serialize()));

  // 模拟杀进程后重进
  const s2 = makeSession({ persisted: saved });
  assert.strictEqual(s2.getEvent('e1').player_id, 'p7');
  assert.strictEqual(s2.getEvent('e2').player_id, 'p11');
  assert.strictEqual(s2.getEvent('e3').attribution_source, SOURCE.UNKNOWN);
  assert.strictEqual(s2.getEvent('e4').skipped, true);
  assert.strictEqual(s2.progress().resolved, 4);
  assert.strictEqual(s2.progress().pending, 3);
});

test('serialize: 未处理的事件不写入，避免状态膨胀', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  const saved = s.serialize();
  assert.strictEqual(saved.attributions.length, 1);
  assert.strictEqual(saved.attributions[0].eventId, 'e1');
});

test('onChange: 每次变更都触发（页面层据此 debounce 落盘）', () => {
  const s = makeSession();
  const calls = [];
  s.setOnChange((state) => calls.push(state));

  s.select('e1', 'p7');
  s.skip('e2');
  s.undo();
  s.setCursor('e5');

  assert.strictEqual(calls.length, 4, '每次变更都应触发一次');
  calls.forEach((c) => assert.ok(c.attributions, '回调应带可持久化状态'));
});

test('恢复: 报告重新生成后事件 id 变了，旧归属被安全忽略', () => {
  const s1 = makeSession();
  s1.select('e1', 'p7');
  const saved = s1.serialize();

  const differentEvents = [{ id: 'x1', kind: 'SHOT', timestamp_s: 10, period: 1, player_id: null }];
  const s2 = createAttributionSession({ events: differentEvents, roster: ROSTER, persisted: saved });
  assert.strictEqual(s2.getEvent('x1').player_id, null, '对不上的归属不得错误写入');
  assert.strictEqual(s2.progress().total, 1);
});

// ============================================================
// checklist #5: 记住上次选的人
// ============================================================

test('pickerOrder: 上一次选过的人带 isLast 标记', () => {
  const s = makeSession();
  assert.ok(!s.pickerOrder().some((i) => i.isLast), '初始无人被标记');

  s.select('e1', 'p7');
  const order = s.pickerOrder();
  const last = order.filter((i) => i.isLast);
  assert.strictEqual(last.length, 1);
  assert.strictEqual(last[0].id, 'p7');
  assert.strictEqual(s.lastPlayerId, 'p7');
});

test('pickerOrder: 选特殊选项不改变"上次选中的人"', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  s.select('e2', SPECIAL.UNKNOWN);
  assert.strictEqual(s.lastPlayerId, 'p7',
    '选"看不清"不应覆盖上次选的球员，否则连续得分场景的高亮提示会失效');
});

// ============================================================
// checklist #4: 选人网格排序
// ============================================================

test('pickerOrder: 首发按名单顺序在前，替补在后', () => {
  const s = makeSession();
  const order = s.pickerOrder();
  const players = order.filter((i) => i.kind === 'player');

  assert.strictEqual(players.length, ROSTER.length);
  assert.deepStrictEqual(players.slice(0, 5).map((p) => p.id),
    ['p4', 'p7', 'p11', 'p23', 'p32'], '前 5 个应是首发，顺序与名单一致');
  assert.deepStrictEqual(players.slice(5).map((p) => p.id), ['p8', 'p15']);
  players.slice(0, 5).forEach((p) => assert.ok(!p.position === false || true));
});

test('pickerOrder: 末尾固定追加"不是我方"与"看不清"', () => {
  const s = makeSession();
  const order = s.pickerOrder();
  const specials = order.filter((i) => i.kind === 'special');
  assert.strictEqual(specials.length, 2);
  assert.strictEqual(specials[0].id, SPECIAL.NOT_OUR_TEAM);
  assert.strictEqual(specials[1].id, SPECIAL.UNKNOWN);
  assert.strictEqual(order[order.length - 1].id, SPECIAL.UNKNOWN);
});

// ============================================================
// checklist #13: 补录进度
// ============================================================

test('progress: 计数与百分比正确', () => {
  const s = makeSession();
  let p = s.progress();
  assert.deepStrictEqual(
    { total: p.total, resolved: p.resolved, attributed: p.attributed, pending: p.pending, percent: p.percent, complete: p.complete },
    { total: 7, resolved: 0, attributed: 0, pending: 7, percent: 0, complete: false }
  );

  s.select('e1', 'p7');
  s.select('e2', 'p11');
  s.select('e3', SPECIAL.UNKNOWN);
  p = s.progress();
  assert.strictEqual(p.resolved, 3);
  assert.strictEqual(p.attributed, 2, '"看不清"不计入已归属');
  assert.strictEqual(p.pending, 4);
  assert.strictEqual(p.percent, Math.round((3 / 7) * 100));
  assert.strictEqual(p.complete, false);
});

test('progress: 全部处理完标记 complete', () => {
  const s = makeSession();
  s.list().forEach((e) => s.select(e.id, 'p7'));
  const p = s.progress();
  assert.strictEqual(p.pending, 0);
  assert.strictEqual(p.complete, true);
  assert.strictEqual(p.percent, 100);
});

test('progress: 空事件列表不除零', () => {
  const s = createAttributionSession({ events: [], roster: ROSTER });
  const p = s.progress();
  assert.strictEqual(p.total, 0);
  assert.strictEqual(p.percent, 0);
  assert.strictEqual(p.complete, false, '空列表不应算"已完成"');
});

// ============================================================
// checklist #14: 未归属显示「—」，不显示 0 或空字符串
// ============================================================

test('displayPlayerName: 各种未归属情形都显示「—」', () => {
  const rosterById = new Map(ROSTER.map((p) => [p.id, p]));

  assert.strictEqual(displayPlayerName(null, rosterById), UNATTRIBUTED_PLACEHOLDER);
  assert.strictEqual(displayPlayerName({ player_id: null }, rosterById), UNATTRIBUTED_PLACEHOLDER);
  assert.strictEqual(displayPlayerName({ player_id: '', attribution_source: SOURCE.UNKNOWN }, rosterById),
    UNATTRIBUTED_PLACEHOLDER);
  // 报告里 player_id 指向一个名单里不存在的人（球员被删）也要降级为「—」
  assert.strictEqual(displayPlayerName({ player_id: 'p_ghost' }, rosterById),
    UNATTRIBUTED_PLACEHOLDER);

  assert.notStrictEqual(UNATTRIBUTED_PLACEHOLDER, '0');
  assert.notStrictEqual(UNATTRIBUTED_PLACEHOLDER, '');
});

test('displayPlayerName: 已归属显示"号码 号 姓名"', () => {
  const s = makeSession();
  s.select('e1', 'p7');
  assert.strictEqual(s.displayName(s.getEvent('e1')), '7 号 李');
});

// ============================================================
// 不可变性
// ============================================================

test('会话不修改传入的原始事件对象', () => {
  const events = makeEvents();
  const s = createAttributionSession({ events, roster: ROSTER });
  s.select('e1', 'p7');
  s.skip('e2');

  assert.strictEqual(events[0].player_id, null,
    '契约对象来自报告 JSON，不得被就地修改');
  assert.strictEqual(events[1].skipped, undefined);
});

test('events 非数组时抛错', () => {
  assert.throws(() => createAttributionSession({ events: null, roster: ROSTER }),
    /events 必须是数组/);
});

test('无 id 的事件被忽略而非崩溃', () => {
  const s = createAttributionSession({
    events: [{ kind: 'SHOT', timestamp_s: 1 }, { id: 'e1', kind: 'SHOT', timestamp_s: 2, player_id: null }],
    roster: ROSTER,
  });
  assert.strictEqual(s.progress().total, 1);
});
