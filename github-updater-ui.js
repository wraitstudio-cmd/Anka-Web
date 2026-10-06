const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { app, ipcMain, BrowserWindow, screen } = require('electron');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/latest.yml';
const MANIFEST_PATH = '/' + OWNER + '/' + REPO + '/main/latest.yml';
const DOWNLOAD_PATH_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const RELEASE_API_PREFIX = '/repos/' + OWNER + '/' + REPO + '/releases/tags/';
const UI_VERSION = 6;
const FIRST_CHECK_DELAY = 500;
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOCUS_CHECK_GAP = 60 * 1000;
const REQUEST_TIMEOUT = 8000;
const DOWNLOAD_IDLE_TIMEOUT = 30000;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const POLL_MS = 250;
const PROGRESS_MS = 100;
const ACTION_CHANNEL = 'anka-updater:action';
const ACTIONS = new Set(['later', 'close', 'install', 'retry', 'update']);
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DIGEST_RE = /^sha256:([A-Fa-f0-9]{64})$/;
const PKG_RE = /^[a-z0-9][a-z0-9+.-]{0,100}$/;
const SKIP_BIN_RE = /(chrome-sandbox|chrome_crashpad_handler|\.so(\.|$)|\.sh$|\.pak$|\.bin$|\.dat$|\.json$)/i;
const PLATFORM_TARGETS = {
    win32: { kind: 'exe', ext: '.exe' },
    linux: { kind: 'deb', ext: '.deb' }
};
const STRIPPED_ENV = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
const PKEXEC = '/usr/bin/pkexec';
const APT_GET = '/usr/bin/apt-get';
const DPKG = '/usr/bin/dpkg';
const DPKG_DEB = '/usr/bin/dpkg-deb';
const ENV_BIN = '/usr/bin/env';
const SH_BIN = '/bin/sh';
const SILENT_ARGS = ['/S'];
const SILENT_RUN_ARGS = ['/S', '--force-run'];
const ELEVATE_CODES = new Set(['EACCES', 'EPERM', 'UNKNOWN']);
const UI_DIR_NAME = 'updater-ui';
const UI_SOURCE = 'updater-ui.html';
const UI_FILE = 'index.html';
const STATUS_FILE = 'status.js';
const ACTIVE_FILE = 'active.json';
const UI_WIDTH = 480;
const UI_HEIGHT = 300;
const UI_CLEAN_DELAY = 20000;
const ACTIVE_MAX_AGE = 30 * 60 * 1000;
const DONE_LINGER = 1400;

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
            if (!state.sticky) hideTimer = setTimeout(dismiss, 6000);
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

const state = global.__ankaUpdaterState || (global.__ankaUpdaterState = {
    phase: 'idle',
    version: '',
    percent: 0,
    file: '',
    hash: '',
    snoozed: ''
});

const quitHook = { enabled: false, hooked: false, handled: false };
const progress = { startedAt: 0 };

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
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

function parseManifest(text) {
    const out = Object.create(null);
    String(text).split(/\r?\n/).forEach((line) => {
        const match = /^([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
        if (!match) return;
        let value = match[2].trim();
        if (value.length > 1 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
            value = value.slice(1, -1).trim();
        }
        out[match[1]] = value;
    });
    return out;
}

function isAssetHost(host) {
    return host === 'github.com' || (host.endsWith('.githubusercontent.com') && host !== 'raw.githubusercontent.com');
}

function manifestAllow(url) {
    return url.hostname === 'raw.githubusercontent.com' && url.pathname === MANIFEST_PATH;
}

function downloadAllow(url, redirected) {
    if (redirected) return isAssetHost(url.hostname);
    return url.hostname === 'github.com' && url.pathname.startsWith(DOWNLOAD_PATH_PREFIX);
}

function releaseAllow(version) {
    return (url, redirected) => !redirected
        && url.hostname === 'api.github.com'
        && url.pathname === RELEASE_API_PREFIX + 'v' + version;
}

function networkError(err) {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN')) {
        return new Error('İnternet bağlantısı yok');
    }
    return err;
}

function get(url, options, depth) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch (err) {
            reject(new Error('Geçersiz adres'));
            return;
        }

        if (target.protocol !== 'https:' || target.username || target.password || !options.allow(target, depth > 0)) {
            reject(new Error('Güvenilmeyen adres engellendi'));
            return;
        }

        const req = https.get(target, {
            agent: agent,
            headers: { 'User-Agent': 'AnkaWeb-Updater', 'Cache-Control': 'no-cache', Accept: options.accept || '*/*' },
            timeout: options.timeout,
            signal: options.signal
        }, (res) => {
            const code = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
                res.resume();
                if (!options.redirects || depth >= MAX_REDIRECTS) {
                    reject(new Error('Çok fazla yönlendirme'));
                    return;
                }
                let next;
                try {
                    next = new URL(res.headers.location, target).toString();
                } catch (err) {
                    reject(new Error('Geçersiz yönlendirme'));
                    return;
                }
                resolve(get(next, options, depth + 1));
                return;
            }
            if (code === 403 || code === 429) {
                res.resume();
                reject(new Error('GitHub istek sınırı aşıldı, biraz sonra tekrar deneyin'));
                return;
            }
            if (code !== 200) {
                res.resume();
                reject(new Error('Sunucu yanıtı: ' + code));
                return;
            }
            resolve(res);
        });

        req.on('timeout', () => req.destroy(new Error('Bağlantı zaman aşımına uğradı')));
        req.on('error', (err) => reject(networkError(err)));
    });
}

function readLimited(res, max) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
            size += chunk.length;
            if (size > max) {
                res.destroy(new Error('Yanıt çok büyük'));
                return;
            }
            chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
    });
}

function pickTarget(manifest, version) {
    const spec = PLATFORM_TARGETS[process.platform];
    if (!spec) return null;
    if (process.platform === 'linux' && process.arch !== 'x64') throw new Error('Bu işlemci mimarisi için paket yok');

    const raw = manifest['url_' + spec.kind];
    if (!raw) throw new Error('Bu platform için indirme adresi yok');

    let url;
    try {
        url = new URL(raw);
    } catch (err) {
        throw new Error('Manifestteki url_' + spec.kind + ' geçersiz');
    }

    const expectedPrefix = DOWNLOAD_PATH_PREFIX + 'v' + version + '/';
    const name = url.pathname.slice(expectedPrefix.length);
    const valid = url.protocol === 'https:'
        && url.hostname === 'github.com'
        && !url.username
        && !url.password
        && !url.port
        && !url.search
        && !url.hash
        && url.pathname.startsWith(expectedPrefix)
        && FILE_RE.test(name)
        && name.toLowerCase().endsWith(spec.ext.toLowerCase());
    if (!valid) throw new Error('Manifestteki url_' + spec.kind + ' güvenilir değil');

    return { kind: spec.kind, ext: spec.ext, url: url.toString(), name: name, hash: '' };
}

async function fetchDigest(target, version, signal) {
    const url = 'https://api.github.com' + RELEASE_API_PREFIX + 'v' + version;
    const res = await get(url, {
        allow: releaseAllow(version),
        accept: 'application/vnd.github+json',
        timeout: REQUEST_TIMEOUT,
        redirects: false,
        signal: signal
    }, 0);

    let release;
    try {
        release = JSON.parse((await readLimited(res, MAX_JSON_BYTES)).toString('utf8'));
    } catch (err) {
        throw new Error('Sürüm bilgisi okunamadı');
    }

    const assets = release && Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => item && item.name === target.name && item.browser_download_url === target.url);
    if (!asset || asset.state !== 'uploaded') throw new Error('Sürüm dosyası GitHub\'da bulunamadı');

    const match = DIGEST_RE.exec(String(asset.digest || ''));
    if (!match) throw new Error('GitHub dosya özeti (digest) bulunamadı');

    const hash = match[1].toLowerCase();
    if (!HASH_RE.test(hash)) throw new Error('GitHub dosya özeti geçersiz');
    return hash;
}

function updatesDir() {
    return path.join(app.getPath('userData'), 'updates');
}

function uiDir() {
    return path.join(app.getPath('userData'), UI_DIR_NAME);
}

function prepareDir() {
    const dir = updatesDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function cleanDir(keep) {
    const dir = updatesDir();
    let names = [];
    try {
        names = fs.readdirSync(dir);
    } catch (err) {
        return;
    }
    for (const name of names) {
        if (name === keep) continue;
        try {
            fs.rmSync(path.join(dir, name), { force: true, recursive: true });
        } catch (err) {}
    }
}

function resetState() {
    cleanDir('');
    state.phase = 'idle';
    state.percent = 0;
    state.file = '';
    state.hash = '';
}

function sameHash(a, b) {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
}

function hashFile(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function hasExeMagic(file) {
    let fd = -1;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(2);
        const read = fs.readSync(fd, head, 0, 2, 0);
        return read === 2 && head[0] === 0x4d && head[1] === 0x5a;
    } catch (err) {
        return false;
    } finally {
        if (fd >= 0) {
            try {
                fs.closeSync(fd);
            } catch (err) {}
        }
    }
}

async function verifiedFile() {
    const file = state.file;
    if (!file || path.dirname(file) !== updatesDir()) throw new Error('Güncelleme dosyası geçersiz konumda');

    let stat;
    try {
        stat = fs.lstatSync(file);
    } catch (err) {
        resetState();
        throw new Error('Güncelleme dosyası bulunamadı, yeniden indirilecek');
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Güncelleme dosyası geçersiz');

    const digest = await hashFile(file);
    if (!sameHash(digest, state.hash)) {
        resetState();
        throw new Error('Dosya doğrulaması başarısız, yeniden indirilecek');
    }
    if (process.platform === 'win32' && !hasExeMagic(file)) {
        resetState();
        throw new Error('Kurulum dosyası geçersiz, yeniden indirilecek');
    }
    return file;
}

function cleanEnv() {
    const env = Object.assign({}, process.env);
    STRIPPED_ENV.forEach((key) => {
        delete env[key];
    });
    return env;
}

async function download(target, version, signal, onProgress, expectedHash) {
    const dir = prepareDir();
    cleanDir('');
    const finalPath = path.join(dir, 'anka-web-' + version + target.ext);
    const partPath = path.join(dir, crypto.randomBytes(8).toString('hex') + '.part');

    try {
        const res = await get(target.url, { allow: downloadAllow, timeout: DOWNLOAD_IDLE_TIMEOUT, redirects: true, signal: signal }, 0);
        const total = Number(res.headers['content-length']) || 0;
        if (total > MAX_DOWNLOAD_BYTES) {
            res.destroy();
            throw new Error('Dosya çok büyük');
        }

        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(partPath, { flags: 'wx', mode: 0o600, highWaterMark: 1024 * 1024 });

        await new Promise((resolve, reject) => {
            let received = 0;
            let last = 0;
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
                if (received > MAX_DOWNLOAD_BYTES) {
                    fail(new Error('Dosya çok büyük'));
                    return;
                }
                hash.update(chunk);
                if (!out.write(chunk)) {
                    res.pause();
                    out.once('drain', () => res.resume());
                }
                const now = Date.now();
                if (total && now - last >= PROGRESS_MS) {
                    last = now;
                    onProgress(Math.min(99, Math.floor((received / total) * 100)));
                }
            });

            res.on('error', fail);
            res.on('close', () => {
                if (!res.complete) fail(new Error('İndirme yarıda kesildi'));
            });
            out.on('error', fail);
            res.on('end', () => {
                if (settled) return;
                if (total && received !== total) {
                    fail(new Error('İndirilen dosya eksik'));
                    return;
                }
                out.end(() => {
                    if (settled) return;
                    settled = true;
                    resolve();
                });
            });
        });

        const expected = await expectedHash;
        if (!sameHash(hash.digest('hex'), expected)) throw new Error('Dosya doğrulaması başarısız');
        fs.renameSync(partPath, finalPath);
        return finalPath;
    } catch (err) {
        try {
            fs.rmSync(partPath, { force: true });
        } catch (cleanupErr) {}
        throw err;
    }
}

function runProcess(command, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: env || cleanEnv() });
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => {
            if (out.length < MAX_OUTPUT_BYTES) out += chunk;
        });
        child.stderr.on('data', (chunk) => {
            if (err.length < MAX_OUTPUT_BYTES) err += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code: code, out: out, err: err }));
    });
}

function launchDetached(command, args, cwd, hide) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: !!hide, cwd: cwd, env: cleanEnv() });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

async function launchWindowsInstaller(file, args, onElevate) {
    try {
        await launchDetached(file, args, path.dirname(file), true);
        return;
    } catch (err) {
        const needsElevation = err && (ELEVATE_CODES.has(err.code) || err.errno === 740 || err.errno === -740);
        if (!needsElevation) throw err;
    }

    if (typeof onElevate === 'function') onElevate();

    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!fs.existsSync(powershell)) throw new Error('Yönetici izni istenemedi');

    const list = args.map((item) => "'" + item + "'").join(',');
    const command = "$ErrorActionPreference='Stop';Start-Process -FilePath $env:ANKA_UPDATE_FILE -ArgumentList @(" + list + ') -Verb RunAs';
    const env = cleanEnv();
    env.ANKA_UPDATE_FILE = file;

    const result = await runProcess(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], env);
    if (result.code !== 0) throw new Error('Yetkilendirme iptal edildi');
}

function findBrowser() {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LocalAppData].filter(Boolean);
    const relatives = [
        ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
        ['Google', 'Chrome', 'Application', 'chrome.exe']
    ];
    for (const relative of relatives) {
        for (const root of roots) {
            const candidate = path.join.apply(path, [root].concat(relative));
            try {
                if (fs.statSync(candidate).isFile()) return candidate;
            } catch (err) {}
        }
    }
    return null;
}

function uiBounds() {
    const area = screen.getPrimaryDisplay().workArea;
    return {
        x: Math.round(area.x + (area.width - UI_WIDTH) / 2),
        y: Math.round(area.y + (area.height - UI_HEIGHT) / 2)
    };
}

async function launchStandaloneUi(page, dir) {
    const browser = findBrowser();
    if (!browser) return false;
    const pos = uiBounds();
    const args = [
        '--app=' + pathToFileURL(page).toString(),
        '--user-data-dir=' + path.join(dir, 'profile'),
        '--window-size=' + UI_WIDTH + ',' + UI_HEIGHT,
        '--window-position=' + pos.x + ',' + pos.y,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-features=Translate,msEdgeSidebar,msUndersideButton'
    ];
    try {
        await launchDetached(browser, args, dir, false);
        return true;
    } catch (err) {
        return false;
    }
}

function openWindowUi(page) {
    const ui = new BrowserWindow({
        width: UI_WIDTH,
        height: UI_HEIGHT,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        center: true,
        alwaysOnTop: true,
        backgroundColor: '#0b0b0f',
        title: 'Anka Web Güncelleme',
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            devTools: false
        }
    });
    ui.setMenu(null);
    ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ui.webContents.on('will-navigate', (event) => event.preventDefault());
    ui.once('ready-to-show', () => {
        if (!ui.isDestroyed()) ui.show();
    });
    ui.loadFile(page).catch(() => {});
    return ui;
}

function writeStatus(data) {
    const dir = uiDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, STATUS_FILE);
    const temp = file + '.tmp';
    const content = 'window.__ankaStatus=' + safeJson(data) + ';';
    try {
        fs.writeFileSync(temp, content, { mode: 0o600 });
        fs.renameSync(temp, file);
    } catch (err) {
        try {
            fs.rmSync(temp, { force: true });
        } catch (cleanupErr) {}
        fs.writeFileSync(file, content, { mode: 0o600 });
    }
}

function pushStatus(phase, message) {
    try {
        writeStatus({
            phase: phase,
            version: state.version,
            message: message || '',
            startedAt: progress.startedAt || Date.now(),
            at: Date.now()
        });
    } catch (err) {}
}

async function openProgressUi() {
    try {
        progress.startedAt = Date.now();
        const dir = uiDir();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {}
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

        const page = path.join(dir, UI_FILE);
        fs.writeFileSync(page, fs.readFileSync(path.join(__dirname, UI_SOURCE)), { mode: 0o600 });
        pushStatus('preparing');
        fs.writeFileSync(path.join(dir, ACTIVE_FILE), JSON.stringify({ version: state.version, at: progress.startedAt }), { mode: 0o600 });

        if (process.platform === 'win32') {
            const launched = await launchStandaloneUi(page, dir);
            return launched ? { win: null } : null;
        }
        return { win: openWindowUi(page) };
    } catch (err) {
        return null;
    }
}

function closeProgressUi(session) {
    if (!session || !session.win) return;
    try {
        if (!session.win.isDestroyed()) session.win.destroy();
    } catch (err) {}
}

function hideWindows(session) {
    const keep = session && session.win ? session.win : null;
    const hidden = [];
    BrowserWindow.getAllWindows().forEach((item) => {
        try {
            if (item === keep || item.isDestroyed() || !item.isVisible()) return;
            item.hide();
            hidden.push(item);
        } catch (err) {}
    });
    return hidden;
}

function restoreWindows(list) {
    list.forEach((item) => {
        try {
            if (!item.isDestroyed()) item.show();
        } catch (err) {}
    });
}

function finishPendingUi(installedVersion) {
    const active = path.join(uiDir(), ACTIVE_FILE);
    let info = null;
    try {
        info = JSON.parse(fs.readFileSync(active, 'utf8'));
    } catch (err) {
        return;
    }

    const target = info && typeof info.version === 'string' ? info.version : '';
    const fresh = info && Number(info.at) > 0 && Date.now() - Number(info.at) < ACTIVE_MAX_AGE;
    try {
        fs.rmSync(active, { force: true });
    } catch (err) {}

    if (fresh && VERSION_RE.test(target)) {
        const ok = compareVersions(installedVersion, target) >= 0;
        try {
            writeStatus({
                phase: ok ? 'done' : 'failed',
                version: ok ? installedVersion : target,
                message: ok ? '' : 'Kurulum tamamlanamadı. Anka Web\'i kapatıp güncellemeyi tekrar deneyin.',
                startedAt: Number(info.at),
                at: Date.now()
            });
        } catch (err) {}
    }

    const timer = setTimeout(() => {
        try {
            fs.rmSync(uiDir(), { recursive: true, force: true });
        } catch (err) {}
    }, UI_CLEAN_DELAY);
    if (typeof timer.unref === 'function') timer.unref();
}

function hookQuit() {
    if (quitHook.hooked) return;
    quitHook.hooked = true;
    app.on('before-quit', (event) => {
        if (!quitHook.enabled || quitHook.handled) return;
        if (process.platform !== 'win32' || state.phase !== 'ready' || !state.file) return;
        quitHook.handled = true;
        event.preventDefault();
        verifiedFile()
            .then((file) => launchWindowsInstaller(file, SILENT_ARGS))
            .catch(() => {})
            .then(() => app.quit());
    });
}

function isLaunchable(file) {
    if (SKIP_BIN_RE.test(path.basename(file))) return false;
    const inBin = path.dirname(file) === '/usr/bin';
    const inOpt = path.dirname(path.dirname(file)) === '/opt';
    if (!inBin && !inOpt) return false;
    try {
        const stat = fs.statSync(file);
        return stat.isFile() && (stat.mode & 0o111) !== 0 && (stat.mode & 0o6000) === 0;
    } catch (err) {
        return false;
    }
}

async function installDeb(file) {
    if (!fs.existsSync(DPKG) || !fs.existsSync(DPKG_DEB)) throw new Error('Bu sistem .deb paketlerini desteklemiyor');
    if (!fs.existsSync(PKEXEC)) throw new Error('pkexec bulunamadı, polkit kurulu olmalı');

    const info = await runProcess(DPKG_DEB, ['-f', file, 'Package']);
    const name = info.out.trim();
    if (info.code !== 0 || !PKG_RE.test(name)) throw new Error('Geçersiz .deb paketi');

    const installer = fs.existsSync(APT_GET)
        ? [APT_GET, 'install', '-y', '--allow-downgrades', file]
        : [DPKG, '-i', file];

    const result = await runProcess(PKEXEC, [ENV_BIN, 'DEBIAN_FRONTEND=noninteractive'].concat(installer));
    if (result.code === 126 || result.code === 127) throw new Error('Yetkilendirme iptal edildi');
    if (result.code !== 0) throw new Error('Kurulum başarısız (kod ' + result.code + ')');

    return name;
}

async function findInstalledBinary(name) {
    const listed = await runProcess(DPKG, ['-L', name]);
    if (listed.code !== 0) return null;

    const files = listed.out.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('/'));
    if (files.includes(process.execPath) && isLaunchable(process.execPath)) return process.execPath;

    const candidates = files.filter(isLaunchable).sort((a, b) => {
        const x = path.dirname(a) === '/usr/bin' ? 0 : 1;
        const y = path.dirname(b) === '/usr/bin' ? 0 : 1;
        return x - y;
    });
    return candidates[0] || null;
}

async function installAndRelaunchLinux(file) {
    const name = await installDeb(file);
    const binary = await findInstalledBinary(name);
    if (!binary) throw new Error('Kurulum tamamlandı ancak uygulama başlatılamadı, elle açın');
    await launchDetached(SH_BIN, ['-c', 'sleep 2; exec "$0"', binary], path.dirname(binary), false);
}

function quitSoon() {
    setTimeout(() => app.quit(), 300);
    const force = setTimeout(() => app.exit(0), 5000);
    if (typeof force.unref === 'function') force.unref();
}

function init(win, currentVersion, options) {
    if (!win || win.isDestroyed()) return;

    const previous = global.__ankaUpdaterInstance;
    if (previous) previous.destroy();

    const contents = win.webContents;
    const installed = String(currentVersion || app.getVersion());
    const startManual = !!(options && options.manual);

    quitHook.enabled = !!(options && options.installOnQuit);
    hookQuit();

    if (!global.__ankaUiFinalized) {
        global.__ankaUiFinalized = true;
        finishPendingUi(installed);
    }

    let destroyed = false;
    let busy = false;
    let installing = false;
    let uiReady = false;
    let lastCheck = 0;
    let firstTimer = null;
    let intervalTimer = null;
    let pollTimer = null;
    let abortCtl = null;

    async function ensureUi() {
        if (destroyed || win.isDestroyed()) return false;
        if (uiReady) return true;
        try {
            await contents.executeJavaScript('(' + BOOT_SOURCE + ')(' + UI_VERSION + ')');
            uiReady = true;
            if (!pollTimer) {
                const hasIpc = await contents.executeJavaScript('Boolean(window.__ankaUpdater && window.__ankaUpdater.ipc)');
                if (!hasIpc) startPoll();
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    async function send(view) {
        if (!(await ensureUi())) return;
        try {
            await contents.executeJavaScript('window.__ankaUpdater&&window.__ankaUpdater.render(' + safeJson(view) + ')');
        } catch (err) {}
    }

    function paint() {
        if (state.phase === 'idle' || state.snoozed === state.version) return;
        send({ view: 'update', version: state.version, percent: state.percent, ready: state.phase === 'ready' });
    }

    function startPoll() {
        pollTimer = setInterval(async () => {
            if (destroyed || win.isDestroyed()) return;
            try {
                const action = await contents.executeJavaScript('window.__ankaUpdater?window.__ankaUpdater.pop():null');
                if (typeof action === 'string') handle(action);
            } catch (err) {}
        }, POLL_MS);
        if (typeof pollTimer.unref === 'function') pollTimer.unref();
    }

    async function check(manual) {
        if (destroyed) return;
        if (busy) {
            if (manual) {
                state.snoozed = '';
                paint();
            }
            return;
        }

        busy = true;
        lastCheck = Date.now();
        if (manual) state.snoozed = '';
        const ctl = new AbortController();
        const downloadCtl = new AbortController();
        const forwardAbort = () => downloadCtl.abort();
        ctl.signal.addEventListener('abort', forwardAbort, { once: true });
        abortCtl = ctl;

        try {
            const url = MANIFEST_URL + '?t=' + Date.now();
            const res = await get(url, { allow: manifestAllow, timeout: REQUEST_TIMEOUT, redirects: false, signal: ctl.signal }, 0);
            const manifest = parseManifest((await readLimited(res, MAX_MANIFEST_BYTES)).toString('utf8'));
            const version = String(manifest.version || '').trim();
            if (!VERSION_RE.test(version)) throw new Error('Manifestteki sürüm geçersiz');

            if (compareVersions(version, installed) <= 0) {
                if (state.phase !== 'idle') resetState();
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Uygulama güncel (v' + installed + ')' });
                return;
            }

            if (state.phase === 'ready' && state.version === version && state.file && fs.existsSync(state.file)) {
                paint();
                return;
            }

            const target = pickTarget(manifest, version);
            if (!target) {
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Bu platformda otomatik güncelleme desteklenmiyor' });
                return;
            }

            state.phase = 'downloading';
            state.version = version;
            state.percent = 0;
            state.file = '';
            state.hash = '';
            paint();

            const digestPromise = fetchDigest(target, version, downloadCtl.signal).catch((err) => {
                downloadCtl.abort();
                throw err;
            });

            const downloadPromise = download(target, version, downloadCtl.signal, (percent) => {
                state.percent = percent;
                paint();
            }, digestPromise);

            const results = await Promise.allSettled([digestPromise, downloadPromise]);
            if (results[0].status === 'rejected') throw results[0].reason;
            if (results[1].status === 'rejected') throw results[1].reason;

            if (destroyed) return;
            state.file = results[1].value;
            state.hash = results[0].value;
            state.percent = 100;
            state.phase = 'ready';
            state.snoozed = '';
            paint();
        } catch (err) {
            if (ctl.signal.aborted || destroyed) return;
            const visible = manual || state.phase === 'downloading';
            if (state.phase === 'downloading') {
                cleanDir('');
                state.phase = 'idle';
                state.percent = 0;
            }
            if (visible) await send({ view: 'error', message: err && err.message ? err.message : 'Bilinmeyen hata' });
        } finally {
            ctl.signal.removeEventListener('abort', forwardAbort);
            busy = false;
            if (abortCtl === ctl) abortCtl = null;
        }
    }

    async function install() {
        if (installing || destroyed) return;
        if (state.phase !== 'ready' || !state.file) return;
        installing = true;

        let session = null;
        let hidden = [];

        try {
            if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('Bu platformda kurulum desteklenmiyor');

            const file = await verifiedFile();
            quitHook.handled = true;

            session = await openProgressUi();
            hidden = hideWindows(session);

            if (process.platform === 'win32') {
                pushStatus('installing');
                await launchWindowsInstaller(file, SILENT_RUN_ARGS, () => pushStatus('authorizing', 'Açılan yönetici izni penceresini onaylayın.'));
                pushStatus('installing');
            } else {
                pushStatus('installing', 'Yetkilendirme ve kurulum sürüyor, lütfen bekleyin.');
                await installAndRelaunchLinux(file);
                pushStatus('done');
                await delay(DONE_LINGER);
            }

            quitSoon();
        } catch (err) {
            quitHook.handled = false;
            const message = err && err.message ? err.message : 'Kurulum başlatılamadı';
            pushStatus('failed', message);
            closeProgressUi(session);
            restoreWindows(hidden);
            await send({ view: 'error', message: message });
        } finally {
            installing = false;
        }
    }

    function handle(action) {
        if (typeof action !== 'string' || !ACTIONS.has(action) || destroyed) return;

        if (action === 'later') {
            state.snoozed = state.version;
            send(null);
        } else if (action === 'close') {
            send(null);
        } else if (action === 'install') {
            install();
        } else if (action === 'retry') {
            if (state.phase === 'ready') install();
            else check(true);
        } else if (action === 'update') {
            if (state.phase === 'idle') check(true);
            else {
                state.snoozed = '';
                paint();
            }
        }
    }

    function onAction(event, action) {
        if (destroyed || win.isDestroyed() || !event || !event.sender) return;
        if (event.sender.id !== contents.id) return;
        if (event.senderFrame && contents.mainFrame && event.senderFrame !== contents.mainFrame) return;
        handle(action);
    }

    function onFocus() {
        if (Date.now() - lastCheck >= FOCUS_CHECK_GAP) check(false);
    }

    function onStartLoading() {
        uiReady = false;
    }

    function onFinishLoad() {
        uiReady = false;
        paint();
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(firstTimer);
        clearInterval(intervalTimer);
        clearInterval(pollTimer);
        if (abortCtl) abortCtl.abort();
        if (state.phase === 'downloading') {
            cleanDir('');
            state.phase = 'idle';
            state.percent = 0;
        }
        try {
            ipcMain.removeListener(ACTION_CHANNEL, onAction);
        } catch (err) {}
        try {
            contents.removeListener('did-start-loading', onStartLoading);
            contents.removeListener('did-finish-load', onFinishLoad);
            win.removeListener('focus', onFocus);
        } catch (err) {}
        if (win.__ankaUpdater && win.__ankaUpdater.owner === destroy) {
            try {
                delete win.__ankaUpdater;
            } catch (err) {}
        }
        if (global.__ankaUpdaterInstance && global.__ankaUpdaterInstance.destroy === destroy) {
            global.__ankaUpdaterInstance = null;
        }
    }

    ipcMain.on(ACTION_CHANNEL, onAction);
    contents.on('did-start-loading', onStartLoading);
    contents.on('did-finish-load', onFinishLoad);
    win.on('focus', onFocus);
    win.once('closed', destroy);

    win.__ankaUpdater = Object.freeze({
        owner: destroy,
        check: (manual) => check(!!manual),
        destroy: destroy
    });
    global.__ankaUpdaterInstance = { destroy: destroy };

    firstTimer = setTimeout(() => check(startManual), FIRST_CHECK_DELAY);
    intervalTimer = setInterval(() => check(false), CHECK_INTERVAL);
    if (typeof firstTimer.unref === 'function') firstTimer.unref();
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

    paint();
}

module.exports = { init };
