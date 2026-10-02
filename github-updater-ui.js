const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, shell } = require('electron');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const API_URL = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/latest';
const FIRST_CHECK_DELAY = 4000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 15000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const POLL_MS = 300;
const PROGRESS_MS = 150;

function bootUi() {
    if (window.__ankaUpdater) return true;

    const host = document.createElement('div');
    host.id = 'anka-updater-host';
    const root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `
        <style>
            :host { all: initial; }
            .card { position: fixed; right: 24px; bottom: 24px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; padding: 18px; border-radius: 14px; border: 1px solid var(--border, #27272a); background: var(--panel, #18181b); color: var(--text, #f4f4f5); box-shadow: var(--shadow-pop, 0 16px 32px rgba(0,0,0,.4)); font: 13px/1.5 var(--font, system-ui, sans-serif); z-index: 2147483000; animation: in .3s cubic-bezier(.16,1,.3,1); }
            @keyframes in { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: none; } }
            .title { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
            .text { margin: 0; color: var(--text-secondary, #a1a1aa); word-break: break-word; }
            .notes { margin: 10px 0 0; max-height: 96px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--bg, #121214); color: var(--text-secondary, #a1a1aa); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
            .track { height: 6px; margin-top: 14px; border-radius: 3px; background: var(--hover, #27272a); overflow: hidden; }
            .bar { height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, var(--accent, #ff4757), var(--accent-2, #ff7a45)); transition: width .2s ease; }
            .actions { display: flex; gap: 8px; margin-top: 16px; }
            .btn { flex: 1; min-height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border, #27272a); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; touch-action: manipulation; }
            .btn:hover { background: var(--hover, #27272a); }
            .btn.primary { flex: 2; background: var(--accent, #ff4757); border-color: transparent; color: #fff; }
            .btn.primary:hover { filter: brightness(1.08); }
            [hidden] { display: none !important; }
            @media (prefers-reduced-motion: reduce) { .card { animation: none; } .bar { transition: none; } }
        </style>
        <div class="card" role="status" aria-live="polite" hidden>
            <h3 class="title"></h3>
            <p class="text"></p>
            <div class="notes" hidden></div>
            <div class="track" hidden><div class="bar"></div></div>
            <div class="actions"></div>
        </div>
    `;

    const card = root.querySelector('.card');
    const title = root.querySelector('.title');
    const text = root.querySelector('.text');
    const notes = root.querySelector('.notes');
    const track = root.querySelector('.track');
    const bar = root.querySelector('.bar');
    const actions = root.querySelector('.actions');
    const queue = [];
    let hideTimer = 0;

    function setButtons(defs) {
        actions.replaceChildren();
        defs.forEach((def) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = def[2] ? 'btn primary' : 'btn';
            button.textContent = def[0];
            button.addEventListener('click', () => queue.push(def[1]));
            actions.appendChild(button);
        });
        actions.hidden = defs.length === 0;
    }

    function render(state) {
        clearTimeout(hideTimer);
        if (!state || state.view === 'hidden') {
            card.hidden = true;
            return;
        }

        notes.hidden = true;
        track.hidden = true;

        if (state.view === 'available') {
            title.textContent = 'Yeni sürüm: ' + state.version;
            text.textContent = 'Anka Web için güncelleme hazır.';
            if (state.notes) {
                notes.textContent = state.notes;
                notes.hidden = false;
            }
            setButtons([['Daha Sonra', 'later'], ['Şimdi Güncelle', 'update', true]]);
        } else if (state.view === 'downloading') {
            title.textContent = 'Güncelleme indiriliyor';
            text.textContent = '%' + state.percent;
            track.hidden = false;
            bar.style.width = state.percent + '%';
            setButtons([]);
        } else if (state.view === 'ready') {
            title.textContent = 'İndirme tamamlandı';
            text.textContent = 'Sürüm ' + state.version + ' kuruluma hazır. Uygulama yeniden başlatılacak.';
            setButtons([['Daha Sonra', 'later'], ['Kur ve Yeniden Başlat', 'install', true]]);
        } else if (state.view === 'error') {
            title.textContent = 'Güncelleme hatası';
            text.textContent = state.message || 'Bilinmeyen hata';
            setButtons([['Kapat', 'close'], ['Tekrar Dene', 'retry', true]]);
        } else {
            title.textContent = state.title || 'Anka Web';
            text.textContent = state.message || '';
            setButtons([]);
            hideTimer = setTimeout(() => { card.hidden = true; }, 6000);
        }

        card.hidden = false;
    }

    window.__ankaUpdater = Object.freeze({
        render: render,
        pop: () => queue.shift() || null
    });

    document.documentElement.appendChild(host);
    return true;
}

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

function request(url, depth = 0) {
    return new Promise((resolve, reject) => {
        if (!isTrustedUrl(url)) {
            reject(new Error('Güvenilmeyen adres engellendi'));
            return;
        }

        const req = https.get(url, {
            headers: { 'User-Agent': 'AnkaWeb-Updater', Accept: 'application/vnd.github+json, application/octet-stream' },
            timeout: REQUEST_TIMEOUT
        }, (res) => {
            const code = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
                res.resume();
                if (depth >= MAX_REDIRECTS) {
                    reject(new Error('Çok fazla yönlendirme'));
                    return;
                }
                resolve(request(new URL(res.headers.location, url).toString(), depth + 1));
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
        req.on('error', reject);
    });
}

async function fetchJson(url) {
    const res = await request(url);
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

async function downloadAsset(asset, onProgress, holder) {
    const dir = path.join(app.getPath('temp'), 'anka-update');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const safeName = path.basename(asset.name).replace(/[^\w.\-]/g, '_');
    const finalPath = path.join(dir, safeName);
    const partPath = finalPath + '.part';

    const res = await request(asset.browser_download_url);
    holder.res = res;

    const total = Number(res.headers['content-length']) || Number(asset.size) || 0;
    const expected = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : '';

    await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(partPath);
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
        res.on('aborted', () => fail(new Error('İndirme yarıda kesildi')));
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
        setTimeout(() => app.quit(), 600);
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
    let polling = false;
    let latest = null;
    let filePath = '';
    let lastState = { view: 'hidden' };
    let lastProgressAt = 0;
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

    function startPoll() {
        if (pollTimer) return;
        pollTimer = setInterval(async () => {
            if (polling || !alive()) return;
            polling = true;
            try {
                const action = await wc.executeJavaScript('window.__ankaUpdater ? window.__ankaUpdater.pop() : null');
                if (action) handleAction(action);
            } catch (err) {
            } finally {
                polling = false;
            }
        }, POLL_MS);
    }

    function send(state) {
        lastState = state;
        if (!alive()) return;
        wc.executeJavaScript('window.__ankaUpdater && window.__ankaUpdater.render(' + JSON.stringify(state) + ')').catch(() => {});
        if (['available', 'ready', 'error'].includes(state.view)) startPoll();
        else stopPoll();
    }

    function inject() {
        if (!alive()) return Promise.resolve();
        return wc.executeJavaScript('(' + bootUi.toString() + ')()')
            .then(() => {
                if (lastState.view !== 'hidden' && lastState.view !== 'info') send(lastState);
            })
            .catch(() => {});
    }

    async function check(manual) {
        if (busy || !alive()) return;
        try {
            const release = await fetchJson(API_URL);
            const tag = String(release.tag_name || '');

            if (!tag || compareVersions(tag, currentVersion) <= 0) {
                if (manual) send({ view: 'info', title: 'Güncelsin', message: 'Anka Web ' + currentVersion + ' en güncel sürüm.' });
                return;
            }
            if (!manual && skipped.has(tag)) return;

            const asset = pickAsset(Array.isArray(release.assets) ? release.assets : []);
            if (!asset) {
                if (manual) send({ view: 'error', message: 'Bu sistem için kurulum dosyası bulunamadı.' });
                return;
            }

            latest = { version: tag, asset: asset };
            filePath = '';
            send({ view: 'available', version: tag, notes: String(release.body || '').trim().slice(0, 600) });
        } catch (err) {
            if (manual) send({ view: 'error', message: err.message });
            else console.error('Güncelleme kontrolü başarısız:', err.message);
        }
    }

    async function startDownload() {
        if (busy || !latest) return;
        busy = true;
        send({ view: 'downloading', percent: 0, version: latest.version });
        try {
            filePath = await downloadAsset(latest.asset, (received, total) => {
                const now = Date.now();
                if (now - lastProgressAt < PROGRESS_MS) return;
                lastProgressAt = now;
                send({ view: 'downloading', percent: total ? Math.min(99, Math.floor((received / total) * 100)) : 0, version: latest.version });
            }, holder);
            busy = false;
            send({ view: 'ready', version: latest.version });
        } catch (err) {
            busy = false;
            send({ view: 'error', message: err.message });
        }
    }

    async function install() {
        if (busy || !filePath) return;
        busy = true;
        try {
            const result = await installFile(filePath);
            busy = false;
            if (result && result.message) send({ view: 'info', title: 'Kurulum', message: result.message });
        } catch (err) {
            busy = false;
            send({ view: 'error', message: err.message });
        }
    }

    function handleAction(action) {
        if (action === 'later' || action === 'close') {
            if (latest) skipped.add(latest.version);
            send({ view: 'hidden' });
        } else if (action === 'update') {
            startDownload();
        } else if (action === 'install') {
            install();
        } else if (action === 'retry') {
            check(true);
        }
    }

    function onDomReady() {
        inject();
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        stopPoll();
        clearTimeout(firstTimer);
        clearInterval(intervalTimer);
        if (holder.res) holder.res.destroy(new Error('İptal edildi'));
        try {
            if (!wc.isDestroyed()) {
                wc.removeListener('dom-ready', onDomReady);
                wc.executeJavaScript('window.__ankaUpdater && window.__ankaUpdater.render({ view: "hidden" })').catch(() => {});
            }
        } catch (err) {}
    }

    function start() {
        wc.on('dom-ready', onDomReady);
        win.once('closed', dispose);

        if (!wc.isLoading()) inject();

        if (context && context.manual) {
            inject().then(() => check(true));
        } else {
            firstTimer = setTimeout(() => check(false), FIRST_CHECK_DELAY);
        }

        intervalTimer = setInterval(() => check(false), CHECK_INTERVAL);
    }

    return { start: start, dispose: dispose };
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
