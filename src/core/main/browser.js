const AI_TAB_ID = 'tab-ai-assistant';
let activeTabId = null;
let closedTabsStack = [];
let lastMemoryPressureCheck = 0;
let ankaLoadPollTimer = 0;
let ankaLoadTrackingView = null;
let ankaFpsLimit = 0;

const ankaTabs = new Map();
let ankaTabSeq = 0;
const ANKA_LOGO = '../icons/dark-logo.png';
const ANKA_ALLOWED_FILES = new Set();
const ANKA_GUEST_PREFS = 'contextIsolation=yes, sandbox=yes, nodeIntegration=no, webSecurity=yes, allowRunningInsecureContent=no, javascript=yes';
const ANKA_DARK_CSS = 'html{color-scheme:dark!important;background:#121212!important;color:#e8eaed!important}html body,html body *:not(img):not(picture):not(video):not(canvas):not(svg):not(path):not(iframe){background-color:transparent!important;color:#e8eaed!important;border-color:#3c4043!important}html body{background:#121212!important}html body a,html body a *{color:#8ab4f8!important}html body input,html body textarea,html body select,html body button{background-color:#202124!important;color:#e8eaed!important;border-color:#5f6368!important}img,picture,video,canvas,svg,iframe{filter:none!important}';
const ANKA_GOOGLE_DARK_CSS = 'html,body,#main,#cnt,#rcnt,#appbar,#searchform,#sfcnt,.MjjYud,.g,.sfbg,.appbar,.M8H8pb,.RNNXgb,.aajZCb,.UUbT9,#hdtb,#hdtbMenus,.Tg7LZd{background-color:#171717!important;color:#e8eaed!important}html body *:not(img):not(picture):not(video):not(canvas):not(svg):not(path):not(iframe){border-color:#3c4043!important}a,.q:visited,a:visited{color:#8ab4f8!important}input,textarea,select,button{background-color:#202124!important;color:#e8eaed!important;border-color:#5f6368!important}img,picture,video,canvas,svg,iframe{filter:none!important}';
const ANKA_DROP_EXT = /\.(pdf|html?|txt|md|json|png|jpe?g|gif|webp|svg|mp4|webm|mp3|ogg|wav)$/i;
const ANKA_MAC = /Mac/i.test(navigator.platform || '');
const ANKA_LINUX = /Linux/i.test(navigator.platform || navigator.userAgent || '');
const ANKA_WIN = /Win/i.test(navigator.platform || '');
const ankaExternalQueue = [];
let ankaExternalReady = false;
let ankaExternalTimer = 0;
let ankaExternalWait = 0;

function ankaBridgeApi() {
    let ipc = null;
    try {
        if (typeof require === 'function') ipc = require('electron').ipcRenderer;
    } catch (err) {}
    if (ipc) {
        return {
            on: (channel, fn) => ipc.on(channel, (event, ...args) => fn(...args)),
            send: (channel, ...args) => ipc.send(channel, ...args),
            invoke: (channel, ...args) => ipc.invoke(channel, ...args)
        };
    }
    const api = window.electronAPI;
    if (!api) return null;
    return {
        on: (channel, fn) => {
            if (channel === 'open-external-url' && typeof api.onExternalUrl === 'function') api.onExternalUrl(fn);
            else if (channel === 'open-download-sandbox' && typeof api.onDownloadSandbox === 'function') api.onDownloadSandbox(fn);
        },
        send: (channel) => {
            if (channel === 'anka-renderer-ready' && typeof api.rendererReady === 'function') api.rendererReady();
        },
        invoke: (channel) => {
            if (channel === 'anka-set-default-browser' && typeof api.setDefaultBrowser === 'function') return api.setDefaultBrowser();
            if (channel === 'anka-is-default-browser' && typeof api.isDefaultBrowser === 'function') return api.isDefaultBrowser();
            return Promise.resolve(null);
        }
    };
}

function ankaRegisterIpc() {
    const api = ankaBridgeApi();
    if (!api) return;
    api.on('webview-favicon-updated', (webContentsId, favicons) => {
        if (!Number.isInteger(webContentsId) || !Array.isArray(favicons)) return;
        const entry = Array.from(ankaTabs.values()).find((tab) => {
            if (!tab.vw || typeof tab.vw.getWebContentsId !== 'function') return false;
            try { return tab.vw.getWebContentsId() === webContentsId; }
            catch (err) { return false; }
        });
        if (entry) ankaSetTabFavicon(entry, entry.vw, favicons);
    });
    api.on('open-download-sandbox', (filePath) => {
        if (typeof filePath !== 'string' || !filePath) return;
        if (!/^([a-z]:[\\/]|\\\\|\/)/i.test(filePath)) return;
        try {
            ANKA_ALLOWED_FILES.add(ankaFileKey(ankaFileUrlFromPath(filePath)));
            createNewTab(ankaFileUrlFromPath(filePath));
        } catch (err) {}
    });
    api.on('open-external-url', (payload) => {
        const list = Array.isArray(payload) ? payload : [payload];
        list.forEach((item) => {
            if (item && typeof item === 'object') ankaOpenExternal(item.url, { background: !!item.background });
            else ankaOpenExternal(item);
        });
    });
}

ankaRegisterIpc();

const BLOCKED_DOMAINS = [
    'adult', 'porn', 'sex', 'porno', 'xxx', 'nsfw',
    'casino', 'bet', 'bahis', 'gambling', 'slot',
    'illegal', 'warez', 'hack', 'crack', 'torrents'
];

const ENGINES = {
    google: { name: 'Google', tpl: 'https://www.google.com/search?q=%s&safe=active' },
    yandex: { name: 'Yandex', tpl: 'https://yandex.com.tr/search/?text=%s&fyandex=1' },
    bing: { name: 'Bing', tpl: 'https://www.bing.com/search?q=%s&adlt=strict' },
    duckduckgo: { name: 'DuckDuckGo', tpl: 'https://duckduckgo.com/?q=%s&kp=1' },
    ecosia: { name: 'Ecosia', tpl: 'https://www.ecosia.org/search?q=%s&safe=active' },
    brave: { name: 'Brave Search', tpl: 'https://search.brave.com/search?q=%s&safesearch=strict' }
};

const AI_PROVIDERS = {
    'google-ai': { home: 'https://www.google.com/?udm=50&safe=active', tpl: 'https://www.google.com/search?q=%s&udm=50&safe=active' },
    chatgpt: { home: 'https://chatgpt.com', tpl: 'https://chatgpt.com/?q=%s' },
    gemini: { home: 'https://gemini.google.com/app', tpl: 'https://gemini.google.com/app' },
    perplexity: { home: 'https://www.perplexity.ai', tpl: 'https://www.perplexity.ai/search?q=%s' },
    claude: { home: 'https://claude.ai', tpl: 'https://claude.ai/new?q=%s' }
};

const ANKA_SEARCH_HOSTS = ['google.com', 'bing.com', 'yandex.com', 'yandex.com.tr', 'yandex.ru', 'duckduckgo.com', 'ecosia.org', 'search.brave.com'];

const ANKA_SAFE_SEARCH = [
    { match: (h) => /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h), path: /^\/search/, q: 'q', key: 'safe', value: 'active' },
    { match: (h) => ankaHostMatches(h, 'bing.com'), path: /^\/search/, q: 'q', key: 'adlt', value: 'strict' },
    { match: (h) => /(^|\.)yandex\.(com|com\.tr|ru)$/.test(h), path: /^\/search/, q: 'text', key: 'fyandex', value: '1' },
    { match: (h) => ankaHostMatches(h, 'duckduckgo.com'), path: /^\/$/, q: 'q', key: 'kp', value: '1' },
    { match: (h) => ankaHostMatches(h, 'ecosia.org'), path: /^\/search/, q: 'q', key: 'safe', value: 'active' },
    { match: (h) => ankaHostMatches(h, 'search.brave.com'), path: /^\/search/, q: 'q', key: 'safesearch', value: 'strict' }
];

const ANKA_READER_CSS = 'body{max-width:720px;margin:48px auto;padding:0 20px;font:19px/1.75 Georgia,"Times New Roman",serif;color:#222;background:#fafaf7}h1{font-size:2em;line-height:1.25}img,video,svg{max-width:100%;height:auto}a{color:#0b5cad}pre,code{font-family:Consolas,"DejaVu Sans Mono",monospace;font-size:.85em;overflow:auto}pre{background:#eee;padding:12px;border-radius:6px}blockquote{border-left:4px solid #bbb;margin:1em 0;padding-left:16px;color:#555}';

const ANKA_READER_JS = `(() => {
    const root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
    let node = root && root.innerText.length > 400 ? root : null;
    if (!node) {
        let score = 0;
        document.querySelectorAll('div,section').forEach((el) => {
            const paras = Array.from(el.children).filter((c) => c.tagName === 'P').length;
            const s = paras * 200 + Math.min(el.innerText.length, 4000);
            if (paras >= 2 && s > score) { score = s; node = el; }
        });
    }
    node = node || document.body;
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script,style,iframe,nav,aside,footer,form,button,noscript,[aria-hidden="true"],[role="navigation"],[role="banner"]').forEach((n) => n.remove());
    clone.querySelectorAll('*').forEach((n) => {
        Array.from(n.attributes).forEach((a) => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
        n.removeAttribute('style');
    });
    const title = document.createElement('h1');
    title.textContent = document.title;
    document.querySelectorAll('link[rel~="stylesheet"],style').forEach((n) => n.remove());
    document.body.replaceChildren(title, clone);
    document.body.removeAttribute('class');
    document.body.removeAttribute('style');
    window.scrollTo(0, 0);
    return true;
})();`;

function ankaById(id) {
    return id ? document.getElementById(id) : null;
}

function ankaMk(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
        for (const key of Object.keys(props)) {
            const val = props[key];
            if (key === 'className') node.className = val;
            else if (key === 'text') node.textContent = val;
            else if (key === 'style') node.style.cssText = val;
            else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2), val);
            else if (val !== undefined && val !== null && val !== false) node.setAttribute(key, val === true ? '' : val);
        }
    }
    for (const kid of kids) if (kid) node.append(kid);
    return node;
}

function ankaDebounce(fn, ms) {
    let timer = 0;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function ankaThrottle(fn, ms) {
    let last = 0;
    let scheduled = 0;
    return (...args) => {
        const now = Date.now();
        const remaining = ms - (now - last);
        if (remaining <= 0) {
            last = now;
            fn(...args);
        } else if (!scheduled) {
            scheduled = setTimeout(() => {
                scheduled = 0;
                last = Date.now();
                fn(...args);
            }, remaining);
        }
    };
}

function ankaRead(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const value = JSON.parse(raw);
        return value === null || value === undefined ? fallback : value;
    } catch (err) {
        return fallback;
    }
}

function ankaWrite(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (err) {
        return false;
    }
}

function ankaTryUrl(value) {
    try {
        return new URL(value);
    } catch (err) {
        return null;
    }
}

function ankaHostMatches(host, domain) {
    return host === domain || host.endsWith('.' + domain);
}

function ankaTruncate(text, max) {
    const s = String(text || '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function ankaDecode(text) {
    try {
        return decodeURIComponent(text);
    } catch (err) {
        return text;
    }
}

function ankaStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function ankaNonce() {
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (n) => n.toString(36)).join('');
}

function ankaHostLabel(url) {
    const parsed = ankaTryUrl(url);
    return parsed ? parsed.hostname.replace(/^www\./, '') : '';
}

function ankaHomeUrl() {
    return typeof getHomeUrl === 'function' ? getHomeUrl() : 'newtab.html';
}

function ankaCopy(text) {
    const done = () => showNotification('Panoya kopyalandı.');
    const fallback = () => {
        try {
            const area = ankaMk('textarea', { style: 'position:fixed;opacity:0;left:-999px' });
            area.value = text;
            document.body.append(area);
            area.select();
            document.execCommand('copy');
            area.remove();
            done();
        } catch (err) {}
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
}

function ankaDownload(href, name) {
    const link = ankaMk('a', { href, download: name, style: 'display:none' });
    document.body.append(link);
    link.click();
    link.remove();
}

function getSetting(id, def) {
    try {
        const v = localStorage.getItem('set_' + id);
        return v === null ? def : v;
    } catch (err) {
        return def;
    }
}

function setSetting(id, value) {
    try {
        localStorage.setItem('set_' + id, String(value));
    } catch (err) {
        console.error('DevTools açılamadı:', err);
        showNotification('DevTools açılamadı. Bu sekme için desteklenmiyor olabilir.');
    }
}

function getMaxTabs() {
    const n = parseInt(getSetting('max-tabs', '10'), 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
}

function isAiModeActive() {
    return getSetting('ai-mode-active', localStorage.getItem('ai-mode-active') || 'false') === 'true';
}

function setAiMode(active) {
    const value = active ? 'true' : 'false';
    setSetting('ai-mode-active', value);
    try { localStorage.setItem('ai-mode-active', value); } catch (err) {}
    const btn = ankaById('ai-mode-btn');
    if (btn) {
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', value);
    }
}

function toggleAiMode() {
    setAiMode(!isAiModeActive());
}

function buildSearchUrl(query) {
    const q = encodeURIComponent(String(query || '').slice(0, 1024));
    if (isAiModeActive()) {
        const prov = AI_PROVIDERS[getSetting('ai-provider', 'google-ai')] || AI_PROVIDERS['google-ai'];
        return prov.tpl.replace('%s', () => q);
    }
    const engineId = getSetting('search-engine', 'google');
    if (engineId === 'custom') {
        const custom = getSetting('custom-search-url', ENGINES.google.tpl);
        const parsed = ankaTryUrl(custom.replace('%s', 'x'));
        if (!parsed || !/^https?:$/.test(parsed.protocol)) return ENGINES.google.tpl.replace('%s', () => q);
        return custom.includes('%s') ? custom.replace('%s', () => q) : custom + q;
    }
    return (ENGINES[engineId] || ENGINES.google).tpl.replace('%s', () => q);
}

let ankaBlockCache = { key: null, re: null };

function ankaBlockedRegex() {
    const extra = getSetting('blocked-extra', '');
    if (ankaBlockCache.key === extra && ankaBlockCache.re) return ankaBlockCache.re;
    const words = BLOCKED_DOMAINS.concat(extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    ankaBlockCache = { key: extra, re: new RegExp('(^|[^a-z0-9])(' + escaped.join('|') + ')([^a-z0-9]|$)', 'i') };
    return ankaBlockCache.re;
}

function matchesBlockedWord(text) {
    return ankaBlockedRegex().test(String(text || ''));
}

function ankaIsAllowedHost(host) {
    const list = getSetting('allowed-hosts', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return list.some((d) => ankaHostMatches(host, d));
}

function ankaIsBlockedUrl(parsed) {
    const host = parsed.hostname.toLowerCase();
    if (ankaIsAllowedHost(host)) return false;
    if (matchesBlockedWord(host) || matchesBlockedWord(ankaDecode(parsed.pathname))) return true;
    if (getSetting('filter-search-query', 'true') === 'true' && ANKA_SEARCH_HOSTS.some((d) => ankaHostMatches(host, d))) {
        const q = parsed.searchParams.get('q') || parsed.searchParams.get('text') || '';
        if (q && matchesBlockedWord(q)) return true;
    }
    return false;
}

function ankaApplySafeSearch(parsed) {
    const host = parsed.hostname.toLowerCase();
    for (const rule of ANKA_SAFE_SEARCH) {
        if (!rule.match(host)) continue;
        if (!rule.path.test(parsed.pathname) || !parsed.searchParams.has(rule.q)) return false;
        if (parsed.searchParams.get(rule.key) === rule.value) return false;
        parsed.searchParams.set(rule.key, rule.value);
        return true;
    }
    return false;
}

function ankaIsPrivateHost(host) {
    if (!host) return false;
    if (host === 'localhost' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

let ankaNewTabUrl = null;
let ankaErrorPageUrl = null;

function getNewTabUrl() {
    if (ankaNewTabUrl) return ankaNewTabUrl;
    try {
        if (typeof require === 'function' && typeof __dirname !== 'undefined') {
            const path = require('path');
            const { pathToFileURL } = require('url');
            ankaNewTabUrl = pathToFileURL(path.join(__dirname, '../renderer/newtab.html')).href;
            return ankaNewTabUrl;
        }
    } catch (err) {}
    ankaNewTabUrl = new URL('newtab.html', window.location.href).href;
    return ankaNewTabUrl;
}

let ankaWelcomeUrl = null;

function getWelcomeUrl() {
    if (ankaWelcomeUrl) return ankaWelcomeUrl;
    try {
        const path = require('path');
        const { pathToFileURL } = require('url');
        ankaWelcomeUrl = pathToFileURL(path.join(__dirname, '../renderer/welcome.html')).href;
        ANKA_ALLOWED_FILES.add(ankaFileKey(ankaWelcomeUrl));
        return ankaWelcomeUrl;
    } catch (err) {
        try {
            ankaWelcomeUrl = new URL('welcome.html', window.location.href).href;
            ANKA_ALLOWED_FILES.add(ankaFileKey(ankaWelcomeUrl));
            return ankaWelcomeUrl;
        } catch (fallbackError) {
            return '';
        }
    }
}

function ankaIsWelcomeUrl(url) {
    return !!getWelcomeUrl() && ankaFileKey(url) === ankaFileKey(getWelcomeUrl());
}

function getErrorPageUrl(target, code) {
    if (!ankaErrorPageUrl) {
        try {
            const path = require('path');
            const { pathToFileURL } = require('url');
            ankaErrorPageUrl = pathToFileURL(path.join(__dirname, '../renderer/error.html')).href;
            ANKA_ALLOWED_FILES.add(ankaFileKey(ankaErrorPageUrl));
        } catch (err) {
            return '';
        }
    }
    const url = new URL(ankaErrorPageUrl);
    if (/^https?:\/\//i.test(String(target || ''))) url.searchParams.set('url', target);
    url.searchParams.set('code', String(code || 0));
    url.searchParams.set('platform', ANKA_WIN ? 'win32' : ANKA_LINUX ? 'linux' : 'other');
    return url.href;
}

function isErrorPageUrl(url) {
    if (!ankaErrorPageUrl) return false;
    return ankaFileKey(url) === ankaFileKey(ankaErrorPageUrl);
}

function ankaFileKey(url) {
    const parsed = ankaTryUrl(String(url));
    const base = parsed && parsed.protocol === 'file:' ? 'file://' + parsed.pathname : String(url).split(/[?#]/)[0];
    return base.toLowerCase();
}

function ankaIsInternalFile(url) {
    if (!/^file:/i.test(url)) return false;
    const key = ankaFileKey(url);
    return key === ankaFileKey(getNewTabUrl()) || ANKA_ALLOWED_FILES.has(key);
}

function ankaIsNewTabUrl(url) {
    return /^file:.*\/newtab\.html([?#]|$)/i.test(url || '');
}

function ankaFileUrlFromPath(filePath) {
    let s = String(filePath).replace(/\\/g, '/');
    if (s.startsWith('//')) return 'file:' + encodeURI(s).replace(/[?#]/g, (c) => encodeURIComponent(c));
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + encodeURI(s).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

function sanitizeUrl(inputUrl) {
    let clean = String(inputUrl || '').trim();
    if (!clean) return 'newtab.html';
    if (clean === 'newtab.html' || clean === 'about:blank') return clean;
    if (ankaIsInternalFile(clean)) return clean;

    if (!/^https?:\/\//i.test(clean)) {
        if (/^(javascript|data|vbscript|blob|file|ftp|chrome|devtools|view-source|mailto|tel):\S/i.test(clean) || /^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) {
            showNotification('Bu adres türü güvenlik nedeniyle engellendi.');
            return 'about:blank';
        }
        const isLocal = /^(localhost|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?(?:[/?#].*)?$/i.test(clean);
        const isDomain = /^([\p{L}\p{N}-]+\.)+\p{L}{2,}(?::\d+)?(?:[/?#].*)?$/u.test(clean);
        if (isLocal || isDomain) {
            const probe = ankaTryUrl('https://' + clean);
            const useHttp = isLocal || (probe && ankaIsPrivateHost(probe.hostname.toLowerCase()));
            clean = (useHttp ? 'http://' : 'https://') + clean;
        } else {
            clean = buildSearchUrl(clean);
        }
    }

    if (getSetting('https-only', 'true') === 'true' && /^http:\/\//i.test(clean)) {
        const insecure = ankaTryUrl(clean);
        if (insecure && !ankaIsPrivateHost(insecure.hostname.toLowerCase())) {
            insecure.protocol = 'https:';
            clean = insecure.href;
        }
    }

    const parsed = ankaTryUrl(clean);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return 'newtab.html';

    if (ankaIsBlockedUrl(parsed)) {
        showNotification('Bu site güvenlik politikaları gereği engellendi.');
        return 'about:blank';
    }

    if (parsed.username || parsed.password) {
        parsed.username = '';
        parsed.password = '';
        showNotification('Adresteki kullanıcı bilgileri güvenlik için kaldırıldı.');
    }

    if (/(^|\.)xn--/i.test(parsed.hostname)) {
        showNotification('Dikkat: alan adı uluslararası karakterler içeriyor (' + parsed.hostname + ').');
    }

    ankaApplySafeSearch(parsed);
    return parsed.href;
}

function ankaResolveTarget(value) {
    const target = sanitizeUrl(value);
    if (target === 'newtab.html') return getNewTabUrl();
    if (target === 'about:blank' && String(value || '').trim() !== 'about:blank') return null;
    return target;
}

function getFaviconUrl(url) {
    const logo = window.ankaGetLogo ? window.ankaGetLogo() : ANKA_LOGO;
    try {
        if (!url || ankaIsNewTabUrl(url) || /^file:/i.test(url)) return logo;
        const parsed = new URL(url);
        return parsed.origin + '/favicon.ico';
    } catch (err) {
        return logo;
    }
}

function ankaRefreshFaviconUrl(url, st) {
    return typeof url === 'string' ? url : '';
}

function ankaLoadNativeFavicon(st, vw, icon, failedUrl) {
    if (!st || !vw || !icon || !/^https?:/i.test(failedUrl)) return false;
    const bridge = ankaBridgeApi();
    if (!bridge || typeof bridge.invoke !== 'function' || typeof vw.getWebContentsId !== 'function') return false;
    let webContentsId;
    let expectedUrl;
    try {
        webContentsId = vw.getWebContentsId();
        expectedUrl = vw.getURL();
    } catch (err) {
        return false;
    }
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) return false;
    const generation = st.faviconGeneration || 0;
    const requestKey = generation + '|' + expectedUrl + '|' + failedUrl;
    if (st.faviconNativeRequestKey === requestKey) return false;
    st.faviconNativeRequestKey = requestKey;
    const fallback = () => {
        if (st.vw !== vw || (st.faviconGeneration || 0) !== generation ||
            icon.src !== failedUrl) return;
        icon.dataset.ankaFallback = 'true';
        icon.src = ANKA_LOGO;
    };
    bridge.invoke('site-favicon:load', { webContentsId, url: failedUrl }).then((result) => {
        if (!result || !result.ok || typeof result.dataUrl !== 'string' ||
            !/^data:image\/[a-z0-9+.-]+[;,]/.test(result.dataUrl) ||
            st.vw !== vw || (st.faviconGeneration || 0) !== generation ||
            vw.getURL() !== expectedUrl || icon.src !== failedUrl) {
            fallback();
            return;
        }
        icon.__ankaFaviconCandidates = [result.dataUrl];
        icon.__ankaFaviconIndex = 0;
        icon.dataset.ankaFallback = 'false';
        icon.dataset.ankaOriginalSrc = result.dataUrl;
        icon.src = result.dataUrl;
    }).catch((err) => {
        console.error('Site simgesi renderer üzerinden yüklenemedi:', err);
        fallback();
    });
    return true;
}

function ankaSetTabFavicon(st, vw, candidates) {
    if (!st || !st.icon || !vw || !vw.isConnected || !Array.isArray(candidates)) return;
    let currentOrigin = '';
    try {
        const currentUrl = new URL(vw.getURL());
        if (currentUrl.protocol !== 'https:' && currentUrl.protocol !== 'http:') return;
        currentOrigin = currentUrl.origin;
    } catch (err) { return; }
    if (st.url) {
        try {
            if (new URL(st.url).origin !== currentOrigin) return;
        } catch (err) {}
    }
    const favicons = candidates.filter((candidate) => {
        if (typeof candidate !== 'string' || candidate.length > 32768) return false;
        if (/^data:image\/(?:png|gif|jpe?g|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml);/i.test(candidate)) return true;
        try {
            const parsed = new URL(candidate, vw.getURL());
            return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
                (parsed.origin === currentOrigin || !ankaIsPrivateHost(parsed.hostname));
        } catch (err) {
            return false;
        }
    }).map((favicon) => {
        if (/^data:image\//i.test(favicon)) return favicon;
        try { return new URL(favicon, vw.getURL()).href; } catch (err) { return ''; }
    }).filter(Boolean);
    const fallback = currentOrigin + '/favicon.ico';
    const ordered = Array.from(new Set(favicons.concat(fallback)));
    if (ordered.length) {
        st.faviconGeneration = (st.faviconGeneration || 0) + 1;
        st.icon.__ankaFaviconCandidates = ordered;
        st.icon.__ankaFaviconIndex = 0;
        st.icon.dataset.ankaFallback = 'false';
        st.icon.dataset.ankaOriginalSrc = ordered[0];
        st.icon.dataset.ankaRetry = 'false';
        st.icon.src = ordered[0];
    }
    if (ordered.length) {
        st.faviconGeneration = (st.faviconGeneration || 0) + 1;
        st.icon.__ankaFaviconCandidates = ordered;
        st.icon.__ankaFaviconIndex = 0;
        st.icon.dataset.ankaFallback = 'false';
        st.icon.dataset.ankaOriginalSrc = ordered[0];
        st.icon.dataset.ankaRetry = 'false';
        st.icon.src = ordered[0];
        ankaFetchFaviconData(st, vw, ordered);
    }
}

function ankaFetchFaviconData(st, vw, urls) {
    if (!st || !vw || typeof vw.executeJavaScript !== 'function' || !Array.isArray(urls) || !urls.length) return;
    const gen = st.faviconGeneration || 0;
    const urlsJson = JSON.stringify(urls.slice(0, 6));
    const script = `(async () => {
        const candidates = ${urlsJson};
        for (const url of candidates) {
            try {
                const res = await fetch(url, { credentials: 'omit' });
                if (!res.ok) continue;
                const blob = await res.blob();
                if (!blob.size || blob.size > 262144) continue;
                if (!/^image\\//i.test(blob.type || '')) continue;
                const reader = new FileReader();
                const dataUrl = await new Promise((resolve) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (dataUrl && typeof dataUrl === 'string' && /^data:image\\//i.test(dataUrl)) return dataUrl;
            } catch (e) {}
        }
        return null;
    })()`;
    vw.executeJavaScript(script).then((dataUrl) => {
        if (!dataUrl || typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl)) return;
        if ((st.faviconGeneration || 0) !== gen) return;
        if (st.vw !== vw || !st.icon || !st.icon.isConnected) return;
        st.icon.__ankaFaviconCandidates = [dataUrl];
        st.icon.__ankaFaviconIndex = 0;
        st.icon.dataset.ankaFallback = 'false';
        st.icon.dataset.ankaOriginalSrc = dataUrl;
        st.icon.dataset.ankaRetry = 'false';
        st.icon.src = dataUrl;
    }).catch(() => {});
}


function ankaRefreshTabFavicon(st, vw) {
    if (!st || !vw || typeof vw.executeJavaScript !== 'function') return;
    let expectedUrl = '';
    try { expectedUrl = vw.getURL(); } catch (err) { return; }
    const requestId = st.faviconReadId = (st.faviconReadId || 0) + 1;
    vw.executeJavaScript(`(() => Array.from(document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"]'))
        .map((link) => link.href)
        .filter((href) => typeof href === 'string' && href.length <= 32768))()`)
        .then((favicons) => {
            let currentUrl = '';
            try { currentUrl = vw.getURL(); } catch (err) { return; }
            if (requestId !== st.faviconReadId || currentUrl !== expectedUrl) return;
            ankaSetTabFavicon(st, vw, favicons);
        })
        .catch((err) => console.error('Site simgesi okunamadı:', err));
}

function ankaBlockView(vw, message) {
    try { vw.stop(); } catch (err) {}
    ankaLoad(vw, 'about:blank');
    showNotification(message);
}

function ankaLoad(vw, url) {
    if (!vw) return;
    const now = Date.now();
    if (vw.__ankaLoadUrl === url && now - (vw.__ankaLoadAt || 0) < 1500) return;
    vw.__ankaLoadUrl = url;
    vw.__ankaLoadAt = now;
    if (vw.getAttribute('src') !== url) {
        vw.setAttribute('src', url);
        return;
    }
    if (vw.__ankaReady && typeof vw.loadURL === 'function') {
        try {
            const p = vw.loadURL(url);
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (err) {}
    }
}

function ankaGuardNavigation(url, vw) {
    if (!url || url === 'about:blank') return true;
    const parsed = ankaTryUrl(url);
    if (!parsed) return true;
    if (parsed.protocol === 'chrome-error:') return true;
    if (parsed.protocol === 'file:') {
        if (ankaIsInternalFile(url)) return true;
        ankaBlockView(vw, 'Yerel dosya erişimi engellendi.');
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ankaBlockView(vw, 'Bu adres türü engellendi.');
        return false;
    }
    if (ankaIsBlockedUrl(parsed)) {
        ankaBlockView(vw, 'Bu içerik güvenlik politikası gereği engellenmiştir.');
        return false;
    }
    const now = Date.now();
    if (getSetting('https-only', 'true') === 'true' && parsed.protocol === 'http:' && !ankaIsPrivateHost(parsed.hostname.toLowerCase())) {
        if (now - (vw.__ankaUpgradeAt || 0) > 2000) {
            vw.__ankaUpgradeAt = now;
            parsed.protocol = 'https:';
            vw.__ankaUpgraded = parsed.href;
            ankaLoad(vw, parsed.href);
        } else {
            ankaBlockView(vw, 'Güvenli olmayan HTTP bağlantısı engellendi.');
        }
        return false;
    }
    if (ankaApplySafeSearch(parsed)) {
        if (now - (vw.__ankaSafeAt || 0) > 1500) {
            vw.__ankaSafeAt = now;
            ankaLoad(vw, parsed.href);
        }
        return false;
    }
    return true;
}

function checkUrlSecurity(url, vw) {
    if (!url || !vw || typeof vw.loadURL !== 'function') return true;
    const checkedAt = Date.now();
    let allowed;
    if (vw.__ankaChkUrl === url && checkedAt - (vw.__ankaChkAt || 0) < 250) {
        allowed = vw.__ankaChkOk;
    } else {
        allowed = ankaGuardNavigation(url, vw);
        vw.__ankaChkUrl = url;
        vw.__ankaChkAt = checkedAt;
        vw.__ankaChkOk = allowed;
    }
    if (!allowed) return false;
    const parsed = ankaTryUrl(url);
    if (parsed) {
        const host = parsed.hostname.toLowerCase();
        if (ankaHostMatches(host, 'youtube.com') || host === 'youtu.be' || ankaHostMatches(host, 'youtube-nocookie.com')) {
            forceYouTubeRestrictedMode(vw);
        }
    }
    return true;
}

function forceYouTubeRestrictedMode(vw) {
    if (!vw || typeof vw.executeJavaScript !== 'function') return;
    if (!vw.__ankaReady) return;
    try {
        vw.executeJavaScript(`(() => {
            try {
                if (!/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname) || window.__ankaYtRestrict) return;
                window.__ankaYtRestrict = true;
                const original = Storage.prototype.setItem;
                Storage.prototype.setItem = function (k, v) { return original.call(this, k, k === 'yt-player-restricted' ? 'true' : v); };
                const enforce = () => {
                    const pref = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('PREF='));
                    if (!pref) document.cookie = 'PREF=f2=8000000; path=/; domain=.youtube.com; secure';
                    else if (!pref.includes('f2=8000000')) document.cookie = pref + '&f2=8000000; path=/; domain=.youtube.com; secure';
                };
                enforce();
            } catch (e) {}
        })();`).catch(() => {});
    } catch (err) {}
}

function ankaBridgeScript(nonce) {
    const modKey = ANKA_MAC ? 'e.metaKey' : 'e.ctrlKey';
    return `(() => {
        if (window.__ankaBridge) return;
        try { Object.defineProperty(window, '__ankaBridge', { value: true }); } catch (e) { return; }
        const log = console.log.bind(console);
        const N = ${JSON.stringify(nonce)};
        const send = (type, data) => { try { log('anka:' + N + ':' + type + ':' + data); } catch (e) {} };
        window.__ankaOpenNetworkSettings = () => send('network-help', '');
        const active = () => !!(navigator.userActivation && navigator.userActivation.isActive);
        const linkOf = (e) => {
            const path = e.composedPath ? e.composedPath() : [e.target];
            for (const node of path) if (node && node.tagName === 'A' && typeof node.href === 'string' && node.href) return node;
            return null;
        };
        const letter = (e) => {
            const k = e.key && e.key.length === 1 ? e.key.toLowerCase() : '';
            if (/^[a-z]$/.test(k)) return k;
            return /^Key[A-Z]$/.test(e.code || '') ? e.code[3].toLowerCase() : '';
        };
        const P = 'twlrfudhpseoj';
        const S = 'tnasmodbricyegkj';
        addEventListener('pointerdown', () => send('dismiss', ''), true);
        addEventListener('contextmenu', (e) => send('ctx', e.clientX + ',' + e.clientY), true);
        addEventListener('click', (e) => {
            const a = linkOf(e);
            if (!a) return;
            if (${modKey}) { e.preventDefault(); e.stopImmediatePropagation(); send('openbg', a.href); return; }
            if (a.target && !['_self', '_parent', '_top'].includes(a.target)) { e.preventDefault(); send('open', a.href); }
        }, true);
        addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            const a = linkOf(e);
            if (a) { e.preventDefault(); send('openbg', a.href); }
        }, true);
        window.open = function (u) {
            if (u && active()) { try { send('open', new URL(String(u), location.href).href); } catch (e) {} }
            return null;
        };
        let hover = '';
        addEventListener('mouseover', (e) => {
            const a = linkOf(e);
            const u = a ? a.href.slice(0, 500) : '';
            if (u !== hover) { hover = u; send('hover', u); }
        }, true);
        document.addEventListener('mouseleave', () => { if (hover) { hover = ''; send('hover', ''); } });
        addEventListener('keydown', (e) => {
            if (e.getModifierState && e.getModifierState('AltGraph')) return;
            const mod = ${modKey};
            const l = letter(e);
            let hit = false;
            if (mod && !e.altKey) {
                if (l) hit = (e.shiftKey ? S : P).includes(l);
                else hit = ['Tab', 'PageUp', 'PageDown', 'Comma', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Numpad0', 'F5'].includes(e.code) || /^Digit[0-9]$/.test(e.code) || ['+', '-', '=', '_', ',', '0'].includes(e.key) || (e.shiftKey && e.key === 'Delete');
            } else if (!mod && !e.altKey && ['F5', 'F11', 'F12'].includes(e.key)) {
                hit = true;
            } else if (e.altKey && !mod && !e.shiftKey && ['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {
                const t = e.target;
                hit = !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
            }
            if (!hit) return;
            e.preventDefault();
            e.stopPropagation();
            send('key', JSON.stringify({ key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, ctrl: mod }));
        }, true);
        if (!window.__ankaKbInsert) {
            let last = null;
            const blocked = { button: 1, submit: 1, reset: 1, checkbox: 1, radio: 1, file: 1, color: 1, range: 1, hidden: 1, image: 1 };
            const ok = (el) => {
                if (!el || el.disabled || el.readOnly) return false;
                if (el.isContentEditable) return true;
                if (el.tagName === 'TEXTAREA') return true;
                if (el.tagName !== 'INPUT') return false;
                return !blocked[(el.type || 'text').toLowerCase()];
            };
            addEventListener('focusin', (e) => { if (ok(e.target)) last = e.target; }, true);
            window.__ankaKbInsert = (action, value) => {
                const pick = () => {
                    if (ok(last) && document.contains(last)) return last;
                    if (ok(document.activeElement)) return document.activeElement;
                    const q = document.getElementById('q');
                    if (ok(q)) return q;
                    return document.querySelector('input:not([type=hidden]):not([disabled]),textarea:not([disabled]),[contenteditable=true]');
                };
                const el = pick();
                if (!ok(el)) return false;
                try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
                if (el.isContentEditable) {
                    if (action === 'backspace') document.execCommand('delete');
                    else if (action === 'enter') document.execCommand('insertParagraph');
                    else document.execCommand('insertText', false, action === 'tab' ? '\\t' : String(value == null ? '' : value));
                    return true;
                }
                const start = el.selectionStart != null ? el.selectionStart : String(el.value || '').length;
                const end = el.selectionEnd != null ? el.selectionEnd : start;
                const val = String(el.value || '');
                const fire = (type, extra) => {
                    try { el.dispatchEvent(new InputEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true }, extra || {}))); }
                    catch (e) { el.dispatchEvent(new Event(type, { bubbles: true })); }
                    if (type === 'input') el.dispatchEvent(new Event('change', { bubbles: true }));
                };
                const sel = (pos) => { try { el.setSelectionRange(pos, pos); } catch (e) {} };
                if (action === 'backspace') {
                    if (start !== end) { if (el.setRangeText) el.setRangeText('', start, end, 'end'); else { el.value = val.slice(0, start) + val.slice(end); sel(start); } }
                    else if (start > 0) { if (el.setRangeText) el.setRangeText('', start - 1, start, 'end'); else { el.value = val.slice(0, start - 1) + val.slice(start); sel(start - 1); } }
                    fire('input', { inputType: 'deleteContentBackward' });
                } else if (action === 'enter') {
                    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                } else {
                    const text = action === 'tab' ? '\\t' : String(value == null ? '' : value);
                    if (el.setRangeText) el.setRangeText(text, start, end, 'end');
                    else { el.value = val.slice(0, start) + text + val.slice(end); sel(start + text.length); }
                    fire('input', { inputType: 'insertText', data: text });
                }
                return true;
            };
        }
    })();`;
}

function injectForcedRestrictions(vw) {
    if (!vw || typeof vw.executeJavaScript !== 'function') return;
    if (!vw.__ankaNonce) vw.__ankaNonce = ankaNonce();
    try {
        vw.executeJavaScript(ankaBridgeScript(vw.__ankaNonce)).catch(() => {});
    } catch (err) {}
}

function ankaHandleBridge(vw, message) {
    const prefix = 'anka:' + vw.__ankaNonce + ':';
    if (typeof message !== 'string' || !message.startsWith(prefix)) return false;
    const rest = message.slice(prefix.length);
    const split = rest.indexOf(':');
    const type = split < 0 ? rest : rest.slice(0, split);
    const data = split < 0 ? '' : rest.slice(split + 1);
    if (type === 'dismiss') {
        closeContextMenu();
    } else if (type === 'open' || type === 'openbg') {
        const now = Date.now();
        if (now - (vw.__ankaOpenAt || 0) < 350) return true;
        vw.__ankaOpenAt = now;
        createNewTab(data, { background: type === 'openbg' });
    } else if (type === 'ctx') {
        const parts = data.split(',');
        const cx = Number(parts[0]);
        const cy = Number(parts[1]);
        if (Number.isFinite(cx) && Number.isFinite(cy)) vw.__ankaCtxPoint = { x: cx, y: cy, t: Date.now() };
    } else if (type === 'hover') {
        if (!vw.id || vw.id === activeTabId) ankaShowLinkStatus(data);
    } else if (type === 'key') {
        try {
            const k = JSON.parse(data);
            if (k && typeof k.key === 'string') {
                ankaHandleShortcut({ key: k.key, code: String(k.code || ''), shift: !!k.shift, alt: !!k.alt, ctrl: !!k.ctrl, editing: false });
            }
        } catch (err) {}
    } else if (type === 'password-save') {
        ankaPromptSavePassword(vw, data);
    } else if (type === 'network-help' && isErrorPageUrl(vw.getURL())) {
        try {
            const ipc = require('electron').ipcRenderer;
            ipc.send('open-network-settings');
        } catch (err) {
            showNotification('Ağ ayarları bu ortamda açılamadı.');
        }
    }
    return true;
}

function ankaPromptSavePassword(vw, encoded) {
    let credential;
    try { credential = JSON.parse(decodeURIComponent(encoded)); } catch (err) { return; }
    let currentOrigin;
    try { currentOrigin = new URL(vw.getURL()).origin; } catch (err) { return; }
    if (!credential || credential.origin !== currentOrigin ||
        typeof credential.username !== 'string' || typeof credential.password !== 'string' ||
        credential.password.length > 4096) return;
    const ipc = ankaBridgeApi();
    if (!ipc || !ipc.invoke || typeof window.confirm !== 'function') return;
    if (!window.confirm('Anka Web, ' + currentOrigin + ' için bu hesabın parolasını güvenli şekilde kaydetsin mi?')) return;
    ipc.invoke('password-manager:save', credential).then((result) => {
        if (result && result.ok) showNotification('Parola Anka Web güvenli deposuna kaydedildi.');
        else showNotification(result && result.error === 'secure-storage-unavailable'
            ? 'Bu cihazda güvenli parola deposu kullanılamıyor; parola kaydedilmedi.'
            : 'Parola güvenli şekilde kaydedilemedi.');
    }).catch((err) => {
        console.error('Password manager save request failed:', err);
        showNotification('Parola kaydı tamamlanamadı.');
    });
}

function ankaSetupPasswordManager(vw) {
    if (!vw || getSetting('password-manager', 'false') !== 'true') return;
    if (String(vw.getAttribute('partition') || '').startsWith('ankaprivate-')) return;
    let origin;
    try {
        const url = new URL(vw.getURL());
        if (url.protocol !== 'https:') return;
        origin = url.origin;
    } catch (err) { return; }
    if (!vw.__ankaNonce) vw.__ankaNonce = ankaNonce();
    const prefix = JSON.stringify('anka:' + vw.__ankaNonce + ':password-save:');
    const source = `(() => {
        if (window.__ankaPasswordSavePromptInstalled) return;
        window.__ankaPasswordSavePromptInstalled = true;
        document.addEventListener('submit', (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) return;
            const password = form.querySelector('input[type="password"]');
            if (!password || !password.value) return;
            const username = form.querySelector('input[autocomplete="username"],input[type="email"],input[type="text"]:not([autocomplete="off"])');
            const data = { origin: location.origin, username: username ? username.value.trim() : '', password: password.value };
            if (!data.username) return;
            console.info(${prefix} + encodeURIComponent(JSON.stringify(data)));
        }, true);
    })();`;
    vw.executeJavaScript(source).catch((err) => console.error('Parola kaydetme formu izlenemedi:', err));
}

function ankaApplyFpsLimitToView(vw, requestedFps) {
    if (!vw || typeof vw.executeJavaScript !== 'function') return;
    const fps = [30, 45, 60, 90, 120].includes(Number(requestedFps)) ? Number(requestedFps) : 0;
    const source = `(() => {
        const requested = ${fps};
        let state = window.__ankaFpsLimiter;
        if (state) {
            if (requested > 0) {
                state.target = requested;
                return;
            }
            if (window.requestAnimationFrame === state.request) window.requestAnimationFrame = state.nativeRequest;
            if (window.cancelAnimationFrame === state.cancel) window.cancelAnimationFrame = state.nativeCancel;
            if (state.frame) state.nativeCancel(state.frame);
            const pending = Array.from(state.queue.values());
            state.queue.clear();
            delete window.__ankaFpsLimiter;
            if (pending.length) state.nativeRequest((time) => pending.forEach((callback) => {
                try { callback(time); }
                catch (error) { setTimeout(() => { throw error; }, 0); }
            }));
            return;
        }
        if (!requested) return;
        const nativeRequest = window.requestAnimationFrame.bind(window);
        const nativeCancel = window.cancelAnimationFrame.bind(window);
        state = {
            nativeRequest,
            nativeCancel,
            target: requested,
            last: null,
            queue: new Map(),
            next: 1,
            frame: 0,
            request: null,
            cancel: null
        };
        const schedule = () => {
            if (!state.frame && state.queue.size) state.frame = nativeRequest(tick);
        };
        const tick = (time) => {
            state.frame = 0;
            const interval = 1000 / state.target;
            if (state.last !== null && time - state.last + 0.25 < interval) {
                schedule();
                return;
            }
            state.last = time;
            const callbacks = Array.from(state.queue.entries());
            state.queue.clear();
            callbacks.forEach(([, callback]) => {
                try { callback(time); }
                catch (error) { setTimeout(() => { throw error; }, 0); }
            });
            schedule();
        };
        state.request = (callback) => {
            if (typeof callback !== 'function') throw new TypeError('Animation frame callback must be a function');
            const id = state.next++;
            state.queue.set(id, callback);
            schedule();
            return id;
        };
        state.cancel = (id) => {
            state.queue.delete(id);
            if (!state.queue.size && state.frame) {
                nativeCancel(state.frame);
                state.frame = 0;
            }
        };
        window.__ankaFpsLimiter = state;
        window.requestAnimationFrame = state.request;
        window.cancelAnimationFrame = state.cancel;
    })();`;
    vw.executeJavaScript(source).catch((err) => console.error('Sekme FPS sınırı uygulanamadı:', err));
}

window.__ankaApplyFpsLimit = function (fps) {
    ankaFpsLimit = [0, 30, 45, 60, 90, 120].includes(Number(fps)) ? Number(fps) : 0;
    ankaTabs.forEach((st) => {
        if (st.vw) ankaApplyFpsLimitToView(st.vw, ankaFpsLimit);
    });
};

window.addEventListener('anka-fps-limit-change', (event) => {
    const fps = event && event.detail ? event.detail.fps : 0;
    window.__ankaApplyFpsLimit(fps);
});

window.openPasswordManager = function () {
    let panel = document.getElementById('anka-password-manager');
    if (!panel) {
        const style = document.createElement('style');
        style.id = 'anka-password-manager-style';
        style.textContent = `
            #anka-password-manager{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.7);font:14px system-ui;color:var(--text-color,#f4f4f5)}
            #anka-password-manager[hidden]{display:none}
            #anka-password-manager .apm-card{width:min(680px,100%);max-height:92vh;overflow:auto;padding:22px;background:var(--bg-secondary,#1e1e25);border:1px solid var(--border-color,#333);border-radius:16px;box-shadow:0 20px 60px #0009}
            #anka-password-manager .apm-head,#anka-password-manager .apm-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
            #anka-password-manager .apm-head h2{margin:0;font-size:19px}
            #anka-password-manager .apm-intro{color:var(--text-secondary,#aaa);line-height:1.55}
            #anka-password-manager .apm-security{padding:10px 12px;border:1px solid var(--border-color,#333);border-radius:10px;background:var(--bg-primary,#121214);font-size:12px;line-height:1.5}
            #anka-password-manager .apm-status{min-height:22px;margin:10px 0;color:var(--text-secondary,#aaa)}
            #anka-password-manager .apm-list{max-height:210px;overflow:auto;margin:8px 0;padding:0 4px}
            #anka-password-manager .apm-row{padding:10px 4px;border-bottom:1px solid var(--border-color,#333)}
            #anka-password-manager .apm-row span{min-width:0;overflow-wrap:anywhere}
            #anka-password-manager .apm-row small{display:block;margin-top:3px;color:var(--text-secondary,#aaa)}
            #anka-password-manager button{min-height:40px;padding:7px 12px;border:1px solid var(--border-color,#444);border-radius:9px;color:inherit;background:var(--bg-tertiary,#292930);cursor:pointer}
            #anka-password-manager button:hover{border-color:var(--accent,#ff4757)}
            #anka-password-manager button:disabled{opacity:.55;cursor:wait}
            #anka-password-manager input{min-width:0;min-height:42px;padding:8px 11px;border:1px solid var(--border-color,#444);border-radius:9px;color:inherit;background:var(--input-bg,#111)}
            #anka-password-manager .apm-filter{display:flex;align-items:center;gap:8px}
            #anka-password-manager .apm-filter input{flex:1}
            #anka-password-manager .apm-fields{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border-color,#333)}
            #anka-password-manager .apm-fields>input:first-child{grid-column:1/-1}
            #anka-password-manager .apm-secret{display:flex;gap:8px;grid-column:1/-1}
            #anka-password-manager .apm-secret input{flex:1}
            #anka-password-manager .apm-strength{grid-column:1/-1;display:grid;grid-template-columns:1fr auto;align-items:center;gap:4px 10px;font-size:12px;color:var(--text-secondary,#aaa)}
            #anka-password-manager .apm-strength progress{grid-column:1/-1;width:100%;height:7px;accent-color:var(--apm-strength-color,#ef4444)}
            #anka-password-manager .apm-check-result{grid-column:1/-1;line-height:1.45}
            #anka-password-manager .apm-generator{grid-column:1/-1;display:flex;align-items:center;gap:10px}
            #anka-password-manager .apm-sets{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:6px 12px;padding:10px 0;border-top:1px solid var(--border-color,#333)}
            #anka-password-manager .apm-sets label{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
            #anka-password-manager .apm-sets input{width:16px;height:16px;accent-color:var(--accent,#ff4757);margin:0}
            #anka-password-manager .apm-generator input{flex:1;min-height:0;padding:0;accent-color:var(--accent,#ff4757)}
            #anka-password-manager .apm-generator output{min-width:28px;text-align:right;font-variant-numeric:tabular-nums}
            #anka-password-manager .apm-submit{grid-column:1/-1;background:var(--accent,#ff4757);color:#fff;font-weight:700}
            @media(max-width:560px){#anka-password-manager .apm-card{padding:16px}#anka-password-manager .apm-fields{grid-template-columns:1fr}#anka-password-manager .apm-fields>input:first-child,#anka-password-manager .apm-secret,#anka-password-manager .apm-strength,#anka-password-manager .apm-generator,#anka-password-manager .apm-submit{grid-column:auto}}
        `;
        document.head.appendChild(style);
        panel = document.createElement('section');
        panel.id = 'anka-password-manager';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Anka Web Parola Yöneticisi');
        panel.innerHTML = '<div class="apm-card"><div class="apm-head"><h2>Anka Web Parola Yöneticisi</h2><button type="button" data-apm-close aria-label="Kapat">Kapat</button></div><p class="apm-intro">Kayıtlı hesaplar bu cihazda şifreli saklanır. Sistem kimlik doğrulaması desteklenmediği için kayıtlı parolalar gösterilmez ve otomatik doldurulmaz.</p><div class="apm-security"><strong>Güvenlik denetimi</strong><br>Parola gücü, yaygın kullanım ve kayıtlar arasındaki tekrar yalnızca bu cihazdaki şifreli kayıtlarla kontrol edilir. Harici sızıntı veritabanı sorgusu yapılmaz.</div><div class="apm-status" role="status"></div><label class="apm-filter"><span>Hesaplarda ara</span><input type="search" data-apm-search placeholder="Site veya kullanıcı adı" autocomplete="off"></label><div class="apm-list"></div><form class="apm-fields"><input name="origin" type="url" required placeholder="https://ornek.com" autocomplete="url" aria-label="Site adresi"><input name="username" type="text" required maxlength="512" placeholder="Kullanıcı adı" autocomplete="username" aria-label="Kullanıcı adı"><div class="apm-secret"><input name="password" type="password" required maxlength="4096" placeholder="Parola" autocomplete="new-password" aria-label="Parola"><button type="button" data-apm-reveal aria-label="Parolayı göster">Göster</button></div><div class="apm-strength"><span data-apm-strength-label>Parola gücü</span><span data-apm-strength-score></span><progress data-apm-strength-meter max="4" value="0"></progress><span class="apm-check-result" data-apm-check-result>Parolanızı yazınca değerlendirme görünür.</span></div><div class="apm-sets"><label><input type="checkbox" data-apm-set="lower" checked> Küçük harf</label><label><input type="checkbox" data-apm-set="upper" checked> Büyük harf</label><label><input type="checkbox" data-apm-set="digit" checked> Rakam</label><label><input type="checkbox" data-apm-set="symbol" checked> Özel karakter</label></div><div class="apm-generator"><button type="button" data-apm-generate>Güçlü parola oluştur</button><input type="range" min="12" max="64" step="1" value="20" data-apm-length aria-label="Oluşturulacak parola uzunluğu"><output data-apm-length-output>20</output></div><button class="apm-submit" type="submit">Şifreli olarak kaydet</button></form></div>';
        document.body.appendChild(panel);
        const form = panel.querySelector('form');
        const passwordInput = form.querySelector('[name="password"]');
        const audit = panel.querySelector('[data-apm-check-result]');
        const meter = panel.querySelector('[data-apm-strength-meter]');
        const scoreLabel = panel.querySelector('[data-apm-strength-score]');
        const close = () => {
            panel.hidden = true;
            clearTimeout(auditTimer);
            auditSequence += 1;
            passwordInput.value = '';
            passwordInput.type = 'password';
            panel.querySelector('[data-apm-reveal]').textContent = 'Göster';
        };
        let auditTimer = 0;
        let auditSequence = 0;
        panel.querySelector('[data-apm-close]').addEventListener('click', close);
        panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
        panel.querySelector('[data-apm-reveal]').addEventListener('click', (event) => {
            const reveal = passwordInput.type === 'password';
            passwordInput.type = reveal ? 'text' : 'password';
            event.currentTarget.textContent = reveal ? 'Gizle' : 'Göster';
        });
        const length = panel.querySelector('[data-apm-length]');
        const lengthOutput = panel.querySelector('[data-apm-length-output]');
        length.addEventListener('input', () => { lengthOutput.value = length.value; });
        panel.querySelectorAll('[data-apm-set]').forEach((el) => el.addEventListener('change', () => {
    const btn = panel.querySelector('[data-apm-generate]');
    btn.disabled = !panel.querySelector('[data-apm-set]:checked');
}));
        const randomIndex = (maximum) => {
            const limit = Math.floor(256 / maximum) * maximum;
            const bytes = new Uint8Array(64);
            for (;;) {
                window.crypto.getRandomValues(bytes);
                for (const byte of bytes) if (byte < limit) return byte % maximum;
            }
        };
const APM_SETS = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digit: '23456789', symbol: '!@#$%&*+-_=.?' };
const selectedSets = () => Array.from(panel.querySelectorAll('[data-apm-set]:checked')).map((el) => APM_SETS[el.dataset.apmSet]).filter(Boolean);
const generatePassword = (size) => {
    const sets = selectedSets();
    if (!sets.length) { panel.querySelector('.apm-status').textContent = 'En az bir karakter türü seçin.'; return ''; }
    const realSize = Math.max(Number(size) || 20, sets.length);
    const alphabet = sets.join('');
    const characters = sets.map((set) => set[randomIndex(set.length)]);
    while (characters.length < realSize) characters.push(alphabet[randomIndex(alphabet.length)]);
    for (let index = characters.length - 1; index > 0; index -= 1) {
        const swap = randomIndex(index + 1);
        [characters[index], characters[swap]] = [characters[swap], characters[index]];
    }
    return characters.join('');
};
        panel.querySelector('[data-apm-generate]').addEventListener('click', () => {
            try {
                passwordInput.value = generatePassword(Number(length.value));
                passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
                passwordInput.focus();
            } catch (err) {
                console.error('Secure password generation failed:', err);
                panel.querySelector('.apm-status').textContent = 'Güvenli parola oluşturulamadı. Bu cihazın rastgele sayı desteğini kontrol edin.';
            }
        });
        const localPasswordCheck = (password) => {
    const warnings = [];
    const common = ['password','123456','12345678','qwerty','abc123','111111','letmein','welcome','admin','iloveyou','123456789'];
    const lower = /[a-z]/.test(password);
    const upper = /[A-Z]/.test(password);
    const digit = /[0-9]/.test(password);
    const symbol = /[^a-zA-Z0-9]/.test(password);
    let pool = 0;
    if (lower) pool += 25;
    if (upper) pool += 24;
    if (digit) pool += 10;
    if (symbol) pool += 20;
    const entropy = password.length * Math.log2(pool || 1);
    if (password.length < 8) warnings.push('weak');
    if (common.includes(password.toLowerCase())) warnings.push('common');
    if (/(.)\1{2,}/.test(password)) warnings.push('repeated');
    if (/(012|123|234|345|456|567|678|789|abc|bcd|cde)/i.test(password)) warnings.push('sequence');
    let score = entropy >= 100 ? 4 : entropy >= 80 ? 3 : entropy >= 60 ? 2 : entropy >= 40 ? 1 : 0;
    if (warnings.length) score = Math.min(score, 1);
    return { warnings, score, failed: false };
};

        const checkPassword = async () => {
            const applyCheckResult = (result, password) => {
    if (password !== passwordInput.value) return;
    const labels = { weak: 'Uzunluk veya çeşitlilik yetersiz', common: 'Yaygın parola', repeated: 'Tekrar eden karakterler', sequence: 'Sıralı dizi içeriyor', personal: 'Kullanıcı/site bilgisi içeriyor', reused: 'Başka bir kayıtla tekrar kullanılmış' };
    const warnings = (result.warnings || []).map((w) => labels[w] || w);
    const score = Math.max(0, Math.min(4, Number(result.score) || 0));
    meter.value = score;
    scoreLabel.textContent = ['Çok zayıf', 'Zayıf', 'Orta', 'İyi', 'Güçlü'][score];
    panel.style.setProperty('--apm-strength-color', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'][score]);
    audit.textContent = warnings.length ? warnings.join(' · ') : 'Belirgin bir zayıflık veya tekrar bulunmadı.';
};
            const sequence = ++auditSequence;
            const password = passwordInput.value;
            if (!password) {
                audit.textContent = 'Parolanızı yazınca değerlendirme görünür.';
                scoreLabel.textContent = '';
                meter.value = 0;
                return { warnings: [], failed: false };
            }
            audit.textContent = 'Parola değerlendiriliyor…';
            const ipc = ankaBridgeApi();
            const origin = String(form.querySelector('[name="origin"]').value || '');
            const username = String(form.querySelector('[name="username"]').value || '');
            try {
                if (!ipc || typeof ipc.invoke !== 'function') { const local = localPasswordCheck(password); applyCheckResult(local, password); return local; }
                const result = await ipc.invoke('password-manager:check', { origin, username, password });
                if (sequence !== auditSequence || passwordInput.value !== password) return { warnings: [], failed: false };
                if (!result || !result.ok || !Array.isArray(result.warnings) || !Number.isFinite(result.score)) {
                    throw new Error(result && result.error || 'password-check-failed');
                }
                const labels = {
                    weak: 'Uzunluk veya çeşitlilik yetersiz',
                    common: 'Yaygın parola',
                    personal: 'Kullanıcı/site bilgisi içeriyor',
                    reused: 'Başka bir kayıtla tekrar kullanılmış'
                };
                const warnings = result.warnings.map((warning) => labels[warning] || warning);
                const score = Math.max(0, Math.min(4, Number(result.score) || 0));
                meter.value = score;
                scoreLabel.textContent = ['Çok zayıf', 'Zayıf', 'Orta', 'İyi', 'Güçlü'][score];
                panel.style.setProperty('--apm-strength-color', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'][score]);
                audit.textContent = warnings.length ? warnings.join(' · ') : 'Belirgin bir zayıflık veya tekrar bulunmadı.';
                return { warnings, failed: false };
} catch (err) {
    console.error('Password safety check failed, yerel hesap kullanılıyor:', err);
    if (sequence !== auditSequence || passwordInput.value !== password) return { warnings: [], failed: false };
    const local = localPasswordCheck(password);
    applyCheckResult(local, password);
    return local;
}
        };
        passwordInput.addEventListener('input', () => {
            clearTimeout(auditTimer);
            auditTimer = setTimeout(checkPassword, 300);
        });
        const submitButton = form.querySelector('[type="submit"]');
        panel.querySelector('[data-apm-search]').addEventListener('input', (event) => {
            refreshPasswordManager(event.currentTarget.value);
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const status = panel.querySelector('.apm-status');
            const formData = new FormData(form);
            submitButton.disabled = true;
            form.querySelectorAll('input').forEach((input) => { input.disabled = true; });
            try {
                const ipc = ankaBridgeApi();
                clearTimeout(auditTimer);
                const inspection = await checkPassword();
                if (inspection.failed && !window.confirm('Parola güvenlik değerlendirmesi tamamlanamadı. Yine de kaydetmek istiyor musunuz?')) return;
                if (inspection.warnings.length && !window.confirm('Parola denetimi şu uyarıları verdi: ' + inspection.warnings.join(', ') + '. Yine de kaydetmek istiyor musunuz?')) return;
                const result = await ipc.invoke('password-manager:save', {
                    origin: String(formData.get('origin') || ''),
                    username: String(formData.get('username') || ''),
                    password: String(formData.get('password') || '')
                });
                status.textContent = result && result.ok ? 'Parola güvenli olarak kaydedildi.' :
                    result && result.error === 'secure-storage-unavailable' ? 'Bu cihazda güvenli parola deposu yok; parola kaydedilmedi.' :
                    'Parola kaydedilemedi. Site adresini ve alanları kontrol edin.';
                if (result && result.ok) {
                    form.reset();
                    passwordInput.type = 'password';
                    panel.querySelector('[data-apm-reveal]').textContent = 'Göster';
                    await refreshPasswordManager(panel.querySelector('[data-apm-search]').value);
                }
            } catch (err) {
                console.error('Password manager save failed:', err);
                status.textContent = 'Parola kaydedilemedi.';
            } finally {
                submitButton.disabled = false;
                form.querySelectorAll('input').forEach((input) => { input.disabled = false; });
            }
        });
        panel.querySelector('.apm-list').addEventListener('click', async (event) => {
            const button = event.target.closest('[data-apm-remove]');
            if (!button || !window.confirm('Bu kayıtlı parolayı silmek istiyor musunuz?')) return;
            const ipc = ankaBridgeApi();
            try {
                const result = await ipc.invoke('password-manager:remove', button.dataset.apmRemove);
                if (!result || !result.ok) throw new Error('Silme işlemi başarısız oldu.');
                await refreshPasswordManager();
            } catch (err) {
                console.error('Password manager delete failed:', err);
                panel.querySelector('.apm-status').textContent = 'Kayıt silinemedi.';
            }
        });
    }
    panel.hidden = false;
    const activeUrl = ankaActiveView() && ankaActiveView().getURL();
    try { panel.querySelector('[name="origin"]').value = new URL(activeUrl).origin; } catch (err) {}
    refreshPasswordManager(panel.querySelector('[data-apm-search]').value);
    panel.querySelector('[name="origin"]').focus();
};

window.showSiteInfo = function () {
    const st = ankaTabs.get(activeTabId);
    let url = '';
    try { url = st && st.vw ? st.vw.getURL() : st && st.url || ''; } catch (err) {}
    let parsed = null;
    try {
        parsed = new URL(url);
    } catch (err) {}
    const old = document.getElementById('anka-site-info-panel');
    if (old) { old.remove(); return; }
    if (!st) {
        showNotification('Site bilgisi alınamadı. Önce bir sekme açın.');
        return;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        const panel = document.createElement('section');
        panel.id = 'anka-site-info-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Site bilgisi');
        panel.style.cssText = 'position:fixed;z-index:2147482000;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 76px);overflow:auto;padding:16px;border:1px solid var(--border-color,#30323a);border-radius:14px;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);box-shadow:0 18px 50px #0008;font:inherit';
        const officialAnkaFile = parsed && parsed.protocol === 'file:' &&
            (ankaFileKey(url) === ankaFileKey(getNewTabUrl()) || ankaIsWelcomeUrl(url) || isErrorPageUrl(url));
        const title = document.createElement('strong');
        title.textContent = officialAnkaFile ? 'Anka Web’in resmi yerel dosyası' :
            parsed && parsed.protocol === 'file:' ? 'Yerel dosya' : 'Anka Web sayfası';
        title.style.cssText = 'display:block;font-size:15px;overflow-wrap:anywhere';
        const status = document.createElement('p');
        let filePath = '';
        if (parsed && parsed.protocol === 'file:') {
            try { filePath = decodeURIComponent(parsed.pathname); } catch (err) { filePath = parsed.pathname; }
        }
        status.textContent = officialAnkaFile
            ? 'Bu, Anka Web uygulamasının kendi yerel sayfasıdır.'
            : filePath
                ? 'Bu içerik cihazınızdaki yerel dosyadan açıldı: ' + filePath
            : 'Bu dahili sayfada siteye özel izinler kullanılamaz. Bir web sitesine geçtiğinizde bağlantı ve site ayarları burada görünür.';
        status.style.cssText = 'font-size:12px;line-height:1.55;overflow-wrap:anywhere;opacity:.82;margin:10px 0';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Kapat';
        close.style.cssText = 'min-height:40px;padding:0 14px;border:1px solid var(--border-color,#30323a);border-radius:8px;background:var(--input-bg,#111318);color:inherit;font:inherit;touch-action:manipulation';
        close.addEventListener('click', () => panel.remove());
        panel.append(title, status, close);
        document.body.append(panel);
        requestAnimationFrame(() => ankaPlaceToolbarPopover(panel, 'site-info-btn'));
        panel.addEventListener('pointerdown', (event) => event.stopPropagation());
        panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') panel.remove();
        });
        return;
    }
    const prefs = st.incognito ? {} : ankaReadSiteSettings(parsed.hostname);
    const panel = document.createElement('section');
    panel.id = 'anka-site-info-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Site ayarları');
    panel.style.cssText = 'position:fixed;z-index:2147482000;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 76px);overflow:auto;padding:16px;border:1px solid var(--border-color,#30323a);border-radius:14px;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);box-shadow:0 18px 50px #0008;font:inherit';
    const title = document.createElement('strong');
    title.textContent = parsed.hostname;
    title.style.cssText = 'display:block;font-size:15px;overflow-wrap:anywhere';
    const status = document.createElement('p');
    status.textContent = parsed.protocol === 'https:'
        ? 'HTTPS bağlantısı şifrelenmiştir; sitenin içeriğinin güvenilir olduğunu garanti etmez.'
        : 'HTTP bağlantısı şifrelenmez. Bu sitede parola veya hassas bilgi girmeyin.';
    status.style.cssText = 'font-size:12px;line-height:1.5;opacity:.72;margin:8px 0 14px';
    const makeToggle = (labelText, checked, onChange, disabled) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;border-top:1px solid var(--border-color,#30323a);font-size:13px';
        label.append(document.createTextNode(labelText));
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.disabled = !!disabled;
        input.style.cssText = 'width:22px;height:22px;accent-color:var(--accent,#ff4757);touch-action:manipulation';
        input.addEventListener('change', () => onChange(input));
        label.append(input);
        return label;
    };
    const javascript = makeToggle('JavaScript', prefs.javascript !== false, async (input) => {
        if (st.incognito) {
            input.checked = true;
            showNotification('Gizli sekmelerde site ayarı kaydedilmiyor.');
            return;
        }
        const allowed = await window.ankaConfirm('JavaScript ayarının uygulanması için sayfa yeniden yüklenecek. Form ve sayfa içi geçici durum kaybolabilir. Devam edilsin mi?', { title: 'Sayfayı yeniden yükle' });
        if (!allowed) { input.checked = !input.checked; return; }
        const next = ankaReadSiteSettings(parsed.hostname);
        next.javascript = input.checked;
        if (!ankaWriteSiteSettings(parsed.hostname, next)) {
            input.checked = !input.checked;
            showNotification('Site tercihi kaydedilemedi. Depolama alanınızı kontrol edin.');
            return;
        }
        try {
            if (st.vw) {
                ankaUnwireTabLoading(st, st.vw);
                st.vw.remove();
            }
        } catch (err) { console.error('Site ayarı uygulanamadı:', err); }
        st.vw = null;
        st.url = url;
        st.sleeping = true;
        panel.remove();
        switchTab(st.id);
    }, st.incognito);
    const media = makeToggle('Bu sekmenin sesini kapat', !!st.muted, (input) => {
        st.muted = input.checked;
        if (st.vw) {
            try { st.vw.setAudioMuted(st.muted); }
            catch (err) {
                input.checked = !st.muted;
                st.muted = !st.muted;
                console.error('Sekme sesi ayarlanamadı:', err);
                showNotification('Bu sekmenin sesi değiştirilemedi.');
                return;
            }
        }
        ankaUpdateMuteButton(st);
    }, false);
    const popups = makeToggle('Açılır pencereleri yeni sekmede aç', prefs.openPopups !== false, (input) => {
        if (st.incognito) {
            input.checked = true;
            showNotification('Gizli sekmelerde site ayarı kaydedilmiyor.');
            return;
        }
        const next = ankaReadSiteSettings(parsed.hostname);
        next.openPopups = input.checked;
        if (!ankaWriteSiteSettings(parsed.hostname, next)) {
            input.checked = !input.checked;
            showNotification('Site tercihi kaydedilemedi. Depolama alanınızı kontrol edin.');
        }
    }, st.incognito);
    const zoomLabel = document.createElement('label');
    zoomLabel.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;border-top:1px solid var(--border-color,#30323a);font-size:13px';
    zoomLabel.append(document.createTextNode('Bu site için yakınlaştırma'));
    const zoom = document.createElement('select');
    zoom.setAttribute('aria-label', 'Bu site için yakınlaştırma');
    zoom.style.cssText = 'max-width:125px;min-height:36px;padding:0 8px;border:1px solid var(--border-color,#30323a);border-radius:8px;background:var(--input-bg,#111318);color:inherit;font:inherit;touch-action:manipulation';
    const host = parsed.hostname.toLowerCase();
    const zoomMap = ankaRead('anka_zoom', {});
    const savedZoom = zoomMap && typeof zoomMap[host] === 'number' ? zoomMap[host] : null;
    const zoomValues = [
        { value: 'default', label: 'Varsayılan' },
        { value: '75', label: '75%' },
        { value: '90', label: '90%' },
        { value: '100', label: '100%' },
        { value: '110', label: '110%' },
        { value: '120', label: '120%' },
        { value: '125', label: '125%' },
        { value: '144', label: '144%' },
        { value: '150', label: '150%' }
    ];
    for (const optionData of zoomValues) {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.label;
        zoom.append(option);
    }
    zoom.value = savedZoom === null ? 'default' : String(Math.round(Math.pow(1.2, savedZoom) * 100));
    zoom.addEventListener('change', () => {
        const values = ankaRead('anka_zoom', {});
        if (zoom.value === 'default') delete values[host];
        else values[host] = Math.log(Number(zoom.value) / 100) / Math.log(1.2);
        if (!ankaWrite('anka_zoom', values)) {
            zoom.value = savedZoom === null ? 'default' : String(Math.round(Math.pow(1.2, savedZoom) * 100));
            showNotification('Site yakınlaştırması kaydedilemedi.');
            return;
        }
        if (st.vw) ankaApplyStoredZoom(st, st.vw);
    });
    zoomLabel.append(zoom);
    const dark = makeToggle('Bu sitede koyu görünüm', prefs.dark === true, (input) => {
        if (st.incognito) {
            input.checked = !input.checked;
            showNotification('Gizli sekmelerde site ayarı kaydedilmiyor.');
            return;
        }
        const next = ankaReadSiteSettings(parsed.hostname);
        next.dark = input.checked;
        if (!ankaWriteSiteSettings(parsed.hostname, next)) {
            input.checked = !input.checked;
            showNotification('Site tercihi kaydedilemedi. Depolama alanınızı kontrol edin.');
            return;
        }
        st.dark = input.checked;
        if (st.vw) {
            if (input.checked) ankaApplyDark(st, st.vw);
            else if (st.darkKey) {
                st.vw.removeInsertedCSS(st.darkKey).catch((err) => {
                    console.error('Koyu görünüm kapatılamadı:', err);
                    showNotification('Koyu görünüm kapatılamadı. Sayfayı yenilemeyi deneyin.');
                });
                st.darkKey = null;
            }
        }
    }, st.incognito);
    const privateNote = document.createElement('small');
    privateNote.textContent = st.incognito ? 'Gizli sekmede bu site tercihleri geçici ve kaydedilmez.' : 'JavaScript değişikliği bu sayfayı yeniden yükler.';
    privateNote.style.cssText = 'display:block;padding-top:10px;font-size:11px;opacity:.6';
    panel.append(title, status, javascript, dark, media, popups, zoomLabel, privateNote);
    document.body.append(panel);
    requestAnimationFrame(() => ankaPlaceToolbarPopover(panel, 'site-info-btn'));
    panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') panel.remove();
    });
};

async function refreshPasswordManager(query = '') {
    const panel = document.getElementById('anka-password-manager');
    if (!panel) return;
    const list = panel.querySelector('.apm-list');
    const status = panel.querySelector('.apm-status');
    list.replaceChildren();
    status.textContent = 'Şifreli kayıtlar yükleniyor…';
    try {
        const ipc = ankaBridgeApi();
        const result = ipc && await ipc.invoke('password-manager:list');
        if (!result || !result.ok) {
            status.textContent = result && result.error === 'secure-storage-unavailable'
                ? 'İşletim sisteminin güvenli parola deposu kullanılamıyor. Kayıtlar güvensiz biçimde saklanmadı.'
                : 'Kayıtlı parolalar açılamadı. Depo bozuk veya erişilemiyor olabilir.';
            return;
        }
        if (!Array.isArray(result.entries)) throw new Error('password-store-invalid');
        const normalizedQuery = String(query || '').trim().toLocaleLowerCase('tr-TR');
        const filtered = result.entries.filter((entry) =>
            !normalizedQuery || (entry.origin + ' ' + entry.username).toLocaleLowerCase('tr-TR').includes(normalizedQuery)
        );
        status.textContent = result.entries.length
            ? filtered.length + ' / ' + result.entries.length + ' şifreli hesap'
            : 'Henüz kayıtlı hesap yok.';
        const fragment = document.createDocumentFragment();
        filtered.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'apm-row';
            const info = document.createElement('span');
            info.textContent = entry.origin + ' · ' + entry.username;
            const updated = document.createElement('small');
            updated.textContent = Number.isFinite(entry.updatedAt) && entry.updatedAt > 0
                ? 'Güncellendi: ' + new Date(entry.updatedAt).toLocaleString('tr-TR')
                : 'Güncelleme zamanı bilinmiyor';
            info.appendChild(updated);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.dataset.apmRemove = entry.id;
            remove.textContent = 'Sil';
            row.append(info, remove);
            fragment.appendChild(row);
        });
        if (result.entries.length && !filtered.length) {
            const empty = document.createElement('p');
            empty.className = 'apm-empty';
            empty.textContent = 'Bu aramayla eşleşen hesap bulunamadı.';
            fragment.appendChild(empty);
        }
        list.replaceChildren(fragment);
    } catch (err) {
        console.error('Password manager list failed:', err);
        status.textContent = 'Kayıtlı parolalar açılamadı.';
    }
}

function ankaShowLinkStatus(text) {
    let box = ankaById('anka-link-status');
    if (!box) {
        box = ankaMk('div', { id: 'anka-link-status', className: 'anka-link-status' });
        box.hidden = true;
        document.body.append(box);
    }
    box.textContent = text || '';
    box.hidden = !text;
}

function applyMandatorySecurity(vw) {
    if (!vw || vw.__ankaSecured) return;
    vw.__ankaSecured = true;
    if (!vw.__ankaNonce) vw.__ankaNonce = ankaNonce();

    if (typeof vw.addEventListener === 'function') {
        const guard = (e) => {
            if (!e || !e.url || e.isMainFrame === false) return;
            checkUrlSecurity(e.url, vw);
        };

        vw.addEventListener('will-navigate', guard);
        vw.addEventListener('did-start-navigation', guard);
        vw.addEventListener('did-redirect-navigation', guard);
        vw.addEventListener('did-navigate', guard);
        vw.addEventListener('did-navigate-in-page', guard);

        vw.addEventListener('new-window', (e) => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (!e || !e.url) return;
            let currentUrl = '';
            try { currentUrl = vw.getURL(); } catch (err) {}
            const preferences = ankaReadSiteSettingsForUrl(currentUrl);
            if (preferences.openPopups === false) {
                showNotification('Bu site için açılır pencereler engellendi.');
                return;
            }
            createNewTab(e.url);
        });

        vw.addEventListener('dom-ready', () => {
            vw.__ankaReady = true;
            try {
                if (typeof vw.getURL === 'function') checkUrlSecurity(vw.getURL(), vw);
                injectForcedRestrictions(vw);
                ankaSetupPasswordManager(vw);
            } catch (err) {
                console.error('Sekme güvenlik ayarları uygulanamadı:', err);
            }
            ankaFpsLimit = [0, 30, 45, 60, 90, 120].includes(Number(getSetting('fps-limit', '0')))
                ? Number(getSetting('fps-limit', '0'))
                : 0;
            ankaApplyFpsLimitToView(vw, ankaFpsLimit);
        });

        vw.addEventListener('console-message', (e) => {
            if (e && typeof e.message === 'string' && e.message.charCodeAt(0) === 97) ankaHandleBridge(vw, e.message);
        });

        vw.addEventListener('did-fail-load', (e) => {
            if (!e || e.errorCode === -3 || e.isMainFrame === false) return;
            if (isErrorPageUrl(e.validatedURL || vw.getURL())) return;
            if (vw.__ankaUpgraded && e.validatedURL === vw.__ankaUpgraded) {
                vw.__ankaUpgraded = '';
            }
            const failedUrl = e.validatedURL || st.url || '';
            const errorUrl = getErrorPageUrl(failedUrl, e.errorCode);
            if (errorUrl && vw.isConnected) {
                ankaLoad(vw, errorUrl);
                return;
            }
            showNotification('Sayfa açılamadı. Bağlantınızı ve adresi kontrol edip yeniden deneyin.');
        });
    }

    if (typeof setupDownloadHandling === 'function') {
        try { setupDownloadHandling(vw); } catch (err) {}
    }
}

function ankaInjectStyles() {
    if (!document.head || document.getElementById('anka-browser-styles')) return;
    const style = document.createElement('style');
    style.id = 'anka-browser-styles';
    style.textContent = `
    :root {
        --anka-z-tabs: 500;
        --anka-z-toolbar: 600;
        --anka-z-dropdown: 1500;
        --anka-z-context: 3000000;
        --anka-z-preview: 3000001;
        --anka-z-suggest: 3000002;
        --anka-z-findbar: 3000003;
        --anka-z-side: 3000004;
        --anka-z-overlay: 3000005;
        --anka-z-toast: 3000006;
        --anka-z-link: 3000007;
        --anka-ease: cubic-bezier(.16,1,.3,1);
        --anka-radius: 10px;
        --anka-radius-lg: 14px;
        --anka-shadow-sm: 0 4px 14px rgba(0,0,0,.22);
        --anka-shadow-md: 0 10px 30px rgba(0,0,0,.32);
        --anka-shadow-lg: 0 24px 60px rgba(0,0,0,.45);
        --anka-border: var(--border-color, #27272a);
        --anka-surface: var(--bg-secondary, #18181b);
        --anka-surface-2: var(--bg-tertiary, #27272a);
        --anka-surface-3: var(--bg-elevated, #3f3f46);
        --anka-text: var(--text-color, #f4f4f5);
        --anka-text-soft: var(--text-secondary, #a1a1aa);
        --anka-accent: var(--accent, #ff4757);
        --anka-danger: #ef4444;
        --anka-danger-soft: rgba(239,68,68,.16);
        --anka-success: #22c55e;
        --anka-warn: #f59e0b;
    }

    #custom-context-menu {
        position: fixed;
        background: var(--anka-surface);
        color: var(--anka-text);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        padding: 6px;
        min-width: 220px;
        max-width: min(340px, calc(100vw - 16px));
        max-height: calc(100dvh - 16px);
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        z-index: var(--anka-z-context);
        box-shadow: var(--anka-shadow-lg);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
        font-size: 12.5px;
        opacity: 0;
        transform: scale(.94) translateY(-4px);
        transform-origin: top left;
        transition: opacity .12s ease, transform .12s var(--anka-ease);
        pointer-events: none;
        will-change: transform, opacity;
        scrollbar-width: thin;
    }
    #custom-context-menu.show { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }
    #custom-context-menu.hiding { opacity: 0; transform: scale(.96); pointer-events: none; }

    #custom-context-submenu {
        position: fixed;
        background: var(--anka-surface);
        color: var(--anka-text);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        padding: 6px;
        min-width: 200px;
        max-height: calc(100dvh - 16px);
        overflow-y: auto;
        overscroll-behavior: contain;
        z-index: calc(var(--anka-z-context) + 1);
        box-shadow: var(--anka-shadow-lg);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
        font-size: 12.5px;
        opacity: 0;
        transform: scale(.94);
        transform-origin: top left;
        transition: opacity .1s ease, transform .1s ease;
        pointer-events: none;
        scrollbar-width: thin;
    }
    #custom-context-submenu.show { opacity: 1; transform: scale(1); pointer-events: auto; }

    .ctx-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 8px 12px;
        font-size: 12.5px;
        line-height: 1.35;
        font-weight: 500;
        color: var(--anka-text);
        border-radius: 7px;
        cursor: pointer;
        white-space: normal;
        overflow-wrap: anywhere;
        user-select: none;
        transition: background .08s ease, color .08s ease;
        outline: none;
    }
    .ctx-item:hover, .ctx-item.kbd, .ctx-item:focus-visible { background: var(--anka-surface-2); }
    .ctx-item:active { background: var(--anka-surface-3); }
    .ctx-item.disabled { color: var(--anka-text-soft); cursor: default; opacity: .55; }
    .ctx-item.disabled:hover { background: transparent; }
    .ctx-item.ctx-danger { color: #fca5a5; }
    .ctx-item.ctx-danger:hover, .ctx-item.ctx-danger.kbd { background: var(--anka-danger-soft); color: #fecaca; }
    .ctx-shortcut { font-size: 11px; color: var(--anka-text-soft); margin-left: 18px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .ctx-arrow { font-size: 10px; color: var(--anka-text-soft); margin-left: 8px; flex-shrink: 0; }
    .ctx-sep { height: 1px; background: var(--anka-border); margin: 4px 6px; }

    #anka-side-devtools {
        position: fixed;
        top: 42px;
        right: -50%;
        left: -50%;
        width: 45%;
        min-width: min(340px, 100vw);
        max-width: 780px;
        height: calc(100% - 42px);
        max-height: calc(100% - 42px);
        background: var(--anka-surface);
        color: var(--anka-text);
        border-left: 1px solid var(--anka-border);
        z-index: var(--anka-z-side);
        box-shadow: -10px 0 30px rgba(0,0,0,.5);
        display: flex;
        flex-direction: column;
        transition: right .2s ease, left .2s ease;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
    }
    #anka-side-devtools.open { right: 0; left: auto; }
    #anka-side-devtools.open.open-left { left: 0; right: auto; border-left: 0; border-right: 1px solid var(--anka-border); box-shadow: 10px 0 30px rgba(0,0,0,.5); }
    .side-dt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: var(--anka-surface-2);
        padding: 10px 12px;
        border-bottom: 1px solid var(--anka-border);
        font-size: 13px;
        font-weight: 600;
    }
    .side-dt-actions { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .side-dt-close {
        cursor: pointer;
        min-height: 30px;
        padding: 4px 10px;
        border: 1px solid var(--anka-border);
        border-radius: 6px;
        background: transparent;
        color: var(--anka-text);
        font-family: inherit;
        font-size: 11.5px;
        font-weight: 600;
        transition: background .1s ease, color .1s ease, border-color .1s ease;
    }
    .side-dt-close:hover { background: var(--anka-surface-3); border-color: var(--anka-text-soft); }
    .side-dt-close.danger { color: #fca5a5; }
    .side-dt-close.danger:hover { background: var(--anka-danger-soft); border-color: var(--anka-danger); color: #fecaca; }
    #side-dt-search {
        flex: 0 0 auto;
        margin: 8px;
        height: 34px;
        padding: 0 12px;
        color: var(--anka-text);
        background: var(--anka-surface-2);
        border: 1px solid var(--anka-border);
        border-radius: 8px;
        font: inherit;
        font-size: 12.5px;
        outline: none;
    }
    #side-dt-search:focus { border-color: var(--anka-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anka-accent) 18%, transparent); }
    .side-dt-content {
        flex: 1;
        min-height: 0;
        overflow: auto;
        margin: 0;
        padding: 12px;
        color: var(--anka-text);
        font: 12px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        tab-size: 2;
        scrollbar-width: thin;
    }
    .side-dt-content mark { color: inherit; background: color-mix(in srgb, var(--anka-accent) 38%, transparent); border-radius: 2px; padding: 0 1px; }

    .anka-pinned-fallback {
        position: fixed;
        top: 0;
        right: 0;
        width: min(440px, 92vw);
        height: 100%;
        display: none;
        flex-direction: column;
        background: var(--anka-surface);
        color: var(--anka-text);
        border-left: 1px solid var(--anka-border);
        z-index: var(--anka-z-side);
        box-shadow: var(--anka-shadow-lg);
    }
    .anka-pinned-fallback.open { display: flex; }

    .anka-find-bar {
        position: fixed;
        top: calc(var(--titlebar-h, 42px) + var(--toolbar-h, 52px) + 8px);
        right: 12px;
        background: var(--anka-surface);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        padding: 6px 8px;
        display: flex;
        gap: 4px;
        align-items: center;
        z-index: var(--anka-z-findbar);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
        box-shadow: var(--anka-shadow-md);
        flex-wrap: wrap;
        max-width: calc(100vw - 24px);
        max-height: calc(100dvh - var(--titlebar-h, 42px) - var(--toolbar-h, 52px) - 24px);
        overflow: auto;
    }
    .anka-find-bar input {
        background: var(--anka-surface-2);
        border: 1px solid var(--anka-border);
        border-radius: 6px;
        color: var(--anka-text);
        padding: 5px 9px;
        font-size: 12.5px;
        outline: none;
        min-width: 160px;
        font-family: inherit;
    }
    .anka-find-bar input:focus { border-color: var(--anka-accent); }
    .anka-find-bar button {
        background: var(--anka-surface-2);
        border: 1px solid transparent;
        color: var(--anka-text);
        border-radius: 6px;
        padding: 5px 9px;
        cursor: pointer;
        font-size: 11.5px;
        font-family: inherit;
        font-weight: 600;
        transition: background .1s ease, color .1s ease, border-color .1s ease;
    }
    .anka-find-bar button:hover { background: var(--anka-surface-3); }
    .anka-find-bar button.on { background: var(--anka-accent); color: #fff; border-color: var(--anka-accent); }
    .anka-find-bar button.danger { color: #fca5a5; }
    .anka-find-bar button.danger:hover { background: var(--anka-danger-soft); color: #fecaca; }
    .anka-find-count { color: var(--anka-text-soft); font-size: 11px; min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }

    .anka-tab-preview {
        position: fixed;
        z-index: var(--anka-z-preview);
        width: 300px;
        padding: 10px;
        background: var(--anka-surface);
        color: var(--anka-text);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        box-shadow: var(--anka-shadow-md);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
        font-size: 12px;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity .12s ease, transform .12s ease;
    }
    .anka-tab-preview:not([hidden]) { opacity: 1; transform: translateY(0); }
    .anka-tab-preview[hidden] { display: none; }
    .anka-tab-preview-img { width: 100%; height: auto; border-radius: 6px; margin-bottom: 8px; display: block; background: var(--anka-surface-2); }
    .anka-tab-preview-title { font-weight: 700; font-size: 12.5px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .anka-tab-preview-url { font-size: 11px; color: var(--anka-text-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .anka-cmd-overlay { align-items: flex-start; padding-top: 10vh; }
    .anka-cmd-panel {
        width: min(640px, 92vw);
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--anka-surface);
        color: var(--anka-text);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius-lg);
        box-shadow: var(--anka-shadow-lg);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
    }
    .anka-cmd-input {
        margin: 12px;
        height: 46px;
        padding: 0 14px;
        background: var(--anka-surface-2);
        color: inherit;
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        font: inherit;
        font-size: 14px;
        outline: none;
    }
    .anka-cmd-input:focus { border-color: var(--anka-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anka-accent) 16%, transparent); }
    .anka-cmd-list { flex: 1; overflow-y: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 2px; overscroll-behavior: contain; scrollbar-width: thin; }
    .anka-cmd-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: background-color .08s ease;
        outline: none;
    }
    .anka-cmd-row:hover, .anka-cmd-row.active { background: var(--anka-surface-2); }
    .anka-cmd-row.active { background: color-mix(in srgb, var(--anka-accent) 18%, var(--anka-surface-2)); }
    .anka-cmd-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .anka-cmd-row-label { font-size: 13px; font-weight: 600; }
    .anka-cmd-row-desc { font-size: 11px; color: var(--anka-text-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .anka-cmd-shortcut {
        font-size: 11px;
        color: var(--anka-text-soft);
        background: var(--anka-surface-2);
        border: 1px solid var(--anka-border);
        padding: 2px 7px;
        border-radius: 5px;
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        white-space: nowrap;
    }
    .anka-cmd-empty { padding: 28px; text-align: center; color: var(--anka-text-soft); font-size: 13px; }

    .tab-group-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; flex-shrink: 0; }

    .anka-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--anka-z-overlay);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 8vh 16px 16px;
        background: rgba(8,12,14,.62);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    }
    .anka-panel {
        width: min(720px, 100%);
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: var(--anka-text);
        background: var(--anka-surface);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius-lg);
        box-shadow: var(--anka-shadow-lg);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
    }
    .anka-panel.wide { width: min(920px, 100%); }
    .anka-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 20px;
        border-bottom: 1px solid var(--anka-border);
    }
    .anka-panel-head h2 { margin: 3px 0 0; font-size: 18px; font-weight: 700; }
    .anka-kicker { color: var(--anka-accent); font-size: 10px; font-weight: 800; letter-spacing: 1px; }
    .anka-icon-btn, .session-icon-button {
        width: 40px;
        height: 40px;
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        background: var(--anka-surface-2);
        color: var(--anka-text);
        font-size: 16px;
        cursor: pointer;
        touch-action: manipulation;
        transition: background .1s ease, color .1s ease, border-color .1s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .anka-icon-btn:hover, .session-icon-button:hover { background: var(--anka-surface-3); }
    .anka-icon-btn.danger, .session-icon-button.danger { color: #fca5a5; }
    .anka-icon-btn.danger:hover, .session-icon-button.danger:hover { background: var(--anka-danger-soft); border-color: var(--anka-danger); color: #fecaca; }
    .anka-search {
        margin: 12px 20px 4px;
        height: 42px;
        padding: 0 12px;
        color: inherit;
        background: var(--anka-surface-2);
        border: 1px solid var(--anka-border);
        border-radius: 8px;
        font: inherit;
        outline: none;
    }
    .anka-search:focus { border-color: var(--anka-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anka-accent) 14%, transparent); }
    .anka-list { display: grid; gap: 4px; padding: 8px 20px 16px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .anka-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: background .08s ease;
        outline: none;
    }
    .anka-row:hover, .anka-row.active, .anka-row:focus-visible { background: var(--anka-surface-2); }
    .anka-row.active { background: color-mix(in srgb, var(--anka-accent) 14%, var(--anka-surface-2)); }
    .anka-row-main { flex: 1; min-width: 0; }
    .anka-row-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .anka-row-url, .anka-row-meta { font-size: 11px; color: var(--anka-text-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .anka-row-del {
        border: 1px solid transparent;
        background: transparent;
        color: #fca5a5;
        cursor: pointer;
        padding: 4px 9px;
        border-radius: 6px;
        font-size: 12px;
        transition: background .1s ease, border-color .1s ease, color .1s ease;
    }
    .anka-row-del:hover { background: var(--anka-danger-soft); border-color: var(--anka-danger); color: #fecaca; }
    .anka-empty { padding: 28px 14px; text-align: center; color: var(--anka-text-soft); }
    .anka-panel-foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--anka-border); }

    .anka-suggest {
        position: fixed;
        z-index: var(--anka-z-suggest);
        max-height: 320px;
        overflow: auto;
        padding: 6px;
        color: var(--anka-text);
        background: var(--anka-surface);
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        box-shadow: var(--anka-shadow-lg);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
        scrollbar-width: thin;
    }
    .anka-suggest[hidden] { display: none; }
    .anka-suggest-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 7px;
        cursor: pointer;
        font-size: 12.5px;
        transition: background .08s ease;
    }
    .anka-suggest-row:hover, .anka-suggest-row.active { background: var(--anka-surface-2); }
    .anka-suggest-kind { width: 16px; text-align: center; flex: none; color: var(--anka-accent); font-weight: 700; }
    .anka-suggest-title { font-weight: 600; white-space: nowrap; }
    .anka-suggest-url { color: var(--anka-text-soft); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

    .anka-link-status {
        position: fixed;
        left: 12px;
        bottom: 12px;
        max-width: 70vw;
        padding: 5px 12px;
        font: 12px system-ui, sans-serif;
        color: var(--anka-text);
        background: var(--anka-surface);
        border: 1px solid var(--anka-border);
        border-radius: 7px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: var(--anka-z-link);
        pointer-events: none;
        box-shadow: var(--anka-shadow-sm);
    }
    .anka-link-status[hidden] { display: none; }

    .tab.loading .tab-icon { animation: ankaPulse 1s ease-in-out infinite; }
    .tab.sleeping { opacity: 0.55; }
    .tab.crashed { box-shadow: inset 0 -2px 0 var(--anka-danger); }
    .tab.dragging { opacity: 0.4; }
    .tab.pinned { max-width: 44px; min-width: 44px; justify-content: center; }
    .tab.pinned .tab-title, .tab.pinned .close-tab, .tab.pinned .tab-memory { display: none; }
    @keyframes ankaPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

    .session-save-form { display: grid; gap: 9px; padding: 16px 20px; border-bottom: 1px solid var(--anka-border); }
    .session-save-form label { color: var(--anka-text-soft); font-size: 12px; }
    .session-save-row { display: flex; gap: 8px; }
    .session-save-row input, .session-url-input {
        min-width: 0;
        width: 100%;
        height: 42px;
        padding: 0 12px;
        color: inherit;
        background: var(--anka-surface-2);
        border: 1px solid var(--anka-border);
        border-radius: 8px;
        font: inherit;
        outline: none;
    }
    .session-save-row input:focus, .session-url-input:focus { border-color: var(--anka-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anka-accent) 14%, transparent); }
    .session-primary, .session-secondary, .session-danger {
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--anka-border);
        border-radius: 8px;
        background: var(--anka-surface-2);
        color: var(--anka-text);
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        touch-action: manipulation;
        transition: background .1s ease, color .1s ease, border-color .1s ease, filter .1s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }
    .session-primary { flex-shrink: 0; border-color: var(--anka-accent); background: var(--anka-accent); color: #fff; }
    .session-primary:hover { filter: brightness(1.08); }
    .session-secondary:hover { background: var(--anka-surface-3); }
    .session-danger { color: #fca5a5; border-color: var(--anka-border); }
    .session-danger:hover { background: var(--anka-danger); border-color: var(--anka-danger); color: #fff; }
    .session-manager-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; color: var(--anka-text-soft); font-size: 12px; }
    .session-list { display: grid; gap: 12px; padding: 0 20px 20px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .session-empty { padding: 28px 14px; text-align: center; color: var(--anka-text-soft); border: 1px dashed var(--anka-border); border-radius: 10px; }
    .session-card {
        display: grid;
        gap: 10px;
        padding: 14px;
        border: 1px solid var(--anka-border);
        border-radius: var(--anka-radius);
        background: var(--anka-surface-2);
        transition: border-color .15s ease;
    }
    .session-card:hover { border-color: var(--anka-text-soft); }
    .session-card-head, .session-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .session-name-input {
        flex: 1;
        min-width: 0;
        height: 40px;
        padding: 0 10px;
        color: inherit;
        background: var(--anka-surface);
        border: 1px solid var(--anka-border);
        border-radius: 7px;
        font: inherit;
        font-weight: 700;
        outline: none;
    }
    .session-name-input:focus { border-color: var(--anka-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anka-accent) 14%, transparent); }
    .session-card-meta { color: var(--anka-text-soft); font-size: 11px; }
    .session-url-list { display: grid; gap: 6px; }
    .session-url-row, .session-add-url { display: flex; gap: 6px; }
    .session-url-row .session-icon-button { flex: 0 0 40px; }

    #anka-toast-stack { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: var(--anka-z-toast); pointer-events: none; }
    .anka-toast { background: var(--anka-surface); color: var(--anka-text); border: 1px solid var(--anka-border); padding: 10px 16px; border-radius: 10px; box-shadow: var(--anka-shadow-md); font: 12.5px system-ui, sans-serif; opacity: 0; transform: translateY(8px); transition: opacity .2s ease, transform .2s ease; max-width: 90vw; text-align: center; }
    .anka-toast.visible { opacity: 1; transform: translateY(0); }
    .anka-toast.error { border-color: var(--anka-danger); color: #fecaca; }
    .anka-toast.success { border-color: var(--anka-success); color: #bbf7d0; }

    @media (max-width: 650px) {
        .anka-panel-head, .session-save-form, .session-manager-toolbar { padding-left: 14px; padding-right: 14px; }
        .session-list { padding: 0 14px 14px; }
        .session-save-row, .session-card-head, .session-actions { flex-wrap: wrap; }
        .session-actions > button { flex: 1; }
        .anka-find-bar input { min-width: 120px; }
        #anka-side-devtools { width: 92vw; min-width: 0; right: -100%; left: -100%; }
        #anka-side-devtools.open { right: 0; }
        #anka-side-devtools.open.open-left { left: 0; right: auto; }
    }
    @media (pointer: coarse) {
        #custom-context-menu { min-width: 260px; padding: 8px; }
        .ctx-item { min-height: 46px; padding: 10px 12px; font-size: 14px; }
        .anka-icon-btn, .session-icon-button, .session-primary, .session-secondary, .session-danger { min-height: 46px; }
    }
    @media (prefers-reduced-motion: reduce) {
        #custom-context-menu, #custom-context-submenu, .anka-tab-preview, .anka-toast, #anka-side-devtools { transition: none; }
    }
    .anka-cqa-overlay{position:fixed;inset:0;z-index:var(--anka-z-overlay);background:rgba(0,0,0,.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);opacity:0;transition:opacity .2s ease;display:flex}
    .anka-cqa-overlay.open{opacity:1}
    .anka-cqa-panel{width:min(340px,88vw);height:100%;display:flex;flex-direction:column;background:var(--anka-surface);border-right:1px solid var(--anka-border);color:var(--anka-text);box-shadow:12px 0 40px rgba(0,0,0,.35);transform:translateX(-100%);transition:transform .24s cubic-bezier(.2,.7,.2,1);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:6px 8px}
    .anka-cqa-overlay.open .anka-cqa-panel{transform:translateX(0)}
    .anka-cqa-header{display:flex;align-items:center;gap:10px;padding:12px 10px;border-bottom:1px solid var(--anka-border);margin-bottom:6px}
    .anka-cqa-logo{width:30px;height:30px;object-fit:contain}
    .anka-cqa-title{font-weight:700;font-size:14px;letter-spacing:-.01em}
    .anka-cqa-item{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:8px;cursor:pointer;color:inherit;font-size:13px;font-weight:550;border:none;background:transparent;text-align:left;width:100%;position:relative;transition:background .1s ease}
    .anka-cqa-item:hover,.anka-cqa-item.active{background:var(--anka-surface-2)}
    .anka-cqa-icon{flex:0 0 22px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:var(--anka-surface-2);color:var(--anka-accent);font-size:12px;font-weight:700;transition:background .1s ease,color .1s ease}
    .anka-cqa-item:hover .anka-cqa-icon{background:var(--anka-accent);color:#fff}
    .anka-cqa-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .anka-cqa-item.has-submenu::after{content:'▸';color:var(--anka-text-soft);font-size:11px;flex:none;margin-left:4px}
    .anka-cqa-sep{height:1px;background:var(--anka-border);margin:6px 4px}
    .anka-cqa-submenu{position:fixed;z-index:calc(var(--anka-z-overlay) + 1);width:min(400px,80vw);max-height:min(560px,80vh);display:flex;flex-direction:column;background:var(--anka-surface);color:var(--anka-text);border:1px solid var(--anka-border);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.45);overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transform:translateX(-6px);transition:opacity .14s ease,transform .14s ease;pointer-events:none}
    .anka-cqa-submenu.show{opacity:1;transform:translateX(0);pointer-events:auto}
    .anka-cqa-submenu-header{padding:12px 16px;border-bottom:1px solid var(--anka-border);display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700}
    .anka-cqa-submenu-list{padding:6px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px}
    .anka-cqa-submenu-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;cursor:pointer;color:inherit;font-size:12.5px;text-align:left;border:none;background:transparent;width:100%;transition:background .1s ease}
    .anka-cqa-submenu-item:hover{background:var(--anka-surface-2)}
    .anka-cqa-submenu-fav{width:18px;height:18px;flex:none;object-fit:contain;border-radius:3px;background:var(--anka-surface-2)}
    .anka-cqa-submenu-main{flex:1;min-width:0}
    .anka-cqa-submenu-main strong{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
    .anka-cqa-submenu-main small{display:block;color:var(--anka-text-soft);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .anka-cqa-submenu-empty{padding:24px 16px;text-align:center;color:var(--anka-text-soft);font-size:12.5px}
    .anka-cqa-submenu-foot{padding:8px 12px;border-top:1px solid var(--anka-border);display:flex;justify-content:flex-end}
    .anka-cqa-submenu-foot button{background:var(--anka-accent);border:none;color:#fff;padding:6px 12px;border-radius:7px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
    .anka-cqa-submenu-foot button:hover{filter:brightness(1.08)}
    @media(max-width:520px){.anka-cqa-submenu{width:calc(100vw - 24px);left:12px!important;top:auto!important;bottom:12px!important;max-height:60vh}}
    @media (prefers-reduced-motion:reduce){.anka-cqa-overlay,.anka-cqa-panel,.anka-cqa-submenu{transition:none}}
`;
    document.head.appendChild(style);
}

ankaInjectStyles();

let ankaMenuKeyHandler = null;
let ankaSubmenuEl = null;

function ankaDetachMenuKeys() {
    if (ankaMenuKeyHandler) {
        document.removeEventListener('keydown', ankaMenuKeyHandler, true);
        ankaMenuKeyHandler = null;
    }
}

function closeSubmenu() {
    if (ankaSubmenuEl) {
        ankaSubmenuEl.remove();
        ankaSubmenuEl = null;
    }
}

function closeContextMenu() {
    if (window.AnkaRightClick) window.AnkaRightClick.deactivate('browser-context-menu');
    ankaDetachMenuKeys();
    closeSubmenu();
    const menu = document.getElementById('custom-context-menu');
    if (!menu || menu.classList.contains('hiding')) return;
    menu.classList.remove('show');
    menu.classList.add('hiding');
    setTimeout(() => menu.remove(), 80);
}

function showContextSubmenu(anchorRow, items, parentRect) {
    closeSubmenu();
    const sub = ankaMk('div', { id: 'custom-context-submenu', role: 'menu' });
    const cleaned = [];
    items.forEach((it) => {
        if (it === '---' && (!cleaned.length || cleaned[cleaned.length - 1] === '---')) return;
        cleaned.push(it);
    });
    while (cleaned.length && cleaned[cleaned.length - 1] === '---') cleaned.pop();
    cleaned.forEach((it) => {
        if (it === '---') {
            sub.appendChild(ankaMk('div', { className: 'ctx-sep' }));
            return;
        }
        const row = ankaMk('div', { className: 'ctx-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' ctx-danger' : ''), role: 'menuitem' }, ankaMk('span', { text: it.label }));
        if (it.shortcut) row.append(ankaMk('span', { className: 'ctx-shortcut', text: it.shortcut }));
        if (!it.disabled) {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                closeSubmenu();
                closeContextMenu();
                if (it.action) it.action();
            });
        }
        sub.appendChild(row);
    });
    document.body.appendChild(sub);
    const r = anchorRow.getBoundingClientRect();
    const pr = parentRect || { right: window.innerWidth, top: 0, left: 0 };
    const sw = sub.offsetWidth;
    const sh = sub.offsetHeight;
    let left = pr.right + 4;
    if (left + sw > window.innerWidth - 8) left = pr.left - sw - 4;
    if (left < 8) left = 8;
    let top = r.top;
    if (top + sh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - sh - 8);
    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
    ankaSubmenuEl = sub;
    requestAnimationFrame(() => sub.classList.add('show'));
}

function showContextMenu(x, y, items) {
    ankaDetachMenuKeys();
    closeSubmenu();
    const existing = document.getElementById('custom-context-menu');
    if (existing) existing.remove();

    const cleaned = [];
    items.forEach((it) => {
        if (it === '---' && (!cleaned.length || cleaned[cleaned.length - 1] === '---')) return;
        cleaned.push(it);
    });
    while (cleaned.length && cleaned[cleaned.length - 1] === '---') cleaned.pop();

    const menu = ankaMk('div', { id: 'custom-context-menu', role: 'menu' });
    const frag = document.createDocumentFragment();
    cleaned.forEach((it) => {
        if (it === '---') {
            frag.appendChild(ankaMk('div', { className: 'ctx-sep' }));
            return;
        }
        const row = ankaMk('div', { className: 'ctx-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' ctx-danger' : ''), role: 'menuitem' }, ankaMk('span', { text: it.label }));
        if (it.shortcut) row.append(ankaMk('span', { className: 'ctx-shortcut', text: it.shortcut }));
        if (it.submenu && !it.disabled) {
            row.append(ankaMk('span', { className: 'ctx-arrow', text: '▸' }));
            row.addEventListener('mouseenter', () => {
                const mr = menu.getBoundingClientRect();
                showContextSubmenu(row, it.submenu, mr);
            });
            row.addEventListener('mouseleave', (e) => {
                if (!ankaSubmenuEl) return;
                const to = e.relatedTarget;
                if (to && ankaSubmenuEl.contains(to)) return;
                setTimeout(() => { if (ankaSubmenuEl && !ankaSubmenuEl.matches(':hover')) closeSubmenu(); }, 150);
            });
        } else if (!it.disabled) {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                closeContextMenu();
                if (it.action) it.action();
            });
        }
        frag.appendChild(row);
    });
    menu.appendChild(frag);
    document.body.appendChild(menu);
    if (window.AnkaRightClick) {
        window.AnkaRightClick.register('browser-context-menu', {
            panel: menu,
            extraSurfaces: () => ankaSubmenuEl ? [ankaSubmenuEl] : [],
            group: 'context-menus',
            isOpen: () => !!document.getElementById('custom-context-menu'),
            close: closeContextMenu,
            dismissOnOutside: true,
            dismissOnEscape: true
        });
        window.AnkaRightClick.activate('browser-context-menu');
    }

    const titlebar = document.getElementById('titlebar');
    const toolbar = document.getElementById('toolbar');
    const chromeBottom = Math.ceil((toolbar || titlebar)?.getBoundingClientRect().bottom || 0);
    const minTop = Math.min(window.innerHeight - 8, Math.max(8, chromeBottom + 6));
    menu.style.maxWidth = Math.max(0, window.innerWidth - 16) + 'px';
    menu.style.maxHeight = Math.max(0, window.innerHeight - minTop - 8) + 'px';
    const menuWidth = Math.min(menu.offsetWidth || 240, Math.max(0, window.innerWidth - 16));
    const menuHeight = Math.min(menu.offsetHeight || (cleaned.length * 36), Math.max(0, window.innerHeight - minTop - 8));
    const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
    const preferredTop = y < minTop ? minTop : y;
    const top = preferredTop + menuHeight <= window.innerHeight - 8
        ? preferredTop
        : Math.max(minTop, window.innerHeight - menuHeight - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    const rows = Array.from(menu.querySelectorAll('.ctx-item:not(.disabled)'));
    let cur = -1;
    ankaMenuKeyHandler = (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End', 'Escape'].includes(e.key)) return;
        if (e.key === 'Escape') {
            closeContextMenu();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Enter') {
            if (rows[cur]) rows[cur].click();
            return;
        }
        if (!rows.length) return;
        if (e.key === 'Home') cur = 0;
        else if (e.key === 'End') cur = rows.length - 1;
        else cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        rows.forEach((r, i) => r.classList.toggle('kbd', i === cur));
    };
    document.addEventListener('keydown', ankaMenuKeyHandler, true);

    requestAnimationFrame(() => menu.classList.add('show'));
}

window.addEventListener('pointerdown', (e) => {
    if (!e.target.closest || (!e.target.closest('#custom-context-menu') && !e.target.closest('#custom-context-submenu'))) {
        closeContextMenu();
    }
}, true);

window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'anka-dismiss-context-menu') return;
    closeContextMenu();
    if (typeof hideContextMenu === 'function') hideContextMenu();
});

window.addEventListener('wheel', () => { closeSubmenu(); closeContextMenu(); }, { passive: true });
window.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (!t.closest || (!t.closest('webview') && !t.closest('.tab') && !t.closest('#custom-context-menu') && !t.closest('#custom-context-submenu'))) closeContextMenu();
}, true);
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);

function ankaOpenPanel(opts) {
    ankaCloseOverlay();
    const overlay = ankaMk('div', { className: 'anka-overlay', id: 'anka-overlay' });
    const panel = ankaMk('section', { className: 'anka-panel' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    const closeBtn = ankaMk('button', { type: 'button', className: 'anka-icon-btn', title: 'Kapat', 'aria-label': 'Kapat', text: '✕', onclick: ankaCloseOverlay });
    panel.append(ankaMk('header', { className: 'anka-panel-head' }, ankaMk('div', null, ankaMk('div', { className: 'anka-kicker', text: opts.kicker || '' }), ankaMk('h2', { text: opts.title })), closeBtn));
    overlay.append(panel);
    overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) ankaCloseOverlay();
    });
    document.body.append(overlay);
    return panel;
}

function ankaCloseOverlay() {
    const overlay = ankaById('anka-overlay');
    if (overlay) overlay.remove();
}

function ankaOpenListPanel(opts) {
    const panel = ankaOpenPanel(opts);
    const search = ankaMk('input', { className: 'anka-search', type: 'search', placeholder: opts.placeholder || 'Ara...', autocomplete: 'off', spellcheck: 'false' });
    const list = ankaMk('div', { className: 'anka-list', role: 'listbox' });
    panel.append(search, list);
    let rows = [];
    let index = 0;

    const mark = () => {
        rows.forEach((r, i) => r.classList.toggle('active', i === index));
        if (rows[index]) rows[index].scrollIntoView({ block: 'nearest' });
    };

    const render = () => {
        const q = search.value.trim().toLowerCase();
        const all = opts.items();
        const items = (q ? all.filter((it) => String(it.title || '').toLowerCase().includes(q) || String(it.url || '').toLowerCase().includes(q)) : all).slice(0, 200);
        list.replaceChildren();
        rows = items.map((it) => {
            const row = ankaMk('div', { className: 'anka-row', role: 'option' }, ankaMk('div', { className: 'anka-row-main' }, ankaMk('div', { className: 'anka-row-title', text: it.title || it.url }), ankaMk('div', { className: 'anka-row-url', text: it.url || '' })));
            if (it.meta) row.append(ankaMk('span', { className: 'anka-row-meta', text: it.meta }));
            if (opts.onRemove) {
                row.append(ankaMk('button', { type: 'button', className: 'anka-row-del', title: 'Sil', 'aria-label': 'Sil', text: '✕', onclick: (e) => {
                    e.stopPropagation();
                    opts.onRemove(it);
                    render();
                } }));
            }
            row.addEventListener('click', () => {
                ankaCloseOverlay();
                opts.onOpen(it);
            });
            list.append(row);
            return row;
        });
        if (!rows.length) list.append(ankaMk('div', { className: 'anka-empty', text: opts.empty || 'Sonuç yok.' }));
        index = 0;
        mark();
    };

    search.addEventListener('input', ankaDebounce(render, 80));
    search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (rows.length) {
                index = (index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
                mark();
            }
        } else if (e.key === 'Enter' && rows[index]) {
            e.preventDefault();
            rows[index].click();
        }
    });

    if (opts.actions && opts.actions.length) {
        const foot = ankaMk('div', { className: 'anka-panel-foot' });
        opts.actions.forEach((a) => foot.append(ankaMk('button', { type: 'button', className: a.danger ? 'session-danger' : 'session-secondary', text: a.label, onclick: () => a.run(render) })));
        panel.append(foot);
    }

    render();
    search.focus();
}

function ankaBookmarks() {
    const list = ankaRead('anka_bookmarks', []);
    return Array.isArray(list) ? list.filter((b) => b && typeof b.url === 'string') : [];
}

function ankaUpdateBookmarkButton() {
    const button = ankaById('bookmark-btn');
    if (!button) return;
    const st = ankaTabs.get(activeTabId);
    const bookmarked = !!st && ankaBookmarks().some((entry) => entry.url === st.url);
    button.classList.toggle('active', bookmarked);
    button.setAttribute('aria-pressed', String(bookmarked));
    button.title = bookmarked ? 'Yer İmini Kaldır' : 'Yer İmi Ekle';
}

function toggleBookmark() {
    const st = ankaTabs.get(activeTabId);
    if (!st || !/^https?:/i.test(st.url)) {
        showNotification('Bu sayfa yer imlerine eklenemez.');
        return;
    }
    const list = ankaBookmarks();
    const idx = list.findIndex((b) => b.url === st.url);
    const shortcuts = ankaRead('anka_shortcuts', []);
    const shortcutList = Array.isArray(shortcuts) ? shortcuts : [];

    if (idx >= 0) {
        list.splice(idx, 1);
        showNotification('Yer imi kaldırıldı.');
        const shortcutIdx = shortcutList.findIndex((s) => s.url === st.url);
        if (shortcutIdx >= 0) {
            shortcutList.splice(shortcutIdx, 1);
            ankaWrite('anka_shortcuts', shortcutList);
            if (typeof renderGrid === 'function') renderGrid();
        }
    } else {
        list.unshift({ url: st.url, title: st.title || ankaHostLabel(st.url), added: Date.now() });
        if (list.length > 2000) list.length = 2000;
        if (!shortcutList.some((s) => s.url === st.url) && shortcutList.length < 60) {
            shortcutList.push({ name: st.title ? String(st.title).slice(0, 60) : ankaHostLabel(st.url), url: st.url });
            ankaWrite('anka_shortcuts', shortcutList);
            if (typeof renderGrid === 'function') renderGrid();
        }
        showNotification('Yer imi ve kısayol eklendi.');
    }

    ankaWrite('anka_bookmarks', list);
    ankaUpdateBookmarkButton();
}

function ankaImportBookmarks() {
    const input = ankaMk('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file || file.size > 5 * 1024 * 1024) return;
        file.text().then((text) => {
            const data = JSON.parse(text);
            if (!Array.isArray(data)) throw new Error('format');
            const list = ankaBookmarks();
            const known = new Set(list.map((b) => b.url));
            let added = 0;
            data.forEach((b) => {
                const url = b && normalizeSessionUrl(b.url);
                if (!url || known.has(url)) return;
                known.add(url);
                list.push({ url, title: ankaTruncate(String(b.title || url), 200), added: Date.now() });
                added += 1;
            });
            ankaWrite('anka_bookmarks', list.slice(0, 2000));
            showNotification(added + ' yer imi içe aktarıldı.');
        }).catch(() => showNotification('Yer imi dosyası okunamadı.'));
    });
    document.body.append(input);
    input.click();
}

function openBookmarksPanel() {
    ankaOpenListPanel({
        title: 'Yer İmleri',
        kicker: 'KAYITLI SAYFALAR',
        placeholder: 'Yer imlerinde ara...',
        empty: 'Henüz yer imi yok. Ctrl+D ile ekleyebilirsiniz.',
        items: () => ankaBookmarks().map((b) => ({ title: b.title, url: b.url, meta: b.added ? new Date(b.added).toLocaleDateString('tr-TR') : '' })),
        onOpen: (it) => createNewTab(it.url),
        onRemove: (it) => {
            ankaWrite('anka_bookmarks', ankaBookmarks().filter((b) => b.url !== it.url));
            ankaUpdateBookmarkButton();
        },
        actions: [
            { label: 'Geçerli Sayfayı Ekle / Kaldır', run: (render) => { toggleBookmark(); render(); } },
            { label: 'Dışa Aktar', run: () => {
                const blob = new Blob([JSON.stringify(ankaBookmarks(), null, 2)], { type: 'application/json' });
                const href = URL.createObjectURL(blob);
                ankaDownload(href, 'anka-yer-imleri-' + ankaStamp() + '.json');
                setTimeout(() => URL.revokeObjectURL(href), 10000);
            } },
            { label: 'İçe Aktar', run: ankaImportBookmarks }
        ]
    });
}

let ankaHistoryCache = null;

function ankaHistory() {
    if (!ankaHistoryCache) {
        const saved = ankaRead('anka_history', []);
        ankaHistoryCache = Array.isArray(saved) ? saved : [];
    }
    return ankaHistoryCache;
}

const ankaFlushHistory = ankaDebounce(() => ankaWrite('anka_history', ankaHistory()), 1500);

window.__ankaClearHistory = function () {
    ankaHistoryCache = [];
    ankaWrite('anka_history', []);
    try {
        for (let index = localStorage.length - 1; index >= 0; index--) {
            const key = localStorage.key(index);
            if (key && key.indexOf('anka_x_hist_') === 0) localStorage.removeItem(key);
        }
    } catch (err) {}
    window.dispatchEvent(new Event('anka-history-cleared'));
};

window.__ankaRemoveHistory = function (entry) {
    if (!entry || typeof entry.url !== 'string') return;
    const minute = Math.floor(Number(entry.t) / 60000);
    const matches = (item, timeKey) => item && item.url === entry.url && Math.floor(Number(item[timeKey] || item.t || item.time || 0) / 60000) === minute;
    ankaHistoryCache = ankaHistory().filter((item) => !matches(item, 'time'));
    ankaWrite('anka_history', ankaHistoryCache);
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key || key.indexOf('anka_x_hist_') !== 0) continue;
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(list)) localStorage.setItem(key, JSON.stringify(list.filter((item) => !matches(item, 't'))));
        }
    } catch (err) {}
    window.dispatchEvent(new Event('anka-history-cleared'));
};

function ankaRecordHistory(st, url, title) {
    if (!st || st.incognito || getSetting('save-history', 'true') === 'false' || !/^https?:/i.test(url)) return;
    const list = ankaHistory();
    if (list[0] && list[0].url === url) {
        if (title) list[0].title = title;
    } else {
        list.unshift({ url, title: title || url, time: Date.now() });
        if (list.length > 1000) list.length = 1000;
    }
    ankaFlushHistory();
}

function ankaUpdateHistoryTitle(st, url, title) {
    if (!st || st.incognito || !title) return;
    const entry = ankaHistory()[0];
    if (entry && entry.url === url) {
        entry.title = title;
        ankaFlushHistory();
    }
}

async function clearBrowsingData() {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'anka-clear-data-title');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.62);backdrop-filter:blur(5px)';
    dialog.innerHTML = `<section style="width:min(480px,100%);max-height:90vh;overflow:auto;padding:22px;border:1px solid var(--border-color,#30323a);border-radius:18px;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);box-shadow:0 24px 70px #0008;font:inherit">
        <h2 id="anka-clear-data-title" style="margin:0 0 7px;font-size:20px">Gezinti verilerini temizle</h2>
        <p style="margin:0 0 16px;opacity:.76;line-height:1.5">Silinecek verileri ve zaman aralığını seçin. Yer imleriniz ve kayıtlı parolalarınız korunur.</p>
        <label style="display:grid;gap:6px;margin-bottom:14px">Zaman aralığı
            <select data-clear-period style="min-height:42px;padding:8px 10px;border-radius:9px">
                <option value="900000">Son 15 dakika</option><option value="3600000">Son 1 saat</option>
                <option value="86400000">Son 24 saat</option><option value="604800000">Son 7 gün</option>
                <option value="0" selected>Tüm zamanlar</option>
            </select>
        </label>
        <div style="display:grid;gap:10px;margin:12px 0 14px">
            <label><input type="checkbox" data-clear-category="history" checked> Gezinti geçmişi</label>
            <label><input type="checkbox" data-clear-category="downloads" checked> İndirme listesi</label>
            <label><input type="checkbox" data-clear-category="cookies" checked> Çerezler</label>
            <label><input type="checkbox" data-clear-category="siteData" checked> Site verileri ve izinleri</label>
            <label><input type="checkbox" data-clear-category="cache" checked> Önbelleğe alınmış dosyalar</label>
        </div>
        <p style="margin:0 0 18px;font-size:12px;line-height:1.45;opacity:.68">Zaman aralığı geçmiş ve indirme listesine uygulanır. Electron güvenli biçimde kısmi süre temizliğini desteklemediğinden çerez, site verisi ve önbellek seçilirse tümü temizlenir.</p>
        <div style="display:flex;justify-content:flex-end;gap:9px">
            <button type="button" data-clear-cancel style="min-height:40px;padding:0 14px;border:1px solid var(--border-color,#30323a);border-radius:9px;background:transparent;color:inherit">İptal</button>
            <button type="button" data-clear-confirm style="min-height:40px;padding:0 14px;border:0;border-radius:9px;background:#d64545;color:white;font-weight:650">Verileri temizle</button>
        </div>
    </section>`;
    document.body.append(dialog);
    const closeDialog = () => {
        document.removeEventListener('keydown', onKey);
        dialog.remove();
    };
    const onKey = (event) => { if (event.key === 'Escape') closeDialog(); };
    document.addEventListener('keydown', onKey);
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target.closest('[data-clear-cancel]')) closeDialog();
    });
    const confirmButton = dialog.querySelector('[data-clear-confirm]');
    confirmButton.focus();
    confirmButton.addEventListener('click', async () => {
        const selected = Array.from(dialog.querySelectorAll('[data-clear-category]:checked')).map((input) => input.dataset.clearCategory);
        if (!selected.length) {
            showNotification('Temizlenecek en az bir veri türü seçin.');
            return;
        }
        confirmButton.disabled = true;
        confirmButton.textContent = 'Temizleniyor…';
        const duration = Number(dialog.querySelector('[data-clear-period]').value);
        const cutoff = duration ? Date.now() - duration : 0;
        try {
            let ipc = null;
            try { ipc = require('electron').ipcRenderer; } catch (err) {}
            if (!ipc || typeof ipc.invoke !== 'function') throw new Error('Tarayıcı veri temizleme hizmetine ulaşılamadı.');
            const result = await ipc.invoke('clear-browsing-data', { categories: selected.filter((item) => item !== 'history'), cutoff });
            if (!result || !result.ok) throw new Error('Gezinti verileri temizlenemedi.');
            if (selected.includes('history')) {
                ankaHistoryCache = ankaHistory().filter((entry) => cutoff && Number(entry.time) < cutoff);
                ankaWrite('anka_history', ankaHistoryCache);
                closedTabsStack.length = 0;
            }
            closeDialog();
            const allTimeLabels = { cookies: 'çerezler', siteData: 'site verileri', cache: 'önbellek' };
            const clearedAllTime = (result.allTimeOnly || []).map((item) => allTimeLabels[item]).filter(Boolean);
            const note = clearedAllTime.length ? ' Tüm zamanlar için temizlenenler: ' + clearedAllTime.join(', ') + '.' : '';
            showNotification('Seçilen gezinti verileri temizlendi.' + note);
        } catch (err) {
            confirmButton.disabled = false;
            confirmButton.textContent = 'Yeniden dene';
            showNotification('Veriler temizlenemedi: ' + (err.message || 'Bilinmeyen hata'));
        }
    });
}
window.clearBrowsingData = clearBrowsingData;

function openHistoryPanel() {
    ankaOpenListPanel({
        title: 'Geçmiş',
        kicker: 'SON ZİYARETLER',
        placeholder: 'Geçmişte ara...',
        empty: 'Geçmiş boş.',
        items: () => ankaHistory().map((h) => ({ title: h.title, url: h.url, meta: new Date(h.time).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })),
        onOpen: (it) => createNewTab(it.url),
        onRemove: (it) => {
            ankaHistoryCache = ankaHistory().filter((h) => h.url !== it.url);
            ankaFlushHistory();
        },
        actions: [{ label: 'Tüm Gezinti Verilerini Temizle', danger: true, run: (render) => { clearBrowsingData(); render(); } }]
    });
}

function openTabSearch() {
    ankaOpenListPanel({
        title: 'Sekme Ara',
        kicker: 'AÇIK SEKMELER',
        placeholder: 'Sekme başlığı veya adres...',
        empty: 'Eşleşen sekme yok.',
        items: () => {
            const bar = ankaById('tab-bar');
            const out = [];
            if (!bar) return out;
            for (const el of bar.children) {
                const st = ankaTabs.get(el.id.replace(/^btn-/, ''));
                if (st) out.push({ id: st.id, title: st.title || ankaHostLabel(st.url) || 'Yeni Sekme', url: ankaIsNewTabUrl(st.url) ? '' : st.url, meta: st.sleeping ? 'uyuyor' : (st.id === activeTabId ? 'aktif' : '') });
            }
            return out;
        },
        onOpen: (it) => switchTab(it.id)
    });
}

function ankaSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (q.startsWith('@')) {
        const needle = q.slice(1).trim();
        return Array.from(ankaTabs.values())
            .filter((st) => !needle || (st.title + ' ' + st.url).toLowerCase().includes(needle))
            .slice(0, 8)
            .map((st) => ({ url: st.url, title: st.title || ankaHostLabel(st.url) || 'Yeni Sekme', kind: 'Sekme', tabId: st.id }));
    }
    if (q.length < 1) return [];
    const out = [];
    const seen = new Set();
    const push = (entry, kind) => {
        if (out.length >= 8 || seen.has(entry.url)) return;
        if (!String(entry.url).toLowerCase().includes(q) && !String(entry.title || '').toLowerCase().includes(q)) return;
        seen.add(entry.url);
        out.push({ url: entry.url, title: entry.title || entry.url, kind });
    };
    const utility = ankaOmniboxUtility(query);
    if (utility) out.push({ url: query, title: utility.label, kind: 'Hesap' });
    ankaBookmarks().forEach((b) => push(b, '★'));
    ankaHistory().forEach((h) => push(h, '◷'));
    return out;
}

function ankaOmniboxUtility(query) {
    const value = String(query || '').trim();
    const numberFormat = new Intl.NumberFormat('tr-TR', { maximumSignificantDigits: 9 });
    const conversion = /^(-?\d+(?:[.,]\d+)?)\s*(mm|cm|km|m|kg|g|ml|l|°?c|°?f)\s+(?:in|to|→)\s*(mm|cm|km|m|kg|g|ml|l|°?c|°?f)$/i.exec(value);
    if (conversion) {
        const amount = Number(conversion[1].replace(',', '.'));
        const from = conversion[2].toLowerCase().replace('°', '');
        const to = conversion[3].toLowerCase().replace('°', '');
        const dimensions = {
            distance: { mm: 0.001, cm: 0.01, m: 1, km: 1000 },
            mass: { g: 0.001, kg: 1 },
            volume: { ml: 0.001, l: 1 }
        };
        for (const units of Object.values(dimensions)) {
            if (units[from] && units[to]) {
                const result = amount * units[from] / units[to];
                return Number.isFinite(result) ? { label: numberFormat.format(result) + ' ' + to, value: result } : null;
            }
        }
        if (from === 'c' && to === 'f') return { label: numberFormat.format(amount * 9 / 5 + 32) + ' °F', value: amount * 9 / 5 + 32 };
        if (from === 'f' && to === 'c') return { label: numberFormat.format((amount - 32) * 5 / 9) + ' °C', value: (amount - 32) * 5 / 9 };
        return null;
    }
    if (!value.startsWith('=')) return null;
    const expression = value.slice(1).replace(/(\d),(\d)/g, '$1.$2').trim();
    if (!expression || expression.length > 80) return null;
    const tokens = expression.match(/\s*(?:\d+(?:\.\d*)?|\.\d+|[()+\-*/%])/g);
    if (!tokens) return null;
    const parts = tokens.map((token) => token.trim()).filter(Boolean);
    if (parts.join('') !== expression.replace(/\s+/g, '')) return null;
    let index = 0;
    const factor = () => {
        const token = parts[index++];
        if (token === '+' || token === '-') {
            const value = factor();
            return token === '-' ? -value : value;
        }
        if (token === '(') {
            const value = expressionValue();
            if (parts[index++] !== ')') throw new Error('Invalid expression');
            return value;
        }
        const number = Number(token);
        if (!Number.isFinite(number)) throw new Error('Invalid number');
        return number;
    };
    const term = () => {
        let result = factor();
        while (['*', '/', '%'].includes(parts[index])) {
            const operator = parts[index++];
            const right = factor();
            if ((operator === '/' || operator === '%') && right === 0) throw new Error('Division by zero');
            result = operator === '*' ? result * right : operator === '/' ? result / right : result % right;
        }
        return result;
    };
    const expressionValue = () => {
        let result = term();
        while (parts[index] === '+' || parts[index] === '-') {
            const operator = parts[index++];
            const right = term();
            result = operator === '+' ? result + right : result - right;
        }
        return result;
    };
    try {
        const result = expressionValue();
        if (index !== parts.length || !Number.isFinite(result)) return null;
        return { label: '= ' + numberFormat.format(result), value: result };
    } catch (err) {
        return null;
    }
}

function ankaSetupUrlBar(input) {
    if (input.__ankaBar) return;
    input.__ankaBar = true;
    const box = ankaMk('div', { id: 'anka-url-suggest', className: 'anka-suggest', role: 'listbox' });
    box.hidden = true;
    document.body.append(box);
    let items = [];
    let idx = -1;
    let typed = '';

    const hide = () => {
        box.hidden = true;
        idx = -1;
    };
    const mark = () => Array.from(box.children).forEach((r, i) => r.classList.toggle('active', i === idx));
    const go = (value, suggestion) => {
        hide();
        if (suggestion && suggestion.tabId) {
            switchTab(suggestion.tabId);
            input.blur();
            return;
        }
        const utility = ankaOmniboxUtility(value);
        if (utility) {
            showNotification('Sonuç: ' + utility.label);
            input.blur();
            return;
        }
        ankaNavigateActive(value);
        input.blur();
    };
    const render = () => {
        box.replaceChildren();
        items.forEach((it) => {
            const row = ankaMk('div', { className: 'anka-suggest-row', role: 'option' }, ankaMk('span', { className: 'anka-suggest-kind', text: it.kind }), ankaMk('span', { className: 'anka-suggest-title', text: ankaTruncate(it.title, 50) }), ankaMk('span', { className: 'anka-suggest-url', text: ankaTruncate(it.url, 80) }));
            row.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                input.value = it.url;
                go(it.url, it);
            });
            box.append(row);
        });
        if (items.length) {
            const r = input.getBoundingClientRect();
            box.style.left = r.left + 'px';
            box.style.top = (r.bottom + 4) + 'px';
            box.style.width = Math.max(r.width, 320) + 'px';
        }
        box.hidden = !items.length;
    };

    const update = ankaDebounce(() => {
        items = ankaSuggestions(input.value);
        idx = -1;
        render();
    }, 70);

    input.addEventListener('input', () => {
        typed = input.value;
        update();
    });
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('focus', (e) => e.target.select());
    input.addEventListener('keydown', (e) => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length && !box.hidden) {
            e.preventDefault();
            idx += e.key === 'ArrowDown' ? 1 : -1;
            if (idx >= items.length) idx = -1;
            if (idx < -1) idx = items.length - 1;
            input.value = idx < 0 ? typed : items[idx].url;
            mark();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            go(input.value, idx >= 0 ? items[idx] : null);
        } else if (e.key === 'Escape') {
            hide();
            const st = ankaTabs.get(activeTabId);
            input.value = st && !ankaIsNewTabUrl(st.url) && st.url !== 'about:blank' ? st.url : '';
            input.blur();
        }
    });
}

function ankaNavigateActive(value) {
    const systemPage = /^ankaweb:\/\/(ayarlar|yardım|yardim|indirilenler|geçmiş|gecmis)\/?$/i.exec(String(value || '').trim());
    if (systemPage && typeof window.openAnkaPage === 'function') {
        const names = { ayarlar: 'settings', yardım: 'help', yardim: 'help', indirilenler: 'downloads', geçmiş: 'history', gecmis: 'history' };
        window.openAnkaPage(names[systemPage[1].toLowerCase()]);
        return;
    }
    const target = ankaResolveTarget(value);
    if (!target) return;
    const st = ankaTabs.get(activeTabId);
    if (!st) {
        createNewTab(target);
        return;
    }
    if (!st.vw) ankaWake(st);
    st.url = target;
    ankaLoad(st.vw, target);
}

function ankaSyncUrlBar(st) {
    if (!st) return;
    const input = ankaById('url-input');
    const localDocument = /^file:/i.test(st.url) && /\.(pdf|html?|txt|md|json|png|jpe?g|gif|webp|svg|mp4|webm|mp3|ogg|wav)(?:[?#]|$)/i.test(st.url);
    if (input && document.activeElement !== input) {
        input.value = ankaIsWelcomeUrl(st.url) ? 'Anka Web' : ankaIsNewTabUrl(st.url) || st.url === 'about:blank' ? '' : (localDocument ? st.url : /^file:/i.test(st.url) ? '' : st.url);
    }
    const info = ankaById('site-info-btn');
    if (info) {
        let protocol = '';
        try { protocol = new URL(st.url).protocol; } catch (err) {}
        const secure = protocol === 'https:';
        info.innerHTML = secure
            ? '<svg class="xi site-indicator" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
            : protocol === 'http:'
                ? '<svg class="xi site-indicator" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>'
                : '<svg class="xi site-indicator" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9h.01"/></svg>';
        info.classList.toggle('site-insecure', protocol === 'http:');
        info.title = secure ? 'HTTPS ile şifrelenmiş bağlantı; site içeriğinin güvenilirliğini garanti etmez' :
            protocol === 'http:' ? 'Güvenli değil: HTTP bağlantısı şifrelenmiyor' : 'Bağlantı bilgisi';
        info.setAttribute('aria-label', info.title);
    }
}

function ankaActiveView() {
    const st = ankaTabs.get(activeTabId);
    return st && st.vw ? st.vw : ankaById(activeTabId);
}

function ankaStateOfView(vw) {
    return vw && vw.id ? ankaTabs.get(vw.id) : null;
}

function ankaOpenDevTools(vw, mode) {
    mode = mode === 'detach' ? 'detach' : 'right';
    if (getSetting('dev-tools-shortcut', 'true') === 'false') {
        showNotification('Geliştirici araçları ayarlardan kapalı.');
        return;
    }
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.openDevTools !== 'function') {
        showNotification('DevTools bu sekmede kullanılamaz.');
        return;
    }
    try {
        const st = ankaStateOfView(vw);
        const bridge = ankaBridgeApi();
        if (st && st.devToolsTogglePending) return;
        if (bridge && typeof bridge.invoke === 'function' && typeof vw.getWebContentsId === 'function') {
            const webContentsId = vw.getWebContentsId();
            if (!Number.isInteger(webContentsId)) throw new Error('Sekme WebContents kimliği alınamadı.');
            if (st) st.devToolsTogglePending = true;
            bridge.invoke('webview-devtools:toggle', { webContentsId, mode }).then((result) => {
                if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'DevTools açılamadı.');
                if (st) st.devToolsOpen = result.open;
            }).catch((err) => {
                try {
                    if (!(typeof vw.isDevToolsOpened === 'function' && vw.isDevToolsOpened())) {
                        vw.openDevTools({ mode });
                    }
                    if (st) st.devToolsOpen = true;
                } catch (fallbackError) {
                    console.error('Sekme DevTools açılamadı:', err, fallbackError);
                    showNotification('DevTools açılamadı.');
                }
            }).finally(() => {
                if (st) st.devToolsTogglePending = false;
            });
            return;
        }
        const isOpen = typeof vw.isDevToolsOpened === 'function'
            ? vw.isDevToolsOpened()
            : !!(st && st.devToolsOpen);
        if (isOpen) vw.closeDevTools();
        else vw.openDevTools({ mode });
        if (st) st.devToolsOpen = !isOpen;
    } catch (err) {
        const st = ankaStateOfView(vw);
        if (st) st.devToolsOpen = false;
        console.error('DevTools açılamadı:', err);
        showNotification('DevTools açılamadı. Bu sekme için desteklenmiyor olabilir.');
    }
}

function openDevToolsDetached(vw) {
    if (getSetting('dev-tools-shortcut', 'true') === 'false') {
        showNotification('Geliştirici araçları ayarlardan kapalı.');
        return;
    }
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.openDevTools !== 'function') {
        showNotification('DevTools bu sekmede kullanılamaz.');
        return;
    }
    ankaOpenDevTools(vw, 'detach');
}

function openDevToolsDocked(vw, mode) {
    if (getSetting('dev-tools-shortcut', 'true') === 'false') {
        showNotification('Geliştirici araçları ayarlardan kapalı.');
        return;
    }
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.openDevTools !== 'function') {
        showNotification('DevTools bu sekmede kullanılamaz.');
        return;
    }
    if (mode && mode !== 'right') {
        showNotification('DevTools yalnızca sağ panelde açılabilir.');
        return;
    }
    try {
        ankaOpenDevTools(vw);
    } catch (err) {
        console.error('DevTools yerleşimi açılamadı:', err);
        showNotification('DevTools bu yerleşimde açılamadı.');
    }
}

function closeDevTools(vw) {
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.closeDevTools !== 'function') return;
    try {
        const st = ankaStateOfView(vw);
        if (st) st.devToolsOpen = false;
        vw.closeDevTools();
        showNotification('DevTools kapatıldı.');
    }
    catch (err) {
        console.error('DevTools kapatılamadı:', err);
        showNotification('DevTools kapatılamadı.');
    }
}

function inspectElementAt(vw, x, y) {
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.inspectElement !== 'function') return;
    try { vw.inspectElement(x || 0, y || 0); } catch (err) {}
}

function openDevToolsMenu(vw) {
    if (!vw) vw = ankaActiveView();
    if (!vw) {
        showNotification('Aktif sekme yok.');
        return;
    }
    const st = ankaStateOfView(vw);
    const isOpen = typeof vw.isDevToolsOpened === 'function'
        ? vw.isDevToolsOpened()
        : !!(st && st.devToolsOpen);
    const r = window.innerWidth;
    showContextMenu(Math.round(r / 2 - 120), 120, [
        { label: isOpen ? 'DevTools Kapat' : 'DevTools Sağ Panelde Aç', action: () => ankaOpenDevTools(vw) },
        { label: 'Sağ HTML İnceleyicisi', action: () => toggleSideViewSource(vw, 'right') },
        { label: 'Konsolu Temizle', action: () => { try { if (vw.__ankaReady) vw.executeJavaScript('console.clear()'); } catch (e) {} } }
    ]);
}

function ankaZoom(delta) {
    const st = ankaTabs.get(activeTabId);
    const vw = st && st.vw;
    if (!vw || typeof vw.setZoomFactor !== 'function') return;
    const level = delta === null ? 0 : Math.max(-3, Math.min(5, (st.zoom || 0) + delta));
    st.zoom = level;
    const fontScale = Math.max(0.85, Math.min(1.3, Number(getSetting('font-scale', '100')) / 100 || 1));
    const defaultZoom = Math.max(0.75, Math.min(1.5, Number(getSetting('page-zoom', '100')) / 100 || 1));
    const factor = (level === 0 ? defaultZoom : Math.pow(1.2, level)) * fontScale;
    try { vw.setZoomFactor(factor); st.appliedZoomFactor = factor; } catch (err) {}
    const zoomLabel = ankaById('page-zoom-value');
    if (zoomLabel) zoomLabel.textContent = '%' + Math.round(factor * 100);
    const host = ankaHostLabel(st.url);
    if (host && !st.incognito && /^https?:/i.test(st.url)) {
        const map = ankaRead('anka_zoom', {});
        if (level === 0) delete map[host];
        else map[host] = level;
        ankaWrite('anka_zoom', map);
    }
    showNotification('Yakınlaştırma: %' + Math.round(Math.pow(1.2, level) * 100));
}

function ankaApplyStoredZoom(st, vw) {
    if (!vw || typeof vw.setZoomFactor !== 'function') return;
    if (!vw.__ankaReady) return;
    const host = ankaHostLabel(st.url);
    const stored = host && !st.incognito ? ankaRead('anka_zoom', {})[host] : undefined;
    const defaultPercent = Number(getSetting('page-zoom', '100'));
    const defaultFactor = Number.isFinite(defaultPercent) && defaultPercent >= 50 && defaultPercent <= 200 ? defaultPercent / 100 : 1;
    const fontScale = Math.max(0.85, Math.min(1.3, Number(getSetting('font-scale', '100')) / 100 || 1));
    const level = typeof stored === 'number' ? stored : Math.log(defaultFactor) / Math.log(1.2);
    const factor = (typeof stored === 'number' ? Math.pow(1.2, stored) : defaultFactor) * fontScale;
    if (Math.abs(factor - (st.appliedZoomFactor || 1)) < 0.001) return;
    st.zoom = level;
    try {
        vw.setZoomFactor(factor);
        st.appliedZoomFactor = factor;
    } catch (err) {}
}

window.__ankaApplyZoomSettings = function () {
    ankaTabs.forEach((st) => {
        if (st.vw) ankaApplyStoredZoom(st, st.vw);
    });
};

function ankaApplyDark(st, vw) {
    if (!vw || !vw.__ankaReady || typeof vw.insertCSS !== 'function') return;
    const url = st.url || '';
    const css = ankaIsGoogleHost(ankaTryUrl(url) && ankaTryUrl(url).hostname)
        ? ANKA_GOOGLE_DARK_CSS
        : ANKA_DARK_CSS;
    if (st.darkKey) {
        try { vw.removeInsertedCSS(st.darkKey).catch(() => {}); } catch (err) {}
    }
    st.darkKey = null;
    try {
        vw.insertCSS(css).then((key) => { st.darkKey = key; }).catch((err) => {
            console.error('Site koyu görünümü uygulanamadı:', err);
            showNotification('Site koyu görünümü uygulanamadı. Bu sayfada desteklenmiyor olabilir.');
        });
    } catch (err) {
        console.error('Site koyu görünümü uygulanamadı:', err);
        showNotification('Site koyu görünümü uygulanamadı. Bu sayfada desteklenmiyor olabilir.');
    }
}

function toggleDarkMode(vw) {
    const st = ankaStateOfView(vw);
    if (!st || !vw) return;
    if (st.dark) {
        st.dark = false;
        if (st.darkKey) {
            try { vw.removeInsertedCSS(st.darkKey).catch(() => {}); } catch (err) {}
        }
        st.darkKey = null;
    } else {
        st.dark = true;
        ankaApplyDark(st, vw);
    }
}

function hardReload(vw) {
    if (vw && typeof vw.reloadIgnoringCache === 'function') vw.reloadIgnoringCache();
}

function printPage(vw) {
    if (!vw) {
        showNotification('Yazdırılacak bir sayfa bulunamadı.');
        return;
    }
    const bridge = ankaBridgeApi();
    if (bridge && typeof bridge.invoke === 'function' &&
        typeof vw.getWebContentsId === 'function' && typeof vw.printToPDF === 'function') {
        let webContentsId;
        try { webContentsId = vw.getWebContentsId(); }
        catch (err) {
            console.error('Yazdırma için sekme kimliği alınamadı:', err);
            showNotification('Yazdırma başlatılamadı.');
            return;
        }
        bridge.invoke('webview-print', webContentsId).then((result) => {
            if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'Yazdırma başlatılamadı.');
            if (!result.queued) showNotification('Yazdırma tamamlandı.');
        }).catch((err) => {
            console.error('Sekme yazdırılamadı:', err);
            showNotification('Yazdırma başlatılamadı. Yazıcıyı ve sayfanın yüklenmesini kontrol edin.');
        });
        return;
    }
    try {
        if (typeof vw.print !== 'function') throw new Error('Bu sayfa yazdırmayı desteklemiyor.');
        vw.print({ silent: false, printBackground: true });
    } catch (err) {
        console.error('Sayfa yazdırılamadı:', err);
        showNotification('Yazdırma başlatılamadı.');
    }
}

function savePageAsPdf(vw) {
    if (!vw || typeof vw.printToPDF !== 'function') return;
    vw.printToPDF({ printBackground: true }).then((data) => {
        const href = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
        ankaDownload(href, 'sayfa-' + ankaStamp() + '.pdf');
        setTimeout(() => URL.revokeObjectURL(href), 10000);
        showNotification('PDF oluşturuldu.');
    }).catch(() => showNotification('PDF oluşturulamadı.'));
}

function takeScreenshot(vw) {
    if (!vw || typeof vw.capturePage !== 'function') return;
    vw.capturePage().then((img) => {
        const href = img && typeof img.toDataURL === 'function' ? img.toDataURL() : '';
        if (!href) throw new Error('empty');
        ankaDownload(href, 'ekran-goruntusu-' + ankaStamp() + '.png');
        showNotification('Ekran görüntüsü kaydedildi.');
    }).catch(() => showNotification('Ekran görüntüsü alınamadı.'));
}

function toggleFullscreen() {
    try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
    } catch (err) {}
}

let ankaFindState = null;

function ankaCloseFindBar() {
    if (!ankaFindState) return;
    const { bar, vw, onFound } = ankaFindState;
    ankaFindState = null;
    try {
        vw.removeEventListener('found-in-page', onFound);
        vw.stopFindInPage('clearSelection');
    } catch (err) {}
    bar.remove();
}

function openFindBar(vw) {
    if (!vw || typeof vw.findInPage !== 'function') vw = ankaActiveView();
    if (!vw || typeof vw.findInPage !== 'function') return;
    ankaCloseFindBar();

    const input = ankaMk('input', { type: 'text', id: 'anka-find-input', placeholder: 'Sayfada ara...', autocomplete: 'off', spellcheck: 'false' });
    const count = ankaMk('span', { className: 'anka-find-count' });
    const caseBtn = ankaMk('button', { type: 'button', title: 'Büyük/küçük harf duyarlı', text: 'Aa' });
    const wordBtn = ankaMk('button', { type: 'button', title: 'Tam kelime', text: '|ab|' });
    const regexBtn = ankaMk('button', { type: 'button', title: 'Regex modu', text: '.*' });
    const allBtn = ankaMk('button', { type: 'button', title: 'Tümünü işaretle', text: '☰' });
    const prev = ankaMk('button', { type: 'button', id: 'anka-find-prev', text: '◀' });
    const next = ankaMk('button', { type: 'button', id: 'anka-find-next', text: '▶' });
    const close = ankaMk('button', { type: 'button', id: 'anka-find-close', className: 'danger', text: '✕' });
    const bar = ankaMk('div', { id: 'anka-find-bar', className: 'anka-find-bar' }, input, count, caseBtn, wordBtn, regexBtn, allBtn, prev, next, close);
    document.body.appendChild(bar);

    const onFound = (e) => {
        const r = e && e.result;
        if (r && r.finalUpdate !== false) count.textContent = r.matches ? r.activeMatchOrdinal + '/' + r.matches : '0';
    };
    vw.addEventListener('found-in-page', onFound);
    ankaFindState = { bar, vw, onFound };

    let lastTerm = '';
    const run = (forward) => {
        const raw = input.value;
        if (!raw) {
            try { vw.stopFindInPage('clearSelection'); } catch (err) {}
            count.textContent = '';
            lastTerm = '';
            return;
        }
        let term = raw;
        if (regexBtn.classList.contains('on')) {
            try {
                const re = new RegExp(raw, caseBtn.classList.contains('on') ? '' : 'i');
                term = re.source;
            } catch (err) {
                count.textContent = 'regex?';
                return;
            }
        } else if (wordBtn.classList.contains('on')) {
            term = '\\b' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b';
        }
        const fresh = raw !== lastTerm;
        lastTerm = raw;
        try {
            vw.findInPage(term, {
                forward,
                findNext: !fresh,
                matchCase: caseBtn.classList.contains('on')
            });
        } catch (err) {}
    };

    input.addEventListener('input', ankaDebounce(() => run(true), 100));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            run(!e.shiftKey);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            ankaCloseFindBar();
        }
    });
    [caseBtn, wordBtn, regexBtn, allBtn].forEach((btn) => {
        btn.onclick = () => {
            btn.classList.toggle('on');
            lastTerm = '';
            run(true);
        };
    });
    next.onclick = () => run(true);
    prev.onclick = () => run(false);
    close.onclick = ankaCloseFindBar;
    input.focus();
}

function toggleSideViewSource(vw, side) {
    side = side === 'left' ? 'left' : 'right';
    let panel = ankaById('anka-side-devtools');
    if (panel && panel.classList.contains('open') && panel.dataset.side === side) {
        closeSideViewSource();
        return;
    }
    if (!vw || typeof vw.executeJavaScript !== 'function') vw = ankaActiveView();
    if (!vw || typeof vw.executeJavaScript !== 'function') return;

    if (!panel) {
        const copy = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Kopyala' });
        const refresh = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Yenile' });
        const devtools = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'DevTools' });
        const detach = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Sağ Panel' });
        const dockLeft = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Sol' });
        const dockRight = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Sağ' });
        const dockBottom = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Alt' });
        const close = ankaMk('button', { type: 'button', className: 'side-dt-close danger', text: 'Kapat', onclick: closeSideViewSource });
        const search = ankaMk('input', { id: 'side-dt-search', type: 'search', placeholder: 'HTML içinde ara...' });
        const code = ankaMk('pre', { className: 'side-dt-content', id: 'side-dt-code' });
        panel = ankaMk('aside', { id: 'anka-side-devtools' }, ankaMk('div', { className: 'side-dt-header' }, ankaMk('span', { text: 'Anka Web İncele · HTML' }), ankaMk('span', { className: 'side-dt-actions' }, copy, refresh, devtools, detach, dockLeft, dockRight, dockBottom, close)), search, code);
        document.body.appendChild(panel);
        const renderMatch = () => {
            const source = panel.__ankaSource || '';
            const query = search.value.trim();
            const index = query ? source.toLowerCase().indexOf(query.toLowerCase()) : -1;
            code.replaceChildren();
            if (index < 0) {
                code.textContent = source;
                return;
            }
            const matchEnd = index + query.length;
            code.append(document.createTextNode(source.slice(0, index)));
            const mark = document.createElement('mark');
            mark.textContent = source.slice(index, matchEnd);
            code.append(mark, document.createTextNode(source.slice(matchEnd)));
            mark.scrollIntoView({ block: 'center' });
        };
        search.addEventListener('input', renderMatch);
        copy.addEventListener('click', () => ankaCopy(panel.__ankaSource || ''));
        refresh.addEventListener('click', () => panel.__ankaLoad && panel.__ankaLoad());
        devtools.addEventListener('click', () => {
            const view = panel.__ankaView;
            if (view) ankaOpenDevTools(view);
        });
        detach.addEventListener('click', () => { const view = panel.__ankaView; if (view) openDevToolsDetached(view); });
        dockLeft.addEventListener('click', () => { const view = panel.__ankaView; if (view) toggleSideViewSource(view, 'left'); });
        dockRight.addEventListener('click', () => { const view = panel.__ankaView; if (view) openDevToolsDocked(view, 'right'); });
        dockBottom.addEventListener('click', () => { const view = panel.__ankaView; if (view) toggleSideViewSource(view, 'right'); });
        panel.__ankaRenderSource = renderMatch;
        panel.__ankaSearch = search;
    }

    panel.__ankaView = vw;
    panel.dataset.side = side;
    panel.classList.toggle('open-left', side === 'left');
    panel.__ankaLoad = () => {
        const requestId = String((Number(panel.dataset.requestId) || 0) + 1);
        panel.dataset.requestId = requestId;
        const codeBox = ankaById('side-dt-code');
        if (codeBox) codeBox.textContent = 'Kaynak yükleniyor...';
        vw.executeJavaScript('document.documentElement ? document.documentElement.outerHTML.slice(0, 350000) : ""').then((html) => {
            if (!panel.isConnected || panel.dataset.requestId !== requestId) return;
            panel.__ankaSource = String(html || '').replace(/></g, '>\n<');
            if (panel.__ankaRenderSource) panel.__ankaRenderSource();
            panel.classList.add('open');
            panel.classList.toggle('open-left', panel.dataset.side === 'left');
        }).catch(() => showNotification('Kaynak kodu alınamadı.'));
    };
    panel.__ankaLoad();
}

function closeSideViewSource() {
    const panel = ankaById('anka-side-devtools');
    if (!panel) return;
    panel.dataset.requestId = String((Number(panel.dataset.requestId) || 0) + 1);
    panel.classList.remove('open');
}

function ankaBuildWebview(id, opts) {
    const o = opts || {};
    const vw = document.createElement('webview');
    if (id) vw.id = id;
    vw.className = o.className || 'browser-view';
    let webPreferences = ANKA_GUEST_PREFS;
    let preload = o.preload || '';
    if (!preload && !o.incognito && o.url && ankaIsNewTabUrl(o.url)) {
        try {
            const { fileURLToPath } = require('url');
            preload = fileURLToPath(new URL('../core/main/newtab-preload.js', window.location.href));
        } catch (err) {
            console.error('Yeni sekme ayar köprüsü yüklenemedi:', err);
        }
    }
    if (!o.incognito && o.url && ankaReadSiteSettingsForUrl(o.url).javascript === false) {
        webPreferences = webPreferences.replace('javascript=yes', 'javascript=no');
    }
    vw.setAttribute('webpreferences', webPreferences);
    if (o.partition) vw.setAttribute('partition', o.partition);
    if (preload) vw.setAttribute('preload', preload);
    vw.style.cssText = o.style || 'display:none; width:100%; height:100%; flex:1;';
    return vw;
}

function ankaReadSiteSettings(hostname) {
    const host = String(hostname || '').toLowerCase();
    const all = ankaRead('anka_site_settings', {});
    return all && typeof all === 'object' && all[host] && typeof all[host] === 'object' ? all[host] : {};
}

function ankaReadSiteSettingsForUrl(url) {
    const parsed = ankaTryUrl(url);
    return parsed && /^https?:$/.test(parsed.protocol) ? ankaReadSiteSettings(parsed.hostname) : {};
}

function ankaWriteSiteSettings(hostname, preferences) {
    const host = String(hostname || '').toLowerCase();
    if (!host || host.length > 253 || (!/^[a-z0-9.:-]+$/i.test(host) && !/^\[[0-9a-f:]+\]$/i.test(host))) return false;
    const all = ankaRead('anka_site_settings', {});
    all[host] = {
        javascript: preferences.javascript !== false,
        dark: preferences.dark === true,
        openPopups: preferences.openPopups !== false
    };
    return ankaWrite('anka_site_settings', all);
}

function ankaIsGoogleHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'google.com' || host.endsWith('.google.com') ||
        /^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

function ankaEnsurePinnedPanel() {
    let panel = ankaById('pinned-side-panel');
    if (panel) return panel;
    const close = ankaMk('button', { type: 'button', className: 'side-dt-close danger', text: '✕', onclick: closePinnedSidePanel });
    panel = ankaMk('aside', { id: 'pinned-side-panel', className: 'anka-pinned-fallback' }, ankaMk('div', { className: 'side-dt-header' }, ankaMk('span', { id: 'pinned-side-title', text: 'Yan Panel' }), close), ankaMk('div', { id: 'pinned-side-content', style: 'flex:1;min-height:0' }));
    panel.hidden = true;
    document.body.append(panel);
    return panel;
}

function pinToSidePanel(vw) {
    if (!vw) return;
    const panel = ankaEnsurePinnedPanel();
    const content = ankaById('pinned-side-content');
    if (!content) return;

    const currentUrl = typeof vw.getURL === 'function' ? vw.getURL() : vw.getAttribute('src');
    const parsed = ankaTryUrl(currentUrl);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        showNotification('Bu sayfa yan panele sabitlenemez.');
        return;
    }

    panel.hidden = true;
    panel.classList.remove('open');
    content.replaceChildren();

    const titleEl = ankaById('pinned-side-title');
    if (titleEl) titleEl.textContent = 'Yan Panel · ' + ankaTruncate(typeof vw.getTitle === 'function' ? vw.getTitle() : 'Sekme', 40);

    const pinnedView = ankaBuildWebview('', { className: 'pinned-side-webview', partition: vw.getAttribute('partition') || '', url: parsed.href, incognito: !!(ankaTabs.get(vw.id) && ankaTabs.get(vw.id).incognito), style: 'width:100%;height:100%;border:none;' });
    applyMandatorySecurity(pinnedView);
    attachWebviewContextMenu(pinnedView);
    pinnedView.addEventListener('page-title-updated', (event) => {
        if (titleEl && event.title) titleEl.textContent = 'Yan Panel · ' + ankaTruncate(event.title, 40);
    });

    content.appendChild(pinnedView);
    pinnedView.setAttribute('src', parsed.href);

    requestAnimationFrame(() => {
        panel.hidden = false;
        panel.classList.add('open');
    });
}

function closePinnedSidePanel() {
    const panel = ankaById('pinned-side-panel');
    const content = ankaById('pinned-side-content');
    if (content) content.replaceChildren();
    if (panel) {
        panel.classList.remove('open');
        panel.hidden = true;
    }
}

function saveSelectedTextToStorage(txt) {
    try {
        const history = ankaRead('anka_saved_snippets', []);
        history.push({ text: String(txt).slice(0, 5000), date: new Date().toISOString() });
        if (history.length > 200) history.splice(0, history.length - 200);
        if (!ankaWrite('anka_saved_snippets', history)) throw new Error('quota');
        showNotification('Metin panoya ve notlara kaydedildi.');
    } catch (err) {
        showNotification('Kaydetme başarısız.');
    }
    ankaCopy(String(txt));
}

function saveCurrentPage(vw) {
    fallbackSavePage(vw);
}

function fallbackSavePage(vw) {
    if (!vw || typeof vw.executeJavaScript !== 'function') return;
    vw.executeJavaScript('document.documentElement.outerHTML').then((html) => {
        const title = (typeof vw.getTitle === 'function' && vw.getTitle()) || 'sayfa';
        const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sayfa';
        const href = URL.createObjectURL(new Blob(['<!DOCTYPE html>\n' + html], { type: 'text/html' }));
        ankaDownload(href, name + '.html');
        setTimeout(() => URL.revokeObjectURL(href), 10000);
        showNotification('Sayfa HTML olarak indirildi.');
    }).catch(() => showNotification('Sayfa kaydedilemedi.'));
}

function downloadFileFromUrl(url) {
    const parsed = ankaTryUrl(url);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return;
    try {
        if (window.electronAPI && typeof window.electronAPI.downloadUrl === 'function') {
            window.electronAPI.downloadUrl(parsed.href);
            showNotification('İndirme başlatıldı.');
            return;
        }
    } catch (err) {}
    const name = ankaDecode(parsed.pathname.split('/').pop() || '').replace(/[\\/:*?"<>|]+/g, '_') || 'indirilen_medya';
    fetch(parsed.href).then((res) => {
        if (!res.ok) throw new Error('http');
        return res.blob();
    }).then((blob) => {
        const href = URL.createObjectURL(blob);
        ankaDownload(href, name);
        setTimeout(() => URL.revokeObjectURL(href), 10000);
        showNotification('İndirme başlatıldı.');
    }).catch(() => {
        createNewTab(parsed.href);
        showNotification('Doğrudan indirilemedi; adres yeni sekmede açıldı.');
    });
}

function attachWebviewContextMenu(vw) {
    if (!vw || typeof vw.addEventListener !== 'function' || vw.__ankaCtx) return;
    vw.__ankaCtx = true;

    vw.addEventListener('context-menu', (e) => {
        const p = (e && e.params) || {};
        const rect = vw.getBoundingClientRect();
        let factor = 1;
        try { factor = typeof vw.getZoomFactor === 'function' ? vw.getZoomFactor() || 1 : 1; } catch (err) {}
        const pt = vw.__ankaCtxPoint && Date.now() - vw.__ankaCtxPoint.t < 2000 ? vw.__ankaCtxPoint : null;
        const rawX = pt ? pt.x * factor : (typeof p.x === 'number' ? p.x : 100);
        const rawY = pt ? pt.y * factor : (typeof p.y === 'number' ? p.y : 100);
        const x = rect.left + Math.min(rawX, rect.width);
        const y = rect.top + Math.min(rawY, rect.height);
        const canBack = typeof vw.canGoBack === 'function' && vw.canGoBack();
        const canForward = typeof vw.canGoForward === 'function' && vw.canGoForward();
        const st = ankaStateOfView(vw);
        const url = typeof vw.getURL === 'function' ? vw.getURL() : '';
        const isWeb = /^https?:/i.test(url);
        const bookmarked = ankaBookmarks().some((b) => b.url === url);

        const items = [
            { label: 'Geri', shortcut: 'Alt+←', action: () => vw.goBack(), disabled: !canBack },
            { label: 'İleri', shortcut: 'Alt+→', action: () => vw.goForward(), disabled: !canForward },
            { label: 'Yenile', shortcut: 'Ctrl+R', action: () => vw.reload() },
            '---'
        ];

        if (p.linkURL) {
            items.push({ label: 'Bağlantıyı yeni sekmede aç', action: () => createNewTab(p.linkURL) });
            items.push({ label: 'Bağlantıyı arka planda aç', action: () => createNewTab(p.linkURL, { background: true }) });
            items.push({ label: 'Bağlantıyı gizli pencerede aç', action: () => createIncognitoTab(p.linkURL) });
            items.push({ label: 'Bağlantı adresini kopyala', action: () => ankaCopy(p.linkURL) });
            items.push('---');
        }
        if (p.selectionText) {
            items.push({ label: 'Kopyala', shortcut: 'Ctrl+C', action: () => vw.copy() });
            items.push({ label: 'Web\'de Ara: "' + ankaTruncate(p.selectionText, 15) + '"', action: () => createNewTab(buildSearchUrl(p.selectionText)) });
            items.push({ label: 'Notlara / Panoya Ekle', action: () => saveSelectedTextToStorage(p.selectionText) });
            items.push('---');
        }
        if (p.isEditable) {
            if (p.misspelledWord && Array.isArray(p.dictionarySuggestions)) {
                p.dictionarySuggestions.slice(0, 4).forEach((word) => items.push({ label: word, action: () => vw.replaceMisspelling(word) }));
                items.push('---');
            }
            items.push({ label: 'Geri Al', shortcut: 'Ctrl+Z', action: () => vw.undo() });
            items.push({ label: 'Kes', shortcut: 'Ctrl+X', action: () => vw.cut() });
            if (!p.selectionText) items.push({ label: 'Kopyala', shortcut: 'Ctrl+C', action: () => vw.copy() });
            items.push({ label: 'Yapıştır', shortcut: 'Ctrl+V', action: () => vw.paste() });
            items.push({ label: 'Tümünü Seç', shortcut: 'Ctrl+A', action: () => vw.selectAll() });
            items.push('---');
        }
        if (p.hasImageContents && p.srcURL) {
            items.push({ label: 'Resmi yeni sekmede aç', action: () => createNewTab(p.srcURL) });
            items.push({ label: 'Resim adresini kopyala', action: () => ankaCopy(p.srcURL) });
            items.push({ label: 'Resmi İndir', action: () => downloadFileFromUrl(p.srcURL) });
            items.push({ label: 'Resmi Google Lens ile Ara', action: () => createNewTab('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(p.srcURL)) });
            items.push('---');
        }

        items.push({ label: 'Sayfada Bul', shortcut: 'Ctrl+F', action: () => openFindBar(vw) });
        items.push({ label: bookmarked ? 'Yer İmini Kaldır' : 'Yer İmi Ekle', shortcut: 'Ctrl+D', action: () => toggleBookmark(), disabled: !isWeb });
        items.push({ label: 'Sayfa Adresini Kopyala', shortcut: 'Ctrl+Shift+C', action: () => ankaCopy(url), disabled: !isWeb });
        items.push({ label: 'Sayfa Kaynağını Yanda Gör', shortcut: 'Ctrl+U', action: () => toggleSideViewSource(vw) });
        items.push({ label: 'Sayfayı Bilgisayara Kaydet', shortcut: 'Ctrl+S', action: () => saveCurrentPage(vw) });
        items.push({ label: 'PDF Olarak Kaydet', action: () => savePageAsPdf(vw) });
        items.push({ label: 'Yazdır', shortcut: 'Ctrl+P', action: () => printPage(vw) });
        items.push({ label: 'Ekran Görüntüsü Al', shortcut: 'Ctrl+Shift+S', action: () => takeScreenshot(vw) });
        items.push({ label: 'Sayfayı Türkçeye Çevir', action: () => createNewTab('https://translate.google.com/translate?sl=auto&tl=tr&u=' + encodeURIComponent(url)), disabled: !isWeb });
        items.push({ label: st && st.reader ? 'Okuma Modundan Çık' : 'Okuma Modu', shortcut: 'Ctrl+Shift+E', action: () => toggleReaderMode(vw), disabled: !isWeb || !st });
        items.push({ label: st && st.dark ? 'Karanlık Modu Kapat' : 'Karanlık Modu Aç', shortcut: 'Ctrl+Shift+D', action: () => toggleDarkMode(vw), disabled: !st });
        items.push({ label: 'Sekmeyi Yan Panele Sabitle', action: () => pinToSidePanel(vw) });
        items.push({
            label: 'Geliştirici Araçları',
            submenu: [
                { label: 'İncele', action: () => inspectElementAt(vw, p.x || 0, p.y || 0) },
                '---',
                { label: 'Sağ HTML İnceleyicisi', action: () => toggleSideViewSource(vw, 'right') },
                { label: 'DevTools Kapat', danger: true, action: () => closeDevTools(vw) }
            ]
        });

        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        showContextMenu(x, y, items);
    });
}

function ankaCreateTabEntry(id, o) {
    const tabBar = ankaById('tab-bar');
    const tab = ankaMk('div', { className: o.className || 'tab', id: 'btn-' + id, draggable: 'true', role: 'tab' });
    const icon = ankaMk('img', { className: 'tab-icon', alt: '', draggable: 'false' });
    icon.onerror = () => {
        const candidates = icon.__ankaFaviconCandidates || [];
        const next = (icon.__ankaFaviconIndex || 0) + 1;
        if (next < candidates.length) {
            icon.__ankaFaviconIndex = next;
            icon.dataset.ankaOriginalSrc = candidates[next];
            icon.src = candidates[next];
            return;
        }
        const st = ankaTabs.get(id);
        if (st && ankaLoadNativeFavicon(st, st.vw, icon, icon.src)) return;
        if (icon.dataset.ankaFallback === 'true') return;
        icon.dataset.ankaFallback = 'true';
        icon.src = ANKA_LOGO;
    };
    icon.onload = () => {
        icon.dataset.ankaFallback = 'false';
    };
    icon.dataset.ankaOriginalSrc = o.icon || (window.ankaGetLogo ? window.ankaGetLogo() : ANKA_LOGO);
    icon.__ankaFaviconCandidates = /^https?:/i.test(icon.dataset.ankaOriginalSrc)
        ? [icon.dataset.ankaOriginalSrc]
        : [];
    icon.__ankaFaviconIndex = 0;
    icon.src = /^https?:/i.test(icon.dataset.ankaOriginalSrc)
        ? ankaRefreshFaviconUrl(icon.dataset.ankaOriginalSrc, {})
        : icon.dataset.ankaOriginalSrc;
    const groupEl = ankaMk('span', { className: 'tab-group-label', hidden: true });
    const titleEl = ankaMk('span', { className: 'tab-title', text: o.title });
    const controls = ankaMk('div', { className: 'tab-controls', style: 'display:flex;align-items:center;gap:4px;margin-left:auto;' });
    const muteEl = ankaMk('div', { className: 'mute-tab', title: 'Sesi Aç/Kapat', text: '🔊', style: 'display:none;cursor:pointer;font-size:12px;padding:2px 6px;background:rgba(255,255,255,0.05);border-radius:4px;' });
    muteEl.addEventListener('click', (e) => toggleMute(id, e));
    const closeEl = ankaMk('div', { className: 'close-tab', title: 'Sekmeyi Kapat', style: 'cursor:pointer;display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:rgba(255,71,87,0.2);color:#ff4757;border-radius:4px;' });
    closeEl.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeEl.addEventListener('click', (e) => closeTab(id, e));
    controls.append(muteEl, closeEl);
    tab.append(icon, groupEl, titleEl, controls);

    tab.addEventListener('click', () => switchTab(id));
    tab.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    tab.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            closeTab(id, e);
        }
    });
    tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ankaShowTabMenu(id, e.clientX, e.clientY);
    });

    let hoverTimer = 0;
    tab.addEventListener('mouseenter', () => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => showTabPreview(tab), 550);
    });
    tab.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimer);
        hideTabPreview();
    });

    const memEl = ankaMk('span', { className: 'tab-memory' });
    tab.insertBefore(memEl, controls);
    const st = { id, tab, icon, groupEl, titleEl, muteEl, memEl, vw: null, url: o.url, title: o.title || '', internal: o.internal || '', pinned: false, incognito: !!o.incognito, sleeping: false, lastActive: Date.now(), zoom: 0, dark: false, darkKey: null, reader: false, audible: false, muted: false, loading: false, ai: !!o.ai, lastCrash: 0, group: String(o.group || '').slice(0, 32) };
    ankaTabs.set(id, st);
    if (tabBar) tabBar.append(tab);
    if (st.group) ankaRenderTabGroup(st);
    return st;
}

function ankaUpdateMuteButton(st) {
    const show = st.audible || st.muted;
    st.muteEl.style.display = show ? 'block' : 'none';
    st.muteEl.textContent = st.muted ? '🔇' : '🔊';
    st.muteEl.title = st.muted ? 'Sesi Aç' : 'Sesi Kapat';
    if (typeof ankaRefreshMediaPanel === 'function') ankaRefreshMediaPanel();
}

function ankaMediaTime(value) {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const seconds = Math.floor(value);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function ankaRunMediaScript(st, script) {
    if (!st || !st.vw || typeof st.vw.executeJavaScript !== 'function') return Promise.resolve(null);
    try { return st.vw.executeJavaScript(script).catch(() => null); }
    catch (err) { return Promise.resolve(null); }
}

function ankaUpdateMediaProgress() {
    const panel = document.getElementById('anka-media-panel');
    if (!panel || panel.hidden) return;
    for (const st of ankaTabs.values()) {
        if (!st.vw || (!st.audible && !st.muted)) continue;
        const row = Array.from(panel.querySelectorAll('[data-media-tab]')).find((item) => item.dataset.mediaTab === st.id);
        if (!row) continue;
        ankaRunMediaScript(st, `(()=>{const media=[...document.querySelectorAll('audio,video')].find(item=>!item.paused)||document.querySelector('audio,video');return media?{time:media.currentTime,duration:media.duration}:null})()`).then((state) => {
            if (!state || !row.isConnected) return;
            const time = row.querySelector('[data-media-time]');
            const seek = row.querySelector('[data-media-seek]');
            if (time) time.textContent = ankaMediaTime(state.time) + ' / ' + ankaMediaTime(state.duration);
            if (seek && Number.isFinite(state.duration) && state.duration > 0 && document.activeElement !== seek) {
                seek.value = String(Math.round(state.time / state.duration * 1000));
            }
        }).catch(() => {});
    }
}

function ankaRefreshMediaPanel() {
    const panel = document.getElementById('anka-media-panel');
    if (!panel || panel.hidden) return;
    const list = panel.querySelector('[data-media-list]');
    if (!list) return;
    list.replaceChildren();
    const entries = Array.from(ankaTabs.values()).filter((st) => st.vw && (st.audible || st.muted));
    if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Şu anda ses çalan sekme yok.';
        empty.style.cssText = 'margin:8px 0;padding:16px;text-align:center;opacity:.7';
        list.append(empty);
        return;
    }
    for (const st of entries) {
        const row = document.createElement('article');
        row.dataset.mediaTab = st.id;
        row.style.cssText = 'padding:12px;border:1px solid var(--border-color,#30323a);border-radius:11px;margin:8px 0';
        const title = document.createElement('div');
        title.textContent = st.title || ankaHostLabel(st.url) || 'Sekme';
        title.title = st.url;
        title.style.cssText = 'font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px';
        const tools = document.createElement('div');
        tools.style.cssText = 'display:flex;align-items:center;gap:8px';
        const time = document.createElement('span');
        time.dataset.mediaTime = 'true';
        time.textContent = '—:—';
        time.style.cssText = 'font-size:12px;min-width:76px;opacity:.75';
        const seek = document.createElement('input');
        seek.dataset.mediaSeek = 'true';
        seek.type = 'range';
        seek.min = '0';
        seek.max = '1000';
        seek.value = '0';
        seek.setAttribute('aria-label', 'Medya zamanı');
        seek.style.cssText = 'min-width:60px;flex:1';
        const mute = document.createElement('button');
        mute.type = 'button';
        mute.textContent = st.muted ? 'Sesi Aç' : 'Sessize Al';
        mute.setAttribute('aria-label', st.muted ? 'Sekmenin sesini aç' : 'Sekmeyi sessize al');
        mute.style.cssText = 'min-height:34px;padding:0 9px;border:1px solid var(--border-color,#30323a);border-radius:8px;background:transparent;color:inherit';
        mute.addEventListener('click', () => toggleMute(st.id));
        const volume = document.createElement('input');
        volume.type = 'range';
        volume.min = '0';
        volume.max = '1';
        volume.step = '0.05';
        volume.value = '1';
        volume.setAttribute('aria-label', 'Sekme ses düzeyi');
        volume.style.cssText = 'width:76px';
        volume.addEventListener('input', () => {
            ankaRunMediaScript(st, `(()=>{for(const media of document.querySelectorAll('audio,video'))media.volume=${Number(volume.value)}})()`);
        });
        seek.addEventListener('change', () => {
            ankaRunMediaScript(st, `(()=>{const media=[...document.querySelectorAll('audio,video')].find(item=>!item.paused)||document.querySelector('audio,video');if(media&&Number.isFinite(media.duration))media.currentTime=${Number(seek.value)}/1000*media.duration})()`);
        });
        tools.append(time, seek, volume, mute);
        row.append(title, tools);
        list.append(row);
        ankaRunMediaScript(st, `(()=>{const media=[...document.querySelectorAll('audio,video')].find(item=>!item.paused)||document.querySelector('audio,video');return media?{time:media.currentTime,duration:media.duration,volume:media.volume}:null})()`).then((state) => {
            if (!state || !row.isConnected) return;
            time.textContent = ankaMediaTime(state.time) + ' / ' + ankaMediaTime(state.duration);
            if (Number.isFinite(state.duration) && state.duration > 0) seek.value = String(Math.round(state.time / state.duration * 1000));
            if (Number.isFinite(state.volume)) volume.value = String(state.volume);
        }).catch(() => {});
    }
}

function openMediaCenter() {
    let panel = document.getElementById('anka-media-panel');
    if (panel) {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
            ankaPlaceToolbarPopover(panel, 'media-center-btn');
            ankaRefreshMediaPanel();
        }
        return;
    }
    panel = document.createElement('section');
    panel.id = 'anka-media-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Medya denetimleri');
    panel.style.cssText = 'position:fixed;z-index:2147482000;width:min(470px,calc(100vw - 24px));max-height:75vh;overflow:auto;padding:14px;border:1px solid var(--border-color,#30323a);border-radius:14px;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);box-shadow:0 18px 50px #0008;font:inherit';
    const heading = document.createElement('div');
    heading.dataset.movableHandle = 'true';
    heading.textContent = 'Medya denetimleri';
    heading.style.cssText = 'font-weight:700;font-size:16px;padding:2px 3px 8px';
    const list = document.createElement('div');
    list.dataset.mediaList = 'true';
    panel.append(heading, list);
    document.body.append(panel);
    ankaPlaceToolbarPopover(panel, 'media-center-btn');
    window.setInterval(ankaUpdateMediaProgress, 1000);
    ankaRefreshMediaPanel();
}

function ankaPlaceToolbarPopover(panel, buttonId) {
    const button = document.getElementById(buttonId);
    if (!button || !panel) return;
    const anchor = button.getBoundingClientRect();
    const width = Math.min(470, window.innerWidth - 24);
    panel.style.left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)) + 'px';
    panel.style.top = Math.min(anchor.bottom + 8, Math.max(12, window.innerHeight - Math.min(panel.offsetHeight || 300, window.innerHeight - 24) - 12)) + 'px';
}

window.__ankaCloseTransientMenus = function (target) {
    const media = document.getElementById('anka-media-panel');
    if (media && !media.hidden && !media.contains(target) && (!target || target.id !== 'media-center-btn')) media.hidden = true;
    const site = document.getElementById('anka-site-info-panel');
    if (site && !site.contains(target) && (!target || target.id !== 'site-info-btn')) site.remove();
};

function ankaSetTitle(st, title) {
    st.title = ankaIsNewTabUrl(st.url) ? 'Yeni Sekme' : (title || st.title || '');
    st.titleEl.textContent = ankaTruncate(st.title, 22);
    st.tab.title = (st.group ? '[' + st.group + '] ' : '') + st.title;
}

function ankaSyncTab(st, vw) {
    try {
        const url = vw.getURL();
        if (url) st.url = url;
        if (vw.__ankaReady && typeof syncNewTabTheme === 'function') syncNewTabTheme(vw);
        ankaSetTitle(st, vw.getTitle() || ankaHostLabel(st.url) || 'Yeni Sayfa');
        if (st.id === activeTabId) ankaSyncUrlBar(st);
    } catch (err) {}
}

function ankaOnNavigated(st, vw, url) {
    if (!url) return;
    st.url = url;
    st.faviconReadId = (st.faviconReadId || 0) + 1;
    st.faviconGeneration = (st.faviconGeneration || 0) + 1;
    const favicon = getFaviconUrl(url);
    st.icon.__ankaFaviconCandidates = /^https?:/i.test(favicon) ? [favicon] : [];
    st.icon.__ankaFaviconIndex = 0;
    st.icon.dataset.ankaFallback = 'false';
    st.icon.dataset.ankaOriginalSrc = favicon;
    st.icon.dataset.ankaRetry = 'false';
    st.icon.src = ankaRefreshFaviconUrl(favicon, st);
    if (/^https?:/i.test(favicon)) ankaFetchFaviconData(st, vw, [favicon]);
    st.reader = false;
    const sitePrefs = st.incognito ? {} : ankaReadSiteSettingsForUrl(url);
    if (st.dark && !sitePrefs.dark && st.darkKey) {
        try { vw.removeInsertedCSS(st.darkKey).catch(() => {}); } catch (err) {}
        st.darkKey = null;
    }
    st.dark = sitePrefs.dark === true;
    ankaApplyStoredZoom(st, vw);
    if (st.dark) ankaApplyDark(st, vw);
    ankaRecordHistory(st, url, '');
    if (st.id === activeTabId) {
        ankaSyncUrlBar(st);
        ankaUpdateBookmarkButton();
    }
    ankaRefreshTabFavicon(st, vw);
    ankaPersistSession();
}

function ankaWireTabEvents(st, vw) {
    if (vw.__ankaTabEventsWired) return;
    vw.__ankaTabEventsWired = true;
    vw.addEventListener('dom-ready', () => {
        ankaApplyStoredZoom(st, vw);
        if (st.muted) {
            try { vw.setAudioMuted(true); } catch (err) {}
        }
        if (st.dark) ankaApplyDark(st, vw);
        if (typeof syncNewTabTheme === 'function') syncNewTabTheme(vw);
        ankaRefreshTabFavicon(st, vw);
    });
    vw.addEventListener('page-title-updated', (e) => {
        ankaSetTitle(st, e.title);
        ankaUpdateHistoryTitle(st, st.url, e.title);
    });
    vw.addEventListener('page-favicon-updated', (e) => {
        ankaSetTabFavicon(st, vw, e.favicons || []);
    });
    vw.addEventListener('devtools-opened', () => { st.devToolsOpen = true; });
    vw.addEventListener('devtools-closed', () => { st.devToolsOpen = false; });
    vw.addEventListener('console-message', (event) => {
        if (!event) return;
        let currentUrl = '';
        try { currentUrl = vw.getURL(); } catch (err) {}
        if (!ankaIsWelcomeUrl(currentUrl)) return;
        if (event.message === 'anka-welcome-settings') {
            if (typeof window.toggleSettings === 'function') window.toggleSettings();
            return;
        }
        if (event.message === 'anka-welcome-complete') {
            if (!window.ANKA_PRIVATE_WINDOW) ankaWrite('anka_welcome_completed', true);
            st.url = ankaHomeUrl();
            ankaLoad(vw, st.url);
            if (st.id === activeTabId) ankaSyncUrlBar(st);
        }
    });
    vw.addEventListener('did-start-loading', () => {
        st.loading = true;
        st.tab.classList.add('loading');
        st.tab.classList.remove('crashed');
        if (st.id === activeTabId) ankaSetTabLoadTracking(st, true, true);
    });
    vw.addEventListener('did-stop-loading', () => {
        st.loading = false;
        st.tab.classList.remove('loading');
        if (ankaLoadTrackingView === vw) ankaUnwireTabLoading(st, vw);
        if (st.id === activeTabId) {
            ankaSyncTab(st, vw);
            if (typeof window.__ankaScheduleStar === 'function') window.__ankaScheduleStar();
        }
    });
    const onNav = (e) => {
        if (e.isMainFrame === false) return;
        ankaOnNavigated(st, vw, e.url);
    };
    vw.addEventListener('did-navigate', onNav);
    vw.addEventListener('did-navigate-in-page', onNav);
    vw.addEventListener('media-started-playing', () => {
        st.audible = true;
        ankaUpdateMuteButton(st);
    });
    vw.addEventListener('media-paused', () => {
        st.audible = false;
        ankaUpdateMuteButton(st);
    });
    const onCrash = () => {
        st.tab.classList.add('crashed');
        showNotification('Sekme beklenmedik şekilde kapandı.');
        const now = Date.now();
        if (now - st.lastCrash > 10000) {
            st.lastCrash = now;
            setTimeout(() => {
                try { vw.reload(); } catch (err) {}
            }, 500);
        }
    };
    vw.addEventListener('render-process-gone', onCrash);
    vw.addEventListener('crashed', onCrash);
    vw.addEventListener('enter-html-full-screen', () => {
        vw.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2000000;display:block;';
    });
    vw.addEventListener('leave-html-full-screen', () => {
        vw.style.cssText = 'display:block; width:100%; height:100%; flex:1;';
    });
    vw.addEventListener('focus', () => closeContextMenu());
    if (st.muted && typeof vw.setAudioMuted === 'function') vw.setAudioMuted(true);
}

function ankaUnwireTabLoading(st, vw) {
    if (!vw || ankaLoadTrackingView !== vw) return;
    if (ankaLoadPollTimer) clearInterval(ankaLoadPollTimer);
    ankaLoadPollTimer = 0;
    ankaLoadTrackingView = null;
}

function ankaSetTabLoadTracking(st, enabled, forceLoading) {
    const vw = st && st.vw;
    if (!vw) return;
    if (!enabled) {
        ankaUnwireTabLoading(st, vw);
        return;
    }
    if (ankaLoadTrackingView !== vw) {
        if (ankaLoadPollTimer) clearInterval(ankaLoadPollTimer);
        ankaLoadPollTimer = 0;
        ankaLoadTrackingView = vw;
    }
    let loading = !!forceLoading;
    if (!forceLoading) {
        loading = st.loading;
        try { loading = vw.isLoading(); }
        catch (err) {
            console.error('Sekme yükleme durumu alınamadı:', err);
            loading = false;
        }
    }
    st.loading = !!loading;
    st.tab.classList.toggle('loading', st.loading);
    if (!st.loading) {
        if (ankaLoadPollTimer) clearInterval(ankaLoadPollTimer);
        ankaLoadPollTimer = 0;
        ankaSyncTab(st, vw);
        if (typeof window.__ankaScheduleStar === 'function') window.__ankaScheduleStar();
        return;
    }
    if (ankaLoadPollTimer) return;
    ankaLoadPollTimer = setInterval(() => {
        if (ankaLoadTrackingView !== vw || activeTabId !== st.id || st.vw !== vw) {
            ankaUnwireTabLoading(st, vw);
            return;
        }
        let stillLoading;
        try { stillLoading = vw.isLoading(); }
        catch (err) {
            console.error('Sekme yükleme durumu alınamadı:', err);
            ankaUnwireTabLoading(st, vw);
            return;
        }
        if (stillLoading) return;
        st.loading = false;
        st.tab.classList.remove('loading');
        ankaUnwireTabLoading(st, vw);
        ankaSyncTab(st, vw);
        if (typeof window.__ankaScheduleStar === 'function') window.__ankaScheduleStar();
    }, 250);
}

function ankaWake(st) {
    if (st.vw) return st.vw;
    const container = ankaById('wv-container');
    if (!container) return null;
    const vw = ankaBuildWebview(st.id, {
        partition: st.incognito
            ? 'ankaprivate-' + st.id
            : window.ANKA_PROFILE_ISOLATION && window.ANKA_PROFILE_ID && window.ANKA_PROFILE_ID !== 'default'
                ? 'persist:anka-profile-' + window.ANKA_PROFILE_ID
                : '',
        url: st.url,
        incognito: st.incognito,
        preload: ankaIsNewTabUrl(st.url) && window.__ankaGuestPreload ? window.__ankaGuestPreload : ''
    });
    st.vw = vw;
    st.sleeping = false;
    st.tab.classList.remove('sleeping');
    applyMandatorySecurity(vw);
    attachWebviewContextMenu(vw);
    ankaWireTabEvents(st, vw);
    container.append(vw);
    vw.setAttribute('src', st.url);
    if (st.id === activeTabId) ankaSetTabLoadTracking(st, true);
    return vw;
}

function ankaSleepTab(st) {
    if (!st || !st.vw || st.id === activeTabId || st.ai || st.vw.classList.contains('split-visible')) return false;
    try { st.url = st.vw.getURL() || st.url; } catch (err) {}
    ankaUnwireTabLoading(st, st.vw);
    st.vw.remove();
    st.vw = null;
    st.sleeping = true;
    st.loading = false;
    st.audible = false;
    st.reader = false;
    st.tab.classList.remove('loading');
    st.tab.classList.add('sleeping');
    ankaUpdateMuteButton(st);
    if (getSetting('restore-session', 'false') === 'true' || getSetting('disk-backed-tab-saver', 'false') === 'true') {
        ankaPersistSession();
    }
    return true;
}

function ankaStartSleepTimer() {
    setInterval(() => {
        ankaEnforceLiveLimit();
        const memorySaver = getSetting('memory-saver', 'false') === 'true';
        const smartManager = getSetting('smart-tab-manager', 'false') === 'true';
        const diskSaver = getSetting('disk-backed-tab-saver', 'false') === 'true';
        if (!memorySaver && !smartManager && !diskSaver) return;
        const configuredMinutes = parseInt(getSetting('tab-sleep-minutes', '20'), 10);
        const minutes = memorySaver ? configuredMinutes : Math.min(configuredMinutes || 10, 10);
        if (minutes > 0 && ankaTabs.size > 1) {
            const cutoff = Date.now() - minutes * 60000;
            ankaTabs.forEach((st) => {
                if (st.vw && !st.audible && !st.loading && st.lastActive < cutoff) ankaSleepTab(st);
            });
        }
        if ((!smartManager && !diskSaver) || Date.now() - lastMemoryPressureCheck < 30000) return;
        lastMemoryPressureCheck = Date.now();
        let ipc = null;
        try { ipc = require('electron').ipcRenderer; } catch (err) {}
        if (!ipc || typeof ipc.invoke !== 'function') return;
        ipc.invoke('get-memory-pressure').then((memory) => {
            if (!memory || !(memory.totalBytes > 0) || memory.freeBytes / memory.totalBytes >= 0.12) return;
            const candidates = Array.from(ankaTabs.values())
                .filter((st) => st.vw && st.id !== activeTabId && !st.ai && !st.audible && !st.loading &&
                    !st.vw.classList.contains('split-visible'))
                .sort((a, b) => a.lastActive - b.lastActive);
            for (const st of candidates.slice(0, 3)) ankaSleepTab(st);
            if (candidates.length) ankaPersistSession();
        }).catch((err) => console.error('Bellek durumu denetlenemedi:', err));
    }, 15000);
}

function ankaEnforceLiveLimit() {
    const limit = parseInt(getSetting('max-live-tabs', getSetting('max-tabs', '10')), 10);
    if (!(limit > 0)) return;
    const live = [];
    let total = 0;
    ankaTabs.forEach((st) => {
        if (!st.vw) return;
        total += 1;
        if (st.id !== activeTabId && !st.ai && !st.audible && !st.loading &&
            !(st.vw.classList && st.vw.classList.contains('split-visible'))) live.push(st);
    });
    let excess = total - limit;
    if (excess <= 0) return;
    live.sort((a, b) => a.lastActive - b.lastActive);
    for (const st of live) {
        if (excess <= 0) break;
        if (ankaSleepTab(st)) excess -= 1;
    }
}

function ankaReleaseMemory() {
    let count = 0;
    ankaTabs.forEach((st) => {
        if (st.vw && !st.audible && !st.loading && ankaSleepTab(st)) count += 1;
    });
    showNotification(count ? count + ' sekme uyutuldu.' : 'Uyutulacak sekme yok.');
}

window.__ankaApplyLimits = function () {
    ankaEnforceLiveLimit();
    if (getSetting('disk-backed-tab-saver', 'false') === 'true') ankaPersistSession();
};

let ankaPreviewEl = null;
let ankaPreviewTimer = 0;

function ensureTabPreview() {
    if (ankaPreviewEl && ankaPreviewEl.isConnected) return ankaPreviewEl;
    ankaPreviewEl = ankaMk('div', { id: 'anka-tab-preview', className: 'anka-tab-preview' });
    ankaPreviewEl.hidden = true;
    document.body.append(ankaPreviewEl);
    return ankaPreviewEl;
}

function showTabPreview(tabEl) {
    if (!tabEl || !tabEl.isConnected) return;
    const id = tabEl.id.replace(/^btn-/, '');
    const st = ankaTabs.get(id);
    if (!st) return;
    const el = ensureTabPreview();
    el.replaceChildren();
    const titleEl = ankaMk('div', { className: 'anka-tab-preview-title', text: st.title || ankaHostLabel(st.url) || 'Yeni Sekme' });
    const urlEl = ankaMk('div', { className: 'anka-tab-preview-url', text: st.url || '' });
    if (st.vw && typeof st.vw.capturePage === 'function' && st.vw.__ankaReady) {
        try {
            st.vw.capturePage().then((img) => {
                if (!img || !el.isConnected) return;
                try {
                    const size = img.getSize();
                    const thumbW = 280;
                    const thumbH = Math.max(120, Math.round(thumbW * (size.height / (size.width || thumbW))));
                    const thumb = img.resize({ width: thumbW, height: thumbH });
                    const imgEl = ankaMk('img', { className: 'anka-tab-preview-img' });
                    imgEl.src = thumb.toDataURL();
                    el.insertBefore(imgEl, titleEl);
                } catch (e) {}
            }).catch(() => {});
        } catch (err) {}
    }
    el.append(titleEl, urlEl);
    const r = tabEl.getBoundingClientRect();
    el.hidden = false;
    const pw = 300;
    el.style.width = pw + 'px';
    let left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
    el.style.left = left + 'px';
    const ph = el.offsetHeight || 180;
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    el.style.top = Math.max(8, top) + 'px';
}

function hideTabPreview() {
    clearTimeout(ankaPreviewTimer);
    if (ankaPreviewEl) ankaPreviewEl.hidden = true;
}

const ANKA_COMMANDS = [
        { id: 'quick-access', label: 'Hızlı Erişim Menüsü', desc: 'Soldan açılan araç menüsü', shortcut: 'Ctrl+Shift+Q', run: () => window.openQuickAccessMenu() },
    { id: 'new-tab', label: 'Yeni Sekme', desc: 'Yeni bir sekme aç', shortcut: 'Ctrl+T', run: () => createNewTab(ankaHomeUrl()) },
    { id: 'incognito', label: 'Gizli Sekme', desc: 'Yeni gizli sekme aç', shortcut: 'Ctrl+Shift+N', run: () => createIncognitoTab() },
    { id: 'close-tab', label: 'Sekmeyi Kapat', desc: 'Aktif sekmeyi kapat', shortcut: 'Ctrl+W', run: () => { if (activeTabId) closeTab(activeTabId); } },
    { id: 'reopen-tab', label: 'Kapanan Sekmeyi Aç', desc: 'Son kapatılan sekmeyi yeniden aç', shortcut: 'Ctrl+Shift+T', run: () => reopenClosedTab() },
    { id: 'reload', label: 'Yenile', desc: 'Aktif sekmeyi yenile', shortcut: 'Ctrl+R', run: () => reloadPage() },
    { id: 'hard-reload', label: 'Sert Yenile', desc: 'Önbelleği atlayarak yenile', shortcut: 'Ctrl+Shift+R', run: () => hardReload(ankaActiveView()) },
    { id: 'find', label: 'Sayfada Bul', desc: 'Sayfada metin ara', shortcut: 'Ctrl+F', run: () => openFindBar(ankaActiveView()) },
    { id: 'bookmark', label: 'Yer İmi Ekle / Kaldır', desc: 'Sayfayı yer imlerine ekle veya kaldır', shortcut: 'Ctrl+D', run: () => toggleBookmark() },
    { id: 'bookmarks', label: 'Yer İmlerini Aç', desc: 'Yer imlerini görüntüle', shortcut: 'Ctrl+Shift+B', run: () => openBookmarksPanel() },
    { id: 'history', label: 'Geçmiş', desc: 'Gezinti geçmişini aç', shortcut: 'Ctrl+H', run: () => { if (typeof window.__ankaOpenHistory === 'function') window.__ankaOpenHistory(); else openHistoryPanel(); } },
    { id: 'tab-groups', label: 'Sekme Grubu Yöneticisi', desc: 'Grupları oluştur, yeniden adlandır, düzenle veya kapat', run: () => window.__ankaManageTabGroups() },
    { id: 'settings', label: 'Ayarlar', desc: 'Ayarlar panelini aç', shortcut: 'Ctrl+,', run: () => { if (typeof toggleSettings === 'function') toggleSettings(); } },
    { id: 'downloads', label: 'İndirilenler', desc: 'İndirilenler panelini aç', shortcut: 'Ctrl+J', run: () => { if (typeof window.openAnkaPage === 'function') window.openAnkaPage('downloads'); } },
    { id: 'help', label: 'Yardım', desc: 'Yardım panelini aç', shortcut: 'F1', run: () => { if (typeof window.openAnkaPage === 'function') window.openAnkaPage('help'); else if (typeof toggleHelp === 'function') toggleHelp(); } },
    { id: 'devtools-toggle', label: 'DevTools Aç / Kapat', desc: 'Geliştirici araçlarını sağ panelde aç veya kapat', shortcut: 'Ctrl+Shift+I', run: () => ankaOpenDevTools(ankaActiveView()) },
    { id: 'devtools-source', label: 'HTML İnceleyicisi — Sağ Panel', desc: 'Sayfanın HTML kaynağını sağ panelde göster', shortcut: 'Ctrl+U', run: () => toggleSideViewSource(ankaActiveView(), 'right') },
    { id: 'devtools-close', label: 'DevTools — Kapat', desc: 'DevTools penceresini kapat', run: () => closeDevTools(ankaActiveView()) },
    { id: 'devtools-menu', label: 'DevTools — Tüm Seçenekler', desc: 'Tüm DevTools seçenekleri menüsü', run: () => openDevToolsMenu(ankaActiveView()) },
    { id: 'zoom-in', label: 'Yakınlaştır', desc: 'Sayfayı yakınlaştır', shortcut: 'Ctrl++', run: () => ankaZoom(0.5) },
    { id: 'zoom-out', label: 'Uzaklaştır', desc: 'Sayfayı uzaklaştır', shortcut: 'Ctrl+-', run: () => ankaZoom(-0.5) },
    { id: 'zoom-reset', label: 'Yakınlaştırmayı Sıfırla', desc: 'Yakınlaştırmayı %100 yap', shortcut: 'Ctrl+0', run: () => ankaZoom(null) },
    { id: 'fullscreen', label: 'Tam Ekran', desc: 'Tam ekran modunu aç/kapat', shortcut: 'F11', run: () => toggleFullscreen() },
    { id: 'print', label: 'Yazdır', desc: 'Sayfayı yazdır', shortcut: 'Ctrl+P', run: () => printPage(ankaActiveView()) },
    { id: 'save-pdf', label: 'PDF Olarak Kaydet', desc: 'Sayfayı PDF olarak kaydet', run: () => savePageAsPdf(ankaActiveView()) },
    { id: 'save-html', label: 'Sayfayı HTML Kaydet', desc: 'Sayfayı HTML olarak kaydet', shortcut: 'Ctrl+S', run: () => saveCurrentPage(ankaActiveView()) },
    { id: 'screenshot', label: 'Ekran Görüntüsü', desc: 'Sayfanın ekran görüntüsünü al', shortcut: 'Ctrl+Shift+S', run: () => takeScreenshot(ankaActiveView()) },
    { id: 'reader', label: 'Okuma Modu', desc: 'Okuma modunu aç/kapat', shortcut: 'Ctrl+Shift+E', run: () => toggleReaderMode(ankaActiveView()) },
    { id: 'dark', label: 'Karanlık Mod', desc: 'Sayfa karanlık modunu aç/kapat', shortcut: 'Ctrl+Shift+D', run: () => toggleDarkMode(ankaActiveView()) },
    { id: 'mute', label: 'Sesi Aç / Kapat', desc: 'Aktif sekmenin sesini aç/kapat', shortcut: 'Ctrl+Shift+M', run: () => { if (activeTabId) toggleMute(activeTabId); } },
    { id: 'pin', label: 'Sekmeyi Sabitle', desc: 'Aktif sekmeyi sabitle', shortcut: 'Ctrl+Shift+K', run: () => { if (activeTabId) togglePinTab(activeTabId); } },
    { id: 'duplicate', label: 'Sekmeyi Çoğalt', desc: 'Aktif sekmeyi çoğalt', run: () => { if (activeTabId) duplicateTab(activeTabId); } },
    { id: 'sleep-tabs', label: 'Sekmeleri Uyut', desc: 'Arka plan sekmelerini uyut', shortcut: 'Ctrl+Shift+G', run: () => ankaReleaseMemory() },
    { id: 'tab-search', label: 'Sekme Ara', desc: 'Açık sekmeler arasında ara', shortcut: 'Ctrl+Shift+A', run: () => openTabSearch() },
    { id: 'sessions', label: 'Oturum Yöneticisi', desc: 'Oturumları yönet', shortcut: 'Ctrl+Shift+O', run: () => openSessionManager() },
    { id: 'copy-url', label: 'Adresi Kopyala', desc: 'Aktif sayfanın adresini kopyala', shortcut: 'Ctrl+Shift+C', run: () => ankaCopyActiveUrl() },
    { id: 'clear-data', label: 'Verileri Temizle', desc: 'Gezinti verilerini temizle', shortcut: 'Ctrl+Shift+Del', run: () => clearBrowsingData() },
    { id: 'pick-file', label: 'Dosya Aç', desc: 'Bilgisayardan dosya aç', shortcut: 'Ctrl+O', run: () => ankaPickLocalFile() },
    { id: 'default-browser', label: 'Varsayılan Tarayıcı Yap', desc: 'Anka Web\'i varsayılan yap', run: () => ankaSetDefaultBrowser() },
    { id: 'close-others', label: 'Diğer Sekmeleri Kapat', desc: 'Aktif hariç tümünü kapat', run: () => { if (activeTabId) closeOtherTabs(activeTabId); } },
    { id: 'close-right', label: 'Sağdaki Sekmeleri Kapat', desc: 'Aktif sekmenin sağındakileri kapat', run: () => { if (activeTabId) closeTabsToRight(activeTabId); } },
    { id: 'pin-side', label: 'Yan Panele Sabitle', desc: 'Aktif sayfayı yan panele sabitle', run: () => pinToSidePanel(ankaActiveView()) },
    { id: 'ai-session', label: 'AI Asistanı Aç', desc: 'AI asistan sekmesini aç', run: () => openAISession() },
    { id: 'toggle-ai-mode', label: 'AI Modunu Aç / Kapat', desc: 'Adres çubuğu AI modunu değiştir', run: () => toggleAiMode() }
];

let ankaCmdState = null;

function openCommandPalette() {
    if (ankaCmdState) {
        closeCommandPalette();
        return;
    }
    ankaCloseOverlay();
    const overlay = ankaMk('div', { className: 'anka-overlay anka-cmd-overlay', id: 'anka-cmd-overlay' });
    const panel = ankaMk('section', { className: 'anka-cmd-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Komut Paleti' });
    const input = ankaMk('input', { className: 'anka-cmd-input', type: 'text', placeholder: 'Komut ara... (yaz veya listeden seç)', autocomplete: 'off', spellcheck: 'false' });
    const list = ankaMk('div', { className: 'anka-cmd-list', role: 'listbox' });
    panel.append(input, list);
    overlay.append(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) closeCommandPalette(); });
    document.body.append(overlay);

    let idx = 0;
    let filtered = ANKA_COMMANDS.slice();

    const mark = () => {
        Array.from(list.children).forEach((r, i) => r.classList.toggle('active', i === idx));
        if (list.children[idx]) list.children[idx].scrollIntoView({ block: 'nearest' });
    };

    const fuzzyMatch = (text, query) => {
        const t = text.toLowerCase();
        const q = query.toLowerCase();
        if (!q) return true;
        if (t.includes(q)) return true;
        let ti = 0;
        for (let qi = 0; qi < q.length; qi++) {
            ti = t.indexOf(q[qi], ti);
            if (ti < 0) return false;
            ti++;
        }
        return true;
    };

    const render = () => {
        list.replaceChildren();
        filtered.forEach((cmd, i) => {
            const row = ankaMk('div', { className: 'anka-cmd-row' + (i === idx ? ' active' : ''), role: 'option' },
                ankaMk('div', { className: 'anka-cmd-row-main' },
                    ankaMk('span', { className: 'anka-cmd-row-label', text: cmd.label }),
                    ankaMk('span', { className: 'anka-cmd-row-desc', text: cmd.desc || '' })
                )
            );
            if (cmd.shortcut) row.append(ankaMk('span', { className: 'anka-cmd-shortcut', text: cmd.shortcut }));
            row.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                closeCommandPalette();
                try { cmd.run(); } catch (err) {}
            });
            list.append(row);
        });
        if (!filtered.length) {
            list.append(ankaMk('div', { className: 'anka-cmd-empty', text: 'Komut bulunamadı.' }));
        }
        mark();
    };

    const update = ankaDebounce(() => {
        const q = input.value.trim();
        filtered = q ? ANKA_COMMANDS.filter((c) => fuzzyMatch(c.label, q) || fuzzyMatch(c.desc || '', q)) : ANKA_COMMANDS.slice();
        idx = 0;
        render();
    }, 50);

    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filtered.length) { idx = (idx + 1) % filtered.length; mark(); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filtered.length) { idx = (idx - 1 + filtered.length) % filtered.length; mark(); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[idx]) {
                const cmd = filtered[idx];
                closeCommandPalette();
                try { cmd.run(); } catch (err) {}
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeCommandPalette();
        }
    });

    ankaCmdState = { overlay, panel, input, list };
    render();
    input.focus();
}

function closeCommandPalette() {
    if (!ankaCmdState) return;
    ankaCmdState.overlay.remove();
    ankaCmdState = null;
}

function ankaCqaEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let ankaCqaHideTimer = 0;
let ankaCqaActiveItem = null;
let ankaCqaTouchMode = false;
try { ankaCqaTouchMode = window.matchMedia('(hover: none)').matches; } catch (e) {}

function ankaCqaCloseSubmenu() {
    const sub = document.getElementById('anka-cqa-submenu');
    if (sub) sub.remove();
    if (ankaCqaActiveItem) ankaCqaActiveItem.classList.remove('active');
    ankaCqaActiveItem = null;
    clearTimeout(ankaCqaHideTimer);
}

function ankaCqaScheduleHide() {
    clearTimeout(ankaCqaHideTimer);
    ankaCqaHideTimer = setTimeout(ankaCqaCloseSubmenu, 220);
}

function ankaCqaCancelHide() {
    clearTimeout(ankaCqaHideTimer);
}

function ankaCqaPositionSubmenu(item, sub) {
    const panel = document.querySelector('.anka-cqa-panel');
    if (!panel) return;
    const itemRect = item.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const subWidth = sub.offsetWidth || 400;
    const subHeight = sub.offsetHeight || 300;
    let left = panelRect.right + 6;
    if (left + subWidth > window.innerWidth - 12) left = panelRect.left - subWidth - 6;
    if (left < 12) left = 12;
    let top = itemRect.top;
    if (top + subHeight > window.innerHeight - 12) top = Math.max(12, window.innerHeight - subHeight - 12);
    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
}

function ankaCqaBuildSubmenu(type, item) {
    ankaCqaCloseSubmenu();
    item.classList.add('active');
    ankaCqaActiveItem = item;
    const sub = ankaMk('div', { id: 'anka-cqa-submenu', className: 'anka-cqa-submenu' });
    let title = '';
    let listHtml = '';
    let footLabel = '';
    let footAction = null;

    if (type === 'history') {
        title = 'Geçmiş';
        const list = ankaHistory().slice(0, 12);
        if (!list.length) listHtml = '<div class="anka-cqa-submenu-empty">Henüz geçmiş yok.</div>';
        else listHtml = list.map((h) => {
            const host = ankaHostLabel(h.url) || h.url;
            const t = h.title || host;
            return `<button class="anka-cqa-submenu-item" data-url="${ankaCqaEsc(h.url)}"><img class="anka-cqa-submenu-fav" src="${ankaCqaEsc(getFaviconUrl(h.url))}" alt=""><div class="anka-cqa-submenu-main"><strong>${ankaCqaEsc(t)}</strong><small>${ankaCqaEsc(host)}</small></div></button>`;
        }).join('');
        footLabel = 'Tüm geçmişi gör';
        footAction = () => { closeQuickAccessMenu(); openHistoryPanel(); };
    } else if (type === 'bookmarks') {
        title = 'Yer işaretleri';
        const list = ankaBookmarks().slice(0, 12);
        if (!list.length) listHtml = '<div class="anka-cqa-submenu-empty">Henüz yer işareti yok.</div>';
        else listHtml = list.map((b) => {
            const host = ankaHostLabel(b.url) || b.url;
            const t = b.title || host;
            return `<button class="anka-cqa-submenu-item" data-url="${ankaCqaEsc(b.url)}"><img class="anka-cqa-submenu-fav" src="${ankaCqaEsc(getFaviconUrl(b.url))}" alt=""><div class="anka-cqa-submenu-main"><strong>${ankaCqaEsc(t)}</strong><small>${ankaCqaEsc(host)}</small></div></button>`;
        }).join('');
        footLabel = 'Tüm yer işaretleri';
        footAction = () => { closeQuickAccessMenu(); openBookmarksPanel(); };
    } else if (type === 'passwords') {
        title = 'Şifreler ve otomatik doldurma';
        listHtml = '<div class="anka-cqa-submenu-empty">Yükleniyor…</div>';
        footLabel = 'Parola yöneticisi';
        footAction = () => { closeQuickAccessMenu(); if (typeof window.openPasswordManager === 'function') window.openPasswordManager(); };
    } else if (type === 'tabgroups') {
        title = 'Sekme grupları';
        const groups = window.__ankaGetTabGroups ? window.__ankaGetTabGroups() : [];
        if (!groups.length) listHtml = '<div class="anka-cqa-submenu-empty">Henüz sekme grubu yok.</div>';
        else listHtml = groups.slice(0, 12).map((g) => `<button class="anka-cqa-submenu-item" data-group="${ankaCqaEsc(g.name)}"><span class="anka-cqa-submenu-fav" style="background:var(--anka-accent)"></span><div class="anka-cqa-submenu-main"><strong>${ankaCqaEsc(g.name)}</strong><small>${g.tabs.length} sekme</small></div></button>`).join('');
        footLabel = 'Grupları yönet';
        footAction = () => { closeQuickAccessMenu(); if (typeof window.__ankaManageTabGroups === 'function') window.__ankaManageTabGroups(); };
    } else if (type === 'downloads') {
        title = 'İndirilenler';
        listHtml = '<div class="anka-cqa-submenu-empty">Yükleniyor…</div>';
        footLabel = 'Tüm indirilenler';
        footAction = () => { closeQuickAccessMenu(); if (typeof window.openAnkaPage === 'function') window.openAnkaPage('downloads'); };
    }

    sub.innerHTML = `<div class="anka-cqa-submenu-header"><span>${ankaCqaEsc(title)}</span></div><div class="anka-cqa-submenu-list">${listHtml}</div>`;
    if (footAction) {
        const foot = ankaMk('div', { className: 'anka-cqa-submenu-foot' });
        const btn = ankaMk('button', { type: 'button', text: footLabel });
        btn.addEventListener('click', footAction);
        foot.append(btn);
        sub.append(foot);
    }

    sub.addEventListener('mouseenter', ankaCqaCancelHide);
    sub.addEventListener('mouseleave', (e) => {
        const to = e.relatedTarget;
        if (to && to.closest && to.closest('.anka-cqa-item.has-submenu')) return;
        ankaCqaScheduleHide();
    });

    sub.addEventListener('click', (e) => {
        const btn = e.target.closest('.anka-cqa-submenu-item');
        if (!btn) return;
        const url = btn.getAttribute('data-url');
        const group = btn.getAttribute('data-group');
        if (url) { closeQuickAccessMenu(); createNewTab(url); }
        else if (group) {
            const groups = window.__ankaGetTabGroups ? window.__ankaGetTabGroups() : [];
            const g = groups.find((x) => x.name === group);
            closeQuickAccessMenu();
            if (g && g.tabs[0]) switchTab(g.tabs[0].id);
        }
    });

    document.body.append(sub);
    requestAnimationFrame(() => {
        ankaCqaPositionSubmenu(item, sub);
        sub.classList.add('show');
    });

    if (type === 'passwords' && ankaBridgeApi()) {
        const bridge = ankaBridgeApi();
        bridge.invoke('password-manager:list').then((result) => {
            const listEl = sub.querySelector('.anka-cqa-submenu-list');
            if (!listEl || !sub.isConnected) return;
            if (!result || !result.ok || !Array.isArray(result.entries) || !result.entries.length) {
                listEl.innerHTML = '<div class="anka-cqa-submenu-empty">Kayıtlı şifre yok.</div>';
                return;
            }
            listEl.innerHTML = result.entries.slice(0, 12).map((entry) => {
                const host = ankaHostLabel(entry.origin) || entry.origin;
                return `<button class="anka-cqa-submenu-item" data-pw="1"><img class="anka-cqa-submenu-fav" src="${ankaCqaEsc(getFaviconUrl(entry.origin))}" alt=""><div class="anka-cqa-submenu-main"><strong>${ankaCqaEsc(host)}</strong><small>${ankaCqaEsc(entry.username)}</small></div></button>`;
            }).join('');
            listEl.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => { closeQuickAccessMenu(); if (typeof window.openPasswordManager === 'function') window.openPasswordManager(); }));
            ankaCqaPositionSubmenu(item, sub);
        }).catch(() => {
            const listEl = sub.querySelector('.anka-cqa-submenu-list');
            if (listEl) listEl.innerHTML = '<div class="anka-cqa-submenu-empty">Şifreler yüklenemedi.</div>';
        });
    } else if (type === 'downloads' && ankaBridgeApi()) {
        const bridge = ankaBridgeApi();
        bridge.invoke('get-downloads-list').then((list) => {
            const listEl = sub.querySelector('.anka-cqa-submenu-list');
            if (!listEl || !sub.isConnected) return;
            if (!Array.isArray(list) || !list.length) {
                listEl.innerHTML = '<div class="anka-cqa-submenu-empty">Henüz indirme yok.</div>';
                return;
            }
            listEl.innerHTML = list.slice(0, 12).map((d) => {
                const state = d.state === 'completed' ? 'Tamamlandı' : d.state === 'progressing' ? 'İndiriliyor' : 'İptal edildi';
                return `<button class="anka-cqa-submenu-item" data-dl="${ankaCqaEsc(String(d.id))}"><span class="anka-cqa-submenu-fav" style="background:var(--anka-accent)"></span><div class="anka-cqa-submenu-main"><strong>${ankaCqaEsc(d.fileName)}</strong><small>${state}</small></div></button>`;
            }).join('');
            listEl.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => {
                const id = b.getAttribute('data-dl');
                closeQuickAccessMenu();
                if (bridge && typeof bridge.invoke === 'function') bridge.invoke('open-download-item', id).catch(() => {});
            }));
            ankaCqaPositionSubmenu(item, sub);
        }).catch(() => {
            const listEl = sub.querySelector('.anka-cqa-submenu-list');
            if (listEl) listEl.innerHTML = '<div class="anka-cqa-submenu-empty">İndirilenler yüklenemedi.</div>';
        });
    }
}

function closeQuickAccessMenu() {
    ankaCqaCloseSubmenu();
    const root = document.getElementById('anka-quick-access');
    if (!root) return false;
    root.classList.remove('open');
    setTimeout(() => { if (root.parentNode) root.remove(); }, 200);
    return true;
}
window.__ankaCloseQuickAccess = closeQuickAccessMenu;

window.openQuickAccessMenu = function () {
    if (document.getElementById('anka-quick-access')) { closeQuickAccessMenu(); return; }
    const overlay = ankaMk('div', { id: 'anka-quick-access', className: 'anka-cqa-overlay' });
    const panel = ankaMk('aside', { className: 'anka-cqa-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hızlı Erişim' });
    const header = ankaMk('div', { className: 'anka-cqa-header' },
        ankaMk('img', { className: 'anka-cqa-logo', src: window.ankaGetLogo ? window.ankaGetLogo() : ANKA_LOGO, alt: '' }),
        ankaMk('span', { className: 'anka-cqa-title', text: 'Anka Web' })
    );
    panel.append(header);

    const openWin = (incog) => {
        closeQuickAccessMenu();
        const bridge = ankaBridgeApi();
        if (bridge && typeof bridge.invoke === 'function') bridge.invoke('open-browser-window', incog ? { incognito: true } : { profileId: 'default' }).catch(() => {});
        else if (incog) createIncognitoTab();
        else showNotification('Yeni pencere bu ortamda desteklenmiyor.');
    };

    const items = [
        { icon: '＋', label: 'Yeni sekme', run: () => { closeQuickAccessMenu(); createNewTab(ankaHomeUrl()); } },
        { icon: '❐', label: 'Yeni pencere', run: () => openWin(false) },
        { icon: '◐', label: 'Gizli pencere', run: () => openWin(true) },
        '---',
        { icon: '◷', label: 'Geçmiş', submenuType: 'history' },
        { icon: '★', label: 'Yer işaretleri ve listeler', submenuType: 'bookmarks' },
        { icon: '⚿', label: 'Şifreler ve otomatik doldurma', submenuType: 'passwords' },
        { icon: '◫', label: 'Sekme grupları', submenuType: 'tabgroups' },
        { icon: '↓', label: 'İndirilenler', submenuType: 'downloads' },
        '---',
        { icon: '⌕', label: 'Sekme ara', run: () => { closeQuickAccessMenu(); openTabSearch(); } },
        { icon: '◧', label: 'Oturumlar', run: () => { closeQuickAccessMenu(); openSessionManager(); } },
        { icon: '♪', label: 'Medya denetimi', run: () => { closeQuickAccessMenu(); openMediaCenter(); } },
        { icon: '◇', label: 'Okuma modu', run: () => { closeQuickAccessMenu(); toggleReaderMode(ankaActiveView()); } },
        { icon: '◈', label: 'Karanlık mod', run: () => { closeQuickAccessMenu(); toggleDarkMode(ankaActiveView()); } },
        { icon: '⌦', label: 'Verileri temizle', run: () => { closeQuickAccessMenu(); clearBrowsingData(); } },
        '---',
        { icon: '⚙', label: 'Ayarlar', run: () => { closeQuickAccessMenu(); if (typeof toggleSettings === 'function') toggleSettings(); } },
        { icon: '?', label: 'Yardım', run: () => { closeQuickAccessMenu(); if (typeof window.openAnkaPage === 'function') window.openAnkaPage('help'); } }
    ];

    const fullActions = {
        history: () => openHistoryPanel(),
        bookmarks: () => openBookmarksPanel(),
        passwords: () => { if (typeof window.openPasswordManager === 'function') window.openPasswordManager(); },
        tabgroups: () => { if (typeof window.__ankaManageTabGroups === 'function') window.__ankaManageTabGroups(); },
        downloads: () => { if (typeof window.openAnkaPage === 'function') window.openAnkaPage('downloads'); }
    };

    items.forEach((item) => {
        if (item === '---') { panel.append(ankaMk('div', { className: 'anka-cqa-sep' })); return; }
        const row = ankaMk('button', { type: 'button', className: 'anka-cqa-item' });
        if (item.submenuType) row.classList.add('has-submenu');
        row.append(ankaMk('span', { className: 'anka-cqa-icon', text: item.icon }));
        row.append(ankaMk('span', { className: 'anka-cqa-label', text: item.label }));
        if (item.submenuType) {
            row.addEventListener('mouseenter', () => {
                if (ankaCqaTouchMode) return;
                ankaCqaCancelHide();
                if (ankaCqaActiveItem !== row) ankaCqaBuildSubmenu(item.submenuType, row);
            });
            row.addEventListener('mouseleave', (e) => {
                if (ankaCqaTouchMode) return;
                const to = e.relatedTarget;
                if (to && to.closest && to.closest('#anka-cqa-submenu')) return;
                ankaCqaScheduleHide();
            });
            row.addEventListener('click', () => {
                if (ankaCqaTouchMode && ankaCqaActiveItem !== row) {
                    ankaCqaBuildSubmenu(item.submenuType, row);
                    return;
                }
                closeQuickAccessMenu();
                const fn = fullActions[item.submenuType];
                if (fn) fn();
            });
        } else if (item.run) {
            row.addEventListener('click', item.run);
        }
        panel.append(row);
    });

    overlay.append(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) closeQuickAccessMenu(); });
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
};

function createNewTab(url = 'newtab.html', opts = {}) {
    opts = { ...opts, incognito: !!opts.incognito || !!window.ANKA_PRIVATE_WINDOW };
    const tabBar = ankaById('tab-bar');
    if (!tabBar || !ankaById('wv-container')) return null;
    if (tabBar.querySelectorAll('.tab').length >= getMaxTabs()) {
        showNotification(`Maksimum ${getMaxTabs()} sekme sınırına ulaşıldı.`);
        return null;
    }

    const pageMatch = /^(?:ankaweb|anka):\/\/(ayarlar|yardım|yardim|indirilenler|geçmiş|gecmis|settings|help|history|downloads)$/i.exec(String(url || ''));
    const pageNames = { ayarlar: 'settings', yardım: 'help', yardim: 'help', indirilenler: 'downloads', geçmiş: 'history', gecmis: 'history' };
    const internal = pageMatch ? pageNames[pageMatch[1].toLowerCase()] || pageMatch[1].toLowerCase() : '';
    const isNewTab = !url || url === 'newtab.html' || ankaIsNewTabUrl(url);
    let secureUrl = internal ? 'anka://' + internal : isNewTab ? getNewTabUrl() : ankaResolveTarget(url);
    if (isNewTab && opts.incognito && /^file:/i.test(secureUrl)) {
        const privateStartUrl = new URL(secureUrl);
        privateStartUrl.searchParams.set('incognito', '1');
        secureUrl = privateStartUrl.href;
    }
    if (!secureUrl) return null;

    const isBlank = isNewTab || secureUrl === 'about:blank' || secureUrl.startsWith('file:');
    const internalTitles = { settings: 'Ayarlar', help: 'Yardım', history: 'Geçmiş', downloads: 'İndirilenler' };
    const id = 'tab-' + Date.now() + '-' + (++ankaTabSeq);
    const st = ankaCreateTabEntry(id, {
        title: internalTitles[internal] || (isBlank ? 'Yeni Sekme' : (opts.lazy ? ankaHostLabel(secureUrl) : 'Yükleniyor...')),
        icon: isBlank || internal ? ANKA_LOGO : getFaviconUrl(secureUrl),
        url: secureUrl,
        incognito: opts.incognito,
        internal
    });

    if (opts.incognito) {
        st.tab.classList.add('incognito');
        st.tab.style.borderColor = '#7c3aed';
    }

    if (opts.lazy && !internal) {
        st.sleeping = true;
        st.tab.classList.add('sleeping');
    } else if (opts.background && !internal) {
        ankaWake(st);
    }

    if (!opts.background && !opts.lazy) {
        switchTab(id);
        if (isNewTab && !opts.silent) focusUrlBar();
    }
    ankaEnforceLiveLimit();
    ankaPersistSession();
    return id;
}

function createIncognitoTab(url = 'newtab.html') {
    if (document.documentElement.dataset.schoolIncognito === 'off') {
        showNotification('Gizli sekmeler Okul Modu tarafından engellendi.');
        return null;
    }
    return createNewTab(url, { incognito: true });
}

function reopenClosedTab() {
    const last = closedTabsStack.pop();
    if (last) createNewTab(last);
    else showNotification('Yeniden açılacak sekme yok.');
}

function duplicateTab(id) {
    const st = ankaTabs.get(id);
    if (st) createNewTab(st.url, { incognito: st.incognito });
}

function toggleMute(id, e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const st = ankaTabs.get(id);
    const vw = st && st.vw;
    if (!st) return;
    st.muted = vw && typeof vw.isAudioMuted === 'function' ? !vw.isAudioMuted() : !st.muted;
    if (vw && typeof vw.setAudioMuted === 'function') vw.setAudioMuted(st.muted);
    ankaUpdateMuteButton(st);
}

function ankaLastPinnedTab() {
    const bar = ankaById('tab-bar');
    let last = null;
    if (bar) for (const el of bar.children) if (el.classList.contains('pinned')) last = el;
    return last;
}

function togglePinTab(id) {
    const st = ankaTabs.get(id);
    const bar = ankaById('tab-bar');
    if (!st || !bar) return;
    st.pinned = !st.pinned;
    st.tab.classList.toggle('pinned', st.pinned);
    st.tab.removeAttribute('style');
    if (st.incognito) st.tab.style.borderColor = '#7c3aed';
    const lastPinned = ankaLastPinnedTab();
    if (st.pinned) {
        const first = bar.querySelector('.tab:not(.pinned)');
        bar.insertBefore(st.tab, first === st.tab ? st.tab.nextElementSibling : first);
    } else {
        const anchor = lastPinned && lastPinned !== st.tab ? lastPinned.nextElementSibling : bar.firstElementChild;
        bar.insertBefore(st.tab, anchor);
    }
    ankaPersistSession();
}

function ankaTabIdsInOrder() {
    const bar = ankaById('tab-bar');
    const ids = [];
    if (bar) for (const el of bar.children) if (el.classList.contains('tab')) ids.push(el.id.replace(/^btn-/, ''));
    return ids;
}

function closeOtherTabs(keepId) {
    const ids = ankaTabIdsInOrder().filter((tid) => {
        const st = ankaTabs.get(tid);
        return tid !== keepId && !(st && st.pinned);
    });
    closeTabBatch(ids, 'Diğer sekmeler kapatılacak. Devam edilsin mi?');
}

function closeTabsToRight(targetId) {
    const ids = ankaTabIdsInOrder();
    const from = ids.indexOf(targetId);
    if (from < 0) return;
    const targets = ids.slice(from + 1).filter((tid) => {
        const st = ankaTabs.get(tid);
        return !(st && st.pinned);
    });
    closeTabBatch(targets, 'Sağdaki sekmeler kapatılacak. Devam edilsin mi?');
}

function closeTabBatch(ids, prompt) {
    if (!ids.length) return;
    if (getSetting('confirm-close-tabs', 'false') === 'true' &&
        !window.confirm(prompt || ids.length + ' sekme kapatılacak. Devam edilsin mi?')) return;
    ids.forEach((id) => closeTab(id, null, true));
}

function ankaInspectTab(st, useDevTools) {
    if (!st) return;
    const vw = st.vw || ankaWake(st);
    if (!vw) return;
    const open = () => {
        if (useDevTools) ankaOpenDevTools(vw);
        else toggleSideViewSource(vw);
    };
    if (vw.__ankaReady) open();
    else vw.addEventListener('dom-ready', open, { once: true });
}

function ankaShowTabMenu(id, x, y) {
    const st = ankaTabs.get(id);
    if (!st) return;
    showContextMenu(x, y, [
        { label: 'Yenile', action: () => { if (st.vw) st.vw.reload(); else switchTab(id); } },
        { label: 'Sekmeyi Çoğalt', action: () => duplicateTab(id), disabled: st.ai },
        { label: st.pinned ? 'Sabitlemeyi Kaldır' : 'Sekmeyi Sabitle', shortcut: 'Ctrl+Shift+K', action: () => togglePinTab(id) },
        { label: st.muted ? 'Sesi Aç' : 'Sekmeyi Sessize Al', shortcut: 'Ctrl+Shift+M', action: () => toggleMute(id) },
        { label: 'Sekme Grubu Oluştur / Değiştir', action: () => ankaSetTabGroup(st) },
        { label: 'Sekme Grubunu Kaldır', action: () => ankaSetTabGroup(st, ''), disabled: !st.group },
        '---',
        {
            label: 'Geliştirici Araçları',
            submenu: [
                { label: 'DevTools Aç / Kapat', shortcut: 'F12', action: () => ankaInspectTab(st, true) },
                { label: 'Sağ HTML İnceleyicisi', action: () => toggleSideViewSource(st.vw || ankaWake(st), 'right') },
                { label: 'DevTools Kapat', danger: true, action: () => closeDevTools(st.vw) }
            ]
        },
        '---',
        { label: 'Adresi Kopyala', shortcut: 'Ctrl+Shift+C', action: () => ankaCopy(st.url), disabled: !/^https?:/i.test(st.url) },
        { label: 'Yan Panele Sabitle', action: () => pinToSidePanel(st.vw), disabled: !st.vw },
        { label: 'Sekmeyi Uyut', action: () => ankaSleepTab(st), disabled: !st.vw || id === activeTabId || st.ai },
        { label: 'Arka Plan Sekmelerini Uyut', shortcut: 'Ctrl+Shift+G', action: () => ankaReleaseMemory() },
        '---',
        { label: 'Sağdaki Sekmeleri Kapat', action: () => closeTabsToRight(id) },
        { label: 'Diğer Sekmeleri Kapat', action: () => closeOtherTabs(id) },
        { label: 'Sekmeyi Kapat', shortcut: 'Ctrl+W', danger: true, action: () => closeTab(id) }
    ]);
}

async function ankaSetTabGroup(st, value) {
    if (!st) return;
    let name = value;
    if (name === undefined) {
        if (typeof window.ankaPrompt !== 'function') {
            showNotification('Sekme grubu adı penceresi açılamadı.');
            return;
        }
        name = await window.ankaPrompt('Sekme grubu adı (boş bırakarak grubu kaldırın):', {
            title: 'Sekme Grubu',
            value: st.group || '',
            inputLabel: 'Sekme grubu adı',
            maxLength: 32
        });
    }
    if (name === null) return;
    name = String(name).trim().slice(0, 32);
    st.group = name;
    ankaRenderTabGroup(st);
    ankaPersistSession();
}

function ankaRenderTabGroup(st) {
    const name = st.group;
    st.groupEl.textContent = name;
    st.groupEl.hidden = !name;
    st.tab.title = (name ? '[' + name + '] ' : '') + (st.title || '');
    if (name) {
        let hash = 0;
        for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) | 0;
        const colors = ['#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#fb7185', '#22d3ee'];
        st.tab.dataset.group = name;
        st.tab.style.setProperty('--tab-group-color', colors[Math.abs(hash) % colors.length]);
        const bar = ankaById('tab-bar');
        if (bar) {
            const members = Array.from(bar.children).filter((tab) =>
                tab.classList.contains('tab') &&
                tab.dataset.group === name &&
                tab.classList.contains('pinned') === st.tab.classList.contains('pinned')
            );
            if (members.length > 1) {
                const insertBefore = members[members.length - 1].nextSibling;
                const group = document.createDocumentFragment();
                members.forEach((tab) => group.appendChild(tab));
                bar.insertBefore(group, insertBefore);
            }
        }
    } else {
        delete st.tab.dataset.group;
        st.tab.style.removeProperty('--tab-group-color');
    }
}

window.__ankaGetTabGroups = function () {
    const groups = new Map();
    for (const st of ankaTabs.values()) {
        if (!st.group) continue;
        if (!groups.has(st.group)) groups.set(st.group, []);
        groups.get(st.group).push({
            id: st.id,
            title: st.title || st.url || 'Yeni Sekme'
        });
    }
    return Array.from(groups, ([name, tabs]) => ({ name, tabs }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
};

window.__ankaManageTabGroups = function () {
    let panel = document.getElementById('anka-group-manager');
    if (!panel) {
        const style = document.createElement('style');
        style.id = 'anka-group-manager-style';
        style.textContent = '#anka-group-manager{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.68);color:var(--text-color,#f4f4f5);font:14px system-ui}#anka-group-manager[hidden]{display:none}#anka-group-manager .agm-card{display:flex;flex-direction:column;width:min(680px,100%);max-height:90vh;padding:20px;border:1px solid var(--border-color,#333);border-radius:16px;background:var(--bg-secondary,#18181b);box-shadow:0 20px 60px #0009}#anka-group-manager .agm-head,#anka-group-manager .agm-row,#anka-group-manager .agm-actions{display:flex;align-items:center;gap:8px}#anka-group-manager .agm-head{justify-content:space-between}#anka-group-manager .agm-head h2{margin:0;font-size:19px}#anka-group-manager .agm-list{min-height:0;overflow:auto;margin:12px 0}#anka-group-manager .agm-row{justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-color,#333)}#anka-group-manager .agm-info{display:flex;flex-direction:column;min-width:0;gap:4px}#anka-group-manager .agm-info strong{overflow-wrap:anywhere}#anka-group-manager .agm-info small{color:var(--text-secondary,#aaa)}#anka-group-manager .agm-actions{justify-content:flex-end;flex-wrap:wrap}#anka-group-manager button{min-height:38px;padding:6px 10px;border:1px solid var(--border-color,#444);border-radius:8px;background:var(--bg-tertiary,#292930);color:inherit;font:inherit;cursor:pointer}#anka-group-manager button:hover{border-color:var(--accent,#ff4757)}#anka-group-manager .agm-primary{background:var(--accent,#ff4757);border-color:var(--accent,#ff4757);color:#fff}#anka-group-manager .agm-danger{color:#f28b82}#anka-group-manager .agm-empty{padding:24px;text-align:center;color:var(--text-secondary,#aaa)}@media(max-width:600px){#anka-group-manager .agm-card{padding:14px}#anka-group-manager .agm-row{align-items:flex-start;flex-direction:column}}';
        document.head.appendChild(style);
        panel = document.createElement('section');
        panel.id = 'anka-group-manager';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Sekme Grubu Yöneticisi');
        document.body.appendChild(panel);
        panel.addEventListener('click', (event) => {
            if (event.target === panel) panel.hidden = true;
        });
        panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') panel.hidden = true;
        });
    }
    panel.replaceChildren();
    const card = document.createElement('div');
    card.className = 'agm-card';
    const header = document.createElement('div');
    header.className = 'agm-head';
    const title = document.createElement('h2');
    title.textContent = 'Sekme Grupları';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Kapat';
    close.addEventListener('click', () => { panel.hidden = true; });
    header.append(title, close);
    const description = document.createElement('p');
    description.textContent = 'Gruplar sekmeleri düzenler. Bir grubu açabilir, yeniden adlandırabilir, sekme ekleyebilir veya grubu kaldırabilirsiniz.';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'agm-primary';
    create.textContent = 'Aktif sekmeden grup oluştur';
    create.addEventListener('click', async () => {
        const active = ankaTabs.get(activeTabId);
        if (!active) {
            showNotification('Önce bir sekme açın.');
            return;
        }
        const value = typeof window.ankaPrompt === 'function'
            ? await window.ankaPrompt('Yeni grup için bir ad girin:', {
                title: 'Sekme Grubu Oluştur',
                inputLabel: 'Grup adı',
                maxLength: 32
            })
            : null;
        const name = String(value || '').trim().slice(0, 32);
        if (!name) return;
        await ankaSetTabGroup(active, name);
        window.__ankaManageTabGroups();
    });
    const list = document.createElement('div');
    list.className = 'agm-list';
    const groups = window.__ankaGetTabGroups();
    if (!groups.length) {
        const empty = document.createElement('div');
        empty.className = 'agm-empty';
        empty.textContent = 'Henüz grup yok. Aktif sekmeden ilk grubunuzu oluşturun.';
        list.appendChild(empty);
    }
    groups.forEach((group) => {
        const row = document.createElement('div');
        row.className = 'agm-row';
        const info = document.createElement('div');
        info.className = 'agm-info';
        const name = document.createElement('strong');
        name.textContent = group.name;
        const detail = document.createElement('small');
        detail.textContent = group.tabs.length + ' sekme';
        info.append(name, detail);
        const actions = document.createElement('div');
        actions.className = 'agm-actions';
        const addActive = document.createElement('button');
        addActive.type = 'button';
        addActive.textContent = 'Aktif sekmeyi ekle';
        addActive.addEventListener('click', async () => {
            const active = ankaTabs.get(activeTabId);
            if (!active) {
                showNotification('Önce bir sekme açın.');
                return;
            }
            await ankaSetTabGroup(active, group.name);
            window.__ankaManageTabGroups();
        });
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Grubu aç';
        open.addEventListener('click', () => {
            const first = ankaTabs.get(group.tabs[0].id);
            if (first) switchTab(first.id);
            panel.hidden = true;
        });
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.textContent = 'Yeniden adlandır';
        rename.addEventListener('click', async () => {
            const value = typeof window.ankaPrompt === 'function'
                ? await window.ankaPrompt('Grup için yeni bir ad girin:', {
                    title: 'Grubu Yeniden Adlandır',
                    value: group.name,
                    inputLabel: 'Grup adı',
                    maxLength: 32
                })
                : null;
            const nextName = String(value || '').trim().slice(0, 32);
            if (!nextName || nextName === group.name) return;
            for (const tab of group.tabs) {
                const state = ankaTabs.get(tab.id);
                if (state) await ankaSetTabGroup(state, nextName);
            }
            window.__ankaManageTabGroups();
        });
        const ungroup = document.createElement('button');
        ungroup.type = 'button';
        ungroup.textContent = 'Grubu kaldır';
        ungroup.addEventListener('click', async () => {
            for (const tab of group.tabs) {
                const state = ankaTabs.get(tab.id);
                if (state) await ankaSetTabGroup(state, '');
            }
            window.__ankaManageTabGroups();
        });
        const closeGroup = document.createElement('button');
        closeGroup.type = 'button';
        closeGroup.className = 'agm-danger';
        closeGroup.textContent = 'Grup sekmelerini kapat';
        closeGroup.addEventListener('click', () => {
            if (!window.confirm('"' + group.name + '" grubundaki ' + group.tabs.length + ' sekme kapatılsın mı?')) return;
            group.tabs.forEach((tab) => closeTab(tab.id, null, true));
            window.__ankaManageTabGroups();
        });
        actions.append(addActive, open, rename, ungroup, closeGroup);
        row.append(info, actions);
        list.appendChild(row);
    });
    card.append(header, description, create, list);
    panel.appendChild(card);
    panel.hidden = false;
    close.focus();
};

window.__ankaActivateTab = function (id) {
    if (ankaTabs.has(id)) switchTab(id);
};

function ankaSetupVerticalTabs() {
    const bar = ankaById('tab-bar');
    const list = ankaById('vt-tabs');
    if (!bar || !list || list.__ankaReady) return;
    list.__ankaReady = true;
    let renderFrame = 0;
    const render = () => {
        renderFrame = 0;
        const fragment = document.createDocumentFragment();
        bar.querySelectorAll('.tab').forEach((tab) => {
            const id = tab.id.replace(/^btn-/, '');
            if (!id) return;
            const row = ankaMk('div', {
                className: 'vt-tab' + (tab.classList.contains('active') ? ' active' : ''),
                role: 'tab',
                tabIndex: 0,
                'aria-selected': String(tab.classList.contains('active')),
                'aria-label': tab.querySelector('.tab-title')?.textContent || 'Yeni Sekme'
            });
            row.dataset.tabId = id;
            const icon = tab.querySelector('.tab-icon');
            if (icon && icon.getAttribute('src')) {
                row.appendChild(ankaMk('img', { className: 'vt-tab-icon', alt: '', src: icon.getAttribute('src') }));
            }
            if (tab.dataset.group) row.appendChild(ankaMk('span', { className: 'vt-tab-group-dot', 'aria-hidden': 'true' }));
            row.appendChild(ankaMk('span', {
                className: 'vt-tab-title',
                text: tab.querySelector('.tab-title')?.textContent || 'Yeni Sekme'
            }));
            const memory = tab.querySelector('.tab-memory');
            if (memory && memory.textContent) {
                row.appendChild(ankaMk('span', { className: 'vt-tab-memory', text: memory.textContent }));
            }
            const close = ankaMk('button', {
                className: 'vt-tab-close',
                type: 'button',
                title: 'Sekmeyi kapat',
                'aria-label': 'Sekmeyi kapat'
            }, '×');
            row.appendChild(close);
            fragment.appendChild(row);
        });
        list.replaceChildren(fragment);
    };
    const scheduleRender = () => {
        if (!renderFrame) renderFrame = requestAnimationFrame(render);
    };
    const observer = new MutationObserver(scheduleRender);
    observer.observe(bar, {
        attributes: true,
        attributeFilter: ['class', 'data-group', 'src'],
        childList: true,
        characterData: true,
        subtree: true
    });
    list.addEventListener('click', (event) => {
        const row = event.target.closest('.vt-tab');
        if (!row) return;
        const id = row.dataset.tabId;
        if (event.target.closest('.vt-tab-close')) {
            const tab = ankaById('btn-' + id);
            const close = tab && tab.querySelector('.close-tab');
            if (close) close.click();
            return;
        }
        switchTab(id);
    });
    list.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('.vt-tab');
        if (!row || event.target.closest('.vt-tab-close')) return;
        event.preventDefault();
        switchTab(row.dataset.tabId);
    });
    scheduleRender();
}

window.addEventListener('DOMContentLoaded', ankaSetupVerticalTabs, { once: true });

function ankaSetupTabBar() {
    const bar = ankaById('tab-bar');
    if (!bar || bar.__ankaReady) return;
    bar.__ankaReady = true;
    let dragEl = null;

    bar.addEventListener('dragstart', (e) => {
        const tab = e.target.closest && e.target.closest('.tab');
        if (!tab) return;
        dragEl = tab;
        tab.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'anka-tab:' + tab.id);
        const st = ankaTabs.get(tab.id.replace(/^btn-/, ''));
        if (st && /^https?:/i.test(st.url)) e.dataTransfer.setData('text/uri-list', st.url);
    });

    bar.addEventListener('dragover', (e) => {
        if (!dragEl) {
            if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('text/uri-list')) e.preventDefault();
            return;
        }
        e.preventDefault();
        const over = e.target.closest && e.target.closest('.tab');
        if (!over || over === dragEl) return;
        if (over.classList.contains('pinned') !== dragEl.classList.contains('pinned')) return;
        const r = over.getBoundingClientRect();
        if (e.clientX > r.left + r.width / 2) {
            if (over.nextElementSibling !== dragEl) bar.insertBefore(dragEl, over.nextElementSibling);
        } else if (over.previousElementSibling !== dragEl) {
            bar.insertBefore(dragEl, over);
        }
    });

    bar.addEventListener('dragend', () => {
        if (dragEl) dragEl.classList.remove('dragging');
        dragEl = null;
        ankaPersistSession();
    });

    bar.addEventListener('drop', (e) => {
        if (dragEl) return;
        const crossWindowData = e.dataTransfer && e.dataTransfer.getData('application/x-anka-tab');
        if (crossWindowData) {
            try {
                const transfer = JSON.parse(crossWindowData);
                const url = normalizeSessionUrl(transfer.url);
                if (url && /^https?:\/\//i.test(url) && /^[a-f0-9-]{32,64}$/i.test(transfer.token)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = transfer.incognito || window.ANKA_PRIVATE_WINDOW
                        ? createIncognitoTab(url)
                        : createNewTab(url);
                    if (id && typeof window.ankaConsumeDraggedTab === 'function') window.ankaConsumeDraggedTab(transfer.token, url);
                    return;
                }
            } catch (err) {
                console.error('Sürüklenen sekme açılamadı:', err);
            }
        }
        const raw = e.dataTransfer && e.dataTransfer.getData('text/uri-list');
        const url = raw && normalizeSessionUrl(raw.split(/\r?\n/).find((l) => l && !l.startsWith('#')));
        if (url) {
            e.preventDefault();
            e.stopPropagation();
            createNewTab(url);
        }
    });

    bar.addEventListener('wheel', (e) => {
        if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        bar.scrollLeft += e.deltaY;
        e.preventDefault();
    }, { passive: false });

    bar.addEventListener('dblclick', (e) => {
        if (e.target === bar) createNewTab(ankaHomeUrl());
    });
}

function openAISession() {
    if (ankaTabs.has(AI_TAB_ID)) {
        switchTab(AI_TAB_ID);
        return;
    }
    const tabBar = ankaById('tab-bar');
    if (!tabBar) return;
    if (tabBar.querySelectorAll('.tab').length >= getMaxTabs()) {
        showNotification(`Maksimum ${getMaxTabs()} sekme sınırına ulaşıldı.`);
        return;
    }
    const provId = getSetting('ai-provider', 'google-ai');
    const prov = AI_PROVIDERS[provId] || AI_PROVIDERS['google-ai'];
    const names = { 'google-ai': 'Google AI Modu', chatgpt: 'ChatGPT Asistan', gemini: 'Gemini Asistan', perplexity: 'Perplexity Asistan', claude: 'Claude Asistan' };
    ankaCreateTabEntry(AI_TAB_ID, { title: names[provId] || 'AI Asistan', icon: getFaviconUrl(prov.home), url: prov.home, className: 'tab ai-tab', ai: true });
    switchTab(AI_TAB_ID);
}

function switchTab(id) {
    const st = ankaTabs.get(id);
    if (st && !st.vw && !st.internal) ankaWake(st);
    const previous = ankaTabs.get(activeTabId);
    if (previous && previous.id !== id && previous.vw) ankaSetTabLoadTracking(previous, false);
    if (activeTabId !== id) {
        ankaCloseFindBar();
        ankaShowLinkStatus('');
        hideTabPreview();
    }
    activeTabId = id;

    const container = ankaById('wv-container');
    if (container) {
        for (const el of container.children) {
            if (el.tagName !== 'WEBVIEW') continue;
            const on = el.id === id;
            el.style.display = on ? 'block' : 'none';
            el.classList.toggle('active', on);
        }
    }
    if (st && st.vw) ankaSetTabLoadTracking(st, true);
    if (typeof window.__ankaShowPage === 'function') window.__ankaShowPage(st && st.internal ? st : null);
    const bar = ankaById('tab-bar');
    if (bar) {
        for (const el of bar.children) {
            if (el.classList.contains('tab')) el.classList.toggle('active', el.id === 'btn-' + id);
        }
    }

    if (st) {
        st.lastActive = Date.now();
        st.tab.classList.remove('sleeping');
        if (st.tab.scrollIntoView) st.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const input = ankaById('url-input');
        if (input) {
            const internalUrls = { settings: 'ankaweb://ayarlar', help: 'ankaweb://yardım', downloads: 'ankaweb://indirilenler', history: 'ankaweb://geçmiş' };
            input.value = internalUrls[st.internal] || (ankaIsWelcomeUrl(st.url) ? 'Anka Web' : ankaIsNewTabUrl(st.url) || st.url === 'about:blank' || /^file:/i.test(st.url) ? '' : st.url);
        }
    }
    ankaUpdateBookmarkButton();
    ankaPersistSession();
    ankaEnforceLiveLimit();

    const dropdown = ankaById('tab-dropdown-menu');
    if (dropdown) dropdown.style.display = 'none';
    if (typeof window.__ankaUpdateSplitView === 'function') window.__ankaUpdateSplitView();
}

function switchTabByIndex(index) {
    const ids = ankaTabIdsInOrder();
    if (!ids.length) return;
    if (index === -1) switchTab(ids[ids.length - 1]);
    else if (ids[index]) switchTab(ids[index]);
}

function cycleTab(dir) {
    const ids = ankaTabIdsInOrder();
    if (!ids.length) return;
    const cur = ids.indexOf(activeTabId);
    switchTab(ids[(cur + dir + ids.length) % ids.length]);
}

function closeTab(id, e, skipConfirm = false) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!skipConfirm && getSetting('confirm-close-tabs', 'false') === 'true' &&
        ankaTabIdsInOrder().length > 1 &&
        !window.confirm('Bu sekme kapatılacak. Devam edilsin mi?')) return false;
    const st = ankaTabs.get(id);
    const tabBtn = ankaById('btn-' + id);
    const vw = st && st.vw ? st.vw : ankaById(id);

    if (st && !st.ai && !st.incognito && /^https?:/i.test(st.url)) {
        closedTabsStack.push(st.url);
        if (closedTabsStack.length > 20) closedTabsStack.shift();
    }

    let neighbor = null;
    if (tabBtn) {
        const n = tabBtn.nextElementSibling || tabBtn.previousElementSibling;
        if (n && n.classList.contains('tab')) neighbor = n.id.replace(/^btn-/, '');
    }

    if (activeTabId === id) {
        ankaCloseFindBar();
        ankaShowLinkStatus('');
        hideTabPreview();
    }
    if (vw) {
        ankaUnwireTabLoading(st, vw);
        vw.remove();
    }
    if (tabBtn) tabBtn.remove();
    ankaTabs.delete(id);

    if (activeTabId === id) {
        activeTabId = null;
        if (neighbor) switchTab(neighbor);
        else createNewTab(ankaHomeUrl());
    }
    ankaPersistSession();
    return true;
}

window.__ankaOpenWelcomeGuide = function () {
    const welcomeUrl = getWelcomeUrl();
    if (!welcomeUrl) {
        showNotification('Tanıtım sayfası açılamadı.');
        return false;
    }
    const id = createNewTab(welcomeUrl + '?tour=1');
    if (!id) return false;
    const settingsPanel = ankaById('settings-panel');
    if (settingsPanel && settingsPanel.style.display === 'flex' && typeof window.toggleSettings === 'function') window.toggleSettings();
    return true;
};

function showNotification(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
}

function goBack() {
    const vw = ankaActiveView();
    if (vw && typeof vw.canGoBack === 'function' && vw.canGoBack()) vw.goBack();
}

function goForward() {
    const vw = ankaActiveView();
    if (vw && typeof vw.canGoForward === 'function' && vw.canGoForward()) vw.goForward();
}

function reloadPage() {
    const vw = ankaActiveView();
    if (vw && typeof vw.reload === 'function') vw.reload();
}

function reloadTab() {
    reloadPage();
}

function focusUrlBar() {
    const input = ankaById('url-input');
    if (input) {
        input.focus();
        input.select();
    }
}

const SAVED_SESSIONS_KEY = 'anka_saved_sessions';

function readSavedSessions() {
    const sessions = ankaRead(SAVED_SESSIONS_KEY, []);
    return Array.isArray(sessions) ? sessions.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.urls)) : [];
}

function getCurrentSessionUrls() {
    return ankaTabIdsInOrder().map((id) => {
        const st = ankaTabs.get(id);
        return st && !st.incognito && !st.ai ? st.url : '';
    }).filter((url) => /^https?:/i.test(url));
}

function saveSessions(sessions) {
    if (ankaWrite(SAVED_SESSIONS_KEY, sessions)) return true;
    showNotification('Oturum kaydedilemedi. Depolama alanı dolu olabilir.');
    return false;
}

function closeSessionManager() {
    ankaCloseOverlay();
}

function normalizeSessionUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
        return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : '';
    } catch (err) {
        return '';
    }
}

function restoreSavedSession(session) {
    if (!session || !Array.isArray(session.urls)) return;
    const urls = session.urls.map(normalizeSessionUrl).filter(Boolean);
    if (!urls.length) {
        showNotification('Bu oturumda açılabilir sekme yok.');
        return;
    }
    closeSessionManager();
    let opened = 0;
    urls.forEach((url, i) => {
        if (createNewTab(url, i === 0 ? {} : { lazy: true, background: true })) opened += 1;
    });
    if (opened < urls.length) showNotification(`${opened} / ${urls.length} sekme açıldı; sekme sınırına ulaşıldı.`);
}

function openSessionManager() {
    const panel = ankaOpenPanel({ title: 'Oturum Yöneticisi', kicker: 'ÇALIŞMA ALANLARI', wide: true });
    const nameInput = ankaMk('input', { id: 'session-name', maxlength: '60', placeholder: 'Oturum adı', required: true });
    const form = ankaMk('form', { className: 'session-save-form' }, ankaMk('label', { for: 'session-name', text: 'Açık sekmeleri oturum olarak kaydet' }), ankaMk('div', { className: 'session-save-row' }, nameInput, ankaMk('button', { className: 'session-primary', type: 'submit', text: 'Oturumu Kaydet' })));
    const count = ankaMk('span');
    const list = ankaMk('div', { className: 'session-list' });
    panel.append(form, ankaMk('div', { className: 'session-manager-toolbar' }, ankaMk('strong', { text: 'Kaydedilen oturumlar' }), count), list);

    const makeButton = (label, className, handler, danger) => ankaMk('button', { type: 'button', className, text: label, onclick: handler });

    const persistSession = (session) => {
        const sessions = readSavedSessions();
        const index = sessions.findIndex((item) => item.id === session.id);
        if (index < 0) return;
        sessions[index] = session;
        saveSessions(sessions);
        renderList();
    };

    const renderList = () => {
        const sessions = readSavedSessions().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        count.textContent = `${sessions.length} oturum`;
        list.replaceChildren();
        if (!sessions.length) {
            list.appendChild(ankaMk('div', { className: 'session-empty', text: 'Henüz kaydedilmiş oturum yok.' }));
            return;
        }
        sessions.forEach((session) => {
            const name = ankaMk('input', { className: 'session-name-input', value: String(session.name || 'Oturum').slice(0, 60), maxlength: '60', 'aria-label': 'Oturum adı' });
            const card = ankaMk('article', { className: 'session-card' }, ankaMk('div', { className: 'session-card-head' }, name, ankaMk('span', { className: 'session-card-meta', text: `${session.urls.length} sekme` })));

            const urlList = ankaMk('div', { className: 'session-url-list' });
            session.urls.forEach((url, index) => {
                const input = ankaMk('input', { className: 'session-url-input', value: url, 'aria-label': `Sekme adresi ${index + 1}` });
                const remove = ankaMk('button', { type: 'button', className: 'session-icon-button danger', text: '−', title: 'Bu sekmeyi oturumdan çıkar', onclick: () => {
                    session.urls.splice(index, 1);
                    session.updatedAt = new Date().toISOString();
                    persistSession(session);
                } });
                urlList.appendChild(ankaMk('div', { className: 'session-url-row' }, input, remove));
            });
            card.appendChild(urlList);

            const addInput = ankaMk('input', { className: 'session-url-input', placeholder: 'Oturuma sekme adresi ekle', 'aria-label': 'Eklenecek sekme adresi' });
            addInput.addEventListener('input', () => addInput.setCustomValidity(''));
            const addRow = ankaMk('form', { className: 'session-add-url' }, addInput, ankaMk('button', { type: 'submit', className: 'session-secondary', text: 'Sekme Ekle' }));
            addRow.addEventListener('submit', (event) => {
                event.preventDefault();
                if (session.urls.length >= 30) {
                    showNotification('Bir oturum en fazla 30 sekme içerebilir.');
                    return;
                }
                const url = normalizeSessionUrl(addInput.value);
                if (!url) {
                    addInput.setCustomValidity('Geçerli bir web adresi girin.');
                    addInput.reportValidity();
                    return;
                }
                session.urls.push(url);
                session.updatedAt = new Date().toISOString();
                persistSession(session);
            });
            card.appendChild(addRow);

            card.appendChild(ankaMk('div', { className: 'session-actions' },
                ankaMk('button', { type: 'button', className: 'session-primary', text: 'Oturumu Aç', onclick: () => restoreSavedSession(session) }),
                ankaMk('button', { type: 'button', className: 'session-secondary', text: 'Değişiklikleri Kaydet', onclick: () => {
                    session.name = name.value.trim().slice(0, 60) || 'Oturum';
                    session.urls = Array.from(urlList.querySelectorAll('.session-url-input')).map((input) => normalizeSessionUrl(input.value)).filter(Boolean);
                    session.updatedAt = new Date().toISOString();
                    persistSession(session);
                } }),
                ankaMk('button', { type: 'button', className: 'session-danger', text: 'Sil', onclick: () => {
                    saveSessions(readSavedSessions().filter((item) => item.id !== session.id));
                    renderList();
                } })
            ));
            list.appendChild(card);
        });
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const urls = getCurrentSessionUrls();
        if (!urls.length) {
            showNotification('Kaydedilecek açık sekme yok.');
            return;
        }
        const sessions = readSavedSessions();
        sessions.unshift({ id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: nameInput.value.trim() || 'Yeni Oturum', urls: urls.slice(0, 30), updatedAt: new Date().toISOString() });
        if (saveSessions(sessions)) {
            nameInput.value = '';
            renderList();
            showNotification('Oturum kaydedildi.');
        }
    });

    renderList();
    nameInput.focus();
}

function ankaPersistSessionNow() {
    if (window.ANKA_PRIVATE_WINDOW) return;
    if (getSetting('restore-session', 'false') !== 'true' && getSetting('disk-backed-tab-saver', 'false') !== 'true') {
        try { localStorage.removeItem('anka_last_session'); } catch (err) {}
        if (window.ANKA_WINDOW_ID) {
            const bridge = ankaBridgeApi();
            if (bridge) bridge.send('crash-recovery:forget-window', window.ANKA_WINDOW_ID);
        }
        return;
    }
    const urls = [];
    const tabs = [];
    let active = 0;
    ankaTabIdsInOrder().forEach((id) => {
        const st = ankaTabs.get(id);
        if (!st || st.incognito || st.ai || !/^https?:/i.test(st.url)) return;
        if (id === activeTabId) active = urls.length;
        urls.push(st.url);
        tabs.push({ url: st.url, group: st.group });
    });
    const snapshot = { urls, tabs, active, time: Date.now() };
    ankaWrite('anka_last_session', snapshot);
    if (window.ANKA_WINDOW_ID) {
        const bridge = ankaBridgeApi();
        if (bridge) bridge.send('crash-recovery:save-window', {
            windowId: window.ANKA_WINDOW_ID,
            tabs,
            active,
            profileId: window.ANKA_PROFILE_ID || 'default'
        });
    }
}

const ankaPersistSession = ankaDebounce(ankaPersistSessionNow, 800);
window.addEventListener('anka:session-storage-setting-changed', ankaPersistSessionNow);

function ankaRestoreSessionSnapshot(saved) {
    if (!saved || !Array.isArray(saved.tabs)) return false;
    const records = saved.tabs
        .map((tab) => ({ url: normalizeSessionUrl(tab && tab.url), group: typeof (tab && tab.group) === 'string' ? tab.group.slice(0, 32) : '' }))
        .filter((tab) => tab.url)
        .slice(0, getMaxTabs());
    if (!records.length) return false;
    const active = Math.min(Math.max(parseInt(saved.active, 10) || 0, 0), records.length - 1);
    records.forEach((tab, i) => {
        const id = createNewTab(tab.url, i === active ? { silent: true } : { lazy: true, background: true });
        if (id && tab.group) ankaSetTabGroup(ankaTabs.get(id), tab.group);
    });
    return true;
}

window.ankaRestoreSessionSnapshot = ankaRestoreSessionSnapshot;

function ankaOpenInitialTabs() {
    if (window.ANKA_RECOVERY_PENDING || window.ANKA_RECOVERY_RESTORING) return;
    if (window.ANKA_PRIVATE_WINDOW) {
        createNewTab('newtab.html', { silent: true, incognito: true });
        return;
    }
    if (getSetting('school-mode', 'false') === 'true') {
        createNewTab(typeof getStartupUrl === 'function' ? getStartupUrl() : ankaHomeUrl(), { silent: true });
        return;
    }
    if (getSetting('show-welcome-on-start', 'true') === 'true' && ankaRead('anka_welcome_completed', false) !== true) {
        const welcomeUrl = getWelcomeUrl();
        if (welcomeUrl && createNewTab(welcomeUrl, { silent: true })) return;
    }
    if (getSetting('restore-session', 'false') === 'true' || getSetting('disk-backed-tab-saver', 'false') === 'true') {
        const saved = ankaRead('anka_last_session', null);
        if (saved && ankaRestoreSessionSnapshot({
            tabs: Array.isArray(saved.tabs) ? saved.tabs : (saved.urls || []).map((url) => ({ url, group: '' })),
            active: saved.active
        })) return;
    }
    createNewTab(ankaHomeUrl(), { silent: true });
}

function ankaExternalTarget(raw) {
    const text = String(raw || '').trim().replace(/^"+|"+$/g, '');
    if (!text || text.length > 8192) return null;
    if (/^https?:\/\//i.test(text)) return ankaResolveTarget(text);
    let fileUrl = '';
    if (/^file:\/\//i.test(text)) fileUrl = text;
    else if (/^([a-z]:[\\/]|\\\\|\/)/i.test(text)) fileUrl = ankaFileUrlFromPath(text);
    if (!fileUrl) return null;
    if (getSetting('allow-file-drop', 'true') === 'false') return null;
    const parsed = ankaTryUrl(fileUrl);
    if (!parsed || !ANKA_DROP_EXT.test(ankaDecode(parsed.pathname))) {
        showNotification('Bu dosya türü açılamıyor.');
        return null;
    }
    ANKA_ALLOWED_FILES.add(ankaFileKey(fileUrl));
    return fileUrl;
}

function ankaOpenExternal(raw, opts) {
    const url = ankaExternalTarget(raw);
    if (!url) return false;
    if (ankaExternalQueue.length >= 20) ankaExternalQueue.shift();
    ankaExternalQueue.push({ url, background: !!(opts && opts.background) });
    ankaDrainExternal();
    return true;
}

function ankaCanOpenExternal() {
    if (!ankaExternalReady) return false;
    if (window.__ankaRequireLogin && !window.__ankaAuthenticated) return false;
    if (!ankaById('tab-bar') || !ankaById('wv-container')) return false;
    if (!ankaTabs.size && ankaExternalWait < 10) {
        ankaExternalWait += 1;
        return false;
    }
    return true;
}

function ankaOpenExternalItem(item) {
    const only = ankaTabs.size === 1 ? ankaTabs.values().next().value : null;
    if (only && !only.incognito && !only.ai && ankaIsNewTabUrl(only.url) && !item.background) {
        if (only.id !== activeTabId) switchTab(only.id);
        ankaNavigateActive(item.url);
        return;
    }
    createNewTab(item.url, { background: item.background });
}

function ankaDrainExternal() {
    if (!ankaExternalQueue.length) return;
    clearTimeout(ankaExternalTimer);
    if (!ankaCanOpenExternal()) {
        ankaExternalTimer = setTimeout(ankaDrainExternal, 400);
        return;
    }
    const seen = new Set();
    while (ankaExternalQueue.length) {
        const item = ankaExternalQueue.shift();
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        ankaOpenExternalItem(item);
    }
}

async function ankaSetDefaultBrowser() {
    const api = ankaBridgeApi();
    if (!api) {
        showNotification('Bu sürümde varsayılan tarayıcı ayarı desteklenmiyor.');
        return;
    }
    try {
        const res = await api.invoke('anka-set-default-browser');
        if (!res) showNotification('Varsayılan tarayıcı ayarlanamadı.');
        else if (res.isDefault) showNotification('Varsayılan tarayıcı olarak ayarlandı.');
        else if (res.openedSettings) showNotification('Açılan sistem ayarlarından bu tarayıcıyı varsayılan olarak seçin.');
        else showNotification('Varsayılan tarayıcı ayarlanamadı.');
    } catch (err) {
        showNotification('Varsayılan tarayıcı ayarlanamadı.');
    }
}

function ankaCopyActiveUrl() {
    const st = ankaTabs.get(activeTabId);
    if (st && /^https?:/i.test(st.url)) ankaCopy(st.url);
    else showNotification('Kopyalanacak adres yok.');
}

function ankaPickLocalFile() {
    const input = ankaMk('input', { type: 'file', accept: '.pdf,.html,.htm,.txt,.md,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.webm,.mp3,.ogg,.wav', style: 'display:none' });
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        if (file) ankaOpenDroppedFile(file);
    });
    document.body.append(input);
    input.click();
}

function toggleReaderMode(vw) {
    const st = ankaStateOfView(vw);
    if (!st || !vw || !vw.__ankaReady || typeof vw.executeJavaScript !== 'function') return;
    if (!/^https?:/i.test(st.url)) {
        showNotification('Bu sayfada okuma modu kullanılamaz.');
        return;
    }
    if (st.reader) {
        st.reader = false;
        vw.reload();
        return;
    }
    vw.executeJavaScript(ANKA_READER_JS).then(() => vw.insertCSS(ANKA_READER_CSS)).then(() => {
        st.reader = true;
    }).catch(() => showNotification('Okuma modu başlatılamadı.'));
}

const ANKA_CTRL_KEYS = {
    t: () => createNewTab(ankaHomeUrl()),
    w: () => { if (activeTabId) closeTab(activeTabId); },
    l: () => focusUrlBar(),
    e: () => focusUrlBar(),
    o: () => ankaPickLocalFile(),
    j: () => { if (typeof window.openAnkaPage === 'function') window.openAnkaPage('downloads'); },
    r: () => reloadPage(),
    f: (vw) => openFindBar(vw),
    u: (vw) => toggleSideViewSource(vw),
    d: () => toggleBookmark(),
    h: () => {
        if (typeof window.__ankaOpenHistory === 'function') window.__ankaOpenHistory();
        else openHistoryPanel();
    },
    p: (vw) => printPage(vw),
    s: (vw) => saveCurrentPage(vw)
};

const ANKA_SHIFT_KEYS = {
    t: () => reopenClosedTab(),
    n: () => createIncognitoTab(),
    j: (vw) => ankaOpenDevTools(vw),
    h: () => typeof window.openAnkaPage === 'function' ? window.openAnkaPage('history') : openHistoryPanel(),
    a: () => openTabSearch(),
    s: (vw) => takeScreenshot(vw),
    m: () => { if (activeTabId) toggleMute(activeTabId); },
    o: () => openSessionManager(),
    d: (vw) => toggleDarkMode(vw),
    b: () => openBookmarksPanel(),
    r: (vw) => hardReload(vw),
    i: (vw) => ankaOpenDevTools(vw),
    c: () => ankaCopyActiveUrl(),
    y: () => ankaSetDefaultBrowser(),
    e: (vw) => toggleReaderMode(vw),
    g: () => ankaReleaseMemory(),
    k: () => { if (activeTabId) togglePinTab(activeTabId); },
    p: () => openCommandPalette(),
    q: () => window.openQuickAccessMenu()
};

function ankaLetter(ev) {
    const k = ev.key && ev.key.length === 1 ? ev.key.toLowerCase() : '';
    if (/^[a-z]$/.test(k)) return k;
    return /^Key[A-Z]$/.test(ev.code || '') ? ev.code[3].toLowerCase() : '';
}

function ankaHandleShortcut(ev) {
    const key = ev.key;
    const vw = ankaActiveView();

    if (!ev.ctrl && !ev.alt && key === 'F5') { reloadPage(); return true; }
    if (!ev.ctrl && !ev.alt && key === 'F11') { toggleFullscreen(); return true; }
    if (!ev.ctrl && !ev.alt && key === 'F12') { ankaOpenDevTools(vw); return true; }
    if (!ev.ctrl && !ev.alt && key === 'F1') { if (typeof toggleHelp === 'function') toggleHelp(); return true; }
    if (ev.ctrl && key === 'F5') { hardReload(vw); return true; }

    if (ev.alt && !ev.ctrl && !ev.shift) {
        if (ev.editing && (key === 'ArrowLeft' || key === 'ArrowRight')) return false;
        if (key === 'ArrowLeft') { goBack(); return true; }
        if (key === 'ArrowRight') { goForward(); return true; }
        if (key === 'Home') { ankaNavigateActive(ankaHomeUrl()); return true; }
        return false;
    }

    if (!ev.ctrl || ev.alt) return false;

    const l = ankaLetter(ev);
    if (l) {
        const fn = (ev.shift ? ANKA_SHIFT_KEYS : ANKA_CTRL_KEYS)[l];
        if (!fn) return false;
        fn(vw);
        return true;
    }
    if (key === 'Tab') { cycleTab(ev.shift ? -1 : 1); return true; }
    if (key === 'PageDown') { cycleTab(1); return true; }
    if (key === 'PageUp') { cycleTab(-1); return true; }
    if (key === 'Delete' && ev.shift) { clearBrowsingData(); return true; }
    if (key === ',') { if (typeof toggleSettings === 'function') toggleSettings(); return true; }
    if (key === '+' || key === '=' || ev.code === 'NumpadAdd') { ankaZoom(0.5); return true; }
    if (key === '-' || key === '_' || ev.code === 'NumpadSubtract') { ankaZoom(-0.5); return true; }
    if (/^[0-9]$/.test(key)) {
        if (key === '0') ankaZoom(null);
        else if (key === '9') switchTabByIndex(-1);
        else switchTabByIndex(parseInt(key, 10) - 1);
        return true;
    }
    return false;
}

document.addEventListener('keydown', (e) => {
    if (window.__ankaRequireLogin && !window.__ankaAuthenticated) return;
    if (e.isComposing || (e.getModifierState && e.getModifierState('AltGraph'))) return;
    const tag = e.target && e.target.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(e.target && e.target.isContentEditable);
    const handled = ankaHandleShortcut({ key: e.key, code: e.code || '', shift: e.shiftKey, alt: e.altKey, ctrl: ANKA_MAC ? e.metaKey : e.ctrlKey, editing });
    if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}, true);

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ankaCmdState) {
        closeCommandPalette();
        return;
    }
    if (closeQuickAccessMenu()) return;
    closeContextMenu();
    ankaCloseFindBar();
    ankaCloseOverlay();
    closeSideViewSource();
    closePinnedSidePanel();
    hideTabPreview();
}, true);

function ankaPathOfFile(file) {
    try {
        if (typeof require === 'function') {
            const electron = require('electron');
            if (electron.webUtils && typeof electron.webUtils.getPathForFile === 'function') return electron.webUtils.getPathForFile(file);
        }
        if (window.electronAPI && typeof window.electronAPI.getPathForFile === 'function') return window.electronAPI.getPathForFile(file);
    } catch (err) {}
    return file.path || '';
}

function ankaOpenDroppedFile(file) {
    if (getSetting('allow-file-drop', 'true') === 'false') return;
    if (!ANKA_DROP_EXT.test(file.name)) {
        showNotification('Bu dosya türü açılamıyor.');
        return;
    }
    const filePath = ankaPathOfFile(file);
    if (!filePath) {
        showNotification('Dosya yolu alınamadı.');
        return;
    }
    const url = ankaFileUrlFromPath(filePath);
    ANKA_ALLOWED_FILES.add(ankaFileKey(url));
    const st = ankaTabs.get(activeTabId);
    if (st) {
        if (!st.vw) ankaWake(st);
        st.url = url;
        ankaLoad(st.vw, url);
    } else {
        const id = createNewTab('about:blank');
        const fresh = ankaTabs.get(id);
        if (fresh && fresh.vw) {
            fresh.url = url;
            ankaLoad(fresh.vw, url);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.__ankaAccessReady) await window.__ankaAccessReady;
    if (window.__ankaSettingsReady) await window.__ankaSettingsReady;
    ankaInjectStyles();
    setAiMode(isAiModeActive());
    ankaSetupTabBar();

    const urlInput = ankaById('url-input');
    if (urlInput) ankaSetupUrlBar(urlInput);

    document.addEventListener('dragover', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
            ankaOpenDroppedFile(files[0]);
            return;
        }
        const raw = e.dataTransfer && (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
        const url = raw && normalizeSessionUrl(raw.split(/\r?\n/).find((l) => l && !l.startsWith('#')));
        if (url) createNewTab(url);
    });

    window.addEventListener('beforeunload', () => {
        ankaPersistSessionNow();
        if (ankaHistoryCache) ankaWrite('anka_history', ankaHistoryCache);
    });
    ankaStartSleepTimer();

    if (window.__ankaAuthenticated && !ankaById('tab-bar')?.querySelector('.tab')) ankaOpenInitialTabs();
    if (window.ANKA_RECOVERY_PENDING) {
        const banner = ankaById('crash-recovery-banner');
        const restoreButton = ankaById('crash-recovery-restore');
        const dismissButton = ankaById('crash-recovery-dismiss');
        if (banner) banner.hidden = false;
        if (restoreButton) restoreButton.addEventListener('click', async () => {
            const bridge = ankaBridgeApi();
            if (!bridge) {
                showNotification('Oturum kurtarma kullanılamıyor.');
                return;
            }
            restoreButton.disabled = true;
            try {
                const result = await bridge.invoke('crash-recovery:restore');
                if (!result || !result.ok) throw new Error('Kurtarma verileri açılamadı.');
                window.ANKA_RECOVERY_PENDING = false;
                if (banner) banner.hidden = true;
                if (!result.primary || !ankaRestoreSessionSnapshot(result.primary)) {
                    createNewTab(ankaHomeUrl(), { silent: true });
                }
                showNotification(result.windows > 1
                    ? `${result.windows} pencere ve kaydedilmiş sekmeler geri yüklendi.`
                    : 'Kaydedilmiş sekmeler geri yüklendi.');
            } catch (err) {
                restoreButton.disabled = false;
                console.error('Oturum kurtarma başarısız:', err);
                showNotification(err.message || 'Oturum geri yüklenemedi.');
            }
        });
        if (dismissButton) dismissButton.addEventListener('click', () => {
            window.ANKA_RECOVERY_PENDING = false;
            if (banner) banner.hidden = true;
            ankaOpenInitialTabs();
        });
    }

    window.ankaBrowserApi = {
        openUrl: (value, opts) => ankaOpenExternal(value, opts),
        setDefaultBrowser: ankaSetDefaultBrowser,
        releaseMemory: ankaReleaseMemory,
        toggleReader: () => toggleReaderMode(ankaActiveView()),
        toggleDevTools: () => {
            const view = ankaActiveView();
            if (view && typeof view.openDevTools === 'function') {
                ankaOpenDevTools(view);
                return;
            }
            if (getSetting('dev-tools-shortcut', 'true') === 'false') {
                showNotification('Geliştirici araçları ayarlardan kapalı.');
                return;
            }
            const bridge = ankaBridgeApi();
            if (bridge) bridge.send('devtools-toggle');
            else showNotification('DevTools bu pencerede kullanılamıyor.');
        },
        openCommandPalette,
        openQuickAccessMenu: () => window.openQuickAccessMenu(),
        openDevToolsMenu: () => openDevToolsMenu(ankaActiveView()),
        openDevToolsDetached: () => {
            const view = ankaActiveView();
            if (view && typeof view.openDevTools === 'function') {
                openDevToolsDetached(view);
                return;
            }
            if (getSetting('dev-tools-shortcut', 'true') === 'false') {
                showNotification('Geliştirici araçları ayarlardan kapalı.');
                return;
            }
            const bridge = ankaBridgeApi();
            if (bridge) bridge.send('devtools-detached');
            else showNotification('DevTools bu pencerede kullanılamıyor.');
        },
        openDevToolsDocked: (mode) => openDevToolsDocked(ankaActiveView(), mode),
        closeDevTools: () => closeDevTools(ankaActiveView()),
        commands: ANKA_COMMANDS
    };

    const bridge = ankaBridgeApi();
    ankaExternalReady = true;
    ankaDrainExternal();
    ['menu-btn', 'main-menu-btn', 'app-menu-btn', 'hamburger-btn', 'quick-access-btn', 'tab-dropdown-btn', 'more-btn', 'hizli-erisim-btn'].forEach((id) => {
        const btn = ankaById(id);
        if (btn && !btn.__ankaQAWired) {
            btn.__ankaQAWired = true;
            btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); window.openQuickAccessMenu(); });
        }
    });
    if (bridge) bridge.send('anka-renderer-ready');
});