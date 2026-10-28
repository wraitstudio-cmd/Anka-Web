const AI_TAB_ID = 'tab-ai-assistant';
let activeTabId = null;
let closedTabsStack = [];

const ankaTabs = new Map();
let ankaTabSeq = 0;
const ANKA_LOGO = '../../icons/logo.png';
const ANKA_ALLOWED_FILES = new Set();
const ANKA_GUEST_PREFS = 'contextIsolation=yes, sandbox=yes, nodeIntegration=no, webSecurity=yes, allowRunningInsecureContent=no';
const ANKA_DARK_CSS = 'html{filter:invert(1) hue-rotate(180deg)!important;background:#fff}img,picture,video,canvas,iframe{filter:invert(1) hue-rotate(180deg)!important}';
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
    } catch (err) {}
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

function getFaviconUrl(url, incognito) {
    const logo = window.ankaGetLogo ? window.ankaGetLogo() : ANKA_LOGO;
    try {
        if (incognito || getSetting('favicon-service', 'true') === 'false') return logo;
        if (!url || ankaIsNewTabUrl(url) || /^file:/i.test(url)) return logo;
        const parsed = new URL(url);
        if (ankaIsPrivateHost(parsed.hostname)) return logo;
        return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(parsed.hostname) + '&sz=64';
    } catch (err) {
        return logo;
    }
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
        const P = 'twlrfudhpseo';
        const S = 'tnasmodbricyegk';
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
    }
    return true;
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
            if (e && e.url) createNewTab(e.url);
        });

        vw.addEventListener('dom-ready', () => {
            vw.__ankaReady = true;
            try {
                if (typeof vw.getURL === 'function') checkUrlSecurity(vw.getURL(), vw);
                injectForcedRestrictions(vw);
            } catch (err) {}
        });

        vw.addEventListener('console-message', (e) => {
            if (e && typeof e.message === 'string' && e.message.charCodeAt(0) === 97) ankaHandleBridge(vw, e.message);
        });

        vw.addEventListener('did-fail-load', (e) => {
            if (!e || e.errorCode === -3 || e.isMainFrame === false) return;
            if (vw.__ankaUpgraded && e.validatedURL === vw.__ankaUpgraded) {
                showNotification('Güvenli (HTTPS) bağlantı kurulamadı; HTTP üzerinden açılmadı.');
                return;
            }
            const msg = 'Sayfa yüklenemedi: ' + (e.errorDescription || e.errorCode);
            if (typeof showToast === 'function') showToast(msg, 'error');
            else showNotification(msg);
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
        --anka-z-context: 5000;
        --anka-z-preview: 5500;
        --anka-z-suggest: 6000;
        --anka-z-findbar: 7000;
        --anka-z-side: 8000;
        --anka-z-overlay: 9000;
        --anka-z-toast: 15000;
        --anka-z-link: 14000;
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
        top: 0;
        right: -50%;
        width: 45%;
        min-width: 340px;
        max-width: 780px;
        height: 100%;
        background: var(--anka-surface);
        color: var(--anka-text);
        border-left: 1px solid var(--anka-border);
        z-index: var(--anka-z-side);
        box-shadow: -10px 0 30px rgba(0,0,0,.5);
        display: flex;
        flex-direction: column;
        transition: right .2s ease;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
    }
    #anka-side-devtools.open { right: 0; }
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
        top: 12px;
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
        #anka-side-devtools { width: 92vw; min-width: 0; right: -100%; }
        #anka-side-devtools.open { right: 0; }
    }
    @media (pointer: coarse) {
        #custom-context-menu { min-width: 260px; padding: 8px; }
        .ctx-item { min-height: 46px; padding: 10px 12px; font-size: 14px; }
        .anka-icon-btn, .session-icon-button, .session-primary, .session-secondary, .session-danger { min-height: 46px; }
    }
    @media (prefers-reduced-motion: reduce) {
        #custom-context-menu, #custom-context-submenu, .anka-tab-preview, .anka-toast, #anka-side-devtools { transition: none; }
    }
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

    menu.style.maxWidth = Math.max(0, window.innerWidth - 16) + 'px';
    menu.style.maxHeight = Math.max(0, window.innerHeight - 16) + 'px';
    const menuWidth = Math.min(menu.offsetWidth || 240, Math.max(0, window.innerWidth - 16));
    const menuHeight = Math.min(menu.offsetHeight || (cleaned.length * 36), Math.max(0, window.innerHeight - 16));
    const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
    const top = y + menuHeight <= window.innerHeight - 8 ? y : Math.max(8, y - menuHeight);
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
    if (!await window.ankaConfirm('Geçmiş, kayıtlı notlar ve kapatılan sekmeler temizlensin mi?')) return;
    ankaHistoryCache = [];
    ankaWrite('anka_history', []);
    closedTabsStack.length = 0;
    try {
        localStorage.removeItem('anka_saved_snippets');
        localStorage.removeItem('anka_zoom');
        localStorage.removeItem('anka_last_session');
    } catch (err) {}
    try {
        if (window.electronAPI && typeof window.electronAPI.clearBrowsingData === 'function') window.electronAPI.clearBrowsingData();
    } catch (err) {}
    showNotification('Gezinti verileri temizlendi.');
}

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
    if (q.length < 2) return [];
    const out = [];
    const seen = new Set();
    const push = (entry, kind) => {
        if (out.length >= 8 || seen.has(entry.url)) return;
        if (!String(entry.url).toLowerCase().includes(q) && !String(entry.title || '').toLowerCase().includes(q)) return;
        seen.add(entry.url);
        out.push({ url: entry.url, title: entry.title || entry.url, kind });
    };
    ankaBookmarks().forEach((b) => push(b, '★'));
    ankaHistory().forEach((h) => push(h, '◷'));
    return out;
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
    const go = (value) => {
        hide();
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
                go(it.url);
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
            go(input.value);
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
    const input = ankaById('url-input');
    if (!input || document.activeElement === input) return;
    input.value = ankaIsNewTabUrl(st.url) || st.url === 'about:blank' || /^file:/i.test(st.url) ? '' : st.url;
}

function ankaActiveView() {
    const st = ankaTabs.get(activeTabId);
    return st && st.vw ? st.vw : ankaById(activeTabId);
}

function ankaStateOfView(vw) {
    return vw && vw.id ? ankaTabs.get(vw.id) : null;
}

function ankaOpenDevTools(vw) {
    if (getSetting('dev-tools-shortcut', 'true') === 'false') return;
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.openDevTools !== 'function') {
        showNotification('DevTools bu sekmede kullanılamaz.');
        return;
    }
    try {
        if (typeof vw.isDevToolsOpened === 'function' && vw.isDevToolsOpened()) {
            vw.closeDevTools();
        } else {
            vw.openDevTools();
        }
    } catch (err) {}
}

function openDevToolsDetached(vw) {
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.openDevTools !== 'function') {
        showNotification('DevTools bu sekmede kullanılamaz.');
        return;
    }
    try {
        if (typeof vw.isDevToolsOpened === 'function' && vw.isDevToolsOpened()) vw.closeDevTools();
        vw.openDevTools({ mode: 'detach' });
        showNotification('DevTools ayrı pencerede açıldı.');
    } catch (err) {
        try { vw.openDevTools(); } catch (e) {}
    }
}

function openDevToolsDocked(vw, mode) {
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.openDevTools !== 'function') {
        showNotification('DevTools bu sekmede kullanılamaz.');
        return;
    }
    try {
        if (typeof vw.isDevToolsOpened === 'function' && vw.isDevToolsOpened()) vw.closeDevTools();
        vw.openDevTools({ mode: mode || 'right' });
        const labels = { right: 'sağda', left: 'solda', bottom: 'altta', undocked: 'ayrı' };
        showNotification('DevTools ' + (labels[mode] || mode) + ' açıldı.');
    } catch (err) {
        try { vw.openDevTools(); } catch (e) {}
    }
}

function closeDevTools(vw) {
    if (!vw) vw = ankaActiveView();
    if (!vw || typeof vw.closeDevTools !== 'function') return;
    try { vw.closeDevTools(); showNotification('DevTools kapatıldı.'); } catch (err) {}
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
    const isOpen = typeof vw.isDevToolsOpened === 'function' && vw.isDevToolsOpened();
    const r = window.innerWidth;
    showContextMenu(Math.round(r / 2 - 120), 120, [
        { label: 'Ayrı Pencerede Aç', action: () => openDevToolsDetached(vw) },
        { label: 'Sağ Panelde Aç', action: () => openDevToolsDocked(vw, 'right') },
        { label: 'Sol Panelde Aç', action: () => openDevToolsDocked(vw, 'left') },
        { label: 'Alt Panelde Aç', action: () => openDevToolsDocked(vw, 'bottom') },
        { label: 'Bağımsız (undocked)', action: () => openDevToolsDocked(vw, 'undocked') },
        '---',
        { label: 'Yanda HTML Kaynağını Göster', action: () => toggleSideViewSource(vw) },
        { label: 'Konsolu Temizle', action: () => { try { if (vw.__ankaReady) vw.executeJavaScript('console.clear()'); } catch (e) {} } },
        '---',
        { label: isOpen ? 'DevTools Kapat' : 'DevTools Aç (Varsayılan)', danger: isOpen, action: () => { try { if (vw.isDevToolsOpened && vw.isDevToolsOpened()) vw.closeDevTools(); else vw.openDevTools(); } catch (e) {} } }
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
    st.darkKey = null;
    try {
        vw.insertCSS(ANKA_DARK_CSS).then((key) => { st.darkKey = key; }).catch(() => {});
    } catch (err) {}
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
    try {
        vw.print({ silent: false, printBackground: true });
    } catch (err) {
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

function toggleSideViewSource(vw) {
    let panel = ankaById('anka-side-devtools');
    if (panel && panel.classList.contains('open')) {
        closeSideViewSource();
        return;
    }
    if (!vw || typeof vw.executeJavaScript !== 'function') vw = ankaActiveView();
    if (!vw || typeof vw.executeJavaScript !== 'function') return;

    if (!panel) {
        const copy = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Kopyala' });
        const refresh = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Yenile' });
        const devtools = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'DevTools' });
        const detach = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Ayrı' });
        const dockRight = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Sağ' });
        const dockBottom = ankaMk('button', { type: 'button', className: 'side-dt-close', text: 'Alt' });
        const close = ankaMk('button', { type: 'button', className: 'side-dt-close danger', text: 'Kapat', onclick: closeSideViewSource });
        const search = ankaMk('input', { id: 'side-dt-search', type: 'search', placeholder: 'HTML içinde ara...' });
        const code = ankaMk('pre', { className: 'side-dt-content', id: 'side-dt-code' });
        panel = ankaMk('aside', { id: 'anka-side-devtools' }, ankaMk('div', { className: 'side-dt-header' }, ankaMk('span', { text: 'Anka Web İncele · HTML' }), ankaMk('span', { className: 'side-dt-actions' }, copy, refresh, devtools, detach, dockRight, dockBottom, close)), search, code);
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
            if (!view || typeof view.openDevTools !== 'function') return;
            try {
                if (view.isDevToolsOpened && view.isDevToolsOpened()) view.closeDevTools();
                view.openDevTools();
            } catch (err) {}
        });
        detach.addEventListener('click', () => { const view = panel.__ankaView; if (view) openDevToolsDetached(view); });
        dockRight.addEventListener('click', () => { const view = panel.__ankaView; if (view) openDevToolsDocked(view, 'right'); });
        dockBottom.addEventListener('click', () => { const view = panel.__ankaView; if (view) openDevToolsDocked(view, 'bottom'); });
        panel.__ankaRenderSource = renderMatch;
        panel.__ankaSearch = search;
    }

    panel.__ankaView = vw;
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
    vw.setAttribute('webpreferences', ANKA_GUEST_PREFS);
    if (o.partition) vw.setAttribute('partition', o.partition);
    if (o.preload) vw.setAttribute('preload', o.preload);
    vw.style.cssText = o.style || 'display:none; width:100%; height:100%; flex:1;';
    return vw;
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

    const pinnedView = ankaBuildWebview('', { className: 'pinned-side-webview', partition: vw.getAttribute('partition') || '', style: 'width:100%;height:100%;border:none;' });
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
                { label: 'DevTools Aç/Kapat', shortcut: 'F12', action: () => ankaOpenDevTools(vw) },
                '---',
                { label: 'Ayrı Pencerede Aç', action: () => openDevToolsDetached(vw) },
                { label: 'Sağ Panelde Aç', action: () => openDevToolsDocked(vw, 'right') },
                { label: 'Sol Panelde Aç', action: () => openDevToolsDocked(vw, 'left') },
                { label: 'Alt Panelde Aç', action: () => openDevToolsDocked(vw, 'bottom') },
                '---',
                { label: 'Yanda HTML Kaynağını Göster', action: () => toggleSideViewSource(vw) },
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
        icon.onerror = null;
        icon.src = ANKA_LOGO;
    };
    icon.src = o.icon || (window.ankaGetLogo ? window.ankaGetLogo() : ANKA_LOGO);
    const titleEl = ankaMk('span', { className: 'tab-title', text: o.title });
    const controls = ankaMk('div', { className: 'tab-controls', style: 'display:flex;align-items:center;gap:4px;margin-left:auto;' });
    const muteEl = ankaMk('div', { className: 'mute-tab', title: 'Sesi Aç/Kapat', text: '🔊', style: 'display:none;cursor:pointer;font-size:12px;padding:2px 6px;background:rgba(255,255,255,0.05);border-radius:4px;' });
    muteEl.addEventListener('click', (e) => toggleMute(id, e));
    const closeEl = ankaMk('div', { className: 'close-tab', title: 'Sekmeyi Kapat', style: 'cursor:pointer;display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:rgba(255,71,87,0.2);color:#ff4757;border-radius:4px;' });
    closeEl.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeEl.addEventListener('click', (e) => closeTab(id, e));
    controls.append(muteEl, closeEl);
    tab.append(icon, titleEl, controls);

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
    tab.append(icon, titleEl, memEl, controls);
    const st = { id, tab, icon, titleEl, muteEl, memEl, vw: null, url: o.url, title: o.title || '', internal: o.internal || '', pinned: false, incognito: !!o.incognito, sleeping: false, lastActive: Date.now(), zoom: 0, dark: false, darkKey: null, reader: false, audible: false, muted: false, loading: false, ai: !!o.ai, lastCrash: 0, group: '' };
    ankaTabs.set(id, st);
    if (tabBar) tabBar.append(tab);
    return st;
}

function ankaUpdateMuteButton(st) {
    const show = st.audible || st.muted;
    st.muteEl.style.display = show ? 'block' : 'none';
    st.muteEl.textContent = st.muted ? '🔇' : '🔊';
    st.muteEl.title = st.muted ? 'Sesi Aç' : 'Sesi Kapat';
}

function ankaSetTitle(st, title) {
    st.title = ankaIsNewTabUrl(st.url) ? 'Yeni Sekme' : (title || st.title || '');
    st.titleEl.textContent = ankaTruncate(st.title, 22);
    st.tab.title = st.title;
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
    st.reader = false;
    ankaApplyStoredZoom(st, vw);
    if (st.dark) ankaApplyDark(st, vw);
    ankaRecordHistory(st, url, '');
    if (st.id === activeTabId) {
        ankaSyncUrlBar(st);
        ankaUpdateBookmarkButton();
    }
    ankaPersistSession();
}

function ankaWireTabEvents(st, vw) {
    vw.addEventListener('dom-ready', () => {
        ankaApplyStoredZoom(st, vw);
        if (st.muted) {
            try { vw.setAudioMuted(true); } catch (err) {}
        }
        if (st.dark) ankaApplyDark(st, vw);
        if (typeof syncNewTabTheme === 'function') syncNewTabTheme(vw);
    });
    vw.addEventListener('page-title-updated', (e) => {
        ankaSetTitle(st, e.title);
        ankaUpdateHistoryTitle(st, st.url, e.title);
    });
    vw.addEventListener('page-favicon-updated', (e) => {
        const fav = e.favicons && e.favicons.find((f) => /^(https?|data):/i.test(f));
        if (fav) st.icon.src = fav;
    });
    vw.addEventListener('did-start-loading', () => {
        st.loading = true;
        st.tab.classList.add('loading');
        st.tab.classList.remove('crashed');
    });
    vw.addEventListener('did-stop-loading', () => {
        st.loading = false;
        st.tab.classList.remove('loading');
        ankaSyncTab(st, vw);
        if (typeof window.__ankaScheduleStar === 'function') window.__ankaScheduleStar();
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

function ankaWake(st) {
    if (st.vw) return st.vw;
    const container = ankaById('wv-container');
    if (!container) return null;
    const vw = ankaBuildWebview(st.id, {
        partition: st.incognito ? 'ankaprivate-' + st.id : '',
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
    return vw;
}

function ankaSleepTab(st) {
    if (!st || !st.vw || st.id === activeTabId || st.ai) return false;
    try { st.url = st.vw.getURL() || st.url; } catch (err) {}
    st.vw.remove();
    st.vw = null;
    st.sleeping = true;
    st.loading = false;
    st.audible = false;
    st.reader = false;
    st.tab.classList.remove('loading');
    st.tab.classList.add('sleeping');
    ankaUpdateMuteButton(st);
    return true;
}

function ankaStartSleepTimer() {
    setInterval(() => {
        const minutes = parseInt(getSetting('tab-sleep-minutes', '20'), 10);
        if (!(minutes > 0) || ankaTabs.size < 2) return;
        const limit = Date.now() - minutes * 60000;
        ankaTabs.forEach((st) => {
            if (st.vw && !st.audible && !st.loading && st.lastActive < limit) ankaSleepTab(st);
        });
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
        if (st.id !== activeTabId && !st.ai && !st.audible && !st.loading) live.push(st);
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
    { id: 'settings', label: 'Ayarlar', desc: 'Ayarlar panelini aç', shortcut: 'Ctrl+,', run: () => { if (typeof toggleSettings === 'function') toggleSettings(); } },
    { id: 'downloads', label: 'İndirilenler', desc: 'İndirilenler panelini aç', run: () => { if (typeof window.openAnkaPage === 'function') window.openAnkaPage('downloads'); } },
    { id: 'help', label: 'Yardım', desc: 'Yardım panelini aç', shortcut: 'F1', run: () => { if (typeof window.openAnkaPage === 'function') window.openAnkaPage('help'); else if (typeof toggleHelp === 'function') toggleHelp(); } },
    { id: 'devtools-detach', label: 'DevTools — Ayrı Pencere', desc: 'Geliştirici araçlarını ayrı pencerede aç', shortcut: 'Ctrl+Shift+I', run: () => openDevToolsDetached(ankaActiveView()) },
    { id: 'devtools-right', label: 'DevTools — Sağ Panel', desc: 'Sağ panelde geliştirici araçları', run: () => openDevToolsDocked(ankaActiveView(), 'right') },
    { id: 'devtools-left', label: 'DevTools — Sol Panel', desc: 'Sol panelde geliştirici araçları', run: () => openDevToolsDocked(ankaActiveView(), 'left') },
    { id: 'devtools-bottom', label: 'DevTools — Alt Panel', desc: 'Alt panelde geliştirici araçları', run: () => openDevToolsDocked(ankaActiveView(), 'bottom') },
    { id: 'devtools-undocked', label: 'DevTools — Undocked', desc: 'Bağımsız DevTools penceresi', run: () => openDevToolsDocked(ankaActiveView(), 'undocked') },
    { id: 'devtools-source', label: 'DevTools — HTML Kaynağı Yanda', desc: 'Yanda HTML kaynağını görüntüle', shortcut: 'Ctrl+U', run: () => toggleSideViewSource(ankaActiveView()) },
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

function createNewTab(url = 'newtab.html', opts = {}) {
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
    const secureUrl = internal ? 'anka://' + internal : isNewTab ? getNewTabUrl() : ankaResolveTarget(url);
    if (!secureUrl) return null;

    const isBlank = isNewTab || secureUrl === 'about:blank' || secureUrl.startsWith('file:');
    const internalTitles = { settings: 'Ayarlar', help: 'Yardım', history: 'Geçmiş', downloads: 'İndirilenler' };
    const id = 'tab-' + Date.now() + '-' + (++ankaTabSeq);
    const st = ankaCreateTabEntry(id, {
        title: internalTitles[internal] || (isBlank ? 'Yeni Sekme' : (opts.lazy ? ankaHostLabel(secureUrl) : 'Yükleniyor...')),
        icon: isBlank || internal ? ANKA_LOGO : getFaviconUrl(secureUrl, opts.incognito),
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
    ankaTabIdsInOrder().forEach((tid) => {
        const st = ankaTabs.get(tid);
        if (tid !== keepId && !(st && st.pinned)) closeTab(tid);
    });
}

function closeTabsToRight(targetId) {
    const ids = ankaTabIdsInOrder();
    const from = ids.indexOf(targetId);
    if (from < 0) return;
    ids.slice(from + 1).forEach((tid) => {
        const st = ankaTabs.get(tid);
        if (!(st && st.pinned)) closeTab(tid);
    });
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
        '---',
        {
            label: 'Geliştirici Araçları',
            submenu: [
                { label: 'DevTools Aç / Kapat', shortcut: 'F12', action: () => ankaInspectTab(st, true) },
                { label: 'Ayrı Pencerede Aç', action: () => openDevToolsDetached(st.vw || ankaWake(st)) },
                { label: 'Sağ Panelde Aç', action: () => openDevToolsDocked(st.vw || ankaWake(st), 'right') },
                { label: 'Sol Panelde Aç', action: () => openDevToolsDocked(st.vw || ankaWake(st), 'left') },
                { label: 'Alt Panelde Aç', action: () => openDevToolsDocked(st.vw || ankaWake(st), 'bottom') },
                '---',
                { label: 'HTML Kaynağını Yanda Gör', action: () => ankaInspectTab(st, false) },
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
            input.value = internalUrls[st.internal] || (ankaIsNewTabUrl(st.url) || st.url === 'about:blank' || /^file:/i.test(st.url) ? '' : st.url);
        }
    }
    ankaUpdateBookmarkButton();
    ankaPersistSession();
    ankaEnforceLiveLimit();

    const dropdown = ankaById('tab-dropdown-menu');
    if (dropdown) dropdown.style.display = 'none';
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

function closeTab(id, e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
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
    if (vw) vw.remove();
    if (tabBtn) tabBtn.remove();
    ankaTabs.delete(id);

    if (activeTabId === id) {
        activeTabId = null;
        if (neighbor) switchTab(neighbor);
        else createNewTab(ankaHomeUrl());
    }
    ankaPersistSession();
}

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
    if (getSetting('restore-session', 'false') !== 'true') return;
    const urls = [];
    let active = 0;
    ankaTabIdsInOrder().forEach((id) => {
        const st = ankaTabs.get(id);
        if (!st || st.incognito || st.ai || !/^https?:/i.test(st.url)) return;
        if (id === activeTabId) active = urls.length;
        urls.push(st.url);
    });
    ankaWrite('anka_last_session', { urls, active, time: Date.now() });
}

const ankaPersistSession = ankaDebounce(ankaPersistSessionNow, 800);

function ankaOpenInitialTabs() {
    if (getSetting('school-mode', 'false') === 'true') {
        createNewTab(typeof getStartupUrl === 'function' ? getStartupUrl() : ankaHomeUrl(), { silent: true });
        return;
    }
    if (getSetting('restore-session', 'false') === 'true') {
        const saved = ankaRead('anka_last_session', null);
        if (saved && Array.isArray(saved.urls)) {
            const urls = saved.urls.map(normalizeSessionUrl).filter(Boolean).slice(0, getMaxTabs());
            if (urls.length) {
                const active = Math.min(Math.max(parseInt(saved.active, 10) || 0, 0), urls.length - 1);
                urls.forEach((u, i) => createNewTab(u, i === active ? { silent: true } : { lazy: true, background: true }));
                return;
            }
        }
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
    p: () => openCommandPalette()
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

    window.ankaBrowserApi = {
        openUrl: (value, opts) => ankaOpenExternal(value, opts),
        setDefaultBrowser: ankaSetDefaultBrowser,
        releaseMemory: ankaReleaseMemory,
        toggleReader: () => toggleReaderMode(ankaActiveView()),
        openCommandPalette,
        openDevToolsMenu: () => openDevToolsMenu(ankaActiveView()),
        openDevToolsDetached: () => openDevToolsDetached(ankaActiveView()),
        openDevToolsDocked: (mode) => openDevToolsDocked(ankaActiveView(), mode),
        closeDevTools: () => closeDevTools(ankaActiveView()),
        commands: ANKA_COMMANDS
    };

    const bridge = ankaBridgeApi();
    ankaExternalReady = true;
    ankaDrainExternal();
    if (bridge) bridge.send('anka-renderer-ready');
});