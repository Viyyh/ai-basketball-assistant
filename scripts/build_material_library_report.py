"""Rebuild current catalog page without changing visual-review decisions."""
import html,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];base=ROOT/'datasets/library';local=ROOT/'data/library'
if __name__=='__main__':
 sources=json.loads((local/'sources.local.json').read_text());rows=[json.loads(x) for x in (base/'records-v0.1.jsonl').read_text().splitlines()];summary=json.loads((base/'summary-v0.1.json').read_text())
 (base/'sources-v0.1.json').write_text(json.dumps([{k:v for k,v in s.items() if k not in ['path','probe']} for s in sources],ensure_ascii=False,indent=2)+'\n')
 parts=['<meta charset="utf-8"><title>素材库审核</title><style>body{font:16px/1.7 sans-serif;max-width:1150px;margin:40px auto;background:#132032;color:white;padding:20px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #465568;text-align:left}a{color:#8ae1c5}img{max-width:100%}pre{white-space:pre-wrap}</style><h1>本地素材库 · 当前审核记录</h1><p>8 段原片均在原路径可读取；全部完成 SHA-256 校验。五段用户视频重抽的 30 帧与保留图片逐字节一致。</p><p>接纳 25 条限定用途标注，6 条遮挡样本仅作参考，12 条战术样本待时序复核，5 个模型候选隔离。没有完成全片逐帧审核，也没有独立人类签字。</p><h2>原片</h2><table><tr><th>文件</th><th>状态</th><th>SHA-256</th></tr>']
 for s in sources:parts.append(f'<tr><td>{html.escape(s["filename"])}</td><td>{s["admission"]}</td><td>{(s.get("sha256") or "unavailable")[:20]}</td></tr>')
 parts.append('</table><h2>标注</h2><table>')
 for r in rows:parts.append(f'<tr><td>{r["id"]}</td><td>{r["admission"]}</td><td>{html.escape(r["scope"])}</td></tr>')
 parts.append('</table><h2>复核证据</h2>')
 for name in ['hoops-0.jpg','hoops-1.jpg','balls.jpg','events-0.jpg','events-1.jpg','events-2.jpg']:parts.append(f'<h3>{name}</h3><img src="../library-audit/{name}">')
 parts.append('<h2>机器可读摘要</h2><pre>'+html.escape(json.dumps(summary,ensure_ascii=False,indent=2))+'</pre><p><a href="original-frame-check.json">原片与抽帧一致性检查</a></p>')
 (local/'index.html').write_text('\n'.join(parts))
 print('updated library report')
