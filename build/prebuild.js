const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const NAMES = ['Anka Web.exe', 'anka-web.exe', 'electron.exe'];

function tryKill(name) {
    try {
        execSync(`taskkill /F /IM "${name}" /T`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function isLocked(file) {
    try {
        const fd = fs.openSync(file, 'r+');
        fs.closeSync(fd);
        return false;
    } catch (e) {
        return e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES';
    }
}

function scanLocked(dir, max = 20) {
    const locked = [];
    if (!fs.existsSync(dir)) return locked;
    const stack = [dir];
    while (stack.length && locked.length < max) {
        const cur = stack.pop();
        let entries;
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { continue; }
        for (const ent of entries) {
            if (locked.length >= max) break;
            const full = path.join(cur, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            } else if (ent.isFile() && isLocked(full)) {
                locked.push(full);
            }
        }
    }
    return locked;
}

async function tryRemoveDir(dir) {
    for (let i = 0; i < 8; i++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
            return true;
        } catch (e) {
            await sleep(500);
        }
    }
    return false;
}

async function main() {
    if (process.platform !== 'win32') {
        console.log('[prebuild] Windows değil, temizlik atlandı.');
        return;
    }

    console.log('[prebuild] Çalışan Anka Web süreçleri kapatılıyor...');
    let killed = false;
    for (const name of NAMES) {
        if (tryKill(name)) {
            console.log('[prebuild] Kapatıldı:', name);
            killed = true;
        }
    }
    if (killed) {
        await sleep(1200);
        for (const name of NAMES) tryKill(name);
        await sleep(400);
    }

    const winUnpacked = path.join(distDir, 'win-unpacked');
    if (!fs.existsSync(winUnpacked)) {
        console.log('[prebuild] dist/win-unpacked yok, temizlik gerekmiyor.');
        return;
    }

    const locked = scanLocked(winUnpacked);
    if (locked.length > 0) {
        console.error('[prebuild] HATA: Şu dosyalar hâlâ kilitli:');
        for (const f of locked.slice(0, 10)) console.error('  ' + f);
        console.error('');
        console.error('Lütfen şunları yapın:');
        console.error('  1. Anka Web uygulamasını kapatın (Görev Yöneticisi ile kontrol edin)');
        console.error('  2. dist\\win-unpacked klasörünü açan Dosya Gezgini pencerelerini kapatın');
        console.error('  3. Antivirüs gerçek zamanlı korumayı geçici olarak durdurun');
        console.error('  4. Komutu tekrar çalıştırın');
        process.exit(1);
    }

    console.log('[prebuild] dist/win-unpacked temizleniyor...');
    const ok = await tryRemoveDir(winUnpacked);
    if (!ok) {
        console.error('[prebuild] Temizleme başarısız, dosyalar hâlâ kilitli.');
        process.exit(1);
    }
    console.log('[prebuild] Temizlik tamam.');
}

main().catch(e => {
    console.error('[prebuild] Hata:', e.message);
    process.exit(1);
});