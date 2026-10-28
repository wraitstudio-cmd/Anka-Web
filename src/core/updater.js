const { ipcMain, app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const CURRENT_VERSION = (() => {
  try { return require('../../package.json').version; } catch { return '0.0.0'; }
})();

const SPLASH_FILE = 'anka-splash.html';
const FIRST_CHECK_DELAY = 1500;
const CHECK_INTERVAL = 10 * 60 * 1000;
const HANDOFF_PAUSE_MS = 500;

let targetWin = null;
let activeSplash = null;
let notifiedVersion = '';

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

let mainLogPath = null;
try {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  mainLogPath = path.join(dir, 'main.log');
} catch {}

function logInfo(...args) {
  const line = `[INFO] ${new Date().toISOString()} ${args.join(' ')}`;
  if (mainLogPath) try { fs.appendFileSync(mainLogPath, line + '\n'); } catch {}
}

function logError(...args) {
  const line = `[ERROR] ${new Date().toISOString()} ${args.join(' ')}`;
  if (mainLogPath) try { fs.appendFileSync(mainLogPath, line + '\n'); } catch {}
}

function buildSplashHtml(logoUrl) {
  const mark = logoUrl
    ? `<img src="${logoUrl}" alt="" draggable="false" onerror="this.remove()">`
    : 'A';
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Anka Web</title>
<style>
:root{--bg:#121214;--panel:#18181b;--border:#27272a;--text:#f4f4f5;--muted:#a1a1aa;--track:#27272a;--accent:#ff4757;--accent-2:#ff7a45}
@media(prefers-color-scheme:light){:root{--bg:#f4f4f5;--panel:#fff;--border:#e4e4e7;--text:#18181b;--muted:#71717a;--track:#e4e4e7}}
*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;cursor:default}
body{display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-app-region:drag}
.glow{position:fixed;inset:0;background:radial-gradient(circle at 50% 30%,rgba(255,71,87,.16),transparent 55%);pointer-events:none}
.card{position:relative;width:calc(100% - 24px);height:calc(100% - 24px);display:flex;flex-direction:column;justify-content:space-between;padding:30px 32px 26px;background:var(--panel);border:1px solid var(--border);border-radius:20px;overflow:hidden}
.brand{display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:10px}
.mark{position:relative;display:grid;place-items:center;width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;font-size:30px;font-weight:700}
.mark img{width:46px;height:46px;object-fit:contain;position:relative;z-index:1}
.name{font-size:18px;font-weight:700}
.bottom{display:flex;flex-direction:column;gap:10px}
.status{display:flex;align-items:center;justify-content:center;gap:9px;font-size:13px;font-weight:600}
.spin{flex:0 0 13px;width:13px;height:13px;border:2px solid var(--track);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
.track{height:5px;border-radius:3px;background:var(--track);overflow:hidden}
.bar{height:100%;width:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transform-origin:left;transform:scaleX(0);transition:transform .2s ease-out}
.detail{min-height:17px;text-align:center;color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="glow"></div>
<div class="card">
<div class="brand"><div class="mark">${mark}</div><div class="name">Anka Web</div></div>
<div class="bottom">
<div class="status"><span class="spin"></span><span>Güncelleniyor...</span></div>
<div class="track"><div class="bar" id="bar"></div></div>
<div class="detail" id="detail">Hazırlanıyor</div>
</div>
</div>
<script>
(function(){
  var bar = document.getElementById('bar');
  var detail = document.getElementById('detail');
  function size(b){ if(!b||b<0) return '0 MB'; var m=b/1048576; return m>=1024?(m/1024).toFixed(2)+' GB':m.toFixed(1)+' MB'; }
  window.__p = function(d){
    if(!d) return;
    var pct = typeof d.percent==='number' ? d.percent : -1;
    if(pct>=0){ bar.style.transform='scaleX('+Math.min(1,pct/100)+')'; }
    var ver = d.version ? 'Sürüm '+d.version : '';
    if(d.phase==='download'){
      detail.textContent = (ver?ver+' · ':'') + (pct>=0?'%'+Math.round(pct)+' · ':'') + size(d.transferred) + (d.total>0?' / '+size(d.total):'') + (d.bytesPerSecond>0?' · '+size(d.bytesPerSecond)+'/sn':'');
    } else if(d.phase==='install'){ detail.textContent='Sessiz kurulum başlatılıyor'; }
    else if(d.phase==='restart'){ detail.textContent='Uygulama yeniden başlatılıyor'; }
    else { detail.textContent = ver ? ver+' hazırlanıyor' : 'Güncellemeler denetleniyor'; }
  };
})();
</script>
</body>
</html>`;
}

function createSplash() {
  let win = null;
  let ready = false;
  let latest = null;

  function push() {
    if (!win || !ready || !latest || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`window.__p&&window.__p(${JSON.stringify(latest)})`).catch(() => {});
  }

  return {
    open() {
      if (win) return;
      try {
        const logo = path.join(app.getAppPath(), 'icons', 'logo.png');
        const hasLogo = fs.existsSync(logo);
        const dir = app.getPath('userData');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, SPLASH_FILE);
        fs.writeFileSync(file, buildSplashHtml(hasLogo ? pathToFileURL(logo).href : ''), { mode: 0o600 });

        win = new BrowserWindow({
          width: 460,
          height: 320,
          frame: false,
          resizable: false,
          show: false,
          center: true,
          alwaysOnTop: true,
          backgroundColor: '#121214',
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        });
        win.removeMenu();
        win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.show(); });
        win.webContents.on('did-finish-load', () => { ready = true; push(); });
        win.on('closed', () => { win = null; ready = false; });
        win.loadFile(file).catch(() => {});
      } catch { win = null; }
    },
    update(data) {
      latest = Object.assign({}, latest, data);
      push();
    },
    close() {
      const t = win;
      win = null;
      ready = false;
      if (t && !t.isDestroyed()) t.destroy();
    },
    isOpen() { return !!win; },
  };
}

function setupUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    logInfo('checking-for-update');
  });

  autoUpdater.on('update-available', (info) => {
    logInfo('update-available', info.version);
    if (targetWin && !targetWin.isDestroyed()) {
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
      targetWin.webContents.send('update-available', {
        version: info.version,
        currentVersion: CURRENT_VERSION,
        notes: notes.slice(0, 600),
      });
    }
    const auto = safeReadSetting('auto-update-on-launch');
    if (auto && !activeSplash) {
      startSilentUpdate(info.version).catch((err) => logError('auto-start', err));
    }
  });

  autoUpdater.on('update-not-available', () => {
    logInfo('update-not-available');
  });

  autoUpdater.on('download-progress', (p) => {
    if (activeSplash && activeSplash.isOpen()) {
      activeSplash.update({
        phase: 'download',
        percent: Math.min(99, Math.round(p.percent)),
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    logInfo('update-downloaded', info.version);
    if (activeSplash && activeSplash.isOpen()) {
      activeSplash.update({ phase: 'restart', percent: 100, version: info.version });
    }
    await new Promise((r) => setTimeout(r, HANDOFF_PAUSE_MS));
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      logError('quitAndInstall', err);
    }
  });

  autoUpdater.on('error', (err) => {
    logError('updater-error', err && err.message ? err.message : err);
    if (activeSplash && activeSplash.isOpen()) {
      activeSplash.close();
      activeSplash = null;
    }
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('update-error', err && err.message ? err.message : 'Güncelleme hatası');
    }
  });
}

async function startSilentUpdate(version) {
  if (activeSplash) return false;
  const splash = createSplash();
  activeSplash = splash;
  splash.update({ phase: 'prepare', percent: -1, version });
  splash.open();

  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (err) {
    logError('startSilentUpdate', err);
    splash.close();
    if (activeSplash === splash) activeSplash = null;
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('update-error', err && err.message ? err.message : 'Güncelleme başarısız');
    }
    return false;
  }
}

function registerIpc() {
  ipcMain.removeHandler('anka:get-version');
  ipcMain.handle('anka:get-version', () => CURRENT_VERSION);

  ipcMain.removeHandler('anka:check-for-updates');
  ipcMain.handle('anka:check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || CURRENT_VERSION;
      const hasUpdate = compareVersions(version, CURRENT_VERSION) > 0;
      return {
        hasUpdate,
        version: hasUpdate ? version : CURRENT_VERSION,
        currentVersion: CURRENT_VERSION,
        latestVersion: version,
      };
    } catch (err) {
      return { hasUpdate: false, version: CURRENT_VERSION, currentVersion: CURRENT_VERSION, error: err.message };
    }
  });

  ipcMain.removeHandler('anka:check-update');
  ipcMain.handle('anka:check-update', () => autoUpdater.checkForUpdates());

  ipcMain.removeHandler('anka:start-update');
  ipcMain.handle('anka:start-update', async (event) => {
    const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
    targetWin = win;
    if (activeSplash) return { status: 'already' };
    try {
      const check = await autoUpdater.checkForUpdates();
      const info = check?.updateInfo;
      if (!info || compareVersions(info.version, CURRENT_VERSION) <= 0) {
        return { status: 'current', currentVersion: CURRENT_VERSION };
      }
      startSilentUpdate(info.version);
      return { status: 'started', version: info.version };
    } catch (err) {
      if (win && !win.isDestroyed()) win.webContents.send('update-error', err.message);
      return { status: 'error', message: err.message };
    }
  });

  ipcMain.removeAllListeners('check-manual-update');
  ipcMain.on('check-manual-update', (event) => {
    const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
    if (win) targetWin = win;
    autoUpdater.checkForUpdates().catch((err) => logError('check-manual-update', err));
  });

  ipcMain.on('save-app-setting', (_e, payload) => {
    if (payload?.id === 'auto-update-on-launch') {
      try {
        const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
        s['auto-update-on-launch'] = payload.val === true || payload.val === 'true';
        fs.writeFileSync(settingsPath(), JSON.stringify(s), { mode: 0o600 });
      } catch {}
    }
  });

  ipcMain.on('settings-update', (_e, payload) => {
    if (payload?.id === 'auto-update-on-launch') {
      try {
        const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
        s['auto-update-on-launch'] = payload.val === true || payload.val === 'true';
        fs.writeFileSync(settingsPath(), JSON.stringify(s), { mode: 0o600 });
      } catch {}
    }
  });
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

function safeReadSetting(key) {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const data = JSON.parse(raw);
    return data[key] === true || data[key] === 'true';
  } catch { return false; }
}

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map(Number);
  const pb = String(b).replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkUpdates(win) {
  if (!win || win.isDestroyed()) return;
  targetWin = win;
  win.once('closed', () => { if (targetWin === win) targetWin = null; });

  const doCheck = async () => {
    if (!targetWin || targetWin.isDestroyed() || (activeSplash && activeSplash.isOpen())) return;
    try {
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!info) return;
      const version = info.version;
      if (compareVersions(version, CURRENT_VERSION) <= 0) return;
      if (version === notifiedVersion) return;
      notifiedVersion = version;

      if (safeReadSetting('auto-update-on-launch')) {
        await startSilentUpdate(version);
      }
    } catch (err) {
      logError('checkUpdates', err);
    }
  };

  const first = setTimeout(doCheck, FIRST_CHECK_DELAY);
  if (typeof first.unref === 'function') first.unref();
  const timer = setInterval(doCheck, CHECK_INTERVAL);
  if (typeof timer.unref === 'function') timer.unref();
  win.once('closed', () => { clearTimeout(first); clearInterval(timer); });
}

function init() {
  setupUpdaterEvents();
  registerIpc();
}

module.exports = {
  init,
  checkUpdates,
  logPath: () => mainLogPath,
};