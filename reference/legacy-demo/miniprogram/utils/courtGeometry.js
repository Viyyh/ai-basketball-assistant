/**
 * 球场几何与 SVG 渲染 —— P1-F02 参数化球场底图组件的核心逻辑。
 *
 * ⚠️ 硬约束（PRD 4.4 + 开发计划第十二节硬规则 #2）：
 *
 *   本模块 **只负责渲染与坐标变换**，不负责判定投篮分值。
 *   界面上显示的「三分 / 二分 / 远投(2分) / 近投(1分)」必须直接用
 *   event.label_zh 与 event.shot_value —— 那是后端 CourtGeometry.judge()
 *   产出的，是唯一真源。
 *
 *   本文件里的 behindThreePointLine() 只用于两件事：
 *     1. 与 Python 参数层做跨语言一致性测试（tests/courtGeometry.test.js）
 *     2. 交互辅助（长按热区时提示"此处在弧线外"）
 *   不得用于生成任何要展示给教练的分值文案。
 *
 *   为什么要有这个一致性测试：如果 JS 画的三分线位置与 Python 判定的
 *   分值口径不一致，教练会看到"球明明画在弧线内，却标成三分"——
 *   这正是 PRD 风险 7.4 的界面版。
 *
 * 所有几何参数从入参 params 读取，本文件不含任何三分线半径、
 * 场地尺寸的硬编码常量（球场标线尺寸除外，见 COURT_MARKINGS 说明）。
 */

const { TP_GEOMETRY } = require('./params');

/**
 * 球场标线尺寸（米），FIBA 标准。
 *
 * ⚠️ 这些只影响 **视觉保真度**，不参与任何判定，因此允许作为常量存在。
 *    判定相关的参数（三分线半径、场地长宽、进攻时限、计分值）
 *    一律来自 params，不得在此定义。
 */
const COURT_MARKINGS = Object.freeze({
  keyWidth: 4.9,          // 禁区（三秒区）宽度
  keyLengthFromBaseline: 5.8,  // 底线到罚球线
  freeThrowCircleRadius: 1.8,  // 罚球圈半径
  rimRadius: 0.225,       // 篮筐半径（直径 0.45）
  backboardWidth: 1.8,    // 篮板宽度
  backboardOffsetFromBaseline: 1.2,  // 底线到篮板
  restrictedAreaRadius: 1.30,        // 无撞人半圆区半径（FIBA 2.5.7）
  centerCircleRadius: 1.8,           // 中圈半径
});

/** 默认渲染配置 */
const DEFAULT_RENDER = Object.freeze({
  scale: 20,        // 每米对应的 SVG 单位
  padding: 16,      // 四周留白
  arcSamples: 128,  // 弧线采样点数，越大越平滑
});

/**
 * 从报告 params 构造一个球场几何实例。
 *
 * @param {object} params 契约里的 params 段（见 docs/contract/report-schema.json）
 * @param {object} [render] 渲染配置 { scale, padding, arcSamples }
 */
function createCourt(params, render = {}) {
  if (!params) throw new Error('createCourt: params 不能为空');

  const required = [
    'court_type', 'court_length_m', 'court_width_m',
    'three_point_radius_m', 'three_point_geometry',
  ];
  for (const key of required) {
    if (params[key] === undefined || params[key] === null) {
      throw new Error(`createCourt: params 缺少必填字段 ${key}`);
    }
  }

  const cfg = Object.assign({}, DEFAULT_RENDER, render);

  const lengthM = params.court_length_m;
  const widthM = params.court_width_m;
  const baselineToHoop = params.baseline_to_hoop_m != null ? params.baseline_to_hoop_m : 1.575;
  const tpRadius = params.three_point_radius_m;
  const geometry = params.three_point_geometry;
  const cornerLateral = params.corner_lateral_m != null ? params.corner_lateral_m : null;

  // 坐标范围（米），与 Python CourtGeometry 完全一致
  const xMin = -baselineToHoop;
  const xMax = lengthM - baselineToHoop;
  const yHalf = widthM / 2;

  // SVG 画布尺寸
  const svgW = widthM * cfg.scale + cfg.padding * 2;
  const svgH = lengthM * cfg.scale + cfg.padding * 2;

  // 底角直线与弧线的交接点 x（仅 ARC_AND_CORNERS 有意义）
  let cornerJunctionX = null;
  if (params.corner_junction_x_m != null) {
    cornerJunctionX = params.corner_junction_x_m;
  } else if (geometry === TP_GEOMETRY.ARC_AND_CORNERS
             && cornerLateral != null
             && tpRadius > cornerLateral) {
    cornerJunctionX = Math.sqrt(tpRadius * tpRadius - cornerLateral * cornerLateral);
  }

  // ---------- 坐标变换 ----------

  /**
   * 米制坐标 → SVG 坐标。
   * 布局：篮筐在上方，球场向下延伸（投篮图标准朝向）。
   *   sx = padding + (y + yHalf) * scale      横向
   *   sy = padding + (x - xMin) * scale       纵向（底线在顶部）
   */
  function metersToSvg(xM, yM) {
    return [
      cfg.padding + (yM + yHalf) * cfg.scale,
      cfg.padding + (xM - xMin) * cfg.scale,
    ];
  }

  /** SVG 坐标 → 米制坐标（交互用：长按取点） */
  function svgToMeters(sx, sy) {
    return [
      (sy - cfg.padding) / cfg.scale + xMin,
      (sx - cfg.padding) / cfg.scale - yHalf,
    ];
  }

  /** 篮筐中心的 SVG 坐标 */
  const hoopSvg = metersToSvg(0, 0);

  // ---------- 边界与判定 ----------

  const EPS = 1e-6;

  /** 坐标是否在场地内。越界说明标定有问题，应告警而非静默采纳 */
  function inBounds(xM, yM) {
    return xM >= xMin - EPS && xM <= xMax + EPS && Math.abs(yM) <= yHalf + EPS;
  }

  /**
   * 是否在三分线外。
   *
   * ⚠️ 仅用于一致性测试与交互提示，**不得用于生成分值文案**（见文件头）。
   *
   * 两种几何分别处理，逻辑与 Python court.py 的 behind_three_point_line 严格对应：
   *   PURE_ARC        → distance > radius
   *   ARC_AND_CORNERS → (|y| > cornerLateral && x < junctionX) || distance > radius
   *   FIBA 2.5.4：三分线本身不属于三分中篮区域 —— 恰好踩线算两分，故一律严格大于。
   */
  function behindThreePointLine(xM, yM) {
    const dist = Math.hypot(xM, yM);

    if (geometry === TP_GEOMETRY.PURE_ARC) {
      return dist > tpRadius;
    }

    if (geometry === TP_GEOMETRY.ARC_AND_CORNERS) {
      if (cornerLateral == null) {
        throw new Error('ARC_AND_CORNERS 几何必须提供 corner_lateral_m');
      }
      if (cornerJunctionX != null
          && Math.abs(yM) > cornerLateral
          && xM < cornerJunctionX) {
        return true;
      }
      return dist > tpRadius;
    }

    throw new Error(`未知的三分线几何：${geometry}`);
  }

  /**
   * 完整判定一次出手。
   *
   * ⚠️ 使用范围限制（契约硬规则 #2）：
   *   生产环境下，界面上显示的分值文案必须直接取 event.label_zh 与
   *   event.shot_value —— 那是后端 CourtGeometry.judge() 的产出，是唯一真源。
   *   前端不得用本函数重新判定后覆盖显示值。
   *
   *   本函数的合法用途只有两个：
   *     1. mock/report.js 模拟后端产出契约字段（此时它就"是"后端）
   *     2. tests/ 里验证前端几何理解与 Python 一致
   *
   * @param {{x_m:number, y_m:number, made:boolean}} shot
   * @returns {{shot:object, distance_m:number, behind_three_point_line:boolean,
   *            points_if_made:number, points_awarded:number, label_zh:string,
   *            in_bounds:boolean, geometry:string, made:boolean}}
   */
  function judge(shot) {
    if (!shot || !Number.isFinite(shot.x_m) || !Number.isFinite(shot.y_m)) {
      throw new Error('judge: shot 必须含有限的 x_m / y_m');
    }

    const behind = behindThreePointLine(shot.x_m, shot.y_m);
    const made = !!shot.made;

    const inside = params.inside_arc_points;
    const outside = params.outside_arc_points;
    if (inside == null || outside == null) {
      throw new Error('judge: params 缺少 inside_arc_points / outside_arc_points');
    }

    const points = behind ? outside : inside;

    return {
      shot,
      distance_m: Math.round(Math.hypot(shot.x_m, shot.y_m) * 1000) / 1000,
      behind_three_point_line: behind,
      points_if_made: points,
      points_awarded: made ? points : 0,
      label_zh: behind ? arcOutsideLabel() : arcInsideLabel(),
      in_bounds: inBounds(shot.x_m, shot.y_m),
      geometry,
      made,
    };
  }

  /**
   * 弧外得分的界面文案。
   *
   * 3x3 不能叫"三分"——它只值 2 分，叫三分会让教练困惑
   * （契约 x-frontend-consumption-notes）。
   */
  function arcOutsideLabel() {
    return params.format === '3V3' ? '远投(2分)' : '三分';
  }

  /** 弧内得分的界面文案 */
  function arcInsideLabel() {
    return params.format === '3V3' ? '近投(1分)' : '二分';
  }

  // ---------- SVG 路径生成 ----------

  const fmt = (n) => {
    const r = Math.round(n * 1000) / 1000;
    return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  };

  function pt(xM, yM) {
    const [sx, sy] = metersToSvg(xM, yM);
    return `${fmt(sx)},${fmt(sy)}`;
  }

  /**
   * 采样生成弧线路径（折线逼近）。
   *
   * 不用 SVG 的 A 命令，因为 large-arc / sweep 两个 flag 在
   * y 轴向下的坐标系里极易搞反，出错后表现为"弧线画到另一侧"，
   * 肉眼很难第一时间发现。密集采样折线永远正确，128 段视觉上完全平滑。
   *
   * @param {number} radius 弧线半径（米）
   * @param {number} thetaFrom 起始角（弧度，court 坐标系，+x 为 0）
   * @param {number} thetaTo   结束角（弧度）
   * @returns {string} SVG path 的 d 属性
   */
  function arcPath(radius, thetaFrom, thetaTo) {
    const steps = Math.max(8, Math.ceil(cfg.arcSamples * Math.abs(thetaTo - thetaFrom) / Math.PI));
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = thetaFrom + ((thetaTo - thetaFrom) * i) / steps;
      const x = radius * Math.cos(t);
      const y = radius * Math.sin(t);
      // 裁掉超出场地范围的部分（3x3 的 6.75 弧会超出 ±5.5 的边线）
      if (x < xMin - EPS) continue;
      if (Math.abs(y) > yHalf + EPS) continue;
      pts.push(pt(x, y));
    }
    if (pts.length < 2) return '';
    return `M ${pts.join(' L ')}`;
  }

  /**
   * 三分线路径。
   *
   * PURE_ARC：
   *   弧线被场地边界裁剪。有效角范围由两个约束共同决定：
   *     x >= xMin  → |θ| <= acos(xMin / R)
   *     |y| <= yHalf → |θ| <= asin(yHalf / R)（当 yHalf < R 时）
   *
   * ARC_AND_CORNERS（FIBA 成人 5v5）：
   *   底角直线（|y| = cornerLateral，从底线到交接点）+ 弧线（交接到交接）
   */
  function threePointPath() {
    if (geometry === TP_GEOMETRY.ARC_AND_CORNERS && cornerLateral != null && cornerJunctionX != null) {
      const thetaStart = Math.atan2(-cornerLateral, cornerJunctionX);
      const thetaEnd = Math.atan2(cornerLateral, cornerJunctionX);
      const arc = arcPath(tpRadius, thetaStart, thetaEnd);

      // 底角直线段：从底线到交接点，两侧各一条
      const leftStraight = `M ${pt(xMin, -cornerLateral)} L ${pt(cornerJunctionX, -cornerLateral)}`;
      const rightStraight = `M ${pt(cornerJunctionX, cornerLateral)} L ${pt(xMin, cornerLateral)}`;

      return [leftStraight, arc, rightStraight].filter(Boolean).join(' ');
    }

    // PURE_ARC
    let thetaMax = Math.PI;
    if (Math.abs(xMin) < tpRadius) {
      thetaMax = Math.acos(xMin / tpRadius);   // xMin 为负 → 结果在 (90°, 180°)
    }
    if (yHalf < tpRadius) {
      const sideLimit = Math.asin(yHalf / tpRadius);
      thetaMax = Math.min(thetaMax, sideLimit);
    }
    return arcPath(tpRadius, -thetaMax, thetaMax);
  }

  /** 禁区（三秒区）路径，指定篮筐所在的 x 偏移（全场要画两端） */
  function keyPath(hoopX) {
    const m = COURT_MARKINGS;
    const baselineX = hoopX - baselineToHoop;
    const ftLineX = baselineX + m.keyLengthFromBaseline;
    const halfKey = m.keyWidth / 2;
    return `M ${pt(baselineX, -halfKey)} L ${pt(ftLineX, -halfKey)} `
         + `L ${pt(ftLineX, halfKey)} L ${pt(baselineX, halfKey)}`;
  }

  /** 罚球圈路径 */
  function freeThrowCirclePath(hoopX) {
    const m = COURT_MARKINGS;
    const baselineX = hoopX - baselineToHoop;
    const centerX = baselineX + m.keyLengthFromBaseline;
    const [cx, cy] = metersToSvg(centerX, 0);
    const r = m.freeThrowCircleRadius * cfg.scale;
    return { cx, cy, r };
  }

  /** 合理冲撞区弧 */
  function restrictedAreaPath(hoopX) {
    const m = COURT_MARKINGS;
    const thetaMax = Math.PI / 2;
    const steps = 32;
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = -thetaMax + (2 * thetaMax * i) / steps;
      const x = hoopX + m.restrictedAreaRadius * Math.cos(t);
      const y = m.restrictedAreaRadius * Math.sin(t);
      pts.push(pt(x, y));
    }
    return `M ${pts.join(' L ')}`;
  }

  /** 篮板 */
  function backboardPath(hoopX) {
    const m = COURT_MARKINGS;
    const bbX = hoopX - baselineToHoop + m.backboardOffsetFromBaseline;
    const half = m.backboardWidth / 2;
    return `M ${pt(bbX, -half)} L ${pt(bbX, half)}`;
  }

  /**
   * 生成完整的球场底图 SVG 元素清单。
   *
   * 返回结构化数据而非 SVG 字符串，因为小程序端不能直接 innerHTML，
   * 需要用 <view> + 绝对定位或 canvas 绘制。组件层再决定怎么渲染。
   *
   * @returns {object} { viewBox, paths: [...], circles: [...], hoop, meta }
   */
  function toRenderData() {
    const isFull = params.court_type === 'FULL';
    // 全场有两个篮框：本方进攻的在 x=0，另一端在 x = length - 2*baselineToHoop
    const hoopXs = isFull ? [0, lengthM - 2 * baselineToHoop] : [0];

    const paths = [];
    const circles = [];

    // 外边框
    paths.push({
      id: 'boundary',
      d: `M ${pt(xMin, -yHalf)} L ${pt(xMax, -yHalf)} L ${pt(xMax, yHalf)} `
       + `L ${pt(xMin, yHalf)} Z`,
      role: 'boundary',
    });

    // 每端的禁区、罚球圈、合理冲撞区、篮板、篮筐
    hoopXs.forEach((hx, idx) => {
      paths.push({ id: `key-${idx}`, d: keyPath(hx), role: 'key' });
      paths.push({ id: `restricted-${idx}`, d: restrictedAreaPath(hx), role: 'restricted' });
      paths.push({ id: `backboard-${idx}`, d: backboardPath(hx), role: 'backboard' });

      const ft = freeThrowCirclePath(hx);
      circles.push({ id: `ft-circle-${idx}`, cx: ft.cx, cy: ft.cy, r: ft.r, role: 'freeThrow' });

      const [hxSvg, hySvg] = metersToSvg(hx, 0);
      circles.push({
        id: `rim-${idx}`, cx: hxSvg, cy: hySvg,
        r: COURT_MARKINGS.rimRadius * cfg.scale, role: 'rim',
      });
    });

    // 全场：中线与中圈
    if (isFull) {
      const midX = lengthM / 2 - baselineToHoop;
      paths.push({
        id: 'halfcourt-line',
        d: `M ${pt(midX, -yHalf)} L ${pt(midX, yHalf)}`,
        role: 'halfcourt',
      });
      const [cx, cy] = metersToSvg(midX, 0);
      circles.push({
        id: 'center-circle', cx, cy,
        r: COURT_MARKINGS.centerCircleRadius * cfg.scale, role: 'centerCircle',
      });
    }

    // 三分线（本方进攻端）
    paths.push({ id: 'three-point-line', d: threePointPath(), role: 'threePoint' });

    return {
      viewBox: `0 0 ${fmt(svgW)} ${fmt(svgH)}`,
      width: svgW,
      height: svgH,
      paths,
      circles,
      hoop: { x: hoopSvg[0], y: hoopSvg[1] },
      meta: {
        courtType: params.court_type,
        geometry,
        threePointRadiusM: tpRadius,
        cornerLateralM: cornerLateral,
        cornerJunctionXM: cornerJunctionX,
        hoopCount: params.hoop_count != null ? params.hoop_count : hoopXs.length,
        hoopXs,
        xRangeM: [xMin, xMax],
        yHalfM: yHalf,
        scale: cfg.scale,
        padding: cfg.padding,
      },
    };
  }

  return {
    params,
    config: cfg,
    xMin,
    xMax,
    yHalf,
    cornerJunctionX,
    metersToSvg,
    svgToMeters,
    inBounds,
    behindThreePointLine,
    judge,
    arcOutsideLabel,
    arcInsideLabel,
    threePointPath,
    toRenderData,
  };
}

module.exports = {
  COURT_MARKINGS,
  DEFAULT_RENDER,
  createCourt,
};
