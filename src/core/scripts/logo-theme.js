(function () {
    'use strict';
    if (window.__ankaLogoThemeLoaded) return;
    window.__ankaLogoThemeLoaded = true;

    function resolveIconsBase() {
        try {
            const list = document.querySelectorAll('script[src*="logo-theme"]');
            const s = list[list.length - 1];
            if (s && s.src) {
                const u = new URL(s.src);
                u.pathname = u.pathname.replace(/\/scripts\/[^\/]+$/, '/icons/');
                u.search = '';
                u.hash = '';
                return u.href.replace(/\/$/, '') + '/';
            }
        } catch (e) {}
        return '../../src/icons/';
    }

    const ICONS_BASE = resolveIconsBase();
    const LOGO_NORMAL = ICONS_BASE + 'dark-logo.png';
    const LOGO_WHITE = ICONS_BASE + 'white-dark-logo.png';

    function isLight() {
        const html = document.documentElement;
        const body = document.body;
        return (
            (html && html.classList.contains('light-theme')) ||
            (body && body.classList.contains('light-theme')) ||
            (html && html.dataset.themePreset === 'light')
        );
    }

    function currentLogo() {
        return isLight() ? LOGO_WHITE : LOGO_NORMAL;
    }

    window.ankaGetLogo = currentLogo;
    window.ankaLogoNormal = LOGO_NORMAL;
    window.ankaLogoWhite = LOGO_WHITE;

    function updateCssVar() {
        document.documentElement.style.setProperty(
            '--anka-logo-url',
            'url("' + currentLogo() + '")'
        );
    }

    function isLogoPath(src) {
        return /\/(white-)?logo\.(png|svg|ico|webp)(\?.*)?$/i.test(String(src || ''));
    }

    function swapImg(img) {
        if (!img || img.tagName !== 'IMG') return;
        const current = img.getAttribute('src') || '';
        let base = img.getAttribute('data-anka-logo-base');

        if (!base) {
            if (!isLogoPath(current)) return;
            base = current.replace(/white-logo\.(png|svg|ico|webp)/i, 'logo.$1');
            img.setAttribute('data-anka-logo-base', base);
        }

        const whiteSrc = base.replace(/logo\.(png|svg|ico|webp)/i, 'white-logo.$1');
        const target = isLight() ? whiteSrc : base;

        if (current !== target) {
            img.setAttribute('src', target);
        }
    }

    function swapFavicons() {
        document
            .querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
            .forEach(function (link) {
                const href = link.getAttribute('href') || '';
                if (/^(data:|https?:)/i.test(href)) return;
                const marked = link.getAttribute('data-anka-logo') === 'true';
                if (!marked && !isLogoPath(href)) return;
                link.setAttribute('data-anka-logo', 'true');
                link.setAttribute('href', currentLogo());
            });
    }

    function refresh() {
        updateCssVar();
        document.querySelectorAll('img').forEach(swapImg);
        swapFavicons();
    }

    function startObservers() {
        const themeObs = new MutationObserver(refresh);
        themeObs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-theme-preset']
        });
        if (document.body) {
            themeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

            const domObs = new MutationObserver(function (mutations) {
                for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.type === 'childList') {
                        for (let j = 0; j < m.addedNodes.length; j++) {
                            const n = m.addedNodes[j];
                            if (n.nodeType !== 1) continue;
                            if (n.tagName === 'IMG') swapImg(n);
                            else if (n.querySelectorAll) n.querySelectorAll('img').forEach(swapImg);
                        }
                    } else if (m.type === 'attributes' && m.attributeName === 'src') {
                        swapImg(m.target);
                    }
                }
            });

            domObs.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });
        }
    }

    function init() {
        refresh();
        startObservers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('storage', function (e) {
        if (e.key === 'set_theme-preset') refresh();
    });

    window.addEventListener('anka-theme-changed', refresh);
    window.ankaRefreshLogos = refresh;
})();