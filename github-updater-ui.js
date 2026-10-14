const { ipcMain, app, BrowserWindow } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const packageJson = require('../../package.json');

const CURRENT_VERSION = packageJson.version;
const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/latest.yml';
const MANIFEST_PATH = '/' + OWNER + '/' + REPO + '/main/latest.yml';
const DOWNLOAD_PATH_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const RELEASE_API_PREFIX = '/repos/' + OWNER + '/' + REPO + '/releases/tags/';

const TIMEOUT_MS = 8000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MARKER_FILE = 'anka-last-update.json';
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DIGEST_RE = /^sha256:([A-Fa-f0-9]{64})$/;
const PKG_RE = /^[a-z0-9][a-z0-9+._-]{0,100}$/i;
const SKIP_BIN_RE = /(chrome-sandbox|chrome_crashpad_handler|\.so(\.|$)|\.sh$|\.pak$|\.bin$|\.dat$|\.json$)/i;
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

let targetWin = null;
let updateInterval = null;
let isUpdating = false;

ipcMain.removeHandler('anka:get-version');
ipcMain.handle('anka:get-version', () => CURRENT_VERSION);

ipcMain.removeHandler('anka:check-update');
ipcMain.handle('anka:check-update', async () => {
    try {
        const manifest = await fetchManifest();
        const version = String(manifest.version || '').trim();
        if (!VERSION_RE.test(version) || compareVersions(version, CURRENT_VERSION) <= 0) {
            return { status: 'current', currentVersion: CURRENT_VERSION };
        }
        return { status: 'available', version: version, currentVersion: CURRENT_VERSION };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

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

function isAssetHost(host) {
    return host === 'github.com' || (host.endsWith('.githubusercontent.com') && host !== 'raw.githubusercontent.com');
}

function get(url, options, depth = 0) {
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
            headers: { 'User-Agent': 'AnkaWeb-Updater', 'Cache-Control': 'no-cache', Accept: options.accept || '*/*' },
            timeout: TIMEOUT_MS
        }, (res) => {
            const code = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
                res.resume();
                if (!options.redirects || depth >= 5) {
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
                reject(new Error('GitHub istek sınırı aşıldı'));
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

function fetchManifest() {
    return new Promise(async (resolve, reject) => {
        try {
            const url = MANIFEST_URL + '?t=' + Date.now();
            const res = await get(url, {
                allow: (u) => u.hostname === 'raw.githubusercontent.com' && u.pathname === MANIFEST_PATH,
                timeout: TIMEOUT_MS,
                redirects: false
            });
            const body = await readLimited(res, MAX_MANIFEST_BYTES);
            resolve(parseManifest(body.toString('utf8')));
        } catch (err) {
            reject(err);
        }
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
        && !url.username && !url.password && !url.port && !url.search && !url.hash
        && url.pathname.startsWith(expectedPrefix)
        && FILE_RE.test(name)
        && name.toLowerCase().endsWith(ext.toLowerCase());
    if (!valid) return null;
    return { kind: kind, ext: ext, url: url.toString(), name: name };
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
    throw new Error('Sisteminiz için uygun güncelleme paketi bulunamadı');
}

async function fetchRelease(target, version) {
    const url = 'https://api.github.com' + RELEASE_API_PREFIX + 'v' + version;
    const res = await get(url, {
        allow: (u) => u.hostname === 'api.github.com' && u.pathname === RELEASE_API_PREFIX + 'v' + version,
        accept: 'application/vnd.github+json',
        timeout: TIMEOUT_MS,
        redirects: false
    });
    const release = JSON.parse((await readLimited(res, MAX_JSON_BYTES)).toString('utf8'));
    const assets = release && Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => item && item.name === target.name && item.browser_download_url === target.url);
    if (!asset || asset.state !== 'uploaded') throw new Error('Sürüm dosyası GitHub üzerinde bulunamadı');
    const match = DIGEST_RE.exec(String(asset.digest || ''));
    if (!match) throw new Error('GitHub dosya özeti bulunamadı');
    return match[1].toLowerCase();
}

function updatesDir() {
    return path.join(app.getPath('userData'), 'updates');
}

function prepareDir() {
    const dir = updatesDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function cleanDir() {
    const dir = updatesDir();
    try {
        const names = fs.readdirSync(dir);
        for (const name of names) {
            fs.rmSync(path.join(dir, name), { force: true, recursive: true });
        }
    } catch (err) {}
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
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

function writeMarker(from, to) {
    try {
        fs.writeFileSync(path.join(app.getPath('userData'), MARKER_FILE), JSON.stringify({ from: String(from), to: String(to), at: Date.now() }), { mode: 0o600 });
    } catch (err) {}
}

function download(target, version, expectedHash) {
    return new Promise(async (resolve, reject) => {
        const dir = prepareDir();
        cleanDir();
        const finalPath = path.join(dir, 'anka-web-' + version + target.ext);
        const partPath = path.join(dir, crypto.randomBytes(8).toString('hex') + '.part');

        try {
            const res = await get(target.url, {
                allow: (u, redirected) => redirected ? isAssetHost(u.hostname) : u.hostname === 'github.com' && u.pathname.startsWith(DOWNLOAD_PATH_PREFIX),
                timeout: TIMEOUT_MS,
                redirects: true
            });
            const total = Number(res.headers['content-length']) || 0;
            if (total > MAX_DOWNLOAD_BYTES) {
                res.destroy();
                reject(new Error('Dosya çok büyük'));
                return;
            }

            const hash = crypto.createHash('sha256');
            const out = fs.createWriteStream(partPath, { flags: 'wx', mode: 0o600 });
            let received = 0;

            res.on('data', (chunk) => {
                received += chunk.length;
                hash.update(chunk);
                out.write(chunk);
            });

            res.on('error', (err) => {
                out.destroy();
                reject(err);
            });

            res.on('end', () => {
                out.end(async () => {
                    try {
                        const computed = hash.digest('hex');
                        if (!sameHash(computed, expectedHash)) {
                            reject(new Error('Dosya doğrulaması başarısız'));
                            return;
                        }
                        if (!validMagic(target.kind, partPath)) {
                            reject(new Error('İndirilen dosya geçerli değil'));
                            return;
                        }
                        fs.renameSync(partPath, finalPath);
                        resolve(finalPath);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        } catch (err) {
            reject(err);
        }
    });
}

function runProcess(command, args, extraEnv) {
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env);
        STRIPPED_ENV.forEach((k) => delete env[k]);
        if (extraEnv) Object.assign(env, extraEnv);
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: env });
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => { if (out.length < MAX_OUTPUT_BYTES) out += chunk; });
        child.stderr.on('data', (chunk) => { if (err.length < MAX_OUTPUT_BYTES) err += chunk; });
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
            env: process.env
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

function quitSoon(installerPath) {
    try {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
            if (win && !win.isDestroyed()) win.destroy();
        }
    } catch (e) {}

    if (installerPath) {
        try {
            const subprocess = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
            subprocess.unref();
        } catch (err) {}
    }

    setTimeout(() => {
        try { app.exit(0); } catch (e) { process.exit(0); }
    }, 200);
}

async function launchWindows(file, kind) {
    const dir = path.dirname(file);
    if (kind === 'msi') {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const msiexec = path.join(systemRoot, 'System32', 'msiexec.exe');
        const cmd = path.join(systemRoot, 'System32', 'cmd.exe');
        const line = '/d /s /c ""' + msiexec + '" /i "' + file + '" /quiet /norestart & start "" "' + process.execPath + '""';
        await launchDetached(cmd, [line], dir, { verbatim: true, hide: true });
        return;
    }
    try {
        await launchDetached(file, ['--updated', '--force-run', '/S', '/verysilent', '/suppressmsgboxes', '/norestart', '/nogui'], dir, { hide: true });
    } catch (err) {
        const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        await runProcess(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS_RUNAS], { ANKA_UPDATE_FILE: file });
    }
}

async function runPrivileged(command, args) {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (isRoot) return runProcess(command, args);
    const pkexec = findBin('pkexec');
    const env = findBin('env');
    if (!pkexec || !env) throw new Error('Yetki yöneticisi bulunamadı');
    const result = await runProcess(pkexec, [env, 'DEBIAN_FRONTEND=noninteractive', command].concat(args));
    if (result.code === 126 || result.code === 127) throw new Error('Yetkilendirme iptal edildi');
    if (result.code !== 0) throw new Error('Kurulum başarısız');
    return result;
}

async function installDeb(file) {
    const dpkg = findBin('dpkg');
    const dpkgDeb = findBin('dpkg-deb');
    if (!dpkg || !dpkgDeb) throw new Error('Sistem deb paketlerini desteklemiyor');
    const info = await runProcess(dpkgDeb, ['-f', file, 'Package']);
    const name = info.out.trim();
    const aptGet = findBin('apt-get');
    if (aptGet) await runPrivileged(aptGet, ['install', '-y', '-qq', '--allow-downgrades', file]);
    else await runPrivileged(dpkg, ['-i', file]);
    const listed = await runProcess(dpkg, ['-L', name]);
    return listed.code === 0 ? listed.out.split('\n').map(l => l.trim()).find(l => l.startsWith('/') && !SKIP_BIN_RE.test(path.basename(l))) : null;
}

async function installRpm(file) {
    const rpm = findBin('rpm');
    if (!rpm) throw new Error('Sistem rpm paketlerini desteklemiyor');
    const info = await runProcess(rpm, ['-qp', '--qf', '%{NAME}', file]);
    const name = info.out.trim();
    const dnf = findBin('dnf');
    const yum = findBin('yum');
    if (dnf) await runPrivileged(dnf, ['install', '-y', '-q', '--nogpgcheck', file]);
    else if (yum) await runPrivileged(yum, ['install', '-y', '-q', '--nogpgcheck', file]);
    else await runPrivileged(rpm, ['-U', '--replacepkgs', '--nosignature', file]);
    const listed = await runProcess(rpm, ['-ql', name]);
    return listed.code === 0 ? listed.out.split('\n').map(l => l.trim()).find(l => l.startsWith('/') && !SKIP_BIN_RE.test(path.basename(l))) : null;
}

function installAppImage(file) {
    const current = process.env.APPIMAGE;
    const dest = (current && fs.existsSync(current)) ? current : path.join(os.homedir(), '.local', 'share', 'anka-web', 'Anka_Web.AppImage');
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
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
    else throw new Error('Desteklenmeyen paket türü');

    if (!binary) throw new Error('Uygulama yolu bulunamadı');
    await launchDetached(SH_BIN, ['-c', LINUX_RELAUNCH, binary, String(process.pid)], path.dirname(binary), { hide: true });
}

async function performUpdate() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const manifest = await fetchManifest();
        const version = String(manifest.version || '').trim();
        if (!VERSION_RE.test(version) || compareVersions(version, CURRENT_VERSION) <= 0) {
            isUpdating = false;
            return;
        }

        const target = pickTarget(manifest, version);
        if (!target) {
            isUpdating = false;
            return;
        }

        const hash = await fetchRelease(target, version);
        const filePath = await download(target, version, hash);

        writeMarker(CURRENT_VERSION, version);

        if (process.platform === 'win32') {
            await launchWindows(filePath, target.kind);
            quitSoon();
        } else if (process.platform === 'linux') {
            await installAndRelaunchLinux(filePath, target.kind);
            quitSoon();
        } else {
            isUpdating = false;
        }
    } catch (err) {
        isUpdating = false;
    }
}

function checkUpdates(win) {
    if (!win || win.isDestroyed()) return;
    targetWin = win;

    setTimeout(() => {
        performUpdate();
    }, 4000);

    if (!updateInterval) {
        updateInterval = setInterval(() => {
            if (!isUpdating) {
                performUpdate();
            }
        }, 30 * 60 * 1000);
        if (typeof updateInterval.unref === 'function') {
            updateInterval.unref();
        }
    }

    win.once('closed', () => {
        if (targetWin === win) {
            targetWin = null;
        }
    });
}

module.exports = { checkUpdates };
