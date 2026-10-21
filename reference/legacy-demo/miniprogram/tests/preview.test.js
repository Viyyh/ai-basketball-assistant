/**
 * 预览页冒烟测试
 *
 * preview/index.html 的内联脚本无法被 node --test 直接执行（需要 DOM），
 * 但它承载的渲染逻辑是 F 轨界面的真实呈现层。如果某个 render 函数
 * 引用了不存在的变量，浏览器里会白屏，而这种错误在提交前很难发现。
 *
 * 本测试用最小 DOM stub 执行 index.html 里的内联脚本，
 * 然后逐个调用 SCREENS[*].render() 与 notes()，验证：
 *   · 脚本能完整执行不抛错
 *   · 每个屏的 render() 返回非空 HTML
 *   · 每个屏在全部参数组合下都能渲染（这是关键：3x3 / U12 / 4v4 的分支都要走到）
 *   · 补录交互链路（pick / undo / skip）能跑通
 *   · 渲染结果里不出现被禁止的文案（3x3 下不得有「三分」）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PREVIEW_DIR = path.join(__dirname, '..', 'preview');
const BUNDLE = path.join(PREVIEW_DIR, 'bundle.js');
const HTML = path.join(PREVIEW_DIR, 'index.html');

/** 从 index.html 抽出最后一个 <script> 内联块（预览运行时） */
function extractInlineScript(html) {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 1, 'index.html 里应有内联脚本');
  return blocks[blocks.length - 1][1];
}

/** 最小 DOM stub：只实现预览脚本用到的那部分 */
function makeDom() {
  const elements = {};

  function makeEl(id) {
    return {
      id,
      innerHTML: '',
      textContent: '',
      scrollTop: 0,
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      querySelectorAll: () => [],
      style: {},
      dataset: {},
    };
  }

  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    },
    querySelectorAll: () => [],
    createElement: () => makeEl('tmp'),
  };

  return { document, elements };
}

/** 构建沙箱并执行 bundle + 内联脚本，返回预览运行时 */
function bootPreview() {
  assert.ok(fs.existsSync(BUNDLE),
    'preview/bundle.js 不存在。请先运行：node scripts/build-preview.js');
  assert.ok(fs.existsSync(HTML), 'preview/index.html 不存在');

  const dom = makeDom();
  const timers = [];

  const sandbox = {
    window: null,
    document: dom.document,
    console,
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Math, Date, JSON, Number, String, Array, Object, Boolean, RegExp, Error,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);

  // 1. 执行打包好的真实模块
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'bundle.js' });
  assert.ok(sandbox.BB, 'bundle 应挂载 window.BB');

  // 2. 执行预览运行时
  //
  // 注意：vm 沙箱里 `function` 声明会挂到全局对象，但 `const` / `let` 不会。
  // 预览脚本用 const/let 声明了 SCREENS、COMBOS、SESSION 等内部状态，
  // 所以追加一段仅测试用的暴露代码（用 getter，保证读到的是最新值）。
  // index.html 本身保持干净，不含任何测试专用代码。
  const inline = extractInlineScript(fs.readFileSync(HTML, 'utf8'));
  const epilogue = `
;[
  ['SCREENS', () => SCREENS],
  ['COMBOS', () => COMBOS],
  ['SESSION', () => SESSION],
  ['REPORT', () => REPORT],
  ['PARAMS', () => PARAMS],
  ['ROSTER', () => ROSTER],
  ['currentCombo', () => currentCombo],
  ['currentScreen', () => currentScreen],
  ['P', () => P],
].forEach(([name, get]) => {
  Object.defineProperty(globalThis, name, { get, configurable: true });
});
`;
  vm.runInContext(inline + epilogue, ctx, { filename: 'preview-inline.js' });

  return { sandbox, dom, timers };
}

// ============================================================
// 启动
// ============================================================

test('预览脚本可完整执行且挂载全部真实模块', () => {
  const { sandbox } = bootPreview();

  const BB = sandbox.BB;
  ['params', 'courtGeometry', 'svgBuilder', 'upload', 'attribution',
    'scope', 'format', 'paramsMirror', 'mockReport', 'mockData'].forEach((k) => {
    assert.ok(BB[k], `window.BB 缺少模块 ${k}`);
  });

  // 预览运行时的全局函数应已定义
  ['go', 'pickCombo', 'openSheet', 'pick', 'doUndo', 'doSkip',
    'setFilter', 'setHeatMode', 'setFrame', 'setScope'].forEach((fn) => {
    assert.strictEqual(typeof sandbox[fn], 'function', `预览脚本应定义 ${fn}()`);
  });

  assert.ok(sandbox.SCREENS && Object.keys(sandbox.SCREENS).length >= 8,
    '应注册至少 8 个屏幕');
});

// ============================================================
// 每个屏 × 每个参数组合都要能渲染
// ============================================================

const SCREEN_KEYS = ['home', 'activityNew', 'report', 'events', 'heatmap',
  'formation', 'teamStats', 'routine', 'realtime'];

test('全部屏幕在初始组合下渲染成功', () => {
  const { sandbox } = bootPreview();

  SCREEN_KEYS.forEach((key) => {
    const s = sandbox.SCREENS[key];
    assert.ok(s, `缺少屏幕 ${key}`);

    let html;
    try { html = s.render(); }
    catch (e) { assert.fail(`屏幕 ${key} render() 抛错：${e.message}`); }

    assert.ok(typeof html === 'string' && html.length > 50,
      `屏幕 ${key} 的 render() 应返回非空 HTML，实际长度 ${html ? html.length : 0}`);

    // notes 可以是字符串或函数
    const notes = typeof s.notes === 'function' ? s.notes() : s.notes;
    assert.ok(notes == null || typeof notes === 'string',
      `屏幕 ${key} 的 notes 应是字符串或返回字符串的函数`);
  });
});

test('全部屏幕在全部参数组合下都能渲染（覆盖 3x3 / U12 / 4v4 分支）', () => {
  const { sandbox } = bootPreview();

  sandbox.COMBOS.forEach((combo) => {
    sandbox.pickCombo(combo.key);

    SCREEN_KEYS.forEach((key) => {
      let html;
      try { html = sandbox.SCREENS[key].render(); }
      catch (e) {
        assert.fail(`组合 ${combo.key} 下屏幕 ${key} render() 抛错：${e.message}`);
      }
      assert.ok(typeof html === 'string' && html.length > 50,
        `组合 ${combo.key} 下屏幕 ${key} 渲染结果异常`);
    });
  });
});

// ============================================================
// 参数响应性：切换组合后渲染结果必须真的变
// ============================================================

test('切换参数组合后，热图与报告页的渲染结果不同', () => {
  const { sandbox } = bootPreview();

  sandbox.pickCombo('5V5_SENIOR');
  const seniorHeat = sandbox.SCREENS.heatmap.render();
  const seniorReport = sandbox.SCREENS.report.render();

  sandbox.pickCombo('5V5_U12');
  const u12Heat = sandbox.SCREENS.heatmap.render();

  sandbox.pickCombo('3V3_U15');
  const threeHeat = sandbox.SCREENS.heatmap.render();
  const threeReport = sandbox.SCREENS.report.render();

  assert.notStrictEqual(seniorHeat, u12Heat,
    'U12 与一线的三分线半径不同，热图 SVG 必须不同');
  assert.notStrictEqual(u12Heat, threeHeat,
    '3x3 是半场单框，热图必须不同');
  assert.notStrictEqual(seniorReport, threeReport,
    '3x3 的报告页必须与 5v5 不同');
});

test('3x3 报告页不得出现「三分」字样', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('3V3_U15');

  const html = sandbox.SCREENS.report.render();
  // 允许出现在"报告用「远投」而非「三分」"这类说明里，但指标标签不行
  assert.ok(html.includes('远投'), '3x3 报告应使用「远投」');
  assert.ok(!/>三分</.test(html), '3x3 报告不应把「三分」作为指标标签渲染');

  const heat = sandbox.SCREENS.heatmap.render();
  assert.ok(heat.includes('远投'), '3x3 热图应使用「远投」');
});

test('5v5 报告页使用「三分」', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_SENIOR');
  const html = sandbox.SCREENS.report.render();
  assert.ok(html.includes('三分'), '5v5 报告应使用「三分」');
});

test('3x3 下快攻入口显示为不可用', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('3V3_U15');
  const html = sandbox.SCREENS.report.render();
  assert.ok(html.includes('本赛制不可用') || html.includes('不适用'),
    '3x3 下精彩片段（快攻）入口应标记为不可用');
});

test('3x3 事件筛选器禁用快攻', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('3V3_U15');
  const defs = sandbox.SESSION.filterDefs();
  const fb = defs.find((d) => d.key === 'FAST_BREAK');
  assert.ok(fb, '应有快攻筛选项');
  assert.strictEqual(fb.disabled, true, '3x3 下快攻筛选应禁用');
});

// ============================================================
// 补录交互链路
// ============================================================

test('补录：选人即保存并自动跳下一个（checklist #8）', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('events');

  const before = sandbox.SESSION.progress();
  assert.ok(before.pending > 0, '初始应有待补录事件');

  const first = sandbox.SESSION.list('ALL').find((e) => !sandbox.SESSION.isResolved(e));
  sandbox.openSheet(first.id);
  sandbox.pick('p7');

  const after = sandbox.SESSION.progress();
  assert.strictEqual(after.resolved, before.resolved + 1, '应完成一个事件');
  assert.strictEqual(sandbox.SESSION.getEvent(first.id).player_id, 'p7');
  assert.strictEqual(sandbox.SESSION.getEvent(first.id).attribution_source, 'COACH');
});

test('补录：连续操作直到全部完成', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('events');

  const total = sandbox.SESSION.progress().total;
  let guard = 0;
  while (sandbox.SESSION.progress().pending > 0 && guard < total + 5) {
    const next = sandbox.SESSION.list('ALL').find((e) => !sandbox.SESSION.isResolved(e));
    if (!next) break;
    sandbox.openSheet(next.id);
    sandbox.pick('p7');
    guard += 1;
  }

  const p = sandbox.SESSION.progress();
  assert.strictEqual(p.pending, 0, '应全部补录完成');
  assert.strictEqual(p.complete, true);
  assert.ok(guard <= total, `步数 ${guard} 不应超过事件总数 ${total}（无空转）`);
});

test('补录：撤销可回退', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('events');

  const first = sandbox.SESSION.list('ALL')[0];
  sandbox.openSheet(first.id);
  sandbox.pick('p7');
  assert.strictEqual(sandbox.SESSION.getEvent(first.id).player_id, 'p7');

  sandbox.doUndo();
  const after = sandbox.SESSION.getEvent(first.id);
  assert.strictEqual(after.player_id, null, '撤销后应回到未归属');
});

test('补录：「看不清」不填入任何球员', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('events');

  const first = sandbox.SESSION.list('ALL')[0];
  sandbox.openSheet(first.id);
  sandbox.pick('__unknown__');

  const ev = sandbox.SESSION.getEvent(first.id);
  assert.strictEqual(ev.player_id, null, '选「看不清」不得填入球员');
  assert.strictEqual(ev.attribution_source, 'UNKNOWN');
  assert.strictEqual(sandbox.SESSION.displayName(ev), '—',
    '界面必须显示「—」而不是 0 或空');
});

test('补录：筛选器可切换且不抛错', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('events');

  ['ALL', 'PENDING', 'ARC_OUT', 'FAST_BREAK', 'TURNOVER'].forEach((k) => {
    sandbox.setFilter(k);
    const html = sandbox.SCREENS.events.render();
    assert.ok(html.length > 50, `筛选 ${k} 应能正常渲染`);
  });
});

// ============================================================
// 热图与阵型
// ============================================================

test('热图三种模式都能渲染', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('heatmap');

  ['SHOTS', 'MOVEMENT', 'MADE'].forEach((m) => {
    sandbox.setHeatMode(m);
    const html = sandbox.SCREENS.heatmap.render();
    assert.ok(html.includes('<svg'), `模式 ${m} 应渲染出 SVG 球场`);
  });
});

test('热图渲染出的 SVG 含三分线路径', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_SENIOR');
  sandbox.go('heatmap');
  const html = sandbox.SCREENS.heatmap.render();

  assert.ok(html.includes('<svg'), '应包含 SVG');
  assert.ok(html.includes('<path'), '应包含路径元素');
  assert.ok(html.includes('<circle'), '应包含圆（篮筐/投篮点）');
});

test('阵型页可拖动帧并渲染点位', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('formation');

  const total = sandbox.REPORT.formations.length;
  assert.ok(total > 5, '应有足够多的阵型帧');

  sandbox.setFrame(0);
  let html = sandbox.SCREENS.formation.render();
  assert.ok(html.includes('<svg'), '应渲染球场');

  sandbox.setFrame(Math.floor(total / 2));
  const html2 = sandbox.SCREENS.formation.render();
  assert.notStrictEqual(html, html2, '不同帧应渲染不同内容');

  // 越界帧号应被夹到合法范围而不是崩溃
  sandbox.setFrame(total + 100);
  assert.ok(sandbox.SCREENS.formation.render().includes('<svg'));
});

test('阵型页在低置信度帧显示「未识别」而非编造阵型名', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('formation');

  const frames = sandbox.REPORT.formations;
  const lowConf = frames.findIndex((f) => !f.label || (f.confidence || 0) < 0.6);
  assert.ok(lowConf >= 0, 'Mock 应产出至少一个低置信度帧（PRD 9.2 #2.14）');

  sandbox.setFrame(lowConf);
  const html = sandbox.SCREENS.formation.render();
  assert.ok(html.includes('未识别'), '低置信度帧应显示「未识别」');
  assert.ok(html.includes('不给出阵型名'), '应说明为什么不给出阵型名');
});

// ============================================================
// 球队比赛数据：口径守卫
// ============================================================

test('球队比赛数据页不提供「全部赛制」选项', () => {
  const { sandbox } = bootPreview();
  sandbox.go('teamStats');
  const html = sandbox.SCREENS.teamStats.render();

  assert.ok(!/全部赛制/.test(html) || html.includes('没有「全部」选项'),
    '赛制筛选不应提供「全部赛制」这个可选项');
  assert.ok(html.includes('不可合并'), '应明确标注口径不可合并');
});

test('球队比赛数据页切换口径后数字变化', () => {
  const { sandbox } = bootPreview();
  sandbox.go('teamStats');

  sandbox.setScope('5V5', 'U15');
  const a = sandbox.SCREENS.teamStats.render();

  sandbox.setScope('3V3', 'U15');
  const b = sandbox.SCREENS.teamStats.render();

  assert.notStrictEqual(a, b, '不同口径应产出不同页面');
});

// ============================================================
// 新建活动：联动
// ============================================================

test('新建活动页显示当前组合的真实参数', () => {
  const { sandbox } = bootPreview();
  sandbox.go('activityNew');

  sandbox.pickCombo('5V5_SENIOR');
  let html = sandbox.SCREENS.activityNew.render();
  assert.ok(html.includes('6.75'), '一线应显示 6.75 m 三分线');
  assert.ok(html.includes('24 秒'), '5v5 应显示 24 秒进攻时限');

  sandbox.pickCombo('5V5_U12');
  html = sandbox.SCREENS.activityNew.render();
  assert.ok(html.includes('6.75'), 'U12 与一线同一半径，应显示 6.75 m 三分线');
  assert.ok(!html.includes('5.8'), 'U12 不应再出现 5.80 m 的旧假设');

  sandbox.pickCombo('3V3_U15');
  html = sandbox.SCREENS.activityNew.render();
  assert.ok(html.includes('12 秒'), '3x3 应显示 12 秒进攻时限');
  assert.ok(html.includes('远投'), '3x3 应提示用「远投」');
  assert.ok(html.includes('半场单框'), '3x3 应提示半场单框');
});

test('新建活动页名单格子数随赛制变化', () => {
  const { sandbox } = bootPreview();
  sandbox.go('activityNew');

  sandbox.pickCombo('5V5_U15');
  const five = sandbox.SCREENS.activityNew.render();
  assert.ok(five.includes('/5 人'), '5v5 首发应为 5 人');

  sandbox.pickCombo('3V3_U15');
  const three = sandbox.SCREENS.activityNew.render();
  assert.ok(three.includes('/3 人'), '3x3 首发应为 3 人');
  assert.ok(three.includes('转入替补'), '人数变少时应提示多出的人转入替补且可撤销');
});

test('新建活动页切换年龄段/赛制不抛错', () => {
  const { sandbox } = bootPreview();
  sandbox.go('activityNew');

  Object.values(sandbox.P.AGE_GROUP).forEach((age) => {
    // 只有预设组合能直接切；其余走 toast 提示，不应抛错
    assert.doesNotThrow(() => sandbox.switchAge(age), `切换年龄段 ${age} 抛错`);
  });

  ['5V5', '4V4', '3V3', 'CUSTOM'].forEach((fmt) => {
    assert.doesNotThrow(() => sandbox.switchFormat(fmt), `切换赛制 ${fmt} 抛错`);
  });
});

// ============================================================
// 首页
// ============================================================

test('首页待补录数字与真实进度一致', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');

  const before = sandbox.SESSION.progress().pending;
  sandbox.go('home');
  let html = sandbox.SCREENS.home.render();
  assert.ok(html.includes(`还差 ${before} 个事件`),
    `首页应显示真实待补录数 ${before}`);

  // 补录一个后首页数字应变化
  sandbox.go('events');
  const first = sandbox.SESSION.list('ALL').find((e) => !sandbox.SESSION.isResolved(e));
  sandbox.openSheet(first.id);
  sandbox.pick('p7');

  sandbox.go('home');
  html = sandbox.SCREENS.home.render();
  assert.ok(html.includes(`还差 ${before - 1} 个事件`),
    '补录后首页待补录数应减 1');
});

test('首页补录全部完成后显示已完成卡', () => {
  const { sandbox } = bootPreview();
  sandbox.pickCombo('5V5_U15');
  sandbox.go('events');

  let guard = 0;
  while (sandbox.SESSION.progress().pending > 0 && guard < 200) {
    const next = sandbox.SESSION.list('ALL').find((e) => !sandbox.SESSION.isResolved(e));
    if (!next) break;
    sandbox.openSheet(next.id);
    sandbox.pick('p7');
    guard += 1;
  }

  sandbox.go('home');
  const html = sandbox.SCREENS.home.render();
  assert.ok(html.includes('全部报告已补录完成'), '全部补完应显示绿色已完成卡');
  assert.ok(!html.includes('还差'), '不应再显示待补录提醒');
});

// ============================================================
// 实时占位
// ============================================================

test('实时分析入口是占位页，不含功能', () => {
  const { sandbox } = bootPreview();
  sandbox.go('realtime');
  const html = sandbox.SCREENS.realtime.render();
  assert.ok(html.includes('内测中'));
  assert.ok(html.includes('第一版暂不支持'));
});
