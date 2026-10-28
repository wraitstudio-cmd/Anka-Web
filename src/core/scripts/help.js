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
        transition: transform .22s cubic-bezier(.16,1,.3,1), opacity .22s ease;
        overflow: hidden;
        box-sizing: border-box;
        contain: layout style paint;
        flex-direction: column;
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
    }
    .help-section:hover {
        border-color: var(--border-hover, #52525b);
    }
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
    .help-img-container {
        position: relative;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid var(--border-color, #27272a);
        background: var(--bg-secondary, #18181b);
        margin-top: 10px;
    }
    .help-img-container img {
        width: 100%;
        height: auto;
        display: block;
        object-fit: contain;
        cursor: zoom-in;
    }
    .help-zoom-btn {
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: var(--bg-secondary, #18181b);
        color: var(--text-color, #f4f4f5);
        border: 1px solid var(--border-color, #27272a);
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color .15s ease, color .15s ease, border-color .15s ease;
        touch-action: manipulation;
        font-family: inherit;
    }
    .help-zoom-btn:hover {
        background: var(--accent, #ff4757);
        color: #fff;
        border-color: var(--accent, #ff4757);
    }
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
        background: rgba(0,0,0,.65);
        z-index: 100000;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        transition: opacity .22s ease;
        opacity: 0;
    }
    #help-lightbox {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.9);
        z-index: 100005;
        justify-content: center;
        align-items: center;
        cursor: zoom-out;
        backdrop-filter: blur(2px);
    }
    #help-lightbox img {
        max-width: 90%;
        max-height: 90%;
        width: auto;
        height: auto;
        object-fit: contain;
        border-radius: 12px;
        border: 2px solid var(--border-color, #27272a);
        box-shadow: 0 16px 40px rgba(0,0,0,.55);
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
        .help-tab-btn, .help-zoom-btn, .help-close { min-height: 44px; }
    }
    </style>`;

    document.head.insertAdjacentHTML('beforeend', styles);

    const helpHTML = `
    <div id="help-panel" role="dialog" aria-modal="true" aria-label="Yardım">
        <div class="help-header">
            <div class="help-header-top">
                <div class="help-brand-icon">💡</div>
                <h2 class="help-title">Gelişmiş Kullanım ve Sistem Kılavuzu<small>Anka Web yardım ve güvenlik sistemi</small></h2>
                <button class="help-close" onclick="toggleHelp()" aria-label="Yardımı kapat">✕</button>
            </div>
            <div class="help-search-wrap">
                <span class="help-search-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg></span>
                <input type="text" class="help-search" id="help-search-input" placeholder="Rehberde, kısayollarda veya özelliklerde ara..." oninput="filterHelpSections(this.value)">
            </div>
        </div>

        <div class="help-category-tabs">
            <button class="help-tab-btn active" onclick="filterHelpCategory('all', this)">Tümü</button>
            <button class="help-tab-btn" onclick="filterHelpCategory('arac', this)">Araçlar</button>
            <button class="help-tab-btn" onclick="filterHelpCategory('ayar', this)">Ayarlar & Performans</button>
            <button class="help-tab-btn" onclick="filterHelpCategory('guvenlik', this)">Güvenlik & Gizlilik</button>
            <button class="help-tab-btn" onclick="filterHelpCategory('kisayol', this)">Kısayollar</button>
        </div>

        <div class="help-body" id="help-sections-container">
            <div class="help-section" data-category="arac" data-keywords="kalem çizim cetvel sayfa modu">
                <h3><span class="help-emoji">✏️</span> Kalem Menüsü ve Çizim Araçları</h3>
                <p>Sayfa üzerinde serbest çizim yapmak, cetvel kullanmak veya özel sayfa modlarını değiştirmek için kalem menüsünü açın.</p>
                <div class="help-img-container">
                    <img src="../../icons/kalem-açma.png" onclick="openHelpLightbox(this.src)" alt="Kalem Açma">
                    <button class="help-zoom-btn" onclick="openHelpLightbox(this.previousElementSibling.src)">Büyüt</button>
                </div>
            </div>

            <div class="help-section" data-category="arac" data-keywords="klavye arama yazı yazma sanal">
                <h3><span class="help-emoji">⌨️</span> Sanal Klavye Entegrasyonu</h3>
                <p>Fiziksel klavyenizin olmadığı durumlarda hızlı arama yapmak veya metin alanlarına yazı yazmak için sanal klavyeyi kullanın.</p>
                <div class="help-img-container">
                    <img src="../../icons/klavye-açma.png" onclick="openHelpLightbox(this.src)" alt="Klavye Açma">
                    <button class="help-zoom-btn" onclick="openHelpLightbox(this.previousElementSibling.src)">Büyüt</button>
                </div>
            </div>

            <div class="help-section" data-category="arac" data-keywords="sekme yeni sekme limit yönetim">
                <h3><span class="help-emoji">➕</span> Gelişmiş Sekme Yönetimi</h3>
                <p>Çoklu sekme yapısını optimize etmek ve bellek tüketimini yönetmek için sol menüdeki sekme araçlarını kullanabilirsiniz.</p>
                <div class="help-img-container">
                    <img src="../../icons/sekme-açma.png" onclick="openHelpLightbox(this.src)" alt="Sekme Açma">
                    <button class="help-zoom-btn" onclick="openHelpLightbox(this.previousElementSibling.src)">Büyüt</button>
                </div>
            </div>

            <div class="help-section" data-category="ayar" data-keywords="donanım hızlandırma performans gpu linux windows ayarlar">
                <h3><span class="help-emoji">⚡</span> Donanım Hızlandırma & Platform Optimizasyonu</h3>
                <p>Windows ve Linux işletim sistemlerinde ekran kartı (GPU) desteğini tam verimle kullanmak için ayarlar menüsünden donanım hızlandırmayı aktif tutun. Linux ortamlarında Wayland veya X11 uyumluluğu için bayrak ayarlarını yapılandırabilirsiniz.</p>
            </div>

            <div class="help-section" data-category="guvenlik" data-keywords="güvenlik gizlilik çerezler anti çerez şifreleme koruma">
                <h3><span class="help-emoji">🛡️</span> Güvenlik ve Gizlilik Denetimi</h3>
                <p>Uygulama yerleşik indirme ve site tarama araçlarıyla potansiyel tehlikeli dosyaları (.exe, .sh, .bat vb.) otomatik olarak işaretler. Gizlilik modunda izleyici engelleyicileri ve güvenli HTTPS yönlendirmelerini etkinleştirebilirsiniz.</p>
            </div>

            <div class="help-section" data-category="kisayol" data-keywords="kısayol yenile tam ekran kapat sekme bul git windows linux">
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
    <div id="help-overlay" onclick="toggleHelp()"></div>
    <div id="help-lightbox" onclick="closeHelpLightbox()">
        <img id="help-lightbox-img" src="" alt="Büyütülmüş Görsel">
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', helpHTML);
}

let cachedSections = null;

function toggleHelp() {
    if (document.body.dataset.systemPage === 'help' && typeof window.__ankaCloseSystemTab === 'function') {
        window.__ankaCloseSystemTab();
        return;
    }
    createHelpPanel();

    const panel = document.getElementById('help-panel');
    const overlay = document.getElementById('help-overlay');

    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        overlay.style.display = 'block';

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            panel.style.transform = 'translate(-50%, -50%) scale(1)';
            panel.style.opacity = '1';
        });

        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel) settingsPanel.style.display = 'none';
    } else {
        panel.style.transform = 'translate(-50%, -50%) scale(.96)';
        panel.style.opacity = '0';
        overlay.style.opacity = '0';
        setTimeout(() => {
            panel.style.display = 'none';
            overlay.style.display = 'none';
        }, 220);
    }
}

function filterHelpSections(query) {
    const q = query.toLowerCase().trim();
    if (!cachedSections) {
        cachedSections = document.querySelectorAll('.help-section');
    }

    cachedSections.forEach(sec => {
        const text = sec.innerText.toLowerCase();
        const keywords = sec.getAttribute('data-keywords') || '';
        if (text.includes(q) || keywords.includes(q)) {
            sec.style.display = 'block';
        } else {
            sec.style.display = 'none';
        }
    });
}

function filterHelpCategory(category, btn) {
    document.querySelectorAll('.help-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (!cachedSections) {
        cachedSections = document.querySelectorAll('.help-section');
    }

    cachedSections.forEach(sec => {
        const cat = sec.getAttribute('data-category');
        if (category === 'all' || cat === category) {
            sec.style.display = 'block';
        } else {
            sec.style.display = 'none';
        }
    });
}

function openHelpLightbox(src) {
    const lb = document.getElementById('help-lightbox');
    const img = document.getElementById('help-lightbox-img');
    img.src = src;
    lb.style.display = 'flex';
}

function closeHelpLightbox() {
    document.getElementById('help-lightbox').style.display = 'none';
}