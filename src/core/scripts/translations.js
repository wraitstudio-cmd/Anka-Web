window.AnkaI18n = (function () {
    'use strict';

    var CACHE_KEY = 'anka_i18n_cache_v1';
    var SOURCE_LANG = 'tr';
    var SUPPORTED = ['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ar', 'ja', 'ko', 'zh', 'hi'];
    var TIMEOUT_MS = 8000;
    var PACK_DELAY_MS = 220;
    var FAIL_DELAY_MS = 900;

    var https = null;
    try { https = require('https'); } catch (e) { https = null; }

    var ipcRenderer = null;
    try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }

    var cache = {};
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { cache = {}; }

    var currentLang = 'tr';
    var inflight = new Map();
    var saveTimer = 0;

    function persist() {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
        if (ipcRenderer) {
            try { ipcRenderer.send('i18n-cache-update', cache); } catch (e) {}
        }
    }

    function saveCache() {
        if (saveTimer) return;
        saveTimer = setTimeout(function () { saveTimer = 0; persist(); }, 1500);
    }

    function flushCache() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
        persist();
    }

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    function parseResponse(data, fallback) {
        try {
            var parsed = JSON.parse(data);
            var parts = parsed[0] || [];
            var out = '';
            for (var i = 0; i < parts.length; i++) if (parts[i] && parts[i][0]) out += parts[i][0];
            return out || fallback;
        } catch (e) { return fallback; }
    }

    function translateNode(text, lang) {
        return new Promise(function (resolve) {
            if (!https) { resolve(text); return; }
            var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + SOURCE_LANG + '&tl=' + lang + '&dt=t&q=' + encodeURIComponent(text);
            var done = false;
            var finish = function (v) { if (done) return; done = true; resolve(v || text); };
            try {
                var req = https.get(url, { timeout: TIMEOUT_MS }, function (res) {
                    if (res.statusCode && res.statusCode >= 400) { finish(text); return; }
                    var data = '';
                    res.setEncoding('utf8');
                    res.on('data', function (c) { data += c; });
                    res.on('end', function () { finish(parseResponse(data, text)); });
                });
                req.on('error', function () { finish(text); });
                req.on('timeout', function () { try { req.destroy(); } catch (e) {} finish(text); });
            } catch (e) { finish(text); }
        });
    }

    function translateIpc(text, lang) {
        if (!ipcRenderer) return Promise.resolve(text);
        return ipcRenderer.invoke('i18n-translate', { text: text, source: SOURCE_LANG, target: lang })
            .then(function (out) { return (typeof out === 'string' && out) ? out : text; })
            .catch(function () { return text; });
    }

    function translateOne(text, lang) {
        if (!text || lang === SOURCE_LANG) return Promise.resolve(text);
        var key = lang + '|' + text;
        if (cache[key]) return Promise.resolve(cache[key]);
        if (inflight.has(key)) return inflight.get(key);

        var promise;
        if (https) promise = translateNode(text, lang);
        else promise = translateIpc(text, lang);

        promise = promise.then(function (out) {
            if (out && out !== text) { cache[key] = out; saveCache(); }
            inflight.delete(key);
            return out || text;
        }).catch(function () { inflight.delete(key); return text; });

        inflight.set(key, promise);
        return promise;
    }

    async function translateBatch(texts, lang) {
        if (lang === SOURCE_LANG) return texts;
        var results = new Array(texts.length);
        for (var i = 0; i < texts.length; i += 4) {
            var slice = texts.slice(i, i + 4);
            var out = await Promise.all(slice.map(function (t) { return translateOne(t, lang); }));
            for (var k = 0; k < out.length; k++) results[i + k] = out[k];
        }
        return results;
    }

    function getPackProgress(texts, lang) {
        var total = texts.length;
        if (lang === SOURCE_LANG) return { done: total, total: total, percent: 100 };
        var done = 0;
        for (var i = 0; i < total; i++) {
            if (!texts[i] || cache[lang + '|' + texts[i]]) done++;
        }
        return { done: done, total: total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    }

    function hasPack(texts, lang) {
        if (lang === SOURCE_LANG) return true;
        if (!texts || !texts.length) return false;
        for (var i = 0; i < texts.length; i++) {
            if (texts[i] && !cache[lang + '|' + texts[i]]) return false;
        }
        return true;
    }

    async function downloadPack(texts, lang, onProgress) {
        if (lang === SOURCE_LANG) {
            if (onProgress) onProgress(texts.length, texts.length);
            return { total: texts.length, done: texts.length, fromCache: texts.length, fetched: 0, failed: 0 };
        }
        var total = texts.length;
        var done = 0;
        var fromCache = 0;
        var fetched = 0;
        var failed = 0;
        for (var i = 0; i < total; i++) {
            var text = texts[i];
            if (!text) {
                done++;
                if (onProgress) onProgress(done, total);
                continue;
            }
            var key = lang + '|' + text;
            if (cache[key]) {
                fromCache++;
                done++;
                if (onProgress) onProgress(done, total);
                continue;
            }
            var out = await translateNode(text, lang);
            if (out && out !== text) {
                cache[key] = out;
                fetched++;
            } else {
                failed++;
            }
            done++;
            if (onProgress) onProgress(done, total);
            if (done % 5 === 0) persist();
            if (out && out !== text) await sleep(PACK_DELAY_MS);
            else await sleep(FAIL_DELAY_MS);
        }
        persist();
        return { total: total, done: done, fromCache: fromCache, fetched: fetched, failed: failed };
    }

    function clearCacheForLang(lang) {
        var prefix = lang + '|';
        var keys = Object.keys(cache);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(prefix) === 0) delete cache[keys[i]];
        }
        flushCache();
    }

    function setLang(lang) {
        currentLang = SUPPORTED.indexOf(lang) >= 0 ? lang : 'tr';
        document.documentElement.setAttribute('lang', currentLang);
    }

    function getLang() { return currentLang; }
    function getCache() { return cache; }

    function hydrateCacheFromMain(data) {
        if (!data || typeof data !== 'object') return;
        for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) cache[k] = data[k];
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
    }

    return {
        translateOne: translateOne,
        translateBatch: translateBatch,
        downloadPack: downloadPack,
        getPackProgress: getPackProgress,
        hasPack: hasPack,
        clearCacheForLang: clearCacheForLang,
        setLang: setLang,
        getLang: getLang,
        getCache: getCache,
        hydrateCacheFromMain: hydrateCacheFromMain,
        SUPPORTED: SUPPORTED
    };
})();