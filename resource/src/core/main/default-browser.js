const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { execFile } = require('child_process');
const { app, ipcMain, shell, BrowserWindow } = require('electron');

const URL_RE = /^https?:\/\//i;
const FILE_RE = /\.(pdf|html?|txt|md|json|png|jpe?g|gif|webp|svg|mp4|webm|mp3|ogg|wav)$/i;
const MIME_TYPES = ['x-scheme-handler/http', 'x-scheme-handler/https', 'text/html', 'application/xhtml+xml'];
const WIN_URL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice';

function capture(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: 6000, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout || '')));
    });
}

function run(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: 6000, windowsHide: true }, (error) => resolve(!error));
    });
}

function pickTargets(argv) {
    const out = [];
    for (const raw of argv.slice(1)) {
        if (typeof raw !== 'string' || !raw || raw.startsWith('-')) continue;
        if (URL_RE.test(raw)) {
            out.push(raw);
        } else if (/^file:\/\//i.test(raw)) {
            try {
                const filePath = fileURLToPath(raw);
                if (FILE_RE.test(filePath) && fs.existsSync(filePath)) out.push(filePath);
            } catch (err) {}
        } else if (path.isAbsolute(raw) && FILE_RE.test(raw) && fs.existsSync(raw)) {
            out.push(raw);
        }
        if (out.length >= 10) break;
    }
    return out;
}

function protocolArgs() {
    if (process.defaultApp && process.argv.length >= 2) return [process.execPath, [path.resolve(process.argv[1])]];
    return [process.execPath, []];
}

function applyPerformanceSwitches() {
    const sw = app.commandLine;
    sw.appendSwitch('enable-gpu-rasterization');
    sw.appendSwitch('enable-zero-copy');
    sw.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
    if (process.platform === 'linux') {
        sw.appendSwitch('ozone-platform-hint', 'auto');
        sw.appendSwitch('enable-features', 'VaapiVideoDecoder,WebRTCPipeWireCapturer');
    }
}

function setupDefaultBrowser(options = {}) {
    const getWindow = typeof options.getWindow === 'function' ? options.getWindow : () => BrowserWindow.getAllWindows()[0] || null;
    const winProgId = options.winProgId || 'AnkaBrowserURL';
    const desktopFile = options.desktopFile || (String(app.getName()).toLowerCase().replace(/\s+/g, '-') + '.desktop');
    const pending = [];
    let rendererReady = false;

    if (options.performance !== false) applyPerformanceSwitches();

    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return { primary: false };
    }

    const focusWindow = () => {
        const win = getWindow();
        if (!win || win.isDestroyed()) return null;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        try { app.focus({ steal: true }); } catch (err) {}
        return win;
    };

    const deliver = (targets) => {
        const win = focusWindow();
        if (!targets.length) return;
        const contents = win && !win.webContents.isDestroyed() ? win.webContents : null;
        if (rendererReady && contents && !contents.isLoading()) contents.send('open-external-url', targets);
        else pending.push(...targets);
    };

    app.on('second-instance', (event, argv) => deliver(pickTargets(argv)));

    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (URL_RE.test(url)) deliver([url]);
    });

    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        if (FILE_RE.test(filePath)) deliver([filePath]);
    });

    ipcMain.on('anka-renderer-ready', (event) => {
        rendererReady = true;
        if (pending.length && !event.sender.isDestroyed()) event.sender.send('open-external-url', pending.splice(0));
    });

    const checkDefault = async () => {
        if (process.platform === 'win32') {
            const out = await capture('reg', ['query', WIN_URL_KEY, '/v', 'ProgId']);
            return out.includes(winProgId);
        }
        if (process.platform === 'linux') {
            const out = (await capture('xdg-settings', ['get', 'default-web-browser'])).trim();
            if (out) return out === desktopFile;
        }
        return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http');
    };

    const makeDefault = async () => {
        const args = protocolArgs();
        ['http', 'https'].forEach((protocol) => {
            try { app.setAsDefaultProtocolClient(protocol, ...args); } catch (err) {}
        });
        let openedSettings = false;
        if (process.platform === 'linux') {
            await run('xdg-settings', ['set', 'default-web-browser', desktopFile]);
            for (const mime of MIME_TYPES) await run('xdg-mime', ['default', desktopFile, mime]);
        } else if (process.platform === 'win32') {
            try {
                await shell.openExternal('ms-settings:defaultapps');
                openedSettings = true;
            } catch (err) {}
        }
        return { isDefault: await checkDefault(), openedSettings, platform: process.platform };
    };

    ipcMain.handle('anka-is-default-browser', async () => ({ isDefault: await checkDefault(), platform: process.platform }));
    ipcMain.handle('anka-set-default-browser', () => makeDefault());

    pending.push(...pickTargets(process.argv));

    return { primary: true, deliver, checkDefault, makeDefault };
}

module.exports = { setupDefaultBrowser, pickTargets };