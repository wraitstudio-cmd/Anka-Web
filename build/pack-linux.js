const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const crypto = require('crypto');
const { once } = require('events');
const { pipeline } = require('stream/promises');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const linuxUnpacked = path.join(distDir, 'linux-unpacked');
const tmpRoot = path.join(distDir, '.linux-pkg-tmp');
const isWin = process.platform === 'win32';
const epoch = Number(process.env.SOURCE_DATE_EPOCH) || Math.floor(Date.now() / 1000);
const startedAt = Date.now();

const GZIP_LEVEL = 9;
const SQ_BLOCK = 131072;
const SQ_META = 8192;
const SQ_INVALID = 0xFFFFFFFFFFFFFFFFn;
const APPIMAGE_RUNTIME_URL = 'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64';
const KEEP_LOCALES = new Set(['en-US.pak', 'tr.pak']);

function log(...args) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[+${elapsed}s]`, ...args);
}

function logError(...args) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`[+${elapsed}s]`, ...args);
}

console.log('Linux paketleri hazırlanıyor...');

if (!fs.existsSync(linuxUnpacked)) {
    logError('Hata: linux-unpacked klasörü bulunamadı. Önce electron-builder ile linux dizin çıktısını üretin.');
    process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const buildConfig = packageJson.build || {};
const linuxConfig = buildConfig.linux || {};
const version = String(packageJson.version || '1.0.0');
const appName = buildConfig.productName || packageJson.name || 'Anka Web';
const executableName = linuxConfig.executableName || packageJson.name || 'anka-web';
const slug = String(executableName).toLowerCase().replace(/[^a-z0-9+.-]/g, '-').replace(/^[^a-z0-9]+/, '') || 'anka-web';
const description = String(packageJson.description || 'Anka Web Tarayıcısı').replace(/\s+/g, ' ').trim();
const maintainer = linuxConfig.maintainer || 'WraitGame <wraitstudio@gmail.com>';
const homepage = linuxConfig.homepage || packageJson.homepage || '';
const license = packageJson.license || 'MIT';
const rpmVersion = version.replace(/-/g, '_');

const outputs = {
    deb: path.join(distDir, `Anka_Web_${version}_amd64.deb`),
    appImage: path.join(distDir, `Anka_Web_${version}_x86_64.AppImage`),
    rpm: path.join(distDir, `Anka_Web_${version}_x86_64.rpm`),
    tar: path.join(distDir, `Anka_Web_${version}_x64.tar.gz`)
};

const placeholderPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let binaryName = executableName;

function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function findLogo() {
    const candidates = [
        path.join(rootDir, 'icons', 'logo.png'),
        path.join(rootDir, 'icons', 'icon.png'),
        path.join(rootDir, 'build', 'icon.png'),
        path.join(rootDir, 'icon.png')
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
}

function normalizeMode(mode, isDir) {
    return ((mode | (isDir ? 0o555 : 0o444)) & ~0o022) & 0o7777;
}

function windowsFileMode(name) {
    const executables = new Set([binaryName, 'chrome-sandbox', 'chrome_crashpad_handler']);
    if (executables.has(name) || name.endsWith('.sh')) return 0o755;
    return 0o644;
}

function shouldSkip(relPath) {
    const parts = relPath.split('/');
    const name = parts[parts.length - 1];
    if (parts.length === 2 && parts[0] === 'locales') return !KEEP_LOCALES.has(name);
    if (name.endsWith('.map')) return true;
    return false;
}

async function walkTree(base, rel = '') {
    const list = [];
    const names = (await fsp.readdir(path.join(base, rel))).sort();
    for (const name of names) {
        const relPath = rel ? `${rel}/${name}` : name;
        if (shouldSkip(relPath)) continue;
        const abs = path.join(base, relPath);
        const st = await fsp.lstat(abs);
        if (st.isSymbolicLink()) {
            const link = (await fsp.readlink(abs)).replace(/\\/g, '/');
            list.push({ kind: 'symlink', rel: relPath, link, mode: 0o777 });
        } else if (st.isDirectory()) {
            list.push({ kind: 'dir', rel: relPath, mode: isWin ? 0o755 : normalizeMode(st.mode, true) });
            const children = await walkTree(base, relPath);
            for (const child of children) list.push(child);
        } else if (st.isFile()) {
            list.push({
                kind: 'file',
                rel: relPath,
                abs,
                size: st.size,
                mode: isWin ? windowsFileMode(name) : normalizeMode(st.mode, false)
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

class GzipFileWriter {
    constructor(file) {
        this.gzip = zlib.createGzip({ level: GZIP_LEVEL });
        this.out = fs.createWriteStream(file);
        this.finished = pipeline(this.gzip, this.out);
        this.finished.catch(() => {});
        this.raw = 0;
    }

    async push(buffer) {
        this.raw += buffer.length;
        if (!this.gzip.write(buffer)) await once(this.gzip, 'drain');
    }

    async pad(size, unit = 512) {
        const rest = size % unit;
        if (rest) await this.push(Buffer.alloc(unit - rest));
    }

    async close() {
        this.gzip.end();
        await this.finished;
    }
}

class TarGzWriter extends GzipFileWriter {
    async longEntry(type, text) {
        const data = Buffer.from(text + '\0', 'utf8');
        await this.push(buildTarHeader({ name: '././@LongLink', mode: 0o644, size: data.length, type }));
        await this.push(data);
        await this.pad(data.length);
    }

    async add(entry) {
        let name = entry.name;
        if (entry.kind === 'dir' && !name.endsWith('/')) name += '/';
        if (Buffer.byteLength(name) > 100) await this.longEntry('L', name);
        if (entry.kind === 'symlink' && Buffer.byteLength(entry.link) > 100) await this.longEntry('K', entry.link);
        const type = entry.kind === 'dir' ? '5' : entry.kind === 'symlink' ? '2' : '0';
        const size = entry.kind === 'file' ? (entry.content ? entry.content.length : entry.size) : 0;
        await this.push(buildTarHeader({ name, mode: entry.mode, size, type, link: entry.link }));
        if (entry.kind !== 'file') return;
        if (entry.content) {
            await this.push(entry.content);
        } else {
            let written = 0;
            for await (const chunk of fs.createReadStream(entry.abs)) {
                written += chunk.length;
                await this.push(chunk);
            }
            if (written !== size) throw new Error(`Dosya okunurken boyut değişti: ${entry.abs}`);
        }
        await this.pad(size);
    }

    async close() {
        await this.push(Buffer.alloc(1024));
        await super.close();
    }
}

async function writeTarGz(file, entries) {
    const writer = new TarGzWriter(file);
    try {
        for (const entry of entries) await writer.add(entry);
    } catch (e) {
        writer.gzip.destroy();
        throw e;
    }
    await writer.close();
}

async function writeAr(file, members) {
    const out = fs.createWriteStream(file);
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
            if (member.buffer) {
                await write(member.buffer);
            } else {
                for await (const chunk of fs.createReadStream(member.file)) await write(chunk);
            }
            if (size % 2 === 1) await write(Buffer.from('\n', 'latin1'));
        }
    } catch (e) {
        out.destroy();
        throw e;
    }
    await new Promise((resolve, reject) => {
        out.on('error', reject);
        out.end(resolve);
    });
}

async function hashFile(file, algorithm) {
    const hash = crypto.createHash(algorithm);
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

function hashBuffer(buffer, algorithm) {
    return crypto.createHash(algorithm).update(buffer).digest('hex');
}

async function isElf(file) {
    try {
        const handle = await fsp.open(file, 'r');
        try {
            const head = Buffer.alloc(4);
            await handle.read(head, 0, 4, 0);
            return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
        } finally {
            await handle.close();
        }
    } catch (e) {
        return false;
    }
}

function download(url, dest, redirects = 6) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'anka-web-packager' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error('Çok fazla yönlendirme'));
                return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`İndirme başarısız: HTTP ${res.statusCode}`));
            }
            pipeline(res, fs.createWriteStream(dest)).then(resolve, reject);
        }).on('error', reject);
    });
}

async function resolveBinary() {
    const names = await fsp.readdir(linuxUnpacked);
    const exact = names.find(n => n === executableName);
    const loose = names.find(n => n.toLowerCase() === String(executableName).toLowerCase());
    const chosen = exact || loose;
    if (!chosen) {
        throw new Error(`Çalıştırılabilir dosya bulunamadı (${executableName}). linux-unpacked içeriği: ${names.slice(0, 15).join(', ')}`);
    }
    const full = path.join(linuxUnpacked, chosen);
    if (!(await isElf(full))) {
        throw new Error(`Ana çalıştırılabilir dosya geçerli bir ELF değil: ${full}`);
    }
    return chosen;
}

function desktopEntry(execLine) {
    return [
        '[Desktop Entry]',
        `Name=${appName}`,
        'GenericName=Web Tarayıcı',
        `Comment=${description}`,
        `Exec=${execLine} %U`,
        'Terminal=false',
        'Type=Application',
        `Icon=${slug}`,
        `StartupWMClass=${executableName}`,
        'Categories=Network;WebBrowser;',
        'MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;',
        ''
    ].join('\n');
}

function appRunScript() {
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
        'if [ -u "$HERE/chrome-sandbox" ]; then',
        '    exec "$BIN" "$@"',
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

function debPostinst(installDir) {
    return [
        '#!/bin/sh',
        'set -e',
        `SANDBOX="/${installDir}/chrome-sandbox"`,
        'ns_ok=0',
        'if [ -f /proc/sys/user/max_user_namespaces ]; then',
        '    max_ns=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)',
        '    [ "$max_ns" -gt 0 ] 2>/dev/null && ns_ok=1',
        'fi',
        'if [ "$ns_ok" = "0" ] && [ -f /proc/sys/kernel/unprivileged_userns_clone ]; then',
        '    clone_ok=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 0)',
        '    [ "$clone_ok" = "1" ] && ns_ok=1',
        'fi',
        'if [ "$ns_ok" = "1" ]; then',
        '    chmod 0755 "$SANDBOX" 2>/dev/null || true',
        'else',
        '    chmod 4755 "$SANDBOX" 2>/dev/null || true',
        'fi',
        'if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi',
        'if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi',
        'exit 0',
        ''
    ].join('\n');
}

function debPostrm() {
    return [
        '#!/bin/sh',
        'set -e',
        'if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi',
        'if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi',
        'exit 0',
        ''
    ].join('\n');
}

function rpmScript(isPost) {
    if (!isPost) {
        return [
            'update-desktop-database -q /usr/share/applications 2>/dev/null || true',
            'gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true',
            'exit 0',
            ''
        ].join('\n');
    }
    const installDir = `/opt/${slug}`;
    return [
        `SANDBOX="${installDir}/chrome-sandbox"`,
        'ns_ok=0',
        'if [ -f /proc/sys/user/max_user_namespaces ]; then',
        '    max_ns=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)',
        '    [ "$max_ns" -gt 0 ] 2>/dev/null && ns_ok=1',
        'fi',
        'if [ "$ns_ok" = "0" ] && [ -f /proc/sys/kernel/unprivileged_userns_clone ]; then',
        '    clone_ok=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 0)',
        '    [ "$clone_ok" = "1" ] && ns_ok=1',
        'fi',
        'if [ "$ns_ok" = "1" ]; then',
        '    chmod 0755 "$SANDBOX" 2>/dev/null || true',
        'else',
        '    chmod 4755 "$SANDBOX" 2>/dev/null || true',
        'fi',
        'update-desktop-database -q /usr/share/applications 2>/dev/null || true',
        'gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true',
        'exit 0',
        ''
    ].join('\n');
}

function rpmChangelogDate() {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(epoch * 1000);
    return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()}`;
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
    constructor() {
        this.chunks = [];
        this.length = 0;
    }

    ref() {
        return { block: Math.floor(this.length / SQ_META) * (SQ_META + 2), offset: this.length % SQ_META };
    }

    write(buffer) {
        this.chunks.push(buffer);
        this.length += buffer.length;
    }

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
        if (entry.kind === 'dir') {
            ensureDir(parts.concat(leaf)).mode = entry.mode;
        } else {
            ensureDir(parts).children.set(leaf, { ...entry });
        }
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
                await put(chunk);
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
    if (process.env.APPIMAGE_RUNTIME && fs.existsSync(process.env.APPIMAGE_RUNTIME)) {
        if (!(await isElf(process.env.APPIMAGE_RUNTIME))) throw new Error('APPIMAGE_RUNTIME geçerli bir ELF dosyası değil');
        return process.env.APPIMAGE_RUNTIME;
    }
    const local = path.join(__dirname, 'appimage-runtime-x86_64');
    if (fs.existsSync(local) && await isElf(local)) return local;
    log('AppImage runtime indiriliyor...');
    const partial = `${local}.partial`;
    await fsp.rm(partial, { force: true });
    try {
        await download(APPIMAGE_RUNTIME_URL, partial);
        if (!(await isElf(partial))) throw new Error('İndirilen runtime geçerli bir ELF dosyası değil');
        await fsp.rm(local, { force: true });
        await fsp.rename(partial, local);
    } catch (e) {
        await fsp.rm(partial, { force: true });
        throw new Error(`AppImage runtime alınamadı (${e.message}). Dosyayı elle indirip APPIMAGE_RUNTIME ortam değişkeniyle yolunu verebilirsiniz.`);
    }
    return local;
}

function rpmString(tag, value) {
    return { tag, type: 6, count: 1, data: Buffer.from(`${value}\0`, 'utf8') };
}

function rpmI18n(tag, value) {
    return { tag, type: 9, count: 1, data: Buffer.from(`${value}\0`, 'utf8') };
}

function rpmStringArray(tag, values) {
    return { tag, type: 8, count: values.length, data: Buffer.concat(values.map(v => Buffer.from(`${v}\0`, 'utf8'))) };
}

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

function rpmBinary(tag, buffer) {
    return { tag, type: 7, count: buffer.length, data: buffer };
}

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

async function writeRpmPayload(file, items, fileModes) {
    const writer = new GzipFileWriter(file);
    try {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const size = item.size;
            await writer.push(cpioEntry(i + 1, fileModes[i], item.kind === 'dir' ? 2 : 1, size, `.${item.path}`));
            if (item.kind === 'symlink') {
                await writer.push(Buffer.from(item.link, 'utf8'));
            } else if (item.kind === 'file') {
                if (item.content) {
                    await writer.push(item.content);
                } else {
                    let written = 0;
                    for await (const chunk of fs.createReadStream(item.abs)) {
                        written += chunk.length;
                        await writer.push(chunk);
                    }
                    if (written !== size) throw new Error(`Dosya okunurken boyut değişti: ${item.abs}`);
                }
            }
            await writer.pad(size, 4);
        }
        await writer.push(cpioEntry(0, 0, 1, 0, 'TRAILER!!!'));
    } catch (e) {
        writer.gzip.destroy();
        throw e;
    }
    await writer.close();
    return writer.raw;
}

async function buildTar() {
    log('tar.gz arşivi oluşturuluyor...');
    const tree = await walkTree(linuxUnpacked);
    const entries = [{ kind: 'dir', name: 'linux-unpacked/', mode: 0o755 }].concat(mapTree(tree, 'linux-unpacked'));
    const partial = `${outputs.tar}.partial`;
    await writeTarGz(partial, entries);
    return commitFile(partial, outputs.tar);
}

async function buildDeb() {
    log('DEB paketi oluşturuluyor...');
    const work = path.join(tmpRoot, 'deb');
    await fsp.mkdir(work, { recursive: true });

    const installDir = `opt/${slug}`;
    const tree = await walkTree(linuxUnpacked);
    const logo = findLogo();

    const entries = [];
    const dirs = [
        '.', 'opt', installDir, 'usr', 'usr/bin', 'usr/share', 'usr/share/applications',
        'usr/share/icons', 'usr/share/icons/hicolor', 'usr/share/icons/hicolor/256x256',
        'usr/share/icons/hicolor/256x256/apps', 'usr/share/doc', `usr/share/doc/${slug}`
    ];
    for (const d of dirs) entries.push({ kind: 'dir', name: d === '.' ? './' : `./${d}`, mode: 0o755 });

    const mapped = mapTree(tree, `./${installDir}`, { 'chrome-sandbox': 0o4755 });
    for (const m of mapped) entries.push(m);

    entries.push({ kind: 'symlink', name: `./usr/bin/${slug}`, link: `/${installDir}/${binaryName}`, mode: 0o777 });
    entries.push({
        kind: 'file',
        name: `./usr/share/applications/${slug}.desktop`,
        mode: 0o644,
        content: Buffer.from(desktopEntry(`/usr/bin/${slug}`), 'utf8')
    });
    if (logo) {
        entries.push({
            kind: 'file',
            name: `./usr/share/icons/hicolor/256x256/apps/${slug}.png`,
            mode: 0o644,
            content: await fsp.readFile(logo)
        });
    }
    entries.push({
        kind: 'file',
        name: `./usr/share/doc/${slug}/copyright`,
        mode: 0o644,
        content: Buffer.from(
            `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: ${appName}\nFiles: *\nCopyright: ${new Date(epoch * 1000).getUTCFullYear()} ${maintainer}\nLicense: ${license}\n`,
            'utf8'
        )
    });

    let installedBytes = 0;
    const md5Lines = [];
    for (const entry of entries) {
        if (entry.kind !== 'file') continue;
        const size = entry.content ? entry.content.length : entry.size;
        installedBytes += size;
        const md5 = entry.content ? hashBuffer(entry.content, 'md5') : await hashFile(entry.abs, 'md5');
        md5Lines.push(`${md5}  ${entry.name.replace(/^\.\//, '')}`);
    }
    const installedSizeKB = Math.max(1, Math.ceil(installedBytes / 1024));

    const control = [
        `Package: ${slug}`,
        `Version: ${version}`,
        'Section: web',
        'Priority: optional',
        'Architecture: amd64',
        `Maintainer: ${maintainer}`,
        `Installed-Size: ${installedSizeKB}`,
        'Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0',
        homepage ? `Homepage: ${homepage}` : null,
        `Description: ${description}`,
        ''
    ].filter(line => line !== null).join('\n');

    const controlTar = path.join(work, 'control.tar.gz');
    await writeTarGz(controlTar, [
        { kind: 'dir', name: './', mode: 0o755 },
        { kind: 'file', name: './control', mode: 0o644, content: Buffer.from(control, 'utf8') },
        { kind: 'file', name: './md5sums', mode: 0o644, content: Buffer.from(md5Lines.join('\n') + '\n', 'utf8') },
        { kind: 'file', name: './postinst', mode: 0o755, content: Buffer.from(debPostinst(installDir), 'utf8') },
        { kind: 'file', name: './postrm', mode: 0o755, content: Buffer.from(debPostrm(), 'utf8') }
    ]);

    const dataTar = path.join(work, 'data.tar.gz');
    await writeTarGz(dataTar, entries);

    const partial = `${outputs.deb}.partial`;
    await writeAr(partial, [
        { name: 'debian-binary', buffer: Buffer.from('2.0\n', 'latin1') },
        { name: 'control.tar.gz', file: controlTar },
        { name: 'data.tar.gz', file: dataTar }
    ]);
    return commitFile(partial, outputs.deb);
}

async function buildAppImage() {
    log('AppImage paketi hazırlanıyor...');
    const work = path.join(tmpRoot, 'appimage');
    await fsp.mkdir(work, { recursive: true });

    const runtime = await resolveAppImageRuntime();
    const tree = await walkTree(linuxUnpacked);
    const logo = findLogo();
    const iconData = logo ? await fsp.readFile(logo) : placeholderPng;

    const desktop = Buffer.from(desktopEntry(slug) + `X-AppImage-Name=${appName}\nX-AppImage-Version=${version}\n`, 'utf8');

    const entries = [
        { kind: 'file', name: 'AppRun', mode: 0o755, content: Buffer.from(appRunScript(), 'utf8') },
        { kind: 'file', name: `${slug}.desktop`, mode: 0o644, content: desktop },
        { kind: 'file', name: `${slug}.png`, mode: 0o644, content: iconData },
        { kind: 'file', name: '.DirIcon', mode: 0o644, content: iconData },
        { kind: 'file', name: `usr/share/applications/${slug}.desktop`, mode: 0o644, content: desktop },
        { kind: 'file', name: `usr/share/icons/hicolor/256x256/apps/${slug}.png`, mode: 0o644, content: iconData }
    ];
    for (const item of mapTree(tree, 'usr/bin')) entries.push(item);

    const squashFile = path.join(work, 'appimage.squashfs');
    await writeSquashfs(squashFile, entries);

    const partial = `${outputs.appImage}.partial`;
    await fsp.rm(partial, { force: true });
    await fsp.copyFile(runtime, partial);
    await appendFileTo(partial, squashFile);
    await fsp.chmod(partial, 0o755);
    return commitFile(partial, outputs.appImage);
}

async function buildRpm() {
    log('RPM paketi oluşturuluyor...');
    const work = path.join(tmpRoot, 'rpm');
    await fsp.mkdir(work, { recursive: true });

    const installDir = `/opt/${slug}`;
    const tree = await walkTree(linuxUnpacked);
    const logo = findLogo();

    const items = [{ kind: 'dir', path: installDir, mode: 0o755 }];
    for (const item of mapTree(tree, installDir, { 'chrome-sandbox': 0o4755 })) items.push({ ...item, path: item.name });
    items.push({ kind: 'symlink', path: `/usr/bin/${slug}`, link: `${installDir}/${binaryName}`, mode: 0o777 });
    items.push({
        kind: 'file',
        path: `/usr/share/applications/${slug}.desktop`,
        mode: 0o644,
        content: Buffer.from(desktopEntry(`/usr/bin/${slug}`), 'utf8')
    });
    if (logo) {
        items.push({
            kind: 'file',
            path: `/usr/share/icons/hicolor/256x256/apps/${slug}.png`,
            mode: 0o644,
            content: await fsp.readFile(logo)
        });
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

    const payloadFile = path.join(work, 'payload.cpio.gz');
    const payloadRawSize = await writeRpmPayload(payloadFile, items, fileModes);

    const release = '1';
    const fullVersion = `${rpmVersion}-${release}`;
    const dependencies = ['gtk3', 'nss', 'libnotify', 'libXScrnSaver', 'libXtst', 'xdg-utils', 'at-spi2-core', 'libuuid', 'libsecret'];
    const requireNames = ['rpmlib(CompressedFileNames)', 'rpmlib(PayloadFilesHavePrefix)'].concat(dependencies);
    const requireFlags = [0x0100000A, 0x0100000A].concat(dependencies.map(() => 0));
    const requireVersions = ['3.0.4-1', '4.0-1'].concat(dependencies.map(() => ''));

    const headerItems = [
        rpmStringArray(100, ['C']),
        rpmString(1000, slug),
        rpmString(1001, rpmVersion),
        rpmString(1002, release),
        rpmI18n(1004, description),
        rpmI18n(1005, description),
        rpmInt32(1006, [epoch]),
        rpmString(1007, 'localhost'),
        rpmInt32(1009, [totalSize]),
        rpmString(1014, license),
        rpmI18n(1016, 'Applications/Internet'),
        rpmString(1021, 'linux'),
        rpmString(1022, 'x86_64'),
        rpmString(1024, rpmScript(true)),
        rpmString(1026, rpmScript(false)),
        rpmInt32(1028, items.map(item => item.size)),
        rpmInt16(1030, fileModes),
        rpmInt16(1033, items.map(() => 0)),
        rpmInt32(1034, items.map(() => epoch)),
        rpmStringArray(1035, digests),
        rpmStringArray(1036, items.map(item => (item.kind === 'symlink' ? item.link : ''))),
        rpmInt32(1037, items.map(() => 0)),
        rpmStringArray(1039, items.map(() => 'root')),
        rpmStringArray(1040, items.map(() => 'root')),
        rpmString(1044, `${slug}-${fullVersion}.src.rpm`),
        rpmInt32(1045, items.map(() => 0xFFFFFFFF)),
        rpmStringArray(1047, [slug, `${slug}(x86-64)`]),
        rpmInt32(1048, requireFlags),
        rpmStringArray(1049, requireNames),
        rpmStringArray(1050, requireVersions),
        rpmString(1064, '4.18.0'),
        rpmInt32(1080, [epoch]),
        rpmStringArray(1081, [`${maintainer} - ${fullVersion}`]),
        rpmStringArray(1082, ['- Otomatik derleme']),
        rpmString(1086, '/bin/sh'),
        rpmString(1088, '/bin/sh'),
        rpmInt32(1095, items.map(() => 1)),
        rpmInt32(1096, items.map((item, index) => index + 1)),
        rpmStringArray(1097, items.map(() => '')),
        rpmInt32(1112, [8, 8]),
        rpmStringArray(1113, [fullVersion, fullVersion]),
        rpmInt32(1116, dirIndexes),
        rpmStringArray(1117, baseNames),
        rpmStringArray(1118, dirNames),
        rpmString(1124, 'cpio'),
        rpmString(1125, 'gzip'),
        rpmString(1126, '9'),
        rpmString(1132, 'x86_64-linux'),
        rpmInt32(5011, [8])
    ];
    if (homepage) headerItems.push(rpmString(1020, homepage));
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
    lead.write(`${slug}-${fullVersion}`.slice(0, 65), 10, 66, 'latin1');
    lead.writeUInt16BE(1, 76);
    lead.writeUInt16BE(5, 78);

    const partial = `${outputs.rpm}.partial`;
    await fsp.writeFile(partial, Buffer.concat([lead, signature, signaturePad, header]));
    await appendFileTo(partial, payloadFile);
    return commitFile(partial, outputs.rpm);
}

async function main() {
    binaryName = await resolveBinary();
    log(`Çalıştırılabilir dosya: ${binaryName}`);

    await fsp.rm(tmpRoot, { recursive: true, force: true });
    await fsp.mkdir(tmpRoot, { recursive: true });

    for (const file of Object.values(outputs)) {
        await fsp.rm(file, { force: true });
        await fsp.rm(`${file}.partial`, { force: true });
    }

    const tasks = [
        ['tar.gz', buildTar],
        ['DEB', buildDeb],
        ['AppImage', buildAppImage],
        ['RPM', buildRpm]
    ];

    const results = await Promise.all(tasks.map(async ([label, task]) => {
        try {
            const result = await task();
            log(`${label} başarıyla oluşturuldu: ${path.basename(result.file)} (${formatSize(result.size)})`);
            return { label, status: 'ok', file: result.file, size: result.size };
        } catch (error) {
            logError(`${label} oluşturulamadı: ${error.message}`);
            return { label, status: 'failed', message: error.message };
        }
    }));

    await fsp.rm(tmpRoot, { recursive: true, force: true });

    const produced = results.filter(r => r.status === 'ok');
    if (produced.length > 0) {
        const lines = [];
        for (const r of produced) {
            lines.push(`${await hashFile(r.file, 'sha256')}  ${path.basename(r.file)}`);
        }
        await fsp.writeFile(path.join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
    }

    console.log('\nÖzet:');
    for (const r of results) {
        if (r.status === 'ok') console.log(`  [OK]   ${r.label}: ${path.basename(r.file)} (${formatSize(r.size)})`);
        else console.log(`  [HATA] ${r.label}: ${r.message}`);
    }

    const failed = results.some(r => r.status === 'failed');
    if (produced.length === 0 || failed) {
        logError('Linux paketleme işlemi hatalarla tamamlandı.');
        process.exit(1);
    }

    log('Linux paketleme işlemi tamamlandı.');
}

main().catch(error => {
    logError('Beklenmeyen hata:', error);
    process.exit(1);
});