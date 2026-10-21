/**
 * court-svg —— 参数化球场底图组件（P1-F02）
 *
 * PRD 4.4：必须抽象成公用组件，四个地方共用
 *   · 报告页热图（屏 09）
 *   · 阵型页（屏 08）
 *   · 球员详情投篮分布（球队页屏 04）
 *   · 对手详情 Tab 1/2（球队页屏 08）
 *
 * ⚠️ 硬约束：本组件不得包含任何三分线半径、场地尺寸的硬编码。
 *    所有几何来自 properties.params（契约 params 段）。
 *    tests/conformance.test.js 验证 JS 侧几何与 Python 参数层逐点一致。
 */

const { buildFullSvg } = require('../../utils/svgBuilder');
const { scopeLabelFromParams } = require('../../utils/params');

Component({
  options: { pureDataPattern: /^_/ },

  properties: {
    /** 契约里的 params 段。必填，缺失时组件拒绝渲染 */
    params: { type: Object, value: null },
    /** 投篮点 [{x_m, y_m, made, id}] */
    shots: { type: Array, value: [] },
    /** 热区点 [{x_m, y_m, weight}] */
    heat: { type: Array, value: [] },
    /** 单个阵型快照 */
    formation: { type: Object, value: null },
    /** 阵型点位显示的号码 */
    numbers: { type: Array, value: [] },
    /** 渲染比例（每米多少 SVG 单位） */
    scale: { type: Number, value: 20 },
    /** 是否显示口径角标（PRD 9.4 #4.8） */
    showScope: { type: Boolean, value: true },
    /** 高度（rpx），宽度按场地比例自适应 */
    height: { type: Number, value: 460 },
  },

  data: {
    dataUri: '',
    scopeText: '',
    ratio: 1,
    errorText: '',
    warnings: [],
  },

  observers: {
    'params, shots, heat, formation, numbers, scale': function observe() {
      this.render();
    },
  },

  lifetimes: {
    attached() { this.render(); },
  },

  methods: {
    render() {
      const { params, shots, heat, formation, numbers, scale } = this.data;

      if (!params) {
        this.setData({
          dataUri: '',
          errorText: '缺少参数，无法渲染球场',
          warnings: [],
        });
        return;
      }

      // 参数自检：宁可拒绝渲染，也不要画出一张几何错误的场地图。
      // 这是 PRD 风险 7.4 在界面层的最后一道防线。
      const problem = this._validate(params);
      if (problem) {
        this.setData({ dataUri: '', errorText: problem, warnings: [] });
        this.triggerEvent('invalid', { reason: problem });
        return;
      }

      try {
        const result = buildFullSvg(params, {
          shots: shots || [],
          heat: heat || [],
          formation: formation || null,
        }, {
          scale,
          formation: { numbers: numbers || [], showBall: true },
        });

        this.setData({
          dataUri: result.dataUri,
          errorText: '',
          warnings: result.warnings,
          scopeText: scopeLabelFromParams(params),
          ratio: result.width / result.height,
        });

        this.triggerEvent('render', {
          warnings: result.warnings,
          viewBox: result.viewBox,
        });
      } catch (e) {
        this.setData({ dataUri: '', errorText: `渲染失败：${e.message}`, warnings: [] });
        this.triggerEvent('invalid', { reason: e.message });
      }
    },

    /**
     * 渲染前的参数自检。
     *
     * 与 Python 侧 validate_params_for_pipeline() 的几何部分保持一致，
     * 重点拦住"底角直线落在弧线内侧"这种会产生错误图形但不报错的配置。
     */
    _validate(p) {
      if (!p.court_type) return 'params 缺少 court_type';
      if (!p.court_length_m || !p.court_width_m) return 'params 缺少场地尺寸';
      if (!p.three_point_radius_m) return 'params 缺少三分线半径';
      if (!p.three_point_geometry) return 'params 缺少三分线几何类型';

      if (p.three_point_geometry === 'ARC_AND_CORNERS') {
        if (p.corner_lateral_m == null) return '弧线+底角几何缺少 corner_lateral_m';
        if (p.three_point_radius_m <= p.corner_lateral_m) {
          return `几何矛盾：弧线半径 ${p.three_point_radius_m}m ≤ 底角横向 ${p.corner_lateral_m}m，`
               + '底角直线会落在弧线内侧。应退化为纯弧线';
        }
      }

      if (p.format === '3V3' && p.court_type !== 'HALF') {
        return '3对3 必须是半场场地';
      }
      if (p.format === '5V5' && p.court_type !== 'FULL') {
        return '5对5 应为全场场地';
      }

      return null;
    },

    /** 交互：长按取点（PRD 3.4「长按点位 = 触发片段」） */
    onTapCourt(e) {
      if (!this.data.dataUri) return;
      // 小程序 image 组件拿不到内部坐标，长按由页面层结合布局尺寸换算。
      // 这里只把点击事件透传出去，换算逻辑在 utils/courtGeometry 的 svgToMeters。
      this.triggerEvent('courttap', { detail: e.detail });
    },
  },
});
