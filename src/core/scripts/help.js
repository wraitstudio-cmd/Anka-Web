function createHelpPanel() {
    if (document.getElementById('help-panel')) return;

    const styles = `
    <style>
    #help-panel {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(.96);
        width: 720px;
        height: min(720px, calc(100vh - 40px));
        max-width: 94vw;
        max-height: 94vh;
        background: var(--bg-secondary, #18181b);
        color: var(--text-color, #f4f4f5);
        border-radius: 16px;
        box-shadow: 0 24px 64px rgba(0,0,0,.5), 0 0 0 1px var(--border-color, #27272a);
        z-index: 100001;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        opacity: 0;
        transition: transform .2s cubic-bezier(.16,1,.3,1), opacity .18s ease;
        overflow: hidden;
        box-sizing: border-box;
        contain: layout style paint;
        flex-direction: column;
        will-change: transform, opacity;
    }
    #help-panel.open {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
    }
    #help-panel * { box-sizing: border-box; }

    .help-header {
        padding: 18px 24px 14px;
        border-bottom: 1px solid var(--border-color, #27272a);
        background: var(--bg-secondary, #18181b);
        flex-shrink: 0;
    }
    .help-header-top {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    .help-brand-icon {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--accent, #ff4757), var(--accent-2, #ff7a45));
        display: grid;
        place-items: center;
        color: #fff;
        font-size: 18px;
        flex-shrink: 0;
    }
    .help-title {
        font-size: 17px;
        font-weight: 700;
        margin: 0;
        flex: 1;
        min-width: 0;
        color: var(--text-color, #f4f4f5);
    }
    .help-title small {
        display: block;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--text-secondary, #a1a1aa);
        margin-top: 2px;
    }
    .help-close {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: var(--bg-tertiary, #27272a);
        border: 1px solid var(--border-color, #27272a);
        color: var(--text-color, #f4f4f5);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: background-color .15s ease, color .15s ease, border-color .15s ease;
        touch-action: manipulation;
        flex-shrink: 0;
        font-family: inherit;
    }
    .help-close:hover {
        background: #ef4444;
        border-color: #ef4444;
        color: #fff;
    }
    .help-search-wrap { position: relative; }
    .help-search-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        color: var(--text-secondary, #a1a1aa);
        pointer-events: none;
    }
    .help-search-icon svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .help-search {
        width: 100%;
        height: 36px;
        padding: 0 12px 0 34px;
        border: 1px solid var(--border-color, #27272a);
        background: var(--bg-primary, #121214);
        color: var(--text-color, #f4f4f5);
        border-radius: 8px;
        font: inherit;
        font-size: 12.5px;
        outline: none;
        transition: border-color .15s ease, box-shadow .15s ease;
    }
    .help-search:focus {
        border-color: var(--accent, #ff4757);
        box-shadow: 0 0 0 3px rgba(255,71,87,.14);
    }
    .help-category-tabs {
        display: flex;
        gap: 6px;
        padding: 12px 24px 0;
        overflow-x: auto;
        flex-shrink: 0;
        scrollbar-width: none;
    }
    .help-category-tabs::-webkit-scrollbar { display: none; }
    .help-tab-btn {
        background: var(--bg-tertiary, #27272a);
        border: 1px solid var(--border-color, #27272a);
        color: var(--text-color, #f4f4f5);
        padding: 7px 14px;
        border-radius: 8px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color .15s ease, color .15s ease, border-color .15s ease;
        touch-action: manipulation;
        font-family: inherit;
    }
    .help-tab-btn.active,
    .help-tab-btn:hover {
        background: rgba(255,71,87,.14);
        color: var(--accent, #ff4757);
        border-color: rgba(255,71,87,.25);
    }
    .help-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px 24px 20px;
        scrollbar-width: thin;
        overflow-x: hidden;
        contain: content;
    }
    .help-body::-webkit-scrollbar { width: 8px; }
    .help-body::-webkit-scrollbar-track { background: transparent; }
    .help-body::-webkit-scrollbar-thumb {
        background: var(--border-color, #27272a);
        border-radius: 4px;
    }
    .help-body::-webkit-scrollbar-thumb:hover {
        background: var(--bg-elevated, #3f3f46);
    }
    .help-section {
        background: var(--bg-primary, #121214);
        border: 1px solid var(--border-color, #27272a);
        border-radius: 12px;
        padding: 16px 18px;
        margin-bottom: 12px;
        transition: border-color .15s ease;
        contain: layout style;
        content-visibility: auto;
        contain-intrinsic-size: 120px;
    }
    .help-section[hidden] { display: none !important; }
    .help-section:hover { border-color: var(--border-hover, #52525b); }
    .help-section h3 {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 8px;
        color: var(--text-color, #f4f4f5);
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .help-section h3 .help-emoji {
        color: var(--accent, #ff4757);
        font-size: 16px;
        line-height: 1;
    }
    .help-section p {
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--text-secondary, #a1a1aa);
        margin: 0 0 10px;
    }
    .help-section p:last-child { margin-bottom: 0; }
    .help-section ul {
        margin: 0;
        padding-left: 18px;
        color: var(--text-secondary, #a1a1aa);
        font-size: 12.5px;
        line-height: 1.65;
    }
    .help-section ul li { margin-bottom: 4px; }
    .help-section ul li::marker { color: var(--accent, #ff4757); }
    .shortcut-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 10px;
    }
    .shortcut-item {
        background: var(--bg-tertiary, #27272a);
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--text-color, #f4f4f5);
    }
    .shortcut-key {
        background: var(--bg-primary, #121214);
        color: var(--accent, #ff4757);
        padding: 3px 8px;
        border-radius: 5px;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 11px;
        font-weight: 700;
        border: 1px solid var(--border-color, #27272a);
        white-space: nowrap;
    }
    .help-footer {
        text-align: center;
        padding: 10px 0 2px;
        color: var(--text-secondary, #a1a1aa);
        font-size: 11px;
        opacity: .8;
    }
    #help-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.6);
        z-index: 100000;
        transition: opacity .18s ease;
        opacity: 0;
    }
    html.reduce-effects #help-panel { transition: none !important; }
    @media (max-width: 680px) {
        #help-panel {
            width: calc(100vw - 12px);
            height: calc(100dvh - 12px);
            max-width: none;
            max-height: none;
            border-radius: 12px;
        }
        .help-header { padding: 14px 16px 10px; }
        .help-header-top { gap: 10px; margin-bottom: 10px; }
        .help-brand-icon { width: 30px; height: 30px; font-size: 15px; }
        .help-title { font-size: 14.5px; }
        .help-category-tabs { padding: 10px 16px 0; gap: 4px; }
        .help-tab-btn { padding: 6px 11px; font-size: 11px; }
        .help-body { padding: 12px 16px 16px; }
        .help-section { padding: 13px 14px; }
        .shortcut-grid { grid-template-columns: 1fr; }
    }
    @media (pointer: coarse) {
        .help-tab-btn, .help-close { min-height: 44px; }
    }
    </style>`;

    document.head.insertAdjacentHTML('beforeend', styles);

    const helpHTML = `
    <div id="help-panel" role="dialog" aria-modal="true" aria-label="Yardım">
        <div class="help-header">
            <div class="help-header-top">
                <div class="help-brand-icon">💡</div>
                <h2 class="help-title">Gelişmiş Kullanım ve Sistem Kılavuzu<small>Anka Web yardım ve güvenlik sistemi</small></h2>
                <button class="help-close" data-help-action="close" aria-label="Yardımı kapat">✕</button>
            </div>
            <div class="help-search-wrap">
                <span class="help-search-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg></span>
                <input type="text" class="help-search" id="help-search-input" placeholder="Rehberde, kısayollarda veya özelliklerde ara..." autocomplete="off" spellcheck="false">
            </div>
        </div>

        <div class="help-category-tabs" id="help-tabs">
            <button class="help-tab-btn active" data-help-category="all">Tümü</button>
            <button class="help-tab-btn" data-help-category="arac">Araçlar</button>
            <button class="help-tab-btn" data-help-category="ayar">Ayarlar & Performans</button>
            <button class="help-tab-btn" data-help-category="guvenlik">Güvenlik & Gizlilik</button>
            <button class="help-tab-btn" data-help-category="kisayol">Kısayollar</button>
        </div>

        <div class="help-body" id="help-sections-container">
            <div class="help-section" data-category="arac" data-keywords="kalem çizim cetvel sayfa modu çizim araçları">
                <h3><span class="help-emoji">✏️</span> Kalem Menüsü ve Çizim Araçları</h3>
                <p>Sayfa üzerinde serbest çizim yapmak, cetvel ve iletki kullanmak veya özel sayfa modlarını değiştirmek için üst araç çubuğundaki kalem düğmesini kullanın.</p>
                <ul>
                    <li>Kalem, fosforlu, neon, silgi, kaligrafi ve sprey araçları mevcuttur.</li>
                    <li>Şekil araçları: çizgi, dikdörtgen, yuvarlak dikdörtgen, daire, üçgen, elmas, yıldız, ok.</li>
                </ul>
            </div>

            <div class="help-section" data-category="arac" data-keywords="klavye arama yazı yazma sanal ekran klavyesi">
                <h3><span class="help-emoji">⌨️</span> Sanal Klavye Entegrasyonu</h3>
                <p>Fiziksel klavyenizin olmadığı durumlarda hızlı arama yapmak veya metin alanlarına yazı yazmak için sanal klavyeyi kullanın. Türkçe Q klavye düzeni desteklenir ve tüm sistem genelinde çalışır.</p>
                <ul>
                    <li>Metin alanlarına otomatik olarak bağlanır.</li>
                    <li>Arama ve form doldurma işlemlerinde hızlıdır.</li>
                    <li>Büyük/küçük harf ve sembol katmanlarını destekler.</li>
                </ul>
            </div>

            <div class="help-section" data-category="arac" data-keywords="sekme yeni sekme limit yönetim bellek">
                <h3><span class="help-emoji">➕</span> Gelişmiş Sekme Yönetimi</h3>
                <p>Çoklu sekme yapısını optimize etmek ve bellek tüketimini yönetmek için sol menüdeki sekme araçlarını kullanabilirsiniz.</p>
                <ul>
                    <li>Sekmeler arasında Ctrl + Tab ile hızlıca geçiş yapın.</li>
                    <li>Kapatılan sekmeleri Ctrl + Shift + T ile geri açın.</li>
                    <li>Sekmeleri sürükleyerek yeniden sıralayabilirsiniz.</li>
                    <li>Gizli sekme modu için Ctrl + Shift + N kullanın.</li>
                </ul>
            </div>

            <div class="help-section" data-category="ayar" data-keywords="donanım hızlandırma performans gpu linux windows ayarlar">
                <h3><span class="help-emoji">⚡</span> Donanım Hızlandırma & Platform Optimizasyonu</h3>
                <p>Windows ve Linux işletim sistemlerinde ekran kartı (GPU) desteğini tam verimle kullanmak için ayarlar menüsünden donanım hızlandırmayı aktif tutun.</p>
                <ul>
                    <li>Linux: Wayland veya X11 uyumluluğu için uygun bayraklar otomatik seçilir.</li>
                    <li>Yüksek DPI ekranlarda DPR otomatik algılanır ve çizim keskinleştirilir.</li>
                    <li>Bellek dostu geri al/yinele yığını 40 adım ile sınırlıdır.</li>
                    <li>Arka planda çalışan sekmeler otomatik olarak dondurulur.</li>
                </ul>
            </div>

            <div class="help-section" data-category="guvenlik" data-keywords="güvenlik gizlilik çerezler anti çerez şifreleme koruma indirme">
                <h3><span class="help-emoji">🛡️</span> Güvenlik ve Gizlilik Denetimi</h3>
                <p>Uygulama yerleşik indirme ve site tarama araçlarıyla potansiyel tehlikeli dosyaları (.exe, .sh, .bat vb.) otomatik olarak işaretler.</p>
                <ul>
                    <li>Gizlilik modunda izleyici engelleyicileri etkinleştirin.</li>
                    <li>HTTPS yönlendirmesi tüm sitelerde varsayılan olarak açıktır.</li>
                    <li>Çerezler üçüncü taraf sitelere karşı filtrelenir.</li>
                    <li>İndirilen dosyalar indirme öncesi güvenlik taramasından geçirilir.</li>
                </ul>
            </div>

            <div class="help-section" data-category="kisayol" data-keywords="kısayol yenile tam ekran kapat sekme bul git windows linux klavye">
                <h3><span class="help-emoji">⌨️</span> Windows & Linux Klavye Kısayolları</h3>
                <div class="shortcut-grid">
                    <div class="shortcut-item"><span>Yeni Sekme</span><span class="shortcut-key">Ctrl + T</span></div>
                    <div class="shortcut-item"><span>Tarihli Tam Geçmiş</span><span class="shortcut-key">Ctrl + H</span></div>
                    <div class="shortcut-item"><span>Kapananı Geri Aç</span><span class="shortcut-key">Ctrl + Shift + T</span></div>
                    <div class="shortcut-item"><span>Yan Panel Geçmişi</span><span class="shortcut-key">Ctrl + Shift + H</span></div>
                    <div class="shortcut-item"><span>Gizli Sekme</span><span class="shortcut-key">Ctrl + Shift + N</span></div>
                    <div class="shortcut-item"><span>Sekmeyi Kapat</span><span class="shortcut-key">Ctrl + W</span></div>
                    <div class="shortcut-item"><span>Adres Çubuğu Odak</span><span class="shortcut-key">Ctrl + L</span></div>
                    <div class="shortcut-item"><span>Ayarları Aç</span><span class="shortcut-key">Ctrl + ,</span></div>
                    <div class="shortcut-item"><span>Sayfayı Yenile</span><span class="shortcut-key">Ctrl + R / F5</span></div>
                    <div class="shortcut-item"><span>Geri / İleri Git</span><span class="shortcut-key">Alt + Sol/Sağ Ok</span></div>
                    <div class="shortcut-item"><span>Sekmeler Arası Geçiş</span><span class="shortcut-key">Ctrl + Tab</span></div>
                    <div class="shortcut-item"><span>Sayfada Bul</span><span class="shortcut-key">Ctrl + F</span></div>
                    <div class="shortcut-item"><span>Sesi Kapat / Aç</span><span class="shortcut-key">Ctrl + Shift + M</span></div>
                    <div class="shortcut-item"><span>Geliştirici Araçları</span><span class="shortcut-key">F12</span></div>
                    <div class="shortcut-item"><span>Tam Ekran</span><span class="shortcut-key">F11</span></div>
                </div>
            </div>

            <div class="help-footer">Anka Web Çoklu Platform Yardım ve Güvenlik Sistemi</div>
        </div>
    </div>
    <div id="help-overlay"></div>
    `;

    document.body.insertAdjacentHTML('beforeend', helpHTML);
    bindHelpEvents();
}

let helpState = null;

function bindHelpEvents() {
    const panel = document.getElementById('help-panel');
    const overlay = document.getElementById('help-overlay');
    const searchInput = document.getElementById('help-search-input');
    const tabs = document.getElementById('help-tabs');
    if (!panel || !overlay || !tabs) return;

    helpState = {
        sections: null,
        filterCategory: 'all',
        filterQuery: '',
        searchTimer: 0,
        refreshTimeout: 0
    };

    panel.addEventListener('click', (event) => {
        const action = event.target.closest('[data-help-action]');
        if (action && action.dataset.helpAction === 'close') toggleHelp();
    });

    overlay.addEventListener('click', toggleHelp);

    tabs.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-help-category]');
        if (!btn) return;
        const category = btn.dataset.helpCategory;
        if (helpState.filterCategory === category) return;
        helpState.filterCategory = category;
        tabs.querySelectorAll('.help-tab-btn').forEach(b => {
            b.classList.toggle('active', b === btn);
        });
        scheduleHelpRefresh();
    });

    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            const value = event.target.value;
            if (helpState.searchTimer) return;
            helpState.searchTimer = setTimeout(() => {
                helpState.searchTimer = 0;
                helpState.filterQuery = value.toLowerCase().trim();
                scheduleHelpRefresh();
            }, 120);
        });
    }

    document.addEventListener('keydown', helpKeyHandler);
}

function helpKeyHandler(event) {
    const panel = document.getElementById('help-panel');
    if (!panel || panel.style.display !== 'flex') return;
    if (event.key === 'Escape') {
        event.preventDefault();
        toggleHelp();
        return;
    }
    if (event.target && event.target.id === 'help-search-input') return;
    const active = document.activeElement;
    const focusables = panel.querySelectorAll('.help-close, .help-tab-btn, .help-search');
    if (event.key === 'Tab' && focusables.length > 0) {
        const idx = Array.prototype.indexOf.call(focusables, active);
        event.preventDefault();
        const next = event.shiftKey
            ? (idx <= 0 ? focusables.length - 1 : idx - 1)
            : (idx === focusables.length - 1 ? 0 : idx + 1);
        focusables[next].focus();
    }
}

function scheduleHelpRefresh() {
    if (!helpState) return;
    if (helpState.refreshTimeout) return;
    helpState.refreshTimeout = requestAnimationFrame(() => {
        helpState.refreshTimeout = 0;
        applyHelpFilter();
    });
}

function applyHelpFilter() {
    if (!helpState) return;
    if (!helpState.sections) {
        helpState.sections = Array.from(document.querySelectorAll('.help-section')).map(el => ({
            el,
            category: el.getAttribute('data-category') || '',
            keywords: (el.getAttribute('data-keywords') || '').toLowerCase(),
            text: (el.textContent || '').toLowerCase()
        }));
    }
    const cat = helpState.filterCategory;
    const q = helpState.filterQuery;
    for (let i = 0; i < helpState.sections.length; i++) {
        const sec = helpState.sections[i];
        const catOk = cat === 'all' || sec.category === cat;
        const queryOk = !q || sec.text.includes(q) || sec.keywords.includes(q);
        const visible = catOk && queryOk;
        if (sec.el.hidden === visible) sec.el.hidden = !visible;
    }
}

function toggleHelp() {
    if (document.body.dataset.systemPage === 'help' && typeof window.__ankaCloseSystemTab === 'function') {
        window.__ankaCloseSystemTab();
        return;
    }
    createHelpPanel();

    const panel = document.getElementById('help-panel');
    const overlay = document.getElementById('help-overlay');
    if (!panel || !overlay) return;

    const isOpen = panel.style.display === 'flex';
    if (!isOpen) {
        panel.style.display = 'flex';
        overlay.style.display = 'block';
        panel.offsetHeight;
        panel.classList.add('open');
        overlay.style.opacity = '1';
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel) settingsPanel.style.display = 'none';
        const searchInput = document.getElementById('help-search-input');
        if (searchInput) {
            searchInput.value = '';
            if (helpState) helpState.filterQuery = '';
            setTimeout(() => searchInput.focus(), 60);
        }
        if (helpState) {
            helpState.filterCategory = 'all';
            const tabs = document.getElementById('help-tabs');
            if (tabs) tabs.querySelectorAll('.help-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
            helpState.sections = null;
            scheduleHelpRefresh();
        }
    } else {
        panel.classList.remove('open');
        overlay.style.opacity = '0';
        setTimeout(() => {
            panel.style.display = 'none';
            overlay.style.display = 'none';
        }, 200);
    }
}

function filterHelpSections(query) {
    if (!helpState) return;
    helpState.filterQuery = String(query || '').toLowerCase().trim();
    scheduleHelpRefresh();
}

function filterHelpCategory(category) {
    if (!helpState) return;
    helpState.filterCategory = category;
    const tabs = document.getElementById('help-tabs');
    if (tabs) {
        tabs.querySelectorAll('.help-tab-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.helpCategory === category);
        });
    }
    scheduleHelpRefresh();
}