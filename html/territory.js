// Faction territory painting overlay. Loaded as a classic script after pzmap.js's
// modules are ready. Talks to /api/territory (see app.py) and reuses the existing
// coordinates.js helpers (c.getSquare, c.getViewportPointBySquare) for square<->pixel
// conversion so painted squares line up with the real in-game grid.
(function () {
    'use strict';

    let paintMode = false;
    let erasing = false;
    let squares = new Map(); // key "layer:x:y" -> {faction_id, color}
    let canvas, ctx;
    let loadTimer = null;
    let drawing = false;

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

    function squarePixelSize(g, viewer, c) {
        // size in canvas px of one square edge, from two adjacent square corners
        const p0 = c.getViewportPointBySquare(viewer, g.base_map, 0, 0, g.currentLayer);
        const p1 = c.getViewportPointBySquare(viewer, g.base_map, 1, 0, g.currentLayer);
        const px0 = viewer.viewport.pixelFromPoint(p0, true);
        const px1 = viewer.viewport.pixelFromPoint(p1, true);
        return Math.hypot(px1.x - px0.x, px1.y - px0.y) || 1;
    }

    function redraw(g, viewer, c) {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!squares.size) return;
        const dpr = window.devicePixelRatio;
        const size = squarePixelSize(g, viewer, c) * dpr;
        for (const [k, sq] of squares) {
            const [layer, x, y] = k.split(':').map(Number);
            if (layer !== g.currentLayer) continue;
            const vp = c.getViewportPointBySquare(viewer, g.base_map, x, y, layer);
            const px = viewer.viewport.pixelFromPoint(vp, true);
            ctx.fillStyle = sq.color + '80'; // ~50% alpha
            ctx.fillRect(px.x * dpr - size / 2, px.y * dpr - size / 2, size, size);
        }
    }

    async function loadVisible(g, viewer, c) {
        let bbox;
        try {
            const range = c.getCanvasRange(true);
            if (range.diffSum) return; // isometric view: bbox not supported yet, skip loading
            bbox = { x0: Math.floor(range.minX), y0: Math.floor(range.minY), x1: Math.ceil(range.maxX), y1: Math.ceil(range.maxY) };
        } catch (e) {
            return;
        }
        const layer = g.currentLayer;
        const qs = new URLSearchParams({ layer, x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 });
        const resp = await fetch('/api/territory?' + qs.toString(), { credentials: 'same-origin' });
        if (!resp.ok) return;
        const rows = await resp.json();
        for (const row of rows) {
            squares.set(key(layer, row.sq_x, row.sq_y), { faction_id: row.faction_id, color: row.color });
        }
        redraw(g, viewer, c);
    }

    function scheduleLoad(g, viewer, c) {
        clearTimeout(loadTimer);
        loadTimer = setTimeout(() => loadVisible(g, viewer, c), 300);
    }

    async function paintAt(g, c, event) {
        const [sx, sy] = c.getSquare(event);
        const layer = g.currentLayer;
        const body = { layer, squares: [{ x: sx, y: sy }], erase: erasing };
        squares.set(key(layer, sx, sy), erasing ? undefined : { color: window.PZMAP_USER.faction_color });
        if (erasing) squares.delete(key(layer, sx, sy));
        await fetch('/api/territory/paint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
        });
    }

    function addToolbar() {
        // buttons live in the "Наше" sidebar branch (pzmap.html), styled to
        // match the existing POIs/Streets/etc buttons via .sidebar-list CSS.
        const paintBtn = document.getElementById('territory_paint_btn');
        const eraseBtn = document.getElementById('territory_erase_btn');
        paintBtn.addEventListener('click', () => {
            paintMode = !paintMode;
            paintBtn.classList.toggle('active', paintMode);
            if (!paintMode && erasing) {
                erasing = false;
                eraseBtn.classList.remove('active');
            }
            // canvas stays pointer-events:none always so OSD's own canvas-click/
            // canvas-drag handlers (bound to the OSD canvas underneath) still fire;
            // we only use this canvas to draw the overlay, never to catch clicks.
        });
        eraseBtn.addEventListener('click', () => {
            if (!paintMode) return;
            erasing = !erasing;
            eraseBtn.classList.toggle('active', erasing);
        });
    }

    async function init() {
        // wait for pzmap.js's dynamic module imports to finish
        while (!window.g || !window.g.viewer || !window.c) {
            await new Promise((r) => setTimeout(r, 200));
        }
        const g = window.g, viewer = window.g.viewer, c = window.c;
        ensureCanvas();
        resizeCanvas();
        addToolbar();

        viewer.addHandler('update-viewport', () => {
            resizeCanvas();
            redraw(g, viewer, c);
            scheduleLoad(g, viewer, c);
        });
        viewer.addHandler('canvas-click', (event) => {
            if (!paintMode) return;
            event.preventDefaultAction = true;
            paintAt(g, c, event).then(() => redraw(g, viewer, c));
        });
        viewer.addHandler('canvas-drag', (event) => {
            if (!paintMode) return;
            event.preventDefaultAction = true;
            paintAt(g, c, event).then(() => redraw(g, viewer, c));
        });

        scheduleLoad(g, viewer, c);
    }

    document.addEventListener('pzmap-authenticated', () => { init(); });
    // if auth.js already fired the event before this script loaded, or user was
    // already authenticated on page load without a fresh event, try init anyway.
    if (window.PZMAP_USER) init();
})();
