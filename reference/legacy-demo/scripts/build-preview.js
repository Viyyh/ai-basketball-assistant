#!/usr/bin/env node
/**
 * 预览构建器 —— 把小程序的真实代码编译成浏览器可直接运行的形式
 *
 * 为什么不用微信开发者工具：
 *   wxml/wxss 只能在微信运行时里渲染。但 F 轨的核心逻辑
 *   （球场几何、SVG 生成、Mock 报告、补录状态机、口径守卫）
 *   全是纯 CommonJS JS，与小程序运行时无关。
 *
 *   所以这个脚本把这些真实模块打包成浏览器 bundle，
 *   预览页直接调用**生产代码**渲染，而不是另画一套静态假图 ——
 *   看到什么就是真的跑出来什么。
 *
 * 做三件事：
 *   1. 打包 utils/ 与 mock/ 的 JS 模块（带一个极简 require shim）
 *   2. 把 wxss 转成 css（rpx → px，按 750rpx = 375px 视口，即 1rpx = 0.5px）
 *   3. 输出 preview/bundle.js 与 preview/styles.css
 *
 * 运行：node scripts/build-preview.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const OUT = path.join(MP, 'preview');

/** 要打包的模块（相对 miniprogram/）。不含 utils/api.js —— 它依赖 wx.* */
const JS_MODULES = [
  'utils/params.js',
  'utils/courtGeometry.js',
  'utils/svgBuilder.js',
  'utils/upload.js',
  'utils/attribution.js',
  'utils/scope.js',
  'utils/format.js',
  'mock/paramsMirror.js',
  'mock/report.js',
  'mock/data.js',
];

/** 要转换的样式表 */
const WXSS_FILES = [
  'styles/variables.wxss',
  'styles/common.wxss',
];

// ============================================================
// 1. JS 打包
// ============================================================

function bundleJs() {
  const registry = [];

  JS_MODULES.forEach((rel) => {
    const abs = path.join(MP, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`找不到模块 ${rel}`);
    }
    let src = fs.readFileSync(abs, 'utf8');

    // 去掉 CommonJS 的 module.exports 赋值，改成注册到 __exp
    // 保留原样其实也可以（shim 会提供 module 对象），这里直接原样打包
    registry.push({ id: rel, src });
  });

  const modulesJs = registry.map((m) => {
    // 用 JSON.stringify 安全转义源码
    return `  ${JSON.stringify(m.id)}: { src: ${JSON.stringify(m.src)} },`;
  }).join('\n');

  return `/**
 * 由 scripts/build-preview.js 自动生成，请勿手动修改。
 * 打包自 miniprogram/ 的真实模块，预览页调用的是生产代码。
 */
(function (global) {
  'use strict';

  var __defs = {
${modulesJs}
  };

  var __cache = {};

  /** 解析相对 require 路径为模块 id */
  function resolveId(fromId, ref) {
    var base = fromId.split('/').slice(0, -1);
    var parts = ref.split('/');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '.' || p === '') continue;
      if (p === '..') base.pop();
      else base.push(p);
    }
    var id = base.join('/');
    if (!id.endsWith('.js')) id += '.js';
    return id;
  }

  function requireModule(fromId) {
    return function (ref) {
      var id = resolveId(fromId, ref);
      if (__cache[id]) return __cache[id].exports;
      var def = __defs[id];
      if (!def) throw new Error('预览打包缺少模块: ' + id + ' (from ' + fromId + ')');

      var module = { exports: {} };
      __cache[id] = module;

      // 在闭包里执行模块源码，注入 require / module / exports
      var fn = new Function('require', 'module', 'exports', '__dirname', def.src);
      fn(requireModule(id), module, module.exports, id.split('/').slice(0, -1).join('/'));
      return module.exports;
    };
  }

  // 预加载全部模块，确保任何一个报错都能立刻暴露
  Object.keys(__defs).forEach(function (id) {
    try { requireModule('__root__')(('./' + id).replace(/^\\.\\//, './')); }
    catch (e) { /* 首次可能因路径规整失败，下面用规范 id 再试 */ }
  });

  // 用规范 id 再加载一次，保证缓存命中
  Object.keys(__defs).forEach(function (id) {
    if (!__cache[id]) {
      var module = { exports: {} };
      __cache[id] = module;
      var fn = new Function('require', 'module', 'exports', '__dirname', __defs[id].src);
      fn(requireModule(id), module, module.exports, id.split('/').slice(0, -1).join('/'));
    }
  });

  /** 预览页通过 window.BB 访问真实模块 */
  global.BB = {
    params: __cache['utils/params.js'].exports,
    courtGeometry: __cache['utils/courtGeometry.js'].exports,
    svgBuilder: __cache['utils/svgBuilder.js'].exports,
    upload: __cache['utils/upload.js'].exports,
    attribution: __cache['utils/attribution.js'].exports,
    scope: __cache['utils/scope.js'].exports,
    format: __cache['utils/format.js'].exports,
    paramsMirror: __cache['mock/paramsMirror.js'].exports,
    mockReport: __cache['mock/report.js'].exports,
    mockData: __cache['mock/data.js'].exports,
    _cache: __cache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// ============================================================
// 2. wxss → css
// ============================================================

/**
 * rpx 转 px。
 * 小程序里 750rpx = 屏幕宽度；预览用 375px 视口，所以 1rpx = 0.5px。
 */
function rpxToPx(css) {
  return css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${(parseFloat(n) * 0.5).toFixed(3).replace(/\.?0+$/, '')}px`);
}

function convertWxss(src, originName) {
  let css = src;

  // page 选择器 → 预览容器类
  css = css.replace(/^page\s*\{/gm, '.mp-page {');
  css = css.replace(/(^|\n)page\s*,/g, '$1.mp-page,');

  // 小程序专有函数与变量
  css = css.replace(/env\(safe-area-inset-bottom\)/g, '0px');
  css = css.replace(/env\(safe-area-inset-top\)/g, '0px');

  // @import 直接去掉（我们把所有 wxss 拼在一起了）
  css = css.replace(/@import\s+["'][^"']+["'];?/g, '');

  css = rpxToPx(css);

  return `/* ==== ${originName} ==== */\n${css}\n`;
}

function bundleCss() {
  const extra = `
/* ==== 预览专用补充 ==== */
.mp-page {
  background: var(--bg);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.6;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
/* 小程序 button 的默认样式在浏览器里不存在，补一份最小可用样式 */
.mp-page button {
  border: none;
  background: var(--accent);
  color: #fff;
  border-radius: var(--r-md);
  font-size: var(--fs-md);
  padding: var(--sp-2) var(--sp-4);
}
`;

  return WXSS_FILES
    .map((rel) => {
      const abs = path.join(MP, rel);
      if (!fs.existsSync(abs)) throw new Error(`找不到样式 ${rel}`);
      return convertWxss(fs.readFileSync(abs, 'utf8'), rel);
    })
    .join('\n') + extra;
}

// ============================================================
// 主流程
// ============================================================

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const js = bundleJs();
  fs.writeFileSync(path.join(OUT, 'bundle.js'), js, 'utf8');

  const css = bundleCss();
  fs.writeFileSync(path.join(OUT, 'styles.css'), css, 'utf8');

  const jsKb = (Buffer.byteLength(js) / 1024).toFixed(1);
  const cssKb = (Buffer.byteLength(css) / 1024).toFixed(1);

  console.log('预览资源已生成：');
  console.log(`  miniprogram/preview/bundle.js   ${jsKb} KB  · ${JS_MODULES.length} 个真实模块`);
  console.log(`  miniprogram/preview/styles.css  ${cssKb} KB  · ${WXSS_FILES.length} 个样式表`);
  console.log('');
  console.log('用浏览器打开 miniprogram/preview/index.html 查看。');
}

main();
