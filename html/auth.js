(function () {
    'use strict';

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }

    async function api(path, body) {
        const resp = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body || {}),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'request_failed');
        return data;
    }

    async function getMe() {
        const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
        return resp.json();
    }

    async function getFactions() {
        const resp = await fetch('/api/factions');
        return resp.json();
    }

    function buildOverlay(factions) {
        const options = factions.map((f) => `<option value="${f.key}">${f.name}</option>`).join('');
        const overlay = el(`
      <div id="pzmap-auth-overlay" style="
          position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center;
          background:rgba(10,10,12,0.92); font-family:sans-serif; color:#eee;">
        <div style="background:#1c1c22; border:1px solid #333; border-radius:8px; padding:24px; width:320px;">
          <h2 style="margin:0 0 12px; font-size:18px;">Вход</h2>
          <div id="pzmap-auth-error" style="color:#e74c3c; font-size:13px; min-height:16px; margin-bottom:8px;"></div>
          <input id="pzmap-auth-username" placeholder="Никнейм" style="width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px; background:#111; border:1px solid #333; color:#eee; border-radius:4px;">
          <input id="pzmap-auth-password" type="password" placeholder="Пароль" style="width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px; background:#111; border:1px solid #333; color:#eee; border-radius:4px;">
          <select id="pzmap-auth-faction" style="width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px; background:#111; border:1px solid #333; color:#eee; border-radius:4px;">
            <option value="">Фракция (для регистрации)</option>
            ${options}
          </select>
          <input id="pzmap-auth-discord" placeholder="Discord ID (для регистрации)" style="width:100%; box-sizing:border-box; margin-bottom:12px; padding:8px; background:#111; border:1px solid #333; color:#eee; border-radius:4px;">
          <div style="display:flex; gap:8px;">
            <button id="pzmap-auth-login-btn" style="flex:1; padding:8px; cursor:pointer;">Войти</button>
            <button id="pzmap-auth-register-btn" style="flex:1; padding:8px; cursor:pointer;">Регистрация</button>
          </div>
        </div>
      </div>
    `);
        return overlay;
    }

    function showError(msg) {
        const box = document.getElementById('pzmap-auth-error');
        if (box) box.textContent = msg;
    }

    function readForm() {
        return {
            username: document.getElementById('pzmap-auth-username').value.trim(),
            password: document.getElementById('pzmap-auth-password').value,
            faction: document.getElementById('pzmap-auth-faction').value,
            discord_id: document.getElementById('pzmap-auth-discord').value.trim(),
        };
    }

    function addUserBadge(me) {
        const badge = el(`
      <div id="pzmap-user-badge" style="
          position:fixed; top:8px; right:8px; z-index:9998; background:#1c1c22; border:1px solid #333;
          border-radius:6px; padding:6px 10px; font-family:sans-serif; font-size:13px; color:#eee; display:flex; gap:8px; align-items:center;">
        <span>${me.username} · <span style="color:${me.faction_color}">${me.faction_name}</span></span>
        <button id="pzmap-logout-btn" style="cursor:pointer;">Выйти</button>
      </div>
    `);
        document.body.appendChild(badge);
        document.getElementById('pzmap-logout-btn').addEventListener('click', async () => {
            await api('/api/auth/logout');
            window.location.reload();
        });
    }

    async function boot() {
        const me = await getMe();
        if (me.authenticated) {
            window.PZMAP_USER = me;
            addUserBadge(me);
            document.dispatchEvent(new CustomEvent('pzmap-authenticated', { detail: me }));
            return;
        }

        const factions = await getFactions();
        const overlay = buildOverlay(factions);
        document.body.appendChild(overlay);

        document.getElementById('pzmap-auth-login-btn').addEventListener('click', async () => {
            showError('');
            try {
                const form = readForm();
                await api('/api/auth/login', { username: form.username, password: form.password });
                window.location.reload();
            } catch (e) {
                showError('Не удалось войти: ' + e.message);
            }
        });

        document.getElementById('pzmap-auth-register-btn').addEventListener('click', async () => {
            showError('');
            try {
                const form = readForm();
                if (!form.faction) {
                    showError('Выбери фракцию для регистрации');
                    return;
                }
                await api('/api/auth/register', form);
                window.location.reload();
            } catch (e) {
                showError('Не удалось зарегистрироваться: ' + e.message);
            }
        });
    }

    boot();
})();
