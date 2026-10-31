"""Build the final local analysis report from saved, auditable results."""
import html,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'data/final';out.mkdir(exist_ok=True)
validation=json.loads((out/'scoreboard-validation.json').read_text())
comparison=json.loads((ROOT/'data/ball-comparison/results.json').read_text())
summary={'scope':'120 seconds across two videos, 480 frames; not whole-game acceptance','games':{},'scoreboard_validation':validation,'diagnostic_comparison':comparison}
parts=['''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>篮球视频 · 本地分析验证报告</title><style>body{margin:0;background:#0c1524;color:#eaf0f9;font:16px/1.7 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:36px}h2{margin-top:35px}.card{padding:24px;margin:22px 0;background:#17253a;border-radius:16px}a{color:#7edcc1}video{width:100%;border-radius:12px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #334259}.muted{color:#b1bfd3}.badge{color:#7edcc1}strong{color:#ffd28c}</style><main><p class="badge">本地实测 · 2026-10-31</p><h1>篮球视频分析验证报告</h1><p>已跑通真实推理，并接入篮球专用检测模型。当前适合检测与复核；尚不能可靠生成整场投篮、命中率或球员身份报告。</p><div class="card"><h2>这次实际验证了什么</h2><p>两场 NBA 比赛共 120 秒、480 帧，同一批画面比较通用模型与专用模型；9 次官方事件有可回看的粗定位短片。未跑完整两场，未训练自定义模型。</p><p>独立读取记分牌发现 6 次得分变化，与所选窗口内的 6 次官方命中在球队和分值上对应。记分牌更新滞后 1–3 秒；它不能识别未中投篮、出手人或精确出手帧。</p></div><h2>检测对照</h2><p class="muted">有候选框的帧占比不等于准确率或召回率，增加候选也可能增加误报。</p><table><tr><th>片段</th><th>通用 YOLO11m</th><th>篮球 E-BARD</th><th>处理帧数</th></tr>''']
for game in ['game1','game3']:
 baseline=json.loads((out/game/'analysis.json').read_text())['summary']
 domain=json.loads((out/(game+'-basketball')/'analysis.json').read_text())['summary']
 summary['games'][game]={'baseline':baseline,'basketball':domain}
 n=domain['processed_frames']
 parts.append(f'<tr><td>{game}</td><td>{baseline["frames_with_candidates"]}/{n}</td><td>{domain["frames_with_candidates"]}/{n}</td><td>{n}</td></tr>')
parts.append('</table><div class="card"><p>另有 3 张人工框选的清晰球图像：通用模型各匹配 1 张，篮球专用模型匹配 3 张（IoU ≥ 0.25）。样本非常小、框为近似标注、未知是否与外部模型训练集重叠，不能当作泛化准确率。分块推理在这 3 张图上没有增加命中，默认不启用。</p><p>画面中球员、裁判和篮筐使用专用类别，但仍可能误检。黄圈是暂定球关联，缺失帧保持缺失。</p></div>')
for game,title in [('game1','G1 · 独行侠 vs 凯尔特人'),('game3','G3 · 凯尔特人 vs 独行侠')]:
 score=json.loads((ROOT/f'data/scoreboard/{game}.json').read_text())
 parts.append(f'<section class="card"><h2>{title}</h2><video controls preload="metadata" poster="{game}-basketball/preview.jpg" src="{game}-basketball/annotated.mp4"></video><p><a href="{game}-basketball/analysis.json">逐帧检测与暂定关联 JSON</a></p><h3>独立 OCR 得分变化</h3><table><tr><th>视频秒数</th><th>比赛时钟</th><th>球队</th><th>加分</th></tr>')
 for e in score['score_changes']:
  parts.append(f'<tr><td>{e["video_seconds"]}</td><td>{html.escape(e["clock"])}</td><td>{e["team"]}</td><td>+{e["score_delta"]}</td></tr>')
 parts.append('</table></section>')
parts.append('''<div class="card"><h2>验收结论</h2><p>本地解码、专用检测、可视化、结果导出、记分牌变化检测均可运行。纯画面投篮与命中识别、跨镜头球员身份、回放去重和手拍视频泛化尚未通过验收；不能输出完整命中率。</p><p><a href="../validation/index.html">9 次官方事件与短片复核</a> · <a href="summary.json">完整验证数据</a> · <a href="https://huggingface.co/GabrieleGiudici/E-BARD-detection-models">专用模型作者与来源</a></p><p class="muted">官方答案仅用于事后评估，没有输入模型或 OCR 预测。专用模型来源和许可归属见仓库 benchmarks/nba/MODEL_SOURCES.md。</p></div></main></html>''')
(out/'index.html').write_text('\n'.join(parts));(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(out/'index.html')
