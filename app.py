import os
import re
import json
import time
import requests
from collections import defaultdict
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Flask, Response, request, session, jsonify, send_from_directory, abort
from dotenv import load_dotenv

from db import init_db, get_db

load_dotenv()

HTML_ROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'output', 'html')
CACHE_ROOT = os.path.join(HTML_ROOT, 'map_data')
UPSTREAM = 'https://map.projectzomboid.com/maps/41.78.16/'
TILE_HEADERS = {'User-Agent': 'Mozilla/5.0'}

USERNAME_RE = re.compile(r'^[A-Za-z0-9_\-]{3,32}$')

app = Flask(__name__)
secret_key = os.environ.get('SECRET_KEY')
if not secret_key or secret_key == 'change-me-to-a-random-string':
    raise RuntimeError(
        'SECRET_KEY is missing or still the placeholder value in .env — '
        'generate a real one (e.g. `python -c "import secrets; print(secrets.token_hex(32))"`) '
        'before running this publicly. A predictable secret lets anyone forge a session cookie.'
    )
app.secret_key = secret_key
init_db()


# ---- rate limiting (simple in-memory sliding window; fine for a single
# waitress process serving a handful of real users — not meant to survive
# a restart or scale past one process) ----

RATE_LIMIT_WINDOW_SECONDS = 600
RATE_LIMIT_MAX_ATTEMPTS = 8
_rate_limit_hits = defaultdict(list)


def rate_limited(bucket):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            key = (bucket, request.remote_addr)
            now = time.time()
            hits = _rate_limit_hits[key]
            hits[:] = [t for t in hits if now - t < RATE_LIMIT_WINDOW_SECONDS]
            if len(hits) >= RATE_LIMIT_MAX_ATTEMPTS:
                return jsonify({'error': 'rate_limited'}), 429
            hits.append(now)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


@app.after_request
def add_security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'DENY'
    return resp


# ---- auth helpers ----

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'not_authenticated'}), 401
        return fn(*args, **kwargs)
    return wrapper


def current_user(conn):
    if not session.get('user_id'):
        return None
    return conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()


# ---- auth routes ----

@app.route('/api/factions')
def list_factions():
    with get_db() as conn:
        rows = conn.execute('SELECT id, key, name, color FROM factions ORDER BY id').fetchall()
        return jsonify([dict(r) for r in rows])


@app.route('/api/auth/register', methods=['POST'])
@rate_limited('register')
def register():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    faction_key = data.get('faction') or ''
    faction_password = data.get('faction_password') or ''
    discord_id = (data.get('discord_id') or '').strip() or None

    if not USERNAME_RE.match(username):
        return jsonify({'error': 'invalid_username'}), 400
    if len(password) < 6:
        return jsonify({'error': 'password_too_short'}), 400

    with get_db() as conn:
        faction = conn.execute('SELECT * FROM factions WHERE key = ?', (faction_key,)).fetchone()
        if not faction:
            return jsonify({'error': 'invalid_faction'}), 400
        if not faction['password_hash'] or not check_password_hash(faction['password_hash'], faction_password):
            # each faction has its own shared password (told to members out-of-band,
            # e.g. in Discord) proving they're actually eligible to join it
            return jsonify({'error': 'invalid_faction_password'}), 400
        if conn.execute('SELECT 1 FROM users WHERE username = ?', (username,)).fetchone():
            return jsonify({'error': 'username_taken'}), 409

        is_deputy = 0
        is_leader = 0

        password_hash = generate_password_hash(password)
        cur = conn.execute(
            'INSERT INTO users (username, password_hash, discord_id, faction_id, is_deputy, is_leader) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            (username, password_hash, discord_id, faction['id'], is_deputy, is_leader),
        )
        session['user_id'] = cur.lastrowid
        return jsonify({'ok': True, 'username': username, 'faction': faction['key']})


@app.route('/api/auth/login', methods=['POST'])
@rate_limited('login')
def login():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    with get_db() as conn:
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'error': 'invalid_credentials'}), 401
        session['user_id'] = user['id']
        faction = conn.execute('SELECT * FROM factions WHERE id = ?', (user['faction_id'],)).fetchone()
        return jsonify({'ok': True, 'username': user['username'], 'faction': faction['key']})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/me')
def me():
    with get_db() as conn:
        user = current_user(conn)
        if not user:
            return jsonify({'authenticated': False})
        faction = conn.execute('SELECT * FROM factions WHERE id = ?', (user['faction_id'],)).fetchone()
        return jsonify({
            'authenticated': True,
            'id': user['id'],
            'username': user['username'],
            'faction': faction['key'],
            'faction_id': faction['id'],
            'faction_name': faction['name'],
            'faction_color': faction['color'],
            'is_deputy': bool(user['is_deputy']),
            'is_leader': bool(user['is_leader']),
        })


# ---- marks ----

VISIBILITY_VALUES = {'public', 'faction', 'private'}


def mark_row_to_dict(row):
    obj = json.loads(row['geometry_json'])
    obj['id'] = row['id']
    return {
        'id': row['id'],
        'visibility': row['visibility'],
        'faction_id': row['faction_id'],
        'owner_user_id': row['owner_user_id'],
        'owner_username': row['owner_username'],
        'mark': obj,
    }


@app.route('/api/marks')
@login_required
def list_marks():
    with get_db() as conn:
        user = current_user(conn)
        rows = conn.execute(
            '''SELECT marks.*, users.username AS owner_username FROM marks
               JOIN users ON users.id = marks.owner_user_id
               WHERE marks.visibility = 'public'
                  OR (marks.visibility = 'faction' AND marks.faction_id = ?)
                  OR (marks.visibility = 'private' AND marks.owner_user_id = ?)''',
            (user['faction_id'], user['id']),
        ).fetchall()
        return jsonify([mark_row_to_dict(r) for r in rows])


@app.route('/api/marks', methods=['POST'])
@login_required
def save_marks():
    data = request.get_json(force=True, silent=True) or {}
    marks = data.get('marks') or []
    visibility = data.get('visibility', 'faction')
    if visibility not in VISIBILITY_VALUES:
        return jsonify({'error': 'invalid_visibility'}), 400
    if not isinstance(marks, list):
        return jsonify({'error': 'invalid_marks'}), 400

    with get_db() as conn:
        user = current_user(conn)
        saved = 0
        for mark in marks:
            mark_id = mark.get('id')
            if not mark_id or not isinstance(mark_id, str):
                continue
            existing = conn.execute(
                'SELECT owner_user_id FROM marks WHERE id = ?', (mark_id,)
            ).fetchone()
            if existing and existing['owner_user_id'] != user['id'] and not user['is_deputy']:
                continue  # only owner or a faction deputy may overwrite
            conn.execute(
                '''INSERT INTO marks (id, owner_user_id, faction_id, visibility, type, name, desc, icon, geometry_json, layer, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(id) DO UPDATE SET
                     visibility=excluded.visibility, type=excluded.type, name=excluded.name,
                     desc=excluded.desc, icon=excluded.icon, geometry_json=excluded.geometry_json,
                     layer=excluded.layer, updated_at=datetime('now')''',
                (
                    mark_id, user['id'], user['faction_id'], visibility,
                    mark.get('type', 'point'), mark.get('name', ''), mark.get('desc', ''),
                    mark.get('icon'), json.dumps(mark), mark.get('layer', 0),
                ),
            )
            saved += 1
        return jsonify({'ok': True, 'saved': saved})


@app.route('/api/marks/<mark_id>', methods=['DELETE'])
@login_required
def delete_mark(mark_id):
    with get_db() as conn:
        user = current_user(conn)
        row = conn.execute('SELECT * FROM marks WHERE id = ?', (mark_id,)).fetchone()
        if not row:
            return jsonify({'error': 'not_found'}), 404
        is_owner = row['owner_user_id'] == user['id']
        is_faction_deputy = user['is_deputy'] and row['faction_id'] == user['faction_id']
        if not (is_owner or is_faction_deputy):
            return jsonify({'error': 'forbidden'}), 403
        conn.execute('DELETE FROM marks WHERE id = ?', (mark_id,))
        return jsonify({'ok': True})


# ---- territory painting ----

MAX_BBOX_SQUARES = 200_000  # guardrail: refuse absurdly large bbox requests

# Preset palette territory can be painted with, instead of a free color picker.
# Validated server-side too so a direct API call can't smuggle an arbitrary color.
TERRITORY_PALETTE = {
    '#e74c3c', '#9b59b6', '#3498db', '#e67e22',
    '#7f8c8d', '#2ecc71', '#f1c40f', '#1abc9c',
}
TERRITORY_VISIBILITY_VALUES = {'faction', 'public'}


@app.route('/api/territory')
@login_required
def list_territory():
    try:
        layer = int(request.args.get('layer', 0))
        x0 = int(request.args.get('x0'))
        y0 = int(request.args.get('y0'))
        x1 = int(request.args.get('x1'))
        y1 = int(request.args.get('y1'))
    except (TypeError, ValueError):
        return jsonify({'error': 'invalid_bbox'}), 400
    if x1 < x0 or y1 < y0 or (x1 - x0) * (y1 - y0) > MAX_BBOX_SQUARES:
        return jsonify({'error': 'bbox_too_large'}), 400

    with get_db() as conn:
        user = current_user(conn)
        rows = conn.execute(
            '''SELECT ts.sq_x, ts.sq_y, ts.faction_id, f.key AS faction_key,
                      COALESCE(ts.color, f.color) AS color,
                      u.username, ts.painted_by_user_id, ts.painted_at, ts.paint_type, ts.visibility
               FROM territory_squares ts
               JOIN factions f ON f.id = ts.faction_id
               JOIN users u ON u.id = ts.painted_by_user_id
               WHERE ts.layer = ? AND ts.sq_x BETWEEN ? AND ? AND ts.sq_y BETWEEN ? AND ?
                 AND (ts.visibility = 'public'
                      OR (ts.visibility = 'faction' AND ts.faction_id = ?))''',
            (layer, x0, x1, y0, y1, user['faction_id']),
        ).fetchall()
        return jsonify([dict(r) for r in rows])


@app.route('/api/territory/paint', methods=['POST'])
@login_required
def paint_territory():
    data = request.get_json(force=True, silent=True) or {}
    layer = data.get('layer', 0)
    squares = data.get('squares') or []
    erase = bool(data.get('erase'))
    if not isinstance(squares, list) or len(squares) > 2000:
        return jsonify({'error': 'invalid_squares'}), 400

    with get_db() as conn:
        user = current_user(conn)
        if erase:
            for sq in squares:
                sx, sy = sq.get('x'), sq.get('y')
                if sx is None or sy is None:
                    continue
                row = conn.execute(
                    'SELECT faction_id, painted_by_user_id FROM territory_squares WHERE layer=? AND sq_x=? AND sq_y=?',
                    (layer, sx, sy),
                ).fetchone()
                if not row:
                    continue
                is_owner = row['painted_by_user_id'] == user['id']
                is_faction_deputy = user['is_deputy'] and row['faction_id'] == user['faction_id']
                if is_owner or is_faction_deputy:
                    conn.execute('DELETE FROM territory_squares WHERE layer=? AND sq_x=? AND sq_y=?', (layer, sx, sy))
        else:
            for sq in squares:
                sx, sy = sq.get('x'), sq.get('y')
                if sx is None or sy is None:
                    continue
                raw_type = sq.get('paint_type') or ''
                paint_type = str(raw_type)[:100]
                raw_color = sq.get('color')
                color = raw_color if raw_color in TERRITORY_PALETTE else None
                raw_visibility = sq.get('visibility')
                visibility = raw_visibility if raw_visibility in TERRITORY_VISIBILITY_VALUES else 'faction'
                conn.execute(
                    '''INSERT INTO territory_squares (layer, sq_x, sq_y, faction_id, painted_by_user_id, paint_type, color, visibility)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(layer, sq_x, sq_y) DO UPDATE SET
                         faction_id=excluded.faction_id, painted_by_user_id=excluded.painted_by_user_id,
                         paint_type=excluded.paint_type, color=excluded.color, visibility=excluded.visibility,
                         painted_at=datetime('now')''',
                    (layer, sx, sy, user['faction_id'], user['id'], paint_type, color, visibility),
                )
        return jsonify({'ok': True, 'count': len(squares)})


# ---- map tile proxy (from proxy_server.py) ----

@app.route('/map_data/<path:subpath>')
def map_data(subpath):
    local_path = os.path.join(CACHE_ROOT, subpath)
    if os.path.isfile(local_path):
        return send_from_directory(CACHE_ROOT, subpath)

    resp = requests.get(UPSTREAM + subpath, headers=TILE_HEADERS, timeout=30)
    if resp.status_code != 200:
        abort(resp.status_code)

    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, 'wb') as f:
        f.write(resp.content)
    return Response(resp.content, mimetype=resp.headers.get('Content-Type', 'application/octet-stream'))


# ---- static files ----

@app.route('/', defaults={'path': 'pzmap.html'})
@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(HTML_ROOT, path)


if __name__ == '__main__':
    from waitress import serve
    print('Serving on http://localhost:8880/pzmap.html')
    # waitress defaults to 4 worker threads, which starves API requests
    # (register/paint/marks) behind the flood of concurrent tile/icon GETs
    # every pan/zoom triggers — everything queues up and looks like saving
    # is broken when it's actually just stuck behind slow tile fetches.
    serve(app, host='0.0.0.0', port=8880, threads=32)
