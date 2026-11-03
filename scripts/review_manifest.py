"""Read-only collaboration inventory; private records stay in local data/."""
import json
from pathlib import Path
import sqlite3
from player_workbench import ROOT, state


def db_counts(path):
    if not Path(path).exists():return {'total':0,'reviewed':0,'pending':0,'needs_revision':0}
    c=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
    try:
        total=c.execute('SELECT count(*) FROM annotations').fetchone()[0]
        reviewed=c.execute('SELECT count(DISTINCT annotation_id) FROM human_decisions').fetchone()[0]
        needs=c.execute("SELECT count(*) FROM human_decisions WHERE id IN (SELECT max(id) FROM human_decisions GROUP BY annotation_id) AND decision='uncertain'").fetchone()[0]
        return {'total':total,'reviewed':reviewed,'pending':total-reviewed,'needs_revision':needs}
    finally:c.close()


def build(root=ROOT):
    root=Path(root);base=root/'data/library';player=base/'player-review.db'
    result={'scope':'Collaboration inventory, not approvals or exhaustive labels','materials':db_counts(base/'library.db'),'second':db_counts(base/'external-review.db'),'player':{},'external':{}}
    if player.exists():
        s=state(player);tasks=[]
        for src in s['sources']:
            intervals=sorted((x['start'],x['end']) for x in s['coverage'] if x['source_id']==src['id']) if src['media_current'] else []
            # Clip the complement of already reviewed intervals into <=30s tasks.
            cursor=0;gaps=[]
            for a,b in intervals:
                if a>cursor:gaps.append((cursor,a))
                cursor=max(cursor,b)
            if cursor<src['duration']:gaps.append((cursor,src['duration']))
            for a,b in gaps:
                while a<b-1e-6:
                    end=min(a+30,b)
                    tasks.append({'source_id':src['id'],'name':src['name'],'start':a,'end':end,'media_current':src['media_current']})
                    a=end
        result['player']={'players_pending':sum(p['status']!='confirmed' for p in s['players']),
          'event_pending':sum(e['status'] in ['candidate','uncertain'] for e in s['events']),
          'events_total':len(s['events']),'sources':s['sources'],'continuous_tasks':tasks}
    db=base/'library.db'
    if db.exists():
        c=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True)
        try:
            result['isolated_model_candidates']=c.execute('SELECT count(*) FROM candidates').fetchone()[0]
            result['upstream_external_records']=c.execute('SELECT count(*) FROM external_records').fetchone()[0]
            rows=c.execute('SELECT media_path FROM external_review_samples').fetchall()
            result['external']={'representatives':len(rows),'missing_media':sum(not p or not (root/p).is_file() for (p,) in rows),
              'note':'缺少媒体的样本不能做视觉通过；全量上游记录不当作已核验。'}
        finally:c.close()
    acquired=base/'acquired-review.db'
    result['acquired']={'total':0,'reviewed':0,'pending':0}
    if acquired.exists():
        c=sqlite3.connect('file:'+str(acquired)+'?mode=ro',uri=True)
        try:
            total=c.execute('SELECT count(*) FROM clips').fetchone()[0]
            reviewed=c.execute('SELECT count(DISTINCT clip_id) FROM decisions').fetchone()[0]
            result['acquired']={'total':total,'reviewed':reviewed,'pending':total-reviewed}
        finally:c.close()
    return result

if __name__=='__main__':
    inventory=build();out=ROOT/'data/library/collaboration-review';out.mkdir(exist_ok=True)
    (out/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
    p=inventory['player'];second=inventory['second'];ext=inventory['external']
    lines=['# 本次协作审核清单','','先确认身份，再审核已有候选，最后连续看完原片并补充漏掉事件。','',
      f"- 个人复盘：{p.get('players_pending',0)}个身份待确认，{p.get('event_pending',0)}条动作待处理。",
      f"- 连续原片：{len(p.get('continuous_tasks',[]))}个不超过30秒的待复核区间。",
      f"- 独立二审：{second['total']}条，总计{second['pending']}条尚未提交二审决定，{second.get('needs_revision',0)}条需修改或再核验。",
      f"- 外部代表样本：{ext.get('representatives',0)}条，其中{ext.get('missing_media',0)}条缺媒体，暂不做视觉确认。",'',
      '开启远程审核后，登录首页会显示实时清单与分段入口。主库审核仅管理员可进入；独立二审不自动覆盖主库。',
      '建议每人使用独立账号；分配不同原片区间避免重复劳动。重叠区间不重复累计。未知结果保留unknown。','', '模型候选独立隔离；上游外部回合不是已经完成画面对照的材料。历史43条二审只覆盖展示记录，不代表已经逐帧核验所有历史原片。', '', '## 连续原片分段']
    for t in p.get('continuous_tasks',[]):lines.append(f"- {t['name']}：{t['start']:.3f}–{t['end']:.3f}秒")
    (out/'审核清单.md').write_text('\n'.join(lines)+'\n');print('\n'.join(lines[:12]))
