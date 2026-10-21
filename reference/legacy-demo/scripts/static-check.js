#!/usr/bin/env node
/**
 * 静态完整性检查 —— F 轨交付自检
 *
 * 小程序没有编译器帮我们在提交前发现"页面缺文件""组件路径写错"
 * "wxml 绑了一个 js 里不存在的处理函数"这类问题，只会在真机上白屏或报错。
 * 本脚本在 CI 里跑，把这些低级错误挡在提交之前。
 *
 * 检查项：
 *   1. app.json 里声明的每个页面都存在 4 个文件（js/json/wxml/wxss）
 *   2. 每个页面 json 的 usingComponents 路径都能解析到真实文件
 *   3. tabBar 的 pagePath 都在 pages 列表里
 *   4. wxml 里 bind / catch 绑定的处理函数在对应 js 里存在
 *   5. js 里 require 的本地模块都存在
 *   6. 组件自身也满足 1、2、5
 *   7. wxss 里 @import 的文件存在
 *
 * 运行：node scripts/static-check.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

let errors = [];
let warnings = [];
let checks = 0;

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function ok() { checks += 1; }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail(`JSON 解析失败 ${rel(p)}: ${e.message}`); return null; }
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

function exists(p) { return fs.existsSync(p); }

// ============================================================
// 1. app.json 与页面文件完整性
// ============================================================

const appJsonPath = path.join(MP, 'app.json');
if (!exists(appJsonPath)) {
  console.error('找不到 miniprogram/app.json');
  process.exit(1);
}
const appJson = readJson(appJsonPath);

['app.js', 'app.wxss'].forEach((f) => {
  if (!exists(path.join(MP, f))) fail(`缺少 ${f}`);
  else ok();
});

const pages = (appJson && appJson.pages) || [];
if (!pages.length) fail('app.json 没有声明任何页面');

const pageDirs = new Set();

pages.forEach((route) => {
  const base = path.join(MP, route);
  pageDirs.add(path.dirname(base));

  ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    const f = `${base}.${ext}`;
    if (!exists(f)) fail(`页面 ${route} 缺少 .${ext} 文件`);
    else ok();
  });
});

// ============================================================
// 2. tabBar 一致性
// ============================================================

if (appJson.tabBar && Array.isArray(appJson.tabBar.list)) {
  appJson.tabBar.list.forEach((item) => {
    if (!pages.includes(item.pagePath)) {
      fail(`tabBar 的 ${item.pagePath} 不在 app.json 的 pages 列表里`);
    } else ok();
    if (!item.text) warn(`tabBar ${item.pagePath} 缺少 text`);
  });
} else {
  warn('app.json 没有 tabBar 配置');
}

// ============================================================
// 3. usingComponents 路径可解析
// ============================================================

function checkUsingComponents(jsonPath, ownerLabel) {
  const cfg = readJson(jsonPath);
  if (!cfg) return;
  const uc = cfg.usingComponents || {};

  Object.entries(uc).forEach(([name, ref]) => {
    let target;
    if (ref.startsWith('/')) target = path.join(MP, ref);
    else target = path.resolve(path.dirname(jsonPath), ref);

    if (!exists(`${target}.js`)) {
      fail(`${ownerLabel} 的组件 "${name}" → ${ref} 解析不到 .js`);
    } else if (!exists(`${target}.wxml`)) {
      fail(`${ownerLabel} 的组件 "${name}" → ${ref} 解析不到 .wxml`);
    } else ok();
  });

  // 组件自身必须声明 component: true
  if (cfg.component && !path.dirname(jsonPath).includes('components')) {
    warn(`${ownerLabel} 声明了 component:true 但不在 components 目录下`);
  }
}

pages.forEach((route) => {
  checkUsingComponents(path.join(MP, `${route}.json`), `页面 ${route}`);
});

// ============================================================
// 4. 组件自身完整性
// ============================================================

const compRoot = path.join(MP, 'components');
const components = exists(compRoot)
  ? fs.readdirSync(compRoot).filter((d) => fs.statSync(path.join(compRoot, d)).isDirectory())
  : [];

if (!components.length) fail('components 目录为空');

components.forEach((c) => {
  const base = path.join(compRoot, c, 'index');
  ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    if (!exists(`${base}.${ext}`)) fail(`组件 ${c} 缺少 .${ext}`);
    else ok();
  });
  if (exists(`${base}.json`)) {
    const cfg = readJson(`${base}.json`);
    if (cfg && cfg.component !== true) fail(`组件 ${c} 的 json 缺少 "component": true`);
    else ok();
    checkUsingComponents(`${base}.json`, `组件 ${c}`);
  }
});

// ============================================================
// 5. wxml 事件绑定 → js 处理函数存在性
// ============================================================

const BIND_RE = /(?:bind|catch)(?::)?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g;

function collectHandlers(jsPath) {
  if (!exists(jsPath)) return new Set();
  const src = fs.readFileSync(jsPath, 'utf8');
  const handlers = new Set();

  // Page({...}) / Component({ methods: {...} }) 里的方法名
  // 简单但够用：匹配行首缩进的 `name(` 或 `name: function` 或 `async name(`
  const re = /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) handlers.add(m[1]);

  const re2 = /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function/gm;
  while ((m = re2.exec(src)) !== null) handlers.add(m[1]);

  // Component 的 methods 块缩进更深，再补一轮
  const re3 = /^\s{4,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((m = re3.exec(src)) !== null) handlers.add(m[1]);

  return handlers;
}

function checkBindings(wxmlPath, jsPath, label) {
  if (!exists(wxmlPath)) return;
  const src = fs.readFileSync(wxmlPath, 'utf8');
  const handlers = collectHandlers(jsPath);
  if (!handlers.size) { warn(`${label}: 未能从 js 提取到任何方法名，跳过绑定检查`); return; }

  let m;
  BIND_RE.lastIndex = 0;
  while ((m = BIND_RE.exec(src)) !== null) {
    const fn = m[2].trim();
    if (!fn || fn.includes(' ')) continue;
    if (!handlers.has(fn)) {
      fail(`${label}: wxml 绑定了 ${fn}，但 js 里找不到该方法`);
    } else ok();
  }
}

pages.forEach((route) => {
  checkBindings(path.join(MP, `${route}.wxml`), path.join(MP, `${route}.js`), `页面 ${route}`);
});

components.forEach((c) => {
  const base = path.join(compRoot, c, 'index');
  checkBindings(`${base}.wxml`, `${base}.js`, `组件 ${c}`);
});

// ============================================================
// 6. js 里的本地 require 可解析
// ============================================================

const REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function checkRequires(jsPath, label) {
  if (!exists(jsPath)) return;
  const src = fs.readFileSync(jsPath, 'utf8');
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(src)) !== null) {
    const ref = m[1];
    const target = path.resolve(path.dirname(jsPath), ref);
    if (exists(target) || exists(`${target}.js`) || exists(path.join(target, 'index.js'))) ok();
    else fail(`${label}: require('${ref}') 解析不到文件`);
  }
}

pages.forEach((route) => checkRequires(path.join(MP, `${route}.js`), `页面 ${route}`));
components.forEach((c) => checkRequires(path.join(compRoot, c, 'index.js'), `组件 ${c}`));

['utils', 'mock'].forEach((dir) => {
  const d = path.join(MP, dir);
  if (!exists(d)) return;
  fs.readdirSync(d).filter((f) => f.endsWith('.js')).forEach((f) => {
    checkRequires(path.join(d, f), `${dir}/${f}`);
  });
});

// ============================================================
// 7. wxss @import 可解析
// ============================================================

const IMPORT_RE = /@import\s+["']([^"']+)["']/g;

function checkImports(wxssPath, label) {
  if (!exists(wxssPath)) return;
  const src = fs.readFileSync(wxssPath, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const target = path.resolve(path.dirname(wxssPath), m[1]);
    if (exists(target)) ok();
    else fail(`${label}: @import "${m[1]}" 解析不到文件`);
  }
}

checkImports(path.join(MP, 'app.wxss'), 'app.wxss');
pages.forEach((route) => checkImports(path.join(MP, `${route}.wxss`), `页面 ${route}`));

// ============================================================
// 8. 契约与设计文档要求的专项自检
// ============================================================

// 8.1 前端不得硬编码三分线半径 / 场地尺寸（PRD 4.4 硬约束）
const HARDCODE_PATTERNS = [
  { re: /6\.75/, where: '页面', allow: [] },
  { re: /\b28(\.0)?\s*[*,]?\s*15\b/, where: '页面', allow: [] },
];

function scanHardcode(dir, label) {
  if (!exists(dir)) return;
  const walk = (d) => {
    fs.readdirSync(d).forEach((entry) => {
      const full = path.join(d, entry);
      const st = fs.statSync(full);
      if (st.isDirectory()) { walk(full); return; }
      if (!entry.endsWith('.js')) return;

      const src = fs.readFileSync(full, 'utf8');
      // 只检查页面与组件，utils/mock 是允许持有常量的地方
      const isPageOrComponent = /pages|components/.test(full);
      if (!isPageOrComponent) return;

      HARDCODE_PATTERNS.forEach(({ re }) => {
        // 排除注释行
        const codeOnly = src.split('\n')
          .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
          .join('\n');
        if (re.test(codeOnly)) {
          fail(`${label}/${entry}: 疑似硬编码三分线半径或场地尺寸（${re}）。`
            + '球场几何必须从 params 取值（PRD 4.4）');
        } else ok();
      });
    });
  };
  walk(dir);
}

scanHardcode(path.join(MP, 'pages'), 'pages');
scanHardcode(path.join(MP, 'components'), 'components');

// 8.2 契约硬规则 #3：AI 不得给 player_id 赋猜测值
//
// 合法情形（不告警）：
//   · 赋 null（AI 恒为 null）
//   · 比较运算 === / !== / >= 等
//   · attribution.js：教练补录写入
//   · api.js 的 mergeLocalAttribution：把数据库里的补录结果合并进报告
//     （这正是 PRD 数据流关键点 3 描述的"报告服务合并两个来源"）
const PLAYER_ID_ASSIGN_RE = /player_id\s*=(?!=)(?==?\s*(?!null))/g;
const PLAYER_ID_ALLOWLIST = [/attribution\.js$/, /utils[\\/]api\.js$/];

function scanPlayerIdAssignment(dir) {
  if (!exists(dir)) return;
  const walk = (d) => {
    fs.readdirSync(d).forEach((entry) => {
      const full = path.join(d, entry);
      const st = fs.statSync(full);
      if (st.isDirectory()) { walk(full); return; }
      if (!entry.endsWith('.js')) return;

      const allowed = PLAYER_ID_ALLOWLIST.some((re) => re.test(full));
      const src = fs.readFileSync(full, 'utf8');

      // 去掉注释行再扫，避免文档注释里的示例被误判
      const codeOnly = src.split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n');

      PLAYER_ID_ASSIGN_RE.lastIndex = 0;
      const hit = PLAYER_ID_ASSIGN_RE.exec(codeOnly);
      if (hit && !allowed) {
        fail(`${rel(full)}: 给 player_id 赋了非 null 值，违反契约硬规则 #3`
          + '（AI 不猜归属，只能由教练补录写入）');
      } else ok();
    });
  };
  walk(dir);
}
scanPlayerIdAssignment(path.join(MP, 'utils'));
scanPlayerIdAssignment(path.join(MP, 'pages'));
scanPlayerIdAssignment(path.join(MP, 'components'));
scanPlayerIdAssignment(path.join(MP, 'mock'));

// 8.3 app.json 页面数与实际目录数一致
if (exists(path.join(MP, 'pages'))) {
  const actual = fs.readdirSync(path.join(MP, 'pages'))
    .filter((d) => fs.statSync(path.join(MP, 'pages', d)).isDirectory());
  actual.forEach((d) => {
    if (!pageDirs.has(path.join(MP, 'pages', d))) {
      warn(`pages/${d} 存在但未在 app.json 中注册`);
    }
  });
  if (actual.length !== pages.length) {
    warn(`pages 目录有 ${actual.length} 个，app.json 声明了 ${pages.length} 个`);
  }
  ok();
}

// ============================================================
// 输出
// ============================================================

console.log('='.repeat(68));
console.log('  F 轨静态完整性检查');
console.log('='.repeat(68));
console.log(`  页面 ${pages.length} 个 · 组件 ${components.length} 个`);
console.log(`  通过检查项 ${checks}`);
console.log(`  错误 ${errors.length} · 警告 ${warnings.length}`);

if (warnings.length) {
  console.log('\n警告：');
  warnings.forEach((w) => console.log(`  ! ${w}`));
}

if (errors.length) {
  console.log('\n错误：');
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  console.log('\n检查未通过。');
  process.exit(1);
}

console.log('\n全部通过。');
