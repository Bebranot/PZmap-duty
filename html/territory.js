// Faction territory painting overlay. Two modes: Selection Box (press-drag-release)
// and Brush (click/drag). Tooltip on hover shows author, date, paint type.
// Talks to /api/territory (see app.py).
(function () {
    'use strict';

    const MAX_BOX_CELLS = 44;   // max 44x44 = 1936 cells per box-select
    const BATCH_SIZE = 2000;    // API limit per request

    // Preset color palette — keep in sync with TERRITORY_PALETTE in app.py.
    // Deliberately not a free color picker: territory colors are a curated
    // set, not "paint anything".
    const PALETTE = [
        '#e74c3c', '#9b59b6', '#3498db', '#e67e22',
        '#7f8c8d', '#2ecc71', '#f1c40f', '#1abc9c',
    ];

    let mode = 'box';           // 'box' or 'brush'
    let paintMode = false;
    let erasing = false;
    let squares = new Map();    // key "layer:x:y" -> {faction_id, color, username, painted_at, paint_type}
    let canvas, ctx;
    let loadTimer = null;
    let panel = null;

    // box-select state
    let boxStart = null;        // [sx, sy] grid coords on press
    let boxEnd = null;          // [sx, sy] grid coords during drag
    let isDragging = false;

    // tooltip state
    let tooltipEl = null;
    let lastHoverKey = null;

    // paint options from the floating panel
    let currentPaintType = '';
    let currentPaintColor = null; // set to the user's faction color once known

    // middle-mouse-button pan state
    let mmbPanning = false;
    let mmbLastX = 0;
    let mmbLastY = 0;

    function key(layer, x, y) { return layer + ':' + x + ':' + y; }

    function ensureCanvas() {
        if (canvas) return;
        const mapDiv = document.getElementById('map_div');
        canvas = document.createElement('canvas');
        canvas.id = 'territory-canvas';
        canvas.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:5;';
        mapDiv.appendChild(canvas);
        ctx = canvas.getContext('2d');
    }

    function resizeCanvas() {
        const mapDiv = document.getElementById('map_div');
        canvas.width = mapDiv.clientWidth * window.devicePixelRatio;
        canvas.height = mapDiv.clientHeight * window.devicePixelRatio;
    }

    function gridToPixel(g, viewer, c, gx, gy) {
        const vp = c.getViewportPointBySquare(viewer, g.base_map, gx, gy, g.currentLayer);
        return viewer.viewport.pixelFromPoint(vp, true);
    }

    // Grid-space -> screen-space basis vectors for the current view. In top-down
    // view these are simple axis-aligned (Ex = (step, 0), Ey = (0, step)), but in
    // isometric view a +1 step in x and a +1 step in y are each independent
    // diagonal vectors — a game-grid cell is a skewed parallelogram on screen,
    // not an axis-aligned square. Every corner must be built from these two
    // vectors (origin + x*Ex + y*Ey); treating x and y as independent screen
    // axes (as if the grid were always orthogonal) is what produced the
    // misaligned/overlapping little squares in iso view.
    function computeGridBasis(g, viewer, c, dpr) {
        const o = gridToPixel(g, viewer, c, 0, 0);
        const ex = gridToPixel(g, viewer, c, 1, 0);
        const ey = gridToPixel(g, viewer, c, 0, 1);
        return {
            ox: o.x * dpr, oy: o.y * dpr,
            exX: (ex.x - o.x) * dpr, exY: (ex.y - o.y) * dpr,
            eyX: (ey.x - o.x) * dpr, eyY: (ey.y - o.y) * dpr,
        };
    }

    function cellCorner(basis, x, y) {
        return {
            x: basis.ox + x * basis.exX + y * basis.eyX,
            y: basis.oy + x * basis.exY + y * basis.eyY,
        };
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return [r, g, b];
    }

    function sameColorAt(layer, x, y, color) {
        const sq = squares.get(key(layer, x, y));
        return !!sq && sq.color === color;
    }

    function quadPath(ctx, basis, x0, y0, x1, y1) {
        // (x0,y0)-(x1,y1) is a grid-space rectangle; on screen it's a
        // parallelogram (or, in top view, a plain rectangle) built from the
        // same basis vectors as every other cell so edges always line up.
        const p00 = cellCorner(basis, x0, y0);
        const p10 = cellCorner(basis, x1, y0);
        const p11 = cellCorner(basis, x1, y1);
        const p01 = cellCorner(basis, x0, y1);
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
    }

    function redraw(g, viewer, c) {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!squares.size && !isDragging) return;
        const dpr = window.devicePixelRatio;
        const layer = g.currentLayer;
        const basis = computeGridBasis(g, viewer, c, dpr);

        // Collect cells by color
        const cellsByColor = new Map();
        for (const [k, sq] of squares) {
            const [l, x, y] = k.split(':').map(Number);
            if (l !== layer) continue;
            if (!cellsByColor.has(sq.color)) cellsByColor.set(sq.color, []);
            cellsByColor.get(sq.color).push({ x, y });
        }

        // Draw each color group as one unified zone
        for (const [color, cells] of cellsByColor) {
            const [cr, cg, cb] = hexToRgb(color);

            // Pass 1: flat translucent fill; single path + single fill so
            // alpha never stacks between cells of the same zone
            ctx.beginPath();
            for (const { x, y } of cells) {
                quadPath(ctx, basis, x, y, x + 1, y + 1);
            }
            ctx.fillStyle = `rgba(${cr},${cg},${cb},0.4)`;
            ctx.fill();

            // Pass 2: glow stroke along the outer boundary only. Each edge is
            // drawn between the two grid-space corners that actually bound
            // it, so in iso view the "left" edge is the diagonal from
            // (x,y) to (x,y+1), not a vertical line.
            ctx.beginPath();
            for (const { x, y } of cells) {
                const p00 = cellCorner(basis, x, y);
                const p10 = cellCorner(basis, x + 1, y);
                const p11 = cellCorner(basis, x + 1, y + 1);
                const p01 = cellCorner(basis, x, y + 1);
                if (!sameColorAt(layer, x - 1, y, color)) {
                    ctx.moveTo(p00.x, p00.y);
                    ctx.lineTo(p01.x, p01.y);
                }
                if (!sameColorAt(layer, x + 1, y, color)) {
                    ctx.moveTo(p10.x, p10.y);
                    ctx.lineTo(p11.x, p11.y);
                }
                if (!sameColorAt(layer, x, y - 1, color)) {
                    ctx.moveTo(p00.x, p00.y);
                    ctx.lineTo(p10.x, p10.y);
                }
                if (!sameColorAt(layer, x, y + 1, color)) {
                    ctx.moveTo(p01.x, p01.y);
                    ctx.lineTo(p11.x, p11.y);
                }
            }
            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = 10 * dpr;
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
            ctx.lineWidth = 2.5 * dpr;
            ctx.lineCap = 'square';
            ctx.stroke();
            ctx.stroke(); // second stroke intensifies the glow
            ctx.restore();
        }

        if (isDragging && boxStart && boxEnd) {
            const x0 = Math.min(boxStart[0], boxEnd[0]);
            const y0 = Math.min(boxStart[1], boxEnd[1]);
            const x1 = Math.max(boxStart[0], boxEnd[0]) + 1;
            const y1 = Math.max(boxStart[1], boxEnd[1]) + 1;
            ctx.beginPath();
            quadPath(ctx, basis, x0, y0, x1, y1);
            ctx.strokeStyle = erasing ? 'rgba(255,80,80,0.8)' : 'rgba(80,200,255,0.8)';
            ctx.lineWidth = 2 * dpr;
            ctx.setLineDash([6 * dpr, 4 * dpr]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = erasing ? 'rgba(255,80,80,0.12)' : 'rgba(80,200,255,0.12)';
            ctx.fill();
        }
    }

    async function loadVisible(g, viewer, c) {
        let bbox;
        try {
            const range = c.getCanvasRange(true);
            if (range.diffSum) {
                // Isometric view: the range is in rotated diff/sum coordinates
                // (diff = x - y, sum = x + y — see coordinates.js's Range
                // class), not plain x/y. The /api/territory endpoint only
                // understands a plain x/y box, so convert the diff/sum bounds
                // into the smallest axis-aligned x/y box that fully contains
                // the visible diamond. This used to just bail out entirely in
                // iso view (the default view!) so painted territory saved
                // fine but never got loaded back after a refresh/pan.
                const xs = [
                    (range.minDiff + range.minSum) / 2, (range.minDiff + range.maxSum) / 2,
                    (range.maxDiff + range.minSum) / 2, (range.maxDiff + range.maxSum) / 2,
                ];
                const ys = [
                    (range.minSum - range.minDiff) / 2, (range.minSum - range.maxDiff) / 2,
                    (range.maxSum - range.minDiff) / 2, (range.maxSum - range.maxDiff) / 2,
                ];
                bbox = {
                    x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)),
                    x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)),
                };
            } else {
                bbox = { x0: Math.floor(range.minX), y0: Math.floor(range.minY), x1: Math.ceil(range.maxX), y1: Math.ceil(range.maxY) };
            }
        } catch (e) {
            return;
        }
        const layer = g.currentLayer;
        const qs = new URLSearchParams({ layer, x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 });
        const resp = await fetch('/api/territory?' + qs.toString(), { credentials: 'same-origin' });
        if (!resp.ok) return;
        const rows = await resp.json();
        for (const row of rows) {
            squares.set(key(layer, row.sq_x, row.sq_y), {
                faction_id: row.faction_id,
                color: row.color,
                username: row.username || '',
                painted_at: row.painted_at || '',
                paint_type: row.paint_type || '',
            });
        }
        redraw(g, viewer, c);
    }

    function scheduleLoad(g, viewer, c) {
        clearTimeout(loadTimer);
        loadTimer = setTimeout(() => loadVisible(g, viewer, c), 300);
    }

    async function sendBatch(layer, cells, erase) {
        for (let i = 0; i < cells.length; i += BATCH_SIZE) {
            const batch = cells.slice(i, i + BATCH_SIZE);
            await fetch('/api/territory/paint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ layer, squares: batch, erase }),
            });
        }
    }

    async function paintAt(g, c, event) {
        const [sx, sy] = c.getSquare(event);
        const layer = g.currentLayer;
        const k = key(layer, sx, sy);
        const body = { x: sx, y: sy };
        if (!erasing) {
            body.paint_type = currentPaintType;
            body.color = currentPaintColor;
            body.visibility = window.PZMAP_SCOPE || 'faction';
        }

        if (erasing) {
            squares.delete(k);
        } else {
            squares.set(k, {
                color: currentPaintColor || window.PZMAP_USER.faction_color,
                username: window.PZMAP_USER.username,
                painted_at: new Date().toISOString(),
                paint_type: currentPaintType,
            });
        }
        await fetch('/api/territory/paint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ layer, squares: [body], erase: erasing }),
        });
    }

    function cellsInBox(x0, y0, x1, y1) {
        const cells = [];
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
                cells.push({ x, y });
            }
        }
        return cells;
    }

    async function commitBox(g, c) {
        if (!boxStart || !boxEnd) return;
        const x0 = boxStart[0], y0 = boxStart[1];
        const x1 = boxEnd[0], y1 = boxEnd[1];
        const w = Math.abs(x1 - x0) + 1;
        const h = Math.abs(y1 - y0) + 1;

        if (w > MAX_BOX_CELLS || h > MAX_BOX_CELLS) {
            showBoxWarning('Зона слишком большая (макс. ' + MAX_BOX_CELLS + '×' + MAX_BOX_CELLS + ')');
            return;
        }

        const layer = g.currentLayer;
        const myColor = currentPaintColor || window.PZMAP_USER.faction_color;
        const allCells = cellsInBox(x0, y0, x1, y1);
        const toPaint = [];

        for (const cell of allCells) {
            const k = key(layer, cell.x, cell.y);
            if (erasing) {
                const sq = squares.get(k);
                if (sq) {
                    squares.delete(k);
                    toPaint.push({ x: cell.x, y: cell.y });
                }
            } else {
                const sq = squares.get(k);
                if (sq && sq.color === myColor) continue;
                squares.set(k, {
                    color: myColor,
                    username: window.PZMAP_USER.username,
                    painted_at: new Date().toISOString(),
                    paint_type: currentPaintType,
                });
                toPaint.push({
                    x: cell.x, y: cell.y, paint_type: currentPaintType, color: myColor,
                    visibility: window.PZMAP_SCOPE || 'faction',
                });
            }
        }

        if (toPaint.length) {
            await sendBatch(layer, toPaint, erasing);
        }
        redraw(g, window.g.viewer, c);
    }

    function showBoxWarning(msg) {
        let el = document.getElementById('territory-warning');
        if (!el) {
            el = document.createElement('div');
            el.id = 'territory-warning';
            el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#e74c3c;color:#fff;padding:12px 24px;border-radius:8px;font-family:sans-serif;font-size:14px;z-index:99999;pointer-events:none;animation:tw-fade 2s forwards;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
    }

    function ensureTooltip() {
        if (tooltipEl) return;
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'territory-tooltip';
        tooltipEl.style.cssText = 'position:fixed;display:none;background:#1c1c22;color:#eee;border:1px solid #555;border-radius:6px;padding:8px 12px;font-family:sans-serif;font-size:12px;z-index:99999;pointer-events:none;max-width:220px;box-shadow:0 4px 10px rgba(0,0,0,0.5);';
        document.body.appendChild(tooltipEl);
    }

    function showTooltip(mx, my, sq) {
        ensureTooltip();
        tooltipEl.innerHTML = '';
        const lines = [];
        if (sq.username) lines.push('Автор: ' + sq.username);
        if (sq.painted_at) lines.push('Дата: ' + sq.painted_at);
        if (sq.paint_type) lines.push('Тип: ' + sq.paint_type);
        lines.forEach((line, i) => {
            const div = document.createElement('div');
            if (i === 0 && sq.color) {
                const dot = document.createElement('span');
                dot.className = 'tt-swatch';
                dot.style.background = sq.color;
                div.appendChild(dot);
            }
            div.appendChild(document.createTextNode(line));
            tooltipEl.appendChild(div);
        });
        if (!lines.length) {
            tooltipEl.style.display = 'none';
            return;
        }
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = (mx + 14) + 'px';
        tooltipEl.style.top = (my + 14) + 'px';
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.style.display = 'none';
        lastHoverKey = null;
    }

    function handleMouseMove(g, c, event) {
        if (!paintMode) { hideTooltip(); return; }
        try {
            const [sx, sy] = c.getSquare(event);
            const k = key(g.currentLayer, sx, sy);
            const sq = squares.get(k);
            if (sq) {
                const mx = event.originalEvent ? event.originalEvent.clientX : event.clientX;
                const my = event.originalEvent ? event.originalEvent.clientY : event.clientY;
                showTooltip(mx, my, sq);
                lastHoverKey = k;
            } else {
                hideTooltip();
            }
        } catch (e) {
            hideTooltip();
        }
    }

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }

    // Floating panel with the color palette + zone name/type, styled and
    // animated the same way as #marker-panel (see .floating-panel in
    // pzmap.css). Built once and toggled open/closed with paint mode.
    function buildPanel() {
        const swatches = PALETTE.map((color) => `
      <button class="tp-swatch" data-color="${color}" style="background:${color};" title="${color}"></button>
    `).join('');

        panel = el(`
      <div id="territory-panel" class="floating-panel">
        <div class="mk-header">Закраска территории</div>

        <div class="mk-section">
          <div class="mk-label">Цвет</div>
          <div class="tp-palette">${swatches}</div>
        </div>

        <div class="mk-section">
          <div class="territory-paint-type">
            <label class="territory-type-label">Тип закраски</label>
            <select id="territory-paint-type-select" class="territory-type-select">
              <option value="">Без типа</option>
              <option value="Домашняя зона">Домашняя зона</option>
              <option value="Фракция">Фракция</option>
              <option value="Ресурсная зона">Ресурсная зона</option>
              <option value="Безопасная зона">Безопасная зона</option>
              <option value="Зона PvP">Зона PvP</option>
              <option value="__custom">Свой вариант...</option>
            </select>
            <input type="text" id="territory-paint-type-input" class="territory-type-input"
                   placeholder="Введите тип..." maxlength="100" style="display:none;">
          </div>
        </div>

        <div class="mk-hint">Выделение: зажми ЛКМ и потяни. Кисть: клик/протяжка.<br>СКМ — перемещение карты.</div>
      </div>
    `);
        document.body.appendChild(panel);

        panel.querySelectorAll('.tp-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.tp-swatch').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                currentPaintColor = btn.dataset.color;
            });
        });

        // default selection: the user's own faction color, if it happens to
        // be one of the preset swatches
        if (window.PZMAP_USER && window.PZMAP_USER.faction_color) {
            currentPaintColor = window.PZMAP_USER.faction_color;
            const match = panel.querySelector(`.tp-swatch[data-color="${currentPaintColor}"]`);
            if (match) match.classList.add('active');
        }
    }

    function addToolbar() {
        const paintBtn = document.getElementById('territory_paint_btn');
        const eraseBtn = document.getElementById('territory_erase_btn');
        const modeBtn = document.getElementById('territory_mode_btn');
        const paintTypeSelect = document.getElementById('territory-paint-type-select');
        const paintTypeInput = document.getElementById('territory-paint-type-input');

        paintBtn.addEventListener('click', () => {
            paintMode = !paintMode;
            paintBtn.classList.toggle('active', paintMode);
            panel.classList.toggle('fp-open', paintMode);
            if (!paintMode && erasing) {
                erasing = false;
                eraseBtn.classList.remove('active');
            }
            if (!paintMode) hideTooltip();
        });

        eraseBtn.addEventListener('click', () => {
            if (!paintMode) {
                paintMode = true;
                paintBtn.classList.add('active');
            }
            erasing = !erasing;
            eraseBtn.classList.toggle('active', erasing);
        });

        modeBtn.addEventListener('click', () => {
            mode = mode === 'box' ? 'brush' : 'box';
            modeBtn.textContent = mode === 'box' ? 'Режим: Выделение' : 'Режим: Кисть';
            modeBtn.classList.toggle('active-brush', mode === 'brush');
        });

        if (paintTypeSelect) {
            paintTypeSelect.addEventListener('change', () => {
                const val = paintTypeSelect.value;
                if (val === '__custom') {
                    paintTypeInput.style.display = 'block';
                    paintTypeInput.focus();
                    currentPaintType = paintTypeInput.value.trim();
                } else {
                    paintTypeInput.style.display = 'none';
                    currentPaintType = val;
                }
            });
        }
        if (paintTypeInput) {
            paintTypeInput.addEventListener('input', () => {
                currentPaintType = paintTypeInput.value.trim();
            });
            paintTypeInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
        }
    }

    // Pan the map on middle-mouse-button drag (OSD only wires left-drag by
    // default; the browser's native middle-click autoscroll is suppressed
    // by preventDefault() on mousedown).
    function initMiddleMousePan(viewer) {
        const mapDiv = document.getElementById('map_div');
        mapDiv.addEventListener('mousedown', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            mmbPanning = true;
            mmbLastX = e.clientX;
            mmbLastY = e.clientY;
        });
        window.addEventListener('mousemove', (e) => {
            if (!mmbPanning) return;
            e.preventDefault();
            const dx = e.clientX - mmbLastX;
            const dy = e.clientY - mmbLastY;
            mmbLastX = e.clientX;
            mmbLastY = e.clientY;
            const delta = viewer.viewport.deltaPointsFromPixels(
                new OpenSeadragon.Point(-dx, -dy), true
            );
            viewer.viewport.panBy(delta, true);
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 1) mmbPanning = false;
        });
        // stop the browser's native middle-click autoscroll cursor/menu
        mapDiv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
        mapDiv.addEventListener('contextmenu', (e) => { if (mmbPanning) e.preventDefault(); });
    }

    async function init() {
        while (!window.g || !window.g.viewer || !window.c) {
            await new Promise((r) => setTimeout(r, 200));
        }
        const g = window.g, viewer = window.g.viewer, c = window.c;
        ensureCanvas();
        resizeCanvas();
        buildPanel();
        addToolbar();
        initMiddleMousePan(viewer);

        viewer.addHandler('update-viewport', () => {
            resizeCanvas();
            redraw(g, viewer, c);
            scheduleLoad(g, viewer, c);
        });

        // --- Selection Box mode ---
        viewer.addHandler('canvas-press', (event) => {
            if (!paintMode || mode !== 'box') return;
            event.preventDefaultAction = true;
            try {
                boxStart = c.getSquare(event);
                boxEnd = boxStart;
                isDragging = true;
            } catch (e) { /* ignore */ }
        });

        viewer.addHandler('canvas-drag', (event) => {
            if (!paintMode) return;
            event.preventDefaultAction = true;
            if (mode === 'box' && isDragging) {
                try {
                    boxEnd = c.getSquare(event);
                    redraw(g, viewer, c);
                } catch (e) { /* ignore */ }
            } else if (mode === 'brush') {
                paintAt(g, c, event).then(() => redraw(g, viewer, c));
            }
        });

        viewer.addHandler('canvas-release', (event) => {
            if (!paintMode || mode !== 'box') return;
            event.preventDefaultAction = true;
            if (isDragging) {
                try {
                    boxEnd = c.getSquare(event);
                } catch (e) { /* ignore */ }
                isDragging = false;
                commitBox(g, c).then(() => {
                    boxStart = null;
                    boxEnd = null;
                    redraw(g, viewer, c);
                });
            }
        });

        // --- Brush mode click handler ---
        viewer.addHandler('canvas-click', (event) => {
            if (!paintMode || mode !== 'brush') return;
            event.preventDefaultAction = true;
            paintAt(g, c, event).then(() => redraw(g, viewer, c));
        });

        // --- Tooltip on mouse move (DOM event, not OSD) ---
        const mapDiv = document.getElementById('map_div');
        mapDiv.addEventListener('mousemove', (e) => {
            if (!paintMode) { hideTooltip(); return; }
            const rect = mapDiv.getBoundingClientRect();
            const fakeEvent = {
                position: {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                },
                originalEvent: e,
            };
            handleMouseMove(g, c, fakeEvent);
        });
        mapDiv.addEventListener('mouseleave', () => { hideTooltip(); });

        scheduleLoad(g, viewer, c);
    }

    document.addEventListener('pzmap-authenticated', () => { init(); });
    if (window.PZMAP_USER) init();
})();
