function createLimitPanel() {
    if (document.getElementById('limit-panel')) return;

    const styles = `
    <style>
        #limit-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100000; }
        #limit-panel { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.96); width: min(420px, calc(100vw - 32px)); max-height: 90vh; overflow: auto; background: var(--panel, #18181b); color: var(--text, #f4f4f5); border-radius: 12px; box-shadow: var(--shadow-pop, 0 30px 70px rgba(0,0,0,0.5)); z-index: 100001; border: 1px solid var(--border, #27272a); font-family: var(--font, system-ui, sans-serif); padding: 24px; transition: transform 0.16s ease, opacity 0.16s ease; opacity: 0; }
        .limit-item { margin-bottom: 20px; }
        .limit-item label { display: block; margin-bottom: 10px; font-size: 14px; color: var(--text-secondary, #a1a1aa); }
        .limit-slider { width: 100%; height: 6px; background: var(--hover, #27272a); border-radius: 3px; appearance: none; outline: none; accent-color: var(--accent, #ff4757); }
        .limit-slider::-webkit-slider-thumb { appearance: none; width: 20px; height: 20px; background: var(--accent, #ff4757); border: 2px solid var(--panel, #18181b); border-radius: 50%; cursor: pointer; }
        .l-btn-act { width: 100%; min-height: 48px; background: var(--accent, #ff4757); border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: bold; color: #fff; font-size: 15px; touch-action: manipulation; }
        #limit-panel input[type="checkbox"] { accent-color: var(--accent, #ff4757); width: 20px; height: 20px; }
        #limit-panel h2 { color: var(--accent, #ff4757) !important; }
        #limit-panel button[onclick="toggleLimit()"] { color: var(--text-secondary, #a1a1aa) !important; min-width: 40px; min-height: 40px; touch-action: manipulation; }
        #limit-panel span { color: var(--accent, #ff4757) !important; }
    </style>`;

    document.head.insertAdjacentHTML('beforeend', styles);

    const html = `
    <div id="limit-overlay" onclick="toggleLimit()"></div>
    <div id="limit-panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <h2 style="margin:0; font-size:20px;">Performans Yöneticisi</h2>
            <button onclick="toggleLimit()" style="background:none; border:none; cursor:pointer; font-size:20px;">✕</button>
        </div>
        <div class="limit-item">
            <label for="limit-tabs">En fazla sekme: <span id="limit-tabs-val">10</span></label>
            <input id="limit-tabs" type="range" class="limit-slider" min="1" max="30" step="1" oninput="updateLimitValue('limit-tabs-val', this.value)">
        </div>
        <div class="limit-item">
            <label for="limit-sleep">Boşta sekmeyi uyut: <span id="limit-sleep-val">20 dk</span></label>
            <input id="limit-sleep" type="range" class="limit-slider" min="0" max="60" step="5" oninput="updateLimitValue('limit-sleep-val', this.value, ' dk', true)">
        </div>
        <div class="limit-item">
            <label for="limit-cache">Bellek önbelleği sınırı: <span id="limit-cache-val">500 MB</span></label>
            <input id="limit-cache" type="range" class="limit-slider" min="100" max="5000" step="100" oninput="updateLimitValue('limit-cache-val', this.value, ' MB')">
        </div>
        <div class="limit-item">
            <label for="gpu-check">Donanım hızlandırma <input type="checkbox" id="gpu-check" style="float:right;"></label>
        </div>
        <button class="l-btn-act" onclick="applyLimits()">Ayarları Uygula</button>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
}

function updateLimitValue(id, value, suffix = '', allowOff = false) {
    const label = document.getElementById(id);
    if (label) label.textContent = allowOff && Number(value) === 0 ? 'Kapalı' : value + suffix;
}

function syncLimitPanel() {
    const getValue = (key, fallback, min, max) => {
        const value = Number(localStorage.getItem('set_' + key));
        return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    };
    const tabs = document.getElementById('limit-tabs');
    const sleep = document.getElementById('limit-sleep');
    const cache = document.getElementById('limit-cache');
    if (!tabs || !sleep || !cache) return;
    tabs.value = getValue('max-tabs', 10, 1, 30);
    sleep.value = getValue('tab-sleep-minutes', 20, 0, 60);
    cache.value = getValue('cache-size-limit', 500, 100, 5000);
    document.getElementById('gpu-check').checked = localStorage.getItem('set_hw-accel') !== 'false';
    updateLimitValue('limit-tabs-val', tabs.value);
    updateLimitValue('limit-sleep-val', sleep.value, ' dk', true);
    updateLimitValue('limit-cache-val', cache.value, ' MB');
}

function showLimitToast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
}

function toggleLimit() {
    createLimitPanel();
    const p = document.getElementById('limit-panel'), o = document.getElementById('limit-overlay');
    syncLimitPanel();
    if (p.style.display === 'block') {
        p.style.transform = 'translate(-50%, -50%) scale(0.96)'; p.style.opacity = '0';
        o.style.display = 'none';
        setTimeout(() => { if (p.style.opacity === '0') p.style.display = 'none'; }, 180);
    } else {
        p.style.display = 'block'; o.style.display = 'block';
        requestAnimationFrame(() => { p.style.transform = 'translate(-50%, -50%) scale(1)'; p.style.opacity = '1'; });
    }
}

function applyLimits() {
    try {
        const getNumVal = (elementId, min, max, defaultVal) => {
            const el = document.getElementById(elementId);
            if (!el) return defaultVal;
            const val = parseInt(el.value, 10);
            if (isNaN(val)) return defaultVal;
            return Math.max(min, Math.min(max, val));
        };

        const gpuCheckEl = document.getElementById('gpu-check');
        const currentGpu = gpuCheckEl ? gpuCheckEl.checked : true;
        const previousGpu = localStorage.getItem('set_hw-accel') !== 'false';

        const values = {
            'max-tabs': getNumVal('limit-tabs', 1, 100, 10),
            'max-live-tabs': getNumVal('limit-tabs', 1, 100, 10),
            'tab-sleep-minutes': getNumVal('limit-sleep', 0, 1440, 20),
            'cache-size-limit': getNumVal('limit-cache', 10, 5000, 500),
            'hw-accel': String(currentGpu)
        };

        for (const [id, value] of Object.entries(values)) {
            const stringVal = String(value);
            localStorage.setItem('set_' + id, stringVal);
            
            try {
                const ipc = window.require ? window.require('electron').ipcRenderer : null;
                if (ipc) {
                    ipc.send('settings-update', { id, val: value });
                    ipc.send('save-app-setting', { id, val: stringVal });
                }
            } catch (ipcErr) {
                console.warn(`IPC gönderilemedi (${id}):`, ipcErr);
            }
        }

        if (typeof window.__ankaApplyLimits === 'function') window.__ankaApplyLimits();

        const restartRequired = previousGpu !== currentGpu;
        
        if (typeof showLimitToast === 'function') {
            showLimitToast(
                restartRequired 
                    ? 'Ayarlar kaydedildi. Donanım hızlandırma değişikliği yeniden başlatınca geçerli olur.' 
                    : 'Performans limitleri anında uygulandı.'
            );
        }

        if (typeof toggleLimit === 'function') {
            toggleLimit();
        }

    } catch (err) {
        console.error('applyLimits hatası:', err);
        if (typeof showLimitToast === 'function') {
            showLimitToast('Ayarlar uygulanırken bir hata oluştu.');
        }
    }
}