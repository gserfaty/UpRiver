import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCHEMA = """
CREATE TABLE IF NOT EXISTS pipeline (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL,
  next_build_no INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS run_config (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipeline(id),
  name TEXT NOT NULL,
  params TEXT NOT NULL,
  stages TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pipeline_id, name)
);
CREATE TABLE IF NOT EXISTS upload (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipeline(id),
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  sha256 TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploader TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pipeline_id, path, version)
);
CREATE TABLE IF NOT EXISTS build (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipeline(id),
  number INTEGER NOT NULL,
  status TEXT NOT NULL,
  config_name TEXT,
  params TEXT NOT NULL,
  stages TEXT NOT NULL,
  files TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  abort_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT, finished_at TEXT,
  UNIQUE (pipeline_id, number)
);
CREATE TABLE IF NOT EXISTS stage_run (
  id INTEGER PRIMARY KEY,
  build_id INTEGER NOT NULL REFERENCES build(id),
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  started_at TEXT, finished_at TEXT,
  UNIQUE (build_id, seq)
);
"""


@contextmanager
def connect(path):
    """Short-lived connection; commits on success, rolls back on error, always closes."""
    c = sqlite3.connect(path, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    try:
        with c:
            yield c
    finally:
        c.close()


def init(path):
    with connect(path) as c:
        c.execute("PRAGMA journal_mode=WAL")  # persistent in the DB file
        c.executescript(SCHEMA)
        if c.execute("SELECT 1 FROM pipeline").fetchone() is None:
            demo = json.loads((ROOT / "samples" / "demo.json").read_text())
            pid = c.execute("INSERT INTO pipeline (name, description, config) VALUES (?,?,?)",
                            (demo["name"], demo["description"], json.dumps(demo["config"]))).lastrowid
            for rc in demo["run_configs"]:
                c.execute("INSERT INTO run_config (pipeline_id, name, params, stages, created_by) VALUES (?,?,?,?,'seed')",
                          (pid, rc["name"], json.dumps(rc["params"]), json.dumps(rc["stages"])))
