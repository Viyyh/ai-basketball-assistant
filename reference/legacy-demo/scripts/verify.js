#!/usr/bin/env node
/**
 * 一键校验 —— F 轨交付前的完整自检
 *
 * 串起四步，任何一步失败即以非零码退出：
 *   1. 重新生成跨语言一致性基准（Python 参数层 → fixture）
 *   2. Python 参数层测试（PRD 9.1 的 16 条）
 *   3. JS 测试（含跨语言一致性、上传、补录、口径守卫、Mock 忠实度、SVG）
 *   4. 静态完整性检查（页面/组件文件齐全、引用可解析、事件绑定存在、无硬编码几何）
 *
 * 对应开发计划第十七节「定义完成」的第 1、3、4 条：
 *   · 代码通过 CI（ruff + pytest，参数层全绿）
 *   · 不引入硬编码参数
 *   · 不引入跨赛制聚合
 *
 * 运行：node scripts/verify.js
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const PARAMS = path.join(ROOT, 'packages', 'params');

/** Windows 上 Python 通过 py 启动器调用 */
const PY = process.platform === 'win32' ? 'py' : 'python3';

const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function header(title) {
  console.log('');
  console.log('='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function run(cmd, args, opts = {}) {
  // Windows 下 shell:true 会把含空格的命令截断（如 C:\Program Files\nodejs\node.exe），
  // 所以先给命令本身加引号。
  const useShell = process.platform === 'win32';
  const quotedCmd = useShell && /\s/.test(cmd) ? `"${cmd}"` : cmd;

  const res = spawnSync(quotedCmd, args, Object.assign({
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: useShell,
  }, opts));

  if (res.error) {
    console.error(`  无法执行 ${cmd} ${args.join(' ')}：${res.error.message}`);
    return false;
  }
  return res.status === 0;
}

/** 当前 Node 可执行文件路径 */
const NODE = process.execPath;

const results = [];

// ---------- 1. 重新生成基准 ----------
header('第 1 步 · 重新生成跨语言一致性基准');
const fixturePath = path.join(MP, 'tests', 'fixtures', 'params-conformance.json');
const before = fs.existsSync(fixturePath)
  ? fs.statSync(fixturePath).mtimeMs : 0;

const genOk = run(PY, [path.join('scripts', 'gen_conformance_fixture.py')]);
results.push({ step: '生成基准数据', ok: genOk });

if (genOk) {
  const after = fs.existsSync(fixturePath) ? fs.statSync(fixturePath).mtimeMs : 0;
  if (after <= before) {
    console.log('  ⚠ fixture 文件未被更新，请检查生成脚本输出路径');
  } else {
    console.log('  ✓ fixture 已刷新');
  }
}

// ---------- 2. Python 参数层测试 ----------
header('第 2 步 · Python 参数层测试（PRD 9.1 的 16 条）');
const pyOk = run(PY, ['-m', 'unittest', 'discover', '-s', 'tests'], { cwd: PARAMS });
results.push({ step: 'Python 参数层（37 项）', ok: pyOk });

// ---------- 3. JS 测试 ----------
header('第 3 步 · 小程序 JS 测试');
const jsOk = run(NODE, ['--test'], { cwd: MP });
results.push({ step: 'JS 测试（自动发现全部 tests/*.test.js）', ok: jsOk });

// ---------- 4. 静态完整性 ----------
header('第 4 步 · 静态完整性检查');
const staticOk = run(NODE, [path.join('scripts', 'static-check.js')]);
results.push({ step: '静态完整性检查', ok: staticOk });

// ---------- 5. 预览资源 ----------
// bundle.js 由真实模块打包而来，改了 utils/ 或 mock/ 必须重新生成，
// 否则预览页跑的是旧代码 —— 那会让人对着过时的界面做判断。
header('第 5 步 · 重新生成预览资源');
const previewOk = run(NODE, [path.join('scripts', 'build-preview.js')]);
results.push({ step: '预览资源打包', ok: previewOk });

if (previewOk) {
  header('第 6 步 · 预览页冒烟测试');
  const smokeOk = run(NODE, ['--test', 'tests/preview.test.js'], { cwd: MP });
  results.push({ step: '预览页冒烟（25 项）', ok: smokeOk });
}

// ---------- 汇总 ----------
header('校验汇总');
results.forEach((r) => {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.step}`);
});

const allOk = results.every((r) => r.ok);
console.log('');
console.log(allOk
  ? '  全部通过。F 轨可以提交。'
  : '  存在失败项，不得提交（开发计划第十七节：定义完成）。');
console.log('');

process.exit(allOk ? 0 : 1);
