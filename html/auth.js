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

    // Real <form> elements (not bare divs with a click handler) with
    // autocomplete hints, so browser password managers reliably recognize
    // this as a login/signup form and offer to save the credentials —
    // that heuristic keys off form submission, not arbitrary button clicks.
    function buildOverlay(factions) {
        const options = factions.map((f) => `<option value="${f.key}">${f.name}</option>`).join('');
        const inputStyle = 'width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px; background:#111; border:1px solid #333; color:#eee; border-radius:4px;';
        const overlay = el(`
      <div id="pzmap-auth-overlay" style="
          position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center;
          background:rgba(10,10,12,0.92); font-family:sans-serif; color:#eee;">
        <div style="background:#1c1c22; border:1px solid #333; border-radius:8px; padding:24px; width:320px;">
          <h2 style="margin:0 0 12px; font-size:18px;">Вход</h2>
          <div id="pzmap-auth-error" style="color:#e74c3c; font-size:13px; min-height:16px; margin-bottom:8px;"></div>

          <form id="pzmap-login-form" autocomplete="on">
            <input name="username" id="pzmap-auth-username" autocomplete="username" placeholder="Никнейм" style="${inputStyle}">
            <input name="password" id="pzmap-auth-password" type="password" autocomplete="current-password" placeholder="Пароль" style="${inputStyle}">
            <button type="submit" id="pzmap-auth-login-btn" style="width:100%; padding:8px; cursor:pointer; margin-bottom:16px;">Войти</button>
          </form>

          <div style="border-top:1px solid #333; margin-bottom:12px;"></div>

          <form id="pzmap-register-form" autocomplete="on">
            <input name="username" id="pzmap-reg-username" autocomplete="username" placeholder="Никнейм" style="${inputStyle}">
            <input name="new-password" id="pzmap-reg-password" type="password" autocomplete="new-password" placeholder="Пароль" style="${inputStyle}">
            <select id="pzmap-auth-faction" style="${inputStyle}">
              <option value="">Фракция (для регистрации)</option>
              ${options}
            </select>
            <input name="faction-password" id="pzmap-auth-faction-password" type="password" autocomplete="off" placeholder="Пароль фракции" style="${inputStyle}">
            <button type="submit" id="pzmap-auth-register-btn" style="width:100%; padding:8px; cursor:pointer;">Регистрация</button>
          </form>
        </div>
      </div>
    `);
        return overlay;
    }

    function showError(msg) {
        const box = document.getElementById('pzmap-auth-error');
        if (box) box.textContent = msg;
    }

    function readLoginForm() {
        return {
            username: document.getElementById('pzmap-auth-username').value.trim(),
            password: document.getElementById('pzmap-auth-password').value,
        };
    }

    function readRegisterForm() {
        return {
            username: document.getElementById('pzmap-reg-username').value.trim(),
            password: document.getElementById('pzmap-reg-password').value,
            faction: document.getElementById('pzmap-auth-faction').value,
            faction_password: document.getElementById('pzmap-auth-faction-password').value,
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

        document.getElementById('pzmap-login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showError('');
            try {
                const form = readLoginForm();
                await api('/api/auth/login', { username: form.username, password: form.password });
                window.location.reload();
            } catch (err) {
                showError('Не удалось войти: ' + err.message);
            }
        });

        document.getElementById('pzmap-register-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showError('');
            try {
                const form = readRegisterForm();
                if (!form.faction) {
                    showError('Выбери фракцию для регистрации');
                    return;
                }
                if (!form.faction_password) {
                    showError('Введи пароль фракции');
                    return;
                }
                await api('/api/auth/register', form);
                window.location.reload();
            } catch (err) {
                showError('Не удалось зарегистрироваться: ' + err.message);
            }
        });
    }

    boot();
})();
