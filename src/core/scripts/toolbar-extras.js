(function () {
    'use strict';

    if (window.__ankaXtBookmarks) return;
    window.__ankaXtBookmarks = true;

    const NS = 'anka_x_';
    const GUEST = Object.freeze({ username: 'misafir', name: 'Misafir', avatar: '' });
    const MAX_PROFILES = 8;
    const MAX_BOOKMARKS = 500;
    const MAX_HISTORY = 300;
    const MAX_READING = 200;
    const MAX_TITLE = 80;
    const MAX_NAME = 40;
    const TOGGLE_GAP = 250;
    const SIDE_TABS = Object.freeze(['bookmarks', 'history', 'reading']);
    const SORT_MODES = Object.freeze(['date', 'title', 'visits']);
    const SORT_LABELS = Object.freeze({ date: 'Tarih', title: 'Ad', visits: 'Ziyaret' });
    const CLOSE_ICON = '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const PIN_ICON = '<svg class="xi" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9h7z"/></svg>';
    const DOM_CACHE = new Map();

    const $ = (id) => {
        let node = DOM_CACHE.get(id);
        if (node && node.isConnected) return node;
        node = document.getElementById(id);
        if (node) DOM_CACHE.set(id, node);
        else DOM_CACHE.delete(id);
        return node;
    };

    const readRaw = (key, def) => {
        try {
            const value = localStorage.getItem(key);
            return value === null ? def : JSON.parse(value);
        } catch (err) {
            return def;
        }
    };

    const writeRaw = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            return false;
        }
    };

    const read = (key, def) => readRaw(NS + key, def);
    const write = (key, value) => writeRaw(NS + key, value);

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function icon(markup) {
        const tpl = document.createElement('template');
        tpl.innerHTML = markup;
        return tpl.content.firstChild;
    }

    function hostOf(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (err) {
            return '';
        }
    }

    function isWeb(url) {
        return /^https?:\/\//i.test(url || '');
    }

    function cleanUrl(value) {
        try {
            const parsed = new URL(String(value || '').trim());
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return parsed.href;
        } catch (err) {
            return '';
        }
    }

    function norm(url) {
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            const href = parsed.href;
            return href.endsWith('/') ? href.slice(0, -1) : href;
        } catch (err) {
            return url || '';
        }
    }

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function slugify(str) {
        return (str || '')
            .toLowerCase()
            .replace(/ı/g, 'i')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 24) || 'kullanici';
    }

    function toast(message, type) {
        if (typeof showToast === 'function') showToast(message, type);
    }

    function fireResize() {
        requestAnimationFrame(() => {
            try { window.dispatchEvent(new Event('resize')); } catch (err) {}
        });
    }

    function debounce(fn, wait) {
        let timer = 0;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function lowEnd() {
        return typeof ENV !== 'undefined' && !!ENV && !!ENV.lowEnd;
    }

    function viewUrl(view) {
        try {
            return (typeof view.getURL === 'function' ? view.getURL() : view.src) || '';
        } catch (err) {
            return '';
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => {
            if (c === '&') return '&amp;';
            if (c === '<') return '&lt;';
            if (c === '>') return '&gt;';
            if (c === '"') return '&quot;';
            return '&#39;';
        });
    }

    function highlightText(node, text, query) {
        node.textContent = '';
        const source = String(text || '');
        const q = String(query || '').trim();
        if (!q) {
            node.textContent = source;
            return;
        }
        const lowerSource = source.toLowerCase();
        const lowerQuery = q.toLowerCase();
        let pos = 0;
        let found = false;
        while (pos < source.length) {
            const idx = lowerSource.indexOf(lowerQuery, pos);
            if (idx < 0) {
                node.appendChild(document.createTextNode(source.slice(pos)));
                break;
            }
            found = true;
            if (idx > pos) node.appendChild(document.createTextNode(source.slice(pos, idx)));
            const mark = document.createElement('mark');
            mark.textContent = source.slice(idx, idx + q.length);
            node.appendChild(mark);
            pos = idx + q.length;
        }
        if (!found) node.textContent = source;
    }

    function sanitizeList(list, max, timed, unique) {
        if (!Array.isArray(list)) return [];
        const out = [];
        const used = new Set();
        const keys = new Set();
        for (let i = 0; i < list.length; i++) {
            if (out.length >= max) break;
            const item = list[i];
            if (!item || typeof item !== 'object') continue;
            const url = cleanUrl(item.url);
            if (!url) continue;
            if (unique) {
                const key = norm(url);
                if (keys.has(key)) continue;
                keys.add(key);
            }
            const entry = {
                url,
                title: String(item.title || hostOf(url)).slice(0, MAX_TITLE)
            };
            if (timed) {
                entry.t = Number.isFinite(item.t) ? item.t : Date.now();
            } else {
                let id = typeof item.id === 'string' && item.id ? item.id.slice(0, 24) : uid();
                while (used.has(id)) id = uid();
                used.add(id);
                entry.id = id;
                entry.visits = Number.isFinite(item.visits) ? Math.max(0, Math.floor(item.visits)) : 0;
                entry.pin = item.pin === true;
            }
            out.push(entry);
        }
        return out;
    }

    function navigate(url, newTab) {
        const safe = cleanUrl(url) || (url === 'about:blank' ? url : '');
        if (!safe) return;
        const view = typeof activeView === 'function' ? activeView() : null;
        if (newTab || !view) {
            if (typeof createNewTab === 'function') createNewTab(safe);
            return;
        }
        try {
            if (typeof view.loadURL === 'function') {
                const result = view.loadURL(safe);
                if (result && typeof result.catch === 'function') result.catch(() => {});
            } else {
                view.src = safe;
            }
        } catch (err) {}
    }

    function currentPage() {
        const view = typeof activeView === 'function' ? activeView() : null;
        if (!view) return null;
        const url = viewUrl(view);
        if (!isWeb(url)) return null;
        let title = '';
        try {
            title = typeof view.getTitle === 'function' ? view.getTitle() : '';
        } catch (err) {}
        return { url, title: title || hostOf(url) };
    }

    function getAccounts() {
        const list = readRaw('anka_accounts', null);
        if (!Array.isArray(list) || !list.length) return [Object.assign({}, GUEST)];
        const seen = new Set();
        const clean = [];
        for (let i = 0; i < list.length; i++) {
            const acc = list[i];
            if (!acc || typeof acc !== 'object') continue;
            const username = acc.username
                ? slugify(String(acc.username))
                : slugify(acc.name || String(acc.email || '').split('@')[0]);
            if (seen.has(username)) continue;
            seen.add(username);
            clean.push({
                username,
                name: String(acc.name || 'Kullanıcı').slice(0, MAX_NAME),
                avatar: typeof acc.avatar === 'string' && /^data:image\/(png|jpe?g|gif|webp);/i.test(acc.avatar) ? acc.avatar : ''
            });
        }
        return clean.length ? clean : [Object.assign({}, GUEST)];
    }

    function resolveCurrent(list) {
        const stored = readRaw('anka_current_user', null);
        const name = stored && stored.username;
        for (let i = 0; i < list.length; i++) {
            if (list[i].username === name) return list[i];
        }
        return list[0];
    }

    let accounts = getAccounts();
    let current = resolveCurrent(accounts);
    let activeProfile = current.username;
    let dataOwner = activeProfile;

    const pkey = (name, id) => name + '_' + (id || activeProfile);
    let bookmarks = [];
    let history = [];
    let reading = [];
    let barHidden = false;
    let overflowStart = 0;
    let sideOpen = false;
    let sideTab = 'bookmarks';
    let sortMode = 'date';
    let popup = null;
    let popupOwner = null;
    let histTimer = 0;
    let starRaf = 0;
    let layoutRaf = 0;
    let sideTimer = 0;
    let armTimer = 0;
    let lastToggle = 0;
    const seen = new WeakSet();
    const lastHist = new WeakMap();
    const faviconCache = new Map();

    function loadData() {
        dataOwner = activeProfile;
        const rawBm = read(pkey('bm'), []);
        bookmarks = sanitizeList(rawBm, MAX_BOOKMARKS, false, true);
        history = sanitizeList(read(pkey('hist'), []), MAX_HISTORY, true, false);
        reading = sanitizeList(read(pkey('read'), []), MAX_READING, true, true);
        const storedSort = read(pkey('sort'), 'date');
        sortMode = SORT_MODES.indexOf(storedSort) >= 0 ? storedSort : 'date';
        if (Array.isArray(rawBm) && rawBm.length !== bookmarks.length) saveBookmarks();
    }

    function saveBookmarks() {
        write(pkey('bm'), bookmarks);
    }

    function saveReading() {
        write(pkey('read'), reading);
    }

    function saveSort() {
        write(pkey('sort'), sortMode);
    }

    function flushHistory() {
        clearTimeout(histTimer);
        histTimer = 0;
        write(pkey('hist', dataOwner), history);
    }

    function queueHistorySave() {
        clearTimeout(histTimer);
        histTimer = setTimeout(flushHistory, 1500);
    }

    function closePopup() {
        if (!popup) return;
        try { popup.remove(); } catch (err) {}
        if (popupOwner) popupOwner.classList.remove('active');
        popup = null;
        popupOwner = null;
    }

    function openPopup(anchor, cls, build, align, force) {
        if (!anchor) return null;
        if (!force && popup && popupOwner === anchor) {
            closePopup();
            return null;
        }
        closePopup();
        if (typeof hideContextMenu === 'function') hideContextMenu();
        if (typeof closeTabDropdown === 'function') closeTabDropdown();
        const node = el('div', 'xt-pop ' + cls);
        node.setAttribute('role', 'dialog');
        try { build(node); } catch (err) { return null; }
        document.body.appendChild(node);
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(node.offsetWidth || 340, window.innerWidth - 16);
        const height = Math.min(node.offsetHeight || 320, window.innerHeight - 16);
        const left = align === 'left' ? rect.left : rect.right - width;
        const below = rect.bottom + 6;
        const roomBelow = window.innerHeight - below - 8;
        const roomAbove = rect.top - height - 6;
        const top = roomBelow >= Math.min(height, 180) || roomBelow >= roomAbove ? below : Math.max(8, roomAbove);
        node.style.maxWidth = Math.max(0, window.innerWidth - 16) + 'px';
        node.style.maxHeight = Math.max(0, Math.min(window.innerHeight - 16, top === below ? roomBelow : rect.top - top - 6)) + 'px';
        node.style.left = Math.max(8, Math.min(left, window.innerWidth - width - 8)) + 'px';
        node.style.top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) + 'px';
        node.style.transformOrigin = align === 'left' ? 'top left' : 'top right';
        anchor.classList.add('active');
        popup = node;
        popupOwner = anchor;
        return node;
    }

    function anchorFor(id) {
        const button = $(id);
        return button && button.offsetParent !== null ? button : $('menu-btn');
    }

    function infoNode(name, desc, query) {
        const info = el('div', 'xt-info');
        const nameEl = el('span', 'xt-name');
        if (query) highlightText(nameEl, name, query);
        else nameEl.textContent = String(name || '');
        info.appendChild(nameEl);
        info.appendChild(el('span', 'xt-desc', desc));
        return info;
    }

    function favNode(item) {
        const wrap = el('span', 'bm-fav');
        const host = hostOf(item.url);
        wrap.textContent = ((item.title || host || '?').charAt(0) || '?').toUpperCase();
        if (!host || faviconCache.get(host) === false) return wrap;
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.width = 16;
        img.height = 16;
        img.onload = () => {
            faviconCache.set(host, true);
            if (!wrap.isConnected) return;
            wrap.textContent = '';
            wrap.appendChild(img);
        };
        img.onerror = () => faviconCache.set(host, false);
        img.src = 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(host);
        return wrap;
    }

    function orderedForBar() {
        if (!bookmarks.some((b) => b.pin)) return bookmarks;
        const pinned = [];
        const rest = [];
        for (let i = 0; i < bookmarks.length; i++) {
            (bookmarks[i].pin ? pinned : rest).push(bookmarks[i]);
        }
        return pinned.concat(rest);
    }

    function orderedForSide() {
        const sorted = bookmarks.slice();
        if (sortMode === 'title') {
            sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'tr'));
        } else if (sortMode === 'visits') {
            sorted.sort((a, b) => (b.visits || 0) - (a.visits || 0));
        }
        if (!sorted.some((b) => b.pin)) return sorted;
        const pinned = [];
        const rest = [];
        for (let i = 0; i < sorted.length; i++) {
            (sorted[i].pin ? pinned : rest).push(sorted[i]);
        }
        return pinned.concat(rest);
    }

    function bmNode(item, isNew) {
        const button = el('button', 'bm-item' + (isNew ? ' bm-new' : '') + (item.pin ? ' bm-pinned' : ''));
        button.type = 'button';
        button.dataset.id = item.id;
        button.title = item.title + '\n' + item.url + (item.pin ? '\nSabitlenmiş' : '');
        button.appendChild(favNode(item));
        button.appendChild(el('span', 'bm-label', item.title));
        if (item.pin) button.appendChild(icon(PIN_ICON));
        return button;
    }

    function updateBar() {
        const mode = document.documentElement.dataset.bookmarksBar || 'auto';
        const on = mode === 'always' || (mode === 'auto' && bookmarks.length > 0 && !barHidden);
        const bar = $('bookmarks-bar');
        if (bar) bar.hidden = !on;
        const changed = document.body.classList.contains('bm-visible') !== on;
        document.body.classList.toggle('bm-visible', on);
        if (changed) fireResize();
        if (on) scheduleLayout();
    }

    function layout() {
        layoutRaf = 0;
        if (!document.body.classList.contains('bm-visible')) return;
        const list = $('bm-list');
        const button = $('bm-overflow');
        if (!list || !button) return;
        const items = list.children;
        const count = items.length;
        const measure = () => {
            const limit = list.clientWidth;
            for (let n = 0; n < count; n++) {
                if (items[n].offsetLeft + items[n].offsetWidth > limit) return n;
            }
            return -1;
        };
        for (let n = 0; n < count; n++) items[n].hidden = false;
        button.hidden = true;
        let cut = measure();
        if (cut >= 0) {
            button.hidden = false;
            cut = measure();
        }
        if (cut >= 0) {
            for (let n = cut; n < count; n++) items[n].hidden = true;
        }
        overflowStart = cut >= 0 ? cut : count;
        if (cut < 0 && popupOwner === button) closePopup();
    }

    function scheduleLayout() {
        if (!layoutRaf) layoutRaf = requestAnimationFrame(layout);
    }

    function renderBookmarks(newId) {
        const list = $('bm-list');
        if (!list) return;
        const frag = document.createDocumentFragment();
        const ordered = orderedForBar();
        for (let i = 0; i < ordered.length; i++) frag.appendChild(bmNode(ordered[i], ordered[i].id === newId));
        list.replaceChildren(frag);
        const overflow = $('bm-overflow');
        if (overflow) overflow.hidden = true;
        overflowStart = bookmarks.length;
        updateBar();
        scheduleLayout();
    }

    function findBookmark(url) {
        const key = norm(url);
        for (let i = 0; i < bookmarks.length; i++) {
            if (norm(bookmarks[i].url) === key) return bookmarks[i];
        }
        return null;
    }

    function refreshStar() {
        starRaf = 0;
        const star = $('star-btn');
        if (!star) return;
        const page = currentPage();
        const found = page ? findBookmark(page.url) : null;
        star.classList.toggle('star-on', !!found);
        star.title = (found ? 'Yer İmini Kaldır' : 'Yer İmi Ekle') + ' (Ctrl+D)';
    }

    function scheduleStar() {
        if (!starRaf) starRaf = requestAnimationFrame(refreshStar);
    }

    window.__ankaScheduleStar = scheduleStar;

    function afterBookmarkChange(newId) {
        saveBookmarks();
        renderBookmarks(newId);
        refreshStar();
        if (sideOpen && sideTab === 'bookmarks') renderSide();
    }

    function removeBookmark(item) {
        const key = norm(item.url);
        bookmarks = bookmarks.filter((b) => b !== item && norm(b.url) !== key);
        afterBookmarkChange();
    }

    function togglePin(item) {
        item.pin = !item.pin;
        saveBookmarks();
        renderBookmarks();
        if (sideOpen && sideTab === 'bookmarks') renderSide();
        toast(item.pin ? 'Yer imi sabitlendi' : 'Sabitleme kaldırıldı');
    }

    function bumpVisit(item) {
        item.visits = (item.visits || 0) + 1;
        saveBookmarks();
    }

    function toggleBookmark() {
        const page = currentPage();
        if (!page) {
            toast('Bu sayfa yer imi olarak eklenemez', 'error');
            return;
        }
        const now = Date.now();
        if (now - lastToggle < TOGGLE_GAP) return;
        lastToggle = now;
        const found = findBookmark(page.url);
        if (found) {
            removeBookmark(found);
            toast('Yer imi kaldırıldı');
            return;
        }
        if (bookmarks.length >= MAX_BOOKMARKS) {
            toast('En fazla ' + MAX_BOOKMARKS + ' yer imi eklenebilir', 'error');
            return;
        }
        const item = { id: uid(), url: page.url, title: page.title.slice(0, MAX_TITLE), visits: 0, pin: false };
        bookmarks.push(item);
        if (bookmarks.length === 1 && barHidden) {
            barHidden = false;
            write('bar_hidden', false);
        }
        afterBookmarkChange(item.id);
        toast('Yer imi eklendi');
        const star = $('star-btn');
        if (star) {
            star.classList.add('star-pop');
            setTimeout(() => star.classList.remove('star-pop'), 420);
        }
    }

    function editBookmark(item, anchor) {
        openPopup(anchor, 'xt-edit', (node) => {
            node.appendChild(el('div', 'xt-title', 'Yer İmini Düzenle'));
            const name = el('input', 'xt-input');
            name.value = item.title;
            name.placeholder = 'Ad';
            name.maxLength = MAX_TITLE;
            const url = el('input', 'xt-input');
            url.value = item.url;
            url.placeholder = 'Adres';
            url.spellcheck = false;
            const actions = el('div', 'xt-actions');
            const del = el('button', 'xt-btn danger', 'Sil');
            const save = el('button', 'xt-btn primary', 'Kaydet');
            del.type = 'button';
            save.type = 'button';
            del.addEventListener('click', () => {
                closePopup();
                removeBookmark(item);
            });
            const commit = () => {
                const value = cleanUrl(url.value);
                const clash = value ? findBookmark(value) : null;
                if (!value || (clash && clash !== item)) {
                    url.classList.add('invalid');
                    return;
                }
                item.title = name.value.trim().slice(0, MAX_TITLE) || hostOf(value);
                item.url = value;
                closePopup();
                afterBookmarkChange();
            };
            save.addEventListener('click', commit);
            [name, url].forEach((input) => {
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') commit();
                });
                input.addEventListener('input', () => input.classList.remove('invalid'));
            });
            actions.append(del, save);
            node.append(name, url, actions);
            setTimeout(() => { try { name.select(); } catch (err) {} }, 0);
        }, 'left', true);
    }

    function openOverflow() {
        openPopup($('bm-overflow'), 'xt-overflow', (node) => {
            const frag = document.createDocumentFragment();
            const ordered = orderedForBar();
            for (let i = overflowStart; i < ordered.length; i++) {
                const item = ordered[i];
                const row = el('button', 'xt-row');
                row.type = 'button';
                row.dataset.id = item.id;
                row.appendChild(favNode(item));
                row.appendChild(infoNode(item.title, hostOf(item.url)));
                if (item.pin) row.appendChild(icon(PIN_ICON));
                frag.appendChild(row);
            }
            node.appendChild(frag);
            node.addEventListener('click', (event) => {
                const row = event.target.closest('.xt-row');
                if (!row) return;
                const item = bookmarks.find((b) => b.id === row.dataset.id);
                closePopup();
                if (item) {
                    bumpVisit(item);
                    navigate(item.url, event.ctrlKey || event.metaKey);
                }
            });
        }, 'right');
    }

    function initialOf(profile) {
        return ((profile.name || profile.username || '?').charAt(0) || '?').toUpperCase();
    }

    function avatarContent(profile) {
        if (!profile.avatar) return document.createTextNode(initialOf(profile));
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.src = profile.avatar;
        img.addEventListener('error', () => {
            if (img.isConnected) img.replaceWith(document.createTextNode(initialOf(profile)));
        }, { once: true });
        return img;
    }

    function avatarNode(profile, big) {
        const node = el('span', 'xt-avatar' + (big ? ' big' : ''));
        node.appendChild(avatarContent(profile));
        return node;
    }

    function updateProfileButton() {
        const button = $('profile-btn');
        if (!button) return;
        button.replaceChildren(avatarContent(current));
        button.title = 'Profil: ' + (current.name || current.username);
    }

    function setCurrent(profile) {
        writeRaw('anka_current_user', profile);
    }

    function syncProfile() {
        const prev = activeProfile;
        accounts = getAccounts();
        current = resolveCurrent(accounts);
        activeProfile = current.username;
        updateProfileButton();
        if (activeProfile !== prev) {
            flushHistory();
            loadData();
            renderBookmarks();
            refreshStar();
            if (sideOpen) renderSide();
        }
        if (popup && popupOwner === $('profile-btn')) buildProfile(popup);
    }

    function switchProfile(username) {
        const target = accounts.find((acc) => acc.username === username);
        if (!target) return;
        if (username === activeProfile) {
            closePopup();
            return;
        }
        setCurrent(target);
        syncProfile();
        closePopup();
        toast('Profil: ' + (target.name || target.username));
    }

    function removeProfile(username) {
        const wasCurrent = username === activeProfile;
        let next = accounts.filter((acc) => acc.username !== username);
        if (!next.length) next = [Object.assign({}, GUEST)];
        writeRaw('anka_accounts', next);
        ['bm', 'hist', 'read', 'sort'].forEach((name) => {
            try { localStorage.removeItem(NS + pkey(name, username)); } catch (err) {}
        });
        if (wasCurrent) setCurrent(next[0]);
        syncProfile();
    }

    function addProfile(name) {
        if (accounts.length >= MAX_PROFILES) {
            toast('En fazla ' + MAX_PROFILES + ' profil eklenebilir', 'error');
            return;
        }
        const base = slugify(name);
        let username = base;
        for (let n = 2; accounts.some((acc) => acc.username === username); n++) {
            username = base.slice(0, 20) + '_' + n;
        }
        const profile = { username, name: name.slice(0, MAX_NAME), avatar: '' };
        writeRaw('anka_accounts', accounts.concat(profile));
        setCurrent(profile);
        syncProfile();
        toast('Profil: ' + profile.name);
    }

    function renameProfile(value) {
        if (current.username === GUEST.username) return;
        const list = getAccounts().map((acc) => (acc.username === current.username ? Object.assign({}, acc, { name: value }) : acc));
        writeRaw('anka_accounts', list);
        setCurrent(list.find((acc) => acc.username === current.username));
        syncProfile();
    }

    function downloadFile(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (err) {
            toast('Dosya indirilemedi', 'error');
        }
    }

    function exportBookmarks() {
        try {
            const payload = {
                version: 1,
                exported: Date.now(),
                profile: current.name || current.username,
                bookmarks: bookmarks.map((b) => ({ url: b.url, title: b.title, visits: b.visits || 0, pin: !!b.pin })),
                reading: reading.map((r) => ({ url: r.url, title: r.title, t: r.t }))
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const stamp = new Date().toISOString().slice(0, 10);
            downloadFile(blob, 'anka-yer-imleri-' + stamp + '.json');
            toast('Yer imleri yedeklendi');
        } catch (err) {
            toast('Yedekleme başarısız', 'error');
        }
    }

    function exportBookmarksHtml() {
        try {
            const ordered = orderedForSide();
            const lines = [
                '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
                '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
                '<TITLE>Bookmarks</TITLE>',
                '<H1>Bookmarks</H1>',
                '<DL><p>'
            ];
            for (let i = 0; i < ordered.length; i++) {
                const item = ordered[i];
                const ts = Math.floor(Date.now() / 1000);
                lines.push('    <DT><A HREF="' + escapeHtml(item.url) + '" ADD_DATE="' + ts + '">' + escapeHtml(item.title) + '</A>');
            }
            lines.push('</DL><p>');
            const blob = new Blob([lines.join('\n')], { type: 'text/html;charset=utf-8' });
            const stamp = new Date().toISOString().slice(0, 10);
            downloadFile(blob, 'anka-yer-imleri-' + stamp + '.html');
            toast('HTML olarak yedeklendi');
        } catch (err) {
            toast('Yedekleme başarısız', 'error');
        }
    }

    function parseJsonBookmarks(text) {
        try {
            const data = JSON.parse(text);
            const list = Array.isArray(data) ? data : (data && Array.isArray(data.bookmarks) ? data.bookmarks : []);
            const items = [];
            const seenUrls = new Set();
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (!item || typeof item !== 'object') continue;
                const url = cleanUrl(item.url);
                if (!url) continue;
                const key = norm(url);
                if (seenUrls.has(key)) continue;
                seenUrls.add(key);
                items.push({
                    url,
                    title: String(item.title || hostOf(url)).slice(0, MAX_TITLE),
                    visits: Number.isFinite(item.visits) ? Math.max(0, Math.floor(item.visits)) : 0,
                    pin: item.pin === true
                });
            }
            return items;
        } catch (err) {
            return [];
        }
    }

    function parseHtmlBookmarks(text) {
        try {
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const links = doc.querySelectorAll('a[href]');
            const items = [];
            const seenUrls = new Set();
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const url = cleanUrl(link.getAttribute('href'));
                if (!url) continue;
                const key = norm(url);
                if (seenUrls.has(key)) continue;
                seenUrls.add(key);
                items.push({
                    url,
                    title: String(link.textContent || hostOf(url)).trim().slice(0, MAX_TITLE) || hostOf(url),
                    visits: 0,
                    pin: false
                });
            }
            return items;
        } catch (err) {
            return [];
        }
    }

    function importBookmarkItems(items, includeReading) {
        const existing = new Set(bookmarks.map((b) => norm(b.url)));
        let added = 0;
        for (let i = 0; i < items.length; i++) {
            if (bookmarks.length >= MAX_BOOKMARKS) break;
            const item = items[i];
            const key = norm(item.url);
            if (existing.has(key)) continue;
            existing.add(key);
            bookmarks.push({
                id: uid(),
                url: item.url,
                title: (item.title || hostOf(item.url)).slice(0, MAX_TITLE),
                visits: item.visits || 0,
                pin: item.pin === true
            });
            added += 1;
        }
        if (added) {
            if (barHidden) {
                barHidden = false;
                write('bar_hidden', false);
            }
            afterBookmarkChange();
        }
        if (includeReading && Array.isArray(includeReading)) {
            const existingRead = new Set(reading.map((r) => norm(r.url)));
            let readAdded = 0;
            for (let i = 0; i < includeReading.length; i++) {
                if (reading.length >= MAX_READING) break;
                const item = includeReading[i];
                if (!item || typeof item !== 'object') continue;
                const url = cleanUrl(item.url);
                if (!url) continue;
                const key = norm(url);
                if (existingRead.has(key)) continue;
                existingRead.add(key);
                reading.push({
                    url,
                    title: String(item.title || hostOf(url)).slice(0, MAX_TITLE),
                    t: Number.isFinite(item.t) ? item.t : Date.now()
                });
                readAdded += 1;
            }
            if (readAdded) saveReading();
        }
        if (added) toast(added + ' yer imi eklendi');
        else toast('Yeni yer imi yok', 'error');
    }

    function triggerImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.html,.htm,.json,application/json,text/html';
        input.style.display = 'none';
        const cleanup = () => { try { input.remove(); } catch (err) {} };
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) {
                cleanup();
                return;
            }
            let text = '';
            try {
                text = await file.text();
            } catch (err) {
                toast('Dosya okunamadı', 'error');
                cleanup();
                return;
            }
            const isJson = /\.json$/i.test(file.name) || /^\s*[{[]/.test(text);
            let items = [];
            let readingItems = null;
            if (isJson) {
                items = parseJsonBookmarks(text);
                try {
                    const parsed = JSON.parse(text);
                    if (parsed && Array.isArray(parsed.reading)) readingItems = parsed.reading;
                } catch (err) {}
            } else {
                items = parseHtmlBookmarks(text);
            }
            if (!items.length) {
                toast('İçe aktarılacak yer imi bulunamadı', 'error');
                cleanup();
                return;
            }
            const message = items.length + ' yer imi bulundu. İçe aktarılsın mı?';
            const confirmed = typeof window.ankaConfirm === 'function'
                ? await window.ankaConfirm(message)
                : window.confirm(message);
            if (confirmed) importBookmarkItems(items, readingItems);
            cleanup();
        });
        document.body.appendChild(input);
        try { input.click(); } catch (err) { cleanup(); }
    }

    function buildProfile(node) {
        node.replaceChildren();
        const isGuest = current.username === GUEST.username;
        const head = el('div', 'xt-profile-head');
        const info = el('div', 'xt-info');
        const nameInput = el('input', 'xt-input flat');
        nameInput.value = current.name;
        nameInput.maxLength = MAX_NAME;
        nameInput.readOnly = isGuest;
        nameInput.setAttribute('aria-label', 'Profil adı');
        nameInput.addEventListener('change', () => {
            const value = nameInput.value.trim();
            if (!value) {
                nameInput.value = current.name;
                return;
            }
            renameProfile(value);
        });
        nameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') nameInput.blur();
        });
        info.appendChild(nameInput);
        info.appendChild(el('span', 'xt-desc', '@' + current.username + ' · yer imleri ve geçmiş ayrı tutulur'));
        head.appendChild(avatarNode(current, true));
        head.appendChild(info);

        const frag = document.createDocumentFragment();
        frag.appendChild(head);

        accounts.forEach((profile) => {
            const row = el('div', 'xt-row' + (profile.username === activeProfile ? ' current' : ''));
            row.dataset.id = profile.username;
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            row.appendChild(avatarNode(profile, false));
            row.appendChild(infoNode(profile.name || profile.username, profile.username === activeProfile ? 'Kullanımda' : 'Geçiş yap'));
            if (profile.username !== activeProfile && accounts.length > 1) {
                const del = el('button', 'xt-del');
                del.type = 'button';
                del.title = 'Profili sil';
                del.setAttribute('aria-label', 'Profili sil');
                del.appendChild(icon(CLOSE_ICON));
                row.appendChild(del);
            }
            frag.appendChild(row);
        });

        const addRow = el('div', 'xt-add-row');
        const addInput = el('input', 'xt-input');
        addInput.placeholder = 'Yeni profil adı';
        addInput.maxLength = MAX_NAME;
        const addBtn = el('button', 'xt-btn primary small', 'Ekle');
        addBtn.type = 'button';
        const add = () => {
            const value = addInput.value.trim();
            if (value) addProfile(value);
        };
        addBtn.addEventListener('click', add);
        addInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') add();
        });
        addRow.append(addInput, addBtn);
        frag.appendChild(addRow);

        const tools = el('div', 'xt-actions');
        const exportBtn = el('button', 'xt-btn small', 'Yedekle');
        const htmlBtn = el('button', 'xt-btn small', 'HTML');
        const importBtn = el('button', 'xt-btn small', 'Geri Yükle');
        exportBtn.type = 'button';
        htmlBtn.type = 'button';
        importBtn.type = 'button';
        exportBtn.addEventListener('click', exportBookmarks);
        htmlBtn.addEventListener('click', exportBookmarksHtml);
        importBtn.addEventListener('click', () => {
            closePopup();
            triggerImport();
        });
        tools.append(exportBtn, htmlBtn, importBtn);
        frag.appendChild(tools);
        node.appendChild(frag);

        node.onclick = (event) => {
            const del = event.target.closest('.xt-del');
            const row = event.target.closest('.xt-row');
            if (!row) return;
            if (del) {
                if (del.classList.contains('armed')) {
                    removeProfile(row.dataset.id);
                } else {
                    del.classList.add('armed');
                    del.title = 'Silmek için tekrar dokun';
                    setTimeout(() => del.classList.remove('armed'), 2500);
                }
                return;
            }
            switchProfile(row.dataset.id);
        };
        node.onkeydown = (event) => {
            if (event.key !== 'Enter' || event.target.tagName === 'INPUT') return;
            const row = event.target.closest('.xt-row');
            if (row && !event.target.closest('.xt-del')) switchProfile(row.dataset.id);
        };
    }

    function openProfile() {
        openPopup(anchorFor('profile-btn'), 'xt-profile', buildProfile, 'right');
    }

    function sideSource() {
        if (sideTab === 'history') return history;
        if (sideTab === 'reading') return reading;
        return orderedForSide();
    }

    function syncSideTabs() {
        document.querySelectorAll('.xt-tabs button[data-tab]').forEach((tab) => {
            const on = tab.dataset.tab === sideTab;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', String(on));
        });
        const sortBtn = $('xt-sort-btn');
        if (sortBtn) {
            sortBtn.textContent = SORT_LABELS[sortMode] || 'Tarih';
            sortBtn.title = 'Sıralama: ' + (SORT_LABELS[sortMode] || 'Tarih') + ' (değiştirmek için tıkla)';
        }
    }

    function dayLabel(time) {
        const day = new Date(time);
        day.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diff = Math.round((today - day) / 86400000);
        if (diff === 0) return 'Bugün';
        if (diff === 1) return 'Dün';
        return day.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function sideRow(item, index, query) {
        const row = el('div', 'xt-row');
        row.dataset.i = String(index);
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.title = item.url;
        row.appendChild(favNode(item));
        row.appendChild(infoNode(item.title || hostOf(item.url), hostOf(item.url) || item.url, query));
        if (sideTab === 'history') {
            row.appendChild(el('span', 'xt-time', new Date(item.t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })));
        }
        if (sideTab === 'bookmarks') {
            const pin = el('button', 'xt-pin' + (item.pin ? ' pinned' : ''));
            pin.type = 'button';
            pin.title = item.pin ? 'Sabitlemeyi kaldır' : 'Sabitle';
            pin.setAttribute('aria-label', 'Sabitle');
            pin.appendChild(icon(PIN_ICON));
            row.appendChild(pin);
        }
        const del = el('button', 'xt-del');
        del.type = 'button';
        del.title = 'Kaldır';
        del.setAttribute('aria-label', 'Kaldır');
        del.appendChild(icon(CLOSE_ICON));
        row.appendChild(del);
        return row;
    }

    function renderSide() {
        const list = $('xt-side-list');
        const action = $('xt-side-action');
        const search = $('xt-side-search');
        if (!list || !action || !search) return;
        const query = search.value.trim().toLowerCase();
        const source = sideSource();
        const frag = document.createDocumentFragment();
        action.dataset.armed = '0';
        clearTimeout(armTimer);
        const page = currentPage();
        if (sideTab === 'bookmarks') action.textContent = page && findBookmark(page.url) ? 'Yer İmini Kaldır' : 'Sayfayı Ekle';
        else if (sideTab === 'history') action.textContent = 'Geçmişi Temizle';
        else action.textContent = 'Sayfayı Ekle';

        let shown = 0;
        let lastGroup = '';
        for (let i = 0; i < source.length && shown < 200; i++) {
            const item = source[i];
            if (query) {
                const hay = ((item.title || '') + ' ' + item.url).toLowerCase();
                if (hay.indexOf(query) < 0) continue;
            }
            if (sideTab === 'history') {
                const label = dayLabel(item.t);
                if (label !== lastGroup) {
                    frag.appendChild(el('div', 'xt-group', label));
                    lastGroup = label;
                }
            }
            frag.appendChild(sideRow(item, i, query));
            shown += 1;
        }
        if (!shown) {
            const messages = {
                bookmarks: 'Henüz yer imi yok',
                history: 'Geçmiş boş',
                reading: 'Okuma listen boş'
            };
            frag.appendChild(el('div', 'xt-empty', query ? 'Sonuç bulunamadı' : messages[sideTab]));
        }
        list.replaceChildren(frag);
        const sortBtn = $('xt-sort-btn');
        if (sortBtn) sortBtn.style.display = sideTab === 'bookmarks' ? '' : 'none';
    }

    function ensureSortButton() {
        if ($('xt-sort-btn')) return;
        const tabs = document.querySelector('.xt-tabs');
        if (!tabs) return;
        const btn = el('button', 'xt-sort-btn');
        btn.id = 'xt-sort-btn';
        btn.type = 'button';
        btn.textContent = SORT_LABELS[sortMode] || 'Tarih';
        btn.title = 'Sıralama: ' + (SORT_LABELS[sortMode] || 'Tarih') + ' (değiştirmek için tıkla)';
        btn.style.cssText = 'margin-left:auto;padding:4px 10px;font-size:12px;background:transparent;border:1px solid currentColor;color:inherit;border-radius:4px;cursor:pointer;opacity:0.75;';
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const idx = SORT_MODES.indexOf(sortMode);
            sortMode = SORT_MODES[(idx + 1) % SORT_MODES.length];
            saveSort();
            syncSideTabs();
            renderSide();
        });
        tabs.appendChild(btn);
    }

    function openSide(tab, keepOpen) {
        ensureSortButton();
        const panel = $('xt-side');
        if (!panel) return;
        if (sideOpen && !keepOpen && (!tab || tab === sideTab)) {
            closeSide();
            return;
        }
        if (tab && SIDE_TABS.indexOf(tab) >= 0) sideTab = tab;
        const wasOpen = sideOpen;
        sideOpen = true;
        panel.hidden = false;
        const btn = $('side-btn');
        if (btn) {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
        }
        const search = $('xt-side-search');
        if (search) search.value = '';
        syncSideTabs();
        renderSide();
        if (!wasOpen) fireResize();
    }

    function closeSide() {
        if (!sideOpen) return;
        sideOpen = false;
        const panel = $('xt-side');
        if (panel) panel.hidden = true;
        const btn = $('side-btn');
        if (btn) {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        }
        fireResize();
    }

    function addReading() {
        const page = currentPage();
        if (!page) {
            toast('Bu sayfa eklenemez', 'error');
            return;
        }
        const key = norm(page.url);
        for (let i = 0; i < reading.length; i++) {
            if (norm(reading[i].url) === key) {
                toast('Sayfa zaten okuma listesinde');
                return;
            }
        }
        reading.unshift({ url: page.url, title: page.title.slice(0, MAX_TITLE), t: Date.now() });
        if (reading.length > MAX_READING) reading.length = MAX_READING;
        saveReading();
        toast('Okuma listesine eklendi');
        renderSide();
    }

    function sideAction() {
        const action = $('xt-side-action');
        if (!action) return;
        if (sideTab === 'bookmarks') {
            toggleBookmark();
            return;
        }
        if (sideTab === 'reading') {
            addReading();
            return;
        }
        if (action.dataset.armed === '1') {
            clearTimeout(armTimer);
            history = [];
            flushHistory();
            renderSide();
            toast('Geçmiş temizlendi');
            return;
        }
        action.dataset.armed = '1';
        action.textContent = 'Emin misin?';
        armTimer = setTimeout(() => {
            action.dataset.armed = '0';
            action.textContent = 'Geçmişi Temizle';
        }, 2500);
    }

    function bindSide() {
        const closeBtn = $('xt-side-close');
        if (closeBtn) closeBtn.addEventListener('click', closeSide);
        const action = $('xt-side-action');
        if (action) action.addEventListener('click', sideAction);
        const search = $('xt-side-search');
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(sideTimer);
                sideTimer = setTimeout(renderSide, lowEnd() ? 200 : 110);
            });
        }
        const tabs = document.querySelector('.xt-tabs');
        if (tabs) {
            tabs.addEventListener('click', (event) => {
                const tab = event.target.closest('button[data-tab]');
                if (!tab || SIDE_TABS.indexOf(tab.dataset.tab) < 0) return;
                sideTab = tab.dataset.tab;
                if (search) search.value = '';
                syncSideTabs();
                renderSide();
            });
        }
        const list = $('xt-side-list');
        if (!list) return;
        const open = (event, forceNew) => {
            const row = event.target.closest('.xt-row');
            if (!row) return;
            const index = Number(row.dataset.i);
            const source = sideSource();
            const pinBtn = event.target.closest('.xt-pin');
            if (pinBtn) {
                event.stopPropagation();
                const item = source[index];
                if (item && sideTab === 'bookmarks') togglePin(item);
                return;
            }
            if (event.target.closest('.xt-del')) {
                const item = source[index];
                if (!item) return;
                if (sideTab === 'bookmarks') {
                    removeBookmark(item);
                } else {
                    source.splice(index, 1);
                    if (sideTab === 'history') flushHistory();
                    else saveReading();
                    renderSide();
                }
                return;
            }
            const item = source[index];
            if (!item) return;
            if (sideTab === 'bookmarks') bumpVisit(item);
            navigate(item.url, forceNew || event.ctrlKey || event.metaKey);
        };
        list.addEventListener('click', (event) => open(event, false));
        list.addEventListener('auxclick', (event) => {
            if (event.button === 1) open(event, true);
        });
        list.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.target.closest('.xt-del') && !event.target.closest('.xt-pin')) open(event, false);
        });
    }

    function isIncognito(view) {
        if (!view || !view.id) return false;
        const tab = document.getElementById('btn-' + view.id);
        return !!tab && tab.classList.contains('incognito');
    }

    function recordHistory(view, url) {
        if (!isWeb(url) || isIncognito(view)) return;
        const last = history[0];
        if (last && last.url === url) {
            last.t = Date.now();
            lastHist.set(view, last);
        } else {
            const entry = { url, title: hostOf(url) || url, t: Date.now() };
            history.unshift(entry);
            if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
            lastHist.set(view, entry);
        }
        queueHistorySave();
        if (sideOpen && sideTab === 'history') {
            clearTimeout(sideTimer);
            sideTimer = setTimeout(renderSide, 250);
        }
    }

    function updateHistoryTitle(view, title) {
        const entry = lastHist.get(view);
        if (!entry || !title || entry.url !== viewUrl(view) || history.indexOf(entry) < 0) return;
        entry.title = String(title).slice(0, MAX_TITLE);
        queueHistorySave();
    }

    function bindView(view) {
        if (!view || seen.has(view)) return;
        if (view.tagName !== 'WEBVIEW' && !(view.classList && view.classList.contains('anka-frame'))) return;
        seen.add(view);
        view.addEventListener('did-navigate', (event) => {
            recordHistory(view, event.url || viewUrl(view));
            scheduleStar();
        });
        view.addEventListener('did-navigate-in-page', (event) => {
            if (event.isMainFrame === false) return;
            recordHistory(view, event.url || viewUrl(view));
            scheduleStar();
        });
        view.addEventListener('page-title-updated', (event) => updateHistoryTitle(view, event.title));
    }

    function toggleBar() {
        if (['auto', ''].indexOf(document.documentElement.dataset.bookmarksBar || '') < 0) {
            toast('Yer imleri çubuğu görünürlüğü ayarlardan yönetiliyor');
            return;
        }
        if (!bookmarks.length) {
            toast('Henüz yer imi yok');
            return;
        }
        barHidden = !barHidden;
        write('bar_hidden', barHidden);
        updateBar();
    }

    function goHome() {
        const home = typeof getHomeUrl === 'function' ? getHomeUrl() : 'about:blank';
        if (home === 'about:blank') {
            navigate(home);
            return;
        }
        try {
            navigate(new URL(home, location.href).href);
        } catch (err) {
            navigate('about:blank');
        }
    }

    function bindToolbar() {
        const home = $('home-btn');
        if (home) home.addEventListener('click', goHome);
        const star = $('star-btn');
        if (star) star.addEventListener('click', toggleBookmark);
        const side = $('side-btn');
        if (side) side.addEventListener('click', () => openSide());
        window.__ankaOpenHistory = () => openSide('history', true);
        window.__ankaUpdateBookmarksBar = updateBar;
        const profileBtn = $('profile-btn');
        if (profileBtn) profileBtn.addEventListener('click', openProfile);
        const overflow = $('bm-overflow');
        if (overflow) overflow.addEventListener('click', openOverflow);

        const list = $('bm-list');
        if (!list) return;
        const find = (event) => {
            const node = event.target.closest('.bm-item');
            return node ? bookmarks.find((b) => b.id === node.dataset.id) : null;
        };
        list.addEventListener('click', (event) => {
            const item = find(event);
            if (item) {
                bumpVisit(item);
                navigate(item.url, event.ctrlKey || event.metaKey);
            }
        });
        list.addEventListener('mousedown', (event) => {
            if (event.button === 1) event.preventDefault();
        });
        list.addEventListener('auxclick', (event) => {
            if (event.button !== 1) return;
            const item = find(event);
            if (item) {
                event.preventDefault();
                bumpVisit(item);
                navigate(item.url, true);
            }
        });
        list.addEventListener('contextmenu', (event) => {
            const node = event.target.closest('.bm-item');
            if (!node) return;
            event.preventDefault();
            const item = bookmarks.find((b) => b.id === node.dataset.id);
            if (item) editBookmark(item, node);
        });
    }

    function bindGlobal() {
        window.addEventListener('anka-history-cleared', () => {
            history = sanitizeList(read(pkey('hist'), []), MAX_HISTORY, true, false);
            if (sideOpen && sideTab === 'history') renderSide();
        });

        window.addEventListener('pointerdown', (event) => {
            if (!popup) return;
            if (popup.contains(event.target)) return;
            if (popupOwner && popupOwner.contains(event.target)) return;
            closePopup();
        }, true);

        window.addEventListener('blur', closePopup);
        window.addEventListener('resize', () => {
            closePopup();
            scheduleLayout();
        }, { passive: true });
        window.addEventListener('pagehide', flushHistory);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushHistory();
        });

        const onStorage = debounce(syncProfile, 40);
        window.addEventListener('storage', (event) => {
            if (event.key === null || event.key === 'anka_accounts' || event.key === 'anka_current_user') onStorage();
        });

        window.addEventListener('keydown', (event) => {
            if (window.__ankaRequireLogin && !window.__ankaAuthenticated) return;
            if (!event.key) return;
            if (event.key === 'Escape') {
                closePopup();
                return;
            }
            if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'Home') {
                event.preventDefault();
                if (!event.repeat) goHome();
                return;
            }
            const mod = event.ctrlKey || event.metaKey;
            if (!mod || event.altKey) return;
            const code = event.code;
            const isD = code === 'KeyD' && !event.shiftKey;
            const isBar = code === 'KeyB' && event.shiftKey;
            const isMarks = code === 'KeyO' && event.shiftKey;
            const isSide = code === 'KeyY' && event.shiftKey;
            if (!isD && !isBar && !isMarks && !isSide) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat) return;
            if (isD) toggleBookmark();
            else if (isBar) toggleBar();
            else if (isSide) openSide();
            else openSide('bookmarks');
        }, true);

        if (typeof ResizeObserver === 'function') {
            const bmList = $('bm-list');
            if (bmList) new ResizeObserver(scheduleLayout).observe(bmList);
        }

        const container = $('wv-container');
        if (container) {
            container.querySelectorAll('webview, iframe.anka-frame').forEach(bindView);
            new MutationObserver((records) => {
                for (let i = 0; i < records.length; i++) {
                    const added = records[i].addedNodes;
                    for (let j = 0; j < added.length; j++) {
                        const node = added[j];
                        if (node.nodeType === 1) bindView(node);
                    }
                }
                scheduleStar();
            }).observe(container, { childList: true, attributes: true, attributeFilter: ['class'] });
        }
    }

    function init() {
        barHidden = read('bar_hidden', false) === true;
        loadData();
        bindToolbar();
        bindSide();
        bindGlobal();
        updateProfileButton();
        renderBookmarks();
        setTimeout(refreshStar, 400);
    }

    init();
})();