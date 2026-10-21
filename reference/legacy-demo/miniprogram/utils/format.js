/**
 * 时间与数值格式化 —— 全站统一，禁止各页面自己拼字符串
 *
 * 几条硬规则（来自 PRD 与设计文档）：
 *   · 数据缺失一律显示「—」，不显示 0（PRD 3.6：0 会被误读为"得分为 0"）
 *   · 百分比缺分母时显示「—」，不显示 0% 或 NaN%
 *   · 3x3 下不出现"三分"字样，弧外叫"远投"（契约 x-frontend-consumption-notes）
 */

const { FORMAT, arcInsideLabel, arcOutsideLabel } = require('./params');

/** 秒 → mm:ss 或 h:mm:ss */
function clockTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 秒 → "45 分钟" / "1 小时 5 分" */
function humanDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}

/**
 * 事件时间戳 → "Q1 08:12"（5v5）或 "04:32"（3x3 无节次）
 *
 * @param {number} timestampS
 * @param {Array}  periods 契约里的 periods 段
 * @param {string} format
 */
function eventTimeText(timestampS, periods, format) {
  if (!Number.isFinite(timestampS)) return '—';
  const mmss = clockTime(timestampS);

  // 3x3 单节，不显示节次前缀
  if (format === FORMAT.THREE_V_THREE) return mmss;
  if (!Array.isArray(periods) || periods.length === 0) return mmss;

  const hit = periods.find((p) => timestampS >= p.start_s && timestampS < p.end_s);
  if (!hit) return mmss;

  const inPeriod = timestampS - hit.start_s;
  return `Q${hit.index} ${clockTime(inPeriod)}`;
}

/** 数值，缺失时返回「—」 */
function num(v, digits = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return digits > 0 ? v.toFixed(digits) : String(v);
}

/** 带符号数值（净胜分） */
function signedNum(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = digits > 0 ? v.toFixed(digits) : String(v);
  return v > 0 ? `+${s}` : s;
}

/**
 * 百分比。分母为 0 或缺失时返回「—」，绝不返回 0% 或 NaN%。
 * @param {number} ratio 0~1 的小数
 */
function pct(ratio, digits = 0) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 从分子分母算命中率文本 */
function rate(made, att, digits = 0) {
  if (!att || !Number.isFinite(att) || att <= 0) return '—';
  if (!Number.isFinite(made)) return '—';
  return `${((made / att) * 100).toFixed(digits)}%`;
}

/** "8/22" 形式 */
function madeOverAttempt(made, att) {
  if (!Number.isFinite(made) || !Number.isFinite(att)) return '—';
  return `${made}/${att}`;
}

/** 日期 → "10/09" */
function shortDate(isoDate) {
  if (!isoDate) return '—';
  const m = String(isoDate).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}` : String(isoDate);
}

/** 日期 → "2026年10月9日" */
function longDate(isoDate) {
  if (!isoDate) return '—';
  const m = String(isoDate).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : String(isoDate);
}

/** 距今天数，用于"超 7 天未补录变红"（PRD 屏 01） */
function daysSince(isoDateOrTs, now = Date.now()) {
  if (!isoDateOrTs) return null;
  const t = typeof isoDateOrTs === 'number'
    ? isoDateOrTs
    : new Date(isoDateOrTs).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / (24 * 60 * 60 * 1000));
}

/** 字节 → 人类可读 */
function bytes(v) {
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
  return `${x.toFixed(x >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * 分值文案。
 *
 * ⚠️ 事件级别的分值文案必须用 event.label_zh（契约硬规则 #2）。
 *    本函数只用于表头、图例等没有具体事件的静态文案。
 */
function scoreLabels(format) {
  return { inside: arcInsideLabel(format), outside: arcOutsideLabel(format) };
}

/** 模板中文名 */
function templateLabel(template) {
  return { MATCH: '比赛', SCRIMMAGE: '团队对抗', ROUTINE: '套路演练' }[template] || '活动';
}

/** 活动状态的中文名与语义色 */
function statusMeta(status) {
  const map = {
    draft:        { label: '未录制',   tone: 'muted' },
    recording:    { label: '录制中',   tone: 'accent' },
    uploading:    { label: '上传中',   tone: 'accent' },
    processing:   { label: '处理中',   tone: 'accent' },
    report_ready: { label: '待补录',   tone: 'warn' },
    complete:     { label: '已完成',   tone: 'ok' },
    failed:       { label: '处理失败', tone: 'err' },
  };
  return map[status] || { label: status || '未知', tone: 'muted' };
}

module.exports = {
  clockTime,
  humanDuration,
  eventTimeText,
  num,
  signedNum,
  pct,
  rate,
  madeOverAttempt,
  shortDate,
  longDate,
  daysSince,
  bytes,
  scoreLabels,
  templateLabel,
  statusMeta,
};
