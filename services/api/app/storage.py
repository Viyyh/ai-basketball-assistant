"""SQLite 持久层。

第一版刻意不用 ORM：表结构只有两张，SQL 直接看得懂，
本地跑起来零配置，后面换 Postgres 时把这一层整体替换即可。
"""

from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    opponent             TEXT,
    format               TEXT NOT NULL,
    age_group            TEXT NOT NULL,
    court_type           TEXT NOT NULL,
    three_point_radius_m REAL NOT NULL,
    params_json          TEXT NOT NULL,
    created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
    activity_id      TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    schema_version   TEXT NOT NULL,
    pipeline_version TEXT NOT NULL,
    payload          TEXT NOT NULL,
    created_at       TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"act_{stamp}_{secrets.token_hex(3)}"


class Storage:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    # ---------- 活动 ----------

    def create_activity(self, *, title: str, opponent: Optional[str], params: dict) -> dict:
        record = {
            "id": _new_id(),
            "title": title,
            "opponent": opponent,
            "format": params["format"],
            "age_group": params["age_group"],
            "court_type": params["court_type"],
            "three_point_radius_m": params["three_point_radius_m"],
            "params_json": json.dumps(params, ensure_ascii=False),
            "created_at": _now(),
        }
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO activities
                   (id, title, opponent, format, age_group, court_type,
                    three_point_radius_m, params_json, created_at)
                   VALUES (:id, :title, :opponent, :format, :age_group, :court_type,
                           :three_point_radius_m, :params_json, :created_at)""",
                record,
            )
        return self.get_activity(record["id"])  # type: ignore[return-value]

    _SELECT = """
        SELECT a.*, (r.activity_id IS NOT NULL) AS has_report
        FROM activities a LEFT JOIN reports r ON r.activity_id = a.id
    """

    def get_activity(self, activity_id: str) -> Optional[dict]:
        with self.connect() as conn:
            row = conn.execute(f"{self._SELECT} WHERE a.id = ?", (activity_id,)).fetchone()
        return self._row_to_activity(row) if row else None

    def list_activities(self, limit: int = 50) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                f"{self._SELECT} ORDER BY a.created_at DESC, a.id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._row_to_activity(r) for r in rows]

    @staticmethod
    def _row_to_activity(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "title": row["title"],
            "opponent": row["opponent"],
            "params": json.loads(row["params_json"]),
            "has_report": bool(row["has_report"]),
            "created_at": row["created_at"],
        }

    # ---------- 报告 ----------

    def save_report(self, activity_id: str, report: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO reports (activity_id, schema_version, pipeline_version, payload, created_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(activity_id) DO UPDATE SET
                     schema_version=excluded.schema_version,
                     pipeline_version=excluded.pipeline_version,
                     payload=excluded.payload,
                     created_at=excluded.created_at""",
                (
                    activity_id,
                    report.get("schema_version", ""),
                    report.get("pipeline_version", ""),
                    json.dumps(report, ensure_ascii=False),
                    _now(),
                ),
            )

    def get_report(self, activity_id: str) -> Optional[dict]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT payload FROM reports WHERE activity_id = ?", (activity_id,)
            ).fetchone()
        return json.loads(row["payload"]) if row else None
