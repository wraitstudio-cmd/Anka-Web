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
const UI_VERSION = 10;
const FIRST_CHECK_DELAY = 500;
const CHECK_INTERVAL = 5 * 60 * 1000;
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
const POLL_MS = 250;
const MARKER_FILE = 'anka-last-update.json';
const ACTION_CHANNEL = 'anka-updater:action';
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;
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
const DEB_IDS = new Set(['debian', 'ubuntu', 'linuxmint', 'pop', 'elementary', 'kali', 'raspbian', 'zorin', 'mx', 'devuan', 'neon', 'tuxedo', 'deepin', 'parrot', 'pureos', 'lmde']);
const RPM_IDS = new Set(['rhel', 'fedora', 'centos', 'rocky', 'almalinux', 'ol', 'suse', 'opensuse', 'opensuse-leap', 'opensuse-tumbleweed', 'sles', 'sled', 'mageia', 'openmandriva', 'pclinuxos', 'rosa', 'altlinux', 'alt', 'amzn', 'nobara', 'eurolinux', 'cloudlinux', 'scientific', 'redos', 'openeuler', 'euleros', 'tizen', 'qubes', 'berry', 'vine', 'turbolinux', 'asianux', 'clearos', 'geckolinux']);
const STRIPPED_ENV = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
const BIN_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];
const SH_BIN = '/bin/sh';
const LINUX_RELAUNCH = 'n=0; while kill -0 "$1" 2>/dev/null && [ "$n" -lt 100 ]; do n=$((n+1)); sleep 0.3; done; sleep 1; exec "$0"';
const WIN_PS_RUNAS = "Start-Process -FilePath $env:ANKA_UPDATE_FILE -ArgumentList '--updated','--force-run','/S','/verysilent','/suppressmsgboxes','/norestart','/nogui' -Verb RunAs";

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
            .card { position: fixed; right: 24px; bottom: 24px; width: min(400px, calc(100vw - 32px)); box-sizing: border-box; display: flex; gap: 14px; padding: 18px; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.12); background: #18181b; color: #f4f4f5; box-shadow: 0 20px 40px rgba(0,0,0,.45); font: 13px/1.5 system-ui, sans-serif; z-index: 2147483000; overflow: hidden; animation: cardIn .42s cubic-bezier(.16,1,.3,1) both; }
            .card.out { animation: cardOut .22s cubic-bezier(.4,0,1,1) both; }
            .card::before { content: ''; position: absolute; left: 0; top: 0; right: 0; height: 2px; background: linear-gradient(90deg, #ff4757, #ff7a45); }
            @keyframes cardIn { from { opacity: 0; transform: translateY(28px) scale(.94); } to { opacity: 1; transform: none; } }
            @keyframes cardOut { to { opacity: 0; transform: translateY(20px) scale(.96); } }
            .icon { flex: 0 0 40px; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #ff4757, #ff7a45); }
            .icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
            .body { flex: 1; min-width: 0; }
            .title { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
            .text { margin: 0; color: #a1a1aa; word-break: break-word; }
            .actions { display: flex; gap: 8px; margin-top: 14px; }
            .btn { flex: 1; min-height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid #27272a; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; transition: background-color .15s ease; }
            .btn:hover { background: #27272a; }
            .btn.primary { background: #ff4757; border-color: transparent; color: #fff; }
            [hidden] { display: none !important; }
        </style>
        <div class="card" role="status" aria-live="polite" hidden>
            <div class="icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg></div>
            <div class="body">
                <h3 class="title"></h3>
                <p class="text"></p>
                <div class="actions"></div>
            </div>
        </div>
    `;

    const card = root.querySelector('.card');
    const title = root.querySelector('.title');
    const text = root.querySelector('.text');
    const actions = root.querySelector('.actions');
    const queue = [];
    let ipc = null;
    let leaveTimer = 0;

    try {
        if (typeof require === 'function') ipc = require('electron').ipcRenderer || null;
    } catch (err) {
        ipc = null;
    }

    function emit(action) {
        if (ipc) ipc.send('anka-updater:action', action);
        else queue.push(action);
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
        clearTimeout(leaveTimer);
        if (card.hidden || card.classList.contains('out')) {
            card.hidden = false;
            card.classList.remove('out');
        }
    }

    function dismiss() {
        if (card.hidden || card.classList.contains('out')) return;
        card.classList.add('out');
        leaveTimer = setTimeout(() => {
            card.hidden = true;
            card.classList.remove('out');
        }, 220);
    }

    function render(state) {
        if (!state) {
            dismiss();
            return;
        }
        if (state.view === 'prompt') {
            title.textContent = 'Güncelleme Mevcut';
            text.textContent = 'Anka Web v' + state.version + ' sürümü hazır. Şimdi güncellensin mi?';
            setButtons([['Daha sonra', 'later'], ['Güncelle', 'install', true]]);
            show();
            return;
        }
        if (state.view === 'error') {
            title.textContent = 'Güncelleme Başarısız';
            text.textContent = 'Güncelleme tamamlanamadı. Tekrar denemek ister misiniz?';
            setButtons([['Kapat', 'close'], ['Tekrar dene', 'retry', true]]);
            show();
            return;
        }
        dismiss();
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
    file: '',
    target: null,
    snoozed: ''
});

function safeJson(value) {
    return JSON.stringify(value);
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
    if (err && TRANSIENT_CODES.has(err.code)) {
        const out = new Error('Bağlantı hatası');
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
            reject(new Error('Güvenilmeyen adres'));
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
                    reject(new Error('Yönlendirme hatası'));
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
                reject(new Error('İstek sınırı aşıldı'));
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

        req.on('timeout', () => req.destroy(transientError('Zaman aşımı')));
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
                res.destroy(new Error('Çok büyük yanıt'));
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

    for (const kind of kinds) {
        const raw = manifest['url_' + kind];
        if (!raw) continue;
        const target = buildTarget(kind, raw, version);
        if (target) return target;
    }
    throw new Error('Paket bulunamadı');
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
        throw new Error('Sürüm okunamadı');
    }

    const assets = release && Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => item && item.name === target.name && item.browser_download_url === target.url);
    if (!asset || asset.state !== 'uploaded') throw new Error('Dosya bulunamadı');

    const match = DIGEST_RE.exec(String(asset.digest || ''));
    if (!match) throw new Error('Özet bulunamadı');

    const hash = match[1].toLowerCase();
    if (!HASH_RE.test(hash)) throw new Error('Geçersiz özet');
    return { hash: hash };
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

async function download(target, version, signal, expectedHash) {
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
            });

            res.on('error', (err) => fail(networkError(err)));
            res.on('close', () => {
                if (!res.complete) fail(transientError('İndirme kesildi'));
            });
            out.on('error', fail);
            res.on('end', () => {
                if (settled) return;
                out.end(() => {
                    if (settled) return;
                    settled = true;
                    resolve();
                });
            });
        });

        const expected = await expectedHash;
        if (!sameHash(hash.digest('hex'), expected)) throw new Error('Doğrulama başarısız');
        if (!validMagic(target.kind, partPath)) throw new Error('Geçersiz dosya');
        fs.renameSync(partPath, finalPath);
        return finalPath;
    } catch (err) {
        try {
            fs.rmSync(partPath, { force: true });
        } catch (cleanupErr) {}
        throw err;
    }
}

async function downloadWithRetry(target, version, signal, expectedHash) {
    let lastError = null;
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
            return await download(target, version, signal, expectedHash);
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

    setTimeout(() => {
        try {
            app.exit(0);
        } catch (e) {
            process.exit(0);
        }
    }, 200);
}

function systemPath(...parts) {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return path.join(root, 'System32', ...parts);
}

async function launchWindows(file, kind) {
    const dir = path.dirname(file);
    if (kind === 'msi') {
        const line = '/d /s /c ""' + systemPath('msiexec.exe') + '" /i "' + file + '" /quiet /norestart & start "" "' + process.execPath + '""';
        await launchDetached(systemPath('cmd.exe'), [line], dir, { verbatim: true, hide: true });
        return;
    }

    try {
        await launchDetached(file, ['--updated', '--force-run', '/S', '/verysilent', '/suppressmsgboxes', '/norestart', '/nogui'], dir, { hide: true });
    } catch (err) {
        const result = await runProcess(
            systemPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS_RUNAS],
            { ANKA_UPDATE_FILE: file }
        );
        if (result.code !== 0) throw new Error('Kurulum başlatılamadı');
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
        if (!pkexec || !env) throw new Error('Yetki yöneticisi bulunamadı');
        result = await runProcess(pkexec, [env, 'DEBIAN_FRONTEND=noninteractive', command].concat(args));
    }
    if (result.code !== 0) throw new Error('Kurulum başarısız');
    return result;
}

async function installDeb(file) {
    const dpkg = findBin('dpkg');
    const dpkgDeb = findBin('dpkg-deb');
    if (!dpkg || !dpkgDeb) throw new Error('Desteklenmiyor');

    const info = await runProcess(dpkgDeb, ['-f', file, 'Package']);
    const name = info.out.trim();
    const aptGet = findBin('apt-get');
    if (aptGet) await runPrivileged(aptGet, ['install', '-y', '-qq', '--allow-downgrades', file]);
    else await runPrivileged(dpkg, ['-i', file]);

    const listed = await runProcess(dpkg, ['-L', name]);
    if (listed.code !== 0) return null;
    return pickLaunchable(parseFileList(listed.out));
}

async function installRpm(file) {
    const rpm = findBin('rpm');
    if (!rpm) throw new Error('Desteklenmiyor');

    const info = await runProcess(rpm, ['-qp', '--qf', '%{NAME}', file]);
    const name = info.out.trim();
    const dnf = findBin('dnf');
    const yum = findBin('yum');
    const zypper = findBin('zypper');

    if (dnf) await runPrivileged(dnf, ['install', '-y', '-q', '--nogpgcheck', file]);
    else if (zypper) await runPrivileged(zypper, ['--non-interactive', '--no-gpg-checks', 'install', '--allow-unsigned-rpm', '--allow-downgrade', file]);
    else if (yum) await runPrivileged(yum, ['install', '-y', '-q', '--nogpgcheck', file]);
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
    fs.copyFileSync(file, temp);
    fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, dest);
    return dest;
}

async function installAndRelaunchLinux(file, kind) {
    let binary = null;
    if (kind === 'deb') binary = await installDeb(file);
    else if (kind === 'rpm') binary = await installRpm(file);
    else if (kind === 'appimage') binary = installAppImage(file);
    else throw new Error('Desteklenmeyen paket');

    if (!binary) throw new Error('Başlatılamadı');
    await launchDetached(SH_BIN, ['-c', LINUX_RELAUNCH, binary, String(process.pid)], path.dirname(binary), { hide: true });
}

function init(win, currentVersion, options) {
    if (!win || win.isDestroyed()) return;

    const previous = global.__ankaUpdaterInstance;
    if (previous) previous.destroy();

    const contents = win.webContents;
    const installed = String(currentVersion || app.getVersion());
    takeMarker(installed);

    if (state.phase !== 'downloading') state.phase = 'idle';

    let destroyed = false;
    let busy = false;
    let updating = false;
    let installing = false;
    let uiReady = false;
    let firstTimer = null;
    let intervalTimer = null;
    let pollTimer = null;
    let checkCtl = null;
    let updateCtl = null;

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

    async function install(target, version, file) {
        installing = true;
        try {
            writeMarker(installed, version);
            if (process.platform === 'win32') {
                await launchWindows(file, target.kind);
            } else {
                await installAndRelaunchLinux(file, target.kind);
            }
            quitSoon();
        } catch (err) {
            removeMarker();
            installing = false;
            throw err;
        }
    }

    async function runUpdate() {
        if (destroyed || installing || updating) return;
        const target = state.target;
        const version = state.version;
        if (!target || !version) return;

        updating = true;
        state.phase = 'downloading';
        const ctl = new AbortController();
        updateCtl = ctl;
        send(null);

        try {
            const release = await fetchRelease(target, version, ctl.signal);
            const file = await downloadWithRetry(target, version, ctl.signal, Promise.resolve(release.hash));
            if (destroyed || ctl.signal.aborted) return;
            state.file = file;
            await install(target, version, file);
        } catch (err) {
            if (!destroyed && !ctl.signal.aborted) send({ view: 'error' });
        } finally {
            updating = false;
            if (!installing) state.phase = 'idle';
            if (updateCtl === ctl) updateCtl = null;
        }
    }

    async function check() {
        if (destroyed || installing || busy || updating) return;
        busy = true;
        const ctl = new AbortController();
        checkCtl = ctl;

        try {
            const url = MANIFEST_URL + '?t=' + Date.now();
            const res = await get(url, { allow: manifestAllow, timeout: REQUEST_TIMEOUT, redirects: false, signal: ctl.signal }, 0);
            const manifest = parseManifest((await readLimited(res, MAX_MANIFEST_BYTES)).toString('utf8'));
            const version = String(manifest.version || '').trim();
            if (!VERSION_RE.test(version)) return;
            if (compareVersions(version, installed) <= 0) return;
            if (state.snoozed === version) return;
            if (state.phase === 'prompt' && state.version === version) return;

            const target = pickTarget(manifest, version);
            if (!target || destroyed) return;

            state.version = version;
            state.target = target;
            state.file = '';
            state.phase = 'prompt';
            await send({ view: 'prompt', version: version });
        } catch (err) {
        } finally {
            busy = false;
            if (checkCtl === ctl) checkCtl = null;
        }
    }

    function cancelUpdate() {
        if (updateCtl) updateCtl.abort();
        if (state.version) state.snoozed = state.version;
        state.phase = 'idle';
        send(null);
    }

    function handle(action) {
        if (destroyed) return;
        if (action === 'later' || action === 'close') {
            cancelUpdate();
        } else if (action === 'install' || action === 'update' || action === 'retry') {
            runUpdate();
        }
    }

    function onAction(event, action) {
        if (destroyed || win.isDestroyed() || !event || !event.sender) return;
        if (event.sender.id !== contents.id) return;
        handle(action);
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(firstTimer);
        clearInterval(intervalTimer);
        clearInterval(pollTimer);
        if (checkCtl) checkCtl.abort();
        if (updateCtl) updateCtl.abort();
        try {
            ipcMain.removeListener(ACTION_CHANNEL, onAction);
        } catch (err) {}
    }

    ipcMain.on(ACTION_CHANNEL, onAction);
    win.once('closed', destroy);
    global.__ankaUpdaterInstance = { destroy: destroy };

    firstTimer = setTimeout(() => check(), FIRST_CHECK_DELAY);
    intervalTimer = setInterval(() => check(), CHECK_INTERVAL);
    if (typeof firstTimer.unref === 'function') firstTimer.unref();
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
}

module.exports = { init };
