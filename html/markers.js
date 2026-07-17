// Marker placement with an icon picker. Loaded as a classic script after
// pzmap.js/territory.js. Talks to /api/marks (see app.py) and the marker.js
// MarkManager (g.marker) so placed marks use the same rendering pipeline as
// everything else (see html/pzmap/mark/osd_draw.js's icon support).
(function () {
    'use strict';

    const ICONS = [
        'line', 'mapCross', 'map_apple', 'map_arroweast', 'map_arrownorth', 'map_arrownortheast',
        'map_arrownorthwest', 'map_arrowsouth', 'map_arrowsoutheast', 'map_arrowsouthwest', 'map_arrowwest',
        'map_asterisk', 'map_axe', 'map_boat', 'map_burger', 'map_checkmark', 'map_club', 'map_cross',
        'map_diamond', 'map_dollarsign', 'map_exclamation', 'map_facedead', 'map_facehappy', 'map_facesad',
        'map_firet', 'map_fish', 'map_garbage', 'map_gears', 'map_gun', 'map_heart', 'map_house',
        'map_knifefork', 'map_leaf', 'map_lightning', 'map_lock', 'map_medcross', 'map_moon', 'map_o',
        'map_pill', 'map_question', 'map_radiation', 'map_satellite', 'map_skull', 'map_spade', 'map_star',
        'map_sun', 'map_target', 'map_tent', 'map_trap', 'map_waves', 'map_wrench', 'map_x', 'map_z',
    ];

    let placing = false;
    let selectedIcon = null;
    let panel = null;

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }

    function buildPanel() {
        const grid = ICONS.map((name) => `
      <button class="marker-icon-choice" data-icon="${name}"
        style="width:32px; height:32px; padding:4px; background:#3e3d3d; border:none; border-radius:6px; cursor:pointer;">
        <img src="./pzmap/icons/${name}.png" style="width:100%; height:100%; image-rendering:pixelated;">
      </button>
    `).join('');
        panel = el(`
      <div id="marker-icon-panel" style="
          position:fixed; left:210px; top:16px; z-index:9998; display:none;
          background:#1c1c22; border:1px solid #444; border-radius:8px; padding:10px;
          max-width:280px; box-shadow:0 4px 10px rgba(0,0,0,0.4);">
        <div style="color:#eee; font-family:sans-serif; font-size:13px; margin-bottom:6px;">Выбери иконку, потом кликни по карте</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">${grid}</div>
      </div>
    `);
        document.body.appendChild(panel);
        panel.querySelectorAll('.marker-icon-choice').forEach((btn) => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.marker-icon-choice').forEach((b) => b.style.outline = '');
                btn.style.outline = '2px solid #2ecc71';
                selectedIcon = btn.dataset.icon;
            });
        });
    }

    async function placeAt(g, c, event) {
        if (!selectedIcon) return;
        const [sx, sy] = c.getSquare(event);
        const name = window.prompt('Название метки:', '');
        if (name === null) return; // cancelled
        const obj = {
            id: (window.util && window.util.uniqueId) ? window.util.uniqueId() : 'mk-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            type: 'point',
            x: sx, y: sy, layer: g.currentLayer,
            name: name || '', icon: selectedIcon,
        };
        g.marker.load([obj]);
        await g.marker.SaveOneToServer(obj, 'faction');
    }

    function setPlacing(g, on) {
        placing = on;
        const btn = document.getElementById('marker_place_btn');
        btn.classList.toggle('active', placing);
        panel.style.display = placing ? 'block' : 'none';
        if (!placing) selectedIcon = null;
    }

    async function init() {
        while (!window.g || !window.g.viewer || !window.c) {
            await new Promise((r) => setTimeout(r, 200));
        }
        const g = window.g, viewer = window.g.viewer, c = window.c;
        buildPanel();

        const placeBtn = document.getElementById('marker_place_btn');
        placeBtn.addEventListener('click', () => setPlacing(g, !placing));

        viewer.addHandler('canvas-click', (event) => {
            if (!placing) return;
            event.preventDefaultAction = true;
            placeAt(g, c, event);
        });
    }

    document.addEventListener('pzmap-authenticated', () => { init(); });
    if (window.PZMAP_USER) init();
})();
