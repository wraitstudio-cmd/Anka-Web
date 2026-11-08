const { app, BrowserWindow, session, ipcMain, webContents, shell, screen, safeStorage, Tray, Menu, dialog, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const os = require('os');
const { checkUpdates, runFirstLaunch, isSplashOpen } = require('./updater');
const { setupDefaultBrowser } = require('./default-browser');
const { createSchoolManagement } = require('./school-management');
const instance = setupDefaultBrowser({ getWindow: () => win });
if (!instance.primary) return;

let win = null;
let schoolManagementWindow = null;
const secondaryWindows = new Set();
const crashWindows = new Set();
let crashWindow = null;
let tray = null;
let appQuitting = false;
let startMinimizedOnLaunch = process.argv.includes('--start-minimized');
let uncleanShutdownDetected = false;
const downloads = new Map();
const tabDragTransfers = new Map();
let runtimeSettings = {};
let cacheCleanupStarted = false;
let cacheCleanupComplete = false;
let _cachedUserDataPath = null;
let _stateCache = null;
let _schoolCache = null;
let i18nCachePending = null;
let i18nCacheTimer = 0;
let _downloadCleanupTimer = null;
let cachedWindowBounds = null;
let cachedWindowBoundsTime = 0;
let previousSystemCpuSample = null;

app.on('web-contents-created', (event, contents) => {
    contents.setMaxListeners(0);
    if (contents.getType() === 'webview') {
        if (typeof contents.setBackgroundThrottling === 'function') {
            contents.setBackgroundThrottling(settingEnabled('background-tab-throttling', true));
        }
        contents.on('page-favicon-updated', (_event, favicons) => {
            const host = contents.hostWebContents;
            if (!host || host.isDestroyed() || !isConfigWindow(host) || !Array.isArray(favicons)) return;
            host.send('webview-favicon-updated', contents.id, favicons.filter((url) =>
                typeof url === 'string' && url.length <= 32768
            ));
        });
    }
});

const SETTINGS_FILE = 'anka-settings.json';
const SCHOOL_CONFIG_FILE = 'anka-school-mode.json';
const PASSWORDS_FILE = 'anka-passwords.enc';
const I18N_CACHE_FILE = 'anka-i18n-cache.json';
const DRAWING_FILE = 'anka-drawing.png';
const DEV_EXTENSIONS_FILE = 'anka-developer-extensions.json';
const CRASH_RECOVERY_FILE = 'anka-crash-recovery.json';
const CRASH_LOG_FILE = 'anka-crash.log';
const RUNNING_MARKER_FILE = 'anka-running.marker';
const DEFAULT_SCHOOL_URL = 'https://www.eba.gov.tr/';
const DANGEROUS_EXT = /\.(exe|msi|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|jar|sh|bash|zsh|desktop|appimage|deb|rpm|run|dll|so|dylib|reg|lnk|url|command|pkg|html?|shtml|xhtml|svg|xml|mht|mhtml|xsl|xslt)$/i;
const RISKY_DOWNLOAD_EXT = /\.(exe|msi|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|jar|sh|bash|zsh|appimage|deb|rpm|run|dll|so|dylib|reg|command|pkg)$/i;
const FINGERPRINT_HEADERS = ['Sec-Ch-Ua', 'Sec-Ch-Ua-Mobile', 'Sec-Ch-Ua-Platform', 'Sec-Ch-Ua-Platform-Version', 'Sec-Ch-Ua-Arch', 'Sec-Ch-Ua-Bitness', 'Sec-Ch-Ua-Full-Version', 'Sec-Ch-Ua-Full-Version-List', 'Sec-Ch-Ua-Model'];
const BASE_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'media']);
const COMMON_PASSWORDS = new Set([
    '123456', '123456789', '12345678', 'password', 'password123',
    'qwerty', 'qwerty123', 'letmein', 'admin', 'iloveyou', 'ankara123'
]);
const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|adnxs\.com|adsrvr\.org|taboola\.com|outbrain\.com)$/i;
const TRACKER_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|hotjar\.com|mixpanel\.com|segment\.io|scorecardresearch\.com|facebook\.net)$/i;
const PRIVATE_NETWORKS = new net.BlockList();
[
    ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'],
    ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'],
    ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
    ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'],
    ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'], ['::', 128, 'ipv6'],
    ['::1', 128, 'ipv6'], ['::ffff:0:0', 96, 'ipv6'], ['fc00::', 7, 'ipv6'],
    ['fe80::', 10, 'ipv6'], ['ff00::', 8, 'ipv6'], ['2001:db8::', 32, 'ipv6']
].forEach(([address, prefix, family]) => PRIVATE_NETWORKS.addSubnet(address, prefix, family));

function getUserDataPath() {
    if (_cachedUserDataPath) return _cachedUserDataPath;
    try { _cachedUserDataPath = app.getPath('userData'); }
    catch (e) { _cachedUserDataPath = ''; }
    return _cachedUserDataPath;
}

function getAppDataFile(name) {
    return path.join(getUserDataPath(), name);
}

async function downloadShortcutIcon(iconUrl, pageUrl, redirectDepth = 0) {
    if (redirectDepth > 3) throw new Error('Site simgesi çok fazla yönlendirme yaptı.');

    let target;
    try {
        target = new URL(iconUrl, pageUrl);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
            throw new Error('Site simgesi sayfanın güvenli kaynağında değil.');
        }
    } catch (err) {
        throw new Error(err.message || 'Site simgesi adresi geçersiz.');
    }

    const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const family = net.isIP(hostname);
    const addresses = family
        ? [{ address: hostname, family }]
        : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) =>
        ![4, 6].includes(entry.family) ||
        PRIVATE_NETWORKS.check(entry.address, entry.family === 4 ? 'ipv4' : 'ipv6')
    )) {
        throw new Error('Özel ağ adreslerinden site simgesi alınamaz.');
    }

    const transport = target.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.get(target, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                'Referer': (() => { try { return new URL(pageUrl).origin + '/'; } catch (e) { return target.origin + '/'; } })()
            },
            lookup: (host, options, callback) => {
                if (options && options.all) callback(null, addresses);
                else callback(null, addresses[0].address, addresses[0].family);
            }
        }, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                response.resume();
                let nextHref;
                try {
                    nextHref = new URL(response.headers.location, target.href).href;
                } catch (err) {
                    reject(new Error('Yönlendirme adresi geçersiz.'));
                    return;
                }
                downloadShortcutIcon(nextHref, nextHref, redirectDepth + 1).then(resolve, reject);
                return;
            }

            const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            const looksLikeImage = !contentType ||
                /^image\//.test(contentType) ||
                /^application\/octet-stream$/.test(contentType) ||
                /^application\/x-icon$/.test(contentType);
            if (response.statusCode !== 200 || !looksLikeImage) {
                response.resume();
                reject(new Error('Site simgesi desteklenmeyen bir yanıt verdi.'));
                return;
            }

            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > 512 * 1024) {
                    request.destroy(new Error('Site simgesi boyut sınırını aştı.'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error('Site simgesi isteği zaman aşımına uğradı.')));
        request.on('error', reject);
    });
}

async function createSiteShortcutIcon(iconUrl, pageUrl) {
    if (typeof iconUrl !== 'string' || !iconUrl || iconUrl.length > 32768) return null;
    const imageBuffer = await downloadShortcutIcon(iconUrl, pageUrl);
    const image = nativeImage.createFromBuffer(imageBuffer);
    if (image.isEmpty()) throw new Error('Site simgesi çözümlenemedi.');
    const png = image.toPNG();
    if (!png.length || png.length > 2 * 1024 * 1024) throw new Error('Site simgesi boyutu geçersiz.');

    const directory = getAppDataFile('site-shortcut-icons');
    const key = crypto.createHash('sha256').update(new URL(pageUrl).origin).digest('hex');
    const pngPath = path.join(directory, key + '.png');
    const icoPath = path.join(directory, key + '.ico');
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(header.length, 18);

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(pngPath, png, { mode: 0o600 });
    fs.writeFileSync(icoPath, Buffer.concat([header, png]), { mode: 0o600 });
    return { pngPath, icoPath };
}

function writeCrashLog(error) {
    const detail = error instanceof Error ? (error.stack || error.message) : String(error || 'Unknown error');
    const line = `${new Date().toISOString()} ${detail}\n`;
    const file = getAppDataFile(CRASH_LOG_FILE);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, '', { encoding: 'utf8', mode: 0o600 });
        fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
        return file;
    } catch (err) {
        console.error('Crash log could not be written:', err);
        return '';
    }
}

function showCrashWindow(error) {
    const logPath = writeCrashLog(error);
    if (!app.isReady()) return;
    if (crashWindow && !crashWindow.isDestroyed()) {
        crashWindow.show();
        crashWindow.focus();
        return;
    }
    crashWindow = new BrowserWindow({
        width: 580,
        height: 560,
        minWidth: 360,
        minHeight: 460,
        resizable: true,
        show: false,
        title: 'Anka Web - Kurtarma',
        icon: path.join(app.getAppPath(), 'src', 'icons', 'dark-logo.png'),
        backgroundColor: '#111116',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        }
    });
    const current = crashWindow;
    const contents = current.webContents;
    crashWindows.add(contents);
    current.once('ready-to-show', () => {
        if (!current.isDestroyed()) {
            current.show();
            current.focus();
        }
    });
    current.on('closed', () => {
        crashWindows.delete(contents);
        if (crashWindow === current) crashWindow = null;
    });
    current.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'crash.html')).catch((err) => {
        console.error('Crash recovery window could not be opened:', err);
    });
    if (!logPath) console.error('Crash details may be unavailable because the log file could not be written.');
}

function watchWindowCrashes(browserWindow) {
    if (!browserWindow || !browserWindow.webContents) return;
    browserWindow.webContents.on('render-process-gone', (event, details) => {
        const reason = details && details.reason ? details.reason : 'unknown';
        showCrashWindow(new Error('Renderer process terminated: ' + reason));
    });
}

function settingEnabled(id, fallback = false) {
    const value = runtimeSettings[id];
    return value === undefined ? fallback : value === true || value === 'true';
}

function applyCacheSizeLimit() {
    const ses = session.defaultSession;
    if (!ses || typeof ses.setCacheSize !== 'function') return;
    const maxMb = parseInt(runtimeSettings['cache-size-limit'] || '500', 10);
    if (!Number.isFinite(maxMb) || maxMb < 1) return;
    ses.setCacheSize(maxMb * 1024 * 1024).catch(() => {});
}

function updateRuntimeSetting(id, value) {
    runtimeSettings[id] = value;
    if (id === 'cache-size-limit') applyCacheSizeLimit();
    if (id === 'background-tab-throttling') applyBackgroundTabThrottling();
    if (id === 'tray-in-background') {
        if (value === true || value === 'true') createTray();
        else destroyTray();
        if ((value === true || value === 'true') && !tray && win && !win.isDestroyed()) {
            win.webContents.send('settings-error', 'Sistem tepsisi başlatılamadı; masaüstü ortamınızı veya tepsi simgesi desteğini kontrol edin.');
        }
    }
    if (id === 'start-on-login') {
        const result = applyStartupOnLogin(value === true || value === 'true');
        if (!result.ok && win && !win.isDestroyed()) win.webContents.send('settings-error', result.error || 'Otomatik başlatma ayarı uygulanamadı.');
    }
}

function applyBackgroundTabThrottling() {
    const enabled = settingEnabled('background-tab-throttling', true);
    webContents.getAllWebContents().forEach((contents) => {
        if (contents.isDestroyed() || contents.getType() !== 'webview' ||
            typeof contents.setBackgroundThrottling !== 'function') return;
        try {
            contents.setBackgroundThrottling(enabled);
        } catch (err) {
            console.error('Chromium arka plan sekme ayarı uygulanamadı:', err);
        }
    });
}

function enforceSafeSearch(url) {
    const level = runtimeSettings['safe-search'] || 'moderate';
    if (level === 'off') return false;
    const host = url.hostname.toLowerCase();
    let key = '';
    let value = '';
    let queryKey = 'q';
    let pathPattern = /^\/search/;

    if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) { key = 'safe'; value = 'active'; }
    else if (host === 'bing.com' || host.endsWith('.bing.com')) { key = 'adlt'; value = 'strict'; }
    else if (/(^|\.)yandex\.(com|com\.tr|ru)$/.test(host)) { key = 'fyandex'; value = '1'; queryKey = 'text'; }
    else if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) { key = 'kp'; value = '1'; pathPattern = /^\/$/; }
    else if (host === 'ecosia.org' || host.endsWith('.ecosia.org')) { key = 'safe'; value = 'active'; }
    else if (host === 'search.brave.com') { key = 'safesearch'; value = 'strict'; }
    else return false;

    if (!pathPattern.test(url.pathname) || !url.searchParams.has(queryKey) || url.searchParams.get(key) === value) return false;
    url.searchParams.set(key, value);
    return true;
}

function forceRestrictedYouTubeCookie(headers, url) {
    const host = url.hostname.toLowerCase();
    if (!(host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com'))) return;
    const cookieKey = Object.keys(headers).find((key) => key.toLowerCase() === 'cookie');
    const rawCookie = cookieKey ? headers[cookieKey] : '';
    const cookies = String(Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie).split(';').map((part) => part.trim()).filter(Boolean);
    const prefIndex = cookies.findIndex((cookie) => /^PREF=/i.test(cookie));
    if (prefIndex < 0) {
        cookies.push('PREF=f2=8000000');
    } else {
        const pref = cookies[prefIndex].slice(cookies[prefIndex].indexOf('=') + 1);
        const prefs = pref.split('&').filter((part) => part && !/^f2=/i.test(part));
        prefs.push('f2=8000000');
        cookies[prefIndex] = 'PREF=' + prefs.join('&');
    }
    if (cookieKey && cookieKey !== 'Cookie') delete headers[cookieKey];
    headers.Cookie = cookies.join('; ');
}

function readAppState() {
    if (_stateCache) return _stateCache;
    try { _stateCache = JSON.parse(fs.readFileSync(getAppDataFile(SETTINGS_FILE), 'utf8')) || {}; }
    catch (err) { _stateCache = {}; }
    return _stateCache;
}

function writeAppState(state) {
    const file = getAppDataFile(SETTINGS_FILE);
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        const serialized = JSON.stringify(state);
        fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
        _stateCache = state;
        return true;
    } catch (err) {
        try { fs.rmSync(temporary, { force: true }); } catch (cleanupErr) {}
        console.error('Application settings could not be saved:', err);
        return false;
    }
}

function readCrashRecoveryWindows() {
    try {
        const data = JSON.parse(fs.readFileSync(getAppDataFile(CRASH_RECOVERY_FILE), 'utf8'));
        if (!Array.isArray(data)) return [];
        return data.slice(-20).map((entry) => {
            if (!entry || !Number.isSafeInteger(entry.windowId) ||
                !Array.isArray(entry.tabs) || typeof entry.profileId !== 'string') return null;
            const profileId = /^[a-z0-9_-]{1,48}$/i.test(entry.profileId) ? entry.profileId : 'default';
            const tabs = entry.tabs.slice(0, 30).map((tab) => {
                if (!tab || typeof tab.url !== 'string' || tab.url.length > 8192) return null;
                try {
                    const url = new URL(tab.url);
                    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
                } catch (err) {
                    return null;
                }
                return { url: tab.url, group: typeof tab.group === 'string' ? tab.group.slice(0, 32) : '' };
            }).filter(Boolean);
            return {
                windowId: entry.windowId,
                profileId,
                tabs,
                active: Math.max(0, Math.min(Number.isInteger(entry.active) ? entry.active : 0, Math.max(0, tabs.length - 1))),
                updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
            };
        }).filter(Boolean);
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Crash recovery data could not be read:', err);
        return [];
    }
}

function writeCrashRecoveryWindows(windows) {
    const file = getAppDataFile(CRASH_RECOVERY_FILE);
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify(windows.slice(-20)), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, file);
        return true;
    } catch (err) {
        try { fs.rmSync(temporary, { force: true }); } catch (cleanupErr) {}
        console.error('Crash recovery data could not be saved:', err);
        return false;
    }
}

function forgetCrashRecoveryWindow(windowId) {
    const windows = readCrashRecoveryWindows();
    const remaining = windows.filter((entry) => entry.windowId !== windowId);
    if (remaining.length !== windows.length) writeCrashRecoveryWindows(remaining);
}

function saveCrashRecoveryWindow(event, payload) {
    if (!isConfigWindow(event.sender) || !payload || !Array.isArray(payload.tabs) ||
        payload.tabs.length > 30 || !Number.isSafeInteger(payload.windowId)) return;
    try {
        const url = new URL(event.sender.getURL());
        if (Number(url.searchParams.get('windowId')) !== payload.windowId) return;
        const profileId = url.searchParams.get('profile') || 'default';
        const tabs = payload.tabs.map((tab) => {
            if (!tab || typeof tab.url !== 'string' || tab.url.length > 8192) return null;
            try {
                const tabUrl = new URL(tab.url);
                if (tabUrl.protocol !== 'http:' && tabUrl.protocol !== 'https:') return null;
            } catch (err) {
                return null;
            }
            return { url: tab.url, group: typeof tab.group === 'string' ? tab.group.slice(0, 32) : '' };
        }).filter(Boolean);
        const windows = readCrashRecoveryWindows().filter((entry) => entry.windowId !== payload.windowId);
        windows.push({
            windowId: payload.windowId,
            profileId: /^[a-z0-9_-]{1,48}$/i.test(profileId) ? profileId : 'default',
            tabs,
            active: Math.max(0, Math.min(Number.isInteger(payload.active) ? payload.active : 0, Math.max(0, tabs.length - 1))),
            updatedAt: Date.now()
        });
        writeCrashRecoveryWindows(windows);
    } catch (err) {
        console.error('Crash recovery snapshot was rejected:', err);
    }
}

function readSchoolConfig() {
    if (_schoolCache) return _schoolCache;
    try {
        const data = JSON.parse(fs.readFileSync(getAppDataFile(SCHOOL_CONFIG_FILE), 'utf8'));
        _schoolCache = {
            enabled: data.enabled === true,
            startUrl: normalizeSchoolUrl(data.startUrl) || DEFAULT_SCHOOL_URL,
            lockSettings: data.lockSettings === true,
            settingsPassword: data.settingsPassword || null,
            userLoginEnabled: data.userLoginEnabled === true,
            users: Array.isArray(data.users) ? data.users : []
        };
    } catch (err) {
        _schoolCache = { enabled: false, startUrl: DEFAULT_SCHOOL_URL, lockSettings: false, settingsPassword: null, userLoginEnabled: false, users: [] };
    }
    return _schoolCache;
}

function writeSchoolConfig(config) {
    _schoolCache = config;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        fs.writeFileSync(getAppDataFile(SCHOOL_CONFIG_FILE), JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
        return true;
    } catch (err) { return false; }
}

function passwordStorageAvailable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return typeof safeStorage.getSelectedStorageBackend !== 'function' ||
        safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function readPasswordDatabase() {
    const file = getAppDataFile(PASSWORDS_FILE);
    if (!fs.existsSync(file)) return [];
    if (!passwordStorageAvailable()) throw new Error('secure-storage-unavailable');
    const encrypted = fs.readFileSync(file);
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    if (!Array.isArray(parsed)) throw new Error('password-store-invalid');
    return parsed.filter((entry) =>
        entry && typeof entry.origin === 'string' &&
        typeof entry.username === 'string' &&
        typeof entry.password === 'string'
    );
}

function inspectLocalPassword(password, entries, origin, username) {
    const normalized = password.toLowerCase();
    const warnings = [];
    const domain = (() => {
        try { return new URL(origin).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); }
        catch (err) { return ''; }
    })();
    const characterClasses = [
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length;
    if (password.length < 12 || characterClasses < 3 || /(.)\1{3,}/.test(password)) warnings.push('weak');
    if (COMMON_PASSWORDS.has(normalized)) warnings.push('common');
    if ((username && normalized.includes(username.toLowerCase())) ||
        (domain.length >= 4 && normalized.includes(domain))) warnings.push('personal');
    if (entries.some((entry) => entry.password === password &&
        !(entry.origin === origin && entry.username === username))) warnings.push('reused');
    const score = Math.max(0, Math.min(4,
        Math.floor(password.length / 5) +
        Math.max(0, characterClasses - 1) -
        (warnings.includes('common') ? 3 : 0) -
        (warnings.includes('weak') ? 1 : 0) -
        (warnings.includes('personal') ? 1 : 0)
    ));
    return { warnings, score };
}

function writePasswordDatabase(entries) {
    if (!passwordStorageAvailable()) throw new Error('secure-storage-unavailable');
    const directory = getUserDataPath();
    fs.mkdirSync(directory, { recursive: true });
    const file = getAppDataFile(PASSWORDS_FILE);
    const temporary = file + '.' + process.pid + '.tmp';
    try {
        fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(entries)), { mode: 0o600 });
        fs.renameSync(temporary, file);
    } catch (err) {
        try { fs.rmSync(temporary, { force: true }); } catch (cleanupErr) {}
        throw err;
    }
}

function normalizeSchoolUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (err) { return ''; }
}

function createPasswordVerifier(password) {
    if (!password) return null;
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPassword(password, verifier) {
    if (!verifier || typeof password !== 'string') return false;
    try {
        const salt = Buffer.from(verifier.salt, 'hex');
        const expected = Buffer.from(verifier.hash, 'hex');
        const actual = crypto.scryptSync(password, salt, expected.length);
        return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
    } catch (err) { return false; }
}

function publicSchoolConfig(config = readSchoolConfig()) {
    return {
        enabled: config.enabled,
        startUrl: config.startUrl,
        lockSettings: config.lockSettings,
        hasSettingsPassword: !!config.settingsPassword,
        userLoginEnabled: config.userLoginEnabled,
        users: config.users.map(({ id, username, displayName, password }) => ({ id, username, displayName, hasPassword: !!password }))
    };
}

function saveDrawingPng(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return false;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        fs.writeFileSync(getAppDataFile(DRAWING_FILE), Buffer.from(dataUrl.slice(22), 'base64'));
        return true;
    } catch (err) { return false; }
}

async function captureAppScreen() {
    if (!win || win.isDestroyed()) return '';
    try {
        const image = await win.capturePage();
        const picturesPath = app.getPath('pictures');
        fs.mkdirSync(picturesPath, { recursive: true });
        const filePath = path.join(picturesPath, `anka-ekran-${Date.now()}.png`);
        fs.writeFileSync(filePath, image.toPNG());
        return filePath;
    } catch (err) { return ''; }
}

function flushI18nCache() {
    i18nCacheTimer = 0;
    if (!i18nCachePending) return;
    const data = i18nCachePending;
    i18nCachePending = null;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        fs.writeFileSync(getAppDataFile(I18N_CACHE_FILE), JSON.stringify(data));
    } catch (e) {}
}

function queueI18nCacheWrite(data) {
    if (!data || typeof data !== 'object') return;
    i18nCachePending = data;
    if (i18nCacheTimer) return;
    i18nCacheTimer = setTimeout(flushI18nCache, 3000);
    if (typeof i18nCacheTimer.unref === 'function') i18nCacheTimer.unref();
}

function getWindowBounds() {
    const now = Date.now();
    if (cachedWindowBounds && now - cachedWindowBoundsTime < 100) return cachedWindowBounds;
    cachedWindowBounds = win && !win.isDestroyed() ? win.getBounds() : { x: 0, y: 0 };
    cachedWindowBoundsTime = now;
    return cachedWindowBounds;
}

function cleanupOldDownloads() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, item] of downloads.entries()) {
        if ((item.state === 'completed' || item.state === 'cancelled') && item._createdAt && item._createdAt < cutoff) {
            downloads.delete(id);
        }
    }
}

function translateGoogle(text, source, target) {
    return new Promise((resolve) => {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + encodeURIComponent(source) + '&tl=' + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
        let done = false;
        const finish = (v) => { if (done) return; done = true; resolve(v || text); };
        try {
            const req = https.get(url, { timeout: 8000 }, (res) => {
                if (res.statusCode && res.statusCode >= 400) { finish(text); return; }
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const parts = parsed[0] || [];
                        let out = '';
                        for (let i = 0; i < parts.length; i++) if (parts[i] && parts[i][0]) out += parts[i][0];
                        finish(out || text);
                    } catch (e) { finish(text); }
                });
            });
            req.on('error', () => finish(text));
            req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(text); });
        } catch (e) { finish(text); }
    });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
    });
}

function applyPerformanceFlags() {
    const startupSettings = readAppState().settings || {};
    if (startupSettings['hw-accel'] === false || startupSettings['hw-accel'] === 'false' ||
        startupSettings['gpu-render'] === false || startupSettings['gpu-render'] === 'false') {
        app.disableHardwareAcceleration();
    }
    if (startupSettings['hardware-acceleration-override'] === true || startupSettings['hardware-acceleration-override'] === 'true') {
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    }
    app.commandLine.appendSwitch('log-level', '3');
    app.commandLine.appendSwitch('enable-pointer-events');
    const chromiumFeatures = [];
    if (startupSettings['preload-pages'] !== false && startupSettings['preload-pages'] !== 'false') chromiumFeatures.push('Prerender2');
    if (startupSettings['memory-saver'] === true || startupSettings['memory-saver'] === 'true') chromiumFeatures.push('MemoryPressureBasedOptimization');
    if (chromiumFeatures.length) app.commandLine.appendSwitch('enable-features', chromiumFeatures.join(','));
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
    } else if (process.platform === 'win32') {
        app.commandLine.appendSwitch('high-dpi-support', 'true');
    }
}

applyPerformanceFlags();

function createWindow() {
    if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    const isMac = process.platform === 'darwin';
    const startupSettings = readAppState().settings || {};
    const startFullscreen = startupSettings['start-fullscreen'] === true || startupSettings['start-fullscreen'] === 'true';
    const startMinimized = startMinimizedOnLaunch && settingEnabled('tray-in-background');
    startMinimizedOnLaunch = false;

    win = new BrowserWindow({
        width,
        height,
        x,
        y,
        minWidth: 760,
        minHeight: 480,
        frame: false,
        transparent: process.platform !== 'linux',
        backgroundColor: '#00000000',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        icon: path.join(app.getAppPath(), 'src', 'icons', 'dark-logo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: true,
            webviewTag: true,
            nodeIntegrationInSubFrames: false,
            sandbox: false,
            backgroundThrottling: true,
            allowRunningInsecureContent: false,
            spellcheck: false,
            offscreen: false
        }
    });
    watchWindowCrashes(win);

    const indexPath = path.join(app.getAppPath(), 'src/renderer/index.html');
    const indexUrl = new URL(pathToFileURL(indexPath).href);
    indexUrl.searchParams.set('windowId', String(win.id));
    if (uncleanShutdownDetected) indexUrl.searchParams.set('recovery', '1');
    win.loadURL(indexUrl.href).catch((mainErr) => {
        if (mainErr && mainErr.code !== 'ERR_ABORTED') console.error(mainErr);
    });

    win.once('ready-to-show', () => {
        if (win && !win.isDestroyed()) {
            if (startMinimized) win.hide();
            else {
                win.show();
                win.focus();
            }
            if (startFullscreen) win.setFullScreen(true);
            else win.maximize();
            if (typeof checkUpdates === 'function') checkUpdates(win);
        }
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(`
            console.log("%cDİKKAT!", "color: red; font-size: 30px; font-weight: bold;");
            console.log("%cGÜVENLİK UYARISI: Buraya kod yapıştırmayın. Tanımadığınız kodlar hesap şifrelerinizi ve özel verilerinizi çalabilir.", "color: orange; font-size: 14px; font-weight: bold;");
        `).catch(() => {});
    });

    win.on('maximize', () => {
        cachedWindowBounds = null;
        if (win && !win.isDestroyed()) win.webContents.send('window-state-change', 'maximized');
    });

    win.on('unmaximize', () => {
        cachedWindowBounds = null;
        if (win && !win.isDestroyed()) win.webContents.send('window-state-change', 'restored');
    });

    win.on('resize', () => { cachedWindowBounds = null; });
    win.on('move', () => { cachedWindowBounds = null; });

    win.on('close', (event) => {
        if (!appQuitting && tray && settingEnabled('tray-in-background')) {
            event.preventDefault();
            win.hide();
        }
    });

    win.on('enter-full-screen', () => {
        if (win && !win.isDestroyed()) win.webContents.send('window-fullscreen-change', true);
    });

    win.on('leave-full-screen', () => {
        if (win && !win.isDestroyed()) win.webContents.send('window-fullscreen-change', false);
    });

    win.on('closed', () => {
        forgetCrashRecoveryWindow(win.id);
        win = null;
        cachedWindowBounds = null;
        if (process.platform !== 'darwin' && !tray) app.quit();
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (win && !win.isDestroyed()) win.webContents.send('open-new-tab', url);
        return { action: 'deny' };
    });

    win.webContents.on('will-navigate', (event, url) => {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
                event.preventDefault();
            }
        } catch (e) {}
    });
}

function sanitizeDownloadItem(item) {
    return {
        id: item.id,
        fileName: item.fileName,
        totalBytes: item.totalBytes,
        receivedBytes: item.receivedBytes,
        state: item.state,
        savePath: item.savePath,
        isPaused: item.isPaused,
        url: item.url
    };
}

function setupDownloadManager() {
    const ses = session.defaultSession;

    ses.on('will-download', (event, item) => {
        const downloadId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const fileName = item.getFilename();
        const totalBytes = item.getTotalBytes();
        const savePath = item.getSavePath();
        const url = item.getURL();

        const downloadData = {
            id: downloadId,
            fileName,
            totalBytes,
            receivedBytes: 0,
            state: 'progressing',
            savePath,
            isPaused: false,
            url,
            _rawItem: item,
            _createdAt: Date.now()
        };

        downloads.set(downloadId, downloadData);

        if (win && !win.isDestroyed()) {
            win.webContents.send('download-start', { id: downloadId, fileName, totalBytes });
            win.webContents.send('download-created', sanitizeDownloadItem(downloadData));
        }

        let lastEmit = 0;
        item.on('updated', (evt, state) => {
            downloadData.receivedBytes = item.getReceivedBytes();
            downloadData.totalBytes = item.getTotalBytes();
            downloadData.isPaused = item.isPaused();
            downloadData.savePath = item.getSavePath();
            if (state === 'interrupted') downloadData.state = 'interrupted';
            else if (state === 'progressing') downloadData.state = item.isPaused() ? 'paused' : 'progressing';
            else downloadData.state = state;

            const now = Date.now();
            if (now - lastEmit < 100) return;
            lastEmit = now;

            if (win && !win.isDestroyed()) {
                win.webContents.send('download-progress', {
                    id: downloadId,
                    receivedBytes: downloadData.receivedBytes,
                    totalBytes: downloadData.totalBytes,
                    isPaused: downloadData.isPaused,
                    state: downloadData.state
                });
                win.webContents.send('download-updated', {
                    id: downloadId,
                    receivedBytes: downloadData.receivedBytes,
                    state: downloadData.state,
                    isPaused: downloadData.isPaused
                });
            }
        });

        item.once('done', (evt, state) => {
            downloadData.state = state === 'completed' ? 'completed' : 'cancelled';
            downloadData.savePath = item.getSavePath();
            delete downloadData._rawItem;

            if (win && !win.isDestroyed()) {
                win.webContents.send('download-done', { id: downloadId, state, savePath: downloadData.savePath });
                win.webContents.send('download-completed', {
                    id: downloadId,
                    state: downloadData.state,
                    savePath: downloadData.savePath,
                    fileName: downloadData.fileName,
                    risky: settingEnabled('download-scan', true) && RISKY_DOWNLOAD_EXT.test(downloadData.fileName || '')
                });
            }
        });
    });

    if (_downloadCleanupTimer) clearInterval(_downloadCleanupTimer);
    _downloadCleanupTimer = setInterval(cleanupOldDownloads, 5 * 60 * 1000);
    if (typeof _downloadCleanupTimer.unref === 'function') _downloadCleanupTimer.unref();
}

function setupSessionHandlers() {
    const ses = session.defaultSession;
    runtimeSettings = { ...(readAppState().settings || {}) };
    applyCacheSizeLimit();
    applyBackgroundTabThrottling();

    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        let parsed;
        try { parsed = new URL(details.url); }
        catch (err) { callback({}); return; }

        if (details.resourceType === 'mainFrame' && enforceSafeSearch(parsed)) {
            callback({ redirectURL: parsed.href });
            return;
        }

        const host = parsed.hostname.toLowerCase();
        if (settingEnabled('https-only', true) && parsed.protocol === 'http:' &&
            host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
            parsed.protocol = 'https:';
            callback({ redirectURL: parsed.href });
            return;
        }

        const blockedAd = settingEnabled('ad-block', true) && AD_HOSTS.test(host);
        const blockedTracker = settingEnabled('track-protect', true) && TRACKER_HOSTS.test(host);
        callback({ cancel: blockedAd || blockedTracker });
    });

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        const url = details.url || '';
        try { forceRestrictedYouTubeCookie(headers, new URL(url)); } catch (err) {}

        if (settingEnabled('do-not-track', true)) headers.DNT = '1';
        else delete headers.DNT;

        if (url.includes('youtube.com')) {
            headers['Origin'] = 'https://youtube.com';
            headers['Referer'] = 'https://youtube.com/';
        }

        if (url.includes('://google.com')) {
            headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
            headers['Accept-Language'] = 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7';
        }

        if (settingEnabled('fingerprint-protection', false)) {
            for (let i = 0; i < FINGERPRINT_HEADERS.length; i++) delete headers[FINGERPRINT_HEADERS[i]];
        }

        callback({ requestHeaders: headers });
    });

    ses.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        for (const key of Object.keys(responseHeaders)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'x-frame-options' || lowerKey === 'content-security-policy') {
                delete responseHeaders[key];
            }
        }
        callback({ responseHeaders });
    });

    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        if (BASE_PERMISSIONS.has(permission)) return callback(true);
        if (permission === 'notifications') return callback(settingEnabled('notifications', true));
        callback(false);
    });

    if (typeof ses.setSpellCheckerEnabled === 'function') ses.setSpellCheckerEnabled(false);
}

function readDeveloperExtensionPaths() {
    try {
        const parsed = JSON.parse(fs.readFileSync(getAppDataFile(DEV_EXTENSIONS_FILE), 'utf8'));
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.length <= 4096).slice(0, 40) : [];
    } catch (err) {
        return [];
    }
}

function writeDeveloperExtensionPaths(paths) {
    const file = getAppDataFile(DEV_EXTENSIONS_FILE);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(paths.slice(0, 40)), { encoding: 'utf8', mode: 0o600 });
        return true;
    } catch (err) {
        console.error('Developer extension list could not be saved:', err);
        return false;
    }
}

function inspectDeveloperExtension(directory) {
    const resolved = fs.realpathSync(directory);
    const manifestFile = path.join(resolved, 'manifest.json');
    const stats = fs.statSync(manifestFile);
    if (!stats.isFile() || stats.size > 1024 * 1024) throw new Error('manifest-invalid');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!manifest || ![2, 3].includes(manifest.manifest_version) ||
        typeof manifest.name !== 'string' || manifest.name.trim().length < 1 || manifest.name.length > 128 ||
        typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
        throw new Error('manifest-invalid');
    }
    return { path: resolved, name: manifest.name.trim(), version: manifest.version, manifestVersion: manifest.manifest_version };
}

function getDeveloperExtensions() {
    const extensions = session.defaultSession.getAllExtensions();
    return extensions.map((extension) => ({
        id: extension.id,
        name: extension.name,
        version: extension.version,
        path: extension.path
    }));
}

async function loadSavedDeveloperExtensions() {
    const loadedPaths = new Set(getDeveloperExtensions().map((extension) => path.resolve(extension.path)));
    for (const directory of readDeveloperExtensionPaths()) {
        try {
            const info = inspectDeveloperExtension(directory);
            if (loadedPaths.has(info.path)) continue;
            await session.defaultSession.loadExtension(info.path, { allowFileAccess: false });
            loadedPaths.add(info.path);
        } catch (err) {
            console.error('Saved developer extension could not be loaded:', directory, err);
            if (win && !win.isDestroyed()) win.webContents.send('settings-error', `Geliştirici paketi yüklenemedi: ${path.basename(directory)}`);
        }
    }
}

function createSecondaryWindow(options = {}) {
    const profileId = typeof options.profileId === 'string' && /^[a-z0-9_-]{1,48}$/i.test(options.profileId)
        ? options.profileId
        : 'default';
    const incognito = options.incognito === true;
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    const isMac = process.platform === 'darwin';
    const secondary = new BrowserWindow({
        width,
        height,
        x,
        y,
        minWidth: 760,
        minHeight: 480,
        frame: false,
        transparent: process.platform !== 'linux',
        backgroundColor: '#00000000',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        icon: path.join(app.getAppPath(), 'src', 'icons', 'dark-logo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: true,
            webviewTag: true,
            nodeIntegrationInSubFrames: false,
            sandbox: false,
            backgroundThrottling: true,
            allowRunningInsecureContent: false,
            spellcheck: false,
            offscreen: false
        }
    });
    watchWindowCrashes(secondary);
    secondaryWindows.add(secondary);
    const indexUrl = new URL(pathToFileURL(path.join(app.getAppPath(), 'src', 'renderer', 'index.html')).href);
    indexUrl.searchParams.set('profile', incognito ? 'default' : profileId);
    indexUrl.searchParams.set('windowId', String(secondary.id));
    if (incognito) indexUrl.searchParams.set('incognito', '1');
    if (options.recoveryRestore === true) indexUrl.searchParams.set('recoveryRestore', '1');
    secondary.loadURL(indexUrl.href).catch((err) => {
        if (err && err.code !== 'ERR_ABORTED') console.error('Yeni pencere yüklenemedi:', err);
    });
    secondary.once('ready-to-show', () => {
        if (!secondary.isDestroyed()) {
            secondary.show();
            secondary.maximize();
            secondary.focus();
        }
    });
    secondary.on('maximize', () => {
        if (!secondary.isDestroyed()) secondary.webContents.send('window-state-change', 'maximized');
    });
    secondary.on('unmaximize', () => {
        if (!secondary.isDestroyed()) secondary.webContents.send('window-state-change', 'restored');
    });
    secondary.on('enter-full-screen', () => {
        if (!secondary.isDestroyed()) secondary.webContents.send('window-fullscreen-change', true);
    });
    secondary.on('leave-full-screen', () => {
        if (!secondary.isDestroyed()) secondary.webContents.send('window-fullscreen-change', false);
    });
    secondary.webContents.setWindowOpenHandler(({ url }) => {
        if (!secondary.isDestroyed()) secondary.webContents.send('open-new-tab', url);
        return { action: 'deny' };
    });
    secondary.on('closed', () => {
        forgetCrashRecoveryWindow(secondary.id);
        secondaryWindows.delete(secondary);
    });
    return secondary;
}

function registerDefaultBrowserHandlers() {
    ipcMain.handle('create-site-shortcuts', async (event, payload) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isConfigWindow(event.sender)) {
            throw new Error('Bu işlem yalnızca Anka Web ana penceresinden kullanılabilir.');
        }
        if (!payload || typeof payload.url !== 'string' || payload.url.length > 8192) {
            throw new Error('Geçerli bir web sayfası seçilmedi.');
        }

        let url;
        try {
            url = new URL(payload.url);
        } catch (err) {
            throw new Error('Sayfa adresi geçerli değil.');
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Yalnızca kullanıcı bilgisi içermeyen HTTP veya HTTPS sayfaları kısayol yapılabilir.');
        }
        if (process.platform !== 'win32' && process.platform !== 'linux') {
            throw new Error('Site kısayolları Windows ve Linux üzerinde destekleniyor.');
        }

        let siteIcon = null;
        try {
            siteIcon = await createSiteShortcutIcon(payload.iconUrl, url.href);
        } catch (err) {
            console.error('Site simgesi masaüstü kısayoluna eklenemedi:', err);
        }

        const pageTitle = typeof payload.title === 'string' ? payload.title.slice(0, 200) : '';
        let cleanName = (pageTitle || url.hostname).normalize('NFKC')
            .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '')
            .trim()
            .slice(0, 70) || 'Anka Web - Site';
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleanName)) cleanName = '_' + cleanName;
        const desktopDir = app.getPath('desktop');
        const startMenuDir = process.platform === 'win32'
            ? path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Anka Web')
            : path.join(process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
                ? process.env.XDG_DATA_HOME
                : path.join(app.getPath('home'), '.local', 'share'), 'applications');
        const extension = process.platform === 'win32' ? '.lnk' : '.desktop';
        const launchArgs = process.defaultApp && process.argv[1]
            ? [path.resolve(process.argv[1]), url.href]
            : [url.href];
        const target = process.platform === 'linux' && process.env.APPIMAGE &&
            path.isAbsolute(process.env.APPIMAGE) && /\.appimage$/i.test(process.env.APPIMAGE) &&
            fs.existsSync(process.env.APPIMAGE)
            ? process.env.APPIMAGE
            : process.execPath;
        const quoteWindowsArg = (value) => '"' + String(value)
            .replace(/(\\*)"/g, '$1$1\\"')
            .replace(/(\\+)$/g, '$1$1') + '"';
        const desktopExecArg = (value) => '"' + String(value)
            .replace(/%/g, '%%')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/[$`]/g, '\\$&') + '"';
        const desktopEntry = [
            '[Desktop Entry]',
            'Type=Application',
            'Name=' + cleanName.replace(/[\r\n]/g, ' '),
            'Comment=Anka Web ile ' + url.hostname.replace(/[\r\n]/g, ' ') + ' sayfasını aç',
            'Exec=' + [target, ...launchArgs].map(desktopExecArg).join(' '),
            'Icon=' + (siteIcon ? siteIcon.pngPath : 'anka-web'),
            'Terminal=false',
            'Categories=Network;WebBrowser;',
            ''
        ].join('\n');

        fs.mkdirSync(desktopDir, { recursive: true });
        fs.mkdirSync(startMenuDir, { recursive: true });
        let suffix = 1;
        let name = cleanName;
        let desktopShortcut = path.join(desktopDir, name + extension);
        let startMenuShortcut = path.join(startMenuDir, name + extension);
        while (fs.existsSync(desktopShortcut) || fs.existsSync(startMenuShortcut)) {
            suffix += 1;
            if (suffix > 10000) throw new Error('Bu site için daha fazla kısayol adı üretilemedi.');
            name = `${cleanName} (${suffix})`;
            desktopShortcut = path.join(desktopDir, name + extension);
            startMenuShortcut = path.join(startMenuDir, name + extension);
        }

        let createdDesktop = false;
        let createdStartMenu = false;
        try {
            if (process.platform === 'win32') {
                const shortcutOptions = {
                    target,
                    args: launchArgs.map(quoteWindowsArg).join(' '),
                    description: `Anka Web ile ${url.hostname} sayfasını aç`,
                    icon: siteIcon ? siteIcon.icoPath : path.join(app.getAppPath(), 'src', 'icons', 'logo.ico'),
                    iconIndex: 0,
                    appUserModelId: 'com.wraitgame.ankaweb'
                };
                if (!shell.writeShortcutLink(desktopShortcut, 'create', shortcutOptions)) {
                    throw new Error('Masaüstü kısayolu oluşturulamadı.');
                }
                createdDesktop = true;
                if (!shell.writeShortcutLink(startMenuShortcut, 'create', shortcutOptions)) {
                    throw new Error('Başlat menüsü kısayolu oluşturulamadı.');
                }
                createdStartMenu = true;
            } else {
                for (const [file, isDesktop] of [[desktopShortcut, true], [startMenuShortcut, false]]) {
                    fs.writeFileSync(file, desktopEntry, { encoding: 'utf8', mode: 0o700, flag: 'wx' });
                    fs.chmodSync(file, 0o700);
                    if (isDesktop) createdDesktop = true;
                    else createdStartMenu = true;
                }
            }
        } catch (err) {
            if (createdDesktop) fs.rmSync(desktopShortcut, { force: true });
            if (createdStartMenu) fs.rmSync(startMenuShortcut, { force: true });
            console.error('Site kısayolu oluşturulamadı:', err);
            throw new Error(err.message || 'Site kısayolları oluşturulamadı.');
        }
        return { ok: true, desktop: desktopShortcut, startMenu: startMenuShortcut, siteIcon: !!siteIcon };
    });

    ipcMain.handle('tabs:metrics', async (event) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isConfigWindow(event.sender)) {
            return [];
        }
        const metricsByPid = new Map(app.getAppMetrics().map((metric) => [metric.pid, metric.memory]));
        const views = webContents.getAllWebContents().filter((contents) =>
            !contents.isDestroyed() && contents.getType() === 'webview' &&
            typeof contents.getOSProcessId === 'function'
        );
        return views.map((contents) => {
            try {
                const memory = metricsByPid.get(contents.getOSProcessId());
                if (!memory) return null;
                return {
                    id: contents.id,
                    memory
                };
            } catch (err) {
                return null;
            }
        }).filter(Boolean);
    });
    ipcMain.on('tab-drag-start', (event, payload) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !payload ||
            typeof payload.token !== 'string' || !/^[a-f0-9-]{32,64}$/i.test(payload.token) ||
            typeof payload.tabId !== 'string' || payload.tabId.length > 100 ||
            typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url)) return;
        for (const [token, transfer] of tabDragTransfers) {
            if (transfer.expiresAt < Date.now()) tabDragTransfers.delete(token);
        }
        if (tabDragTransfers.size >= 100) tabDragTransfers.delete(tabDragTransfers.keys().next().value);
        tabDragTransfers.set(payload.token, {
            sender: event.sender,
            tabId: payload.tabId,
            url: payload.url,
            incognito: payload.incognito === true,
            expiresAt: Date.now() + 60000
        });
    });
    ipcMain.on('tab-drag-consumed', (event, payload) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !payload || typeof payload.token !== 'string') return;
        const transfer = tabDragTransfers.get(payload.token);
        tabDragTransfers.delete(payload.token);
        if (!transfer || transfer.expiresAt < Date.now() || transfer.sender === event.sender ||
            transfer.url !== payload.url || transfer.sender.isDestroyed()) return;
        transfer.sender.send('close-moved-tab', transfer.tabId, transfer.url);
    });
    ipcMain.handle('open-browser-window', (event, options) => {
        if (!event.sender || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
            return { ok: false, error: 'not-authorized' };
        }
        try {
            const secondary = createSecondaryWindow(options);
            return { ok: true, id: secondary.id };
        } catch (err) {
            console.error('Yeni tarayıcı penceresi açılamadı:', err);
            return { ok: false, error: 'window-create-failed' };
        }
    });
    ipcMain.on('crash-recovery:save-window', saveCrashRecoveryWindow);
    ipcMain.on('crash-recovery:forget-window', (event, windowId) => {
        if (!isConfigWindow(event.sender) || !Number.isSafeInteger(windowId)) return;
        try {
            const url = new URL(event.sender.getURL());
            if (Number(url.searchParams.get('windowId')) !== windowId) return;
            const profileId = url.searchParams.get('profile') || 'default';
            const windows = readCrashRecoveryWindows().filter((entry) => entry.profileId !== profileId);
            writeCrashRecoveryWindows(windows);
        } catch (err) {
            console.error('Crash recovery data could not be cleared:', err);
        }
    });
    ipcMain.handle('crash-recovery:restore', (event) => {
        if (!isConfigWindow(event.sender)) return { ok: false, error: 'not-authorized' };
        try {
            const url = new URL(event.sender.getURL());
            if (url.searchParams.get('recovery') !== '1' || url.searchParams.get('incognito') === '1') {
                return { ok: false, error: 'not-authorized' };
            }
            const windows = readCrashRecoveryWindows().sort((a, b) => b.updatedAt - a.updatedAt);
            if (!windows.length) return { ok: true, primary: null, windows: 0 };
            const defaultIndex = windows.findIndex((entry) => entry.profileId === 'default');
            const primary = windows.splice(defaultIndex >= 0 ? defaultIndex : 0, 1)[0];
            for (const snapshot of windows) {
                const secondary = createSecondaryWindow({
                    profileId: snapshot.profileId,
                    recoveryRestore: true
                });
                secondary.webContents.once('did-finish-load', () => {
                    if (!secondary.isDestroyed()) secondary.webContents.send('restore-session-tabs', snapshot);
                });
            }
            return { ok: true, primary, windows: windows.length + 1 };
        } catch (err) {
            console.error('Crash recovery could not be restored:', err);
            return { ok: false, error: 'restore-failed' };
        }
    });
    const isPasswordManagerRequest = (event) => !!win && !win.isDestroyed() &&
        event.sender === win.webContents && (!event.senderFrame || event.senderFrame === win.webContents.mainFrame);
    const passwordEntryId = (entry) => crypto.createHash('sha256')
        .update(entry.origin + '\0' + entry.username)
        .digest('hex');

    ipcMain.handle('developer-packs:list', (event) => {
        if (!isPasswordManagerRequest(event)) return { ok: false, error: 'not-authorized' };
        try {
            const allowedPaths = readDeveloperExtensionPaths();
            const extensions = getDeveloperExtensions();
            const allowedSet = new Set(allowedPaths.map((directory) => path.resolve(directory)));
            const loadedSet = new Set(extensions.map((extension) => path.resolve(extension.path)));
            return {
                ok: true,
                entries: extensions.filter((extension) => allowedSet.has(path.resolve(extension.path))),
                missing: allowedPaths
                    .filter((directory) => !loadedSet.has(path.resolve(directory)))
                    .map((directory) => ({ id: directory, name: path.basename(directory) }))
            };
        } catch (err) {
            console.error('Developer extensions could not be listed:', err);
            return { ok: false, error: 'list-failed' };
        }
    });

    ipcMain.handle('developer-packs:install', async (event) => {
        if (!isPasswordManagerRequest(event)) return { ok: false, error: 'not-authorized' };
        if (process.platform !== 'win32' && process.platform !== 'linux') return { ok: false, error: 'unsupported-platform' };
        const selected = await dialog.showOpenDialog(win, {
            title: 'Geliştirici paketi klasörünü seç',
            properties: ['openDirectory']
        });
        if (selected.canceled || !selected.filePaths.length) return { ok: false, error: 'cancelled' };
        let info;
        try {
            info = inspectDeveloperExtension(selected.filePaths[0]);
        } catch (err) {
            console.error('Developer extension manifest validation failed:', err);
            return { ok: false, error: 'manifest-invalid' };
        }
        const confirm = await dialog.showMessageBox(win, {
            type: 'warning',
            title: 'Geliştirici paketine güveniyor musunuz?',
            message: `${info.name} (${info.version}) yükleniyor`,
            detail: 'Bu yerel paket tarayıcı sekmelerindeki verilere erişebilen kod çalıştırabilir. Yalnızca kaynağına güvendiğiniz paketleri yükleyin. Yönetici izni gerekmez; paket bu kullanıcı hesabı için yüklenir.',
            buttons: ['İptal', 'Paketi yükle'],
            defaultId: 0,
            cancelId: 0,
            noLink: true
        });
        if (confirm.response !== 1) return { ok: false, error: 'cancelled' };
        try {
            const current = getDeveloperExtensions();
            const existing = current.find((extension) => path.resolve(extension.path) === info.path);
            const loaded = existing || await session.defaultSession.loadExtension(info.path, { allowFileAccess: false });
            const paths = readDeveloperExtensionPaths();
            if (!paths.includes(info.path)) paths.push(info.path);
            if (!writeDeveloperExtensionPaths(paths)) {
                if (!existing) session.defaultSession.removeExtension(loaded.id);
                return { ok: false, error: 'save-failed' };
            }
            return { ok: true, extension: { id: loaded.id, name: loaded.name, version: loaded.version, path: loaded.path } };
        } catch (err) {
            console.error('Developer extension could not be loaded:', err);
            return { ok: false, error: 'load-failed' };
        }
    });

    ipcMain.handle('developer-packs:remove', (event, id) => {
        if (!isPasswordManagerRequest(event) || typeof id !== 'string' || id.length > 4096 || id.includes('\0')) {
            return { ok: false, error: 'not-authorized' };
        }
        try {
            const paths = readDeveloperExtensionPaths();
            const extension = getDeveloperExtensions().find((item) => item.id === id);
            const managedPath = extension
                ? paths.find((directory) => path.resolve(directory) === path.resolve(extension.path))
                : paths.find((directory) => path.resolve(directory) === path.resolve(id));
            if (!managedPath) return { ok: false, error: extension ? 'not-managed' : 'not-found' };
            const remainingPaths = paths.filter((directory) => path.resolve(directory) !== path.resolve(managedPath));
            if (!writeDeveloperExtensionPaths(remainingPaths)) {
                return { ok: false, error: 'save-failed' };
            }
            if (extension) {
                try {
                    session.defaultSession.removeExtension(extension.id);
                } catch (err) {
                    writeDeveloperExtensionPaths(paths);
                    throw err;
                }
            }
            return { ok: true };
        } catch (err) {
            console.error('Developer extension could not be removed:', err);
            return { ok: false, error: 'remove-failed' };
        }
    });

    ipcMain.handle('password-manager:list', (event) => {
        if (!isPasswordManagerRequest(event)) return { ok: false, error: 'not-authorized' };
        try {
            return { ok: true, entries: readPasswordDatabase().map((entry) => ({
                id: passwordEntryId(entry),
                origin: entry.origin,
                username: entry.username,
                updatedAt: entry.updatedAt || 0
            })) };
        } catch (err) {
            console.error('Password manager could not read its encrypted store:', err);
            return { ok: false, error: err.message === 'secure-storage-unavailable' ? err.message : 'store-unreadable' };
        }
    });

    ipcMain.handle('password-manager:get-for-origin', (event, origin) => {
        if (!isPasswordManagerRequest(event) || typeof origin !== 'string') return { ok: false, error: 'not-authorized' };
        try {
            const parsed = new URL(origin);
            if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'invalid-origin' };
        } catch (err) {
            return { ok: false, error: 'invalid-origin' };
        }
        return { ok: false, error: 'system-auth-unavailable' };
    });

    ipcMain.handle('password-manager:check', (event, payload) => {
        if (!isPasswordManagerRequest(event) || !payload || typeof payload !== 'object') {
            return { ok: false, error: 'not-authorized' };
        }
        if (typeof payload.origin !== 'string' || typeof payload.username !== 'string' ||
            typeof payload.password !== 'string' || payload.username.length > 512 ||
            payload.password.length > 4096) return { ok: false, error: 'invalid-credential' };
        let origin;
        try {
            const parsed = new URL(payload.origin);
            if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'invalid-origin' };
            origin = parsed.origin;
        } catch (err) {
            return { ok: false, error: 'invalid-origin' };
        }
        try {
            const entries = readPasswordDatabase();
            const inspection = inspectLocalPassword(payload.password, entries, origin, payload.username.trim());
            return { ok: true, warnings: inspection.warnings, score: inspection.score };
        } catch (err) {
            console.error('Password safety check could not read the encrypted local store:', err);
            return { ok: false, error: err.message === 'secure-storage-unavailable' ? err.message : 'store-unreadable' };
        }
    });

    ipcMain.handle('password-manager:save', (event, payload) => {
        if (!isPasswordManagerRequest(event) || !payload || typeof payload !== 'object') return { ok: false, error: 'not-authorized' };
        if (typeof payload.origin !== 'string' || typeof payload.username !== 'string' ||
            typeof payload.password !== 'string' || payload.username.length > 512 ||
            !payload.username.trim() || payload.password.length < 1 || payload.password.length > 4096) {
            return { ok: false, error: 'invalid-credential' };
        }
        let origin;
        try {
            const parsed = new URL(payload.origin);
            if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'invalid-origin' };
            origin = parsed.origin;
        } catch (err) {
            return { ok: false, error: 'invalid-origin' };
        }
        try {
            const entries = readPasswordDatabase();
            const username = payload.username.trim();
            const index = entries.findIndex((entry) => entry.origin === origin && entry.username === username);
            const entry = { origin, username, password: payload.password, updatedAt: Date.now() };
            if (index >= 0) entries[index] = entry;
            else entries.push(entry);
            writePasswordDatabase(entries);
            return { ok: true };
        } catch (err) {
            console.error('Password manager could not save a credential:', err);
            return { ok: false, error: err.message === 'secure-storage-unavailable' ? err.message : 'store-write-failed' };
        }
    });

    ipcMain.handle('password-manager:remove', (event, id) => {
        if (!isPasswordManagerRequest(event) || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) {
            return { ok: false, error: 'not-authorized' };
        }
        try {
            const entries = readPasswordDatabase();
            const next = entries.filter((entry) => passwordEntryId(entry) !== id);
            if (next.length === entries.length) return { ok: false, error: 'credential-not-found' };
            writePasswordDatabase(next);
            return { ok: true };
        } catch (err) {
            console.error('Password manager could not remove a credential:', err);
            return { ok: false, error: err.message === 'secure-storage-unavailable' ? err.message : 'store-write-failed' };
        }
    });

    ipcMain.on('i18n-cache-update', (event, data) => queueI18nCacheWrite(data));

    ipcMain.on('i18n-clear-cache', () => {
        i18nCachePending = null;
        if (i18nCacheTimer) { clearTimeout(i18nCacheTimer); i18nCacheTimer = 0; }
        try { fs.rmSync(getAppDataFile(I18N_CACHE_FILE), { force: true }); } catch (e) {}
    });

    ipcMain.handle('i18n-load-cache', () => {
        try { return JSON.parse(fs.readFileSync(getAppDataFile(I18N_CACHE_FILE), 'utf8')); }
        catch (e) { return {}; }
    });

    ipcMain.handle('i18n-translate', async (event, payload) => {
        if (!payload || typeof payload.text !== 'string' || !payload.text) return '';
        const target = String(payload.target || 'en');
        const source = String(payload.source || 'tr');
        if (target === source) return payload.text;
        return translateGoogle(payload.text, source, target);
    });

    ipcMain.handle('load-app-state', () => readAppState());

    ipcMain.handle('save-app-setting:commit', (event, payload) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isAppSettingsSender(event.sender) || !payload ||
            typeof payload.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(payload.id) ||
            !['string', 'boolean', 'number'].includes(typeof payload.val) ||
            (typeof payload.val === 'number' && !Number.isFinite(payload.val)) ||
            (typeof payload.val === 'string' && payload.val.length > 8192)) {
            return { ok: false, error: 'invalid-request' };
        }
        const currentState = readAppState();
        const state = {
            ...currentState,
            settings: { ...(currentState.settings || {}), [payload.id]: payload.val }
        };
        if (!writeAppState(state)) return { ok: false, error: 'save-failed' };
        updateRuntimeSetting(payload.id, payload.val);
        return { ok: true };
    });

    ipcMain.handle('settings:export-config', async (event, data) => {
        if (!isConfigWindow(event.sender) || !data || typeof data !== 'object' ||
            Array.isArray(data) || typeof data.schoolModeEnabled !== 'boolean') {
            return { ok: false, error: 'invalid-request' };
        }
        if (!passwordStorageAvailable()) return { ok: false, error: 'secure-storage-unavailable' };
        let serialized;
        try {
            serialized = JSON.stringify(data);
            if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) {
                return { ok: false, error: 'config-too-large' };
            }
        } catch (err) {
            return { ok: false, error: 'invalid-config' };
        }

        const owner = getSenderWindow(event);
        const result = await dialog.showSaveDialog(owner && !owner.isDestroyed() ? owner : undefined, {
            title: 'Anka Web ayarlarını güvenli biçimde kaydet',
            defaultPath: `ankaweb-ayarlar-${new Date().toISOString().slice(0, 10)}.ankaconfig`,
            filters: [{ name: 'Anka Web ayar dosyası', extensions: ['ankaconfig'] }]
        });
        if (result.canceled || !result.filePath) return { ok: false, cancelled: true };

        let configFile;
        try {
            const encrypted = safeStorage.encryptString(serialized);
            configFile = JSON.stringify({
                format: 'anka-config',
                version: 2,
                cipher: 'electron-safeStorage',
                data: encrypted.toString('base64')
            });
        } catch (err) {
            console.error('OS settings encryption failed:', err);
            return { ok: false, error: 'secure-storage-unavailable' };
        }
        const tempPath = `${result.filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        try {
            await fs.promises.writeFile(tempPath, configFile, { flag: 'wx', mode: 0o600 });
            await fs.promises.rename(tempPath, result.filePath);
            return { ok: true };
        } catch (err) {
            try { await fs.promises.rm(tempPath, { force: true }); } catch (cleanupError) {}
            console.error('Settings export failed:', err);
            return { ok: false, error: 'write-failed' };
        }
    });

    ipcMain.handle('settings:import-config', async (event) => {
        if (!isConfigWindow(event.sender)) {
            return { ok: false, error: 'invalid-request' };
        }
        if (!passwordStorageAvailable()) return { ok: false, error: 'secure-storage-unavailable' };
        const owner = getSenderWindow(event);
        const result = await dialog.showOpenDialog(owner && !owner.isDestroyed() ? owner : undefined, {
            title: 'Anka Web ayar dosyasını aç',
            properties: ['openFile'],
            filters: [{ name: 'Anka Web ayar dosyası', extensions: ['ankaconfig'] }]
        });
        if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
        try {
            const contents = await fs.promises.readFile(result.filePaths[0]);
            if (contents.length > 2 * 1024 * 1024) return { ok: false, error: 'config-too-large' };
            const envelope = JSON.parse(contents.toString('utf8'));
            if (envelope && envelope.format === 'anka-config' && envelope.version === 1) {
                return { ok: false, error: 'legacy-password-config' };
            }
            if (!envelope || envelope.format !== 'anka-config' || envelope.version !== 2 ||
                envelope.cipher !== 'electron-safeStorage' || typeof envelope.data !== 'string') {
                return { ok: false, error: 'invalid-config' };
            }
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.data)) {
                return { ok: false, error: 'invalid-config' };
            }
            const encrypted = Buffer.from(envelope.data, 'base64');
            if (!encrypted.length || encrypted.length > 1024 * 1024) {
                return { ok: false, error: 'invalid-config' };
            }
            let plaintext;
            try {
                plaintext = safeStorage.decryptString(encrypted);
            } catch (err) {
                return { ok: false, error: 'wrong-device' };
            }
            const data = JSON.parse(plaintext);
            if (!data || typeof data !== 'object' || Array.isArray(data) ||
                typeof data.schoolModeEnabled !== 'boolean') {
                return { ok: false, error: 'invalid-config' };
            }
            return { ok: true, data };
        } catch (err) {
            if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
                console.error('Settings import failed:', err);
                return { ok: false, error: 'read-failed' };
            }
            return { ok: false, error: 'invalid-config' };
        }
    });

    ipcMain.handle('reset-all-app-data', async () => {
        try {
            const ses = session.defaultSession;
            await Promise.all([ses.clearCache(), ses.clearStorageData()]);
            downloads.clear();
            runtimeSettings = {};
            _stateCache = null;
            _schoolCache = null;
            i18nCachePending = null;
            if (i18nCacheTimer) { clearTimeout(i18nCacheTimer); i18nCacheTimer = 0; }
            for (const file of [SETTINGS_FILE, SCHOOL_CONFIG_FILE, DRAWING_FILE, I18N_CACHE_FILE, CRASH_RECOVERY_FILE]) {
                try { fs.rmSync(getAppDataFile(file), { force: true }); } catch (e) {}
            }
            if (win && !win.isDestroyed()) {
                await win.webContents.executeJavaScript('localStorage.clear(); sessionStorage.clear();').catch(() => {});
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: 'Uygulama verileri tamamen temizlenemedi.' };
        }
    });

    ipcMain.handle('clear-browsing-data', async (event, options) => {
        const categories = Array.isArray(options && options.categories)
            ? [...new Set(options.categories.filter((item) => ['downloads', 'cookies', 'siteData', 'cache'].includes(item)))]
            : [];
        const operations = [];
        const allTimeOnly = [];
        const cutoff = Number.isFinite(options && options.cutoff) ? Math.max(0, options.cutoff) : 0;
        if (categories.includes('downloads')) clearDownloadHistory(cutoff);
        if (categories.includes('cookies')) {
            operations.push(session.defaultSession.clearStorageData({ storages: ['cookies'] }));
            allTimeOnly.push('cookies');
        }
        if (categories.includes('siteData')) {
            operations.push(session.defaultSession.clearStorageData({
                storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem']
            }));
            allTimeOnly.push('siteData');
        }
        if (categories.includes('cache')) {
            operations.push(session.defaultSession.clearCache());
            allTimeOnly.push('cache');
        }
        await Promise.all(operations);
        return { ok: true, allTimeOnly };
    });

    ipcMain.handle('get-memory-pressure', (event) => {
        if (!win || event.sender !== win.webContents) return null;
        const totalBytes = os.totalmem();
        return { totalBytes, freeBytes: os.freemem() };
    });

    ipcMain.handle('get-system-performance', (event) => {
        if (!isPasswordManagerRequest(event)) return { cpuPercent: null };
        const cores = os.cpus();
        let idle = 0;
        let total = 0;
        for (const core of cores) {
            for (const value of Object.values(core.times)) total += value;
            idle += core.times.idle;
        }
        const current = { idle, total };
        const previous = previousSystemCpuSample;
        previousSystemCpuSample = current;
        if (!previous || current.total <= previous.total) return { cpuPercent: null };
        const totalDelta = current.total - previous.total;
        const idleDelta = current.idle - previous.idle;
        return { cpuPercent: Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) };
    });

    ipcMain.on('devtools-toggle', (event) => {
        const owner = getSenderWindow(event);
        if (!owner || owner.isDestroyed() || !settingEnabled('dev-tools-shortcut', true)) return;
        try {
            if (owner.webContents.isDevToolsOpened()) owner.webContents.closeDevTools();
            else owner.webContents.openDevTools({ mode: 'detach' });
        } catch (err) {
            console.error('Uygulama DevTools açılamadı:', err);
            owner.webContents.send('settings-error', 'DevTools açılamadı.');
        }
    });
    ipcMain.handle('webview-devtools:toggle', (event, payload) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isConfigWindow(event.sender) || !payload ||
            !Number.isInteger(payload.webContentsId) ||
            !['detach', 'right'].includes(payload.mode)) {
            return { ok: false, error: 'not-authorized' };
        }
        const guest = webContents.fromId(payload.webContentsId);
        const host = guest && !guest.isDestroyed() ? guest.hostWebContents : null;
        if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' ||
            !host || host.id !== event.sender.id ||
            !settingEnabled('dev-tools-shortcut', true)) {
            return { ok: false, error: 'webview-not-found' };
        }
        try {
            if (guest.isDevToolsOpened()) guest.closeDevTools();
            else guest.openDevTools({ mode: payload.mode });
            return { ok: true, open: guest.isDevToolsOpened() };
        } catch (err) {
            console.error('Sekme DevTools açılamadı:', err);
            return { ok: false, error: 'devtools-open-failed' };
        }
    });
    ipcMain.handle('webview-print', (event, webContentsId) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isConfigWindow(event.sender) || !Number.isInteger(webContentsId)) {
            return { ok: false, error: 'not-authorized' };
        }
        const guest = webContents.fromId(webContentsId);
        const host = guest && !guest.isDestroyed() ? guest.hostWebContents : null;
        if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' ||
            !host || host.id !== event.sender.id || typeof guest.print !== 'function') {
            return { ok: false, error: 'webview-not-found' };
        }
        return new Promise((resolve) => {
            try {
                guest.print({ silent: false, printBackground: true }, (success, failureReason) => {
                    if (success) resolve({ ok: true });
                    else {
                        console.error('Sekme yazdırılamadı:', failureReason || 'Yazdırma başarısız.');
                        resolve({ ok: false, error: 'print-failed' });
                    }
                });
            } catch (err) {
                console.error('Sekme yazdırma iletişim kutusu açılamadı:', err);
                resolve({ ok: false, error: 'print-failed' });
            }
        });
    });
    ipcMain.handle('site-favicon:load', async (event, payload) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isConfigWindow(event.sender) || !payload ||
            !Number.isInteger(payload.webContentsId) ||
            typeof payload.url !== 'string' || payload.url.length > 32768) {
            return { ok: false, error: 'not-authorized' };
        }
        const guest = webContents.fromId(payload.webContentsId);
        const host = guest && !guest.isDestroyed() ? guest.hostWebContents : null;
        if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' ||
            !host || host.id !== event.sender.id) {
            return { ok: false, error: 'webview-not-found' };
        }
        try {
            const imageBuffer = await downloadShortcutIcon(payload.url, guest.getURL());
            const image = nativeImage.createFromBuffer(imageBuffer);
            if (image.isEmpty()) throw new Error('Site simgesi çözümlenemedi.');
            const dimensions = image.getSize();
            const scale = Math.min(1, 64 / Math.max(dimensions.width, dimensions.height));
            const png = image.resize({
                width: Math.max(1, Math.round(dimensions.width * scale)),
                height: Math.max(1, Math.round(dimensions.height * scale))
            }).toPNG();
            if (!png.length || png.length > 256 * 1024) throw new Error('Site simgesi boyutu geçersiz.');
            return { ok: true, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
        } catch (err) {
            console.error('Site faviconu güvenli şekilde yüklenemedi:', err);
            return { ok: false, error: 'favicon-load-failed' };
        }
    });
    ipcMain.on('open-network-settings', (event) => {
        if (!win || win.isDestroyed() || event.sender !== win.webContents || process.platform !== 'win32') return;
        shell.openExternal('ms-settings:network-status').catch((err) => {
            console.error('Windows ağ ayarları açılamadı:', err);
            win.webContents.send('settings-error', 'Windows ağ ayarları açılamadı. Ayarlar uygulamasından Ağ ve internet bölümünü açın.');
        });
    });
    ipcMain.on('devtools-detached', (event) => {
        const owner = getSenderWindow(event);
        if (owner && !owner.isDestroyed() && settingEnabled('dev-tools-shortcut', true)) {
            try {
                if (owner.webContents.isDevToolsOpened()) owner.webContents.closeDevTools();
                else owner.webContents.openDevTools({ mode: 'detach' });
            } catch (err) {
                console.error('Uygulama DevTools açılamadı:', err);
                owner.webContents.send('settings-error', 'DevTools açılamadı.');
            }
        }
    });
    ipcMain.on('hard-reload', () => { if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache(); });

    ipcMain.handle('get-context-menu-point', () => {
        const point = screen.getCursorScreenPoint();
        const bounds = getWindowBounds();
        return { x: point.x - bounds.x, y: point.y - bounds.y };
    });

    ipcMain.handle('anka:clear-temp-data-and-restart', async () => {
        try {
            const userDataPath = getUserDataPath();
            const exePath = app.getPath('exe');
            const currentPid = process.pid;

            const helperCode = [
                "const fs = require('fs');",
                "const { spawn } = require('child_process');",
                "const userDataPath = " + JSON.stringify(userDataPath) + ";",
                "const exePath = " + JSON.stringify(exePath) + ";",
                "const pid = " + currentPid + ";",
                "const timer = setInterval(() => {",
                "    try { process.kill(pid, 0); }",
                "    catch (e) {",
                "        clearInterval(timer);",
                "        const tryRemove = (attempt) => {",
                "            attempt = attempt || 0;",
                "            try { if (fs.existsSync(userDataPath)) fs.rmSync(userDataPath, { recursive: true, force: true }); }",
                "            catch (err) { if (attempt < 10) { setTimeout(() => tryRemove(attempt + 1), 300); return; } }",
                "            try { spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref(); } catch (err) {}",
                "        };",
                "        setTimeout(() => tryRemove(0), 500);",
                "    }",
                "}, 200);"
            ].join('\n');

            const helperPath = path.join(os.tmpdir(), 'anka-web-cleanup-' + Date.now() + '.js');
            fs.writeFileSync(helperPath, helperCode, 'utf8');

            const child = spawn(process.execPath, [helperPath], {
                detached: true,
                stdio: 'ignore',
                env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
            });
            child.unref();

            setTimeout(() => app.exit(0), 400);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message || 'Temizleme başlatılamadı.' };
        }
    });

    ipcMain.handle('school-mode:get-config', () => publicSchoolConfig());

    ipcMain.handle('school-mode:set-enabled', (event, enabled) => {
        if (!isConfigWindow(event.sender) || typeof enabled !== 'boolean') {
            return { ok: false, error: 'not-authorized' };
        }
        const config = readSchoolConfig();
        config.enabled = enabled;
        if (!writeSchoolConfig(config)) return { ok: false, error: 'Okul Modu durumu kaydedilemedi.' };
        return { ok: true, config: publicSchoolConfig(config) };
    });

    ipcMain.handle('school-mode:save-config', (event, payload) => {
        if (!payload || typeof payload !== 'object') return { ok: false, error: 'Ayarlar geçersiz.' };
        const config = readSchoolConfig();
        const url = normalizeSchoolUrl(payload.startUrl);
        if (typeof payload.settingsPassword === 'string' && payload.settingsPassword.length > 128) {
            return { ok: false, error: 'Parola en fazla 128 karakter olabilir.' };
        }
        if (payload.settingsPassword && payload.settingsPassword.length < 4) {
            return { ok: false, error: 'Ayar parolası en az 4 karakter olmalı.' };
        }
        if (!url) return { ok: false, error: 'Geçerli bir http veya https adresi girin.' };
        if (payload.lockSettings && !config.settingsPassword && !payload.settingsPassword) {
            return { ok: false, error: 'Ayar kilidi için bir parola belirleyin.' };
        }
        if (payload.userLoginEnabled && !config.users.length) {
            return { ok: false, error: 'Giriş ekranını açmadan önce en az bir kullanıcı ekleyin.' };
        }
        config.enabled = payload.enabled === true;
        config.startUrl = url;
        config.lockSettings = payload.lockSettings === true;
        config.userLoginEnabled = payload.userLoginEnabled === true;
        if (typeof payload.settingsPassword === 'string' && payload.settingsPassword.length) {
            config.settingsPassword = createPasswordVerifier(payload.settingsPassword);
        }
        if (!config.lockSettings) config.settingsPassword = null;
        if (!writeSchoolConfig(config)) return { ok: false, error: 'Okul ayarları kaydedilemedi.' };
        return { ok: true, config: publicSchoolConfig(config) };
    });

    ipcMain.handle('school-mode:verify-settings-password', (event, password) => {
        const config = readSchoolConfig();
        return config.lockSettings && verifyPassword(password, config.settingsPassword);
    });

    ipcMain.handle('school-mode:save-user', (event, payload) => {
        if (!payload || typeof payload !== 'object') return { ok: false, error: 'Kullanıcı bilgileri geçersiz.' };
        const username = String(payload.username || '').trim().slice(0, 32);
        const displayName = String(payload.displayName || username).trim().slice(0, 48);
        if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(username) || !displayName) {
            return { ok: false, error: 'Kullanıcı adı en az 2 karakter olmalı.' };
        }
        const config = readSchoolConfig();
        const existing = config.users.find((user) => user.id === payload.id);
        if (config.users.some((user) => user.username.toLowerCase() === username.toLowerCase() && user.id !== payload.id)) {
            return { ok: false, error: 'Bu kullanıcı adı zaten kullanılıyor.' };
        }
        const password = typeof payload.password === 'string' ? payload.password : '';
        if (password.length > 128) return { ok: false, error: 'Parola en fazla 128 karakter olabilir.' };
        if (!existing && password.length > 0 && password.length < 4) {
            return { ok: false, error: 'Parola en az 4 karakter olmalı.' };
        }
        const user = existing || { id: crypto.randomUUID(), password: null };
        user.username = username;
        user.displayName = displayName;
        if (password.length) user.password = createPasswordVerifier(password);
        else if (!existing || payload.removePassword === true) user.password = null;
        if (!existing) config.users.push(user);
        if (!writeSchoolConfig(config)) return { ok: false, error: 'Kullanıcı kaydedilemedi.' };
        return { ok: true, users: publicSchoolConfig(config).users };
    });

    ipcMain.handle('school-mode:remove-user', (event, id) => {
        const config = readSchoolConfig();
        config.users = config.users.filter((user) => user.id !== id);
        if (!config.users.length) config.userLoginEnabled = false;
        if (!writeSchoolConfig(config)) return { ok: false, error: 'Kullanıcı silinemedi.' };
        return { ok: true, config: publicSchoolConfig(config) };
    });

    ipcMain.handle('school-mode:authenticate-user', (event, payload) => {
        const config = readSchoolConfig();
        if (!config.userLoginEnabled || !payload) return { ok: false };
        if (typeof payload.password === 'string' && payload.password.length > 128) return { ok: false };
        const user = config.users.find((entry) => entry.id === payload.id);
        if (!user || (user.password ? !verifyPassword(payload.password || '', user.password) : !!payload.password)) return { ok: false };
        return { ok: true, user: { id: user.id, username: user.username, displayName: user.displayName } };
    });

    ipcMain.handle('school-management:open-panel', async (event) => {
        if (!isConfigWindow(event.sender)) return { ok: false, error: 'not-authorized' };
        try {
            await openSchoolManagementWindow(event.sender);
            return { ok: true };
        } catch (err) {
            console.error('Okul yönetim paneli açılamadı:', err);
            return { ok: false, error: 'panel-open-failed' };
        }
    });

    createSchoolManagement({
        app,
        ipcMain,
        safeStorage,
        dialog,
        getDataPath: getUserDataPath,
        isConfigWindow,
        getWindow: (event) => BrowserWindow.fromWebContents(event.sender),
        applyPolicy: async (event, policy) => {
            const state = readAppState();
            const previousState = { ...state, settings: { ...(state.settings || {}) } };
            const settings = {
                'safe-search': policy.strictMode ? 'strict' : 'moderate',
                'https-only': 'true',
                'ad-block': 'true',
                'track-protect': 'true',
                'max-tabs': String(policy.maxTabs),
                'max-live-tabs': String(policy.maxTabs)
            };
            const appliedSettings = { ...settings, ...(policy.settings || {}) };
            state.settings = { ...(state.settings || {}), ...appliedSettings };
            if (!writeAppState(state)) throw new Error('settings-save-failed');

            const schoolConfig = readSchoolConfig();
            const previousSchoolConfig = { ...schoolConfig };
            schoolConfig.enabled = policy.schoolModeEnabled;
            schoolConfig.startUrl = policy.startUrl;
            if (!writeSchoolConfig(schoolConfig)) {
                writeAppState(previousState);
                _schoolCache = previousSchoolConfig;
                throw new Error('school-config-save-failed');
            }

            Object.entries(appliedSettings).forEach(([id, value]) => updateRuntimeSetting(id, value));
            const recipient = win && !win.isDestroyed() ? win.webContents : event.sender;
            if (!recipient.isDestroyed()) recipient.send('school-management:policy-applied', policy);
        }
    });

    ipcMain.on('settings-update', (event, payload) => {
        if (!payload || typeof payload.id !== 'string') return;
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isAppSettingsSender(event.sender)) return;
        updateRuntimeSetting(payload.id, payload.val);
    });

    const setWindowTitle = (event, value) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isConfigWindow(event.sender) || typeof value !== 'string') return false;
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (!owner || owner.isDestroyed()) return false;
        const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
        owner.setTitle(name ? 'Anka Web — ' + name : 'Anka Web');
        return true;
    };

    ipcMain.handle('set-window-title:apply', (event, value) => ({
        ok: setWindowTitle(event, value)
    }));

    ipcMain.on('set-window-title', (event, value) => {
        setWindowTitle(event, value);
    });

    ipcMain.on('set-theme-source', (event, value) => {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isConfigWindow(event.sender) ||
            !['system', 'light', 'dark'].includes(value)) return;
        nativeTheme.themeSource = value;
    });

    ipcMain.on('save-app-setting', (event, payload) => {
        if (!payload || typeof payload.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(payload.id) ||
            !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
            !isAppSettingsSender(event.sender)) return;
        const currentState = readAppState();
        const state = {
            ...currentState,
            settings: { ...(currentState.settings || {}), [payload.id]: payload.val }
        };
        if (!writeAppState(state)) {
            console.error('Application setting could not be saved:', payload.id);
            if (!event.sender.isDestroyed()) {
            event.sender.send('settings-error', 'Ayar kaydedilemedi. Depolama alanını ve dosya izinlerini kontrol edin.');
            }
            return;
        }
        updateRuntimeSetting(payload.id, payload.val);
    });

    ipcMain.handle('anka:restart', (event) => {
        if (!isConfigWindow(event.sender)) return { ok: false, error: 'not-authorized' };
        app.relaunch();
        app.quit();
        return { ok: true };
    });

    ipcMain.handle('anka:crash-open-log', async (event) => {
        if (!crashWindows.has(event.sender)) return { ok: false, error: 'not-authorized' };
        const logPath = getAppDataFile(CRASH_LOG_FILE);
        try {
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', { encoding: 'utf8', mode: 0o600 });
            const error = await shell.openPath(logPath);
            return error ? { ok: false, error: 'open-failed' } : { ok: true };
        } catch (err) {
            console.error('Crash log could not be opened:', err);
            return { ok: false, error: 'open-failed' };
        }
    });

    ipcMain.handle('anka:crash-restart', (event) => {
        if (!crashWindows.has(event.sender)) return { ok: false, error: 'not-authorized' };
        app.relaunch();
        app.quit();
        return { ok: true };
    });

    ipcMain.on('reset-app-settings', () => {
        runtimeSettings = {};
        _stateCache = null;
        _schoolCache = null;
        applyCacheSizeLimit();
        try { fs.rmSync(getAppDataFile(SETTINGS_FILE), { force: true }); } catch (err) {}
        try { fs.rmSync(getAppDataFile(SCHOOL_CONFIG_FILE), { force: true }); } catch (err) {}
    });

    ipcMain.on('save-drawing-png', (event, dataUrl) => saveDrawingPng(dataUrl));

    ipcMain.handle('capture-app-screen', captureAppScreen);

    ipcMain.handle('load-drawing-png', () => {
        try {
            const data = fs.readFileSync(getAppDataFile(DRAWING_FILE));
            return 'data:image/png;base64,' + data.toString('base64');
        } catch (err) { return ''; }
    });

    ipcMain.on('clear-drawing-png', () => {
        try { fs.rmSync(getAppDataFile(DRAWING_FILE), { force: true }); } catch (err) {}
    });

    ipcMain.handle('window-minimize', (event) => windowMinimize(event));
    ipcMain.handle('window-maximize', (event) => windowMaximize(event));
    ipcMain.handle('window-close', (event) => windowClose(event));
    ipcMain.handle('is-window-maximized', (event) => {
        const owner = getSenderWindow(event);
        return owner && !owner.isDestroyed() ? owner.isMaximized() : false;
    });
    ipcMain.handle('is-window-fullscreen', (event) => {
        const owner = getSenderWindow(event);
        return owner && !owner.isDestroyed() ? owner.isFullScreen() : false;
    });

    ipcMain.handle('get-downloads', getDownloadsList);
    ipcMain.handle('get-downloads-list', getDownloadsList);

    ipcMain.on('open-download-item', (event, downloadId) => {
        if (!win || event.sender !== win.webContents) return;
        openDownloadItem(downloadId);
    });

    ipcMain.handle('open-download-item', (event, downloadId) => {
        if (!win || event.sender !== win.webContents) return false;
        return openDownloadItem(downloadId);
    });

    ipcMain.on('show-download-in-folder', (event, downloadId) => {
        if (!win || event.sender !== win.webContents) return;
        showDownloadInFolder(downloadId);
    });

    ipcMain.handle('show-download-in-folder', (event, downloadId) => {
        if (!win || event.sender !== win.webContents) return false;
        return showDownloadInFolder(downloadId);
    });

    ipcMain.on('pause-download', (event, id) => pauseDownload(id));
    ipcMain.handle('pause-download', (event, id) => pauseDownload(id));
    ipcMain.on('resume-download', (event, id) => resumeDownload(id));
    ipcMain.handle('resume-download', (event, id) => resumeDownload(id));
    ipcMain.on('cancel-download', (event, id) => cancelDownload(id));
    ipcMain.handle('cancel-download', (event, id) => cancelDownload(id));
    ipcMain.on('clear-download-history', clearDownloadHistory);
    ipcMain.handle('clear-download-history', clearDownloadHistory);

    ipcMain.on('restart-download', (event, id) => {
        const item = downloads.get(id);
        if (item && item.url && win && !win.isDestroyed()) {
            win.webContents.downloadURL(item.url);
            downloads.delete(id);
        }
    });

    ipcMain.handle('get-app-version', () => app.getVersion());
    ipcMain.on('set-fullscreen', (event, val) => setFullscreen(val, event));

    ipcMain.on('set-as-default-browser', () => {
        try {
            if (process.defaultApp) {
                if (process.argv.length >= 2) {
                    app.setAsDefaultProtocolClient('http', process.execPath, [process.argv]);
                    app.setAsDefaultProtocolClient('https', process.execPath, [process.argv]);
                }
            } else {
                app.setAsDefaultProtocolClient('http');
                app.setAsDefaultProtocolClient('https');
            }
            if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps');
        } catch (err) { console.error(err); }
    });

    ipcMain.handle('check-default-browser', async () => {
        try { return app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'); }
        catch (err) { return false; }
    });
}

function getDownloadsList() {
    const out = [];
    for (const item of downloads.values()) out.push(sanitizeDownloadItem(item));
    return out;
}

function openDownloadItem(downloadId) {
    const item = downloads.get(downloadId);
    if (!item || item.state !== 'completed' || !item.savePath || !fs.existsSync(item.savePath)) return false;
    if (DANGEROUS_EXT.test(item.fileName)) {
        if (win && !win.isDestroyed()) win.webContents.send('download-open-blocked', item.fileName);
        return false;
    }
    if (!win || win.isDestroyed()) return false;
    win.webContents.send('open-download-sandbox', path.resolve(item.savePath));
    return true;
}

function showDownloadInFolder(downloadId) {
    const item = downloads.get(downloadId);
    if (!item || !item.savePath || !fs.existsSync(item.savePath)) return false;
    shell.showItemInFolder(path.resolve(item.savePath));
    return true;
}

function pauseDownload(id) {
    const item = downloads.get(id);
    if (item && item._rawItem && item.state === 'progressing') {
        item._rawItem.pause();
        item.isPaused = true;
        item.state = 'paused';
    }
}

function resumeDownload(id) {
    const item = downloads.get(id);
    if (item && item._rawItem && item._rawItem.isPaused()) {
        item._rawItem.resume();
        item.isPaused = false;
        item.state = 'progressing';
    }
}

function cancelDownload(id) {
    const item = downloads.get(id);
    if (item && item._rawItem) {
        item._rawItem.cancel();
        item.state = 'cancelled';
    }
}

function clearDownloadHistory(cutoff = 0) {
    for (const [id, item] of downloads.entries()) {
        if (item.state !== 'progressing' && (!cutoff || item._createdAt <= cutoff)) downloads.delete(id);
    }
}

function getSenderWindow(event) {
    return event && event.sender ? BrowserWindow.fromWebContents(event.sender) : win;
}

function isDefaultAppWindow(contents) {
    if (!contents || contents.isDestroyed()) return false;
    try {
        const url = new URL(contents.getURL());
        const profileId = url.searchParams.get('profile');
        return (profileId === null || profileId === 'default') && url.searchParams.get('incognito') !== '1';
    } catch (err) {
        return contents === (win && !win.isDestroyed() ? win.webContents : null);
    }
}

function isConfigWindow(contents) {
    if (!contents || contents.isDestroyed()) return false;
    try {
        const url = new URL(contents.getURL());
        return url.protocol === 'file:' &&
            (url.pathname.endsWith('/src/renderer/index.html') ||
                url.pathname.endsWith('/src/renderer/school-management.html')) &&
            url.searchParams.get('incognito') !== '1';
    } catch (err) {
        return false;
    }
}

function isAppSettingsSender(contents) {
    if (isConfigWindow(contents)) return true;
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') return false;
    try {
        const url = new URL(contents.getURL());
        return url.protocol === 'file:' &&
            url.pathname.endsWith('/src/renderer/newtab.html') &&
            url.searchParams.get('incognito') !== '1';
    } catch (err) {
        return false;
    }
}

function windowMinimize(event) {
    const owner = getSenderWindow(event);
    if (owner && !owner.isDestroyed()) owner.minimize();
}

function windowMaximize(event) {
    const owner = getSenderWindow(event);
    if (owner && !owner.isDestroyed()) {
        if (owner.isMaximized()) owner.unmaximize();
        else owner.maximize();
    }
}

function windowClose(event) {
    const owner = getSenderWindow(event);
    if (owner && !owner.isDestroyed()) owner.close();
}

function showWindow() {
    if (!win || win.isDestroyed()) {
        createWindow();
        return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

async function openSchoolManagementWindow(sender) {
    if (schoolManagementWindow && !schoolManagementWindow.isDestroyed()) {
        if (schoolManagementWindow.isMinimized()) schoolManagementWindow.restore();
        schoolManagementWindow.show();
        schoolManagementWindow.focus();
        return;
    }
    const owner = BrowserWindow.fromWebContents(sender);
    schoolManagementWindow = new BrowserWindow({
        width: 1080,
        height: 820,
        minWidth: 760,
        minHeight: 620,
        show: false,
        autoHideMenuBar: true,
        title: 'Anka Web · Okul Yönetimi',
        icon: path.join(app.getAppPath(), 'src', 'icons', 'dark-logo.png'),
        ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: true,
            sandbox: false,
            spellcheck: false
        }
    });
    const panel = schoolManagementWindow;
    panel.once('ready-to-show', () => {
        if (!panel.isDestroyed()) panel.show();
    });
    panel.on('closed', () => {
        if (schoolManagementWindow === panel) schoolManagementWindow = null;
    });
    try {
        await panel.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'school-management.html'));
    } catch (err) {
        if (!panel.isDestroyed()) panel.destroy();
        throw err;
    }
}

function destroyTray() {
    if (!tray) return;
    tray.destroy();
    tray = null;
}

function createTray() {
    if (tray || !settingEnabled('tray-in-background')) return;
    try {
        const iconPath = path.join(app.getAppPath(), 'src', 'icons', 'dark-logo.png');
        tray = new Tray(iconPath);
        tray.setToolTip(`Anka Web ${app.getVersion()}`);
        const menu = Menu.buildFromTemplate([
            { label: 'Anka Web ' + app.getVersion(), enabled: false },
            { type: 'separator' },
            { label: 'Anka Web’i Aç', click: showWindow },
            { label: 'Pencereyi Kapat', click: () => { if (win && !win.isDestroyed()) win.hide(); } },
            { label: 'Yeni Sekme Aç', click: () => {
                showWindow();
                if (win && !win.isDestroyed()) win.webContents.send('open-new-tab', 'newtab.html');
            } },
            { label: 'Yeni Pencere Aç', click: () => createSecondaryWindow({ profileId: 'default' }) },
            { label: 'Yeni Gizli Pencere Aç', click: () => createSecondaryWindow({ incognito: true }) },
            { label: 'Güncellemeleri Kontrol Et', click: () => { showWindow(); checkUpdates(win); } },
            { type: 'separator' },
            { label: 'Uygulamadan Çık', click: () => { appQuitting = true; app.quit(); } }
        ]);
        tray.setContextMenu(menu);
        tray.on('click', () => {
            if (win && !win.isDestroyed() && win.isVisible()) win.hide();
            else showWindow();
        });
        tray.on('double-click', showWindow);
    } catch (err) {
        tray = null;
        console.error('Sistem tepsisi oluşturulamadı:', err);
    }
}

function applyStartupOnLogin(enabled) {
    try {
        if (process.platform === 'win32' || process.platform === 'darwin') {
            const args = process.defaultApp ? [app.getAppPath(), '--start-minimized'] : ['--start-minimized'];
            app.setLoginItemSettings({ openAtLogin: enabled, args });
            return { ok: true };
        }
        if (process.platform === 'linux') {
            const autostartDir = path.join(app.getPath('home'), '.config', 'autostart');
            const entry = path.join(autostartDir, 'anka-web.desktop');
            if (!enabled) {
                fs.rmSync(entry, { force: true });
                return { ok: true };
            }
            const executable = process.defaultApp
                ? `"${process.execPath.replace(/(["\\])/g, '\\$1')}" "${app.getAppPath().replace(/(["\\])/g, '\\$1')}"`
                : `"${process.execPath.replace(/(["\\])/g, '\\$1')}"`;
            fs.mkdirSync(autostartDir, { recursive: true });
            fs.writeFileSync(entry, `[Desktop Entry]\nType=Application\nName=Anka Web\nExec=${executable} --start-minimized\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { encoding: 'utf8', mode: 0o600 });
            fs.chmodSync(entry, 0o600);
            return { ok: true };
        }
        return { ok: false, error: 'Bu işletim sisteminde otomatik başlatma desteklenmiyor.' };
    } catch (err) {
        console.error('Otomatik başlatma ayarı uygulanamadı:', err);
        return { ok: false, error: err.message };
    }
}

function setFullscreen(val, event) {
    const owner = getSenderWindow(event);
    if (owner && !owner.isDestroyed()) owner.setFullScreen(!!val);
}

function ensureLinuxDesktopShortcut() {
    if (process.platform !== 'linux') return;
    const installedEntry = '/usr/share/applications/anka-web.desktop';
    if (!fs.existsSync(installedEntry)) return;
    try {
        const desktopEntry = path.join(app.getPath('desktop'), 'anka-web.desktop');
        if (fs.existsSync(desktopEntry)) return;
        fs.mkdirSync(path.dirname(desktopEntry), { recursive: true });
        fs.copyFileSync(installedEntry, desktopEntry, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(desktopEntry, 0o755);
    } catch (err) {}
}

app.whenReady().then(async () => {
    const runningMarker = getAppDataFile(RUNNING_MARKER_FILE);
    uncleanShutdownDetected = fs.existsSync(runningMarker) &&
        settingEnabled('restore-session') && readCrashRecoveryWindows().length > 0;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        fs.writeFileSync(runningMarker, String(process.pid), { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
        console.error('Application shutdown state could not be recorded:', err);
        uncleanShutdownDetected = false;
    }

    if (process.platform === 'win32' && typeof app.setUserTasks === 'function') {
        app.setAppUserModelId('com.wraitgame.ankaweb');
        const appIconPath = path.join(app.getAppPath(), 'src', 'icons', 'logo.ico');
        const appArguments = (command) => process.defaultApp
            ? `"${app.getAppPath().replace(/"/g, '\\"')}" ${command}`
            : command;
        try {
            app.setUserTasks([
                {
                    program: app.getPath('exe'),
                    arguments: appArguments('--new-tab'),
                    title: 'Yeni Sekme',
                    description: 'Anka Web’de yeni sekme aç',
                    iconPath: appIconPath,
                    iconIndex: 0
                },
                {
                    program: app.getPath('exe'),
                    arguments: appArguments('--new-incognito-tab'),
                    title: 'Yeni Gizli Sekme',
                    description: 'Anka Web’de yeni gizli sekme aç',
                    iconPath: appIconPath,
                    iconIndex: 0
                },
                {
                    program: app.getPath('exe'),
                    arguments: appArguments('--new-window'),
                    title: 'Yeni Pencere',
                    description: 'Anka Web’de yeni pencere aç',
                    iconPath: appIconPath,
                    iconIndex: 0
                },
                {
                    program: app.getPath('exe'),
                    arguments: appArguments('--new-incognito-window'),
                    title: 'Yeni Gizli Pencere',
                    description: 'Anka Web’de yeni gizli pencere aç',
                    iconPath: appIconPath,
                    iconIndex: 0
                }
            ]);
        } catch (err) {
            console.error('Görev çubuğu kısayolları kaydedilemedi:', err);
        }
    }
    setupSessionHandlers();
    setupDownloadManager();
    registerDefaultBrowserHandlers();
    ensureLinuxDesktopShortcut();
    createTray();
    const startupResult = applyStartupOnLogin(settingEnabled('start-on-login'));
    if (!startupResult.ok) console.error('Sistem başlangıç ayarı eşitlenemedi:', startupResult.error);

    let flow = { proceed: true, release() {} };
    try { flow = await runFirstLaunch(); }
    catch (err) { console.error(err); }
    if (!flow.proceed) return;

    createWindow();
    loadSavedDeveloperExtensions().catch((err) => {
        console.error('Saved developer extensions could not be loaded:', err);
        if (win && !win.isDestroyed()) win.webContents.send('settings-error', 'Yerel geliştirici paketleri başlatılamadı.');
    });

    const releaseTimer = setTimeout(() => flow.release(), 10000);
    if (typeof releaseTimer.unref === 'function') releaseTimer.unref();
    if (win && !win.isDestroyed()) {
        win.once('ready-to-show', () => {
            clearTimeout(releaseTimer);
            flow.release();
        });
    } else {
        clearTimeout(releaseTimer);
        flow.release();
    }

    app.on('activate', () => {
        showWindow();
    });
});

app.on('before-quit', (event) => {
    appQuitting = true;
    flushI18nCache();
    if (cacheCleanupComplete || !settingEnabled('clear-cache-exit')) return;
    event.preventDefault();
    if (cacheCleanupStarted) return;
    cacheCleanupStarted = true;

    const ses = session.defaultSession;
    Promise.all([
        ses.clearCache(),
        ses.clearStorageData({ storages: ['cookies', 'cachestorage', 'serviceworkers'] })
    ]).finally(() => {
        cacheCleanupComplete = true;
        app.quit();
    });
});

app.on('will-quit', () => {
    flushI18nCache();
    if (i18nCacheTimer) { clearTimeout(i18nCacheTimer); i18nCacheTimer = 0; }
    if (_downloadCleanupTimer) { clearInterval(_downloadCleanupTimer); _downloadCleanupTimer = null; }
    try { fs.rmSync(getAppDataFile(RUNNING_MARKER_FILE), { force: true }); }
    catch (err) { console.error('Application shutdown state could not be cleared:', err); }
});

ipcMain.handle('find-in-page', (event, text, options) => {
    if (win && !win.isDestroyed()) return win.webContents.findInPage(text, options);
});

ipcMain.handle('stop-find-in-page', (event, action) => {
    if (win && !win.isDestroyed()) return win.webContents.stopFindInPage(action);
});

app.on('window-all-closed', () => {
    if (isSplashOpen()) return;
    if (tray && settingEnabled('tray-in-background')) return;
    if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
    if (error && error.message && (error.message.includes('Render frame was disposed') || error.message.includes('Object has been destroyed'))) return;
    console.error(error);
    showCrashWindow(error);
});

process.on('unhandledRejection', (reason) => {
    console.error(reason);
});

module.exports = {
    createWindow,
    registerDefaultBrowserHandlers,
    getDownloadsList,
    openDownloadItem,
    showDownloadInFolder,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    windowMinimize,
    windowMaximize,
    windowClose,
    setFullscreen
};