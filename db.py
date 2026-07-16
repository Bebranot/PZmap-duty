import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'data', 'pzmap.db')

SCHEMA = """
CREATE TABLE IF NOT EXISTS factions (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    discord_role_id TEXT,
    discord_leader_role_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    discord_id TEXT,
    faction_id INTEGER NOT NULL REFERENCES factions(id),
    is_deputy INTEGER NOT NULL DEFAULT 0,
    is_leader INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS territory_squares (
    layer INTEGER NOT NULL,
    sq_x INTEGER NOT NULL,
    sq_y INTEGER NOT NULL,
    faction_id INTEGER NOT NULL REFERENCES factions(id),
    painted_by_user_id INTEGER NOT NULL REFERENCES users(id),
    painted_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (layer, sq_x, sq_y)
);
CREATE INDEX IF NOT EXISTS idx_territory_bbox ON territory_squares(layer, sq_x, sq_y);

CREATE TABLE IF NOT EXISTS marks (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    faction_id INTEGER NOT NULL REFERENCES factions(id),
    visibility TEXT NOT NULL DEFAULT 'faction' CHECK(visibility IN ('public', 'faction', 'private')),
    type TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    desc TEXT NOT NULL DEFAULT '',
    icon TEXT,
    geometry_json TEXT NOT NULL,
    layer INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_marks_faction ON marks(faction_id, visibility);
"""

FACTIONS = [
    # key, name, color, discord_role_id, discord_leader_role_id
    ('separatists', 'Сепаратисты', '#e74c3c', '1523625864628277248', '1524157778057367702'),
    ('stigmata', 'Стигматы', '#9b59b6', '1523626145415823371', '1524157884982759575'),
    ('syndicate', 'Синдикаты', '#3498db', '1523694009325981696', '1524157968218591243'),
    ('flagellants', 'Флагелланты', '#e67e22', '1523662395850096721', '1524158049139294333'),
    ('loners', 'Одиночки', '#7f8c8d', '1523659504179658', None),
]


@contextmanager
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript(SCHEMA)
        existing = {row['key'] for row in conn.execute('SELECT key FROM factions')}
        for key, name, color, role_id, leader_role_id in FACTIONS:
            if key not in existing:
                conn.execute(
                    'INSERT INTO factions (key, name, color, discord_role_id, discord_leader_role_id) '
                    'VALUES (?, ?, ?, ?, ?)',
                    (key, name, color, role_id, leader_role_id),
                )


if __name__ == '__main__':
    init_db()
    print('DB initialized at', DB_PATH)
