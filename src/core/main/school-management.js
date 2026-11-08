'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');

const MANAGEMENT_FILE = 'anka-school-management.json';
const CLIENT_FILE = 'anka-school-management-client.json';
const MAX_BODY = 8192;
const CODE_TTL = 5 * 60 * 1000;
const INVITE_FILE = 'anka-school-invite.ankainvite';
const POLICY_SETTING_RULES = Object.freeze({
    notifications: 'boolean',
    'auto-save': 'boolean',
    'show-welcome-on-start': 'boolean',
    'tab-memory': 'boolean',
    'vertical-tabs': 'boolean',
    'confirm-close-tabs': 'boolean',
    'auto-suspend-tabs': 'boolean',
    'ui-animations': 'boolean',
    'smooth-scrolling': 'boolean',
    'touch-mode': 'boolean',
    'reduce-transparency': 'boolean',
    'search-suggestions': 'boolean',
    'ad-block': 'boolean',
    'track-protect': 'boolean',
    'https-only': 'boolean',
    'do-not-track': 'boolean',
    'block-third-party-cookies': 'boolean',
    'low-end-mode': 'boolean',
    'background-tab-throttling': 'boolean',
    'memory-saver': 'boolean',
    'smart-tab-manager': 'boolean',
    'disk-backed-tab-saver': 'boolean',
    'safe-search': ['off', 'moderate', 'strict'],
    'theme-preset': ['system', 'dark', 'light', 'catppuccin', 'cyberpunk', 'dracula', 'nord', 'oled', 'emerald', 'sunset', 'forest', 'rose', 'slate'],
    'bookmarks-bar': ['auto', 'always', 'never'],
    'sidebar-side': ['left', 'right'],
    'side-panel-side': ['left', 'right'],
    'page-zoom': ['75', '90', '100', '110', '125', '150'],
    'search-engine': ['google', 'yandex', 'bing', 'duckduckgo', 'ecosia', 'brave'],
    'max-live-tabs': { min: 1, max: 30 },
    'tab-sleep-minutes': { min: 0, max: 1440 },
    'font-scale': { min: 80, max: 150, step: 5 },
    'ui-scale': { min: 85, max: 125, step: 5 }
});

function der(tag, value) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (body.length < 128) return Buffer.concat([Buffer.from([tag, body.length]), body]);
    const bytes = [];
    for (let length = body.length; length; length >>= 8) bytes.unshift(length & 255);
    return Buffer.concat([Buffer.from([tag, 0x80 | bytes.length, ...bytes]), body]);
}

function derOid(value) {
    const parts = value.split('.').map(Number);
    const bytes = [parts[0] * 40 + parts[1]];
    for (const part of parts.slice(2)) {
        const encoded = [part & 0x7f];
        let rest = Math.floor(part / 128);
        while (rest) {
            encoded.unshift((rest & 0x7f) | 0x80);
            rest = Math.floor(rest / 128);
        }
        bytes.push(...encoded);
    }
    return der(0x06, Buffer.from(bytes));
}

function derSequence(...values) {
    return der(0x30, Buffer.concat(values));
}

function derSet(...values) {
    return der(0x31, Buffer.concat(values));
}

function derInteger(value) {
    const bytes = Buffer.from(value);
    return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

function createCertificate() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' });
    const signatureAlgorithm = derSequence(derOid('1.2.840.10045.4.3.2'));
    const commonName = derSequence(derOid('2.5.4.3'), der(0x0c, Buffer.from('Anka Web School Admin')));
    const name = derSequence(derSet(commonName));
    const now = new Date();
    const start = new Date(now.getTime() - 86400000);
    const end = new Date(now.getTime() + 31536000000);
    const time = (date) => der(0x17, Buffer.from(
        date.getUTCFullYear().toString().slice(-2) +
        String(date.getUTCMonth() + 1).padStart(2, '0') +
        String(date.getUTCDate()).padStart(2, '0') +
        String(date.getUTCHours()).padStart(2, '0') +
        String(date.getUTCMinutes()).padStart(2, '0') +
        String(date.getUTCSeconds()).padStart(2, '0') + 'Z'
    ));
    const tbs = derSequence(
        der(0xa0, derInteger(Buffer.from([2]))),
        derInteger(crypto.randomBytes(16)),
        signatureAlgorithm,
        name,
        derSequence(time(start), time(end)),
        name,
        publicKey
    );
    const signature = crypto.sign('sha256', tbs, pair.privateKey);
    const certificate = derSequence(tbs, signatureAlgorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
    const pem = '-----BEGIN CERTIFICATE-----\n' +
        certificate.toString('base64').match(/.{1,64}/g).join('\n') +
        '\n-----END CERTIFICATE-----\n';
    return { key: privateKey, cert: pem };
}

function hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function secureEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function privateAddress(address) {
    const family = net.isIP(address);
    if (family === 4) {
        const parts = address.split('.').map(Number);
        return parts[0] === 10 ||
            parts[0] === 127 ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 169 && parts[1] === 254);
    }
    if (family === 6) {
        const normalized = address.toLowerCase();
        return normalized === '::1' || normalized.startsWith('fc') ||
            normalized.startsWith('fd') || normalized.startsWith('fe80:') ||
            normalized.startsWith('::ffff:127.');
    }
    return false;
}

function validatePolicy(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.schoolModeEnabled !== 'boolean' ||
        typeof payload.strictMode !== 'boolean') return null;
    let startUrl;
    try {
        startUrl = new URL(String(payload.startUrl || ''));
        if (startUrl.protocol !== 'https:' && startUrl.protocol !== 'http:') return null;
    } catch (err) {
        return null;
    }
    const maxTabs = Number(payload.maxTabs);
    if (!Number.isInteger(maxTabs) || maxTabs < 1 || maxTabs > 30) return null;
    const settings = {};
    if (payload.settings !== undefined) {
        if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings) ||
            Object.keys(payload.settings).length > Object.keys(POLICY_SETTING_RULES).length) return null;
        for (const [id, value] of Object.entries(payload.settings)) {
            const rule = POLICY_SETTING_RULES[id];
            if (!rule) return null;
            if (rule === 'boolean') {
                if (typeof value !== 'boolean') return null;
            } else if (Array.isArray(rule)) {
                if (typeof value !== 'string' || !rule.includes(value)) return null;
            } else {
                const number = Number(value);
                if (!Number.isInteger(number) || number < rule.min || number > rule.max ||
                    (rule.step && (number - rule.min) % rule.step !== 0)) return null;
                settings[id] = String(number);
                continue;
            }
            settings[id] = value;
        }
    }
    const targetDeviceIds = payload.targetDeviceIds;
    if (targetDeviceIds !== undefined && targetDeviceIds !== null &&
        (!Array.isArray(targetDeviceIds) || targetDeviceIds.length < 1 ||
            targetDeviceIds.length > 500 ||
            targetDeviceIds.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) ||
            new Set(targetDeviceIds).size !== targetDeviceIds.length)) return null;
    return {
        schoolModeEnabled: payload.schoolModeEnabled,
        startUrl: startUrl.href,
        strictMode: payload.strictMode,
        maxTabs,
        settings,
        targetDeviceIds: Array.isArray(targetDeviceIds) ? [...targetDeviceIds] : null
    };
}

function createSchoolManagement(options) {
    const { app, ipcMain, safeStorage, getDataPath, isConfigWindow, applyPolicy, dialog, getWindow } = options;
    const storePath = path.join(getDataPath(), MANAGEMENT_FILE);
    const clientPath = path.join(getDataPath(), CLIENT_FILE);
    let server = null;
    let serverPort = 0;
    let pairing = null;
    let failedPasswords = 0;
    let lockedUntil = 0;
    const rateLimit = new Map();
    const pending = new Map();
    let cachedStore = null;

    function emptyStore() {
        return { version: 1, adminVerifier: null, devices: [], policy: null, certificate: null };
    }

    function readStore() {
        if (cachedStore) return cachedStore;
        try {
            const value = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            if (value && value.version === 1 && Array.isArray(value.devices)) {
                cachedStore = { ...emptyStore(), ...value };
                return cachedStore;
            }
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Okul yönetimi verileri okunamadı:', err);
        }
        cachedStore = emptyStore();
        return cachedStore;
    }

    function writeStore() {
        const store = readStore();
        const temporary = storePath + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
        try {
            fs.mkdirSync(path.dirname(storePath), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify(store), { flag: 'wx', mode: 0o600 });
            fs.renameSync(temporary, storePath);
            return true;
        } catch (err) {
            try { fs.rmSync(temporary, { force: true }); } catch (cleanupError) {}
            console.error('Okul yönetimi verileri kaydedilemedi:', err);
            return false;
        }
    }

    function readClient() {
        if (!safeStorage.isEncryptionAvailable() ||
            (typeof safeStorage.getSelectedStorageBackend === 'function' &&
                safeStorage.getSelectedStorageBackend() === 'basic_text')) {
            return null;
        }
        try {
            const envelope = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
            if (envelope.version !== 1 || typeof envelope.data !== 'string') return null;
            const data = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.data, 'base64')));
            return data && typeof data.host === 'string' &&
                typeof data.token === 'string' && typeof data.fingerprint === 'string' ? data : null;
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Eşleştirilmiş okul yöneticisi okunamadı:', err);
            return null;
        }
    }

    function writeClient(data) {
        if (!safeStorage.isEncryptionAvailable() ||
            (typeof safeStorage.getSelectedStorageBackend === 'function' &&
                safeStorage.getSelectedStorageBackend() === 'basic_text')) {
            return { ok: false, error: 'secure-storage-unavailable' };
        }
        const temporary = clientPath + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
        try {
            fs.mkdirSync(path.dirname(clientPath), { recursive: true });
            const encrypted = safeStorage.encryptString(JSON.stringify(data));
            fs.writeFileSync(temporary, JSON.stringify({
                version: 1,
                data: encrypted.toString('base64')
            }), { flag: 'wx', mode: 0o600 });
            fs.renameSync(temporary, clientPath);
            return { ok: true };
        } catch (err) {
            try { fs.rmSync(temporary, { force: true }); } catch (cleanupError) {}
            console.error('Eşleştirme bilgileri güvenli kaydedilemedi:', err);
            return { ok: false, error: 'secure-storage-write-failed' };
        }
    }

    function publicState() {
        const store = readStore();
        const addresses = [];
        for (const entries of Object.values(os.networkInterfaces())) {
            for (const entry of entries || []) {
                if (!entry.internal && (entry.family === 'IPv4' || entry.family === 4) &&
                    privateAddress(entry.address)) {
                    addresses.push(entry.address);
                }
            }
        }
        return {
            configured: !!store.adminVerifier,
            running: !!(server && server.listening),
            port: serverPort,
            addresses: [...new Set(addresses)],
            pairingExpiresAt: pairing ? pairing.expiresAt : 0,
            pending: Array.from(pending.values())
                .filter((entry) => entry.status === 'pending')
                .map(({ id, name, createdAt }) => ({ id, name, createdAt })),
            devices: store.devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })),
            policy: store.policy,
            deviceName: os.hostname() || app.getName(),
            client: (() => {
                const client = readClient();
                return client ? { host: client.host, port: client.port, deviceId: client.deviceId } : null;
            })()
        };
    }

    function requireAdmin(password) {
        const store = readStore();
        if (Date.now() < lockedUntil) return { ok: false, error: 'locked', retryAfter: lockedUntil };
        if (!store.adminVerifier) return { ok: false, error: 'not-configured' };
        if (!verifyPassword(password, store.adminVerifier)) {
            failedPasswords += 1;
            if (failedPasswords >= 5) {
                failedPasswords = 0;
                lockedUntil = Date.now() + 60000;
            }
            return { ok: false, error: 'invalid-password' };
        }
        failedPasswords = 0;
        return { ok: true };
    }

    function verifyPassword(password, verifier) {
        if (typeof password !== 'string' || password.length > 128 || !verifier) return false;
        try {
            const salt = Buffer.from(verifier.salt, 'hex');
            const expected = Buffer.from(verifier.hash, 'hex');
            const actual = crypto.scryptSync(password, salt, 64);
            return expected.length === 64 && crypto.timingSafeEqual(actual, expected);
        } catch (err) {
            return false;
        }
    }

    function makeVerifier(password) {
        const salt = crypto.randomBytes(16);
        return { salt: salt.toString('hex'), hash: crypto.scryptSync(password, salt, 64).toString('hex') };
    }

    function strongTransferPassword(password) {
        return typeof password === 'string' && password.length >= 14 && password.length <= 128 &&
            /[a-z]/.test(password) && /[A-Z]/.test(password) &&
            /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
    }

    function encryptInvite(invite, password) {
        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const key = crypto.scryptSync(password, salt, 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(invite), 'utf8'),
            cipher.final()
        ]);
        return JSON.stringify({
            version: 1,
            kdf: 'scrypt',
            cipher: 'aes-256-gcm',
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            data: encrypted.toString('base64')
        });
    }

    function decryptInvite(serialized, password) {
        if (typeof serialized !== 'string' || serialized.length > 32768 ||
            typeof password !== 'string' || password.length > 128) {
            throw new Error('invalid-invite-file');
        }
        let envelope;
        try { envelope = JSON.parse(serialized); }
        catch (err) { throw new Error('invalid-invite-file'); }
        if (!envelope || envelope.version !== 1 || envelope.kdf !== 'scrypt' ||
            envelope.cipher !== 'aes-256-gcm') throw new Error('invalid-invite-file');
        const salt = Buffer.from(String(envelope.salt || ''), 'base64');
        const iv = Buffer.from(String(envelope.iv || ''), 'base64');
        const tag = Buffer.from(String(envelope.tag || ''), 'base64');
        const data = Buffer.from(String(envelope.data || ''), 'base64');
        if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 ||
            !data.length || data.length > MAX_BODY) throw new Error('invalid-invite-file');
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(password, salt, 32), iv);
            decipher.setAuthTag(tag);
            const payload = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
            const endpoint = payload && parseHost(payload.host, Number(payload.port));
            const fingerprint = String(payload && payload.fingerprint || '').replace(/:/g, '').toLowerCase();
            if (!endpoint || !/^[a-f0-9]{64}$/.test(fingerprint) ||
                typeof payload.code !== 'string' || !/^\d{12}$/.test(payload.code) ||
                !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) {
                throw new Error('invalid-invite-file');
            }
            return {
                host: endpoint.host,
                port: endpoint.port,
                fingerprint,
                code: payload.code,
                expiresAt: payload.expiresAt,
                deviceName: String(payload.deviceName || '').slice(0, 64)
            };
        } catch (err) {
            if (err.message === 'invalid-invite-file') throw err;
            throw new Error('invite-password-or-file-invalid');
        }
    }

    function respond(response, status, value) {
        const body = Buffer.from(JSON.stringify(value));
        response.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': body.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff'
        });
        response.end(body);
    }

    function readBody(request) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            let settled = false;
            request.on('data', (chunk) => {
                if (settled) return;
                size += chunk.length;
                if (size > MAX_BODY) {
                    settled = true;
                    reject(new Error('body-too-large'));
                    request.resume();
                    return;
                }
                chunks.push(chunk);
            });
            request.on('end', () => {
                if (settled) return;
                settled = true;
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (err) { reject(new Error('invalid-json')); }
            });
            request.on('error', (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
    }

    function authorizedDevice(request) {
        const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization || '');
        if (!match) return null;
        const tokenHash = hash(match[1]);
        const device = readStore().devices.find((entry) => secureEqual(entry.tokenHash, tokenHash));
        if (device) device.lastSeen = Date.now();
        return device || null;
    }

    function withinRateLimit(address) {
        const now = Date.now();
        const state = rateLimit.get(address) || { start: now, count: 0 };
        if (now - state.start > 60000) {
            state.start = now;
            state.count = 0;
        }
        state.count += 1;
        if (rateLimit.size > 1024) rateLimit.delete(rateLimit.keys().next().value);
        rateLimit.set(address, state);
        return state.count <= 30;
    }

    async function handleRequest(request, response) {
        const address = request.socket.remoteAddress || '';
        if (!privateAddress(address.replace(/^::ffff:/i, ''))) {
            respond(response, 403, { error: 'local-network-only' });
            return;
        }
        if (!withinRateLimit(address)) {
            respond(response, 429, { error: 'rate-limited' });
            return;
        }
        const url = new URL(request.url, 'https://anka.local');
        if (request.method === 'GET' && url.pathname === '/v1/ping') {
            respond(response, 200, { ok: true });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/pair/request') {
            let payload;
            try { payload = await readBody(request); } catch (err) {
                respond(response, err.message === 'body-too-large' ? 413 : 400, { error: err.message });
                return;
            }
            if (!pairing || Date.now() > pairing.expiresAt ||
                typeof payload.code !== 'string' || !secureEqual(hash(payload.code), pairing.hash) ||
                typeof payload.deviceId !== 'string' || !/^[a-f0-9-]{36}$/i.test(payload.deviceId) ||
                typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 64) {
                respond(response, 401, { error: 'pairing-rejected' });
                return;
            }
            if (Array.from(pending.values()).some((entry) => entry.deviceId === payload.deviceId)) {
                respond(response, 409, { error: 'request-exists' });
                return;
            }
            if (pending.size >= 20) {
                respond(response, 429, { error: 'too-many-pending-requests' });
                return;
            }
            pairing = null;
            const id = crypto.randomUUID();
            pending.set(id, {
                id,
                deviceId: payload.deviceId,
                name: payload.name.trim(),
                createdAt: Date.now(),
                status: 'pending'
            });
            setTimeout(() => pending.delete(id), 180000).unref();
            respond(response, 202, { requestId: id });
            return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/pair/status') {
            const id = url.searchParams.get('id') || '';
            const entry = pending.get(id);
            if (!entry) {
                respond(response, 404, { status: 'expired' });
                return;
            }
            if (entry.status === 'pending') {
                respond(response, 200, { status: 'pending' });
                return;
            }
            pending.delete(id);
            if (entry.status === 'denied') {
                respond(response, 200, { status: 'denied' });
                return;
            }
            respond(response, 200, { status: 'approved', token: entry.token });
            return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/policy') {
            const device = authorizedDevice(request);
            if (!device) {
                respond(response, 401, { error: 'not-paired' });
                return;
            }
            writeStore();
            const store = readStore();
            const policy = store.policy;
            const allowedPolicy = policy && (!Array.isArray(policy.targetDeviceIds) ||
                policy.targetDeviceIds.includes(device.id)) ? { ...policy } : null;
            if (allowedPolicy) delete allowedPolicy.targetDeviceIds;
            respond(response, 200, {
                revision: store.policyRevision || 0,
                policy: allowedPolicy
            });
            return;
        }
        respond(response, 404, { error: 'not-found' });
    }

    function ensureCertificate() {
        const store = readStore();
        if (store.certificate && typeof store.certificate.key === 'string' &&
            typeof store.certificate.cert === 'string') {
            if (store.certificate.encrypted !== true) throw new Error('certificate-not-encrypted');
            try {
                return {
                    key: safeStorage.decryptString(Buffer.from(store.certificate.key, 'base64')),
                    cert: store.certificate.cert
                };
            } catch (err) {
                console.error('Okul yönetimi TLS anahtarı açılamadı:', err);
                throw new Error('certificate-decryption-failed');
            }
        }
        if (!safeStorage.isEncryptionAvailable() ||
            (typeof safeStorage.getSelectedStorageBackend === 'function' &&
                safeStorage.getSelectedStorageBackend() === 'basic_text')) {
            throw new Error('secure-storage-unavailable');
        }
        const generated = createCertificate();
        store.certificate = {
            key: safeStorage.encryptString(generated.key).toString('base64'),
            cert: generated.cert,
            encrypted: true
        };
        if (!writeStore()) throw new Error('certificate-store-failed');
        return generated;
    }

    function startServer() {
        if (server && server.listening) return Promise.resolve(serverPort);
        const certificate = ensureCertificate();
        server = https.createServer({ key: certificate.key, cert: certificate.cert }, (request, response) => {
            handleRequest(request, response).catch((err) => {
                console.error('Okul yönetimi isteği başarısız:', err);
                if (!response.headersSent) respond(response, 500, { error: 'request-failed' });
            });
        });
        server.on('clientError', (err, socket) => {
            console.error('Okul yönetimi TLS bağlantısı reddedildi:', err.message);
            if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });
        return new Promise((resolve, reject) => {
            const onError = (err) => {
                server.removeListener('listening', onListening);
                server = null;
                reject(err);
            };
            const onListening = () => {
                server.removeListener('error', onError);
                serverPort = server.address().port;
                resolve(serverPort);
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(0, '0.0.0.0');
        });
    }

    function stopServer() {
        pairing = null;
        pending.clear();
        rateLimit.clear();
        if (!server) return Promise.resolve();
        const current = server;
        server = null;
        serverPort = 0;
        return new Promise((resolve) => current.close(() => resolve()));
    }

    function requestPinned(host, port, fingerprint, optionsForRequest) {
        return new Promise((resolve, reject) => {
            const request = https.request({
                hostname: host,
                port,
                method: optionsForRequest.method || 'GET',
                path: optionsForRequest.path,
                headers: optionsForRequest.headers || {},
                rejectUnauthorized: false,
                timeout: 8000
            }, (response) => {
                const certificate = response.socket.getPeerCertificate();
                const actual = String(certificate.fingerprint256 || '').replace(/:/g, '').toLowerCase();
                const expected = String(fingerprint || '').replace(/:/g, '').toLowerCase();
                if (!actual || !/^[a-f0-9]{64}$/.test(expected) || !secureEqual(actual, expected)) {
                    response.resume();
                    reject(new Error('fingerprint-mismatch'));
                    return;
                }
                let size = 0;
                const chunks = [];
                response.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_BODY) {
                        request.destroy(new Error('response-too-large'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    try {
                        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        if (response.statusCode < 200 || response.statusCode >= 300) {
                            reject(new Error(data.error || 'request-failed'));
                        } else resolve(data);
                    } catch (err) { reject(err); }
                });
            });
            request.on('timeout', () => request.destroy(new Error('timeout')));
            request.on('error', reject);
            if (optionsForRequest.body) request.write(JSON.stringify(optionsForRequest.body));
            request.end();
        });
    }

    function parseHost(host, port) {
        const value = String(host || '').trim().replace(/^\[|\]$/g, '');
        if (!privateAddress(value) || !Number.isInteger(Number(port)) ||
            Number(port) < 1 || Number(port) > 65535) return null;
        return { host: value, port: Number(port) };
    }

    function register(name, handler) {
        ipcMain.handle('school-management:' + name, (event, ...args) => {
            if (!isConfigWindow(event.sender)) return { ok: false, error: 'not-authorized' };
            return handler(event, ...args);
        });
    }

    register('state', (_event, password) => {
        const state = publicState();
        if (!state.configured) return { ok: true, state };
        if (typeof password !== 'string') {
            return { ok: true, state: { ...state, pending: [], devices: [], policy: null } };
        }
        const checked = requireAdmin(password);
        return checked.ok ? { ok: true, state } : checked;
    });

    register('authenticate', (_event, password) => {
        const checked = requireAdmin(password);
        return checked.ok ? { ok: true } : checked;
    });

    register('setup', (_event, password) => {
        const store = readStore();
        if (store.adminVerifier) return { ok: false, error: 'already-configured' };
        if (typeof password !== 'string' || password.length < 14 || password.length > 128 ||
            !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
            !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
            return { ok: false, error: 'weak-password' };
        }
        store.adminVerifier = makeVerifier(password);
        if (!writeStore()) return { ok: false, error: 'save-failed' };
        return { ok: true, state: publicState() };
    });

    register('start', async (_event, password) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        try {
            await startServer();
            return { ok: true, state: publicState() };
        } catch (err) {
            console.error('Okul yönetimi sunucusu başlatılamadı:', err);
            return { ok: false, error: 'server-start-failed' };
        }
    });

    register('stop', async (_event, password) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        await stopServer();
        return { ok: true, state: publicState() };
    });

    register('new-code', (_event, password) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        if (!server || !server.listening) return { ok: false, error: 'server-not-running' };
        const code = crypto.randomInt(0, 1000000000000).toString().padStart(12, '0');
        pairing = { hash: hash(code), expiresAt: Date.now() + CODE_TTL };
        setTimeout(() => {
            if (pairing && pairing.hash === hash(code)) pairing = null;
        }, CODE_TTL).unref();
        return { ok: true, code, expiresAt: pairing.expiresAt, fingerprint: new crypto.X509Certificate(readStore().certificate.cert).fingerprint256 };
    });

    register('export-invite', async (event, password, transferPassword, host) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        if (!server || !server.listening) return { ok: false, error: 'server-not-running' };
        if (!strongTransferPassword(transferPassword)) return { ok: false, error: 'weak-transfer-password' };
        const state = publicState();
        const endpoint = parseHost(host, serverPort);
        if (!endpoint || !state.addresses.includes(endpoint.host)) return { ok: false, error: 'invalid-invite-host' };
        if (!dialog || typeof dialog.showSaveDialog !== 'function') return { ok: false, error: 'file-dialog-unavailable' };
        const owner = typeof getWindow === 'function' ? getWindow(event) : undefined;
        const choice = await dialog.showSaveDialog(owner, {
            title: 'Şifreli okul davet dosyasını kaydet',
            defaultPath: path.join(app.getPath('downloads'),
                'anka-davet-' + crypto.randomBytes(18).toString('hex') + '.ankainvite'),
            buttonLabel: 'Şifreli dosyayı kaydet',
            filters: [{ name: 'Anka Web Şifreli Davet', extensions: ['ankainvite'] }]
        });
        if (choice.canceled || !choice.filePath) return { ok: false, error: 'cancelled' };
        const code = crypto.randomInt(0, 1000000000000).toString().padStart(12, '0');
        const expiresAt = Date.now() + CODE_TTL;
        const fingerprint = new crypto.X509Certificate(readStore().certificate.cert).fingerprint256
            .replace(/:/g, '').toLowerCase();
        const content = encryptInvite({
            version: 1,
            host: endpoint.host,
            port: endpoint.port,
            fingerprint,
            code,
            expiresAt,
            deviceName: os.hostname() || app.getName()
        }, transferPassword);
        pairing = { hash: hash(code), expiresAt };
        setTimeout(() => {
            if (pairing && pairing.hash === hash(code)) pairing = null;
        }, CODE_TTL).unref();
        try {
            fs.writeFileSync(choice.filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'w' });
        } catch (err) {
            if (pairing && pairing.hash === hash(code)) pairing = null;
            console.error('Şifreli okul daveti kaydedilemedi:', err);
            return { ok: false, error: 'invite-save-failed' };
        }
        return { ok: true, filePath: choice.filePath, expiresAt };
    });

    register('import-invite', async (event, transferPassword) => {
        if (typeof transferPassword !== 'string' || transferPassword.length > 128) {
            return { ok: false, error: 'invite-password-or-file-invalid' };
        }
        if (!dialog || typeof dialog.showOpenDialog !== 'function') return { ok: false, error: 'file-dialog-unavailable' };
        const owner = typeof getWindow === 'function' ? getWindow(event) : undefined;
        const choice = await dialog.showOpenDialog(owner, {
            title: 'Şifreli okul davet dosyasını seç',
            buttonLabel: 'Davet dosyasını aç',
            properties: ['openFile'],
            filters: [{ name: 'Anka Web Şifreli Davet', extensions: ['ankainvite'] }]
        });
        if (choice.canceled || !choice.filePaths || !choice.filePaths[0]) return { ok: false, error: 'cancelled' };
        try {
            const stat = fs.statSync(choice.filePaths[0]);
            if (!stat.isFile() || stat.size > 32768) return { ok: false, error: 'invalid-invite-file' };
            const invite = decryptInvite(fs.readFileSync(choice.filePaths[0], 'utf8'), transferPassword);
            return { ok: true, invite };
        } catch (err) {
            const error = err.message === 'invite-password-or-file-invalid' ||
                err.message === 'invalid-invite-file' ? err.message : 'invite-read-failed';
            if (error === 'invite-read-failed') console.error('Şifreli okul daveti okunamadı:', err);
            return { ok: false, error };
        }
    });

    register('approve', (_event, password, requestId) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        const request = pending.get(String(requestId || ''));
        if (!request || request.status !== 'pending') return { ok: false, error: 'request-expired' };
        const token = crypto.randomBytes(32).toString('hex');
        const store = readStore();
        store.devices = store.devices.filter((device) => device.id !== request.deviceId);
        store.devices.push({
            id: request.deviceId,
            name: request.name,
            tokenHash: hash(token),
            pairedAt: Date.now(),
            lastSeen: Date.now()
        });
        request.status = 'approved';
        request.token = token;
        if (!writeStore()) {
            pending.delete(request.id);
            return { ok: false, error: 'save-failed' };
        }
        return { ok: true, state: publicState() };
    });

    register('deny', (_event, password, requestId) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        const request = pending.get(String(requestId || ''));
        if (!request) return { ok: false, error: 'request-expired' };
        request.status = 'denied';
        return { ok: true, state: publicState() };
    });

    register('revoke', (_event, password, deviceId) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        const store = readStore();
        const previous = store.devices.length;
        store.devices = store.devices.filter((device) => device.id !== deviceId);
        if (previous === store.devices.length) return { ok: false, error: 'device-not-found' };
        if (store.policy && Array.isArray(store.policy.targetDeviceIds)) {
            store.policy.targetDeviceIds = store.policy.targetDeviceIds.filter((id) => id !== deviceId);
        }
        if (!writeStore()) return { ok: false, error: 'save-failed' };
        return { ok: true, state: publicState() };
    });

    register('set-policy', (_event, password, payload) => {
        const checked = requireAdmin(password);
        if (!checked.ok) return checked;
        const policy = validatePolicy(payload);
        if (!policy) return { ok: false, error: 'invalid-policy' };
        const store = readStore();
        if (Array.isArray(policy.targetDeviceIds) &&
            policy.targetDeviceIds.some((id) => !store.devices.some((device) => device.id === id))) {
            return { ok: false, error: 'invalid-policy-targets' };
        }
        store.policy = policy;
        store.policyRevision = (store.policyRevision || 0) + 1;
        if (!writeStore()) return { ok: false, error: 'save-failed' };
        return { ok: true, state: publicState() };
    });

    register('join', async (_event, payload) => {
        if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid-request' };
        const endpoint = parseHost(payload.host, Number(payload.port));
        const fingerprint = String(payload.fingerprint || '').replace(/:/g, '').toLowerCase();
        const code = String(payload.code || '');
        if (!endpoint || !/^[a-f0-9]{64}$/.test(fingerprint) || !/^\d{12}$/.test(code)) {
            return { ok: false, error: 'invalid-connection-details' };
        }
        if (!safeStorage.isEncryptionAvailable() ||
            (typeof safeStorage.getSelectedStorageBackend === 'function' &&
                safeStorage.getSelectedStorageBackend() === 'basic_text')) {
            return { ok: false, error: 'secure-storage-unavailable' };
        }
        const deviceId = crypto.randomUUID();
        const name = String(payload.name || app.getName()).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || app.getName();
        try {
            await requestPinned(endpoint.host, endpoint.port, fingerprint, { path: '/v1/ping' });
            const queued = await requestPinned(endpoint.host, endpoint.port, fingerprint, {
                method: 'POST',
                path: '/v1/pair/request',
                headers: { 'content-type': 'application/json' },
                body: { code, deviceId, name }
            });
            for (let attempt = 0; attempt < 180; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const result = await requestPinned(endpoint.host, endpoint.port, fingerprint, {
                    path: '/v1/pair/status?id=' + encodeURIComponent(queued.requestId)
                });
                if (result.status === 'denied') return { ok: false, error: 'request-denied' };
                if (result.status === 'expired') return { ok: false, error: 'request-expired' };
                if (result.status === 'approved' && typeof result.token === 'string') {
                    const saved = writeClient({
                        host: endpoint.host,
                        port: endpoint.port,
                        fingerprint,
                        deviceId,
                        token: result.token
                    });
                    return saved.ok ? { ok: true, state: publicState() } : saved;
                }
            }
            return { ok: false, error: 'approval-timeout' };
        } catch (err) {
            console.error('Okul yöneticisiyle eşleştirme başarısız:', err);
            const error = err.message === 'fingerprint-mismatch' ? 'fingerprint-mismatch' :
                err.message === 'pairing-rejected' ? 'pairing-rejected' :
                    err.message === 'request-exists' ? 'request-exists' : 'connection-failed';
            return { ok: false, error };
        }
    });

    register('check-policy', async () => {
        const client = readClient();
        if (!client) return { ok: false, error: 'not-paired' };
        try {
            const result = await requestPinned(client.host, client.port, client.fingerprint, {
                path: '/v1/policy',
                headers: { authorization: 'Bearer ' + client.token }
            });
            if (!result.policy) return { ok: true, policy: null, revision: result.revision };
            const policy = validatePolicy(result.policy);
            if (!policy) return { ok: false, error: 'invalid-policy-from-host' };
            return { ok: true, policy, revision: result.revision };
        } catch (err) {
            console.error('Okul politikası alınamadı:', err);
            const error = err.message === 'fingerprint-mismatch' ? 'fingerprint-mismatch' :
                err.message === 'not-paired' ? 'device-revoked' : 'connection-failed';
            return { ok: false, error };
        }
    });

    register('apply-policy', async (event, payload) => {
        const client = readClient();
        if (!client) return { ok: false, error: 'not-paired' };
        const policy = validatePolicy(payload);
        if (!policy) return { ok: false, error: 'invalid-policy' };
        try {
            await applyPolicy(event, policy);
            return { ok: true };
        } catch (err) {
            console.error('Okul politikası uygulanamadı:', err);
            return { ok: false, error: 'policy-apply-failed' };
        }
    });

    register('disconnect', async () => {
        try {
            await fs.promises.rm(clientPath, { force: true });
            return { ok: true, state: publicState() };
        } catch (err) {
            console.error('Okul yöneticisi bağlantısı kaldırılamadı:', err);
            return { ok: false, error: 'disconnect-failed' };
        }
    });

    app.on('before-quit', () => {
        if (server) {
            try { server.close(); } catch (err) {}
            server = null;
        }
    });
}

module.exports = { createSchoolManagement, createCertificate };
