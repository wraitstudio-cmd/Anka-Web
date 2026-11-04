const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { once } = require('events');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const electronCacheDir = path.join(distDir, '.linux-electron-cache');
let outDir = distDir;
let linuxUnpacked = path.join(distDir, 'linux-unpacked');
let tmpRoot = path.join(distDir, '.linux-pkg-tmp');
const isWin = process.platform === 'win32';
const epoch = Number(process.env.SOURCE_DATE_EPOCH) || Math.floor(Date.now() / 1000);
const startedAt = Date.now();

const GZIP_LEVEL = Math.min(9, Math.max(1, Number(process.env.GZIP_LEVEL) || 9));
const SQ_BLOCK = 131072;
const SQ_META = 8192;
const SQ_INVALID = 0xFFFFFFFFFFFFFFFFn;
const APPIMAGE_RUNTIME_URLS = [
    'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64',
    'https://github.com/AppImage/AppImageKit/releases/download/continuous/runtime-x86_64',
    'https://github.com/AppImage/AppImageKit/releases/download/13/runtime-x86_64'
];
const KEEP_LOCALES = new Set(
    (process.env.KEEP_LOCALES || 'en-US.pak,tr.pak')
        .split(',').map(s => s.trim()).filter(Boolean).concat('en-US.pak')
);
const MAX_CONCURRENT = Math.max(1, Math.min(8, Number(process.env.MAX_CONCURRENT) || 4));
const DOWNLOAD_RETRIES = Math.max(1, Number(process.env.DOWNLOAD_RETRIES) || 3);
const BINARY_NAME_OVERRIDE = String(process.env.BINARY_NAME || '').trim();
const ELECTRON_VERSION_OVERRIDE = String(process.env.ELECTRON_VERSION || '').trim().replace(/^v/, '');
const SKIP_SWIFTSHADER = process.env.SKIP_SWIFTSHADER !== '0';
const USE_XZ = process.env.NO_XZ !== '1';
const MAX_ASAR_SIZE = 300 * 1024 * 1024;
const MAX_OUTPUT_WARN = 400 * 1024 * 1024;
const FALLBACK_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

function log(...args) {
    console.log(`[+${((Date.now() - startedAt) / 1000).toFixed(1)}s]`, ...args);
}

function logError(...args) {
    console.error(`[+${((Date.now() - startedAt) / 1000).toFixed(1)}s]`, ...args);
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function quoteCmd(file) {
    return isWin ? `"${file}"` : file;
}

function runCommand(cmd, args, cwd, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd,
            stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
            shell: opts.shell !== undefined ? opts.shell : isWin,
            env: { ...process.env, ...(opts.env || {}) }
        });
        let stdout = '';
        let stderr = '';
        if (child.stdout) child.stdout.on('data', chunk => { stdout += chunk; });
        if (child.stderr) child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) return resolve({ stdout, stderr });
            const error = new Error(`${path.basename(String(cmd))} ${args.join(' ')} başarısız (kod ${code})${stderr ? ': ' + stderr.trim().slice(0, 400) : ''}`);
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
        });
    });
}

async function copyDirectory(src, dest, filter) {
    await fsp.mkdir(dest, { recursive: true });
    const items = await fsp.readdir(src, { withFileTypes: true });
    for (const item of items) {
        if (filter && !filter(item.name)) continue;
        const s = path.join(src, item.name);
        const d = path.join(dest, item.name);
        if (item.isSymbolicLink()) {
            const link = await fsp.readlink(s);
            await fsp.rm(d, { force: true, recursive: true });
            await fsp.symlink(link, d);
        } else if (item.isDirectory()) {
            await copyDirectory(s, d, filter);
        } else if (item.isFile()) {
            await fsp.copyFile(s, d);
        }
    }
}

async function flattenSingleDir(dir) {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    if (items.length === 1 && items[0].isDirectory()) {
        const inner = path.join(dir, items[0].name);
        for (const name of await fsp.readdir(inner)) {
            await fsp.rename(path.join(inner, name), path.join(dir, name));
        }
        await fsp.rm(inner, { recursive: true, force: true });
    }
}

async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    const workers = [];
    for (let i = 0; i < Math.min(limit, tasks.length); i++) {
        workers.push((async () => {
            for (;;) {
                const idx = next++;
                if (idx >= tasks.length) return;
                try {
                    results[idx] = { ok: true, value: await tasks[idx]() };
                } catch (error) {
                    results[idx] = { ok: false, error };
                }
            }
        })());
    }
    await Promise.all(workers);
    return results;
}

function normalizeMode(mode, isDir) {
    return ((mode | (isDir ? 0o555 : 0o444)) & ~0o022) & 0o7777;
}

function pngSize(file) {
    let fd = null;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(24);
        fs.readSync(fd, head, 0, 24, 0);
        if (head.readUInt32BE(0) !== 0x89504e47) return null;
        return [head.readUInt32BE(16), head.readUInt32BE(20)];
    } catch (_) {
        return null;
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }
}

function iconSizeName(file) {
    const dims = pngSize(file);
    if (!dims) return '256x256';
    const side = Math.max(dims[0], dims[1]);
    const best = [16, 22, 24, 32, 48, 64, 128, 256, 512].reduce((a, b) => Math.abs(b - side) < Math.abs(a - side) ? b : a);
    return `${best}x${best}`;
}

function findLogo(cfg) {
    const list = [];
    if (cfg.linuxConfig.icon) list.push(path.resolve(rootDir, String(cfg.linuxConfig.icon)));
    for (const parts of [
        ['icons', 'dark-logo.png'], ['icons', 'icon.png'], ['icons', 'logo.png'],
        ['src', 'icons', 'dark-logo.png'], ['src', 'icons', 'icon.png'],
        ['build', 'icon.png'], ['build', 'icons', '512x512.png'], ['build', 'icons', '256x256.png'],
        ['icon.png']
    ]) list.push(path.join(rootDir, ...parts));
    return list.find(p => p.toLowerCase().endsWith('.png') && fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

async function loadIcons(cfg) {
    const found = [];
    const hicolor = path.join(rootDir, 'icons', 'hicolor');
    if (fs.existsSync(hicolor)) {
        for (const size of fs.readdirSync(hicolor).sort()) {
            if (!/^\d+x\d+$/.test(size)) continue;
            const appsDir = path.join(hicolor, size, 'apps');
            if (!fs.existsSync(appsDir)) continue;
            const png = fs.readdirSync(appsDir).find(f => f.endsWith('.png'));
            if (png) found.push({ size, path: path.join(appsDir, png) });
        }
    }
    if (found.length === 0) {
        const single = findLogo(cfg);
        if (single) found.push({ size: iconSizeName(single), path: single });
    }
    const icons = [];
    for (const icon of found) icons.push({ size: icon.size, data: await fsp.readFile(icon.path) });
    if (icons.length === 0) icons.push({ size: '256x256', data: FALLBACK_PNG });
    icons.sort((a, b) => parseInt(a.size, 10) - parseInt(b.size, 10));
    return icons;
}

async function isElf(file) {
    let handle = null;
    try {
        handle = await fsp.open(file, 'r');
        const head = Buffer.alloc(4);
        const { bytesRead } = await handle.read(head, 0, 4, 0);
        return bytesRead === 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
    } catch (_) {
        return false;
    } finally {
        if (handle) await handle.close().catch(() => {});
    }
}

async function isValidLinuxDir(dir, executableName) {
    let names;
    try { names = await fsp.readdir(dir); } catch (_) { return false; }
    if (names.length === 0 || names.some(n => n.toLowerCase().endsWith('.exe'))) return false;
    const preferred = [executableName, 'electron'].filter(n => names.includes(n));
    const others = names.filter(n => !n.includes('.') && !preferred.includes(n) && n !== 'chrome-sandbox' && n !== 'chrome_crashpad_handler');
    for (const name of preferred.concat(others)) {
        if (await isElf(path.join(dir, name))) return true;
    }
    return false;
}

async function findExistingLinuxUnpacked(cfg) {
    const candidates = [path.join(outDir, 'linux-unpacked'), path.join(distDir, 'linux-unpacked')];
    for (const candidate of candidates) {
        if (await isValidLinuxDir(candidate, cfg.executableName)) {
            log(`linux-unpacked bulundu: ${path.relative(rootDir, candidate)}`);
            return candidate;
        }
    }
    return null;
}

async function detectElectronVersion() {
    if (ELECTRON_VERSION_OVERRIDE) return ELECTRON_VERSION_OVERRIDE;
    const readJson = async file => {
        try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (_) { return null; }
    };
    const installed = await readJson(path.join(rootDir, 'node_modules', 'electron', 'package.json'));
    if (installed && installed.version) return String(installed.version).replace(/^v/, '');
    try {
        const v = (await fsp.readFile(path.join(rootDir, 'node_modules', 'electron', 'dist', 'version'), 'utf8')).trim();
        if (v) return v.replace(/^v/, '');
    } catch (_) {}
    const rootPkg = await readJson(path.join(rootDir, 'package.json'));
    if (rootPkg) {
        const dep = (rootPkg.devDependencies && rootPkg.devDependencies.electron) || (rootPkg.dependencies && rootPkg.dependencies.electron);
        const match = dep && String(dep).match(/\d+\.\d+\.\d+/);
        if (match) return match[0];
    }
    return null;
}

function downloadOnce(url, dest, redirects) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? https : http;
        const req = lib.get(url, { headers: { 'User-Agent': 'anka-web-packager' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error('Çok fazla yönlendirme'));
                return resolve(downloadOnce(new URL(res.headers.location, url).toString(), dest, redirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            pipeline(res, fs.createWriteStream(dest)).then(resolve, reject);
        });
        req.setTimeout(30000, () => req.destroy(new Error('Zaman aşımı')));
        req.on('error', reject);
    });
}

async function download(urls, dest) {
    const list = Array.isArray(urls) ? urls : [urls];
    const partial = `${dest}.part`;
    let lastError = null;
    for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
        for (const url of list) {
            try {
                await downloadOnce(url, partial, 6);
                await fsp.rm(dest, { force: true });
                await fsp.rename(partial, dest);
                return;
            } catch (e) {
                lastError = e;
                logError(`İndirme denemesi başarısız (${url}): ${e.message}`);
                await fsp.rm(partial, { force: true }).catch(() => {});
                await sleep(Math.min(5000, 500 * attempt));
            }
        }
    }
    throw lastError || new Error('İndirme başarısız');
}

async function extractZip(zipFile, destDir) {
    await fsp.mkdir(destDir, { recursive: true });
    const errors = [];
    const attempts = [
        ['tar', ['-xf', zipFile, '-C', destDir]],
        ['unzip', ['-q', '-o', zipFile, '-d', destDir]]
    ];
    if (isWin) {
        const esc = s => String(s).replace(/'/g, "''");
        attempts.push(['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
            `Expand-Archive -LiteralPath '${esc(zipFile)}' -DestinationPath '${esc(destDir)}' -Force`]]);
    }
    for (const [cmd, args] of attempts) {
        try {
            await runCommand(cmd, args, rootDir, { shell: false });
            return;
        } catch (e) {
            errors.push(`${cmd}: ${e.message}`);
        }
    }
    throw new Error(`Zip arşivi açılamadı: ${errors.join(' | ')}`);
}

async function directorySize(dir) {
    let total = 0;
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, item.name);
        if (item.isDirectory()) total += await directorySize(p);
        else if (item.isFile()) total += (await fsp.stat(p)).size;
    }
    return total;
}

async function cleanupBadAsar(dir) {
    const asarPath = path.join(dir, 'resources', 'app.asar');
    if (!fs.existsSync(asarPath)) return;
    const st = await fsp.stat(asarPath);
    if (st.size > MAX_ASAR_SIZE) {
        logError(`app.asar çok büyük (${formatSize(st.size)} > ${formatSize(MAX_ASAR_SIZE)}), siliniyor`);
        await fsp.rm(asarPath, { force: true });
    }
}

async function findAsarSource() {
    const candidates = [
        path.join(linuxUnpacked, 'resources', 'app.asar'),
        path.join(outDir, 'win-unpacked', 'resources', 'app.asar'),
        path.join(distDir, 'win-unpacked', 'resources', 'app.asar'),
        path.join(distDir, 'linux-unpacked', 'resources', 'app.asar')
    ];
    for (const c of candidates) {
        if (!fs.existsSync(c)) continue;
        const st = await fsp.stat(c);
        if (st.size > MAX_ASAR_SIZE) {
            logError(`Uyarı: ${path.relative(rootDir, c)} çok büyük (${formatSize(st.size)}), atlanıyor`);
            continue;
        }
        return c;
    }
    return null;
}

function skipModuleJunk(name) {
    if (/\.(md|map|ts|tsx|markdown)$/i.test(name)) return false;
    return !['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github'].includes(name);
}

async function copyProdModules(staging) {
    const modulesRoot = path.join(rootDir, 'node_modules');
    if (!fs.existsSync(modulesRoot)) return;
    let listed = '';
    try {
        listed = (await runCommand('npm', ['ls', '--omit=dev', '--all', '--parseable'], rootDir, { shell: isWin })).stdout;
    } catch (e) {
        listed = e.stdout || '';
    }
    const roots = listed.split(/\r?\n/).map(s => s.trim()).filter(p => p.startsWith(modulesRoot + path.sep)).sort();
    const copied = [];
    for (const dir of roots) {
        if (copied.some(c => dir.startsWith(c + path.sep))) continue;
        copied.push(dir);
        await copyDirectory(dir, path.join(staging, path.relative(rootDir, dir)), skipModuleJunk);
    }
    log(`Üretim bağımlılıkları: ${copied.length} paket`);
}

async function buildAsarFromFiles(cfg, asarBin, targetAsar) {
    const filesConfig = (cfg.buildConfig && cfg.buildConfig.files) || ['src/**/*', 'icons/**/*', 'package.json'];
    const staging = path.join(tmpRoot, 'asar-staging');
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { recursive: true });
    const seen = new Set();
    for (const pattern of filesConfig) {
        const text = String(pattern);
        if (text.startsWith('!')) continue;
        const base = text.split('/')[0].replace(/\*.*$/, '');
        if (!base || seen.has(base)) continue;
        seen.add(base);
        const src = path.join(rootDir, base);
        if (!fs.existsSync(src)) continue;
        const st = await fsp.stat(src);
        const dst = path.join(staging, base);
        if (st.isDirectory()) await copyDirectory(src, dst, name => !/\.(map|md|ts)$/i.test(name) && name !== '.git');
        else if (st.isFile()) {
            await fsp.mkdir(path.dirname(dst), { recursive: true });
            await fsp.copyFile(src, dst);
        }
    }
    if (!fs.existsSync(path.join(staging, 'package.json'))) {
        await fsp.copyFile(path.join(rootDir, 'package.json'), path.join(staging, 'package.json'));
    }
    await copyProdModules(staging);
    const total = await directorySize(staging);
    if (total === 0) throw new Error('asar için staging boş');
    log(`asar staging: ${formatSize(total)}`);
    await runCommand(quoteCmd(asarBin), ['pack', quoteCmd(staging), quoteCmd(targetAsar)], rootDir, { inherit: true });
    await fsp.rm(staging, { recursive: true, force: true });
}

async function prepareElectronResources(cfg) {
    const electronBin = path.join(linuxUnpacked, 'electron');
    const targetBin = path.join(linuxUnpacked, cfg.executableName);
    if (electronBin !== targetBin && fs.existsSync(electronBin)) {
        await fsp.rm(targetBin, { force: true });
        await fsp.rename(electronBin, targetBin);
        log(`electron -> ${cfg.executableName} olarak yeniden adlandırıldı`);
    }
    if (fs.existsSync(targetBin)) await fsp.chmod(targetBin, 0o755).catch(() => {});
    const sandbox = path.join(linuxUnpacked, 'chrome-sandbox');
    if (fs.existsSync(sandbox)) await fsp.chmod(sandbox, 0o755).catch(() => {});

    const resourcesDir = path.join(linuxUnpacked, 'resources');
    await fsp.mkdir(resourcesDir, { recursive: true });
    const asarPath = path.join(resourcesDir, 'app.asar');
    await cleanupBadAsar(linuxUnpacked);

    if (!fs.existsSync(asarPath) && !fs.existsSync(path.join(resourcesDir, 'app'))) {
        const source = await findAsarSource();
        if (source) {
            await fsp.copyFile(source, asarPath);
            log(`app.asar kopyalandı: ${path.relative(rootDir, source)}`);
        } else {
            const asarBin = path.join(rootDir, 'node_modules', '.bin', isWin ? 'asar.cmd' : 'asar');
            if (!fs.existsSync(asarBin)) {
                throw new Error('asar paketleyici bulunamadı (node_modules/.bin/asar). electron-builder --linux dir çalıştırın veya app.asar sağlayın.');
            }
            if (fs.existsSync(path.join(rootDir, 'app'))) {
                log('rootDir/app hedefli asar pack...');
                await runCommand(quoteCmd(asarBin), ['pack', quoteCmd(path.join(rootDir, 'app')), quoteCmd(asarPath)], rootDir, { inherit: true });
            } else {
                log('package.json build.files listesinden asar üretiliyor...');
                await buildAsarFromFiles(cfg, asarBin, asarPath);
            }
        }
    }

    if (fs.existsSync(asarPath)) {
        const size = (await fsp.stat(asarPath)).size;
        if (size > MAX_ASAR_SIZE) throw new Error(`app.asar çok büyük: ${formatSize(size)}. package.json "build.files" alanını kontrol edin.`);
        log(`app.asar hazır: ${formatSize(size)}`);
    } else if (!fs.existsSync(path.join(resourcesDir, 'app'))) {
        throw new Error('app.asar üretilemedi');
    }
    await fsp.rm(path.join(resourcesDir, 'default_app.asar'), { force: true });
}

async function downloadLinuxElectron(cfg) {
    const version = await detectElectronVersion();
    if (!version) throw new Error('Electron sürümü tespit edilemedi. ELECTRON_VERSION ortam değişkeni ile belirtin.');
    await fsp.mkdir(electronCacheDir, { recursive: true });
    const zipName = `electron-v${version}-linux-x64.zip`;
    const zipFile = path.join(electronCacheDir, zipName);
    const url = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`;

    if (!fs.existsSync(zipFile) || (await fsp.stat(zipFile)).size < 1024) {
        log(`Linux Electron v${version} indiriliyor...`);
        await download([url], zipFile);
        log(`İndirildi: ${formatSize((await fsp.stat(zipFile)).size)}`);
    } else {
        log(`Önbellekteki Linux Electron kullanılıyor (v${version})`);
    }

    const extractDir = path.join(electronCacheDir, `extract-${Date.now()}`);
    log('Linux Electron arşivi çıkartılıyor...');
    try {
        await extractZip(zipFile, extractDir);
        await flattenSingleDir(extractDir);
        const electronBin = path.join(extractDir, 'electron');
        if (!fs.existsSync(electronBin) || !(await isElf(electronBin))) {
            throw new Error('Çıkartılan arşivde geçerli electron ELF binary bulunamadı');
        }
        await fsp.rm(linuxUnpacked, { recursive: true, force: true });
        await copyDirectory(extractDir, linuxUnpacked);
        await prepareElectronResources(cfg);
        log('linux-unpacked Linux Electron ile oluşturuldu');
    } finally {
        await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function ensureLinuxUnpacked(cfg) {
    if (fs.existsSync(linuxUnpacked)) {
        log('linux-unpacked geçersiz, siliniyor...');
        await fsp.rm(linuxUnpacked, { recursive: true, force: true });
    }
    await fsp.mkdir(outDir, { recursive: true });

    const builderBin = path.join(rootDir, 'node_modules', '.bin', isWin ? 'electron-builder.cmd' : 'electron-builder');
    if (fs.existsSync(builderBin)) {
        log('electron-builder --linux dir çalıştırılıyor...');
        try {
            await runCommand(quoteCmd(builderBin), ['--linux', 'dir', '--x64', '--publish', 'never'], rootDir, { inherit: true });
            const found = await findExistingLinuxUnpacked(cfg);
            if (found) {
                linuxUnpacked = found;
                await prepareElectronResources(cfg);
                log('linux-unpacked electron-builder ile oluşturuldu');
                return;
            }
            log('electron-builder çıktısı bulunamadı, alternatif yöntem denenecek...');
        } catch (e) {
            logError(`electron-builder başarısız: ${e.message}`);
        }
        linuxUnpacked = path.join(outDir, 'linux-unpacked');
        await fsp.rm(linuxUnpacked, { recursive: true, force: true }).catch(() => {});
    }

    const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
    const electronElf = path.join(electronDist, 'electron');
    if (fs.existsSync(electronElf) && !fs.existsSync(path.join(electronDist, 'electron.exe')) && await isElf(electronElf)) {
        log('node_modules/electron/dist (Linux) kopyalanıyor...');
        await copyDirectory(electronDist, linuxUnpacked);
        await prepareElectronResources(cfg);
        return;
    }
    await downloadLinuxElectron(cfg);
}

function windowsFileMode(name, binaryName) {
    if (name === binaryName || name === 'chrome-sandbox' || name === 'chrome_crashpad_handler' || name.endsWith('.sh')) return 0o755;
    return 0o644;
}

function shouldSkip(relPath) {
    const parts = relPath.split('/');
    const name = parts[parts.length - 1];
    if (parts.length === 2 && parts[0] === 'locales') return !KEEP_LOCALES.has(name);
    if (/\.(map|pdb|dSYM)$/.test(name)) return true;
    if (name === 'LICENSES.chromium.html' || name === 'default_app.asar' || name === '.DS_Store' || name === 'Thumbs.db') return true;
    if (parts.includes('.git')) return true;
    if (SKIP_SWIFTSHADER && (name.startsWith('libvk_swiftshader') || name.startsWith('vk_swiftshader') || parts.includes('swiftshader'))) return true;
    return false;
}

async function walkTree(base, binaryName, rel = '') {
    const list = [];
    const names = (await fsp.readdir(path.join(base, rel))).sort();
    for (const name of names) {
        const relPath = rel ? `${rel}/${name}` : name;
        if (shouldSkip(relPath)) continue;
        const abs = path.join(base, relPath);
        const st = await fsp.lstat(abs);
        if (st.isSymbolicLink()) {
            list.push({ kind: 'symlink', rel: relPath, link: (await fsp.readlink(abs)).replace(/\\/g, '/'), mode: 0o777 });
        } else if (st.isDirectory()) {
            list.push({ kind: 'dir', rel: relPath, mode: isWin ? 0o755 : normalizeMode(st.mode, true) });
            for (const child of await walkTree(base, binaryName, relPath)) list.push(child);
        } else if (st.isFile()) {
            list.push({
                kind: 'file',
                rel: relPath,
                abs,
                size: st.size,
                mode: isWin ? windowsFileMode(name, binaryName) : normalizeMode(st.mode, false)
            });
        }
    }
    return list;
}

function mapTree(tree, prefix, overrides = {}) {
    return tree.map(item => ({
        ...item,
        name: `${prefix}/${item.rel}`,
        mode: overrides[item.rel] !== undefined ? overrides[item.rel] : item.mode
    }));
}

function entrySize(entry) {
    if (entry.kind === 'file') return entry.content ? entry.content.length : entry.size;
    if (entry.kind === 'symlink') return Buffer.byteLength(entry.link);
    return 0;
}

function writeOctal(buffer, value, offset, length) {
    buffer.write(Math.floor(value).toString(8).padStart(length - 1, '0') + '\0', offset, 'latin1');
}

function buildTarHeader({ name, mode, size, type, link }) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    writeOctal(header, mode & 0o7777, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, size, 124, 12);
    writeOctal(header, epoch, 136, 12);
    header.fill(0x20, 148, 156);
    header.write(type, 156, 1, 'latin1');
    if (link) header.write(link, 157, 100, 'utf8');
    header.write('ustar  \0', 257, 8, 'latin1');
    header.write('root', 265, 32, 'utf8');
    header.write('root', 297, 32, 'utf8');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    return header;
}

class Sink {
    constructor(file, gzip) {
        this.raw = 0;
        this.out = fs.createWriteStream(file);
        if (gzip) {
            this.head = zlib.createGzip({ level: GZIP_LEVEL });
            this.done = pipeline(this.head, this.out);
        } else {
            this.head = this.out;
            this.done = new Promise((resolve, reject) => {
                this.out.on('finish', resolve);
                this.out.on('error', reject);
            });
        }
        this.done.catch(() => {});
    }
    async push(buffer) {
        this.raw += buffer.length;
        if (!this.head.write(buffer)) await once(this.head, 'drain');
    }
    async pad(size, unit = 512) {
        const rest = size % unit;
        if (rest) await this.push(Buffer.alloc(unit - rest));
    }
    async close() {
        this.head.end();
        await this.done;
    }
    abort() {
        this.head.destroy();
        this.out.destroy();
    }
}

async function pushFile(sink, abs, size) {
    let written = 0;
    for await (const chunk of fs.createReadStream(abs)) {
        written += chunk.length;
        await sink.push(chunk);
    }
    if (written !== size) throw new Error(`Dosya okunurken boyut değişti: ${abs}`);
}

class Tar {
    constructor(sink) { this.sink = sink; }
    async longEntry(type, text) {
        const data = Buffer.from(text + '\0', 'utf8');
        await this.sink.push(buildTarHeader({ name: '././@LongLink', mode: 0o644, size: data.length, type }));
        await this.sink.push(data);
        await this.sink.pad(data.length);
    }
    async add(entry) {
        let name = entry.name;
        if (entry.kind === 'dir' && !name.endsWith('/')) name += '/';
        if (Buffer.byteLength(name) > 100) await this.longEntry('L', name);
        if (entry.kind === 'symlink' && Buffer.byteLength(entry.link) > 100) await this.longEntry('K', entry.link);
        const type = entry.kind === 'dir' ? '5' : entry.kind === 'symlink' ? '2' : '0';
        const size = entry.kind === 'file' ? entrySize(entry) : 0;
        await this.sink.push(buildTarHeader({ name, mode: entry.mode, size, type, link: entry.link }));
        if (entry.kind !== 'file') return;
        if (entry.content) await this.sink.push(entry.content);
        else await pushFile(this.sink, entry.abs, size);
        await this.sink.pad(size);
    }
    async end() {
        await this.sink.push(Buffer.alloc(1024));
        await this.sink.close();
    }
}

async function tarTo(file, entries, gzip) {
    const sink = new Sink(file, gzip);
    const tar = new Tar(sink);
    try {
        for (const entry of entries) await tar.add(entry);
        await tar.end();
    } catch (e) {
        sink.abort();
        throw e;
    }
}

let xzState = null;
async function hasXz() {
    if (!USE_XZ) return false;
    if (xzState === null) {
        try {
            await runCommand('xz', ['--version'], rootDir, { shell: false });
            xzState = true;
        } catch (_) {
            xzState = false;
        }
    }
    return xzState;
}

async function xzFile(src, dest) {
    const out = fs.createWriteStream(dest);
    const child = spawn('xz', ['-9e', '-T0', '-c', src], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    const exited = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`xz başarısız (kod ${code}): ${err.trim().slice(0, 300)}`)));
    });
    exited.catch(() => {});
    await Promise.all([pipeline(child.stdout, out), exited]);
}

async function compressedTar(work, name, entries, xz) {
    if (xz) {
        const raw = path.join(work, `${name}.tar`);
        const out = path.join(work, `${name}.tar.xz`);
        try {
            await tarTo(raw, entries, false);
            await xzFile(raw, out);
            return { file: out, ext: 'xz' };
        } catch (e) {
            logError(`xz başarısız, gzip kullanılacak: ${e.message}`);
            await fsp.rm(out, { force: true }).catch(() => {});
        } finally {
            await fsp.rm(raw, { force: true }).catch(() => {});
        }
    }
    const out = path.join(work, `${name}.tar.gz`);
    await tarTo(out, entries, true);
    return { file: out, ext: 'gz' };
}

async function writeAr(file, members) {
    const out = fs.createWriteStream(file);
    const failed = new Promise((_, reject) => out.on('error', reject));
    failed.catch(() => {});
    const write = async buffer => {
        if (!out.write(buffer)) await once(out, 'drain');
    };
    try {
        await write(Buffer.from('!<arch>\n', 'latin1'));
        for (const member of members) {
            const size = member.buffer ? member.buffer.length : (await fsp.stat(member.file)).size;
            const header = Buffer.alloc(60, 0x20);
            header.write(member.name, 0, 16, 'latin1');
            header.write(String(epoch), 16, 12, 'latin1');
            header.write('0', 28, 6, 'latin1');
            header.write('0', 34, 6, 'latin1');
            header.write('100644', 40, 8, 'latin1');
            header.write(String(size), 48, 10, 'latin1');
            header.write('`\n', 58, 2, 'latin1');
            await write(header);
            if (member.buffer) await write(member.buffer);
            else for await (const chunk of fs.createReadStream(member.file)) await write(chunk);
            if (size % 2 === 1) await write(Buffer.from('\n', 'latin1'));
        }
    } catch (e) {
        out.destroy();
        throw e;
    }
    await Promise.race([new Promise(resolve => out.end(resolve)), failed]);
}

async function hashFile(file, algorithm) {
    const hash = crypto.createHash(algorithm);
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

function hashBuffer(buffer, algorithm) {
    return crypto.createHash(algorithm).update(buffer).digest('hex');
}

async function resolveBinary(executableName) {
    const names = await fsp.readdir(linuxUnpacked);
    const chosen = names.find(n => n === executableName) || names.find(n => n.toLowerCase() === String(executableName).toLowerCase());
    if (!chosen) {
        throw new Error(`Çalıştırılabilir dosya bulunamadı (${executableName}). linux-unpacked içeriği: ${names.slice(0, 15).join(', ')}`);
    }
    const full = path.join(linuxUnpacked, chosen);
    if (!(await isElf(full))) throw new Error(`Ana çalıştırılabilir dosya geçerli bir ELF değil: ${full}`);
    return chosen;
}

function desktopEntry(ctx, execLine) {
    return [
        '[Desktop Entry]',
        `Name=${ctx.appName}`,
        'GenericName=Web Browser',
        'GenericName[tr]=Web Tarayıcı',
        `Comment=${ctx.description}`,
        `Exec=${execLine} %U`,
        'Terminal=false',
        'Type=Application',
        `Icon=${ctx.slug}`,
        `StartupWMClass=${ctx.executableName}`,
        `Categories=${ctx.categories}`,
        `MimeType=${ctx.mimeTypes.join(';')};`,
        'Keywords=browser;web;internet;tarayıcı;',
        'StartupNotify=true',
        ''
    ].join('\n');
}

function sandboxLines(sandbox) {
    return [
        `SANDBOX="${sandbox}"`,
        'ns_ok=0',
        'if [ -f /proc/sys/user/max_user_namespaces ]; then',
        '    max_ns=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)',
        '    if [ "$max_ns" -gt 0 ] 2>/dev/null; then ns_ok=1; fi',
        'fi',
        'if [ "$ns_ok" = "0" ] && [ -f /proc/sys/kernel/unprivileged_userns_clone ]; then',
        '    clone_ok=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 0)',
        '    if [ "$clone_ok" = "1" ]; then ns_ok=1; fi',
        'fi',
        'if [ "$ns_ok" = "1" ]; then chmod 0755 "$SANDBOX" 2>/dev/null || true; else chmod 4755 "$SANDBOX" 2>/dev/null || true; fi'
    ];
}

const refreshLines = [
    'command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications 2>/dev/null || true',
    'command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true'
];

function appRunScript(binaryName) {
    return [
        '#!/bin/sh',
        'SELF="$(readlink -f "$0")"',
        'HERE="$(dirname "$SELF")"',
        'export APPDIR="$HERE"',
        'export PATH="$HERE/usr/bin:$HERE/usr/sbin:$PATH"',
        `BIN="$HERE/usr/bin/${binaryName}"`,
        'if [ ! -x "$BIN" ]; then',
        '    echo "Hata: çalıştırılabilir dosya bulunamadı: $BIN" >&2',
        '    exit 127',
        'fi',
        'ns_ok=0',
        'if [ -f /proc/sys/user/max_user_namespaces ]; then',
        '    max_ns=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)',
        '    if [ "$max_ns" -gt 0 ] 2>/dev/null; then ns_ok=1; fi',
        'fi',
        'if [ "$ns_ok" = "0" ] && [ -f /proc/sys/kernel/unprivileged_userns_clone ]; then',
        '    clone_ok=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 0)',
        '    if [ "$clone_ok" = "1" ]; then ns_ok=1; fi',
        'fi',
        'if [ "$ns_ok" = "1" ]; then',
        '    exec "$BIN" "$@"',
        'fi',
        'exec "$BIN" --no-sandbox "$@"',
        ''
    ].join('\n');
}

function debPostinst(ctx, installDir) {
    return [
        '#!/bin/sh',
        'set -e',
        ...sandboxLines(`/${installDir}/chrome-sandbox`),
        'if command -v update-alternatives >/dev/null 2>&1; then',
        `    update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/bin/${ctx.slug} 40 >/dev/null 2>&1 || true`,
        'fi',
        ...refreshLines,
        'exit 0',
        ''
    ].join('\n');
}

function debPrerm(ctx) {
    return [
        '#!/bin/sh',
        'set -e',
        'if [ "$1" = "remove" ] || [ "$1" = "deconfigure" ]; then',
        '    if command -v update-alternatives >/dev/null 2>&1; then',
        `        update-alternatives --remove x-www-browser /usr/bin/${ctx.slug} >/dev/null 2>&1 || true`,
        '    fi',
        'fi',
        'exit 0',
        ''
    ].join('\n');
}

function debPostrm() {
    return ['#!/bin/sh', 'set -e', ...refreshLines, 'exit 0', ''].join('\n');
}

function rpmPost(installDir) {
    return [...sandboxLines(`${installDir}/chrome-sandbox`), ...refreshLines, 'exit 0', ''].join('\n');
}

function rpmPostun() {
    return [...refreshLines, 'exit 0', ''].join('\n');
}

async function commitFile(partial, final) {
    const st = await fsp.stat(partial);
    if (!st.isFile() || st.size === 0) throw new Error('Üretilen dosya boş');
    await fsp.rm(final, { force: true });
    await fsp.rename(partial, final);
    return { file: final, size: st.size };
}

async function appendFileTo(target, source) {
    await pipeline(fs.createReadStream(source), fs.createWriteStream(target, { flags: 'a' }));
}

class MetaStream {
    constructor() { this.chunks = []; this.length = 0; }
    ref() { return { block: Math.floor(this.length / SQ_META) * (SQ_META + 2), offset: this.length % SQ_META }; }
    write(buffer) { this.chunks.push(buffer); this.length += buffer.length; }
    finish() {
        const all = Buffer.concat(this.chunks);
        const parts = [];
        for (let pos = 0; pos < all.length; pos += SQ_META) {
            const part = all.subarray(pos, pos + SQ_META);
            const head = Buffer.alloc(2);
            head.writeUInt16LE(part.length | 0x8000, 0);
            parts.push(head, part);
        }
        return Buffer.concat(parts);
    }
}

function buildSquashTree(entries) {
    const root = { kind: 'dir', mode: 0o755, children: new Map() };
    const ensureDir = parts => {
        let node = root;
        for (const part of parts) {
            let next = node.children.get(part);
            if (!next) {
                next = { kind: 'dir', mode: 0o755, children: new Map() };
                node.children.set(part, next);
            }
            node = next;
        }
        return node;
    };
    for (const entry of entries) {
        const parts = entry.name.split('/').filter(Boolean);
        const leaf = parts.pop();
        if (entry.kind === 'dir') ensureDir(parts.concat(leaf)).mode = entry.mode;
        else ensureDir(parts).children.set(leaf, { ...entry });
    }
    return root;
}

function squashInodeHeader(type, mode, number) {
    const header = Buffer.alloc(16);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(mode & 0o7777, 2);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt32LE(epoch, 8);
    header.writeUInt32LE(number, 12);
    return header;
}

function squashDirListing(listed) {
    const headers = [];
    let current = null;
    for (const item of listed) {
        const delta = current ? item.number - current.number : 0;
        if (!current || current.block !== item.ref.block || current.items.length === 256 || delta < -32768 || delta > 32767) {
            current = { block: item.ref.block, number: item.number, items: [] };
            headers.push(current);
        }
        current.items.push(item);
    }
    const parts = [];
    for (const header of headers) {
        const head = Buffer.alloc(12);
        head.writeUInt32LE(header.items.length - 1, 0);
        head.writeUInt32LE(header.block, 4);
        head.writeUInt32LE(header.number, 8);
        parts.push(head);
        for (const item of header.items) {
            const entry = Buffer.alloc(8);
            entry.writeUInt16LE(item.ref.offset, 0);
            entry.writeInt16LE(item.number - header.number, 2);
            entry.writeUInt16LE(item.type, 4);
            entry.writeUInt16LE(item.name.length - 1, 6);
            parts.push(entry, item.name);
        }
    }
    return Buffer.concat(parts);
}

async function writeSquashfs(file, entries) {
    const root = buildSquashTree(entries);
    let counter = 0;
    const assign = node => {
        node.number = ++counter;
        if (node.kind === 'dir') for (const child of node.children.values()) assign(child);
    };
    assign(root);
    const inodeCount = counter;

    const handle = await fsp.open(file, 'w+');
    try {
        let position = 0;
        const put = async buffer => {
            let written = 0;
            while (written < buffer.length) {
                const { bytesWritten } = await handle.write(buffer, written, buffer.length - written, position + written);
                written += bytesWritten;
            }
            position += buffer.length;
        };

        await put(Buffer.alloc(96));
        const inodeStream = new MetaStream();
        const dirStream = new MetaStream();

        const storeBlock = async (chunk, sizes) => {
            const packed = zlib.deflateSync(chunk, { level: GZIP_LEVEL });
            if (packed.length < chunk.length) {
                sizes.push(packed.length);
                await put(packed);
            } else {
                sizes.push(chunk.length | 0x1000000);
                await put(Buffer.from(chunk));
            }
        };

        const storeData = async node => {
            const start = position;
            const sizes = [];
            const size = entrySize(node);
            if (node.content) {
                for (let pos = 0; pos < node.content.length; pos += SQ_BLOCK) {
                    await storeBlock(node.content.subarray(pos, pos + SQ_BLOCK), sizes);
                }
            } else if (size > 0) {
                const source = await fsp.open(node.abs, 'r');
                try {
                    const buffer = Buffer.alloc(SQ_BLOCK);
                    let total = 0;
                    for (;;) {
                        let filled = 0;
                        while (filled < SQ_BLOCK) {
                            const { bytesRead } = await source.read(buffer, filled, SQ_BLOCK - filled, null);
                            if (bytesRead === 0) break;
                            filled += bytesRead;
                        }
                        if (filled === 0) break;
                        total += filled;
                        await storeBlock(buffer.subarray(0, filled), sizes);
                        if (filled < SQ_BLOCK) break;
                    }
                    if (total !== size) throw new Error(`Dosya okunurken boyut değişti: ${node.abs}`);
                } finally {
                    await source.close();
                }
            }
            return { start: sizes.length ? start : 0, sizes };
        };

        const emit = async (node, parentNumber) => {
            if (node.kind === 'dir') {
                const kids = [...node.children.entries()]
                    .map(([name, child]) => ({ name: Buffer.from(name, 'utf8'), child }))
                    .sort((a, b) => Buffer.compare(a.name, b.name));
                const listed = [];
                let subdirs = 0;
                for (const kid of kids) {
                    if (kid.name.length > 255) throw new Error(`Dosya adı çok uzun: ${kid.name.toString('utf8')}`);
                    const result = await emit(kid.child, node.number);
                    if (kid.child.kind === 'dir') subdirs++;
                    listed.push({ name: kid.name, ...result });
                }
                const listing = squashDirListing(listed);
                const dirRef = dirStream.ref();
                dirStream.write(listing);
                const ref = inodeStream.ref();
                const fileSize = listing.length + 3;
                if (fileSize <= 0xFFFF) {
                    const body = Buffer.alloc(16);
                    body.writeUInt32LE(dirRef.block, 0);
                    body.writeUInt32LE(subdirs + 2, 4);
                    body.writeUInt16LE(fileSize, 8);
                    body.writeUInt16LE(dirRef.offset, 10);
                    body.writeUInt32LE(parentNumber, 12);
                    inodeStream.write(Buffer.concat([squashInodeHeader(1, node.mode, node.number), body]));
                } else {
                    const body = Buffer.alloc(24);
                    body.writeUInt32LE(subdirs + 2, 0);
                    body.writeUInt32LE(fileSize, 4);
                    body.writeUInt32LE(dirRef.block, 8);
                    body.writeUInt32LE(parentNumber, 12);
                    body.writeUInt16LE(0, 16);
                    body.writeUInt16LE(dirRef.offset, 18);
                    body.writeUInt32LE(0xFFFFFFFF, 20);
                    inodeStream.write(Buffer.concat([squashInodeHeader(8, node.mode, node.number), body]));
                }
                return { ref, type: 1, number: node.number };
            }
            if (node.kind === 'symlink') {
                const target = Buffer.from(node.link, 'utf8');
                const body = Buffer.alloc(8);
                body.writeUInt32LE(1, 0);
                body.writeUInt32LE(target.length, 4);
                const ref = inodeStream.ref();
                inodeStream.write(Buffer.concat([squashInodeHeader(3, 0o777, node.number), body, target]));
                return { ref, type: 3, number: node.number };
            }
            const size = entrySize(node);
            if (size > 0xFFFFFFFF) throw new Error(`Dosya çok büyük: ${node.name}`);
            const stored = await storeData(node);
            const body = Buffer.alloc(16 + 4 * stored.sizes.length);
            body.writeUInt32LE(stored.start, 0);
            body.writeUInt32LE(0xFFFFFFFF, 4);
            body.writeUInt32LE(0, 8);
            body.writeUInt32LE(size, 12);
            stored.sizes.forEach((value, index) => body.writeUInt32LE(value, 16 + 4 * index));
            const ref = inodeStream.ref();
            inodeStream.write(Buffer.concat([squashInodeHeader(2, node.mode, node.number), body]));
            return { ref, type: 2, number: node.number };
        };

        const rootResult = await emit(root, inodeCount + 1);
        const inodeStart = position;
        await put(inodeStream.finish());
        const dirStart = position;
        await put(dirStream.finish());
        const fragmentStart = position;

        const idBlockPosition = position;
        const idBlock = Buffer.alloc(6);
        idBlock.writeUInt16LE(4 | 0x8000, 0);
        idBlock.writeUInt32LE(0, 2);
        await put(idBlock);
        const idTableStart = position;
        const idPointer = Buffer.alloc(8);
        idPointer.writeBigUInt64LE(BigInt(idBlockPosition), 0);
        await put(idPointer);

        const bytesUsed = position;
        const padding = (4096 - (position % 4096)) % 4096;
        if (padding) await put(Buffer.alloc(padding));

        const superBlock = Buffer.alloc(96);
        superBlock.writeUInt32LE(0x73717368, 0);
        superBlock.writeUInt32LE(inodeCount, 4);
        superBlock.writeUInt32LE(epoch, 8);
        superBlock.writeUInt32LE(SQ_BLOCK, 12);
        superBlock.writeUInt32LE(0, 16);
        superBlock.writeUInt16LE(1, 20);
        superBlock.writeUInt16LE(17, 22);
        superBlock.writeUInt16LE(0x0001 | 0x0010 | 0x0200 | 0x0800, 24);
        superBlock.writeUInt16LE(1, 26);
        superBlock.writeUInt16LE(4, 28);
        superBlock.writeUInt16LE(0, 30);
        superBlock.writeBigUInt64LE((BigInt(rootResult.ref.block) << 16n) | BigInt(rootResult.ref.offset), 32);
        superBlock.writeBigUInt64LE(BigInt(bytesUsed), 40);
        superBlock.writeBigUInt64LE(BigInt(idTableStart), 48);
        superBlock.writeBigUInt64LE(SQ_INVALID, 56);
        superBlock.writeBigUInt64LE(BigInt(inodeStart), 64);
        superBlock.writeBigUInt64LE(BigInt(dirStart), 72);
        superBlock.writeBigUInt64LE(BigInt(fragmentStart), 80);
        superBlock.writeBigUInt64LE(SQ_INVALID, 88);
        await handle.write(superBlock, 0, 96, 0);
    } finally {
        await handle.close();
    }
}

async function resolveAppImageRuntime() {
    const custom = process.env.APPIMAGE_RUNTIME;
    if (custom && fs.existsSync(custom)) {
        if (!(await isElf(custom))) throw new Error('APPIMAGE_RUNTIME geçerli bir ELF dosyası değil');
        return custom;
    }
    const local = path.join(__dirname, 'appimage-runtime-x86_64');
    if (fs.existsSync(local) && await isElf(local)) return local;
    log('AppImage runtime indiriliyor...');
    const partial = `${local}.partial`;
    await fsp.rm(partial, { force: true });
    try {
        await download(APPIMAGE_RUNTIME_URLS, partial);
        if (!(await isElf(partial))) throw new Error('İndirilen runtime geçerli bir ELF dosyası değil');
        await fsp.rm(local, { force: true });
        await fsp.rename(partial, local);
    } catch (e) {
        await fsp.rm(partial, { force: true }).catch(() => {});
        throw new Error(`AppImage runtime alınamadı (${e.message}). APPIMAGE_RUNTIME ortam değişkeniyle yol verin.`);
    }
    return local;
}

function rpmString(tag, value) { return { tag, type: 6, count: 1, data: Buffer.from(`${value}\0`, 'utf8') }; }
function rpmI18n(tag, value) { return { tag, type: 9, count: 1, data: Buffer.from(`${value}\0`, 'utf8') }; }
function rpmStringArray(tag, values) { return { tag, type: 8, count: values.length, data: Buffer.concat(values.map(v => Buffer.from(`${v}\0`, 'utf8'))) }; }
function rpmInt16(tag, values) {
    const data = Buffer.alloc(values.length * 2);
    values.forEach((v, i) => data.writeUInt16BE(v & 0xFFFF, i * 2));
    return { tag, type: 3, count: values.length, data };
}
function rpmInt32(tag, values) {
    const data = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => data.writeUInt32BE(v >>> 0, i * 4));
    return { tag, type: 4, count: values.length, data };
}
function rpmBinary(tag, buffer) { return { tag, type: 7, count: buffer.length, data: buffer }; }

function buildRpmHeader(items, regionTag) {
    const sorted = items.slice().sort((a, b) => a.tag - b.tag);
    const alignment = { 3: 2, 4: 4, 5: 8 };
    const chunks = [];
    const index = [];
    let offset = 0;
    for (const item of sorted) {
        const unit = alignment[item.type] || 1;
        const pad = (unit - (offset % unit)) % unit;
        if (pad) {
            chunks.push(Buffer.alloc(pad));
            offset += pad;
        }
        index.push({ tag: item.tag, type: item.type, offset, count: item.count });
        chunks.push(item.data);
        offset += item.data.length;
    }
    const trailer = Buffer.alloc(16);
    trailer.writeUInt32BE(regionTag, 0);
    trailer.writeUInt32BE(7, 4);
    trailer.writeInt32BE(-(sorted.length + 1) * 16, 8);
    trailer.writeUInt32BE(16, 12);
    index.unshift({ tag: regionTag, type: 7, offset, count: 16 });
    chunks.push(trailer);
    offset += 16;

    const intro = Buffer.alloc(16);
    Buffer.from([0x8e, 0xad, 0xe8, 0x01, 0, 0, 0, 0]).copy(intro, 0);
    intro.writeUInt32BE(index.length, 8);
    intro.writeUInt32BE(offset, 12);
    const table = Buffer.alloc(index.length * 16);
    index.forEach((entry, i) => {
        table.writeUInt32BE(entry.tag, i * 16);
        table.writeUInt32BE(entry.type, i * 16 + 4);
        table.writeUInt32BE(entry.offset, i * 16 + 8);
        table.writeUInt32BE(entry.count, i * 16 + 12);
    });
    return Buffer.concat([intro, table, ...chunks]);
}

function cpioEntry(ino, mode, nlink, size, name) {
    const nameBuffer = Buffer.from(`${name}\0`, 'utf8');
    const fields = [ino, mode, 0, 0, nlink, epoch, size, 0, 0, 0, 0, nameBuffer.length, 0];
    const head = Buffer.from('070701' + fields.map(v => (v >>> 0).toString(16).padStart(8, '0')).join(''), 'latin1');
    const pad = Buffer.alloc((4 - ((head.length + nameBuffer.length) % 4)) % 4);
    return Buffer.concat([head, nameBuffer, pad]);
}

async function writeRpmPayload(file, items, fileModes, gzip) {
    const sink = new Sink(file, gzip);
    try {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await sink.push(cpioEntry(i + 1, fileModes[i], item.kind === 'dir' ? 2 : 1, item.size, `.${item.path}`));
            if (item.kind === 'symlink') await sink.push(Buffer.from(item.link, 'utf8'));
            else if (item.kind === 'file') {
                if (item.content) await sink.push(item.content);
                else await pushFile(sink, item.abs, item.size);
            }
            await sink.pad(item.size, 4);
        }
        await sink.push(cpioEntry(0, 0, 1, 0, 'TRAILER!!!'));
        await sink.close();
    } catch (e) {
        sink.abort();
        throw e;
    }
    return sink.raw;
}

async function buildTar(ctx) {
    log('tar arşivi oluşturuluyor...');
    const work = path.join(tmpRoot, 'tar');
    await fsp.mkdir(work, { recursive: true });
    const entries = [{ kind: 'dir', name: `${ctx.slug}/`, mode: 0o755 }].concat(mapTree(ctx.tree, ctx.slug));
    const packed = await compressedTar(work, 'bundle', entries, ctx.xz);
    return commitFile(packed.file, `${ctx.outputs.tar}.tar.${packed.ext}`);
}

async function buildDeb(ctx) {
    log('DEB paketi oluşturuluyor...');
    const work = path.join(tmpRoot, 'deb');
    await fsp.mkdir(work, { recursive: true });

    const installDir = `opt/${ctx.slug}`;
    const dirs = new Set([
        '.', 'opt', installDir, 'usr', 'usr/bin', 'usr/share', 'usr/share/applications',
        'usr/share/icons', 'usr/share/icons/hicolor', 'usr/share/doc', `usr/share/doc/${ctx.slug}`
    ]);
    for (const icon of ctx.icons) {
        dirs.add(`usr/share/icons/hicolor/${icon.size}`);
        dirs.add(`usr/share/icons/hicolor/${icon.size}/apps`);
    }
    const entries = [...dirs].map(d => ({ kind: 'dir', name: d === '.' ? './' : `./${d}`, mode: 0o755 }));
    for (const item of mapTree(ctx.tree, `./${installDir}`, { 'chrome-sandbox': 0o4755 })) entries.push(item);
    entries.push({ kind: 'symlink', name: `./usr/bin/${ctx.slug}`, link: `/${installDir}/${ctx.binaryName}`, mode: 0o777 });
    entries.push({
        kind: 'file',
        name: `./usr/share/applications/${ctx.slug}.desktop`,
        mode: 0o644,
        content: Buffer.from(desktopEntry(ctx, `/usr/bin/${ctx.slug}`), 'utf8')
    });
    for (const icon of ctx.icons) {
        entries.push({ kind: 'file', name: `./usr/share/icons/hicolor/${icon.size}/apps/${ctx.slug}.png`, mode: 0o644, content: icon.data });
    }
    entries.push({
        kind: 'file',
        name: `./usr/share/doc/${ctx.slug}/copyright`,
        mode: 0o644,
        content: Buffer.from(
            `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: ${ctx.appName}\nFiles: *\nCopyright: ${new Date(epoch * 1000).getUTCFullYear()} ${ctx.maintainer}\nLicense: ${ctx.license}\n`,
            'utf8'
        )
    });

    let installedBytes = 0;
    const md5Lines = [];
    for (const entry of entries) {
        if (entry.kind !== 'file') continue;
        installedBytes += entrySize(entry);
        const md5 = entry.content ? hashBuffer(entry.content, 'md5') : await hashFile(entry.abs, 'md5');
        md5Lines.push(`${md5}  ${entry.name.replace(/^\.\//, '')}`);
    }

    const control = [
        `Package: ${ctx.slug}`,
        `Version: ${ctx.version}`,
        'Section: web',
        'Priority: optional',
        'Architecture: amd64',
        `Maintainer: ${ctx.maintainer}`,
        `Installed-Size: ${Math.max(1, Math.ceil(installedBytes / 1024))}`,
        'Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libasound2 | libasound2t64',
        'Recommends: libgbm1, libdrm2, libxkbcommon0',
        'Provides: www-browser, x-www-browser',
        ctx.homepage ? `Homepage: ${ctx.homepage}` : null,
        `Description: ${ctx.description}`,
        ''
    ].filter(line => line !== null).join('\n');

    const controlTar = path.join(work, 'control.tar.gz');
    await tarTo(controlTar, [
        { kind: 'dir', name: './', mode: 0o755 },
        { kind: 'file', name: './control', mode: 0o644, content: Buffer.from(control, 'utf8') },
        { kind: 'file', name: './md5sums', mode: 0o644, content: Buffer.from(md5Lines.join('\n') + '\n', 'utf8') },
        { kind: 'file', name: './postinst', mode: 0o755, content: Buffer.from(debPostinst(ctx, installDir), 'utf8') },
        { kind: 'file', name: './prerm', mode: 0o755, content: Buffer.from(debPrerm(ctx), 'utf8') },
        { kind: 'file', name: './postrm', mode: 0o755, content: Buffer.from(debPostrm(), 'utf8') }
    ], true);

    const data = await compressedTar(work, 'data', entries, ctx.xz);
    const partial = path.join(work, 'package.deb');
    await writeAr(partial, [
        { name: 'debian-binary', buffer: Buffer.from('2.0\n', 'latin1') },
        { name: 'control.tar.gz', file: controlTar },
        { name: `data.tar.${data.ext}`, file: data.file }
    ]);
    return commitFile(partial, ctx.outputs.deb);
}

async function buildAppImage(ctx) {
    log('AppImage paketi hazırlanıyor...');
    const work = path.join(tmpRoot, 'appimage');
    await fsp.mkdir(work, { recursive: true });

    const runtime = await resolveAppImageRuntime();
    const mainIcon = ctx.icons[ctx.icons.length - 1].data;
    const desktop = Buffer.from(
        desktopEntry(ctx, ctx.slug) + `X-AppImage-Name=${ctx.appName}\nX-AppImage-Version=${ctx.version}\n`,
        'utf8'
    );
    const entries = [
        { kind: 'file', name: 'AppRun', mode: 0o755, content: Buffer.from(appRunScript(ctx.binaryName), 'utf8') },
        { kind: 'file', name: `${ctx.slug}.desktop`, mode: 0o644, content: desktop },
        { kind: 'file', name: `${ctx.slug}.png`, mode: 0o644, content: mainIcon },
        { kind: 'file', name: '.DirIcon', mode: 0o644, content: mainIcon },
        { kind: 'file', name: `usr/share/applications/${ctx.slug}.desktop`, mode: 0o644, content: desktop }
    ];
    for (const icon of ctx.icons) {
        entries.push({ kind: 'file', name: `usr/share/icons/hicolor/${icon.size}/apps/${ctx.slug}.png`, mode: 0o644, content: icon.data });
    }
    for (const item of mapTree(ctx.tree, 'usr/bin')) entries.push(item);

    const squashFile = path.join(work, 'appimage.squashfs');
    await writeSquashfs(squashFile, entries);

    const partial = path.join(work, 'package.AppImage');
    await fsp.rm(partial, { force: true });
    await fsp.copyFile(runtime, partial);
    await appendFileTo(partial, squashFile);
    await fsp.chmod(partial, 0o755);
    return commitFile(partial, ctx.outputs.appImage);
}

async function buildRpm(ctx) {
    log('RPM paketi oluşturuluyor...');
    const work = path.join(tmpRoot, 'rpm');
    await fsp.mkdir(work, { recursive: true });

    const installDir = `/opt/${ctx.slug}`;
    const items = [{ kind: 'dir', path: installDir, mode: 0o755 }];
    for (const item of mapTree(ctx.tree, installDir, { 'chrome-sandbox': 0o4755 })) items.push({ ...item, path: item.name });
    items.push({ kind: 'symlink', path: `/usr/bin/${ctx.slug}`, link: `${installDir}/${ctx.binaryName}`, mode: 0o777 });
    items.push({
        kind: 'file',
        path: `/usr/share/applications/${ctx.slug}.desktop`,
        mode: 0o644,
        content: Buffer.from(desktopEntry(ctx, `/usr/bin/${ctx.slug}`), 'utf8')
    });
    for (const icon of ctx.icons) {
        items.push({ kind: 'file', path: `/usr/share/icons/hicolor/${icon.size}/apps/${ctx.slug}.png`, mode: 0o644, content: icon.data });
    }
    for (const item of items) {
        item.size = entrySize(item);
        if (item.size > 0xFFFFFFFF) throw new Error(`Dosya çok büyük: ${item.path}`);
    }
    items.sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));

    const typeBits = { dir: 0o040000, file: 0o100000, symlink: 0o120000 };
    const fileModes = items.map(item => (typeBits[item.kind] | item.mode) & 0xFFFF);

    const digests = [];
    let totalSize = 0;
    for (const item of items) {
        if (item.kind !== 'file') {
            digests.push('');
            continue;
        }
        totalSize += item.size;
        digests.push(item.content ? hashBuffer(item.content, 'sha256') : await hashFile(item.abs, 'sha256'));
    }

    const dirNames = [];
    const dirLookup = new Map();
    const baseNames = [];
    const dirIndexes = [];
    for (const item of items) {
        const cut = item.path.lastIndexOf('/');
        const dir = item.path.slice(0, cut + 1);
        if (!dirLookup.has(dir)) {
            dirLookup.set(dir, dirNames.length);
            dirNames.push(dir);
        }
        baseNames.push(item.path.slice(cut + 1));
        dirIndexes.push(dirLookup.get(dir));
    }

    let compressor = 'gzip';
    let payloadFile = path.join(work, 'payload.cpio.gz');
    let payloadRawSize;
    if (ctx.xz) {
        const raw = path.join(work, 'payload.cpio');
        const packed = path.join(work, 'payload.cpio.xz');
        try {
            payloadRawSize = await writeRpmPayload(raw, items, fileModes, false);
            await xzFile(raw, packed);
            payloadFile = packed;
            compressor = 'xz';
        } catch (e) {
            logError(`RPM için xz başarısız, gzip kullanılacak: ${e.message}`);
            await fsp.rm(packed, { force: true }).catch(() => {});
        } finally {
            await fsp.rm(raw, { force: true }).catch(() => {});
        }
    }
    if (compressor === 'gzip') payloadRawSize = await writeRpmPayload(payloadFile, items, fileModes, true);

    const release = '1';
    const fullVersion = `${ctx.rpmVersion}-${release}`;
    const dependencies = ['gtk3', 'nss', 'libnotify', 'libXScrnSaver', 'libXtst', 'xdg-utils', 'at-spi2-core', 'libuuid', 'libsecret', 'alsa-lib'];
    const rpmlibNames = ['rpmlib(CompressedFileNames)', 'rpmlib(PayloadFilesHavePrefix)'];
    const rpmlibVersions = ['3.0.4-1', '4.0-1'];
    if (compressor === 'xz') {
        rpmlibNames.push('rpmlib(PayloadIsXz)');
        rpmlibVersions.push('5.2-1');
    }
    const requireNames = rpmlibNames.concat(dependencies);
    const requireFlags = rpmlibNames.map(() => 0x0100000A).concat(dependencies.map(() => 0));
    const requireVersions = rpmlibVersions.concat(dependencies.map(() => ''));

    const headerItems = [
        rpmStringArray(100, ['C']),
        rpmString(1000, ctx.slug),
        rpmString(1001, ctx.rpmVersion),
        rpmString(1002, release),
        rpmI18n(1004, ctx.description),
        rpmI18n(1005, ctx.description),
        rpmInt32(1006, [epoch]),
        rpmString(1007, 'localhost'),
        rpmInt32(1009, [totalSize]),
        rpmString(1014, ctx.license),
        rpmI18n(1016, 'Applications/Internet'),
        rpmString(1021, 'linux'),
        rpmString(1022, 'x86_64'),
        rpmString(1024, rpmPost(installDir)),
        rpmString(1026, rpmPostun()),
        rpmInt32(1028, items.map(item => item.size)),
        rpmInt16(1030, fileModes),
        rpmInt16(1033, items.map(() => 0)),
        rpmInt32(1034, items.map(() => epoch)),
        rpmStringArray(1035, digests),
        rpmStringArray(1036, items.map(item => (item.kind === 'symlink' ? item.link : ''))),
        rpmInt32(1037, items.map(() => 0)),
        rpmStringArray(1039, items.map(() => 'root')),
        rpmStringArray(1040, items.map(() => 'root')),
        rpmString(1044, `${ctx.slug}-${fullVersion}.src.rpm`),
        rpmInt32(1045, items.map(() => 0xFFFFFFFF)),
        rpmStringArray(1047, [ctx.slug, `${ctx.slug}(x86-64)`, 'web-browser', 'www-browser']),
        rpmInt32(1048, requireFlags),
        rpmStringArray(1049, requireNames),
        rpmStringArray(1050, requireVersions),
        rpmString(1064, '4.18.0'),
        rpmInt32(1080, [epoch]),
        rpmStringArray(1081, [`${ctx.maintainer} - ${fullVersion}`]),
        rpmStringArray(1082, ['- Otomatik derleme']),
        rpmString(1086, '/bin/sh'),
        rpmString(1088, '/bin/sh'),
        rpmInt32(1095, items.map(() => 1)),
        rpmInt32(1096, items.map((item, index) => index + 1)),
        rpmStringArray(1097, items.map(() => '')),
        rpmInt32(1112, [8, 8, 0, 0]),
        rpmStringArray(1113, [fullVersion, fullVersion, '', '']),
        rpmInt32(1116, dirIndexes),
        rpmStringArray(1117, baseNames),
        rpmStringArray(1118, dirNames),
        rpmString(1124, 'cpio'),
        rpmString(1125, compressor),
        rpmString(1126, compressor === 'xz' ? '7' : '9'),
        rpmString(1132, 'x86_64-linux'),
        rpmInt32(5011, [8])
    ];
    if (ctx.homepage) headerItems.push(rpmString(1020, ctx.homepage));
    const header = buildRpmHeader(headerItems, 63);

    const payloadStat = await fsp.stat(payloadFile);
    const md5 = crypto.createHash('md5').update(header);
    for await (const chunk of fs.createReadStream(payloadFile)) md5.update(chunk);

    const signature = buildRpmHeader([
        rpmString(269, hashBuffer(header, 'sha1')),
        rpmString(273, hashBuffer(header, 'sha256')),
        rpmInt32(1000, [header.length + payloadStat.size]),
        rpmBinary(1004, md5.digest()),
        rpmInt32(1007, [payloadRawSize])
    ], 62);
    const signaturePad = Buffer.alloc((8 - (signature.length % 8)) % 8);

    const lead = Buffer.alloc(96);
    lead.writeUInt32BE(0xEDABEEDB, 0);
    lead.writeUInt8(3, 4);
    lead.writeUInt8(0, 5);
    lead.writeUInt16BE(0, 6);
    lead.writeUInt16BE(1, 8);
    lead.write(`${ctx.slug}-${fullVersion}`.slice(0, 65), 10, 66, 'latin1');
    lead.writeUInt16BE(1, 76);
    lead.writeUInt16BE(5, 78);

    const partial = path.join(work, 'package.rpm');
    await fsp.writeFile(partial, Buffer.concat([lead, signature, signaturePad, header]));
    await appendFileTo(partial, payloadFile);
    return commitFile(partial, ctx.outputs.rpm);
}

function loadPackageConfig() {
    const packageJsonPath = path.join(rootDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) throw new Error('package.json bulunamadı');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const buildConfig = packageJson.build || {};
    const linuxConfig = buildConfig.linux || {};
    const version = String(packageJson.version || '1.0.0');
    const appName = buildConfig.productName || packageJson.name || 'Anka Web';
    const executableName = BINARY_NAME_OVERRIDE || linuxConfig.executableName || packageJson.name || 'anka-web';
    const slug = String(executableName).toLowerCase().replace(/[^a-z0-9+.-]/g, '-').replace(/^[^a-z0-9]+/, '') || 'anka-web';
    const description = String(packageJson.description || 'Anka Web Tarayıcısı').replace(/\s+/g, ' ').trim();
    const authorField = typeof packageJson.author === 'object' && packageJson.author ? `${packageJson.author.name} <${packageJson.author.email}>` : packageJson.author;
    const maintainer = linuxConfig.maintainer || authorField || 'WraitGame <wraitstudio@gmail.com>';
    const homepage = linuxConfig.homepage || packageJson.homepage || '';
    const license = packageJson.license || 'MIT';
    const categories = String(linuxConfig.category || 'Network;WebBrowser').replace(/;*$/, ';');
    const mimeTypes = Array.isArray(linuxConfig.mimeTypes) && linuxConfig.mimeTypes.length
        ? linuxConfig.mimeTypes.map(String)
        : ['text/html', 'application/xhtml+xml', 'x-scheme-handler/http', 'x-scheme-handler/https'];
    const outputSetting = String((buildConfig.directories && buildConfig.directories.output) || 'dist').replace(/\$\{version\}/g, version);
    return {
        packageJson, buildConfig, linuxConfig, version, appName, executableName, slug, description,
        maintainer, homepage, license, categories, mimeTypes,
        rpmVersion: version.replace(/-/g, '_'),
        prefix: String(appName).trim().replace(/\s+/g, '_'),
        outDir: path.resolve(rootDir, outputSetting)
    };
}

function buildOutputPaths(cfg) {
    return {
        deb: path.join(outDir, `${cfg.prefix}_${cfg.version}_amd64.deb`),
        appImage: path.join(outDir, `${cfg.prefix}_${cfg.version}_x86_64.AppImage`),
        rpm: path.join(outDir, `${cfg.prefix}_${cfg.version}_x86_64.rpm`),
        tar: path.join(outDir, `${cfg.prefix}_${cfg.version}_x64`)
    };
}

async function reportSizes() {
    const asarPath = path.join(linuxUnpacked, 'resources', 'app.asar');
    if (fs.existsSync(asarPath)) log(`app.asar: ${formatSize((await fsp.stat(asarPath)).size)}`);
    log(`linux-unpacked toplam: ${formatSize(await directorySize(linuxUnpacked))}`);
}

async function main() {
    console.log('Linux paketleri hazırlanıyor...');
    const cfg = loadPackageConfig();
    outDir = cfg.outDir;
    linuxUnpacked = path.join(outDir, 'linux-unpacked');
    tmpRoot = path.join(outDir, '.linux-pkg-tmp');
    await fsp.mkdir(outDir, { recursive: true });

    const found = await findExistingLinuxUnpacked(cfg);
    if (found) {
        linuxUnpacked = found;
        await prepareElectronResources(cfg);
    } else {
        await ensureLinuxUnpacked(cfg);
    }

    const binaryName = await resolveBinary(cfg.executableName);
    log(`Çalıştırılabilir dosya: ${binaryName}`);
    await reportSizes();

    const tree = await walkTree(linuxUnpacked, binaryName);
    const icons = await loadIcons(cfg);
    const xz = await hasXz();
    log(xz ? 'xz sıkıştırma etkin' : 'xz bulunamadı, gzip kullanılacak');

    const outputs = buildOutputPaths(cfg);
    const ctx = { ...cfg, binaryName, tree, icons, xz, outputs };

    await fsp.rm(tmpRoot, { recursive: true, force: true });
    await fsp.mkdir(tmpRoot, { recursive: true });
    process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {} });

    for (const file of [outputs.deb, outputs.appImage, outputs.rpm, `${outputs.tar}.tar.gz`, `${outputs.tar}.tar.xz`]) {
        await fsp.rm(file, { force: true });
    }

    const tasks = [
        { label: 'TAR', run: () => buildTar(ctx) },
        { label: 'DEB', run: () => buildDeb(ctx) },
        { label: 'AppImage', run: () => buildAppImage(ctx) },
        { label: 'RPM', run: () => buildRpm(ctx) }
    ];

    const outcomes = await runWithConcurrency(tasks.map(t => async () => {
        try {
            const result = await t.run();
            log(`${t.label} başarıyla oluşturuldu: ${path.basename(result.file)} (${formatSize(result.size)})`);
            if (result.size > MAX_OUTPUT_WARN) {
                logError(`Uyarı: ${t.label} ${formatSize(MAX_OUTPUT_WARN)} üzerinde. app.asar boyutunu kontrol edin.`);
            }
            return { label: t.label, status: 'ok', ...result };
        } catch (error) {
            logError(`${t.label} oluşturulamadı: ${error.message}`);
            return { label: t.label, status: 'failed', message: error.message };
        }
    }), MAX_CONCURRENT);

    const results = outcomes.map(o => o.ok ? o.value : { label: '?', status: 'failed', message: o.error.message });
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

    const produced = results.filter(r => r.status === 'ok');
    if (produced.length > 0) {
        const lines = [];
        for (const r of produced) lines.push(`${await hashFile(r.file, 'sha256')}  ${path.basename(r.file)}`);
        await fsp.writeFile(path.join(outDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
        log('SHA256SUMS.txt güncellendi');
    }

    console.log('\nÖzet:');
    for (const r of results) {
        if (r.status === 'ok') console.log(`  [OK]   ${r.label}: ${path.basename(r.file)} (${formatSize(r.size)})`);
        else console.log(`  [HATA] ${r.label}: ${r.message}`);
    }

    if (produced.length === 0 || results.some(r => r.status === 'failed')) {
        logError('Linux paketleme işlemi hatalarla tamamlandı.');
        process.exit(1);
    }
    log('Linux paketleme işlemi tamamlandı.');
}

main().catch(error => {
    logError('Beklenmeyen hata:', error);
    process.exit(1);
});