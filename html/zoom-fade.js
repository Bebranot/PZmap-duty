// Fades map markers/labels out when zoomed way out, instead of them staying
// full-size and cluttering the view (838 POIs + faction marks all at once).
// Icons shrink and dim down to 50% (never fully vanish); name labels fade
// all the way to 0 a bit sooner, since text is what actually "мешается".
// Implemented as CSS custom properties + CSS transitions (pzmap.css) rather
// than animating anything in JS directly, so the browser handles the easing.
(function () {
    'use strict';

    // `step` is pixels-per-game-square on screen — the same unit and the
    // same source (g.grid.step) the existing discrete zoom-level system in
    // marker.js/mark/conf.js already uses (its level thresholds are
    // 0, 1, 8, 32), so this stays visually consistent with it instead of
    // introducing a second, differently-scaled notion of "zoomed out".
    function computeFade(step) {
        const iconT = Math.max(0, Math.min(1, step / 1.5));
        const textT = Math.max(0, Math.min(1, (step - 0.5) / 1.5));
        return {
            iconScale: (0.6 + 0.4 * iconT).toFixed(3),
            iconOpacity: (0.5 + 0.5 * iconT).toFixed(3),
            textOpacity: textT.toFixed(3),
        };
    }

    function applyFade(step) {
        const { iconScale, iconOpacity, textOpacity } = computeFade(step);
        const root = document.documentElement.style;
        root.setProperty('--pz-icon-scale', iconScale);
        root.setProperty('--pz-icon-opacity', iconOpacity);
        root.setProperty('--pz-text-opacity', textOpacity);
    }

    async function init() {
        while (!window.g || !window.g.viewer || !window.g.grid) {
            await new Promise((r) => setTimeout(r, 200));
        }
        const g = window.g, viewer = window.g.viewer;
        applyFade(g.grid.step);
        viewer.addHandler('update-viewport', () => {
            if (g.grid) applyFade(g.grid.step);
        });
    }

    document.addEventListener('pzmap-authenticated', () => { init(); });
    if (window.PZMAP_USER) init();
})();
