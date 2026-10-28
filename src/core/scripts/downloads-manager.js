const popupStyle = `
#downloads-popup {
    position: fixed;
    width: min(440px, calc(100vw - 16px));
    max-height: min(580px, calc(100dvh - 16px));
    background: var(--bg-secondary, #18181b);
    color: var(--text-color, #f4f4f5);
    border: 1px solid var(--border-color, #27272a);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.7);
    z-index: 100000;
    display: none;
    flex-direction: column;
    font-family: 'Segoe UI', system-ui, sans-serif;
    overflow: hidden;
    box-sizing: border-box;
}
#downloads-popup * { box-sizing: border-box; }
.dl-popup-header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-color, #27272a);
    font-weight: 600;
    font-size: 14px;
    background: var(--bg-primary, #121214);
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.dl-header-actions {
    display: flex;
    gap: 12px;
    align-items: center;
}
.dl-header-btn {
    font-size: 11px;
    color: var(--text-secondary, #a1a1aa);
    cursor: pointer;
    font-weight: 500;
    background: none;
    border: none;
    padding: 0;
    transition: color 0.2s;
}
.dl-header-btn:hover { color: var(--accent, #ff4757); }
.dl-stats-bar {
    display: flex;
    justify-content: space-between;
    padding: 8px 18px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid var(--border-color, #27272a);
    font-size: 11px;
    color: var(--text-secondary, #a1a1aa);
}
.dl-search-bar-container {
    padding: 10px 18px;
    background: var(--bg-primary, #121214);
    border-bottom: 1px solid var(--border-color, #27272a);
    display: flex;
    gap: 8px;
}
.dl-search-input {
    flex-grow: 1;
    background: var(--bg-tertiary, #27272a);
    border: 1px solid var(--border-color, #3f3f46);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-color, #f4f4f5);
    outline: none;
}
.dl-search-input:focus { border-color: var(--accent, #ff4757); }
.dl-filter-select {
    background: var(--bg-tertiary, #27272a);
    border: 1px solid var(--border-color, #3f3f46);
    border-radius: 6px;
    padding: 6px;
    font-size: 11px;
    color: var(--text-color, #f4f4f5);
    outline: none;
    cursor: pointer;
}
.dl-popup-body {
    overflow-y: auto;
    flex-grow: 1;
    padding: 4px 0;
    background: var(--bg-secondary, #18181b);
    scroll-behavior: smooth;
}
.dl-popup-item {
    padding: 12px 18px;
    border-bottom: 1px solid var(--border-color, #27272a);
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: background 0.2s;
    will-change: background;
}
.dl-popup-item:hover { background: var(--bg-primary, #121214); }
.dl-popup-item:last-child { border-bottom: none; }
.dl-file-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
}
.dl-file-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color, #f4f4f5);
    cursor: pointer;
    word-break: break-all;
    flex-grow: 1;
}
.dl-file-title:hover { color: var(--accent, #ff4757); }
.dl-file-speed {
    font-size: 11px;
    color: var(--text-secondary, #a1a1aa);
    white-space: nowrap;
}
.dl-file-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.dl-file-info { font-size: 11px; color: var(--text-secondary, #a1a1aa); line-height: 1.4; display: flex; align-items: center; gap: 6px; }
.dl-file-info.error-text { color: #f28b82; font-weight: 500; }
.dl-file-info.secure-text { color: #34d399; font-weight: 500; }
.dl-file-info.warning-text { color: #fbbf24; font-weight: 500; }
.dl-btn-group { display: flex; gap: 6px; }
.dl-popup-btn {
    background: var(--bg-tertiary, #27272a);
    border: 1px solid var(--border-color, #3f3f46);
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-color, #f4f4f5);
    font-weight: 600;
    transition: background 0.2s, opacity 0.2s;
}
.dl-popup-btn:hover { background: var(--border-color, #3f3f46); }
.dl-popup-btn.cancel { color: #ffffff; background: var(--accent, #ff4757); border-color: transparent; }
.dl-popup-btn.cancel:hover { opacity: 0.9; }
.dl-progress-bg { background: var(--bg-tertiary, #3f3f46); border-radius: 4px; height: 5px; width: 100%; margin-top: 2px; overflow: hidden; display: none; }
.dl-progress-fill { background: var(--accent, #ff4757); height: 100%; width: 0%; transition: width 0.1s linear; }
.dl-progress-fill.interrupted { background: #ff9800; }
.dl-progress-fill.secure { background: #34d399; }
.dl-empty { padding: 40px 20px; text-align: center; color: var(--text-secondary, #a1a1aa); font-size: 13px; }
@media (pointer: coarse) {
    .dl-popup-btn, .dl-header-btn, .dl-filter-select { min-height: 44px; padding-left: 10px; padding-right: 10px; }
    .dl-header-actions { flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
    .dl-search-input { min-height: 44px; }
}
`;

let currentFilter = 'all';
let currentSearch = '';

function updatePopupPosition() {
    const popup = document.getElementById('downloads-popup');
    const btn = document.getElementById('downloads-btn');
    if (!popup || !btn || popup.style.display !== 'flex') return;
    const rect = btn.getBoundingClientRect();
    popup.style.maxHeight = Math.max(0, window.innerHeight - 16) + 'px';
    const width = popup.offsetWidth || Math.min(440, window.innerWidth - 16);
    const height = popup.offsetHeight || Math.min(580, window.innerHeight - 16);
    const below = rect.bottom + 8;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
}

function injectDownloadsPopup() {
    if (document.getElementById('downloads-popup')) return;

    const styleTag = document.createElement('style');
    styleTag.textContent = popupStyle;
    document.head.appendChild(styleTag);

    const popupDiv = document.createElement('div');
    popupDiv.id = 'downloads-popup';
    popupDiv.innerHTML = `
        <div class="dl-popup-header">
            <span>📥 Gelişmiş İndirilenler</span>
            <div class="dl-header-actions">
                <button class="dl-header-btn" id="dl-open-page-btn" type="button">Tam sayfa</button>
                <button class="dl-header-btn" id="dl-open-folder-btn">Klasör</button>
                <button class="dl-header-btn" id="dl-clear-history-btn">Temizle</button>
            </div>
        </div>
        <div class="dl-stats-bar">
            <span id="dl-stat-count">Toplam: 0 dosya</span>
            <span id="dl-stat-speed">Hız: 0 KB/s</span>
        </div>
        <div class="dl-search-bar-container">
            <input type="text" class="dl-search-input" id="dl-search-box" placeholder="İndirilenlerde ara...">
            <select class="dl-filter-select" id="dl-filter-select">
                <option value="all">Tümü</option>
                <option value="active">İndirilenler</option>
                <option value="completed">Tamamlananlar</option>
                <option value="security">Güvenlik Riskli</option>
            </select>
        </div>
        <div class="dl-popup-body" id="dl-popup-list"></div>
    `;
    document.body.appendChild(popupDiv);

    document.getElementById('dl-open-folder-btn')?.addEventListener('click', openDownloadsFolder);
    document.getElementById('dl-open-page-btn')?.addEventListener('click', () => {
        const popup = document.getElementById('downloads-popup');
        if (popup) popup.style.display = 'none';
        if (typeof window.openAnkaPage === 'function') window.openAnkaPage('downloads');
    });
    document.getElementById('dl-clear-history-btn')?.addEventListener('click', clearDownloadList);
    document.getElementById('dl-search-box')?.addEventListener('input', (e) => {
        currentSearch = e.target.value;
        renderPopupItems();
    });
    document.getElementById('dl-filter-select')?.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderPopupItems();
    });

    document.addEventListener('click', (e) => {
        const popup = document.getElementById('downloads-popup');
        const btn = document.getElementById('downloads-btn');
        if (popup && popup.style.display === 'flex' && !popup.contains(e.target) && (!btn || !btn.contains(e.target))) {
            popup.style.display = 'none';
        }
    });

    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('online', async () => {
        const { ipcRenderer } = require('electron');
        const list = await ipcRenderer.invoke('get-downloads-list');
        list.forEach(item => {
            if (item.state === 'interrupted' || item.state === 'interrupted-error') {
                ipcRenderer.send('resume-download', item.id);
            }
        });
        setTimeout(renderPopupItems, 300);
    });

    setupIpcListeners();
}

async function openDownloadsPage() {
    if (typeof window.openAnkaPage === 'function') {
        window.openAnkaPage('downloads');
        return;
    }
    const popup = document.getElementById('downloads-popup');
    if (!popup) return;

    if (popup.style.display === 'flex') {
        popup.style.display = 'none';
    } else {
        popup.style.display = 'flex';
        updatePopupPosition();
        await renderPopupItems();
        updatePopupPosition();
    }
}

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function checkSecurityRisk(fileName) {
    try {
        if (localStorage.getItem('set_download-scan') === 'false') return { risky: false, scanned: false, message: 'Uzantı denetimi kapalı' };
    } catch (err) {}
    const dangerousExtensions = ['.exe', '.msi', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.scr', '.pif', '.jar', '.sh', '.bash', '.zsh', '.desktop', '.appimage', '.deb', '.rpm', '.run', '.dll', '.so', '.dylib', '.reg', '.lnk', '.url', '.command', '.pkg', '.html', '.htm', '.shtml', '.xhtml', '.svg', '.xml', '.mht', '.mhtml', '.xsl', '.xslt'];
    const lowerName = String(fileName || '').toLowerCase();
    for (let ext of dangerousExtensions) {
        if (lowerName.endsWith(ext)) {
            return { risky: true, scanned: true, message: 'Şüpheli dosya uzantısı; antivirüs taraması değildir' };
        }
    }
    return { risky: false, scanned: true, message: 'Uzantı denetiminde risk işareti yok; dosya taranmadı' };
}

function escapeDownloadText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

async function renderPopupItems() {
    const { ipcRenderer } = require('electron');
    const listContainer = document.getElementById('dl-popup-list');
    const statCount = document.getElementById('dl-stat-count');
    if (!listContainer) return;

    const list = await ipcRenderer.invoke('get-downloads-list');
    if (!list || list.length === 0) {
        listContainer.innerHTML = '<div class="dl-empty">Henüz bir indirme geçmişi yok.</div>';
        if (statCount) statCount.innerText = 'Toplam: 0 dosya';
        return;
    }

    const filteredList = list.filter(item => {
        const matchesSearch = !currentSearch || item.fileName.toLowerCase().includes(currentSearch.toLowerCase());
        if (!matchesSearch) return false;

        const sec = checkSecurityRisk(item.fileName);
        if (currentFilter === 'active') {
            return item.state === 'progressing';
        } else if (currentFilter === 'completed') {
            return item.state === 'completed';
        } else if (currentFilter === 'security') {
            return sec.risky;
        }
        return true;
    });

    if (statCount) statCount.innerText = `Toplam: ${list.length} dosya (${filteredList.length} filtrelendi)`;

    if (filteredList.length === 0) {
        listContainer.innerHTML = '<div class="dl-empty">Eşleşen indirme öğesi bulunamadı.</div>';
        return;
    }

    listContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    filteredList.slice().reverse().forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'dl-popup-item';
        itemDiv.id = 'pdl-' + item.id;

        let metaText = '';
        let isProgressing = item.state === 'progressing';
        let isInterrupted = item.state === 'interrupted' || item.state === 'interrupted-error';
        let isError = item.state === 'interrupted' && !navigator.onLine;
        
        const percent = item.totalBytes > 0 ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0;
        const currentSize = formatBytes(item.receivedBytes);
        const totalSize = item.totalBytes > 0 ? formatBytes(item.totalBytes) : 'Bilinmeyen boyut';

        const security = checkSecurityRisk(item.fileName);
        let infoClass = 'dl-file-info';

        if (isProgressing) {
            metaText = percent + '% • ' + currentSize + ' / ' + totalSize;
            if (item.isPaused) metaText += ' (Duraklatıldı)';
        } else if (item.state === 'completed') {
            if (security.risky) {
                infoClass = 'dl-file-info warning-text';
                metaText = `⚠️ ${security.message} • ` + formatBytes(item.totalBytes || item.receivedBytes);
            } else {
                infoClass = 'dl-file-info';
                metaText = `${security.message} • ` + formatBytes(item.totalBytes || item.receivedBytes);
            }
        } else if (isInterrupted) {
            infoClass = 'dl-file-info error-text';
            metaText = isError ? 'Bağlantı Kesildi! Yeniden deneniyor...' : 'Hata oluştu! İndirme yarıda kaldı.';
        } else {
            metaText = 'İptal Edildi';
        }

        const itemDivContent = document.createElement('div');
        itemDivContent.innerHTML = `
            <div class="dl-file-top">
                <div class="dl-file-title" id="ptitle-${item.id}">${escapeDownloadText(item.fileName)}</div>
                <div class="dl-file-speed" id="pspeed-${item.id}"></div>
            </div>
            <div class="dl-file-row">
                <div class="${infoClass}" id="pmeta-${item.id}">${metaText}</div>
                <div class="dl-btn-group" id="paction-${item.id}"></div>
            </div>
            <div class="dl-progress-bg" id="pprog-container-${item.id}" style="display: ${((isProgressing || isInterrupted) ? 'block' : 'none')}">
                <div class="dl-progress-fill ${isInterrupted ? 'interrupted' : (security.risky ? 'interrupted' : 'secure')}" id="pbar-${item.id}" style="width: ${percent}%"></div>
            </div>
        `;
        itemDiv.appendChild(itemDivContent);

        itemDiv.querySelector('#ptitle-' + item.id).addEventListener('click', () => {
            if (item.savePath) {
                ipcRenderer.send('open-download-item', item.id);
            }
        });

        const actionGroup = itemDiv.querySelector('#paction-' + item.id);
        if (isProgressing) {
            if (item.isPaused) {
                const resumeBtn = document.createElement('button');
                resumeBtn.className = 'dl-popup-btn';
                resumeBtn.innerText = 'Devam';
                resumeBtn.addEventListener('click', () => {
                    ipcRenderer.send('resume-download', item.id);
                    setTimeout(renderPopupItems, 200);
                });
                actionGroup.appendChild(resumeBtn);
            } else {
                const pauseBtn = document.createElement('button');
                pauseBtn.className = 'dl-popup-btn';
                pauseBtn.innerText = 'Duraklat';
                pauseBtn.addEventListener('click', () => {
                    ipcRenderer.send('pause-download', item.id);
                    setTimeout(renderPopupItems, 200);
                });
                actionGroup.appendChild(pauseBtn);
            }
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'dl-popup-btn cancel';
            cancelBtn.innerText = 'İptal';
            cancelBtn.addEventListener('click', () => {
                ipcRenderer.send('cancel-download', item.id);
            });
            actionGroup.appendChild(cancelBtn);
        } else if (isInterrupted || item.state === 'cancelled') {
            const restartBtn = document.createElement('button');
            restartBtn.className = 'dl-popup-btn';
            restartBtn.innerText = 'Tekrar';
            restartBtn.addEventListener('click', () => {
                ipcRenderer.send('restart-download', item.id);
                setTimeout(renderPopupItems, 300);
            });
            actionGroup.appendChild(restartBtn);
        } else {
            const folderBtn = document.createElement('button');
            folderBtn.className = 'dl-popup-btn';
            folderBtn.innerText = 'Klasör';
            folderBtn.addEventListener('click', () => {
                if (item.savePath) {
                    ipcRenderer.send('show-download-in-folder', item.id);
                }
            });
            actionGroup.appendChild(folderBtn);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'dl-popup-btn cancel';
            removeBtn.innerText = 'Kaldır';
            removeBtn.addEventListener('click', () => {
                ipcRenderer.send('remove-download-item', item.id);
                setTimeout(renderPopupItems, 200);
            });
            actionGroup.appendChild(removeBtn);
            if (security.risky && item.savePath) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'dl-popup-btn cancel';
                deleteBtn.innerText = 'Dosyayı sil';
                deleteBtn.addEventListener('click', async () => {
                    const confirmed = typeof window.ankaConfirm === 'function'
                        ? await window.ankaConfirm('Bu dosyanın uzantısı riskli görünüyor. Dosya kalıcı olarak silinsin mi?')
                        : window.confirm('Bu dosyanın uzantısı riskli görünüyor. Dosya kalıcı olarak silinsin mi?');
                    if (!confirmed) return;
                    const result = await ipcRenderer.invoke('delete-download-file', item.id);
                    if (result && result.ok) {
                        if (typeof showToast === 'function') showToast('Dosya silindi.');
                    } else if (typeof showToast === 'function') {
                        showToast(result.error || 'Dosya silinemedi.', 'error');
                    }
                    renderPopupItems();
                });
                actionGroup.appendChild(deleteBtn);
            }
        }

        fragment.appendChild(itemDiv);
    });

    listContainer.appendChild(fragment);
}

function clearDownloadList() {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('clear-download-history');
    setTimeout(renderPopupItems, 200);
}

function openDownloadsFolder() {
    const { ipcRenderer, shell } = require('electron');
    ipcRenderer.invoke('get-downloads-list').then(list => {
        if (list && list.length > 0 && list[list.length - 1].savePath) {
            const lastPath = list[list.length - 1].savePath;
            const folderPath = lastPath.substring(0, Math.max(lastPath.lastIndexOf('/'), lastPath.lastIndexOf('\\')));
            shell.openPath(folderPath);
        } else {
            shell.openPath(require('os').homedir() + '/Downloads');
        }
    }).catch(() => {
        shell.openPath(require('os').homedir() + '/Downloads');
    });
}

function setupIpcListeners() {
    const { ipcRenderer } = require('electron');

    ipcRenderer.on('download-open-blocked', (event, fileName) => {
        if (typeof window.showToast === 'function') window.showToast('Güvenlik nedeniyle çalıştırılabilir dosya açılamadı: ' + fileName, 'error');
    });

    ipcRenderer.on('download-progress', (e, data) => {
        const container = document.getElementById('pprog-container-' + data.id);
        const bar = document.getElementById('pbar-' + data.id);
        const meta = document.getElementById('pmeta-' + data.id);
        const speedEl = document.getElementById('pspeed-' + data.id);
        const statSpeed = document.getElementById('dl-stat-speed');

        if (bar && meta) {
            const percent = data.totalBytes > 0 ? Math.round((data.receivedBytes / data.totalBytes) * 100) : 0;
            const currentSize = formatBytes(data.receivedBytes);
            const totalSize = data.totalBytes > 0 ? formatBytes(data.totalBytes) : '...';
            
            if (speedEl && data.speed) {
                speedEl.innerText = formatBytes(data.speed) + '/s';
                if (statSpeed) statSpeed.innerText = `Anlık Hız: ${formatBytes(data.speed)}/s`;
            }

            let statusString = '';
            if (data.state === 'interrupted') {
                meta.className = 'dl-file-info error-text';
                statusString = !navigator.onLine ? 'Bağlantı Kesildi! Yeniden deneniyor...' : 'Hata oluştu! İndirme yarıda kaldı.';
                bar.className = 'dl-progress-fill interrupted';
            } else {
                meta.className = 'dl-file-info';
                statusString = percent + '% • ' + currentSize + ' / ' + totalSize;
                if (data.isPaused) statusString += ' (Duraklatıldı)';
                bar.className = 'dl-progress-fill';
            }
            meta.innerText = statusString;
            if (container) container.style.display = 'block';
            bar.style.width = percent + '%';
        }
    });

    ipcRenderer.on('download-done', () => {
        const popup = document.getElementById('downloads-popup');
        if (popup && popup.style.display === 'flex') {
            renderPopupItems();
        }
    });
}

document.addEventListener('DOMContentLoaded', injectDownloadsPopup);