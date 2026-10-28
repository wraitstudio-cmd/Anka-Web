const path = require('path');
const { app } = require('electron');

const SAFE_PROTOCOL = /^(https?:|file:|about:)/i;

function applyBrowserSecurity(options = {}) {
    const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'media'].concat(options.allowedPermissions || []));
    const preloadRoot = path.resolve(options.preloadRoot || app.getAppPath());

    app.on('web-contents-created', (_event, contents) => {
        const type = contents.getType();

        if (type === 'webview') {
            contents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            contents.setWindowOpenHandler(() => ({ action: 'deny' }));
            contents.on('will-navigate', (event, url) => {
                if (!SAFE_PROTOCOL.test(url)) event.preventDefault();
            });
            contents.on('did-navigate', (event, url) => {
                if (url.includes('youtube.com')) {
                    contents.executeJavaScript(`
                        (() => {
                            const enforceRestrictions = () => {
                                const urlObj = new URL(location.href);
                                let modified = false;
                                if (urlObj.searchParams.get('safe') !== 'active') {
                                    urlObj.searchParams.set('safe', 'active');
                                    modified = true;
                                }
                                if (urlObj.searchParams.get('restrict') !== 'strict') {
                                    urlObj.searchParams.set('restrict', 'strict');
                                    modified = true;
                                }
                                if (modified) {
                                    location.replace(urlObj.toString());
                                }
                            };
                            enforceRestrictions();
                            const observer = new MutationObserver(enforceRestrictions);
                            observer.observe(document, { subtree: true, childList: true });
                        })();
                    `).catch(() => {});
                }
            });
            return;
        }

        contents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        contents.on('will-navigate', (event) => event.preventDefault());
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));

        contents.on('will-attach-webview', (event, webPreferences, params) => {
            webPreferences.nodeIntegration = false;
            webPreferences.nodeIntegrationInSubFrames = false;
            webPreferences.nodeIntegrationInWorker = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.webSecurity = true;
            webPreferences.allowRunningInsecureContent = false;
            webPreferences.experimentalFeatures = false;
            delete params.allowpopups;
            delete params.disablewebsecurity;

            if (webPreferences.preload) {
                const resolved = path.resolve(webPreferences.preload);
                if (!resolved.startsWith(preloadRoot + path.sep)) delete webPreferences.preload;
            }
            if (params.src && !SAFE_PROTOCOL.test(params.src)) event.preventDefault();
        });
    });

    const hardenSession = (ses) => {
        ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
        ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
        ses.webRequest.onBeforeRequest((details, callback) => {
            try {
                const url = new URL(details.url);
                if (url.hostname.includes('youtube.com')) {
                    let modified = false;
                    if (url.searchParams.get('safe') !== 'active') {
                        url.searchParams.set('safe', 'active');
                        modified = true;
                    }
                    if (url.searchParams.get('restrict') !== 'strict') {
                        url.searchParams.set('restrict', 'strict');
                        modified = true;
                    }
                    if (modified) {
                        return callback({ redirectUrl: url.toString() });
                    }
                }
            } catch (err) {}
            callback({});
        });
    };

    app.on('session-created', hardenSession);
    app.whenReady().then(() => {
        const { session } = require('electron');
        hardenSession(session.defaultSession);
    });
}

module.exports = { applyBrowserSecurity };