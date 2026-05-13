const fs = require('fs');
const path = require('path');

// Kayıt yolu: Uygulama klasörü içindeki data/settings.json
const settingsPath = path.join(__dirname, '../data/settings.json');

// Varsayılan Ayarlar (FPS kapalı, URL EBA olarak ayarlandı)
let settings = {
    theme: 'dark',
    fpsCounter: false, // İlk açılışta kapalı
    hardwareAccel: true,
    autoSave: true,
    lineSmoothing: true,
    cursorStyle: 'crosshair',
    startupPage: 'https://www.eba.gov.tr', // Varsayılan EBA
    performanceMode: false,
    transparency: 0.95,
    shortcuts: true,
    accentColor: '#2ecc71'
};

// 1. AYARLARI YÜKLE VE KAYDET
function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            const savedSettings = JSON.parse(data);
            // Mevcut ayarları kayıtlı olanlarla birleştir (Yeni özellik eklersek bozulmasın)
            settings = { ...settings, ...savedSettings };
        } else {
            saveSettings();
        }
        applyAllSettings();
    } catch (err) {
        console.error("Yükleme Hatası:", err);
    }
}

function saveSettings() {
    try {
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error("Kaydetme Hatası:", err);
    }
}

// 2. FPS SİSTEMİ (Animasyonlu Geçişli)
const fpsEl = document.createElement('div');
fpsEl.id = "fps-display";
fpsEl.style = `
    position: fixed; top: 20px; right: 20px; 
    color: #2ecc71; font-family: 'Consolas', monospace; 
    z-index: 999999; background: rgba(0,0,0,0.85); 
    padding: 8px 15px; border-radius: 12px; 
    border: 1px solid rgba(255,255,255,0.1); 
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0; transform: translateY(-20px);
    pointer-events: none; box-shadow: 0 10px 20px rgba(0,0,0,0.5);
`;
document.body.appendChild(fpsEl);

let lastLoop = Date.now();
function updateFPS() {
    if (!settings.fpsCounter) {
        fpsEl.style.opacity = "0";
        fpsEl.style.transform = "translateY(-20px)";
        return;
    }
    
    // FPS Açıldığında Animasyonla Göster
    fpsEl.style.opacity = "1";
    fpsEl.style.transform = "translateY(0px)";

    let thisLoop = Date.now();
    let fps = Math.round(1000 / (thisLoop - lastLoop));
    lastLoop = thisLoop;
    fpsEl.innerHTML = `<span style="color:#888">FPS:</span> ${fps}`;
    requestAnimationFrame(updateFPS);
}

// 3. TEMA VE STİL SİSTEMİ
function applyAllSettings() {
    const root = document.documentElement;
    
    // Tema Uygula
    if (settings.theme === 'light') {
        root.style.setProperty('--bg', '#ffffff');
        root.style.setProperty('--text', '#1a1a1a');
        root.style.setProperty('--panel', '#f0f0f0');
    } else {
        root.style.setProperty('--bg', '#0a0a0a');
        root.style.setProperty('--text', '#ffffff');
        root.style.setProperty('--panel', '#1a1a1a');
    }

    // Panel Şeffaflığı (Animasyonlu)
    const panel = document.getElementById('settings-panel');
    if (panel) {
        panel.style.backgroundColor = `rgba(26, 26, 26, ${settings.transparency})`;
        panel.style.backdropFilter = `blur(${10 * settings.transparency}px)`;
    }

    // FPS Başlat/Durdur
    updateFPS();

    // İmleç
    document.body.style.cursor = settings.cursorStyle;

    // UI Elemanlarını Güncelle (Beyaz Kalmaması İçin Değer Atıyoruz)
    const elements = {
        'fps-toggle': 'checked',
        'theme-select': 'value',
        'startup-input': 'value',
        'transparency-range': 'value'
    };

    Object.entries(elements).forEach(([id, prop]) => {
        const el = document.getElementById(id);
        if (el) {
            if (id === 'startup-input') el.value = settings.startupPage || "https://www.eba.gov.tr";
            else if (prop === 'checked') el.checked = settings.fpsCounter;
            else el[prop] = settings[id.split('-')[0]] || settings[id.replace('-select','').replace('-range','')];
        }
    });
}

// 4. AYAR GÜNCELLEME (Efektli)
function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    
    // Küçük Bir Geri Bildirim Animasyonu (Opsiyonel)
    const panel = document.getElementById('settings-panel');
    panel.style.borderColor = settings.accentColor;
    setTimeout(() => panel.style.borderColor = "#333", 300);

    applyAllSettings();
}

// 5. PANEL AÇILIŞ ANİMASYONU
function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        panel.style.transform = "translateX(100%)";
    } else {
        panel.classList.add('open');
        panel.style.transform = "translateX(0)";
        // Panel açıldığında değerleri tekrar kontrol et (beyaz görünmemesi için)
        applyAllSettings();
    }
}

// --- BAŞLATMA ---
document.addEventListener('DOMContentLoaded', loadSettings);