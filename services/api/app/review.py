"""Local video review workflow. Events are manually confirmed, never AI claims."""
import json
import os
from pathlib import Path
from typing import Literal
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

class Shot(BaseModel):
    seconds: float = Field(ge=0, le=20)
    team: Literal["home", "away"]
    points: Literal[2, 3]
    made: bool

GAMES = {"nba-game1": "独行侠 vs 凯尔特人 · G1", "nba-game3": "凯尔特人 vs 独行侠 · G3"}

def install_review(app, store):
    media = Path(os.environ.get("BASKETBALL_MEDIA_DIR", str(Path(__file__).resolve().parents[3] / "data" / "media")))
    with store.connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS review_shots (id INTEGER PRIMARY KEY, game TEXT NOT NULL, payload TEXT NOT NULL)")

    def check(game):
        if game not in GAMES:
            raise HTTPException(404, "视频不存在")

    @app.get("/v1/review/games")
    def games():
        return [{"id": k, "title": v, "duration": 20, "source_start": 600, "status": "人工复核", "available": (media / (k + ".mp4")).exists()} for k,v in GAMES.items()]

    @app.get("/v1/review/games/{game}/video")
    def video(game: str):
        check(game)
        path = media / (game + ".mp4")
        if not path.exists():
            raise HTTPException(404, "视频尚未准备好")
        return FileResponse(path, media_type="video/mp4")

    @app.get("/v1/review/games/{game}/shots")
    def shots(game: str):
        check(game)
        with store.connect() as conn:
            rows = conn.execute("SELECT id,payload FROM review_shots WHERE game=? ORDER BY id", (game,)).fetchall()
        events = [dict(id=r["id"], **json.loads(r["payload"])) for r in rows]
        stats = {}
        for team in ("home", "away"):
            selected = [e for e in events if e["team"] == team]
            stats[team] = {"attempts": len(selected), "made": sum(e["made"] for e in selected), "points": sum(e["points"] for e in selected if e["made"])}
        return {"events": events, "stats": stats, "warning": "仅统计人工确认的测试片段，不代表整场比赛"}

    @app.post("/v1/review/games/{game}/shots", status_code=201)
    def add(game: str, shot: Shot):
        check(game)
        with store.connect() as conn:
            cursor = conn.execute("INSERT INTO review_shots(game,payload) VALUES (?,?)", (game, shot.model_dump_json()))
            return {"id": cursor.lastrowid}

    @app.delete("/v1/review/games/{game}/shots/{event}", status_code=204)
    def remove(game: str, event: int):
        check(game)
        with store.connect() as conn:
            result = conn.execute("DELETE FROM review_shots WHERE game=? AND id=?", (game,event))
            if not result.rowcount:
                raise HTTPException(404, "记录不存在")
