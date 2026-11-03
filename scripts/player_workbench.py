"""Local player/event review with versioned evidence and derived scoped reports."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
import argparse
import hashlib
import json
import secrets
import sqlite3
import uuid

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, ConfigDict, Field

from session_preferences import Preferences
ROOT = Path(__file__).resolve().parents[1]

class Write(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    reviewer: str = Field(min_length=1, max_length=80)
    viewed: Literal[True]

class Settings(Write):
    version: int = Field(ge=0)
    preferences: Preferences

class Identity(Write):
    version: int = Field(ge=1)
    status: Literal['confirmed', 'unconfirmed']

class Event(Write):
    version: int = Field(ge=0)
    source_id: str
    player_id: str | None = None
    start: float = Field(ge=0, strict=True)
    end: float = Field(gt=0, strict=True)
    kind: Literal['shot', 'other']
    action: Literal['unknown', 'layup', 'jump_shot', 'floater', 'putback', 'dunk', 'free_throw', 'catch', 'dribble', 'defense', 'raised_ball']
    outcome: Literal['unknown', 'made', 'missed']
    status: Literal['candidate', 'confirmed', 'rejected', 'uncertain']
    note: str = Field(default='', max_length=2000)

class Coverage(Write):
    source_id: str
    start: float = Field(ge=0, strict=True)
    end: float = Field(gt=0, strict=True)

@contextmanager
def connect(path):
    c = sqlite3.connect(path, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        with c:
            yield c
    finally:
        c.close()

def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT NOT NULL,
          path TEXT NOT NULL, sha256 TEXT NOT NULL, duration REAL NOT NULL CHECK(duration>0),
          bytes INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, group_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, name TEXT NOT NULL,
          cue TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unconfirmed', version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
          player_id TEXT REFERENCES players(id), start REAL NOT NULL, end REAL NOT NULL,
          kind TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL,
          status TEXT NOT NULL, note TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, entity TEXT NOT NULL,
          entity_id TEXT NOT NULL, reviewer TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS observations(player_id TEXT PRIMARY KEY REFERENCES players(id), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coverage(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
          start REAL NOT NULL, end REAL NOT NULL, reviewer TEXT NOT NULL);
        ''')

def current(source):
    try:
        st = Path(source['path']).stat()
        return st.st_size == source['bytes'] and st.st_mtime_ns == source['mtime_ns']
    except OSError:
        return False

def audit(c, entity, key, reviewer, snapshot):
    c.execute('INSERT INTO history(entity,entity_id,reviewer,snapshot,created_at) VALUES(?,?,?,?,?)',
              (entity, key, reviewer, json.dumps(snapshot, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))

def union_seconds(intervals):
    end = 0
    total = 0
    for start, stop in sorted(intervals):
        total += max(0, stop - max(start, end))
        end = max(end, stop)
    return total

def state(path, include_history=False):
    with connect(path) as c:
        c.execute("BEGIN")
        setting = c.execute('SELECT payload,version FROM settings WHERE id=1').fetchone() if c.execute("SELECT 1 FROM sqlite_master WHERE name='settings' AND type='table'").fetchone() else None
        preferences = json.loads(setting['payload']) if setting else Preferences().model_dump()
        sources = [dict(r) for r in c.execute('SELECT * FROM sources ORDER BY id')]
        players = [dict(r) for r in c.execute('SELECT * FROM players ORDER BY id')]
        events = [dict(r) for r in c.execute('SELECT * FROM events ORDER BY source_id,start,id')]
        coverage = [dict(r) for r in c.execute('SELECT * FROM coverage ORDER BY source_id,start')]
        history = [dict(r) for r in c.execute('SELECT * FROM history ORDER BY id')] if include_history else []
        observations = {r['player_id']: json.loads(r['payload']) for r in c.execute('SELECT * FROM observations')}
    valid = {s['id']: current(s) for s in sources}
    reports = []
    for player in players:
        player['number_label'] = player['name']
        supplied_name = preferences.get('player_names',{}).get(player['id'],'').strip()
        player['display_name'] = supplied_name+' · '+player['name'] if supplied_name else player['name']
        player['assistant_observation'] = observations.get(player['id']) if valid and all(valid.values()) else None
        eligible = [e for e in events if e['player_id'] == player['id'] and e['status'] == 'confirmed'
                    and e['kind'] == 'shot' and valid[e['source_id']] and player['status'] == 'confirmed']
        made = sum(e['outcome'] == 'made' for e in eligible)
        missed = sum(e['outcome'] == 'missed' for e in eligible)
        reports.append({'player_id': player['id'], 'confirmed_attempts': len(eligible), 'made': made,
                        'missed': missed, 'unknown_outcomes': len(eligible)-made-missed,
                        'known_result_rate': made/(made+missed) if made+missed else None,
                        'denominator': made+missed, 'measured_accuracy': None,
                        'evidence_ids': [e['id'] for e in eligible],
                        'scope': '已确认身份与出手中的已知结果子集；不是全片命中率'})
    public_sources = []
    for s in sources:
        reviewed = union_seconds((r['start'], r['end']) for r in coverage if r['source_id'] == s['id']) if valid[s['id']] else 0
        public_sources.append({k: s[k] for k in ('id', 'name', 'sha256', 'duration', 'group_id')}
                              | {'media_current': valid[s['id']], 'reviewed_seconds': reviewed,
                                 'reviewed_fraction': reviewed/s['duration']})
    result = {'settings':{'version':setting['version'] if setting else 0,'preferences':preferences,'scope':'用户提供，未验证；不等同于视频标定，尚不驱动旧参数层或得分计算'},'sources': public_sources, 'players': players, 'events': events, 'coverage': coverage,
            'reports': reports, 'training_ready': False,
            'notice': '候选不是事实；模型置信度不等于准确率；范围复核由审核者声明，不自动成为盲测或训练金标准。'}
    if include_history:
        result['history'] = history
    return result

def create_app(db_path=None):
    db = Path(db_path or ROOT/'data/library/player-review.db')
    initialize(db)
    token = secrets.token_hex(24)
    app = FastAPI(title='个人篮球视频复盘')
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])

    def authorize(value, reviewer):
        if not secrets.compare_digest(value, token):
            raise HTTPException(403, '请使用本机复盘页面')
        if not reviewer.strip():
            raise HTTPException(422, '请填写审核者')

    def source(c, key):
        r = c.execute('SELECT * FROM sources WHERE id=?', (key,)).fetchone()
        if r is None:
            raise HTTPException(404, '视频未登记')
        if not current(r):
            raise HTTPException(409, '原片缺失或已变更；请核对哈希并重新审核')
        return r

    @app.get('/', response_class=HTMLResponse)
    def page():
        return (ROOT/'tools/player-workbench.html').read_text().replace('__TOKEN__', token)

    @app.get('/api/state')
    def get_state():
        return state(db)

    @app.post('/api/settings')
    def save_settings(body: Settings, x_review_token: str = Header(default='')):
        authorize(x_review_token,body.reviewer)
        with connect(db) as c:
            c.execute('BEGIN IMMEDIATE')
            old=c.execute('SELECT * FROM settings WHERE id=1').fetchone()
            if (old['version'] if old else 0)!=body.version:raise HTTPException(409,'配置已变化，请刷新')
            ids={r[0] for r in c.execute('SELECT id FROM players')}
            if set(body.preferences.player_names)-ids:raise HTTPException(422,'姓名只能关联已登记球员')
            payload=body.preferences.model_dump()
            version=body.version+1
            c.execute('INSERT INTO settings VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version',(json.dumps(payload,ensure_ascii=False),version))
            audit(c,'session_settings','1',body.reviewer.strip(),{'before':dict(old) if old else None,'after':payload,'version':version})
        return {'saved':True,'version':version}

    @app.get('/api/export')
    def export():
        return state(db, include_history=True)

    @app.get('/api/media/{key}')
    def media(key: str):
        with connect(db) as c:
            r = source(c, key)
        return FileResponse(r['path'], media_type='video/mp4', headers={'Cache-Control': 'no-store'})

    @app.post('/api/players/{key}')
    def identity(key: str, body: Identity, x_review_token: str = Header(default='')):
        authorize(x_review_token, body.reviewer)
        with connect(db) as c:
            c.execute('BEGIN IMMEDIATE')
            old = c.execute('SELECT * FROM players WHERE id=?', (key,)).fetchone()
            if old is None:
                raise HTTPException(404, '球员不存在')
            if old['version'] != body.version:
                raise HTTPException(409, '身份版本已变化，请刷新')
            c.execute('UPDATE players SET status=?,version=version+1 WHERE id=?', (body.status, key))
            audit(c, 'identity', key, body.reviewer.strip(), dict(old) | {'new_status': body.status})
        return {'saved': True}

    @app.post('/api/events/{key}')
    def event(key: str, body: Event, x_review_token: str = Header(default='')):
        authorize(x_review_token, body.reviewer)
        if body.start >= body.end:
            raise HTTPException(422, '起止时间无效')
        if body.kind != 'shot' and body.outcome != 'unknown':
            raise HTTPException(422, '非出手事件不能记录命中结果')
        if body.kind == 'other' and body.action not in ['unknown','catch','dribble','defense','raised_ball']:
            raise HTTPException(422, '非出手与动作类型不匹配')
        if body.kind == 'shot' and body.action not in ['unknown','layup','jump_shot','floater','putback','dunk','free_throw']:
            raise HTTPException(422, '出手与动作类型不匹配')
        if body.status in ['uncertain', 'rejected'] and not body.note.strip():
            raise HTTPException(422, '请记录不确定或排除原因')
        with connect(db) as c:
            c.execute('BEGIN IMMEDIATE')
            src = source(c, body.source_id)
            if body.end > src['duration']:
                raise HTTPException(422, '事件超出原片时长')
            if body.player_id is not None and not c.execute('SELECT 1 FROM players WHERE id=?', (body.player_id,)).fetchone():
                raise HTTPException(422, '球员不存在')
            old = c.execute('SELECT * FROM events WHERE id=?', (key,)).fetchone()
            if (old and old['version'] != body.version) or (not old and body.version != 0):
                raise HTTPException(409, '事件版本已变化，请刷新')
            if old and old['source_id'] != body.source_id:
                raise HTTPException(422, '已有事件不能移到另一个视频')
            # A confirmed overlapping shot may be a duplicate. Resolve before counting it twice.
            if body.status == 'confirmed' and body.kind == 'shot':
                overlap = c.execute("SELECT id FROM events WHERE id!=? AND source_id=? AND kind='shot' AND status='confirmed' AND start<? AND end>?", (key,body.source_id,body.end,body.start)).fetchone()
                if overlap:
                    raise HTTPException(409, '与已确认出手区间重叠，请先核对重复事件或缩小区间')
            values = body.model_dump(exclude={'reviewer', 'viewed', 'version'})
            version = old['version']+1 if old else 1
            c.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,start=excluded.start,end=excluded.end,kind=excluded.kind,action=excluded.action,outcome=excluded.outcome,status=excluded.status,note=excluded.note,version=excluded.version',
                      (key,body.source_id,body.player_id,body.start,body.end,body.kind,body.action,body.outcome,body.status,body.note,version))
            audit(c, 'event', key, body.reviewer.strip(), {'before':dict(old) if old else None,'after':values | {'version':version}})
        return {'saved': True, 'version': version}

    @app.post('/api/coverage')
    def coverage(body: Coverage, x_review_token: str = Header(default='')):
        authorize(x_review_token, body.reviewer)
        with connect(db) as c:
            src = source(c, body.source_id)
            if not body.start < body.end <= src['duration']:
                raise HTTPException(422, '复核区间超出原片')
            key = str(uuid.uuid4())
            c.execute('INSERT INTO coverage VALUES(?,?,?,?,?)', (key,body.source_id,body.start,body.end,body.reviewer.strip()))
            audit(c, 'coverage', key, body.reviewer.strip(), body.model_dump())
        return {'saved': True}

    @app.delete('/api/coverage/{key}')
    def remove_coverage(key: str, reviewer: str, x_review_token: str = Header(default='')):
        authorize(x_review_token, reviewer)
        with connect(db) as c:
            row = c.execute('SELECT * FROM coverage WHERE id=?', (key,)).fetchone()
            if not row:
                raise HTTPException(404, '区间不存在')
            audit(c, 'coverage_removed', key, reviewer.strip(), dict(row))
            c.execute('DELETE FROM coverage WHERE id=?', (key,))
        return {'saved': True}

    return app

if __name__ == '__main__':
    import uvicorn
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=str(ROOT/'data/library/player-review.db'))
    parser.add_argument('--port', type=int, default=8013)
    args = parser.parse_args()
    uvicorn.run(create_app(args.db), host='127.0.0.1', port=args.port)
