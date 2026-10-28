const { app, BrowserWindow, session, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const os = require('os');
const { checkUpdates, runFirstLaunch, isSplashOpen } = require('./updater');
const { setupDefaultBrowser } = require('./default-browser');
const instance = setupDefaultBrowser({ getWindow: () => win });
if (!instance.primary) return;

let win = null;
const downloads = new Map();
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

const SETTINGS_FILE = 'anka-settings.json';
const SCHOOL_CONFIG_FILE = 'anka-school-mode.json';
const I18N_CACHE_FILE = 'anka-i18n-cache.json';
const DRAWING_FILE = 'anka-drawing.png';
const DEFAULT_SCHOOL_URL = 'https://www.eba.gov.tr/';
const DANGEROUS_EXT = /\.(exe|msi|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|jar|sh|bash|zsh|desktop|appimage|deb|rpm|run|dll|so|dylib|reg|lnk|url|command|pkg|html?|shtml|xhtml|svg|xml|mht|mhtml|xsl|xslt)$/i;
const FINGERPRINT_HEADERS = ['Sec-Ch-Ua', 'Sec-Ch-Ua-Mobile', 'Sec-Ch-Ua-Platform', 'Sec-Ch-Ua-Platform-Version', 'Sec-Ch-Ua-Arch', 'Sec-Ch-Ua-Bitness', 'Sec-Ch-Ua-Full-Version', 'Sec-Ch-Ua-Full-Version-List', 'Sec-Ch-Ua-Model'];
const BASE_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'media']);
const PLATFORM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|adnxs\.com|adsrvr\.org|taboola\.com|outbrain\.com)$/i;
const TRACKER_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|hotjar\.com|mixpanel\.com|segment\.io|scorecardresearch\.com|facebook\.net)$/i;

function getUserDataPath() {
    if (_cachedUserDataPath) return _cachedUserDataPath;
    try { _cachedUserDataPath = app.getPath('userData'); }
    catch (e) { _cachedUserDataPath = ''; }
    return _cachedUserDataPath;
}

function getAppDataFile(name) {
    return path.join(getUserDataPath(), name);
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
    _stateCache = state;
    try {
        fs.mkdirSync(getUserDataPath(), { recursive: true });
        fs.writeFileSync(getAppDataFile(SETTINGS_FILE), JSON.stringify(state), 'utf8');
        return true;
    } catch (err) { return false; }
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
    if (startupSettings['preload-pages'] !== false && startupSettings['preload-pages'] !== 'false') {
        app.commandLine.appendSwitch('enable-features', 'Prerender2');
    }
    if (startupSettings['memory-saver'] === true || startupSettings['memory-saver'] === 'true') {
        app.commandLine.appendSwitch('enable-features', 'MemoryPressureBasedOptimization');
    }
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

    const indexPath = path.join(app.getAppPath(), 'src/renderer/index.html');
    win.loadURL(pathToFileURL(indexPath).href).catch((mainErr) => {
        if (mainErr && mainErr.code !== 'ERR_ABORTED') console.error(mainErr);
    });

    win.once('ready-to-show', () => {
        if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
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

    win.on('enter-full-screen', () => {
        if (win && !win.isDestroyed()) win.webContents.send('window-fullscreen-change', true);
    });

    win.on('leave-full-screen', () => {
        if (win && !win.isDestroyed()) win.webContents.send('window-fullscreen-change', false);
    });

    win.on('closed', () => {
        win = null;
        cachedWindowBounds = null;
        if (process.platform !== 'darwin') app.quit();
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
                win.webContents.send('download-completed', { id: downloadId, state: downloadData.state, savePath: downloadData.savePath });
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

        headers['User-Agent'] = PLATFORM_USER_AGENT;
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

function registerDefaultBrowserHandlers() {
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
            for (const file of [SETTINGS_FILE, SCHOOL_CONFIG_FILE, DRAWING_FILE, I18N_CACHE_FILE]) {
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

    ipcMain.on('devtools-toggle', () => { if (win && !win.isDestroyed()) win.webContents.toggleDevTools(); });
    ipcMain.on('devtools-detached', () => { if (win && !win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' }); });
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

    ipcMain.on('settings-update', (event, payload) => {
        if (!payload || typeof payload.id !== 'string') return;
        updateRuntimeSetting(payload.id, payload.val);
    });

    ipcMain.on('save-app-setting', (event, payload) => {
        if (!payload || typeof payload.id !== 'string') return;
        updateRuntimeSetting(payload.id, payload.val);
        const state = readAppState();
        state.settings = state.settings || {};
        state.settings[payload.id] = payload.val;
        writeAppState(state);
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

    ipcMain.handle('window-minimize', windowMinimize);
    ipcMain.handle('window-maximize', windowMaximize);
    ipcMain.handle('window-close', windowClose);
    ipcMain.handle('is-window-maximized', () => (win && !win.isDestroyed()) ? win.isMaximized() : false);
    ipcMain.handle('is-window-fullscreen', () => (win && !win.isDestroyed()) ? win.isFullScreen() : false);

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
    ipcMain.on('set-fullscreen', (event, val) => setFullscreen(val));

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

function clearDownloadHistory() {
    for (const [id, item] of downloads.entries()) {
        if (item.state !== 'progressing') downloads.delete(id);
    }
}

function windowMinimize() {
    if (win && !win.isDestroyed()) win.minimize();
}

function windowMaximize() {
    if (win && !win.isDestroyed()) {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
    }
}

function windowClose() {
    if (win && !win.isDestroyed()) win.close();
}

function setFullscreen(val) {
    if (win && !win.isDestroyed()) win.setFullScreen(!!val);
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
    setupSessionHandlers();
    setupDownloadManager();
    registerDefaultBrowserHandlers();
    ensureLinuxDesktopShortcut();

    let flow = { proceed: true, release() {} };
    try { flow = await runFirstLaunch(); }
    catch (err) { console.error(err); }
    if (!flow.proceed) return;

    createWindow();

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
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', (event) => {
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
});

ipcMain.handle('find-in-page', (event, text, options) => {
    if (win && !win.isDestroyed()) return win.webContents.findInPage(text, options);
});

ipcMain.handle('stop-find-in-page', (event, action) => {
    if (win && !win.isDestroyed()) return win.webContents.stopFindInPage(action);
});

app.on('window-all-closed', () => {
    if (isSplashOpen()) return;
    if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
    if (error && error.message && (error.message.includes('Render frame was disposed') || error.message.includes('Object has been destroyed'))) return;
    console.error(error);
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