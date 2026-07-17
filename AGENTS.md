# PZmap — AI Agent Notes

## Code style rule
- ALWAYS leave short explanatory comments at important/non-obvious places in code
  (coordinate math, event handling quirks, security-sensitive spots, API limits).
  They are for the next AI agent working on this repo.

## Architecture quick reference
- Backend: Flask (`app.py`) + SQLite (`db.py`). Run: `python app.py` (waitress, port 8880).
  `init_db()` runs at startup and contains explicit migrations (PRAGMA table_info + ALTER TABLE).
- Frontend: vanilla JS, no framework. OpenSeadragon map engine.
  - `html/territory.js` — faction territory painting (canvas overlay, box/brush modes, glow render).
  - `html/markers.js` — marker placement panel (icons, size S/M/L, color pickers).
  - `html/pzmap/mark/` — mark render pipeline: `mark.js` (toRenderFormat) → `render.js` → `osd_draw.js` / `svg_draw.js`.

## Gotchas (hard-won knowledge)
- `c.getViewportPointBySquare(x, y)` returns the CORNER of a cell, not the center.
  Cell (x,y) spans [point(x)..point(x+1)]. Treating it as center causes overlapping tiles.
- OSD events available: `canvas-press`, `canvas-drag`, `canvas-release`, `canvas-click`.
  There is NO `canvas-move` — use DOM `mousemove` on `#map_div` instead.
  Always set `event.preventDefaultAction = true` in paint handlers or OSD pans the map.
- `/api/territory/paint` rejects >2000 squares per request — client batches (see `sendBatch`).
- Marker icons are white silhouettes; tint via CSS `mask-image` + `background-color`
  (NOT filter/blend — inaccurate colors). See `osd_draw.js point()`.
- User text (paint_type, usernames) must go into DOM via `textContent`, never innerHTML (stored XSS).
- `paint_type` is validated server-side with `[:100]` truncation in `app.py`.
