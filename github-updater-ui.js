const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, ipcMain } = require('electron');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/latest.yml';
const MANIFEST_PATH = '/' + OWNER + '/' + REPO + '/main/latest.yml';
const DOWNLOAD_PATH_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const RELEASE_API_PREFIX = '/repos/' + OWNER + '/' + REPO + '/releases/tags/';
const UI_VERSION = 8;
const FIRST_CHECK_DELAY = 500;
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOCUS_CHECK_GAP = 60 * 1000;
const AUTO_INSTALL_DELAY = 1500;
const REQUEST_TIMEOUT = 8000;
const DOWNLOAD_IDLE_TIMEOUT = 30000;
const DOWNLOAD_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_MARKER_BYTES = 4096;
const MARKER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NOTES_MAX = 600;
const POLL_MS = 250;
const PROGRESS_MS = 100;
const MARKER_FILE = 'anka-last-update.json';
const ACTION_CHANNEL = 'anka-updater:action';
const ACTIONS = new Set(['later', 'close', 'install', 'retry', 'update']);
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DIGEST_RE = /^sha256:([A-Fa-f0-9]{64})$/;
const PKG_RE = /^[a-z0-9][a-z0-9+._-]{0,100}$/i;
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
const DEB_IDS = new Set(['debian', 'ubuntu', 'linuxmint', 'pop', 'elementary', 'kali', 'raspbian', 'zorin', 'mx', 'devuan', 'neon', 'tuxedo', 'deepin', 'parrot', 'pureos', 'lmde']);
const RPM_IDS = new Set(['rhel', 'fedora', 'centos', 'rocky', 'almalinux', 'ol', 'suse', 'opensuse', 'opensuse-leap', 'opensuse-tumbleweed', 'sles', 'sled', 'mageia', 'openmandriva', 'pclinuxos', 'rosa', 'altlinux', 'alt', 'amzn', 'nobara', 'eurolinux', 'cloudlinux', 'scientific', 'redos', 'openeuler', 'euleros', 'tizen', 'qubes', 'berry', 'vine', 'turbolinux', 'asianux', 'clearos', 'geckolinux']);
const STRIPPED_ENV = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
const BIN_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];
const SH_BIN = '/bin/sh';
const LINUX_RELAUNCH = 'n=0; while kill -0 "$1" 2>/dev/null && [ "$n" -lt 100 ]; do n=$((n+1)); sleep 0.3; done; sleep 1; exec "$0"';
const WIN_PS_RUNAS = "Start-Process -FilePath $env:ANKA_UPDATE_FILE -ArgumentList '--updated','--force-run' -Verb RunAs";

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
                setButtons([]);
                animate('swap');
            }
            text.textContent = state.ready
                ? 'Kurulum penceresi birazdan açılacak, uygulama kapanıp kurulumdan sonra yeniden açılacak.'
                : 'İndiriliyor… %' + percent + (state.detail ? ' · ' + state.detail : '');
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
    kind: '',
    snoozed: '',
    notes: '',
    detail: '',
    attempted: ''
});

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

function releaseAllow(version) {
    return (url, redirected) => !redirected
        && url.hostname === 'api.github.com'
        && url.pathname === RELEASE_API_PREFIX + 'v' + version;
}

function networkError(err) {
    if (err && TRANSIENT_CODES.has(err.code)) {
        const out = new Error(err.code === 'ECONNRESET' || err.code === 'EPIPE' ? 'Bağlantı koptu' : 'İnternet bağlantısı yok');
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
                reject(new Error('GitHub istek sınırı aşıldı, biraz sonra tekrar deneyin'));
                return;
            }
            if (code !== 200) {
                res.resume();
                const failure = new Error('Sunucu yanıtı: ' + code);
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

function osIds() {
    let text = '';
    try {
        text = fs.readFileSync('/etc/os-release', 'utf8');
    } catch (err) {
        try {
            text = fs.readFileSync('/usr/lib/os-release', 'utf8');
        } catch (inner) {}
    }
    const ids = [];
    text.split('\n').forEach((line) => {
        const match = /^(ID|ID_LIKE)=(.*)$/.exec(line.trim());
        if (!match) return;
        match[2].replace(/^["']|["']$/g, '').toLowerCase().split(/\s+/).forEach((value) => {
            if (value) ids.push(value);
        });
    });
    return ids;
}

function linuxKinds() {
    const kinds = [];
    if (process.env.APPIMAGE) kinds.push('appimage');

    const ids = osIds();
    const immutable = fs.existsSync('/run/ostree-booted');
    const canDeb = !!(findBin('dpkg') && findBin('dpkg-deb'));
    const canRpm = !!(findBin('rpm') && (findBin('dnf') || findBin('yum') || findBin('zypper') || findBin('rpm')));
    const debLike = ids.some((id) => DEB_IDS.has(id));
    const rpmLike = ids.some((id) => RPM_IDS.has(id));

    if (!immutable && !process.env.APPIMAGE) {
        if (debLike && canDeb) kinds.push('deb');
        else if (rpmLike && canRpm) kinds.push('rpm');
        else if (canDeb) kinds.push('deb');
        else if (canRpm) kinds.push('rpm');
    }

    kinds.push('appimage', 'targz');
    return kinds.filter((kind, index) => kinds.indexOf(kind) === index);
}

function buildTarget(kind, raw, version) {
    const ext = EXTENSIONS[kind];
    let url;
    try {
        url = new URL(raw);
    } catch (err) {
        return null;
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
        && name.toLowerCase().endsWith(ext.toLowerCase());
    if (!valid) return null;

    return { kind: kind, ext: ext, url: url.toString(), name: name, hash: '' };
}

function pickTarget(manifest, version) {
    let kinds;
    if (process.platform === 'win32') kinds = ['exe', 'msi'];
    else if (process.platform === 'linux') kinds = linuxKinds();
    else return null;

    if (process.platform === 'linux' && process.arch !== 'x64') throw new Error('Bu işlemci mimarisi için paket yok');

    for (const kind of kinds) {
        const raw = manifest['url_' + kind];
        if (!raw) continue;
        const target = buildTarget(kind, raw, version);
        if (target) return target;
    }
    throw new Error('Bu sistem için uygun güncelleme paketi bulunamadı');
}

async function fetchRelease(target, version, signal) {
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
    return { hash: hash, notes: cleanNotes(release.body) };
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
    state.percent = 0;
    state.file = '';
    state.hash = '';
    state.kind = '';
    state.notes = '';
    state.detail = '';
    state.attempted = '';
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

function validMagic(kind, file) {
    const magic = MAGIC[kind];
    if (!magic) return false;
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

        const expected = await expectedHash;
        if (!sameHash(hash.digest('hex'), expected)) throw new Error('Dosya doğrulaması başarısız');
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

async function downloadWithRetry(target, version, signal, onProgress, expectedHash) {
    let lastError = null;
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
            return await download(target, version, signal, onProgress, expectedHash);
        } catch (err) {
            lastError = err;
            if (signal.aborted || !err || !err.transient || attempt === DOWNLOAD_ATTEMPTS - 1) throw err;
            await sleep(1500 * (attempt + 1), signal);
            if (signal.aborted) throw err;
        }
    }
    throw lastError;
}

function runProcess(command, args, extraEnv) {
    return new Promise((resolve, reject) => {
        const env = cleanEnv();
        if (extraEnv) Object.assign(env, extraEnv);
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: env });
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
            windowsVerbatimArguments: !!extra.verbatim,
            cwd: cwd,
            env: cleanEnv()
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
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
            if (win && !win.isDestroyed()) {
                win.destroy();
            }
        }
    } catch (e) {}

    const quitTimeout = setTimeout(() => {
        try {
            app.quit();
        } catch (e) {}
        
        const exitTimeout = setTimeout(() => {
            try {
                app.exit(0);
            } catch (e) {}
        }, 100);
        
        if (exitTimeout && typeof exitTimeout.unref === 'function') {
            exitTimeout.unref();
        }
    }, 300);

    if (quitTimeout && typeof quitTimeout.unref === 'function') {
        quitTimeout.unref();
    }

    const forceTimeout = setTimeout(() => {
        try {
            app.exit(0);
        } catch (e) {}
    }, 3000);

    if (forceTimeout && typeof forceTimeout.unref === 'function') {
        forceTimeout.unref();
    }
}

function systemPath(...parts) {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return path.join(root, 'System32', ...parts);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launchWindows(file, kind) {
    const dir = path.dirname(file);
    const currentPid = process.pid;

    const isProcessRunning = (pid) => {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(`tasklist /FI "PID eq ${pid}" /NH`, (err, stdout) => {
                if (err || !stdout) return resolve(false);
                resolve(stdout.includes(pid.toString()));
            });
        });
    };

    let attempts = 0;
    while (await isProcessRunning(currentPid) && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
    }

    if (await isProcessRunning(currentPid)) {
        throw new Error('Eski uygulama süreci tamamen sonlandırılamadı, kurulum iptal edildi.');
    }

    if (kind === 'msi') {
        const line = '/d /s /c ""' + systemPath('msiexec.exe') + '" /i "' + file + '" /passive /norestart & start "" "' + process.execPath + '""';
        await launchDetached(systemPath('cmd.exe'), [line], dir, { verbatim: true, hide: true });
        return;
    }

    try {
        await launchDetached(file, ['--updated', '--force-run'], dir, { hide: false });
    } catch (err) {
        const result = await runProcess(
            systemPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS_RUNAS],
            { ANKA_UPDATE_FILE: file }
        );
        if (result.code !== 0) throw new Error('Kurulum başlatılamadı veya yetkilendirme iptal edildi');
    }
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

function pickLaunchable(files) {
    if (files.includes(process.execPath) && isLaunchable(process.execPath)) return process.execPath;
    const candidates = files.filter(isLaunchable).sort((a, b) => {
        const x = path.dirname(a) === '/usr/bin' ? 0 : 1;
        const y = path.dirname(b) === '/usr/bin' ? 0 : 1;
        return x - y;
    });
    return candidates[0] || null;
}

function parseFileList(text) {
    return text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('/'));
}

async function runPrivileged(command, args) {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    let result;
    if (isRoot) {
        result = await runProcess(command, args);
    } else {
        const pkexec = findBin('pkexec');
        const env = findBin('env');
        if (!pkexec || !env) throw new Error('pkexec bulunamadı, polkit kurulu olmalı');
        result = await runProcess(pkexec, [env, 'DEBIAN_FRONTEND=noninteractive', command].concat(args));
    }
    if (result.code === 126 || result.code === 127) throw new Error('Yetkilendirme iptal edildi');
    if (result.code !== 0) throw new Error('Kurulum başarısız (kod ' + result.code + ')');
    return result;
}

async function installDeb(file) {
    const dpkg = findBin('dpkg');
    const dpkgDeb = findBin('dpkg-deb');
    if (!dpkg || !dpkgDeb) throw new Error('Bu sistem .deb paketlerini desteklemiyor');

    const info = await runProcess(dpkgDeb, ['-f', file, 'Package']);
    const name = info.out.trim();
    if (info.code !== 0 || !PKG_RE.test(name)) throw new Error('Geçersiz .deb paketi');

    const aptGet = findBin('apt-get');
    if (aptGet) await runPrivileged(aptGet, ['install', '-y', '--allow-downgrades', file]);
    else await runPrivileged(dpkg, ['-i', file]);

    const listed = await runProcess(dpkg, ['-L', name]);
    if (listed.code !== 0) return null;
    return pickLaunchable(parseFileList(listed.out));
}

async function installRpm(file) {
    const rpm = findBin('rpm');
    if (!rpm) throw new Error('Bu sistem .rpm paketlerini desteklemiyor');

    const info = await runProcess(rpm, ['-qp', '--qf', '%{NAME}', file]);
    const name = info.out.trim();
    if (info.code !== 0 || !PKG_RE.test(name)) throw new Error('Geçersiz .rpm paketi');

    const dnf = findBin('dnf');
    const yum = findBin('yum');
    const zypper = findBin('zypper');

    if (dnf) await runPrivileged(dnf, ['install', '-y', '--nogpgcheck', file]);
    else if (zypper) await runPrivileged(zypper, ['--non-interactive', '--no-gpg-checks', 'install', '--allow-unsigned-rpm', '--allow-downgrade', file]);
    else if (yum) await runPrivileged(yum, ['install', '-y', '--nogpgcheck', file]);
    else await runPrivileged(rpm, ['-U', '--replacepkgs', '--nosignature', file]);

    const listed = await runProcess(rpm, ['-ql', name]);
    if (listed.code !== 0) return null;
    return pickLaunchable(parseFileList(listed.out));
}

function installAppImage(file) {
    const current = process.env.APPIMAGE;
    let dest;
    if (current && fs.existsSync(current)) {
        dest = current;
    } else {
        const dir = path.join(os.homedir(), '.local', 'share', 'anka-web');
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        dest = path.join(dir, 'Anka_Web.AppImage');
    }

    const temp = dest + '.new-' + process.pid;
    try {
        fs.copyFileSync(file, temp);
        fs.chmodSync(temp, 0o755);
        fs.renameSync(temp, dest);
    } catch (err) {
        try {
            fs.rmSync(temp, { force: true });
        } catch (cleanupErr) {}
        throw new Error('AppImage dosyası değiştirilemedi: ' + (err && err.code ? err.code : 'hata'));
    }
    return dest;
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
    return path.join(os.homedir(), '.local', 'share', 'anka-web');
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
    let binary = null;
    if (kind === 'deb') binary = await installDeb(file);
    else if (kind === 'rpm') binary = await installRpm(file);
    else if (kind === 'appimage') binary = installAppImage(file);
    else if (kind === 'targz') binary = await installTarGz(file);
    else throw new Error('Bu paket türü desteklenmiyor');

    if (!binary) throw new Error('Kurulum tamamlandı ancak uygulama başlatılamadı, elle açın');
    await launchDetached(SH_BIN, ['-c', LINUX_RELAUNCH, binary, String(process.pid)], path.dirname(binary), { hide: true });
}

function init(win, currentVersion, options) {
    if (!win || win.isDestroyed()) return;

    const previous = global.__ankaUpdaterInstance;
    if (previous) previous.destroy();

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
    let autoTimer = null;
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
        if (installing || state.phase === 'idle' || state.snoozed === state.version) return;
        send({
            view: 'update',
            version: state.version,
            percent: state.percent,
            ready: state.phase === 'ready',
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

    function scheduleInstall() {
        if (destroyed || installing || autoTimer) return;
        if (state.phase !== 'ready' || !state.file || state.attempted === state.version) return;
        state.attempted = state.version;
        autoTimer = setTimeout(() => {
            autoTimer = null;
            install();
        }, AUTO_INSTALL_DELAY);
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
                scheduleInstall();
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
            state.kind = target.kind;
            state.notes = '';
            state.detail = '';
            paint();

            const releasePromise = fetchRelease(target, version, downloadCtl.signal).catch((err) => {
                downloadCtl.abort();
                throw err;
            });
            const hashPromise = releasePromise.then((release) => release.hash);
            hashPromise.catch(() => {});

            const downloadPromise = downloadWithRetry(target, version, downloadCtl.signal, (percent, received, total) => {
                state.percent = percent;
                state.detail = total ? formatBytes(received) + ' / ' + formatBytes(total) : '';
                paint();
            }, hashPromise);

            const results = await Promise.allSettled([releasePromise, downloadPromise]);
            if (results[0].status === 'rejected') throw results[0].reason;
            if (results[1].status === 'rejected') throw results[1].reason;

            if (destroyed) return;
            state.file = results[1].value;
            state.hash = results[0].value.hash;
            state.notes = results[0].value.notes;
            state.detail = '';
            state.percent = 100;
            state.phase = 'ready';
            state.snoozed = '';
            paint();
            scheduleInstall();
        } catch (err) {
            if (ctl.signal.aborted || destroyed) return;
            const visible = manual || state.phase === 'downloading';
            if (state.phase === 'downloading') {
                cleanDir('');
                state.phase = 'idle';
                state.percent = 0;
                state.detail = '';
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
        clearTimeout(autoTimer);
        autoTimer = null;
        installing = true;
        const version = state.version;
        const kind = state.kind;

        try {
            const file = state.file;
            if (path.dirname(file) !== updatesDir()) throw new Error('Güncelleme dosyası geçersiz konumda');
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Güncelleme dosyası geçersiz');
            if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('Bu platformda kurulum desteklenmiyor');

            if (!validMagic(kind, file)) {
                resetState();
                throw new Error('Güncelleme dosyası geçersiz, yeniden indirilecek');
            }

            const digest = await hashFile(file);
            if (!sameHash(digest, state.hash)) {
                resetState();
                throw new Error('Dosya doğrulaması başarısız, yeniden indirilecek');
            }

            writeMarker(installed, version);

            if (process.platform === 'win32') {
                await send({ view: 'info', title: 'Anka Web', message: 'Kurulum penceresi açılıyor…', sticky: true });
                await launchWindows(file, kind);
                quitSoon();
                return;
            }

            await send({ view: 'info', title: 'Anka Web', message: 'Kurulum başlıyor. Yetki penceresi açılırsa onaylayın.', sticky: true });
            await installAndRelaunchLinux(file, kind);
            await send({ view: 'info', title: 'Güncelleme tamamlandı', message: 'Anka Web yeniden başlatılıyor…', sticky: true });
            await sleep(900);
            quitSoon();
        } catch (err) {
            removeMarker();
            installing = false;
            await send({ view: 'error', message: err && err.message ? err.message : 'Kurulum başlatılamadı' });
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
        flushAnnounce();
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(firstTimer);
        clearTimeout(autoTimer);
        clearInterval(intervalTimer);
        clearInterval(pollTimer);
        if (abortCtl) abortCtl.abort();
        if (state.phase === 'downloading') {
            cleanDir('');
            state.phase = 'idle';
            state.percent = 0;
            state.detail = '';
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
    if (!contents.isLoading()) flushAnnounce();
}

module.exports = { init };
