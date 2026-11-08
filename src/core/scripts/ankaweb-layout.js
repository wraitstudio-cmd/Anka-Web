(function () {
    'use strict';

    const PAGES = { settings: 'Ayarlar', help: 'Yardım', history: 'Geçmiş', downloads: 'İndirilenler' };
    const $ = (id) => document.getElementById(id);
    const RISKY_EXT_RE = /\.(exe|msi|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|jar|sh|bash|zsh|desktop|appimage|deb|rpm|run|dll|so|dylib|reg|lnk|url|command|pkg|html?|shtml|xhtml|svg|xml|mht|mhtml|xsl|xslt)$/i;
    const MS_PER_DAY = 86400000;
    const PAGE_URLS = { settings: 'ankaweb://ayarlar', help: 'ankaweb://yardım', downloads: 'ankaweb://indirilenler', history: 'ankaweb://geçmiş' };

    let memTimer = 0;
    let pageKind = '';
    let pageFilter = 'all';
    let searchDebounce = 0;
    let ipcCache;
    let ipcFailed = false;

    function getIpc() {
        if (ipcCache) return ipcCache;
        if (ipcFailed) return null;
        try {
            const electron = require('electron');
            ipcCache = electron && electron.ipcRenderer ? electron.ipcRenderer : null;
        } catch (err) {
            ipcCache = null;
        }
        if (!ipcCache) ipcFailed = true;
        return ipcCache;
    }

    function ls(id, fallback) {
        try {
            const v = localStorage.getItem('set_' + id);
            return v === null ? fallback : v;
        } catch (err) {
            return fallback;
        }
    }

    function dayLabel(time, todayStartMs) {
        const day = new Date(Number(time) || Date.now());
        day.setHours(0, 0, 0, 0);
        const diff = Math.round((todayStartMs - day.getTime()) / MS_PER_DAY);
        if (diff === 0) return 'Bugün';
        if (diff === 1) return 'Dün';
        if (diff < 7) return day.toLocaleDateString('tr-TR', { weekday: 'long' });
        return day.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function applyChromeLayout() {
        const root = document.documentElement;
        const sidebarSide = ls('sidebar-side', 'left') === 'right' ? 'right' : 'left';
        const sidePanelSide = ls('side-panel-side', 'right') === 'left' ? 'left' : 'right';
        const bookmarksBar = ls('bookmarks-bar', 'auto');
        const showHome = ls('show-home-btn', 'true') === 'false' ? 'off' : 'on';
        const tabMem = ls('tab-memory', 'false') === 'true' ? 'on' : 'off';
        const zoom = parseInt(ls('page-zoom', '100'), 10);
        root.dataset.sidebarSide = sidebarSide;
        root.dataset.sidePanelSide = sidePanelSide;
        root.dataset.bookmarksBar = ['always', 'never', 'auto'].includes(bookmarksBar) ? bookmarksBar : 'auto';
        root.dataset.homeBtn = showHome;
        root.dataset.tabMem = tabMem;
        root.dataset.pageZoom = String([75, 90, 100, 110, 125, 150].includes(zoom) ? zoom : 100);
        applyVerticalSidebarWidth();
        applySchoolChrome();
        if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('anka-chrome'));
        scheduleMem();
    }

    function applyVerticalSidebarWidth(width) {
        let value = Number(width);
        if (!Number.isFinite(value)) {
            try { value = Number(localStorage.getItem('anka_vt_sidebar_width')); } catch (err) {}
        }
        if (!Number.isFinite(value) || value < 1) value = 240;
        value = Math.max(200, Math.min(420, Math.round(value)));
        document.documentElement.style.setProperty('--vt-sidebar-w', value + 'px');
        const handle = $('vt-sidebar-resize');
        if (handle) handle.setAttribute('aria-valuenow', String(value));
    }

    function bindVerticalSidebarResize() {
        const handle = $('vt-sidebar-resize');
        const sidebar = $('sidebar');
        if (!handle || !sidebar || handle.__ankaBound) return;
        handle.__ankaBound = true;
        let pointerId = null;
        const move = (event) => {
            if (pointerId !== event.pointerId) return;
            const rect = sidebar.getBoundingClientRect();
            const fromRight = document.documentElement.dataset.sidebarSide === 'right';
            const width = fromRight ? rect.right - event.clientX : event.clientX - rect.left;
            applyVerticalSidebarWidth(width);
        };
        const finish = (event) => {
            if (pointerId !== event.pointerId) return;
            pointerId = null;
            sidebar.classList.remove('vt-resizing');
            try {
                localStorage.setItem('anka_vt_sidebar_width',
                    getComputedStyle(document.documentElement).getPropertyValue('--vt-sidebar-w').replace('px', '').trim());
            } catch (err) {
                console.error('Dikey sekme genişliği kaydedilemedi:', err);
            }
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', finish);
        };
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            pointerId = event.pointerId;
            if (typeof handle.setPointerCapture === 'function') handle.setPointerCapture(pointerId);
            sidebar.classList.add('vt-resizing');
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', finish);
            document.addEventListener('pointercancel', finish);
        });
        handle.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            let current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vt-sidebar-w'));
            if (!Number.isFinite(current)) current = 240;
            const direction = document.documentElement.dataset.sidebarSide === 'right' ? -1 : 1;
            const change = (event.key === 'ArrowRight' ? 1 : -1) * direction * (event.shiftKey ? 40 : 16);
            applyVerticalSidebarWidth(current + change);
            try { localStorage.setItem('anka_vt_sidebar_width', String(Math.max(200, Math.min(420, Math.round(current + change))))); }
            catch (err) { console.error('Dikey sekme genişliği kaydedilemedi:', err); }
        });
    }

    function applySchoolChrome() {
        const root = document.documentElement;
        try {
            const raw = localStorage.getItem('anka_school_ui');
            const ui = raw ? JSON.parse(raw) : {};
            const active = ls('school-mode', 'false') === 'true';
            root.dataset.schoolTools = active && ui.hideTools ? 'off' : 'on';
            root.dataset.schoolIncognito = active && ui.blockIncognito ? 'off' : 'on';
        } catch (err) {
            root.dataset.schoolTools = 'on';
            root.dataset.schoolIncognito = 'on';
        }
    }

    function ensurePage() {
        let node = $('internal-page');
        if (node) return node;
        node = document.createElement('div');
        node.id = 'internal-page';
        const host = $('wv-container');
        (host || document.body).appendChild(node);
        return node;
    }

    function hidePage() {
        const oldKind = pageKind;
        if (document.body.dataset.systemPage) delete document.body.dataset.systemPage;
        const node = $('internal-page');
        if (node) {
            node.classList.remove('open');
            node.replaceChildren();
        }
        if (oldKind === 'settings') {
            const panel = $('settings-panel');
            if (panel && panel.style.display === 'flex' && typeof window.__toggleSettings === 'function') window.__toggleSettings();
        } else if (oldKind === 'help') {
            const help = $('help-panel');
            if (help) {
                help.style.display = 'none';
                help.dataset.ankaOpen = 'false';
            }
            const overlay = $('help-overlay');
            if (overlay) overlay.style.display = 'none';
            if (window.AnkaWindowUtils) window.AnkaWindowUtils.deactivate('help');
        }
        pageKind = '';
    }

    function collectHistory() {
        const out = [];
        const push = (item, timeKey) => {
            if (!item || typeof item !== 'object' || typeof item.url !== 'string') return;
            if (!/^https?:/i.test(item.url)) return;
            out.push({
                url: item.url,
                title: String(item.title || item.url).slice(0, 120),
                t: Number(item[timeKey] || item.t || item.time || Date.now())
            });
        };
        try {
            const list = JSON.parse(localStorage.getItem('anka_history') || '[]');
            if (Array.isArray(list)) for (let i = 0; i < list.length; i++) push(list[i], 'time');
        } catch (err) {}
        try {
            const length = localStorage.length;
            for (let i = 0; i < length; i++) {
                const key = localStorage.key(i);
                if (!key || key.indexOf('anka_x_hist_') !== 0) continue;
                try {
                    const list = JSON.parse(localStorage.getItem(key) || '[]');
                    if (Array.isArray(list)) for (let j = 0; j < list.length; j++) push(list[j], 't');
                } catch (err) {}
            }
        } catch (err) {}
        out.sort((a, b) => b.t - a.t);
        const seen = new Set();
        const unique = [];
        for (let i = 0; i < out.length; i++) {
            const item = out[i];
            const stamp = item.url + '|' + Math.floor(item.t / 60000);
            if (seen.has(stamp)) continue;
            seen.add(stamp);
            unique.push(item);
            if (unique.length >= 800) break;
        }
        return unique;
    }

    function buildRow(item, onOpen, scanEnabled) {
        const row = document.createElement('div');
        row.className = 'page-row';
        row.tabIndex = 0;

        const info = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = item.title || item.fileName || item.url;
        const meta = document.createElement('span');
        meta.textContent = item.meta || item.url || '';
        info.appendChild(strong);
        info.appendChild(meta);
        row.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'page-row-actions';

        if (pageKind === 'history') {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'page-action';
            remove.textContent = 'Sil';
            remove.setAttribute('aria-label', 'Geçmiş kaydını sil');
            remove.addEventListener('click', (event) => {
                event.stopPropagation();
                if (typeof window.__ankaRemoveHistory === 'function') window.__ankaRemoveHistory(item);
                showHistory();
            });
            actions.appendChild(remove);
        } else if (pageKind === 'downloads' && item.id && item.savePath) {
            if (scanEnabled && item.state === 'completed' && RISKY_EXT_RE.test(item.fileName || '')) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'page-action';
                remove.textContent = 'Dosyayı sil';
                remove.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const message = 'Uzantı denetimi bu dosya türünü riskli işaretledi. Dosya kalıcı olarak silinsin mi?';
                    const confirmed = typeof window.ankaConfirm === 'function' ? await window.ankaConfirm(message) : window.confirm(message);
                    if (!confirmed) return;
                    const ipc = getIpc();
                    if (!ipc) return;
                    try {
                        const result = await ipc.invoke('delete-download-file', item.id);
                        if (result && result.ok) showDownloads();
                        else if (typeof showToast === 'function') showToast((result && result.error) || 'Dosya silinemedi.', 'error');
                    } catch (err) {
                        if (typeof showToast === 'function') showToast('Dosya silinemedi.', 'error');
                    }
                });
                actions.appendChild(remove);
            }
        }

        if (actions.childElementCount) row.appendChild(actions);
        row.addEventListener('click', () => onOpen(item));
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') onOpen(item);
        });
        return row;
    }

    function renderGrouped(list, query, onOpen) {
        const node = ensurePage();
        const shell = document.createElement('div');
        shell.className = 'page-shell';

        const head = document.createElement('div');
        head.className = 'page-head';
        const titles = document.createElement('div');
        const kicker = document.createElement('div');
        kicker.className = 'page-kicker';
        kicker.textContent = PAGES[pageKind] ? 'ANKA WEB' : '';
        const h1 = document.createElement('h1');
        h1.textContent = PAGES[pageKind] || '';
        titles.appendChild(kicker);
        titles.appendChild(h1);

        const search = document.createElement('input');
        search.className = 'page-search';
        search.type = 'search';
        search.placeholder = 'Ara...';
        search.value = query || '';

        const controls = document.createElement('div');
        controls.className = 'page-controls';
        const filter = document.createElement('select');
        filter.className = 'page-filter';
        const filters = pageKind === 'history'
            ? [['all', 'Tüm tarihler'], ['today', 'Bugün'], ['week', '7 gün'], ['month', '30 gün']]
            : [['all', 'Tüm indirmeler'], ['active', 'Devam eden'], ['completed', 'Tamamlanan'], ['risk', 'Riskli uzantı']];
        for (let i = 0; i < filters.length; i++) {
            const option = document.createElement('option');
            option.value = filters[i][0];
            option.textContent = filters[i][1];
            filter.appendChild(option);
        }
        let validFilter = false;
        for (let i = 0; i < filters.length; i++) {
            if (filters[i][0] === pageFilter) { validFilter = true; break; }
        }
        filter.value = validFilter ? pageFilter : 'all';

        const exportButton = document.createElement('button');
        exportButton.type = 'button';
        exportButton.className = 'page-action';
        exportButton.textContent = 'Dışa aktar';

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'page-action';
        clearButton.textContent = 'Temizle';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'page-action';
        closeButton.textContent = 'Kapat';
        closeButton.addEventListener('click', hidePage);

        controls.appendChild(search);
        controls.appendChild(filter);
        controls.appendChild(exportButton);
        controls.appendChild(clearButton);
        controls.appendChild(closeButton);
        head.appendChild(titles);
        head.appendChild(controls);

        const bodyHost = document.createElement('div');
        bodyHost.className = 'page-body';

        shell.appendChild(head);
        shell.appendChild(bodyHost);
        node.replaceChildren(shell);
        node.classList.add('open');

        const renderBody = (q) => {
            const queryLower = String(q || '').trim().toLowerCase();
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayStartMs = todayStart.getTime();
            const todayStr = todayStart.toDateString();
            const now = Date.now();
            let scanEnabled = false;
            if (pageKind === 'downloads') {
                try { scanEnabled = localStorage.getItem('set_download-scan') !== 'false'; } catch (err) { scanEnabled = true; }
            }

            const fragment = document.createDocumentFragment();
            let lastLabel = '';
            let shown = 0;

            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (queryLower) {
                    const hay = ((item.title || '') + ' ' + (item.url || '') + ' ' + (item.fileName || '')).toLowerCase();
                    if (hay.indexOf(queryLower) < 0) continue;
                }
                if (pageKind === 'history') {
                    if (pageFilter === 'today') {
                        if (new Date(item.t).toDateString() !== todayStr) continue;
                    } else if (pageFilter === 'week') {
                        if (now - item.t > 7 * MS_PER_DAY) continue;
                    } else if (pageFilter === 'month') {
                        if (now - item.t > 30 * MS_PER_DAY) continue;
                    }
                } else if (pageKind === 'downloads') {
                    if (pageFilter === 'active') {
                        const st = item.state;
                        if (st !== 'progressing' && st !== 'paused' && st !== 'interrupted') continue;
                    } else if (pageFilter === 'completed') {
                        if (item.state !== 'completed') continue;
                    } else if (pageFilter === 'risk') {
                        if (!(scanEnabled && RISKY_EXT_RE.test(item.fileName || ''))) continue;
                    }
                }
                const label = dayLabel(item.t, todayStartMs);
                if (label !== lastLabel) {
                    const group = document.createElement('div');
                    group.className = 'page-group';
                    group.textContent = label;
                    fragment.appendChild(group);
                    lastLabel = label;
                }
                fragment.appendChild(buildRow(item, onOpen, scanEnabled));
                shown += 1;
                if (shown >= 400) break;
            }

            if (!shown) {
                const empty = document.createElement('div');
                empty.className = 'page-empty';
                empty.textContent = queryLower ? 'Sonuç bulunamadı' : 'Henüz kayıt yok';
                fragment.appendChild(empty);
            }
            bodyHost.replaceChildren(fragment);
        };

        search.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const value = search.value;
            searchDebounce = setTimeout(() => renderBody(value), 150);
        });

        filter.addEventListener('change', () => {
            pageFilter = filter.value;
            renderBody(search.value);
        });

        exportButton.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = pageKind === 'history' ? 'anka-gecmis.json' : 'anka-indirmeler.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(href), 1000);
        });

        clearButton.addEventListener('click', async () => {
            const message = pageKind === 'history' ? 'Tüm tarama geçmişi silinsin mi?' : 'Etkin indirmeler dışındaki kayıtlar listeden kaldırılsın mı?';
            const confirmed = typeof window.ankaConfirm === 'function' ? await window.ankaConfirm(message) : window.confirm(message);
            if (!confirmed) return;
            if (pageKind === 'history') {
                if (typeof window.__ankaClearHistory === 'function') window.__ankaClearHistory();
                showHistory();
            } else {
                const ipc = getIpc();
                if (ipc) {
                    try { await ipc.invoke('clear-download-history'); } catch (err) {}
                }
                showDownloads();
            }
        });

        renderBody(query || '');
        search.focus();
        if (query) {
            try { search.setSelectionRange(query.length, query.length); } catch (err) {}
        }
    }

    function showHistory() {
        renderGrouped(collectHistory(), '', (item) => {
            if (typeof createNewTab === 'function') createNewTab(item.url);
        });
    }

    async function showDownloads() {
        let list = [];
        const ipc = getIpc();
        if (ipc) {
            try { list = await ipc.invoke('get-downloads-list'); } catch (err) { list = []; }
        }
        const src = Array.isArray(list) ? list : [];
        const rows = [];
        for (let i = src.length - 1; i >= 0; i--) {
            const item = src[i];
            rows.push({
                title: item.fileName,
                fileName: item.fileName,
                id: item.id,
                state: item.state,
                url: item.url,
                meta: (item.state || '') + (item.savePath ? ' · ' + item.savePath : ''),
                t: item.startedAt || Date.now(),
                savePath: item.savePath
            });
        }
        renderGrouped(rows, '', (item) => {
            if (!item.id) return;
            const ipc2 = getIpc();
            if (ipc2) ipc2.send('open-download-item', item.id);
        });
    }

    function showPage(kind) {
        hidePage();
        pageKind = kind;
        document.body.dataset.systemPage = kind;
        if (kind === 'settings') {
            const panel = $('settings-panel');
            if (panel && panel.style.display !== 'flex' && typeof window.__toggleSettings === 'function') window.__toggleSettings();
        } else if (kind === 'help') {
            if (typeof createHelpPanel === 'function') createHelpPanel();
            const help = $('help-panel');
            if (help) {
                help.style.display = 'block';
                help.dataset.ankaOpen = 'true';
                help.style.opacity = '1';
                help.style.transform = 'none';
            }
            const overlay = $('help-overlay');
            if (overlay) overlay.style.display = 'none';
            if (window.AnkaWindowUtils) window.AnkaWindowUtils.activate('help');
            ensurePage().classList.add('open');
        } else if (kind === 'history') {
            showHistory();
        } else if (kind === 'downloads') {
            showDownloads();
        } else {
            hidePage();
        }
    }

    window.__ankaShowPage = function (st) {
        if (!st || !st.internal) {
            hidePage();
            return;
        }
        showPage(st.internal);
    };

    window.openAnkaPage = function (kind) {
        if (!PAGES[kind]) return;
        if (ls('system-pages-mode', 'panel') === 'tab') {
            if (typeof createNewTab === 'function') createNewTab(PAGE_URLS[kind]);
            return;
        }
        if (kind === 'settings' && typeof window.toggleSettings === 'function') window.toggleSettings();
        else if (kind === 'help' && typeof window.toggleHelp === 'function') window.toggleHelp();
        else showPage(kind);
    };

    window.__ankaCloseSystemPage = hidePage;
    window.__ankaCloseSystemTab = function () {
        const tabs = typeof ankaTabs !== 'undefined' ? ankaTabs : null;
        const id = typeof activeTabId !== 'undefined' ? activeTabId : null;
        const st = tabs && id ? tabs.get(id) : null;
        if (st && st.internal && typeof closeTab === 'function') closeTab(st.id);
        else hidePage();
    };

    function pinchBind() {
        const host = $('wv-container');
        if (!host || host.__ankaPinch) return;
        host.__ankaPinch = true;
        const points = new Map();
        let base = 0;
        let dist = 0;

        host.addEventListener('wheel', (event) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            if (typeof ankaZoom === 'function') ankaZoom(event.deltaY > 0 ? -0.25 : 0.25);
        }, { passive: false });

        host.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
            points.set(event.pointerId, event);
            if (points.size === 2) {
                const iter = points.values();
                const a = iter.next().value;
                const b = iter.next().value;
                dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                base = 0;
            }
        });

        host.addEventListener('pointermove', (event) => {
            if (points.size !== 2 || !points.has(event.pointerId)) return;
            points.set(event.pointerId, event);
            const iter = points.values();
            const a = iter.next().value;
            const b = iter.next().value;
            const next = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            if (!dist) return;
            const steps = Math.round(((next / dist) - 1) * 8) - base;
            if (!steps || typeof ankaZoom !== 'function') return;
            base += steps;
            ankaZoom(steps * 0.25);
        });

        const clear = (event) => {
            points.delete(event.pointerId);
            if (points.size < 2) {
                dist = 0;
                base = 0;
            }
        };

        host.addEventListener('pointerup', clear);
        host.addEventListener('pointercancel', clear);
    }

    let memRefreshActive = false;
    async function refreshMem() {
        if (document.hidden) return;
        if (ls('tab-memory', 'false') !== 'true') return;
        if (memRefreshActive) return;
        const tabs = typeof ankaTabs !== 'undefined' ? ankaTabs : null;
        if (!tabs) return;
        memRefreshActive = true;
        try {
            for (const [id, st] of tabs) {
                if (!st.memEl) continue;
                if (!st.vw || typeof st.vw.executeJavaScript !== 'function') {
                    st.memEl.textContent = st.sleeping ? 'uyku' : '—';
                    st.memEl.title = st.sleeping ? 'Sekme uyutuldu' : 'Bellek ölçümü kullanılamıyor';
                    continue;
                }
                try {
                    const bytes = await st.vw.executeJavaScript(
                        '(()=>{const memory=performance.memory;return memory&&Number.isFinite(memory.usedJSHeapSize)?memory.usedJSHeapSize:null})()'
                    );
                    if (tabs.get(id) !== st || !st.memEl.isConnected) continue;
                    st.memEl.textContent = Number.isFinite(bytes) && bytes > 0
                        ? '≈' + Math.max(1, Math.round(bytes / 1048576)) + ' MB' : '—';
                    st.memEl.title = Number.isFinite(bytes)
                        ? 'Sayfanın JavaScript belleği (yaklaşık)' : 'Bu sayfada bellek ölçümü desteklenmiyor';
                } catch (err) {
                    if (tabs.get(id) === st && st.memEl.isConnected) {
                        st.memEl.textContent = '—';
                        st.memEl.title = 'Bu sayfada bellek ölçümü alınamadı';
                    }
                }
            }
        } finally {
            memRefreshActive = false;
        }
    }

    function scheduleMem() {
        clearInterval(memTimer);
        memTimer = 0;
        if (ls('tab-memory', 'false') !== 'true') return;
        refreshMem();
        const interval = window.ANKA_ENV && window.ANKA_ENV.lowEnd ? 30000 : 15000;
        memTimer = setInterval(refreshMem, interval);
    }

    window.applyChromeLayout = applyChromeLayout;
    window.applySchoolChrome = applySchoolChrome;
    window.addEventListener('beforeunload', () => {
        clearInterval(memTimer);
        memTimer = 0;
    }, { once: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bindVerticalSidebarResize();
            applyChromeLayout();
            pinchBind();
        }, { once: true });
    } else {
        bindVerticalSidebarResize();
        applyChromeLayout();
        pinchBind();
    }

    window.addEventListener('storage', (event) => {
        if (!event.key || event.key.indexOf('set_') === 0 || event.key === 'anka_school_ui') applyChromeLayout();
    });
})();