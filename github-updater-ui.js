const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, ipcMain, BrowserWindow } = require('electron');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/refs/heads/main/latest.yml';
const MANIFEST_PATH = '/' + OWNER + '/' + REPO + '/refs/heads/main/latest.yml';
const DOWNLOAD_PATH_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const RELEASE_API_PREFIX = '/repos/' + OWNER + '/' + REPO + '/releases/tags/';
const LATEST_API_PATH = '/repos/' + OWNER + '/' + REPO + '/releases/latest';
const UI_VERSION = 14;
const FIRST_CHECK_DELAY = 1000;
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOCUS_CHECK_GAP = 60 * 1000;
const REQUEST_TIMEOUT = 10000;
const DOWNLOAD_IDLE_TIMEOUT = 30000;
const DOWNLOAD_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
const MIN_DOWNLOAD_BYTES = 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_MARKER_BYTES = 4096;
const MARKER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NOTES_MAX = 600;
const POLL_MS = 250;
const PROGRESS_MS = 100;
const HANDOFF_DELAY = 2000;
const MARKER_FILE = 'anka-last-update.json';
const ACTION_CHANNEL = 'anka-updater:action';
const ACTIONS = new Set(['later', 'close', 'install', 'retry', 'update', 'skip']);
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9._+()@ -]{1,200}$/;
const TAG_RE = /^[A-Za-z0-9._-]{1,100}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DIGEST_RE = /^sha256:([A-Fa-f0-9]{64})$/;
const SKIP_BIN_RE = /(chrome-sandbox|chrome_crashpad_handler|\.so(\.|$)|\.sh$|\.pak$|\.bin$|\.dat$|\.json$)/i;
const TRANSIENT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE']);
const EXTENSIONS = { exe: '.exe', msi: '.msi', deb: '.deb', rpm: '.rpm', appimage: '.AppImage', targz: '.tar.gz' };
const MAGIC = {
    exe: [0x4d, 0x5a],
    msi: [0xd0, 0xcf, 0x11, 0xe0],
    deb: [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e],
    rpm: [0xed, 0xab, 0xee, 0xdb],
    appimage: [0x7f, 0x45, 0x4c, 0x46],
    targz: [0x1f, 0x8b]
};
const STRIPPED_ENV = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
const BIN_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];
const SH_BIN = '/bin/sh';
const LINUX_RELAUNCH = 'n=0; while kill -0 "$1" 2>/dev/null && [ "$n" -lt 100 ]; do n=$((n+1)); sleep 0.3; done; sleep 1.5; exec "$0"';
const WIN_EXE_SCRIPT = [
    "try{Wait-Process -Id ([int]$env:ANKA_PID) -Timeout 40}catch{}",
    "Start-Sleep -Milliseconds 1500",
    "$a=@('/S','--updated')",
    "try{Start-Process -FilePath $env:ANKA_UPDATE_FILE -ArgumentList $a -WindowStyle Hidden -Wait}catch{}",
    "Start-Sleep -Milliseconds 1000",
    "Start-Process -FilePath $env:ANKA_EXEC"
].join('\n');

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
            const isReady = !!state.ready;
            const key = 'update:' + state.version + ':' + (isReady ? 'ready' : (state.prompt ? 'prompt' : 'load'));

            if (key !== currentKey) {
                currentKey = key;
                setIcon(isReady ? 'check' : 'download', isReady ? 'done' : 'busy');

                if (state.prompt) {
                    title.textContent = 'Yeni sürüm mevcut: ' + state.version;
                    text.textContent = 'Güncellemeyi yüklemek istiyor musunuz?';
                    setButtons([['Daha Sonra', 'skip'], ['Güncelle', 'update', true]]);
                } else if (isReady) {
                    title.textContent = 'Güncelleme hazır: ' + state.version;
                    text.textContent = 'Arka planda güncelleniyor…';
                    setButtons([]);
                } else {
                    title.textContent = 'Yeni sürüm indiriliyor: ' + state.version;
                    setButtons([['İptal Et', 'skip']]);
                }

                notes.textContent = state.notes || '';
                notes.hidden = !state.notes;
                track.hidden = isReady || state.prompt;
                animate('swap');
            }

            if (!state.prompt && !isReady) {
                text.textContent = 'İndiriliyor… %' + percent + (state.detail ? ' · ' + state.detail : '');
                bar.style.transform = 'scaleX(' + percent / 100 + ')';
            }
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
    kind: '',
    snoozed: '',
    notes: '',
    detail: '',
    targets: []
});

if (!Array.isArray(state.targets)) state.targets = [];

function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        }
    });
}

function transientError(message) {
    const err = new Error(message);
    err.transient = true;
    return err;
}

function formatBytes(value) {
    return (Number(value) / 1048576).toFixed(1) + ' MB';
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
    String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line) => {
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

function cleanNotes(value) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/[*`_]/g, '')
        .trim()
        .slice(0, NOTES_MAX);
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

function releaseAllow(apiPath) {
    return (url, redirected) => !redirected
        && url.hostname === 'api.github.com'
        && url.pathname === apiPath;
}

function networkError(err) {
    if (err && TRANSIENT_CODES.has(err.code)) {
        const out = new Error('İnternet bağlantısı yok');
        out.transient = true;
        return out;
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
                const limited = new Error('GitHub istek sınırı aşıldı, biraz sonra tekrar deneyin');
                limited.status = code;
                reject(limited);
                return;
            }
            if (code !== 200) {
                res.resume();
                const failure = new Error(code === 404 ? 'Dosya bulunamadı (404)' : 'Sunucu yanıtı: ' + code);
                failure.status = code;
                failure.transient = code >= 500;
                reject(failure);
                return;
            }
            resolve(res);
        });

        req.on('timeout', () => req.destroy(transientError('Bağlantı zaman aşımına uğradı')));
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
        res.on('error', (err) => reject(networkError(err)));
    });
}

function findBin(name) {
    for (const dir of BIN_DIRS) {
        const file = path.join(dir, name);
        try {
            fs.accessSync(file, fs.constants.X_OK);
            return file;
        } catch (err) {}
    }
    return null;
}

function linuxKinds() {
    return process.env.APPIMAGE ? ['appimage', 'targz'] : ['targz', 'appimage'];
}

function platformKinds() {
    if (process.platform === 'win32') return ['exe'];
    if (process.platform === 'linux') {
        if (process.arch !== 'x64') throw new Error('Bu işlemci mimarisi için paket yok');
        return linuxKinds();
    }
    return null;
}

function detectKind(name) {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.tar.gz')) return 'targz';
    if (lower.endsWith('.appimage')) return 'appimage';
    if (lower.endsWith('.deb')) return 'deb';
    if (lower.endsWith('.rpm')) return 'rpm';
    if (lower.endsWith('.msi')) return 'msi';
    if (lower.endsWith('.exe')) return 'exe';
    return null;
}

function archMismatch(name) {
    if (process.arch === 'x64') {
        return /(arm64|aarch64|armv7|armhf|i386|i686|ia32)/i.test(name) || /x86(?![_-]?64)/i.test(name);
    }
    if (process.arch === 'ia32') return /(x64|x86[_-]?64|amd64|arm64|aarch64)/i.test(name);
    return false;
}

function buildTarget(raw, hash) {
    let url;
    try {
        url = new URL(String(raw || '').trim());
    } catch (err) {
        return null;
    }

    const valid = url.protocol === 'https:'
        && url.hostname === 'github.com'
        && !url.username
        && !url.password
        && !url.port
        && !url.search
        && !url.hash
        && url.pathname.startsWith(DOWNLOAD_PATH_PREFIX);
    if (!valid) return null;

    const rest = url.pathname.slice(DOWNLOAD_PATH_PREFIX.length).split('/');
    if (rest.length !== 2 || !TAG_RE.test(rest[0]) || !rest[1]) return null;

    let name;
    try {
        name = decodeURIComponent(rest[1]);
    } catch (err) {
        return null;
    }
    if (!FILE_RE.test(name) || name.includes('..')) return null;

    const kind = detectKind(name);
    if (!kind) return null;

    return { kind: kind, ext: EXTENSIONS[kind], url: url.toString(), name: name, hash: hash || '' };
}

function collectTargets(manifest, assets, kinds) {
    const found = new Map();
    const hashes = new Map();
    assets.forEach((asset) => hashes.set(asset.name, asset.hash));

    const add = (target) => {
        if (!target || kinds.indexOf(target.kind) < 0) return;
        const existing = found.get(target.url);
        if (existing) {
            if (!existing.hash && target.hash) existing.hash = target.hash;
            return;
        }
        found.set(target.url, target);
    };

    Object.keys(manifest).forEach((key) => {
        if (!/^url_/.test(key)) return;
        const target = buildTarget(manifest[key], '');
        if (!target) return;
        const declared = String(manifest['sha256_' + key.slice(4)] || '').trim().toLowerCase();
        target.hash = hashes.get(target.name) || (HASH_RE.test(declared) ? declared : '');
        add(target);
    });

    assets.forEach((asset) => {
        if (/portable/i.test(asset.name) || archMismatch(asset.name)) return;
        add(buildTarget(asset.url, asset.hash));
    });

    return Array.from(found.values()).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
}

async function fetchReleaseJson(apiPath, signal) {
    const res = await get('https://api.github.com' + apiPath, {
        allow: releaseAllow(apiPath),
        accept: 'application/vnd.github+json',
        timeout: REQUEST_TIMEOUT,
        redirects: false,
        signal: signal
    }, 0);
    return JSON.parse((await readLimited(res, MAX_JSON_BYTES)).toString('utf8'));
}

async function fetchRelease(version, signal) {
    const paths = [RELEASE_API_PREFIX + 'v' + version, RELEASE_API_PREFIX + version, LATEST_API_PATH];
    for (const apiPath of paths) {
        if (signal.aborted) break;
        try {
            const release = await fetchReleaseJson(apiPath, signal);
            if (!release || typeof release !== 'object') continue;
            if (apiPath === LATEST_API_PATH && compareVersions(String(release.tag_name || ''), version) !== 0) continue;

            const list = Array.isArray(release.assets) ? release.assets : [];
            const assets = [];
            list.forEach((item) => {
                if (!item || typeof item.name !== 'string' || typeof item.browser_download_url !== 'string') return;
                const match = DIGEST_RE.exec(String(item.digest || ''));
                assets.push({ name: item.name, url: item.browser_download_url, hash: match ? match[1].toLowerCase() : '' });
            });
            return { assets: assets, notes: cleanNotes(release.body) };
        } catch (err) {
            if (err && (err.status === 403 || err.status === 429)) break;
        }
    }
    return { assets: [], notes: '' };
}

function updatesDir() {
    return path.join(app.getPath('userData'), 'updates');
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

function ensureSpace(dir, needed) {
    if (!needed || typeof fs.statfsSync !== 'function') return;
    let free = 0;
    try {
        const stats = fs.statfsSync(dir);
        free = Number(stats.bavail) * Number(stats.bsize);
    } catch (err) {
        return;
    }
    if (free > 0 && free < needed * 2) throw new Error('Diskte yeterli boş alan yok');
}

function resetState() {
    cleanDir('');
    state.phase = 'idle';
    state.version = '';
    state.percent = 0;
    state.file = '';
    state.kind = '';
    state.notes = '';
    state.detail = '';
    state.targets = [];
}

function markerPath() {
    return path.join(app.getPath('userData'), MARKER_FILE);
}

function writeMarker(from, to) {
    try {
        fs.writeFileSync(markerPath(), JSON.stringify({ from: String(from), to: String(to), at: Date.now() }), { mode: 0o600 });
    } catch (err) {}
}

function removeMarker() {
    try {
        fs.rmSync(markerPath(), { force: true });
    } catch (err) {}
}

function takeMarker(installed) {
    const file = markerPath();
    let data = null;
    try {
        if (fs.statSync(file).size <= MAX_MARKER_BYTES) data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        data = null;
    }
    removeMarker();
    if (!data || typeof data.to !== 'string' || !VERSION_RE.test(data.to)) return '';
    if (compareVersions(installed, data.to) < 0) return '';
    if (!(Date.now() - Number(data.at) < MARKER_MAX_AGE)) return '';
    return data.to;
}

function validMagic(kind, file) {
    const magic = MAGIC[kind];
    if (!magic) return true;
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(magic.length);
        if (fs.readSync(fd, head, 0, magic.length, 0) !== magic.length) return false;
        return magic.every((byte, index) => head[index] === byte);
    } catch (err) {
        return false;
    } finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            } catch (err) {}
        }
    }
}

function cleanEnv(extra) {
    const env = Object.assign({}, process.env);
    STRIPPED_ENV.forEach((key) => {
        delete env[key];
    });
    if (extra) Object.assign(env, extra);
    return env;
}

async function download(target, version, signal, onProgress) {
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

        try {
            ensureSpace(dir, total);
        } catch (err) {
            res.destroy();
            throw err;
        }

        onProgress(0, 0, total);

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
                    onProgress(Math.min(99, Math.floor((received / total) * 100)), received, total);
                }
            });

            res.on('error', (err) => fail(networkError(err)));
            res.on('close', () => {
                if (!res.complete) fail(transientError('İndirme yarıda kesildi'));
            });
            out.on('error', fail);
            res.on('end', () => {
                if (settled) return;
                if (total && received !== total) {
                    fail(transientError('İndirilen dosya eksik'));
                    return;
                }
                out.end(() => {
                    if (settled) return;
                    settled = true;
                    resolve();
                });
            });
        });

        if (fs.statSync(partPath).size < MIN_DOWNLOAD_BYTES) throw new Error('İndirilen dosya geçersiz');
        if (target.hash && hash.digest('hex') !== target.hash) throw new Error('Dosya doğrulaması başarısız');
        if (!validMagic(target.kind, partPath)) throw new Error('İndirilen dosya geçerli bir kurulum dosyası değil');
        fs.renameSync(partPath, finalPath);
        return finalPath;
    } catch (err) {
        try {
            fs.rmSync(partPath, { force: true });
        } catch (cleanupErr) {}
        throw err;
    }
}

async function downloadWithRetry(target, version, signal, onProgress) {
    let lastError = null;
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
            return await download(target, version, signal, onProgress);
        } catch (err) {
            lastError = err;
            if (signal.aborted || !err || !err.transient || attempt === DOWNLOAD_ATTEMPTS - 1) throw err;
            await sleep(1500 * (attempt + 1), signal);
            if (signal.aborted) throw err;
        }
    }
    throw lastError;
}

async function downloadAny(targets, version, signal, onProgress) {
    const missing = [];
    for (const target of targets) {
        try {
            const file = await downloadWithRetry(target, version, signal, onProgress);
            return { file: file, target: target };
        } catch (err) {
            if (err && err.status === 404 && !signal.aborted) {
                missing.push(target.name);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Güncelleme dosyası GitHub\'da bulunamadı (404): ' + missing.join(', '));
}

function runProcess(command, args, extraEnv) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: cleanEnv(extraEnv) });
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

function launchDetached(command, args, cwd, options) {
    const extra = options || {};
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            shell: false,
            windowsHide: !!extra.hide,
            cwd: cwd,
            env: cleanEnv(extra.env)
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

function quitSoon() {
    try {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (win && !win.isDestroyed()) win.destroy();
        });
    } catch (e) {}

    setTimeout(() => {
        try {
            app.quit();
        } catch (e) {}
        setTimeout(() => {
            try {
                app.exit(0);
            } catch (e) {
                process.exit(0);
            }
        }, 1500);
    }, 200);
}

function systemPath(...parts) {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return path.join(root, 'System32', ...parts);
}

async function launchWindows(file) {
    await launchDetached(
        systemPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(WIN_EXE_SCRIPT, 'utf16le').toString('base64')],
        path.dirname(file),
        { hide: true, env: { ANKA_UPDATE_FILE: file, ANKA_PID: String(process.pid), ANKA_EXEC: process.execPath } }
    );
}

function userInstallDir() {
    return path.join(os.homedir(), '.local', 'share', 'anka-web');
}

function installAppImage(file) {
    const current = process.env.APPIMAGE;
    const targets = [];
    if (current && fs.existsSync(current)) targets.push(current);
    targets.push(path.join(userInstallDir(), 'Anka_Web.AppImage'));

    for (const dest of targets) {
        const temp = dest + '.new-' + process.pid;
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
            fs.copyFileSync(file, temp);
            fs.chmodSync(temp, 0o755);
            fs.renameSync(temp, dest);
            return dest;
        } catch (err) {
            try {
                fs.rmSync(temp, { force: true });
            } catch (cleanupErr) {}
        }
    }
    throw new Error('AppImage dosyası değiştirilemedi');
}

function tarRoot() {
    const exec = process.execPath;
    const dir = path.dirname(exec);
    const foreign = /^\/(usr|opt|snap|nix)\//.test(dir + '/') || /^electron/i.test(path.basename(exec));
    if (!process.env.APPIMAGE && !foreign) {
        try {
            fs.accessSync(dir, fs.constants.W_OK);
            fs.accessSync(path.dirname(dir), fs.constants.W_OK);
            return dir;
        } catch (err) {}
    }
    return userInstallDir();
}

function findExecutable(dir) {
    const preferred = path.basename(process.execPath);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let best = null;
    let bestSize = -1;
    for (const entry of entries) {
        if (!entry.isFile() || SKIP_BIN_RE.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const stat = fs.statSync(full);
        if ((stat.mode & 0o111) === 0) continue;
        if (entry.name === preferred) return entry.name;
        if (stat.size > bestSize) {
            best = entry.name;
            bestSize = stat.size;
        }
    }
    return best;
}

async function installTarGz(file) {
    const tar = findBin('tar');
    if (!tar) throw new Error('tar bulunamadı');

    const root = tarRoot();
    const parent = path.dirname(root);
    fs.mkdirSync(parent, { recursive: true, mode: 0o755 });

    const staging = root + '.new-' + process.pid;
    const old = root + '.old-' + process.pid;
    fs.rmSync(staging, { force: true, recursive: true });
    fs.mkdirSync(staging, { mode: 0o755 });

    try {
        const result = await runProcess(tar, ['-xzf', file, '-C', staging, '--no-same-owner']);
        if (result.code !== 0) throw new Error('Arşiv açılamadı');

        let source = staging;
        const entries = fs.readdirSync(staging, { withFileTypes: true });
        if (entries.length === 1 && entries[0].isDirectory()) source = path.join(staging, entries[0].name);

        const exeName = findExecutable(source);
        if (!exeName) throw new Error('Arşivde çalıştırılabilir dosya bulunamadı');

        const hadOld = fs.existsSync(root);
        if (hadOld) fs.renameSync(root, old);
        try {
            fs.renameSync(source, root);
        } catch (err) {
            if (hadOld) fs.renameSync(old, root);
            throw err;
        }

        fs.rmSync(staging, { force: true, recursive: true });
        if (hadOld) {
            try {
                fs.rmSync(old, { force: true, recursive: true });
            } catch (err) {}
        }
        return path.join(root, exeName);
    } catch (err) {
        try {
            fs.rmSync(staging, { force: true, recursive: true });
        } catch (cleanupErr) {}
        throw err;
    }
}

async function installAndRelaunchLinux(file, kind) {
    let binary;
    if (kind === 'appimage') binary = installAppImage(file);
    else if (kind === 'targz') binary = await installTarGz(file);
    else throw new Error('Bu paket türü desteklenmiyor');

    await launchDetached(SH_BIN, ['-c', LINUX_RELAUNCH, binary, String(process.pid)], path.dirname(binary), { hide: true });
}

function setupWindow(win, currentVersion, options) {
    if (!win || win.isDestroyed() || win.__ankaUpdater) return;

    const contents = win.webContents;
    const installed = String(currentVersion || app.getVersion());
    const startManual = !!(options && options.manual);
    const updatedTo = takeMarker(installed);

    let announce = updatedTo ? 'Anka Web v' + updatedTo + ' sürümüne güncellendi' : '';
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
        if (installing && state.phase === 'prompt') return;
        send({
            view: 'update',
            version: state.version,
            percent: state.percent,
            ready: state.phase === 'ready',
            prompt: state.phase === 'prompt',
            notes: state.notes || '',
            detail: state.detail || ''
        });
    }

    function flushAnnounce() {
        if (!announce) return;
        const message = announce;
        announce = '';
        send({ view: 'info', title: 'Anka Web', message: message });
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
        if (destroyed || installing) return;
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
        abortCtl = ctl;

        try {
            const url = MANIFEST_URL + '?t=' + Date.now();
            let res;
            try {
                res = await get(url, { allow: manifestAllow, timeout: REQUEST_TIMEOUT, redirects: false, signal: ctl.signal }, 0);
            } catch (err) {
                if (err && err.status === 404) throw new Error('latest.yml bulunamadı (404). Depo herkese açık olmalı ve dosya main dalının kökünde bulunmalı');
                throw err;
            }

            const manifest = parseManifest((await readLimited(res, MAX_MANIFEST_BYTES)).toString('utf8'));
            const version = String(manifest.version || '').trim();
            if (!VERSION_RE.test(version)) throw new Error('Manifestteki sürüm geçersiz');

            if (compareVersions(version, installed) <= 0) {
                if (state.phase !== 'idle') resetState();
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Uygulama güncel (v' + installed + ')' });
                return;
            }

            const kinds = platformKinds();
            if (!kinds) {
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Bu platformda otomatik güncelleme desteklenmiyor' });
                return;
            }

            if (state.version !== version || !state.targets.length) {
                const release = await fetchRelease(version, ctl.signal);
                const targets = collectTargets(manifest, release.assets, kinds);
                if (!targets.length) throw new Error('Bu sistem için uygun güncelleme paketi bulunamadı (aranan: ' + kinds.join(', ') + ')');

                state.version = version;
                state.targets = targets;
                state.kind = targets[0].kind;
                state.phase = 'prompt';
                state.percent = 0;
                state.file = '';
                state.notes = release.notes;
                state.detail = '';
            }

            paint();
        } catch (err) {
            if (ctl.signal.aborted || destroyed) return;
            if (manual) await send({ view: 'error', message: err && err.message ? err.message : 'İnternet bağlantısı yok' });
        } finally {
            busy = false;
            if (abortCtl === ctl) abortCtl = null;
        }
    }

    async function startDownloadAndInstall() {
        if (installing || destroyed || !state.targets.length) return;
        installing = true;
        const downloadCtl = new AbortController();
        abortCtl = downloadCtl;

        try {
            state.phase = 'downloading';
            state.percent = 0;
            state.detail = '';
            paint();

            const version = state.version;

            const result = await downloadAny(state.targets, version, downloadCtl.signal, (percent, received, total) => {
                state.percent = percent;
                state.detail = total ? formatBytes(received) + ' / ' + formatBytes(total) : '';
                paint();
            });

            if (destroyed) return;

            const file = result.file;
            const kind = result.target.kind;

            state.file = file;
            state.kind = kind;
            state.percent = 100;
            state.phase = 'ready';
            paint();

            writeMarker(installed, version);

            if (process.platform === 'win32') {
                await launchWindows(file);
            } else {
                await installAndRelaunchLinux(file, kind);
            }

            await sleep(HANDOFF_DELAY);
            if (destroyed) return;
            quitSoon();
        } catch (err) {
            installing = false;
            removeMarker();
            const cancelled = downloadCtl.signal.aborted || destroyed;
            resetState();
            if (!cancelled) await send({ view: 'error', message: err && err.message ? err.message : 'Kurulum başlatılamadı' });
        } finally {
            if (abortCtl === downloadCtl) abortCtl = null;
        }
    }

    function handle(action) {
        if (typeof action !== 'string' || !ACTIONS.has(action) || destroyed) return;

        if (action === 'later' || action === 'close' || action === 'skip') {
            state.snoozed = state.version;
            if (abortCtl) abortCtl.abort();
            send(null);
        } else if (action === 'install' || action === 'update') {
            startDownloadAndInstall();
        } else if (action === 'retry') {
            check(true);
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
        flushAnnounce();
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(firstTimer);
        clearInterval(intervalTimer);
        clearInterval(pollTimer);
        if (abortCtl) abortCtl.abort();
        try {
            ipcMain.removeListener(ACTION_CHANNEL, onAction);
        } catch (err) {}
        try {
            contents.removeListener('did-start-loading', onStartLoading);
            contents.removeListener('did-finish-load', onFinishLoad);
            win.removeListener('focus', onFocus);
        } catch (err) {}
        try {
            delete win.__ankaUpdater;
        } catch (err) {}
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

    firstTimer = setTimeout(() => check(startManual), FIRST_CHECK_DELAY);
    intervalTimer = setInterval(() => check(false), CHECK_INTERVAL);
    if (typeof firstTimer.unref === 'function') firstTimer.unref();
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

    paint();
    if (!contents.isLoading()) flushAnnounce();
}

function init(targetWin, currentVersion, options) {
    if (targetWin) {
        setupWindow(targetWin, currentVersion, options);
        return;
    }

    BrowserWindow.getAllWindows().forEach((win) => setupWindow(win, currentVersion, options));

    app.on('browser-window-created', (event, win) => {
        if (win.getParentWindow()) return;
        setupWindow(win, currentVersion, options);
    });
}

module.exports = { init };
