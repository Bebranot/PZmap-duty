import { g } from "./globals.js";
import * as i18n from "./i18n.js";
import * as c from "./coordinates.js";
import * as util from "./util.js";
import { types } from "./mark/mark.js";
import { MarkRender } from "./mark/render.js";
import { MarkDatabase } from "./mark/memdb.js";
import { MarkEditor, create } from "./mark/edit.js";
import * as conf from "./mark/conf.js";

const SERVER_FETCH_TIMEOUT_MS = 12000;

// fetch() has no timeout by default — over a flaky/slow connection (e.g. the
// public port-forward this now runs behind) a hung request just sits there
// forever with no feedback, which reads exactly like "nothing saves". This
// aborts after a fixed timeout and throws on any non-2xx response instead of
// silently returning, so callers can actually react (roll back an optimistic
// UI change, show an error) instead of pretending it worked.
async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_FETCH_TIMEOUT_MS);
    try {
        const resp = await window.fetch(url, { ...options, signal: controller.signal });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data.error || ('http_' + resp.status));
        }
        return data;
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error('timeout');
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

export function updateZoom() {
    // update zoom information to current viewer
    const step = g.grid.step;
    let change = false;
    let zoomLevel = 1;
    while (zoomLevel < conf[g.map_type].length &&
        step > conf[g.map_type][zoomLevel].minStep) {
        zoomLevel += 1;
    }
    zoomLevel -= 1; // zoom_level starts from 0
    if (g.zoomLevel != zoomLevel) {
        g.zoomLevel = zoomLevel;
        change = true;

        const current = conf[g.map_type][zoomLevel];
        g.zoomInfo.rectBorder = current.rectBorder;
        g.zoomInfo.pointBorder = current.pointBorder;
        g.zoomInfo.pointSize = current.pointSize;
        g.zoomInfo.fontSize = current.fontSize;
        g.zoomInfo.timestamp = util.uniqueId();
    }
    return change;
}

function sortByDist(marks, x, y) {
    for (const m of marks) {
        const [mx, my] = m.center();
        m._dist = (mx - x) ** 2 + (my - y) ** 2;
    }
    return marks.sort((a, b) => a._dist - b._dist);
}

export class MarkManager {
    constructor(options = {}) {
        const {
            mode = 'top',
            onlyCurrentLayer = false,
            enableEdit = false,
            indexType = null,
            defaultValue = null,
            indexOptions = {},
            renderOptions = {},
            onScreenLimit = null,
        } = options;
        this.enabled = true;
        this.defaultValue = defaultValue;
        this.onlyCurrentLayer = onlyCurrentLayer;
        this.onScreenLimit = onScreenLimit;
        this.db = new MarkDatabase(mode, onlyCurrentLayer, indexType, indexOptions);
        this.render = new MarkRender(renderOptions);
        this.hiddenType = {};
        this.edit = enableEdit ? new MarkEditor(this) : null;
        if (!this.edit) {
            if (!this.defaultValue) {
                this.defaultValue = {};
            }
            this.defaultValue.passthrough = true;
        }
    }

    enable() {
        if (!this.enabled) {
            this.enabled = true;
            this.clearRenderCache();
            this.redrawAll();
        }
    }

    disable() {
        if (this.enabled) {
            this.enabled = false;
            this.clearRenderCache();
        }
    }

    setVisibleType(type, value) {
        if (!!this.hiddenType[type] !== !value) {
            this.hiddenType[type] = !value;
            this.redrawAll();
        }
    }

    setTextVisibility(visible) {
        if (visible) {
            this.render.setFormatterOptions('hide_text_level', 0);
        } else {
            this.render.setFormatterOptions('hide_text_level', 100);
        }
        this.redrawAll();
    }

    clearRenderCache() {
        this.render.sync([]);
    }

    remove(id) {
        this.db.remove(id);
        this.render.remove(id);
    }

    removeAll() {
        this.db.clear();
        this.clearRenderCache();
        if (this.edit) this.edit.remove();
    }

    redraw(id) {
        if (!this.enabled) return;
        if (this.db.has(id)) {
            const mark = this.db.get(id, g.range);
            if (mark) {
                this.render.upsert(mark);
            }
        } else {
            this.remove(id);
        }
    }

    redrawAll() {
        if (!this.enabled) return;
        const range = g.range;
        // g.range is only populated after the viewer's first 'update-viewport'
        // fires. If a mark gets added (e.g. markers.js placing one right after
        // page load, before the user has panned/zoomed) before that happens,
        // range is still undefined and db.query()/RTreeIndex.query() throws
        // trying to call range.getBound(). Bail out quietly — the next real
        // viewport update triggers its own redrawAll() with a valid range.
        if (!range) return;
        const result = this.db.query(range, g.currentLayer, g.zoomLevel);
        const marks = [];
        if (this.edit) {
            const current = this.edit.get();
            if (current) marks.push(current);
        }
        for (const mark of result) {
            if (!this.hiddenType[mark.constructor.name]) {
                marks.push(mark);
            }
        }
        if (this.onScreenLimit &&
            marks.length > this.onScreenLimit &&
            !c.isMaxZoom(g.viewer, false)) {
            sortByDist(marks, range.centerX, range.centerY);
            marks.splice(this.onScreenLimit);
        }
        this.render.sync(marks);
    }

    changeMode(mode = null) {
        if (!mode) {
            mode = g.map_type || 'top';
        }
        this.db.changeMode(mode);
        this.clearRenderCache();
    }

    load(objects, indexes = null) {
        if (!Array.isArray(objects)) {
            return;
        }
        const marks = [];
        for (const obj of objects) {
            if (!util.isObject(obj)) continue;
            if (obj.id === undefined || obj.id === null) obj.id = util.uniqueId();
            if (typeof obj.id !== 'string') continue;

            if (this.defaultValue) {
                for (const key in this.defaultValue) {
                    if (obj[key] === undefined || obj[key] === null) {
                        obj[key] = this.defaultValue[key];
                    }
                }
            }

            if (types[obj.type] && types[obj.type].validObject(obj)) {
                const mark = create(obj);
                marks.push(mark);
            }
        }
        this.db.batchInsert(marks, null, indexes);
        this.redrawAll();
    }

    loadDefault(lang = null, failed = '') {
        if (!lang) lang = i18n.getLang();
        const path = './pzmap/i18n/marks_' + lang +'.json';
        failed = failed ? failed + ',' + lang : lang;
        return window.fetch(path)
            .then((r)=>r.json())
            .then((obj) => {this.load(obj); return Promise.resolve(obj);})
            .catch((e)=> {
                util.setOutput('marker_output', 'Red', i18n.T('MarkerLoadDefaultFail', { lang: failed }));
                if (lang !== 'en') return this.loadDefault('en', failed);
                return Promise.resolve([]);
        });
    }

    Import() {
        util.upload().then((data) => {
            if (data) {
                const json = util.parseJson(data);
                if (json) {
                    this.load(json);
                }
            }
        });
    };

    Export() {
        const data = [];
        for (const mark of this.db.all()) {
            data.push(mark.toObject());
        }
        const s = JSON.stringify(data, null, '  ');
        util.download('marks.json', s);
    }

    // Server-backed sync (public/faction/private marks). See app.py /api/marks.
    // All of these throw on failure/timeout instead of silently returning —
    // callers (markers.js) must catch and react (roll back optimistic UI,
    // surface an error) rather than assume it worked.
    async LoadFromServer() {
        const rows = await fetchJson('/api/marks', { credentials: 'same-origin' });
        // owner_user_id lives on the row wrapper, not inside geometry_json —
        // stitch it back onto the mark object so client-side delete-permission
        // checks (markers.js) have something to compare against.
        const objs = rows.map((r) => ({ ...r.mark, owner_user_id: r.owner_user_id }));

        // This gets polled periodically for live sync (markers.js), so a mark
        // that's no longer in the response (deleted by someone else, or fell
        // out of your visibility scope) needs to disappear locally too —
        // load()/batchInsert() only ever upserts, never prunes. Only touch
        // marks that actually came from the server before (have an
        // owner_user_id) so this never removes POIs/the locked-coordinate
        // pin/room-object overlays that share this same MarkManager.
        const seenIds = new Set(objs.map((o) => o.id));
        for (const mark of this.db.all()) {
            if (mark.owner_user_id !== undefined && mark.owner_user_id !== null && !seenIds.has(mark.id)) {
                this.remove(mark.id);
            }
        }

        this.load(objs);
        return rows;
    }

    async SaveToServer(visibility = 'faction') {
        const data = [];
        for (const mark of this.db.all()) {
            data.push(mark.toObject());
        }
        return fetchJson('/api/marks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ marks: data, visibility }),
        });
    }

    // Save a single mark object without touching the visibility of every other
    // already-loaded mark (SaveToServer() re-saves the whole db.all() batch under
    // one visibility, which would silently overwrite unrelated marks' visibility).
    async SaveOneToServer(obj, visibility = 'faction') {
        return fetchJson('/api/marks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ marks: [obj], visibility }),
        });
    }

    async DeleteFromServer(id) {
        return fetchJson('/api/marks/' + encodeURIComponent(id), {
            method: 'DELETE',
            credentials: 'same-origin',
        });
    }
}

