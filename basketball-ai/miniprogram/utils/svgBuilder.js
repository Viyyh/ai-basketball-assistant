/**
 * 球场 SVG 构建器 —— 服务于 P1-F02 参数化球场底图组件
 *
 * 对应 PRD 4.4 与球队页设计 v0.2 的硬性要求：
 *   球场底图 SVG 必须参数化，接受 format 与 three_point_radius_m 入参。
 *   不能在代码里画死一条 6.75 m 的弧线。
 *
 * 共用范围：报告页热图、阵型页、球员详情投篮分布、对手详情 Tab 1/2。
 *
 * 小程序不能直接 innerHTML 注入 SVG，因此本模块产出完整 SVG 字符串，
 * 由组件层 encodeURIComponent 后作为 <image src="data:image/svg+xml,..."> 渲染。
 */

const { createCourt } = require('./courtGeometry');

/** 视觉样式（与 styles/variables.wxss 的色值保持一致） */
const PALETTE = Object.freeze({
  line: '#94a3b8',
  lineSoft: '#cbd5e1',
  fill: '#f8fafc',
  made: '#16a34a',
  miss: '#dc2626',
  player: '#2563eb',
  opponent: '#f59e0b',
  ball: '#f59e0b',
  heatLow: '#eab308',
  heatMid: '#f59e0b',
  heatHigh: '#ef4444',
});

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 构建球场底图（不含任何数据叠加）。
 *
 * @param {object} params 契约里的 params 段
 * @param {object} [opts] { scale, padding, showCenterLine }
 * @returns {object} { svg, viewBox, width, height, court }
 */
function buildCourtSvg(params, opts = {}) {
  const court = createCourt(params, {
    scale: opts.scale || 20,
    padding: opts.padding != null ? opts.padding : 16,
  });
  const data = court.toRenderData();

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${data.width}" height="${data.height}" fill="${opts.background || PALETTE.fill}"/>`);

  data.paths.forEach((p) => {
    if (!p.d) return;
    const isBoundary = p.role === 'boundary';
    const isThree = p.role === 'threePoint';
    parts.push(
      `<path d="${p.d}" fill="none" stroke="${isThree ? PALETTE.line : PALETTE.lineSoft}" `
      + `stroke-width="${isBoundary || isThree ? 1.6 : 1.2}" `
      + `stroke-linecap="round" stroke-linejoin="round"/>`
    );
  });

  data.circles.forEach((c) => {
    if (!c.r || c.r <= 0) return;
    parts.push(
      `<circle cx="${c.cx.toFixed(2)}" cy="${c.cy.toFixed(2)}" r="${c.r.toFixed(2)}" `
      + `fill="none" stroke="${PALETTE.lineSoft}" stroke-width="1.2"/>`
    );
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${data.viewBox}" `
    + `width="${data.width}" height="${data.height}">${parts.join('')}</svg>`;

  return { svg, viewBox: data.viewBox, width: data.width, height: data.height, court, data };
}

/**
 * 投篮点叠加层。
 *
 * ⚠️ 点的颜色只表示命中/未中，**不表示分值**。
 *    分值文案一律取 event.label_zh（契约硬规则 #2），
 *    本模块不做任何"这个点值几分"的推断。
 *
 * @param {object} court createCourt 实例
 * @param {Array} shots [{x_m, y_m, made, id}]
 * @returns {string} SVG 片段
 */
function buildShotDots(court, shots) {
  if (!Array.isArray(shots) || shots.length === 0) return '';
  return shots
    .filter((s) => s && Number.isFinite(s.x_m) && Number.isFinite(s.y_m))
    .map((s) => {
      const [sx, sy] = court.metersToSvg(s.x_m, s.y_m);
      const color = s.made ? PALETTE.made : PALETTE.miss;
      // 越界点画成空心并加警示描边：说明标定可能有问题，不能静默当成正常数据
      const oob = !court.inBounds(s.x_m, s.y_m);
      return `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${oob ? 3.4 : 2.6}" `
        + `fill="${oob ? 'none' : color}" stroke="${oob ? PALETTE.miss : '#ffffff'}" `
        + `stroke-width="${oob ? 1.6 : 0.9}" data-id="${esc(s.id || '')}"/>`;
    })
    .join('');
}

/**
 * 热区叠加层（核密度近似）。
 *
 * 用若干径向渐变圆叠加近似热区。第一版不做真正的 KDE，
 * 因为 B 级数据不区分个人，精细热区的解读价值有限
 * （PRD 3.3 屏 09：跑动热区默认折叠）。
 *
 * @param {object} court
 * @param {Array} points [{x_m, y_m, weight}]
 * @param {object} [opts] { radiusM, onlyMade }
 */
function buildHeatBlobs(court, points, opts = {}) {
  if (!Array.isArray(points) || points.length === 0) return '';

  const radiusM = opts.radiusM || 1.8;
  const scale = court.config.scale;
  const rPx = radiusM * scale;

  // 简单网格聚合：把点按 1m 网格归并，每格一个热斑，权重为点数
  const cell = 1.0;
  const grid = new Map();
  points.forEach((p) => {
    if (!p || !Number.isFinite(p.x_m) || !Number.isFinite(p.y_m)) return;
    if (!court.inBounds(p.x_m, p.y_m)) return;
    const gx = Math.round(p.x_m / cell);
    const gy = Math.round(p.y_m / cell);
    const key = `${gx}|${gy}`;
    const cur = grid.get(key) || { x: gx * cell, y: gy * cell, w: 0 };
    cur.w += (p.weight != null ? p.weight : 1);
    grid.set(key, cur);
  });

  if (grid.size === 0) return '';
  const maxW = Math.max(...Array.from(grid.values()).map((g) => g.w));

  const defs = [];
  const blobs = [];
  let i = 0;
  grid.forEach((g) => {
    const [sx, sy] = court.metersToSvg(g.x, g.y);
    const t = maxW > 0 ? g.w / maxW : 0;
    const color = t > 0.66 ? PALETTE.heatHigh : (t > 0.33 ? PALETTE.heatMid : PALETTE.heatLow);
    const gid = `hg${i}`;
    defs.push(
      `<radialGradient id="${gid}">`
      + `<stop offset="0%" stop-color="${color}" stop-opacity="${(0.18 + t * 0.45).toFixed(2)}"/>`
      + `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>`
      + `</radialGradient>`
    );
    blobs.push(`<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${rPx.toFixed(2)}" fill="url(#${gid})"/>`);
    i += 1;
  });

  return `<defs>${defs.join('')}</defs>${blobs.join('')}`;
}

/**
 * 阵型叠加层。
 *
 * @param {object} court
 * @param {object} formation 契约里的 formations[] 单项
 * @param {object} [opts] { numbers, showBall, showLabel }
 *
 * ⚠️ formation.label 为 null 时不得显示任何阵型名（PRD 9.2 #2.14）。
 *    本函数不渲染文字标签，标签由页面层根据 label 是否为 null 决定显示与否。
 */
function buildFormation(court, formation, opts = {}) {
  if (!formation || !Array.isArray(formation.positions_m)) return '';

  const expected = court.params.formation_points;
  const positions = formation.positions_m;

  const parts = [];

  // 点数与赛制不符时画警示描边：说明 pipeline 用了错误的 formation_points
  const mismatch = expected != null && positions.length !== expected;

  positions.forEach((pos, idx) => {
    if (!Array.isArray(pos) || pos.length < 2) return;
    const [sx, sy] = court.metersToSvg(pos[0], pos[1]);
    const num = (opts.numbers && opts.numbers[idx]) || '';
    parts.push(
      `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="9" `
      + `fill="${mismatch ? PALETTE.miss : PALETTE.player}" stroke="#ffffff" stroke-width="1.6"/>`
    );
    if (num) {
      parts.push(
        `<text x="${sx.toFixed(2)}" y="${(sy + 3).toFixed(2)}" text-anchor="middle" `
        + `font-size="8" font-weight="600" fill="#ffffff">${esc(num)}</text>`
      );
    }
  });

  if (opts.showBall !== false && Array.isArray(formation.ball_m) && formation.ball_m.length >= 2) {
    const [bx, by] = court.metersToSvg(formation.ball_m[0], formation.ball_m[1]);
    parts.push(`<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="3.2" fill="${PALETTE.ball}"/>`);
  }

  return parts.join('');
}

/**
 * 组装完整 SVG（底图 + 叠加层）。
 *
 * @param {object} params
 * @param {object} layers { shots, heat, formation, formationNumbers }
 * @param {object} [opts]
 * @returns {{svg:string, dataUri:string, court:object, warnings:string[]}}
 */
function buildFullSvg(params, layers = {}, opts = {}) {
  const base = buildCourtSvg(params, opts);
  const court = base.court;
  const warnings = [];

  const overlay = [];
  if (layers.heat && layers.heat.length) {
    overlay.push(buildHeatBlobs(court, layers.heat, opts.heat || {}));
  }
  if (layers.shots && layers.shots.length) {
    overlay.push(buildShotDots(court, layers.shots));
    const oob = layers.shots.filter((s) => s && !court.inBounds(s.x_m, s.y_m));
    if (oob.length) {
      warnings.push(`${oob.length} 个出手点落在场地范围外，可能是标定偏移（PRD 9.2 #2.10）`);
    }
  }
  if (layers.formation) {
    const expected = params.formation_points;
    const got = (layers.formation.positions_m || []).length;
    if (expected != null && got !== expected) {
      warnings.push(`阵型点数 ${got} 与赛制要求 ${expected} 不符`);
    }
    overlay.push(buildFormation(court, layers.formation, opts.formation || {}));
  }

  const inner = base.svg.replace('</svg>', `${overlay.join('')}</svg>`);
  const dataUri = `data:image/svg+xml,${encodeURIComponent(inner)}`;

  return { svg: inner, dataUri, court, warnings, width: base.width, height: base.height, viewBox: base.viewBox };
}

module.exports = {
  PALETTE,
  buildCourtSvg,
  buildShotDots,
  buildHeatBlobs,
  buildFormation,
  buildFullSvg,
};
