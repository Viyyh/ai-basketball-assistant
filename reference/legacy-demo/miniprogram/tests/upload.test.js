/**
 * 上传模块单元测试 —— P2-F02
 *
 * 验收对应 PRD 9.3：
 *   #3.1 上传成功率 ≥95%
 *   #3.2 中断 3 次内仍能完成，已传分片不重传
 *   #3.3 后台存活
 * 以及界面设计 v0.1.1 屏 04 的两条注释：
 *   · 剩余时间用滚动 30 秒平均速率，不用整体平均
 *   · 取消 ≠ 删除，本地保留 24 小时
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_CHUNK_SIZE,
  LOCAL_RETENTION_MS,
  MAX_CHUNK_RETRY,
  RATE_WINDOW_MS,
  createRateEstimator,
  createUploadSession,
  formatBytes,
  formatDuration,
  planChunks,
} = require('../utils/upload');

const MB = 1024 * 1024;

// ============================================================
// 分片计划
// ============================================================

test('planChunks: 整除时分片大小一致', () => {
  const chunks = planChunks(32 * MB, 8 * MB);
  assert.strictEqual(chunks.length, 4);
  chunks.forEach((c, i) => {
    assert.strictEqual(c.index, i);
    assert.strictEqual(c.start, i * 8 * MB);
    assert.strictEqual(c.size, 8 * MB);
  });
});

test('planChunks: 不整除时最后一片较小', () => {
  const size = 20 * MB + 1234;
  const chunks = planChunks(size, 8 * MB);
  assert.strictEqual(chunks.length, 3);
  assert.strictEqual(chunks[0].size, 8 * MB);
  assert.strictEqual(chunks[1].size, 8 * MB);
  assert.strictEqual(chunks[2].size, 4 * MB + 1234);
  // 分片必须无缝覆盖整个文件，不留空洞也不重叠
  assert.strictEqual(chunks[0].start, 0);
  assert.strictEqual(chunks[2].end, size);
  for (let i = 1; i < chunks.length; i += 1) {
    assert.strictEqual(chunks[i].start, chunks[i - 1].end,
      `第 ${i} 片起点应等于第 ${i - 1} 片终点`);
  }
});

test('planChunks: 小于一个分片的文件只有一片', () => {
  const chunks = planChunks(1024, 8 * MB);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].size, 1024);
});

test('planChunks: 非法入参抛错', () => {
  assert.throws(() => planChunks(0), /非法文件大小/);
  assert.throws(() => planChunks(-1), /非法文件大小/);
  assert.throws(() => planChunks(NaN), /非法文件大小/);
  assert.throws(() => planChunks(MB, 0), /非法分片大小/);
});

// ============================================================
// 滚动速率估算
// ============================================================

test('rateEstimator: 样本不足时返回 null（界面显示"计算中"）', () => {
  const e = createRateEstimator();
  assert.strictEqual(e.rate(1000), null);
  e.push(1000, 1000);
  assert.strictEqual(e.rate(1000), null, '只有一个样本时无法算速率');
});

test('rateEstimator: 用窗口内首末样本算速率', () => {
  const e = createRateEstimator(30_000);
  e.push(0, 0);
  e.push(10 * MB, 10_000);   // 10 秒传了 10MB
  const r = e.rate(10_000);
  assert.ok(Math.abs(r - 1 * MB) < 1, `应约 1 MB/s，实际 ${r}`);
});

test('rateEstimator: 窗口外的旧样本被丢弃（滚动而非整体平均）', () => {
  const e = createRateEstimator(30_000);
  // 前 10 秒极慢
  e.push(0, 0);
  e.push(1 * MB, 10_000);
  // 40 秒后（超出 30 秒窗口）突然变快
  e.push(1 * MB + 100 * MB, 40_000);
  e.push(1 * MB + 200 * MB, 50_000);

  const r = e.rate(50_000);
  // 若用整体平均：200MB / 50s = 4 MB/s
  // 滚动窗口应只看到近段：约 10 MB/s
  assert.ok(r > 6 * MB, `滚动速率应反映近段高速，实际 ${r / MB} MB/s`);
});

test('rateEstimator: 无进展时返回 0（界面显示网络波动）', () => {
  const e = createRateEstimator(30_000);
  e.push(5 * MB, 0);
  e.push(5 * MB, 5_000);
  assert.strictEqual(e.rate(5_000), 0);
});

test('rateEstimator: 窗口常量为 30 秒', () => {
  assert.strictEqual(RATE_WINDOW_MS, 30_000);
});

// ============================================================
// 会话状态机
// ============================================================

function makeSession(overrides = {}) {
  return createUploadSession(Object.assign({
    activityId: 'act_001',
    filePath: '/tmp/game.mp4',
    fileSize: 20 * MB,
    chunkSize: 8 * MB,
  }, overrides));
}

test('session: 初始为 idle，分片数正确', () => {
  const s = makeSession();
  assert.strictEqual(s.status, 'idle');
  assert.strictEqual(s.chunks.length, 3);
  assert.strictEqual(s.progress().uploadedChunks, 0);
  assert.strictEqual(s.progress().percent, 0);
});

test('session: nextChunk 顺序返回，已传的不重复给', () => {
  const s = makeSession();
  s.start();
  assert.strictEqual(s.nextChunk().index, 0);
  s.markUploaded(0);
  assert.strictEqual(s.nextChunk().index, 1, '已传分片不得再次下发（PRD 3.2）');
  s.markUploaded(1);
  assert.strictEqual(s.nextChunk().index, 2);
  s.markUploaded(2);
  assert.strictEqual(s.nextChunk(), null, '全部完成后应返回 null');
  assert.strictEqual(s.status, 'done');
  assert.strictEqual(s.progress().percent, 100);
});

test('session: 进度按字节精确计算', () => {
  const s = makeSession();
  s.start();
  s.markUploaded(0);
  const p = s.progress();
  assert.strictEqual(p.uploadedBytes, 8 * MB);
  assert.strictEqual(p.totalBytes, 20 * MB);
  assert.strictEqual(p.percent, Math.floor((8 / 20) * 100));
});

test('session: 断点续传 —— 恢复后已传分片不重传（PRD 3.2）', () => {
  const s1 = makeSession();
  s1.start();
  s1.markUploaded(0);
  s1.markUploaded(1);
  const saved = s1.serialize();

  // 模拟小程序被杀后重进
  const s2 = makeSession({ persisted: saved });
  assert.strictEqual(s2.progress().uploadedChunks, 2, '恢复后应记得已传 2 片');
  assert.strictEqual(s2.nextChunk().index, 2, '应从第一个缺口继续');

  s2.markUploaded(2);
  assert.strictEqual(s2.status, 'done');
});

test('session: 中断 3 次内仍能完成，且已传分片不重传（PRD 3.2）', () => {
  // 5 片文件，先传 1 片，再经历 3 次中断，最后完成
  const opts = { fileSize: 40 * MB, chunkSize: 8 * MB };
  let session = makeSession(opts);
  session.start();

  /** 记录每一次"真实上传"的分片索引，用于证明没有重传 */
  const uploadLog = [];
  const doUpload = (s) => {
    const chunk = s.nextChunk();
    if (!chunk) return null;
    uploadLog.push(chunk.index);
    s.markUploaded(chunk.index);
    return chunk.index;
  };

  assert.strictEqual(doUpload(session), 0);

  for (let interruption = 1; interruption <= 3; interruption += 1) {
    const saved = session.serialize();
    // 模拟小程序被杀 / 断网 / 切后台后重进
    session = makeSession(Object.assign({ persisted: saved }, opts));
    const idx = doUpload(session);
    assert.ok(idx !== null, `第 ${interruption} 次中断后应仍有待传分片`);
    assert.strictEqual(idx, interruption,
      `第 ${interruption} 次中断后应续传第 ${interruption} 片，实际是第 ${idx} 片`);
  }

  // 还剩最后一片
  assert.strictEqual(session.isComplete(), false);
  assert.strictEqual(doUpload(session), 4);
  assert.strictEqual(session.isComplete(), true);
  assert.strictEqual(session.status, 'done');

  // 核心断言：5 片文件总共只发生了 5 次上传，每片恰好一次
  assert.strictEqual(uploadLog.length, 5, `应恰好上传 5 次，实际 ${uploadLog.length} 次`);
  assert.deepStrictEqual(uploadLog, [0, 1, 2, 3, 4]);
  assert.strictEqual(new Set(uploadLog).size, 5, '不得有重复上传的分片');
});

test('session: 恢复后只下发缺口分片（不是简单"从第 N 片继续"）', () => {
  const opts = { fileSize: 40 * MB, chunkSize: 8 * MB };
  const s1 = makeSession(opts);
  s1.start();
  s1.markUploaded(0);
  s1.markUploaded(2);   // 故意留缺口

  const s2 = makeSession(Object.assign({ persisted: s1.serialize() }, opts));
  assert.strictEqual(s2.progress().uploadedChunks, 2);

  const order = [];
  let c = s2.nextChunk();
  while (c) {
    order.push(c.index);
    s2.markUploaded(c.index);
    c = s2.nextChunk();
  }
  assert.deepStrictEqual(order, [1, 3, 4], '已传的 0 和 2 不得重现');
  assert.strictEqual(s2.isComplete(), true);
});

test('session: 恢复时分片计划不一致则丢弃旧状态（防止文件损坏）', () => {
  const s1 = makeSession();
  s1.start();
  s1.markUploaded(0);
  const saved = s1.serialize();

  // 换了文件（大小不同）
  const s2 = makeSession({ fileSize: 40 * MB, persisted: saved });
  assert.strictEqual(s2.progress().uploadedChunks, 0,
    '文件不同时旧进度必须作废，否则会拼出损坏的文件');
});

test('session: 换了 activityId 也丢弃旧状态', () => {
  const s1 = makeSession();
  s1.start();
  s1.markUploaded(0);
  const saved = s1.serialize();

  const s2 = makeSession({ activityId: 'act_999', persisted: saved });
  assert.strictEqual(s2.progress().uploadedChunks, 0);
});

// ============================================================
// 重试与失败
// ============================================================

test('session: 分片失败可重试，耗尽后会话判失败', () => {
  const s = makeSession();
  s.start();

  assert.strictEqual(s.markChunkFailed(0), 'retry');
  assert.strictEqual(s.markChunkFailed(0), 'retry');
  assert.strictEqual(s.status, 'uploading');

  assert.strictEqual(s.markChunkFailed(0), 'exhausted');
  assert.strictEqual(s.status, 'failed');
  assert.strictEqual(s.isChunkExhausted(0), true);
  assert.strictEqual(MAX_CHUNK_RETRY, 3);
});

test('session: resume 后重置重试计数，给恢复的网络一次完整机会', () => {
  const s = makeSession();
  s.start();
  s.markChunkFailed(0);
  s.markChunkFailed(0);
  s.markChunkFailed(0);
  assert.strictEqual(s.status, 'failed');

  s.resume();
  assert.strictEqual(s.status, 'uploading');
  assert.strictEqual(s.isChunkExhausted(0), false, 'resume 应重置重试计数');
  assert.strictEqual(s.nextChunk().index, 0);
});

test('session: pause / resume 状态流转', () => {
  const s = makeSession();
  s.start();
  assert.strictEqual(s.status, 'uploading');
  assert.strictEqual(s.pause(), 'paused');
  assert.strictEqual(s.pause(), 'paused', '重复 pause 幂等');
  assert.strictEqual(s.resume(), 'uploading');
});

// ============================================================
// 取消 ≠ 删除
// ============================================================

test('session: 取消后不再下发分片，但保留本地文件 24 小时', () => {
  let t = 1_000_000;
  const s = makeSession({ now: () => t });
  s.start();
  s.markUploaded(0);

  const result = s.cancel();
  assert.strictEqual(s.status, 'cancelled');
  assert.strictEqual(s.nextChunk(), null, '取消后不得继续下发分片');

  // 关键：本地文件路径仍在，过期时间是 24 小时后
  assert.strictEqual(result.localFilePath, '/tmp/game.mp4');
  assert.strictEqual(result.localFileExpireAt, t + LOCAL_RETENTION_MS);
  assert.strictEqual(LOCAL_RETENTION_MS, 24 * 60 * 60 * 1000);

  assert.strictEqual(s.isLocalFileExpired(t + LOCAL_RETENTION_MS - 1), false,
    '24 小时内本地文件不得视为过期');
  assert.strictEqual(s.isLocalFileExpired(t + LOCAL_RETENTION_MS), true);
});

// ============================================================
// ETA
// ============================================================

test('session: ETA 基于滚动速率，剩余字节正确', () => {
  let t = 0;
  const s = makeSession({ fileSize: 100 * MB, chunkSize: 10 * MB, now: () => t });
  s.start();

  t = 0;      s.markUploaded(0);   // 10MB @ 0s
  t = 10_000; s.markUploaded(1);   // 20MB @ 10s → 1 MB/s

  const e = s.eta(10_000);
  assert.ok(e.rate !== null);
  assert.ok(Math.abs(e.rate - 1 * MB) < 1024, `速率应约 1MB/s，实际 ${e.rate}`);
  // 剩 80MB / 1MB/s = 80s
  assert.ok(Math.abs(e.seconds - 80) < 2, `剩余应约 80 秒，实际 ${e.seconds}`);
  assert.strictEqual(e.unstable, false);
});

test('session: 速率未知时 ETA 返回 warming-up，界面不显示假数字', () => {
  const s = makeSession();
  s.start();
  const e = s.eta();
  assert.strictEqual(e.seconds, null);
  assert.strictEqual(e.reason, 'warming-up');
});

test('session: 完全停滞时标记 stalled + unstable', () => {
  let t = 0;
  const s = makeSession({ now: () => t });
  s.start();
  t = 0;      s.markUploaded(0);
  t = 10_000; s._estimator.push(s.uploadedBytes(), 10_000);  // 无进展

  const e = s.eta(10_000);
  assert.strictEqual(e.rate, 0);
  assert.strictEqual(e.reason, 'stalled');
  assert.strictEqual(e.unstable, true);
});

// ============================================================
// 序列化
// ============================================================

test('session: serialize 输出可 JSON 化且含恢复所需全部字段', () => {
  const s = makeSession();
  s.start();
  s.markUploaded(1);   // 故意乱序，验证记录的是索引集合而非"传到第几片"
  s.markUploaded(0);

  const json = JSON.stringify(s.serialize());
  const back = JSON.parse(json);

  assert.strictEqual(back.activityId, 'act_001');
  assert.strictEqual(back.fileSize, 20 * MB);
  assert.strictEqual(back.chunkSize, 8 * MB);
  assert.strictEqual(back.totalChunks, 3);
  assert.deepStrictEqual(back.uploadedIndices, [0, 1]);

  const s2 = makeSession({ persisted: back });
  assert.strictEqual(s2.progress().uploadedChunks, 2);
  assert.strictEqual(s2.nextChunk().index, 2);
});

test('session: 乱序上传也能正确完成', () => {
  const s = makeSession({ fileSize: 40 * MB, chunkSize: 8 * MB });
  s.start();
  [3, 0, 2, 1, 4].forEach((i) => s.markUploaded(i));
  assert.strictEqual(s.isComplete(), true);
  assert.strictEqual(s.status, 'done');
});

test('session: markUploaded 拒绝非法索引', () => {
  const s = makeSession();
  assert.throws(() => s.markUploaded(-1), /非法分片索引/);
  assert.throws(() => s.markUploaded(99), /非法分片索引/);
  assert.throws(() => s.markUploaded(1.5), /非法分片索引/);
});

test('session: 缺少必填参数抛错', () => {
  assert.throws(() => createUploadSession({ filePath: 'x', fileSize: MB }), /activityId/);
  assert.throws(() => createUploadSession({ activityId: 'a', fileSize: MB }), /filePath/);
});

// ============================================================
// 格式化
// ============================================================

test('formatBytes', () => {
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(2048), '2.0 KB');
  assert.strictEqual(formatBytes(4.2 * 1024 * 1024), '4.2 MB');
  assert.strictEqual(formatBytes(6.1 * 1024 * 1024 * 1024), '6.1 GB');
  assert.strictEqual(formatBytes(-1), '--');
  assert.strictEqual(formatBytes(NaN), '--');
});

test('formatDuration', () => {
  assert.strictEqual(formatDuration(0), '00:00');
  assert.strictEqual(formatDuration(65), '01:05');
  assert.strictEqual(formatDuration(2712), '45:12');
  assert.strictEqual(formatDuration(3661), '1:01:01');
  assert.strictEqual(formatDuration(-5), '--:--');
  assert.strictEqual(formatDuration(null), '--:--');
});

test('默认分片大小为 8MB（范围确认 v0.2 屏 04）', () => {
  assert.strictEqual(DEFAULT_CHUNK_SIZE, 8 * MB);
});
