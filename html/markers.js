// Marker placement with icon picker, size, color, and inline name input.
// Loaded as a classic script after pzmap.js/territory.js.
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

    const SIZES = [
        { label: 'S', value: 21 },
        { label: 'M', value: 32 },
        { label: 'L', value: 43 },
    ];

    // Preset swatches instead of a free color picker (<input type="color">
    // was unreliable across browsers and the user asked for presets anyway).
    // Text color: readable-on-map tones. Dot color: same palette as
    // territory painting (see PALETTE in territory.js) for a consistent look.
    const TEXT_COLORS = ['#ffffff', '#000000', '#f1c40f', '#e74c3c', '#2ecc71', '#3498db'];
    const DOT_COLORS = ['#e74c3c', '#9b59b6', '#3498db', '#e67e22', '#7f8c8d', '#2ecc71', '#f1c40f', '#1abc9c'];

    const DELETE_RADIUS_SQUARES = 3; // click tolerance when picking a mark to delete

    let placing = false;
    let deleting = false;
    let selectedIcon = null;
    let selectedSize = 32;
    let textColor = TEXT_COLORS[0];
    let dotColor = DOT_COLORS[0];
    let panel = null;
    let nameInput = null;
    let sizeButtons = [];

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }

    function buildPanel() {
        const grid = ICONS.map((name) => `
      <button class="mk-icon-btn" data-icon="${name}" title="${name}">
        <img src="./pzmap/icons/${name}.png" style="width:100%;height:100%;image-rendering:pixelated;">
      </button>
    `).join('');

        const sizeBtns = SIZES.map((s, i) => `
      <button class="mk-size-btn${i === 1 ? ' active' : ''}" data-size="${s.value}">${s.label}</button>
    `).join('');

        const textSwatches = TEXT_COLORS.map((color, i) => `
      <button class="tp-swatch${i === 0 ? ' active' : ''}" data-color="${color}"
              style="background:${color}; ${color === '#ffffff' ? 'border:2px solid #666;' : ''}" title="${color}"></button>
    `).join('');

        const dotSwatches = DOT_COLORS.map((color, i) => `
      <button class="tp-swatch${i === 0 ? ' active' : ''}" data-color="${color}" style="background:${color};" title="${color}"></button>
    `).join('');

        panel = el(`
      <div id="marker-panel" class="floating-panel">
        <div class="mk-header">Создание метки</div>

        <div class="mk-section">
          <div class="mk-label">Иконка</div>
          <div class="mk-icon-grid">${grid}</div>
        </div>

        <div class="mk-section">
          <div class="mk-label">Размер</div>
          <div class="mk-row">${sizeBtns}</div>
        </div>

        <div class="mk-section">
          <div class="mk-label">Цвет текста</div>
          <div class="tp-palette" id="mk-text-color-palette">${textSwatches}</div>
        </div>

        <div class="mk-section">
          <div class="mk-label">Цвет точки</div>
          <div class="tp-palette" id="mk-dot-color-palette">${dotSwatches}</div>
        </div>

        <div class="mk-section">
          <div class="mk-label">Название</div>
          <input type="text" id="mk-name-input" class="mk-name-input" placeholder="Введите название..." maxlength="100">
        </div>

        <div class="mk-hint">Кликните по карте чтобы поставить метку</div>
      </div>
    `);
        document.body.appendChild(panel);

        panel.querySelectorAll('.mk-icon-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.mk-icon-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                selectedIcon = btn.dataset.icon;
            });
        });

        sizeButtons = panel.querySelectorAll('.mk-size-btn');
        sizeButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                sizeButtons.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                selectedSize = parseInt(btn.dataset.size, 10);
            });
        });

        panel.querySelectorAll('#mk-text-color-palette .tp-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('#mk-text-color-palette .tp-swatch').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                textColor = btn.dataset.color;
            });
        });

        panel.querySelectorAll('#mk-dot-color-palette .tp-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('#mk-dot-color-palette .tp-swatch').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                dotColor = btn.dataset.color;
            });
        });

        nameInput = panel.querySelector('#mk-name-input');
    }

    async function placeAt(g, c, event) {
        if (!selectedIcon) return;
        const [sx, sy] = c.getSquare(event);
        const name = (nameInput ? nameInput.value : '').trim();
        const obj = {
            id: (window.util && window.util.uniqueId) ? window.util.uniqueId() : 'mk-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            type: 'point',
            x: sx, y: sy, layer: g.currentLayer,
            name: name,
            icon: selectedIcon,
            size: selectedSize,
            color: dotColor,
            background: dotColor,
            text_color: textColor,
            // set immediately so the mark is deletable right away, without
            // waiting for a reload to pick up the server-assigned owner
            owner_user_id: window.PZMAP_USER ? window.PZMAP_USER.id : undefined,
        };
        g.marker.load([obj]);
        await g.marker.SaveOneToServer(obj, window.PZMAP_SCOPE || 'faction');
    }

    function showWarning(msg) {
        let el = document.getElementById('markers-warning');
        if (!el) {
            el = document.createElement('div');
            el.id = 'markers-warning';
            el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#e74c3c;color:#fff;padding:12px 24px;border-radius:8px;font-family:sans-serif;font-size:14px;z-index:99999;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
    }

    // Find the closest deletable (owned) mark to a click, within a small
    // radius — mirrors territory.js's ownership-gated erase: only your own
    // marks (or a faction deputy's) are ever offered for deletion, and
    // marks without an owner_user_id at all (locked-coordinate pin, POIs,
    // room/object overlays loaded into the same MarkManager) are skipped
    // entirely since they were never something a user "placed".
    function findDeletableMarkNear(g, sx, sy) {
        let best = null;
        let bestDist = Infinity;
        for (const mark of g.marker.db.all()) {
            if (mark.owner_user_id === undefined || mark.owner_user_id === null) continue;
            if (mark.layer !== g.currentLayer) continue;
            const isOwner = mark.owner_user_id === (window.PZMAP_USER && window.PZMAP_USER.id);
            const isDeputy = window.PZMAP_USER && window.PZMAP_USER.is_deputy;
            if (!isOwner && !isDeputy) continue;
            if (typeof mark.center !== 'function') continue;
            const [mx, my] = mark.center();
            const dist = Math.hypot(mx - sx, my - sy);
            if (dist <= DELETE_RADIUS_SQUARES && dist < bestDist) {
                best = mark;
                bestDist = dist;
            }
        }
        return best;
    }

    async function deleteAt(g, c, event) {
        const [sx, sy] = c.getSquare(event);
        const mark = findDeletableMarkNear(g, sx, sy);
        if (!mark) {
            showWarning('Рядом нет твоей метки для удаления');
            return;
        }
        const result = await g.marker.DeleteFromServer(mark.id);
        if (result && result.error) {
            showWarning('Не удалось удалить: ' + result.error);
            return;
        }
        g.marker.remove(mark.id);
    }

    function setPlacing(g, on) {
        placing = on;
        const btn = document.getElementById('marker_place_btn');
        btn.classList.toggle('active', placing);
        panel.classList.toggle('fp-open', placing);
        if (!placing) {
            selectedIcon = null;
            panel.querySelectorAll('.mk-icon-btn').forEach((b) => b.classList.remove('active'));
        }
        if (on && deleting) setDeleting(g, false);
    }

    function setDeleting(g, on) {
        deleting = on;
        const btn = document.getElementById('marker_delete_btn');
        btn.classList.toggle('active', deleting);
        if (on && placing) setPlacing(g, false);
    }

    async function init() {
        while (!window.g || !window.g.viewer || !window.c || !window.g.marker) {
            await new Promise((r) => setTimeout(r, 200));
        }
        const g = window.g, viewer = window.g.viewer, c = window.c;
        buildPanel();

        // Nothing called this automatically before, so previously-placed
        // marks never reappeared after a page refresh — they were saved
        // fine (SaveOneToServer worked), just never fetched back.
        g.marker.LoadFromServer().catch(() => {});

        const placeBtn = document.getElementById('marker_place_btn');
        placeBtn.addEventListener('click', () => setPlacing(g, !placing));

        const deleteBtn = document.getElementById('marker_delete_btn');
        deleteBtn.addEventListener('click', () => setDeleting(g, !deleting));

        viewer.addHandler('canvas-click', (event) => {
            if (placing) {
                event.preventDefaultAction = true;
                placeAt(g, c, event);
                return;
            }
            if (deleting) {
                event.preventDefaultAction = true;
                deleteAt(g, c, event);
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });
    }

    document.addEventListener('pzmap-authenticated', () => { init(); });
    if (window.PZMAP_USER) init();
})();
