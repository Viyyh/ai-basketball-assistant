/**
 * 分片上传与断点续传 —— P2-F02
 *
 * 验收对应 PRD 9.3：
 *   #3.1 40 分钟 1080p 上传成功率 ≥ 95%
 *   #3.2 中断 3 次内仍能完成，已传分片不重传
 *   #3.3 小程序切后台 ≥ 10 分钟上传不中断
 *
 * 以及界面设计 v0.1.1 屏 04 的两条注释：
 *   · 剩余时间用「滚动 30 秒平均速率」计算，不用整体平均
 *     （4G 网络波动大，整体平均会让估算跳变）
 *   · 「取消」不是删除：只中止上传，本地视频保留 24 小时
 *
 * 设计：纯逻辑（分片计划、断点、速率估算）与 IO（wx.uploadFile）分离。
 * 纯逻辑部分可脱离小程序运行时做单元测试，见 tests/upload.test.js。
 */

/** 默认分片大小：8 MB（对应范围确认 v0.2 屏 04 注释） */
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

/** 滚动速率窗口：30 秒 */
const RATE_WINDOW_MS = 30 * 1000;

/** 取消后本地文件保留时长：24 小时 */
const LOCAL_RETENTION_MS = 24 * 60 * 60 * 1000;

/** 单分片最大重试次数 */
const MAX_CHUNK_RETRY = 3;

/**
 * 计算分片计划。
 *
 * @param {number} fileSize 文件总字节数
 * @param {number} [chunkSize] 分片大小
 * @returns {Array<{index:number, start:number, end:number, size:number}>}
 *          end 为独占边界（与 File.slice / wx 的 readFile 位置区间一致）
 */
function planChunks(fileSize, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error(`planChunks: 非法文件大小 ${fileSize}`);
  }
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error(`planChunks: 非法分片大小 ${chunkSize}`);
  }

  const chunks = [];
  let index = 0;
  for (let start = 0; start < fileSize; start += chunkSize) {
    const end = Math.min(start + chunkSize, fileSize);
    chunks.push({ index, start, end, size: end - start });
    index += 1;
  }
  return chunks;
}

/**
 * 滚动窗口速率估算器。
 *
 * 只保留最近 RATE_WINDOW_MS 内的样本，用 (末样本累计字节 - 首样本累计字节)
 * / 时间差 得到速率。样本不足或时间差过小时返回 null（界面显示"计算中"）。
 */
function createRateEstimator(windowMs = RATE_WINDOW_MS) {
  /** @type {Array<{t:number, bytes:number}>} */
  let samples = [];

  /**
   * 记录一个累计字节数样本，并裁剪掉窗口外的旧样本。
   *
   * 裁剪规则（这是"滚动"而非"整体平均"的关键）：
   *   1. 只保留 t >= cutoff 的窗口内样本
   *   2. 若窗口内样本不足 2 个（无法算差值），
   *      才往前多保留一个最近的外部样本作为左锚点
   *
   * 早期实现无条件保留"窗口外最近一个样本"作为锚点，
   * 会让 40 秒前的慢速数据一直稀释当前速率 —— 那就退化成了
   * 带衰减的整体平均，界面设计 v0.1.1 屏 04 明确要求的
   * "滚动 30 秒平均"就落空了。
   */
  function push(bytes, now = Date.now()) {
    samples.push({ t: now, bytes });
    const cutoff = now - windowMs;

    const firstInWindow = samples.findIndex((s) => s.t >= cutoff);

    if (firstInWindow < 0) {
      // 全部样本都在窗口外（长时间没上传），只留最后一个
      samples = samples.slice(-1);
      return;
    }
    if (firstInWindow === 0) return;   // 无需裁剪

    // 窗口内已有 ≥2 个样本时，外部锚点可以安全丢弃
    const inWindowCount = samples.length - firstInWindow;
    const keepFrom = inWindowCount >= 2 ? firstInWindow : firstInWindow - 1;
    if (keepFrom > 0) samples = samples.slice(keepFrom);
  }

  function rate(now = Date.now()) {
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return null;
    const db = last.bytes - first.bytes;
    if (db <= 0) return 0;
    return db / (dt / 1000);   // bytes / s
  }

  function reset() { samples = []; }

  return {
    push,
    rate,
    reset,
    get sampleCount() { return samples.length; },
    get windowMs() { return windowMs; },
  };
}

/** 格式化字节数 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** 格式化秒数为 mm:ss 或 h:mm:ss */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 上传会话状态机（纯逻辑，不做 IO）。
 *
 * 持久化契约：state 对象可 JSON 序列化，用于存到 wx.setStorage，
 * 小程序被杀 / 断网 / 切后台后重新进入时恢复。
 *
 * 状态流转：
 *   idle → uploading → (paused ⇄ uploading) → done
 *                    ↘ failed（分片重试耗尽）
 *                    ↘ cancelled（用户取消，本地文件保留 24h）
 */
function createUploadSession({
  activityId,
  filePath,
  fileSize,
  chunkSize = DEFAULT_CHUNK_SIZE,
  persisted = null,
  now = () => Date.now(),
}) {
  if (!activityId) throw new Error('createUploadSession: 缺少 activityId');
  if (!filePath) throw new Error('createUploadSession: 缺少 filePath');

  const chunks = planChunks(fileSize, chunkSize);

  /** @type {Set<number>} 已上传成功的分片索引 */
  const uploaded = new Set();
  /** @type {Map<number, number>} 分片索引 → 已重试次数 */
  const retries = new Map();

  let status = 'idle';
  let startedAt = null;
  let finishedAt = null;
  let cancelRequested = false;
  let localFileExpireAt = null;

  const estimator = createRateEstimator();

  // ---------- 恢复 ----------

  /**
   * 从持久化状态恢复。
   *
   * 关键约束（PRD 3.2）：已上传的分片绝不重传。
   * 恢复时会校验 fileSize / chunkSize / activityId 是否一致，
   * 不一致则丢弃旧状态重新开始——避免用错分片计划导致文件损坏。
   */
  if (persisted) {
    const compatible = persisted.activityId === activityId
      && persisted.fileSize === fileSize
      && persisted.chunkSize === chunkSize
      && persisted.totalChunks === chunks.length;

    if (compatible && Array.isArray(persisted.uploadedIndices)) {
      persisted.uploadedIndices.forEach((i) => {
        if (Number.isInteger(i) && i >= 0 && i < chunks.length) uploaded.add(i);
      });
      status = 'uploading';
      startedAt = persisted.startedAt || now();
    }
    // 不兼容则静默重新开始，但保留 localFileExpireAt 以便清理
    if (persisted.localFileExpireAt) localFileExpireAt = persisted.localFileExpireAt;
  }

  // ---------- 查询 ----------

  function uploadedBytes() {
    let sum = 0;
    uploaded.forEach((i) => { sum += chunks[i].size; });
    return sum;
  }

  function progress() {
    const done = uploadedBytes();
    return {
      uploadedBytes: done,
      totalBytes: fileSize,
      percent: fileSize > 0 ? Math.min(100, Math.floor((done / fileSize) * 100)) : 0,
      uploadedChunks: uploaded.size,
      totalChunks: chunks.length,
    };
  }

  /**
   * 剩余时间估算。
   *
   * 用滚动 30 秒窗口速率，不用整体平均（界面设计 v0.1.1 屏 04 注释）。
   * 速率不稳定时返回 { unstable: true }，界面应显示"网络波动中，估算可能不准"。
   */
  function eta(currentNow = now()) {
    const r = estimator.rate(currentNow);
    if (r == null) return { seconds: null, rate: null, unstable: false, reason: 'warming-up' };
    if (r <= 0) return { seconds: null, rate: 0, unstable: true, reason: 'stalled' };

    const remaining = fileSize - uploadedBytes();
    const seconds = remaining / r;

    // 估算超过 6 小时视为异常（网络几乎不可用）
    const unstable = seconds > 6 * 3600;
    return { seconds, rate: r, unstable, reason: unstable ? 'too-slow' : null };
  }

  /**
   * 取下一个待上传分片。
   *
   * 顺序策略：从低到高找第一个未上传的分片。
   * 顺序上传对断点续传最友好——恢复后只需从"第一个缺口"继续。
   *
   * @returns {{index:number,start:number,end:number,size:number,attempt:number}|null}
   *          null 表示全部分片已完成
   */
  function nextChunk() {
    if (cancelRequested) return null;
    for (let i = 0; i < chunks.length; i += 1) {
      if (!uploaded.has(i)) {
        const attempt = (retries.get(i) || 0) + 1;
        return Object.assign({}, chunks[i], { attempt });
      }
    }
    return null;
  }

  function isComplete() {
    return uploaded.size === chunks.length;
  }

  /** 该分片是否已耗尽重试次数 */
  function isChunkExhausted(index) {
    return (retries.get(index) || 0) >= MAX_CHUNK_RETRY;
  }

  // ---------- 变更 ----------

  function start() {
    if (status === 'done' || status === 'cancelled') return status;
    status = 'uploading';
    if (startedAt == null) startedAt = now();
    return status;
  }

  /**
   * 标记分片上传成功。
   * @returns {boolean} 是否因此完成全部上传
   */
  function markUploaded(index, currentNow = now()) {
    if (!Number.isInteger(index) || index < 0 || index >= chunks.length) {
      throw new Error(`markUploaded: 非法分片索引 ${index}`);
    }
    uploaded.add(index);
    estimator.push(uploadedBytes(), currentNow);

    if (isComplete()) {
      status = 'done';
      finishedAt = currentNow;
      return true;
    }
    return false;
  }

  /**
   * 标记分片失败。
   * @returns {'retry'|'exhausted'} retry=还可重试；exhausted=重试耗尽，整个会话判失败
   */
  function markChunkFailed(index) {
    const n = (retries.get(index) || 0) + 1;
    retries.set(index, n);
    if (n >= MAX_CHUNK_RETRY) {
      status = 'failed';
      return 'exhausted';
    }
    return 'retry';
  }

  function pause() {
    if (status === 'uploading') status = 'paused';
    return status;
  }

  function resume() {
    if (status === 'paused' || status === 'failed') {
      status = 'uploading';
      // 重置失败分片的重试计数，给恢复后的网络一次完整机会
      retries.forEach((_, k) => retries.set(k, 0));
    }
    return status;
  }

  /**
   * 用户取消。
   *
   * ⚠️ 取消 ≠ 删除（界面设计 v0.1.1 屏 04 红色注释）：
   * 只中止上传，本地视频保留 24 小时，误点可从首页"未上传"入口找回。
   */
  function cancel(currentNow = now()) {
    cancelRequested = true;
    status = 'cancelled';
    localFileExpireAt = currentNow + LOCAL_RETENTION_MS;
    return { status, localFileExpireAt, localFilePath: filePath };
  }

  /** 本地文件是否已过期（可清理） */
  function isLocalFileExpired(currentNow = now()) {
    return localFileExpireAt != null && currentNow >= localFileExpireAt;
  }

  // ---------- 持久化 ----------

  /**
   * 导出可持久化状态。
   * 每次 markUploaded 后应调用并存入 wx.setStorage，
   * 这是"杀进程后重进不丢进度"的基础（PRD 3.11 同类要求）。
   */
  function serialize() {
    return {
      activityId,
      filePath,
      fileSize,
      chunkSize,
      totalChunks: chunks.length,
      uploadedIndices: Array.from(uploaded).sort((a, b) => a - b),
      status,
      startedAt,
      localFileExpireAt,
    };
  }

  return {
    // 查询
    get chunks() { return chunks; },
    get status() { return status; },
    get startedAt() { return startedAt; },
    get finishedAt() { return finishedAt; },
    get cancelRequested() { return cancelRequested; },
    progress,
    eta,
    nextChunk,
    isComplete,
    isChunkExhausted,
    isLocalFileExpired,
    uploadedBytes,
    // 变更
    start,
    markUploaded,
    markChunkFailed,
    pause,
    resume,
    cancel,
    // 持久化
    serialize,
    // 测试可见
    _estimator: estimator,
  };
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  RATE_WINDOW_MS,
  LOCAL_RETENTION_MS,
  MAX_CHUNK_RETRY,
  planChunks,
  createRateEstimator,
  createUploadSession,
  formatBytes,
  formatDuration,
};
