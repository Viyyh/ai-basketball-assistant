/**
 * status-tag —— 状态标签（P1-F05）
 *
 * PRD 3.5：状态色语义固定，教练形成条件反射。
 *   橙 = 待处理   绿 = 已完成   蓝 = 进行中   红 = 异常   灰 = 占位/不可用
 *
 * 全站统一用这一个组件，不允许各页面自己写一套颜色。
 */

const LABELS = {
  pending: '待补录',
  processing: '处理中',
  uploading: '上传中',
  done: '已完成',
  failed: '处理失败',
  overdue: '严重逾期',
  placeholder: '内测中',
  incomplete: '数据不完整',
  skipped: '已跳过',
  unknown: '看不清',
  notOurTeam: '不是我方',
};

Component({
  properties: {
    /** 状态键，见 LABELS */
    status: { type: String, value: '' },
    /** 覆盖默认文案 */
    text: { type: String, value: '' },
    /** 尺寸 sm / md */
    size: { type: String, value: 'sm' },
  },

  data: {
    label: '',
    tone: 'muted',
  },

  observers: {
    'status, text': function observe() {
      this._resolve();
    },
  },

  lifetimes: {
    attached() { this._resolve(); },
  },

  methods: {
    _resolve() {
      const s = this.data.status;
      const map = {
        pending: 'warn',
        processing: 'accent',
        uploading: 'accent',
        done: 'ok',
        failed: 'err',
        // 超过 7 天未补录 → 红（PRD 屏 01：卡片变红并置顶）
        overdue: 'err',
        placeholder: 'muted',
        incomplete: 'warn',
        skipped: 'muted',
        unknown: 'muted',
        notOurTeam: 'muted',
      };
      this.setData({
        label: this.data.text || LABELS[s] || s || '',
        tone: map[s] || 'muted',
      });
    },
  },
});
