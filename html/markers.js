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

    let placing = false;
    let selectedIcon = null;
    let selectedSize = 32;
    let textColor = '#ffffff';
    let dotColor = '#3399ff';
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
          <div class="mk-row">
            <input type="color" id="mk-text-color" value="#ffffff" class="mk-color-input">
          </div>
        </div>

        <div class="mk-section">
          <div class="mk-label">Цвет точек</div>
          <div class="mk-row">
            <input type="color" id="mk-dot-color" value="#3399ff" class="mk-color-input">
          </div>
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

        const textClr = panel.querySelector('#mk-text-color');
        textClr.addEventListener('input', () => { textColor = textClr.value; });

        const dotClr = panel.querySelector('#mk-dot-color');
        dotClr.addEventListener('input', () => { dotColor = dotClr.value; });

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
        };
        g.marker.load([obj]);
        await g.marker.SaveOneToServer(obj, 'faction');
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

        nameInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });
    }

    document.addEventListener('pzmap-authenticated', () => { init(); });
    if (window.PZMAP_USER) init();
})();
