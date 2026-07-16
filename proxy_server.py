"""Proxy the official map.projectzomboid.com pre-rendered vanilla map so the
local pzmap.html viewer works instantly without a local render pass.

The official site serves the exact pzmap2dzi output layout under
/maps/<build>/... which matches this project's map_data/ layout 1:1
(same tool, same git commit). We proxy map_data/* requests to it and
cache each fetched file to disk so repeat visits are fully local.
"""
import os
import requests
from flask import Flask, Response, send_from_directory, abort

HTML_ROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'output', 'html')
CACHE_ROOT = os.path.join(HTML_ROOT, 'map_data')
UPSTREAM = 'https://map.projectzomboid.com/maps/41.78.16/'
HEADERS = {'User-Agent': 'Mozilla/5.0'}

app = Flask(__name__)


@app.route('/map_data/<path:subpath>')
def map_data(subpath):
    local_path = os.path.join(CACHE_ROOT, subpath)
    if os.path.isfile(local_path):
        return send_from_directory(CACHE_ROOT, subpath)

    upstream_url = UPSTREAM + subpath
    resp = requests.get(upstream_url, headers=HEADERS, timeout=30)
    if resp.status_code != 200:
        abort(resp.status_code)

    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, 'wb') as f:
        f.write(resp.content)

    content_type = resp.headers.get('Content-Type', 'application/octet-stream')
    return Response(resp.content, mimetype=content_type)


@app.route('/', defaults={'path': 'pzmap.html'})
@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(HTML_ROOT, path)


if __name__ == '__main__':
    from waitress import serve
    print('Serving on http://localhost:8880/pzmap.html (proxying vanilla map from map.projectzomboid.com)')
    serve(app, host='0.0.0.0', port=8880)
