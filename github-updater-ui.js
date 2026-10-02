const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, shell, ipcMain } = require('electron');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const API_URL = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/latest';
const UI_VERSION = 3;
const FIRST_CHECK_DELAY = 500;
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOCUS_CHECK_GAP = 60 * 1000;
const REQUEST_TIMEOUT = 15000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const POLL_MS = 250;
const PROGRESS_MS = 100;
const ACTION_CHANNEL = 'anka-updater:action';
const ACTIONS = new Set(['later', 'close', 'install', 'retry']);

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function bootUi(version) {
    const existing = window.__ankaUpdater;
    if (existing && existing.v === version) return true;

    const oldHost = document.getElementById('anka-updater-host');
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = 'anka-updater-host';
    const root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `
        <style>
            :host { all: initial; }
            .card { position: fixed; right: 24px; bottom: 24px; width: min(400px, calc(100vw - 32px)); box-sizing: border-box; display: flex; gap: 14px; padding: 18px; border-radius: 16px; border: 1px solid var(--border, #27272a); background: var(--panel, #18181b); color: var(--text, #f4f4f5); box-shadow: var(--shadow-pop, 0 20px 40px rgba(0,0,0,.45)); font: 13px/1.5 var(--font, system-ui, sans-serif); z-index: 2147483000; overflow: hidden; animation: cardIn .42s cubic-bezier(.16,1,.3,1) both; will-change: transform, opacity; }
            .card.out { animation: cardOut .22s cubic-bezier(.4,0,1,1) both; }
            .card::before { content: ''; position: absolute; left: 0; top: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--accent, #ff4757), var(--accent-2, #ff7a45)); transform-origin: left; animation: topbar .7s .1s cubic-bezier(.16,1,.3,1) both; }
            @keyframes cardIn { from { opacity: 0; transform: translateY(28px) scale(.94); } to { opacity: 1; transform: none; } }
            @keyframes cardOut { to { opacity: 0; transform: translateY(20px) scale(.96); } }
            @keyframes topbar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
            .icon { position: relative; flex: 0 0 40px; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--accent, #ff4757), var(--accent-2, #ff7a45)); }
            .icon::after { content: ''; position: absolute; inset: 0; border-radius: 12px; border: 2px solid var(--accent, #ff4757); opacity: 0; animation: ring 1.8s ease-out infinite; }
            .icon.done::after { animation: none; }
            .icon.err { background: #ef4444; }
            .icon.err::after { border-color: #ef4444; }
            .icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
            .icon.busy svg { animation: bob 1.1s ease-in-out infinite; }
            .icon.done svg { animation: pop .45s cubic-bezier(.34,1.56,.64,1) both; }
            @keyframes ring { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(1.55); opacity: 0; } }
            @keyframes bob { 0%, 100% { transform: translateY(-2px); } 50% { transform: translateY(2px); } }
            @keyframes pop { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .body { flex: 1; min-width: 0; }
            .body.swap { animation: swap .32s cubic-bezier(.16,1,.3,1); }
            .body.shake { animation: shake .42s ease; }
            @keyframes swap { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
            @keyframes shake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
            .title { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
            .text { margin: 0; color: var(--text-secondary, #a1a1aa); word-break: break-word; }
            .notes { margin: 10px 0 0; max-height: 96px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--bg, #121214); color: var(--text-secondary, #a1a1aa); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
            .track { height: 6px; margin-top: 12px; border-radius: 3px; background: var(--hover, #27272a); overflow: hidden; }
            .bar { height: 100%; width: 100%; border-radius: 3px; transform-origin: left; transform: scaleX(0); transition: transform .25s ease-out; background: linear-gradient(90deg, var(--accent, #ff4757), var(--accent-2, #ff7a45), var(--accent, #ff4757)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
            @keyframes shimmer { to { background-position: -200% 0; } }
            .actions { display: flex; gap: 8px; margin-top: 14px; }
            .btn { flex: 1; min-height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border, #27272a); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; touch-action: manipulation; transition: background-color .15s ease, transform .1s ease, filter .15s ease; }
            .btn:hover { background: var(--hover, #27272a); }
            .btn:active { transform: scale(.96); }
            .btn.primary { flex: 2; background: var(--accent, #ff4757); border-color: transparent; color: #fff; animation: glow 2s ease-in-out infinite; }
            .btn.primary:hover { filter: brightness(1.1); }
            @keyframes glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,71,87,0); } 50% { box-shadow: 0 0 0 5px rgba(255,71,87,.22); } }
            [hidden] { display: none !important; }
            @media (prefers-reduced-motion: reduce) { .card, .card::before, .icon::after, .icon svg, .body, .bar, .btn, .btn.primary { animation: none !important; transition: none !important; } }
        </style>
        <div class="card" role="status" aria-live="polite" hidden>
            <div class="icon"></div>
            <div class="body">
                <h3 class="title"></h3>
                <p class="text"></p>
                <div class="notes" hidden></div>
                <div class="track" hidden><div class="bar"></div></div>
                <div class="actions"></div>
            </div>
        </div>
    `;

    const ICONS = {
        download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
        check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
        info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg>'
    };

    const card = root.querySelector('.card');
    const icon = root.querySelector('.icon');
    const body = root.querySelector('.body');
    const title = root.querySelector('.title');
    const text = root.querySelector('.text');
    const notes = root.querySelector('.notes');
    const track = root.querySelector('.track');
    const bar = root.querySelector('.bar');
    const actions = root.querySelector('.actions');
    const queue = [];
    let ipc = null;
    let hideTimer = 0;
    let leaveTimer = 0;
    let currentKey = '';

    try {
        if (typeof require === 'function') ipc = require('electron').ipcRenderer || null;
    } catch (err) {
        ipc = null;
    }

    function emit(action) {
        if (ipc) ipc.send('anka-updater:action', action);
        else queue.push(action);
    }

    function setIcon(kind, cls) {
        icon.className = cls ? 'icon ' + cls : 'icon';
        icon.innerHTML = ICONS[kind];
    }

    function animate(cls) {
        body.className = 'body';
        void body.offsetWidth;
        body.className = 'body ' + cls;
    }

    function setButtons(defs) {
        actions.replaceChildren();
        defs.forEach((def) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = def[2] ? 'btn primary' : 'btn';
            button.textContent = def[0];
            button.addEventListener('click', () => emit(def[1]));
            actions.appendChild(button);
        });
        actions.hidden = defs.length === 0;
    }

    function show() {
        if (card.hidden) {
            card.hidden = false;
            card.classList.remove('out');
        } else if (card.classList.contains('out')) {
            card.classList.remove('out');
        }
    }

    function dismiss() {
        currentKey = '';
        if (card.hidden || card.classList.contains('out')) return;
        card.classList.add('out');
        leaveTimer = setTimeout(() => {
            card.hidden = true;
            card.classList.remove('out');
        }, 220);
    }

    function render(state) {
        clearTimeout(hideTimer);

        if (!state || (state.view !== 'update' && state.view !== 'error' && state.view !== 'info')) {
            dismiss();
            return;
        }

        clearTimeout(leaveTimer);

        if (state.view === 'update') {
            const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
            const key = 'update:' + state.version + ':' + (state.ready ? 'ready' : 'load');
            if (key !== currentKey) {
                currentKey = key;
                setIcon(state.ready ? 'check' : 'download', state.ready ? 'done' : 'busy');
                title.textContent = (state.ready ? 'Güncelleme hazır: ' : 'Yeni sürüm: ') + state.version;
                notes.textContent = state.notes || '';
                notes.hidden = !state.notes;
                track.hidden = !!state.ready;
                setButtons(state.ready
                    ? [['Daha Sonra', 'later'], ['Kur ve Yeniden Başlat', 'install', true]]
                    : [['Daha Sonra', 'later']]);
                animate('swap');
            }
            text.textContent = state.ready ? 'Yeniden başlatıp kurmak için hazır.' : 'İndiriliyor… %' + percent;
            bar.style.transform = 'scaleX(' + percent / 100 + ')';
        } else if (state.view === 'error') {
            currentKey = 'error:' + Date.now();
            setIcon('alert', 'err');
            title.textContent = 'Güncelleme hatası';
            text.textContent = state.message || 'Bilinmeyen hata';
            notes.hidden = true;
            track.hidden = true;
            setButtons([['Kapat', 'close'], ['Tekrar Dene', 'retry', true]]);
            animate('shake');
        } else {
            currentKey = 'info:' + Date.now();
            setIcon('info');
            title.textContent = state.title || 'Anka Web';
            text.textContent = state.message || '';
            notes.hidden = true;
            track.hidden = true;
            setButtons([]);
            animate('swap');
            hideTimer = setTimeout(dismiss, 6000);
        }

        show();
    }

    window.__ankaUpdater = Object.freeze({
        v: version,
        render: render,
        pop: () => queue.shift() || null,
        ipc: !!ipc
    });

    document.documentElement.appendChild(host);
    return true;
}

const BOOT_SOURCE = bootUi.toString();

function isTrustedUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return false;
        const host = url.hostname;
        return host === 'api.github.com' || host === 'github.com' || host.endsWith('.githubusercontent.com');
    } catch (err) {
        return false;
    }
}

function request(url, headers, depth) {
    return new Promise((resolve, reject) => {
        if (!isTrustedUrl(url)) {
            reject(new Error('Güvenilmeyen adres engellendi'));
            return;
        }

        const req = https.get(url, {
            agent: agent,
            headers: Object.assign({ 'User-Agent': 'AnkaWeb-Updater', Accept: 'application/vnd.github+json, application/octet-stream' }, headers || {}),
            timeout: REQUEST_TIMEOUT
        }, (res) => {
            const code = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
                res.resume();
                if ((depth || 0) >= MAX_REDIRECTS) {
                    reject(new Error('Çok fazla yönlendirme'));
                    return;
                }
                resolve(request(new URL(res.headers.location, url).toString(), {}, (depth || 0) + 1));
                return;
            }
            if (code !== 200 && code !== 304) {
                res.resume();
                reject(new Error('Sunucu yanıtı: ' + code));
                return;
            }
            resolve(res);
        });

        req.on('timeout', () => req.destroy(new Error('Bağlantı zaman aşımına uğradı')));
        req.on('error', reject);
    });
}

function readJson(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_JSON_BYTES) {
                res.destroy(new Error('Yanıt çok büyük'));
                return;
            }
            chunks.push(chunk);
        });
        res.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (err) {
                reject(new Error('Sürüm bilgisi okunamadı'));
            }
        });
        res.on('error', reject);
    });
}

async function fetchRelease() {
    const cache = global.__ankaReleaseCache || (global.__ankaReleaseCache = { etag: '', data: null });
    const headers = cache.etag && cache.data ? { 'If-None-Match': cache.etag } : {};
    const res = await request(API_URL, headers, 0);

    if (res.statusCode === 304 && cache.data) {
        res.resume();
        return cache.data;
    }

    const data = await readJson(res);
    if (res.headers.etag) {
        cache.etag = res.headers.etag;
        cache.data = data;
    }
    return data;
}

function parseVersion(value) {
    return String(value).trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((part) => parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    const length = Math.max(x.length, y.length, 3);
    for (let i = 0; i < length; i += 1) {
        const diff = (x[i] || 0) - (y[i] || 0);
        if (diff) return diff > 0 ? 1 : -1;
    }
    return 0;
}

function archScore(name) {
    const isArm = /arm64|aarch64/.test(name);
    const isX64 = /x86_64|amd64|x64/.test(name);
    if (process.arch === 'arm64') return isArm ? 2 : isX64 ? -2 : 0;
    return isX64 ? 2 : isArm ? -3 : 0;
}

function pickAsset(assets) {
    let extensions;
    if (process.platform === 'win32') extensions = ['.exe'];
    else if (process.platform === 'linux') extensions = process.env.APPIMAGE ? ['.appimage'] : ['.deb', '.appimage'];
    else return null;

    let best = null;
    let bestScore = -Infinity;

    for (const asset of assets) {
        if (!asset || !asset.name || !asset.browser_download_url) continue;
        const name = asset.name.toLowerCase();
        if (/\.(blockmap|ya?ml|sig|sha256|txt)$/.test(name)) continue;
        const index = extensions.findIndex((ext) => name.endsWith(ext));
        if (index < 0) continue;

        let score = (extensions.length - index) * 10 + archScore(name);
        if (process.platform === 'win32' && /setup|install/.test(name)) score += 5;
        if (/portable/.test(name)) score -= 8;

        if (score > bestScore) {
            best = asset;
            bestScore = score;
        }
    }

    return best;
}

function hashFile(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(file, { highWaterMark: 1 << 20 });
        input.on('data', (chunk) => hash.update(chunk));
        input.on('end', () => resolve(hash.digest('hex')));
        input.on('error', reject);
    });
}

async function downloadAsset(asset, onProgress, holder) {
    const dir = path.join(app.getPath('temp'), 'anka-update');
    fs.mkdirSync(dir, { recursive: true });

    const safeName = path.basename(asset.name).replace(/[^\w.\-]/g, '_');
    for (const entry of fs.readdirSync(dir)) {
        if (entry !== safeName) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }

    const finalPath = path.join(dir, safeName);
    const partPath = finalPath + '.part';
    const expected = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : '';

    if (fs.existsSync(finalPath)) {
        try {
            const sizeOk = !asset.size || fs.statSync(finalPath).size === Number(asset.size);
            if (sizeOk && (!expected || (await hashFile(finalPath)) === expected)) return finalPath;
        } catch (err) {}
        fs.rmSync(finalPath, { force: true });
    }

    fs.rmSync(partPath, { force: true });

    const res = await request(asset.browser_download_url, {}, 0);
    holder.res = res;

    const total = Number(res.headers['content-length']) || Number(asset.size) || 0;

    await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(partPath, { highWaterMark: 1 << 20 });
        let received = 0;
        let settled = false;

        const fail = (err) => {
            if (settled) return;
            settled = true;
            res.destroy();
            out.destroy();
            reject(err);
        };

        res.on('data', (chunk) => {
            received += chunk.length;
            hash.update(chunk);
            onProgress(received, total);
        });
        res.on('error', fail);
        res.on('close', () => {
            if (!res.complete) fail(new Error('İndirme yarıda kesildi'));
        });
        out.on('error', fail);
        out.on('finish', () => {
            if (settled) return;
            if (total && received !== total) {
                fail(new Error('İndirilen dosya eksik'));
                return;
            }
            if (expected && hash.digest('hex') !== expected) {
                fail(new Error('Dosya doğrulaması başarısız'));
                return;
            }
            settled = true;
            resolve();
        });

        res.pipe(out);
    });

    fs.renameSync(partPath, finalPath);
    holder.res = null;
    return finalPath;
}

async function installFile(file) {
    if (process.platform === 'win32') {
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
        setTimeout(() => app.quit(), 200);
        return null;
    }

    if (process.platform === 'linux') {
        const target = process.env.APPIMAGE;
        if (file.toLowerCase().endsWith('.appimage') && target) {
            const staging = target + '.update';
            try {
                fs.copyFileSync(file, staging);
                fs.chmodSync(staging, 0o755);
                fs.renameSync(staging, target);
            } catch (err) {
                fs.rmSync(staging, { force: true });
                throw err;
            }
            app.relaunch({ execPath: target, args: process.argv.slice(1) });
            app.exit(0);
            return null;
        }

        const error = await shell.openPath(file);
        if (error) {
            shell.showItemInFolder(file);
            return { message: 'Dosya klasörde gösterildi. Kurulumu oradan başlatın.' };
        }
        return { message: 'Kurulum paketi açıldı. Kurulum bitince uygulamayı yeniden başlatın.' };
    }

    shell.showItemInFolder(file);
    return { message: 'Dosya klasörde gösterildi. Kurulumu oradan başlatın.' };
}

function createController(win, currentVersion, context) {
    const wc = win.webContents;
    const holder = { res: null };
    const skipped = win.__ankaUpdaterSkipped || (win.__ankaUpdaterSkipped = new Set());

    let disposed = false;
    let busy = false;
    let checking = false;
    let polling = false;
    let injected = false;
    let usesIpc = false;
    let dismissed = false;
    let latest = null;
    let filePath = '';
    let fileVersion = '';
    let lastState = { view: 'hidden' };
    let lastProgressAt = 0;
    let lastPercent = -1;
    let lastCheckAt = 0;
    let pollTimer = null;
    let firstTimer = null;
    let intervalTimer = null;

    function alive() {
        return !disposed && !win.isDestroyed() && !wc.isDestroyed();
    }

    function stopPoll() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    function syncPoll() {
        const interactive = lastState.view === 'update' || lastState.view === 'error';
        if (usesIpc || !interactive || !alive()) {
            stopPoll();
            return;
        }
        if (pollTimer) return;
        pollTimer = setInterval(async () => {
            if (polling || !alive()) return;
            polling = true;
            try {
                const action = await wc.executeJavaScript('window.__ankaUpdater ? window.__ankaUpdater.pop() : null');
                if (action && ACTIONS.has(action)) handleAction(action);
            } catch (err) {
            } finally {
                polling = false;
            }
        }, POLL_MS);
    }

    function paint(state) {
        lastState = state;
        if (!alive()) return Promise.resolve();

        const call = 'window.__ankaUpdater.render(' + JSON.stringify(state) + '), window.__ankaUpdater.ipc';
        const full = '(' + BOOT_SOURCE + ')(' + UI_VERSION + ');' + call;

        return wc.executeJavaScript(injected ? call : full)
            .catch(() => wc.executeJavaScript(full))
            .then((ipc) => {
                injected = true;
                usesIpc = !!ipc;
                syncPoll();
            })
            .catch(() => {
                injected = false;
            });
    }

    function send(state, force) {
        if (dismissed && !force && (state.view === 'update' || state.view === 'error')) {
            lastState = state;
            return;
        }
        paint(state);
    }

    function progressState(percent) {
        return { view: 'update', version: latest.version, notes: latest.notes, percent: percent, ready: false };
    }

    function readyState() {
        return { view: 'update', version: latest.version, notes: latest.notes, percent: 100, ready: true };
    }

    async function startDownload() {
        if (busy || !latest) return;
        busy = true;
        lastPercent = 0;
        lastProgressAt = 0;
        const target = latest;

        try {
            const file = await downloadAsset(target.asset, (received, total) => {
                const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
                const now = Date.now();
                if (percent === lastPercent || now - lastProgressAt < PROGRESS_MS) return;
                lastPercent = percent;
                lastProgressAt = now;
                send(progressState(percent));
            }, holder);
            busy = false;
            filePath = file;
            fileVersion = target.version;
            send(readyState());
        } catch (err) {
            busy = false;
            if (!disposed) send({ view: 'error', message: err.message });
        }
    }

    async function check(manual) {
        if (!alive() || checking) return;
        if (busy && !manual) return;
        checking = true;
        lastCheckAt = Date.now();

        try {
            const release = await fetchRelease();
            const tag = String(release.tag_name || '');

            if (!tag || compareVersions(tag, currentVersion) <= 0) {
                if (manual) {
                    dismissed = false;
                    send({ view: 'info', title: 'Güncelsin', message: 'Anka Web ' + currentVersion + ' en güncel sürüm.' }, true);
                }
                return;
            }

            if (manual) dismissed = false;
            else if (skipped.has(tag)) return;

            if (latest && latest.version === tag) {
                if (fileVersion === tag && filePath) {
                    if (manual) send(readyState(), true);
                } else if (busy) {
                    if (manual) send(progressState(Math.max(lastPercent, 0)), true);
                } else {
                    send(progressState(0), true);
                    startDownload();
                }
                return;
            }

            const asset = pickAsset(Array.isArray(release.assets) ? release.assets : []);
            if (!asset) {
                if (manual) send({ view: 'error', message: 'Bu sistem için kurulum dosyası bulunamadı.' }, true);
                return;
            }

            latest = { version: tag, asset: asset, notes: String(release.body || '').trim().slice(0, 600) };
            filePath = '';
            fileVersion = '';
            dismissed = false;
            send(progressState(0), true);
            startDownload();
        } catch (err) {
            if (manual) send({ view: 'error', message: err.message }, true);
            else console.error('Güncelleme kontrolü başarısız:', err.message);
        } finally {
            checking = false;
        }
    }

    async function install() {
        if (busy || !filePath) return;
        busy = true;
        try {
            const result = await installFile(filePath);
            busy = false;
            if (result && result.message) send({ view: 'info', title: 'Kurulum', message: result.message }, true);
        } catch (err) {
            busy = false;
            send({ view: 'error', message: err.message }, true);
        }
    }

    function handleAction(action) {
        if (action === 'later' || action === 'close') {
            if (latest) skipped.add(latest.version);
            dismissed = true;
            paint({ view: 'hidden' });
        } else if (action === 'install') {
            install();
        } else if (action === 'retry') {
            check(true);
        }
    }

    function onAction(event, action) {
        if (event.sender !== wc || typeof action !== 'string' || !ACTIONS.has(action)) return;
        handleAction(action);
    }

    function onDomReady() {
        injected = false;
        if (!dismissed && (lastState.view === 'update' || lastState.view === 'error')) paint(lastState);
    }

    function onFocus() {
        if (Date.now() - lastCheckAt >= FOCUS_CHECK_GAP) check(false);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        stopPoll();
        clearTimeout(firstTimer);
        clearInterval(intervalTimer);
        ipcMain.removeListener(ACTION_CHANNEL, onAction);
        if (holder.res) holder.res.destroy(new Error('İptal edildi'));
        try {
            if (!win.isDestroyed()) {
                win.removeListener('focus', onFocus);
                win.removeListener('closed', dispose);
            }
            if (!wc.isDestroyed()) {
                wc.removeListener('dom-ready', onDomReady);
                wc.executeJavaScript('window.__ankaUpdater && window.__ankaUpdater.render({ view: "hidden" })').catch(() => {});
            }
        } catch (err) {}
    }

    function start() {
        const manual = !!(context && context.manual);
        wc.on('dom-ready', onDomReady);
        win.on('focus', onFocus);
        win.on('closed', dispose);
        ipcMain.on(ACTION_CHANNEL, onAction);

        firstTimer = setTimeout(() => check(manual), manual ? 0 : FIRST_CHECK_DELAY);
        intervalTimer = setInterval(() => check(false), CHECK_INTERVAL);
    }

    return { start: start, dispose: dispose, check: check };
}

module.exports = {
    init: function (win, currentVersion, context) {
        if (!win || win.isDestroyed()) return;
        if (win.__ankaUpdater) win.__ankaUpdater.dispose();
        const controller = createController(win, currentVersion, context || {});
        win.__ankaUpdater = controller;
        controller.start();
    }
};
