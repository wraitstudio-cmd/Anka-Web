(function () {
    'use strict';

    if (window.__ankaSettingsLoaded) return;
    window.__ankaSettingsLoaded = true;
    const ANKA_I18N = window.AnkaI18n;

    const THEME_IDS = ['system', 'dark', 'light', 'catppuccin', 'cyberpunk', 'dracula', 'nord', 'oled', 'emerald', 'sunset', 'forest', 'rose', 'slate'];
    const THEME_CLASSES = ['light-theme', 'theme-catppuccin', 'theme-cyberpunk', 'theme-dracula', 'theme-nord', 'theme-oled', 'theme-emerald', 'theme-sunset', 'theme-forest', 'theme-rose', 'theme-slate'];
    const lightMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : { matches: false };
    const reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const LOW_END = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2 || reducedMQ.matches;

    const SCHOOL_POLICY = {
        'dev-tools-shortcut': 'false',
        'ai-mode-active': 'false',
        'search-suggestions': 'false',
        'notifications': 'false',
        'password-manager': 'false',
        'ad-block': 'true',
        'track-protect': 'true',
        'https-only': 'true',
        'max-tabs': '6',
        'max-live-tabs': '6',
        'safe-search': 'strict',
        'touch-mode': 'true',
        'ui-animations': 'false',
        'reduce-transparency': 'true'
    };
    const PLAYER_POLICY = {
        'theme-preset': 'dark',
        'auto-theme': 'false',
        'ui-animations': 'false',
        'smooth-scrolling': 'false',
        'reduce-transparency': 'true',
        'fps-meter': 'true'
    };

    const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

    const lsGet = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
    const lsSet = (key, value) => { try { localStorage.setItem(key, String(value)); return true; } catch (e) { return false; } };
    const lsRemove = (key) => { try { localStorage.removeItem(key); } catch (e) {} };

    let localArea = null;
    try { localArea = window.localStorage; } catch (e) {}

    const SETTINGS_CSS = `
:root{--sp-transition-duration:.22s;--sp-transition-curve:cubic-bezier(.16,1,.3,1)}
#settings-panel{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.96);width:920px;height:min(700px,calc(100vh - 40px));max-width:94vw;max-height:94vh;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.5),0 0 0 1px var(--border-color,#27272a);z-index:100001;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;opacity:0;transition:transform var(--sp-transition-duration) var(--sp-transition-curve),opacity var(--sp-transition-duration) ease;overflow:hidden;box-sizing:border-box;contain:layout style paint}
#settings-panel *{box-sizing:border-box}
#settings-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:100000;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);transition:opacity var(--sp-transition-duration) ease;opacity:0}
#settings-overlay.visible{opacity:1}
html.reduce-effects #settings-panel,html.reduce-effects #settings-overlay{--sp-transition-duration:0s}
html.reduce-effects #settings-panel *{transition:none!important;animation:none!important}
html[data-density="compact"] #settings-panel{--sp-density:.82}
html[data-density="comfortable"] #settings-panel{--sp-density:1.15}
.settings-layout{display:flex;height:100%;width:100%}
.settings-sidebar{width:224px;flex-shrink:0;background:var(--bg-primary,#121214);padding:16px 10px 12px;border-right:1px solid var(--border-color,#27272a);display:flex;flex-direction:column;gap:2px;overflow-y:auto;scrollbar-width:thin;overflow-x:hidden;contain:layout style}
.settings-brand{display:flex;align-items:center;gap:10px;padding:4px 10px 16px;font-size:15px;font-weight:700;color:var(--text-color,#f4f4f5)}
.settings-guide-button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:42px;margin:0 4px 12px;padding:8px 10px;border:1px solid var(--border-color,#27272a);border-radius:9px;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);font:600 12px 'Segoe UI',system-ui,sans-serif;text-align:center;cursor:pointer;touch-action:manipulation}
.settings-guide-button:hover{border-color:var(--accent,#ff4757);background:rgba(255,71,87,.1)}
.settings-brand-icon{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent,#ff4757),var(--accent-2,#ff7a45));display:grid;place-items:center;color:#fff;font-size:14px;flex-shrink:0}
.settings-nav-item{padding:9px 12px;cursor:pointer;border-radius:9px;color:var(--text-secondary,#a1a1aa);font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;user-select:none;transition:background-color .15s ease,color .15s ease;position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.settings-nav-item:hover{background:var(--bg-tertiary,#27272a);color:var(--text-color,#f4f4f5)}
.settings-nav-item.active{background:rgba(255,71,87,.14);color:var(--accent,#ff4757)}
.settings-nav-item .nav-icon{width:16px;height:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;opacity:.85}
.settings-nav-item .nav-icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.settings-nav-item .nav-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.settings-nav-item .nav-count{margin-left:auto;font-size:10px;background:var(--bg-tertiary,#27272a);color:var(--text-secondary,#a1a1aa);padding:1px 7px;border-radius:9px;font-variant-numeric:tabular-nums;flex-shrink:0}
.settings-nav-item.active .nav-count{background:rgba(255,71,87,.2);color:var(--accent,#ff4757)}
.settings-nav-item.danger{color:#f28b82}
.settings-nav-item.danger:hover{background:rgba(239,68,68,.12);color:#ef4444}
.settings-nav-item.danger-strong{color:#ef4444}
.settings-nav-item.danger-strong:hover{background:#ef4444;color:#fff}
.settings-nav-spacer{flex:1;min-height:12px}
.settings-nav-divider{height:1px;background:var(--border-color,#27272a);margin:8px 10px}
.settings-content{flex:1;overflow-y:auto;background:var(--bg-secondary,#18181b);position:relative;scrollbar-width:thin;overflow-x:hidden;contain:layout style}
html.smooth .settings-content{scroll-behavior:smooth}
.settings-header{position:sticky;top:0;z-index:2;background:var(--bg-secondary,#18181b);padding:16px 26px 10px;border-bottom:1px solid var(--border-color,#27272a);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.settings-header-top{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.settings-title{font-size:18px;font-weight:700;margin:0;flex:1;min-width:0;color:var(--text-color,#f4f4f5)}
.settings-title small{display:block;font-size:11px;font-weight:500;color:var(--text-secondary,#a1a1aa);margin-top:2px}
.settings-search-wrap{position:relative;flex:1;max-width:280px;min-width:0}
.settings-search{width:100%;height:34px;padding:0 12px 0 34px;border:1px solid var(--border-color,#27272a);background:var(--bg-primary,#121214);color:var(--text-color,#f4f4f5);border-radius:8px;font:inherit;font-size:12.5px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.settings-search:focus{border-color:var(--accent,#ff4757);box-shadow:0 0 0 3px rgba(255,71,87,.14)}
.settings-search-wrap .search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-secondary,#a1a1aa);pointer-events:none}
.settings-search-wrap .search-icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.settings-header-actions{display:flex;gap:6px;flex-shrink:0}
.sp-hdr-btn{background:var(--bg-tertiary,#27272a);border:1px solid var(--border-color,#27272a);color:var(--text-color,#f4f4f5);height:34px;padding:0 11px;border-radius:8px;font-size:11.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.sp-hdr-btn:hover{background:var(--bg-elevated,#3f3f46);border-color:var(--border-hover,#52525b)}
.sp-hdr-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.sp-hdr-btn#close-settings-btn:hover{background:#ef4444;border-color:#ef4444;color:#fff}
.sp-search-hint{display:none;font-size:11px;color:var(--text-secondary,#a1a1aa);padding:0 26px 10px;font-variant-numeric:tabular-nums}
.sp-search-hint.visible{display:block}
.settings-body{padding:14px 26px 26px;min-height:0}
.sp-group{margin-bottom:18px;border:1px solid var(--border-color,#27272a);border-radius:12px;background:var(--bg-primary,#121214);transition:border-color .15s ease;overflow:hidden;contain:layout style}
.sp-group:hover{border-color:var(--border-hover,#52525b)}
.sp-group-header{display:flex;align-items:center;gap:10px;padding:calc(12px * var(--sp-density,1)) calc(16px * var(--sp-density,1));cursor:pointer;user-select:none;background:var(--bg-primary,#121214);transition:background-color .15s ease;font-size:13px;font-weight:600;color:var(--text-color,#f4f4f5)}
.sp-group-header:hover{background:var(--bg-tertiary,#27272a)}
.sp-group-header .gp-icon{width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--accent,#ff4757)}
.sp-group-header .gp-icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.sp-group-header .gp-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-group-header .gp-badge{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--bg-elevated,#3f3f46);color:var(--text-secondary,#a1a1aa);font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.sp-group-header .gp-arrow{width:16px;height:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--text-secondary,#a1a1aa);transition:transform .25s var(--sp-transition-curve)}
.sp-group-header .gp-arrow svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.sp-group.collapsed .sp-group-header .gp-arrow{transform:rotate(-90deg)}
.sp-group-body{max-height:4000px;overflow:hidden;transition:max-height .28s var(--sp-transition-curve);contain:layout style}
.sp-group.collapsed .sp-group-body{max-height:0}
html.reduce-effects .sp-group-body{transition:none;contain:none;content-visibility:auto}
.sp-item{display:flex;align-items:center;justify-content:space-between;padding:calc(12px * var(--sp-density,1)) calc(16px * var(--sp-density,1));border-top:1px solid var(--border-color,#27272a);gap:calc(16px * var(--sp-density,1));transition:background-color .15s ease;position:relative}
.sp-item:first-child{border-top:none}
.sp-item:hover{background:rgba(255,255,255,.02)}
.sp-item.changed{background:rgba(255,71,87,.04)}
.sp-item.changed::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;background:var(--accent,#ff4757);border-radius:0 2px 2px 0}
.sp-item.locked{opacity:.62}
.sp-item-main{flex:1;min-width:0}
.sp-item-label{font-size:13px;font-weight:500;color:var(--text-color,#f4f4f5);margin-bottom:2px;display:flex;align-items:center;gap:6px}
.sp-item-label .changed-dot{width:6px;height:6px;border-radius:50%;background:var(--accent,#ff4757);flex-shrink:0}
.sp-item-desc{font-size:11.5px;color:var(--text-secondary,#a1a1aa);line-height:1.45;overflow-wrap:anywhere}
.sp-item-desc .lock-note{color:#fbbf24}
.sp-item-ctl{display:flex;align-items:center;gap:10px;flex-shrink:0}
.sp-toggle{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0;cursor:pointer}
.sp-toggle input{opacity:0;width:0;height:0;position:absolute}
.sp-slider{position:absolute;inset:0;background-color:var(--bg-elevated,#3f3f46);border-radius:20px;transition:background-color .18s ease}
.sp-slider::before{content:"";position:absolute;height:14px;width:14px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:transform .2s var(--sp-transition-curve);box-shadow:0 1px 3px rgba(0,0,0,.2)}
.sp-toggle input:checked+.sp-slider{background-color:var(--accent,#ff4757)}
.sp-toggle input:checked+.sp-slider::before{transform:translateX(16px)}
.sp-toggle input:disabled+.sp-slider{cursor:not-allowed;opacity:.5}
.sp-select,.sp-text,.sp-css-editor{background:var(--bg-tertiary,#27272a);color:var(--text-color,#f4f4f5);border:1px solid var(--border-color,#27272a);padding:6px 10px;border-radius:7px;font-size:12px;outline:none;flex-shrink:0;transition:border-color .15s ease,box-shadow .15s ease}
.sp-select:focus,.sp-text:focus,.sp-css-editor:focus{border-color:var(--accent,#ff4757);box-shadow:0 0 0 2px rgba(255,71,87,.14)}
.sp-select{min-width:140px;cursor:pointer}
.sp-text{width:200px;max-width:100%}
.sp-css-editor{width:min(440px,54vw);min-height:130px;resize:vertical;font:11px/1.5 ui-monospace,Consolas,monospace}
.sp-select:disabled,.sp-text:disabled,.sp-css-editor:disabled{cursor:not-allowed;opacity:.5}
.sp-range{display:flex;align-items:center;gap:8px;width:min(220px,50vw)}
.sp-range input[type=range]{flex:1;width:100%;accent-color:var(--accent,#ff4757);cursor:pointer;touch-action:pan-y}
.sp-range output{min-width:40px;color:var(--accent,#ff4757);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.sp-color-wrap{display:flex;align-items:center;gap:8px;flex-shrink:0}
.sp-color{width:32px;height:32px;padding:0;border:1px solid var(--border-color,#27272a);border-radius:8px;background:none;cursor:pointer;overflow:hidden}
.sp-color::-webkit-color-swatch-wrapper{padding:2px}
.sp-color::-webkit-color-swatch{border:none;border-radius:5px}
.sp-color::-moz-color-swatch{border:none;border-radius:5px}
.sp-color-reset{background:var(--bg-tertiary,#27272a);border:1px solid var(--border-color,#27272a);color:var(--text-secondary,#a1a1aa);height:32px;padding:0 9px;border-radius:8px;font-size:11px;cursor:pointer;font-weight:600;transition:color .15s ease}
.sp-color-reset:hover{color:var(--accent,#ff4757)}
.sp-btn{background:var(--accent,#ff4757);color:#fff;border:none;padding:7px 14px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;transition:filter .15s ease,transform .1s ease;flex-shrink:0;display:inline-flex;align-items:center;gap:5px}
.sp-btn:hover{filter:brightness(1.08)}
.sp-btn:active{transform:scale(.96)}
.sp-btn:disabled{opacity:.5;cursor:not-allowed}
.sp-btn.secondary{background:var(--bg-tertiary,#27272a);color:var(--text-color,#f4f4f5)}
.sp-btn.secondary:hover{background:var(--bg-elevated,#3f3f46)}
.sp-btn.danger{background:#dc2626}
.sp-btn.danger:hover{background:#ef4444}
.sp-btn svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.sp-status{font-size:10.5px;padding:3px 9px;border-radius:9px;font-weight:700;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.sp-status.ok{background:rgba(129,201,149,.18);color:#81c995}
.sp-status.no{background:rgba(242,139,130,.18);color:#f28b82}
.sp-status.info{background:rgba(255,152,0,.18);color:#ff9800}
.sp-status .dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.sp-empty{padding:40px 16px;text-align:center;color:var(--text-secondary,#a1a1aa);font-size:13px}
.sp-empty svg{width:40px;height:40px;margin-bottom:12px;opacity:.5;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.school-card{padding:16px;border-bottom:1px solid var(--border-color,#27272a)}
.school-card:last-child{border-bottom:0}
.school-card h3{margin:0 0 6px;font-size:13px;color:var(--text-color,#f4f4f5)}
.school-card p{margin:0 0 12px;color:var(--text-secondary,#a1a1aa);font-size:11.5px;line-height:1.5}
.school-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:10px 0}
.school-input{width:min(100%,400px);min-width:0}
.school-warning{color:#fbbf24!important}
.school-help{margin:8px 0;color:var(--text-secondary,#a1a1aa);font-size:11.5px;line-height:1.55}
.school-steps{display:grid;gap:8px;margin:10px 0 14px;padding-left:22px;color:var(--text-secondary,#a1a1aa);font-size:11.5px;line-height:1.5}
.school-steps li::marker{color:var(--accent,#ff4757);font-weight:700}
.school-users{display:grid;gap:6px;margin:10px 0}
.school-user{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;background:var(--bg-tertiary,#27272a);border-radius:8px;font-size:12.5px}
.school-user strong{overflow-wrap:anywhere;font-weight:600}
.school-user-actions{display:flex;gap:6px;flex-shrink:0}
.school-user-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
.school-user-form .school-input{width:100%}
.school-user-form .sp-btn{justify-self:start}
.about-hero{display:flex;align-items:center;gap:18px;padding:22px;background:linear-gradient(135deg,var(--bg-primary,#121214),var(--bg-tertiary,#27272a));border:1px solid var(--border-color,#27272a);border-radius:12px;margin-bottom:16px}
.about-logo{width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 4px 12px rgba(255,71,87,.35));flex-shrink:0}
.about-hero-info{min-width:0;flex:1}
.about-hero-info h2{margin:0 0 4px;font-size:20px;font-weight:700;color:var(--text-color,#f4f4f5)}
.about-tagline{margin:0 0 10px;color:var(--text-secondary,#a1a1aa);font-size:12px;line-height:1.5}
.about-version-badge{display:inline-block;padding:3px 10px;background:rgba(255,71,87,.15);color:var(--accent,#ff4757);border-radius:9px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
.about-info-row{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border-color,#27272a);gap:10px}
.about-info-row:last-child{border-bottom:none}
.about-info-label{font-size:12px;color:var(--text-color,#f4f4f5);font-weight:500;flex-shrink:0}
.about-info-value{font-size:11px;color:var(--text-secondary,#a1a1aa);font-family:'SF Mono',Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;text-align:right}
.about-actions{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px}
.about-env-note{padding:10px 16px;font-size:10.5px;color:var(--text-secondary,#a1a1aa);border-top:1px solid var(--border-color,#27272a);line-height:1.6}
.about-group{border:1px solid var(--border-color,#27272a);border-radius:10px;overflow:hidden;background:var(--bg-primary,#121214);margin-bottom:14px}
#settings-lock-overlay{display:none;position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.75);align-items:center;justify-content:center;backdrop-filter:blur(4px)}
#settings-lock-dialog{width:min(400px,calc(100vw - 32px));padding:22px;color:var(--text-color,#f4f4f5);background:var(--bg-secondary,#18181b);border:1px solid var(--border-color,#27272a);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.55)}
#settings-lock-dialog h3{margin:0 0 8px;font-size:16px}
#settings-lock-dialog p{color:var(--text-secondary,#a1a1aa);font-size:12px;margin:0 0 12px}
#settings-lock-error{min-height:16px;color:#f28b82;font-size:11px;margin-top:6px}
.sp-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--bg-secondary,#18181b);border:1px solid var(--border-color,#27272a);color:var(--text-color,#f4f4f5);padding:10px 16px;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.4);font-size:12.5px;z-index:100005;opacity:0;transition:opacity .2s ease,transform .2s ease;pointer-events:none;max-width:90vw;text-align:center}
.sp-toast.visible{opacity:1;transform:translateX(-50%) translateY(0)}
.sp-toast.error{border-color:#f28b82;color:#ffd7e0}
.sp-toast.success{border-color:#81c995;color:#d1fae5}
#fps-display{position:fixed!important;inset:auto auto 10px 10px!important;display:none;box-sizing:border-box;width:max-content!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:calc(100vw - 20px)!important;max-height:48px!important;overflow:hidden;contain:layout paint style;z-index:999999;align-items:center;gap:7px;padding:4px 8px;border:1px solid var(--border-color,#27272a);border-radius:8px;background:var(--fps-background,rgba(0,0,0,.7));color:#fff;font:600 11px/1.2 ui-monospace,Consolas,monospace;white-space:nowrap;pointer-events:none;box-shadow:0 3px 12px rgba(0,0,0,.18)}
#fps-display[data-position="right"]{inset:auto 10px 10px auto!important}
#fps-display span{color:#fff}
@media (max-width:600px){#fps-display{font-size:10px;padding:3px 6px;gap:5px}}
@media (prefers-reduced-motion:reduce){html.smooth *{scroll-behavior:auto!important}}
#anka-fallback-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000000;padding:10px 18px;border-radius:8px;background:#27272a;color:#f4f4f5;font:13px 'Segoe UI',system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
#anka-fallback-toast.error{background:#7f1d1d}
#anka-confirm-overlay{display:none;position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,.75);align-items:center;justify-content:center;backdrop-filter:blur(3px);opacity:0;transition:opacity .18s ease}
#anka-confirm-overlay.visible{display:flex;opacity:1}
#anka-confirm-dialog{width:min(420px,calc(100vw - 32px));padding:22px;color:var(--text-color,#f4f4f5);background:var(--bg-secondary,#18181b);border:1px solid var(--border-color,#27272a);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.55);transform:scale(.95);transition:transform .2s var(--sp-transition-curve)}
#anka-confirm-overlay.visible #anka-confirm-dialog{transform:scale(1)}
#anka-confirm-dialog h3{margin:0 0 10px;font-size:16px;font-weight:700}
#anka-confirm-dialog p{margin:0 0 18px;font-size:13px;line-height:1.55;color:var(--text-secondary,#a1a1aa);overflow-wrap:anywhere}
#anka-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
#anka-confirm-actions button{min-width:88px;justify-content:center}
.anka-translate-banner{position:sticky;top:0;z-index:3;background:rgba(255,152,0,.12);border-bottom:1px solid rgba(255,152,0,.3);color:#ffb74d;font-size:11.5px;padding:6px 26px;display:flex;align-items:center;gap:8px}
.anka-translate-banner svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;animation:anka-spin 1.2s linear infinite}
@keyframes anka-spin{to{transform:rotate(360deg)}}
.anka-hw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;padding:12px 16px}
.anka-hw-card{background:var(--bg-tertiary,#27272a);border-radius:8px;padding:10px 12px}
.anka-hw-card .k{font-size:10.5px;color:var(--text-secondary,#a1a1aa);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.anka-hw-card .v{font-size:12.5px;font-weight:600;color:var(--text-color,#f4f4f5);overflow-wrap:anywhere}
.pack-row{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.pack-status{min-width:76px;justify-content:center;text-align:center;font-size:10.5px}
.pack-bar{flex:1;height:6px;background:var(--bg-elevated,#3f3f46);border-radius:3px;overflow:hidden;min-width:50px}
.pack-bar-fill{height:100%;background:var(--accent,#ff4757);transition:width .2s ease;border-radius:3px;width:0}
.pack-bar-fill.done{background:#81c995}
.pack-bar-fill.error{background:#f28b82}
.pack-row{flex-wrap:wrap}
.pack-row .sp-btn{min-height:40px;padding:8px 12px;white-space:normal}
.pack-complete-note{flex:1 0 100%;color:var(--text-secondary,#a1a1aa);font-size:11px;line-height:1.45}
.about-actions a.sp-btn{text-decoration:none;min-height:40px}
@media (max-width:680px){
  #settings-panel{width:calc(100vw - 12px);height:calc(100dvh - 12px);max-width:none;max-height:none;border-radius:12px}
  .settings-layout{flex-direction:column}
  .settings-sidebar{width:100%;height:auto;max-height:110px;flex-direction:row;align-items:center;overflow-x:auto;overflow-y:hidden;padding:8px;border-right:0;border-bottom:1px solid var(--border-color,#27272a);gap:4px;flex-wrap:nowrap}
  .settings-brand{padding:0 8px 0 4px;flex-shrink:0;font-size:12px}
  .settings-brand-icon{width:24px;height:24px;font-size:12px}
  .settings-nav-item{flex:0 0 auto;min-height:40px;white-space:nowrap;padding:6px 10px;font-size:12px}
  .settings-nav-spacer,.settings-nav-divider{display:none}
  .settings-content{min-height:0}
  .settings-header{padding:12px 14px 8px}
  .settings-header-top{gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .settings-title{font-size:15px;flex:1 1 100%}
  .settings-search-wrap{max-width:none;flex:1 1 100%}
  .settings-header-actions{gap:4px}
  .sp-hdr-btn{padding:0 8px;font-size:11px;height:30px}
  .sp-hdr-btn span{display:none}
  .settings-body{padding:10px 12px 20px}
  .sp-item{flex-direction:column;align-items:flex-start;gap:8px;padding:11px 13px}
  .sp-item-ctl{width:100%;justify-content:flex-start;flex-wrap:wrap}
  .sp-select,.sp-text,.sp-css-editor{width:100%}
  .sp-range{width:100%}
  .school-user-form{grid-template-columns:1fr}
  .about-hero{flex-direction:column;text-align:center;padding:16px}
  .about-hero-info{text-align:center}
  .about-info-row{flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px}
  .about-info-value{text-align:left}
  .about-actions{flex-direction:column}
  .about-actions .sp-btn{width:100%;justify-content:center}
}
`;

    const SETTINGS_DATA = {
        genel: {
            title: 'Genel',
            description: 'Temel tarayıcı davranışları',
            icon: '<path d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z"/>',
            groups: [
                {
                    id: 'genel-temel',
                    title: 'Temel',
                    icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
                    items: [
{ id: 'language', label: 'Arayüz Dili', desc: 'Uygulama arayüzünde kullanılacak dil. Aşağıdaki "Dil Paketleri" bölümünden paket indirmen önerilir.', type: 'select', options: [
    { val: 'tr', name: 'Türkçe' },
    { val: 'en', name: 'English' },
    { val: 'de', name: 'Deutsch' },
    { val: 'fr', name: 'Français' },
    { val: 'es', name: 'Español' },
    { val: 'it', name: 'Italiano' },
    { val: 'pt', name: 'Português' },
    { val: 'ru', name: 'Русский' },
    { val: 'ar', name: 'العربية' },
    { val: 'ja', name: '日本語' },
    { val: 'ko', name: '한국어' },
    { val: 'zh', name: '中文' },
    { val: 'hi', name: 'हिन्दी' }
], default: 'tr' },
                        { id: 'notifications', label: 'Uygulama İçi Bildirimler', desc: 'Kapalıyken başarı, bilgi ve hata toast bildirimlerini gösterme', type: 'toggle', default: true },
                        { id: 'auto-save', label: 'Otomatik Kayıt', desc: 'Çalışma alanını, ayarları ve çizimleri otomatik kaydet', type: 'toggle', default: true },
                        { id: 'start-fullscreen', label: 'Tam Ekran Başlat', desc: 'Uygulama açıldığında otomatik tam ekrana geç', type: 'toggle', default: false },
                        { id: 'show-welcome-on-start', label: 'İlk Açılış Tanıtımı', desc: 'Hoşgeldin ekranını yalnızca ilk uygulama açılışında göster', type: 'toggle', default: true },
                        { id: 'profile-isolation', label: 'Kullanıcı Verilerini Ayır', desc: 'Her kullanıcı profilinde ayarları, geçmişi, site verilerini ve oturumları ayrı sakla', type: 'toggle', default: true },
                        { id: 'restore-session', label: 'Çökme Sonrası Oturumu Geri Yükle', desc: 'Açık sekmelerin adreslerini bu cihazda sakla; Anka Web düzgün kapanmazsa pencereleri ve sekmeleri geri yükleme seçeneği göster. Gizli sekmeler kaydedilmez.', type: 'toggle', default: false },
                        { id: 'startup-page', label: 'Başlangıç Sayfası', desc: 'Tarayıcı açıldığında yüklenecek sayfayı seç', type: 'select', options: [{ val: 'home', name: 'Hız Çubuğu (Ana Sayfa)' }, { val: 'blank', name: 'Boş Sayfa' }, { val: 'custom', name: 'Özel adres' }], default: 'home' },
                        { id: 'startup-custom-url', label: 'Özel Başlangıç Adresi', desc: 'Başlangıç sayfasında "Özel adres" seçiliyken kullanılır; yalnızca HTTP ve HTTPS adresleri desteklenir', type: 'text', placeholder: 'https://ornek.com', default: '' },
                        { id: 'system-pages-mode', label: 'Sistem Sayfaları', desc: 'Ayarlar, yardım, indirilenler ve geçmiş açılma biçimi', type: 'select', options: [{ val: 'panel', name: 'Ortadaki panelde' }, { val: 'tab', name: 'Yeni sekmede' }], default: 'panel' },
                        { id: 'show-crash-reports', label: 'Çökme Raporları', desc: 'Çökme durumunda hata raporu oluştur (kişisel veri toplamaz)', type: 'toggle', default: false }
                    ]
                },
                {
                    id: 'genel-sekmeler',
                    title: 'Sekmeler',
                    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/>',
                    items: [
                        { id: 'max-tabs', label: 'Maksimum Sekme Sayısı', desc: 'Aynı anda açık tutulabilecek sekme sayısı (1–30)', type: 'number', min: 1, max: 30, placeholder: '10', default: '10' },
                        { id: 'tab-memory', label: 'Sekme Bellek Göstergesi', desc: 'Sekmelerin kullandığı yaklaşık belleği göster', type: 'toggle', default: false },
                        { id: 'vertical-tabs', label: 'Sekmeleri Dikey Göster', desc: 'Sekme listesini sol menüde göster; yatay sekme çubuğunu gizle', type: 'toggle', default: false },
                        { id: 'confirm-close-tabs', label: 'Sekme Kapatma Onayı', desc: 'Birden fazla sekme açıkken kapatma onayı iste', type: 'toggle', default: false },
                        { id: 'auto-suspend-tabs', label: 'Sekmeleri Otomatik Askıya Al', desc: '10 dakika kullanılmayan sekmeleri bellekten boşalt', type: 'toggle', default: false }
                    ]
                },
                {
                    id: 'genel-cizim',
                    title: 'Çizim',
                    icon: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>',
                    items: [
                        { id: 'drawing-recovery', label: 'Çizim Kurtarma', desc: 'Çizimleri PNG olarak sakla ve açılışta geri yükle', type: 'toggle', default: false },
                        { id: 'save-drawing-now', label: 'Çizimi Şimdi Kaydet', desc: 'Mevcut çizim yüzeyini anında kaydet', type: 'button', btnText: 'Kaydet', action: 'saveDrawingNow' },
                        { id: 'clear-drawing-now', label: 'Kayıtlı Çizimi Sil', desc: 'Kaydedilmiş çizim dosyasını ve yüzeyi temizle', type: 'button', btnText: 'Temizle', action: 'clearDrawingNow' }
                    ]
                },
                {
                    id: 'genel-sistem',
                    title: 'Sistem',
                    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
                    items: [
                        { id: 'default-browser', label: 'Varsayılan Tarayıcı Yap', desc: 'İşletim sisteminde varsayılan web tarayıcısı olarak ayarla', type: 'button-status', btnText: 'Varsayılan Ayarla', action: 'setDefaultBrowser', statusCheck: 'checkDefaultBrowser' },
                        { id: 'tray-in-background', label: 'Kapatınca Tepside Çalış', desc: 'Pencereyi kapatınca Anka Web’i Windows bildirim alanında veya Linux sistem tepsisinde açık tut', type: 'toggle', default: false },
                        { id: 'start-on-login', label: 'Sistem Açılışında Başlat', desc: 'Kullanıcı oturumu açıldığında Anka Web’i küçültülmüş olarak başlat', type: 'toggle', default: false },
                        { id: 'auto-update-on-launch', label: 'Açılışta Otomatik Güncelle', desc: 'Yeni sürüm varsa otomatik indirip kur', type: 'toggle', default: false },
                        { id: 'check-updates', label: 'Yazılım Güncellemeleri', desc: 'Uygulama güncellemelerini kontrol et ve yükle', type: 'button-status', btnText: 'Kontrol Et', action: 'checkAppUpdates', statusCheck: 'initAppVersionDisplay' }
                    ]
                },
                                     {
id: 'gorunum-dil-paketleri',
    title: 'Dil Paketleri',
    icon: '<path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
    items: [
        { id: 'pack-en', lang: 'en', label: 'English Paketi', desc: 'İngilizce arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-de', lang: 'de', label: 'Deutsch Paketi', desc: 'Almanca arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-fr', lang: 'fr', label: 'Français Paketi', desc: 'Fransızca arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-es', lang: 'es', label: 'Español Paketi', desc: 'İspanyolca arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-it', lang: 'it', label: 'Italiano Paketi', desc: 'İtalyanca arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-pt', lang: 'pt', label: 'Português Paketi', desc: 'Portekizce arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-ru', lang: 'ru', label: 'Русский Paketi', desc: 'Rusça arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-ar', lang: 'ar', label: 'العربية Paketi', desc: 'Arapça arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-ja', lang: 'ja', label: '日本語 Paketi', desc: 'Japonca arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-ko', lang: 'ko', label: '한국어 Paketi', desc: 'Korece arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-zh', lang: 'zh', label: '中文 Paketi', desc: 'Çince arayüz için tüm metinleri indir', type: 'language-pack' },
        { id: 'pack-hi', lang: 'hi', label: 'हिन्दी Paketi', desc: 'Hintçe arayüz için tüm metinleri indir', type: 'language-pack' }
    ]
}
                
            ]
        },
        hizliMenu: {
            title: 'Hızlı Menü',
            description: 'Profil düğmesinin yanındaki hızlı erişim menüsünü düzenle',
            icon: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
            groups: [
                {
                    id: 'hizli-menu-eylemler',
                    title: 'Düğme ve Eylemler',
                    icon: '<path d="M12 5v14M5 12h14"/>',
                    items: [
                        { id: 'quick-menu-button', label: 'Hızlı Erişim Düğmesi', desc: 'Profil düğmesinin sağındaki üç noktalı hızlı erişim düğmesini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-new-tab', label: 'Yeni Sekme', desc: 'Hızlı menüde Yeni Sekme eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-copy-page-url', label: 'Sayfa Bağlantısını Kopyala', desc: 'Bir web sayfası açıkken hızlı menüde adresini panoya kopyalama seçeneğini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-site-shortcut', label: 'Site Kısayolu Oluştur', desc: 'Açık web sitesi için masaüstü ve Başlat menüsü kısayolu oluşturma seçeneğini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-downloads', label: 'İndirilenler', desc: 'Hızlı menüde İndirilenler eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-bookmarks', label: 'Yer İmleri', desc: 'Hızlı menüde Yer İmleri eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-history', label: 'Geçmiş', desc: 'Hızlı menüde Geçmiş eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-settings', label: 'Ayarlar', desc: 'Hızlı menüde Ayarlar eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-help', label: 'Yardım', desc: 'Hızlı menüde Yardım eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-groups', label: 'Sekme Grupları', desc: 'Hızlı menüde gruplardaki sekmeleri görüntüle', type: 'toggle', default: true },
                        { id: 'quick-menu-window-name', label: 'Pencereye Ad Ver', desc: 'Hızlı menüden bu pencerenin başlığını değiştir', type: 'toggle', default: true },
                        { id: 'sidebar-help-button', label: 'Sol Menüde Yardım', desc: 'Yardım düğmesini sol menüde göster; kapalıyken yalnızca hızlı menüde görünür', type: 'toggle', default: false },
                        { id: 'quick-menu-paint', label: 'Çizim Araçları', desc: 'Hızlı menüde çizim araçlarını açma eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-keyboard', label: 'Ekran Klavyesi', desc: 'Hızlı menüde ekran klavyesini açma eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-lesson-tools', label: 'Ders Araçları', desc: 'Hızlı menüde ders araçlarını açma eylemini göster', type: 'toggle', default: true },
                        { id: 'quick-menu-ai', label: 'AI Oturumu', desc: 'Hızlı menüde AI oturumu açma eylemini göster', type: 'toggle', default: true }
                    ]
                }
            ]
        },
        gorunum: {
            title: 'Görünüm',
            description: 'Tema, renkler, tipografi ve efektler',
            icon: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20c-1.1 0-2-.9-2-2 0-.5.2-1 .5-1.4.3-.4.5-.9.5-1.6 0-1.1-.9-2-2-2H7a5 5 0 0 1 0-10h1a4 4 0 0 0 4-4c0-.6.4-1 1-1z"/>',
            groups: [
                {
                    id: 'gorunum-tema',
                    title: 'Tema',
                    icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
                    items: [
                        { id: 'theme-preset', label: 'Tema Seçimi', desc: 'Sistem seçiliyken işletim sisteminin teması otomatik izlenir', type: 'select', options: [
                            { val: 'system', name: 'Sistem (Varsayılan)' },
                            { val: 'dark', name: 'Modern Koyu' },
                            { val: 'light', name: 'Aydınlık Ferah' },
                            { val: 'catppuccin', name: 'Catppuccin Mocha' },
                            { val: 'cyberpunk', name: 'Cyberpunk Neon' },
                            { val: 'dracula', name: 'Dracula Pro' },
                            { val: 'nord', name: 'Nord Frost' },
                            { val: 'oled', name: 'OLED Saf Siyah' },
                            { val: 'emerald', name: 'Emerald Forest' },
                            { val: 'sunset', name: 'Gün Batımı' },
                            { val: 'forest', name: 'Orman' },
                            { val: 'rose', name: 'Gül' },
                            { val: 'slate', name: 'Arduvaz' }
                        ], default: 'system' },
                        { id: 'custom-theme-css', label: 'Tema Paketleri · Özel CSS', desc: 'Yalnızca arayüz görünümünü özelleştirir. Harici URL, içe aktarma ve kod çalıştırma kuralları kabul edilmez; en fazla 32 KB.', type: 'css', default: '' },
                        { id: 'auto-theme', label: 'Otomatik Tema (Saat Bazlı)', desc: 'Belirlenen saatlerde otomatik açık/koyu temaya geç', type: 'toggle', default: false },
                        { id: 'auto-theme-dark-start', label: 'Koyu Tema Başlangıcı', desc: 'Otomatik temada koyu temaya geçilecek saat (0–23)', type: 'number', min: 0, max: 23, placeholder: '19', default: '19' },
                        { id: 'auto-theme-light-start', label: 'Açık Tema Başlangıcı', desc: 'Otomatik temada açık temaya geçilecek saat (0–23)', type: 'number', min: 0, max: 23, placeholder: '7', default: '7' }
                    ]
                },
                {
                    id: 'gorunum-renk',
                    title: 'Renkler',
                    icon: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.5 0 1-.5 1-1v-1c0-.5-.5-1-1-1h-1a3 3 0 0 1 0-6h5a5 5 0 0 0 5-5c0-3.3-3.6-6-9-6z"/>',
                    items: [
                        { id: 'accent-quick', label: 'Hızlı Vurgu Rengi', desc: 'Hazır renk paletinden hızlıca seç', type: 'select', options: [
                            { val: '', name: 'Tema Varsayılanı' },
                            { val: '#ff4757', name: 'Kırmızı' },
                            { val: '#3b82f6', name: 'Mavi' },
                            { val: '#10b981', name: 'Yeşil' },
                            { val: '#f59e0b', name: 'Turuncu' },
                            { val: '#8b5cf6', name: 'Mor' },
                            { val: '#ec4899', name: 'Pembe' },
                            { val: '#06b6d4', name: 'Turkuaz' }
                        ], default: '' },
                        { id: 'custom-accent', label: 'Özel Vurgu Rengi', desc: 'Tema varsayılanını geçersiz kılar. Boş bırakılırsa tema rengi kullanılır.', type: 'color', default: '' }
                    ]
                },
                {
                    id: 'gorunum-tipografi',
                    title: 'Tipografi ve Ölçek',
                    icon: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
                    items: [
                        { id: 'font-family', label: 'Yazı Tipi Ailesi', desc: 'Arayüzde kullanılacak varsayılan yazı tipi', type: 'select', options: [
                            { val: 'system', name: 'Sistem (Varsayılan)' },
                            { val: 'sans', name: 'Sans-Serif' },
                            { val: 'serif', name: 'Serif' },
                            { val: 'mono', name: 'Monospace' }
                        ], default: 'system' },
                        { id: 'font-scale', label: 'Yazı Boyutu Ölçeği', desc: 'Arayüz yazılarını %80–150 arasında ayarla; web sayfalarının yakınlaştırması değişmez', type: 'range', min: 80, max: 150, step: 5, default: '100' },
                        { id: 'ui-scale', label: 'Arayüz Ölçeği', desc: 'Pencere içindeki araç çubuklarını ve kontrolleri %85–125 arasında ölçekle; ekran düzeni yeniden akışını korur', type: 'range', min: 85, max: 125, step: 5, default: '100' },
                        { id: 'logo-size', label: 'Anka Web Logo Boyutu', desc: 'Yan menü ve ana sayfadaki logonun boyutunu ayarla', type: 'range', min: 36, max: 56, step: 4, default: '44' },
                        { id: 'icon-style', label: 'Simge Görünümü', desc: 'Araç ve kalem simgelerini arka plansız beyaz tek renkli veya özgün emoji biçiminde göster', type: 'select', options: [{ val: 'monochrome', name: 'Arka plansız, beyaz (Varsayılan)' }, { val: 'emoji', name: 'Özgün emoji renkleri' }], default: 'monochrome' },
                        { id: 'panel-density', label: 'Panel Yoğunluğu', desc: 'Ayarlar panelindeki öğeler arası boşluk', type: 'select', options: [
                            { val: 'compact', name: 'Sıkışık' },
                            { val: 'normal', name: 'Normal (Varsayılan)' },
                            { val: 'comfortable', name: 'Ferah' }
                        ], default: 'normal' },
                        { id: 'reset-display-settings', label: 'Görünüm Ölçeklerini Sıfırla', desc: 'Yazı boyutunu ve arayüz ölçeğini varsayılan değerlerine döndür', type: 'button', btnText: 'Ölçekleri Sıfırla', action: 'resetDisplaySettings' }
                    ]
                },
                {
                    id: 'gorunum-efektler',
                    title: 'Efektler',
                    icon: '<path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
                    items: [
                        { id: 'ui-animations', label: 'Arayüz Animasyonları', desc: 'Pencere geçişleri, menüler ve bu paneldeki tüm animasyonlar', type: 'toggle', default: true },
                        { id: 'smooth-scrolling', label: 'Akıcı Kaydırma', desc: 'Sayfa geçişlerinde yumuşak kaydırma', type: 'toggle', default: true },
                        { id: 'touch-mode', label: 'Dokunmatik Tahta Modu', desc: 'Dokunmatik ekranlar için butonları ve hedefleri büyüt', type: 'toggle', default: false },
                        { id: 'night-light', label: 'Gece Işığı', desc: 'Arayüz renklerine sıcak ton ekleyerek akşam kullanımını rahatlat', type: 'toggle', default: false },
                        { id: 'night-light-strength', label: 'Gece Işığı Yoğunluğu', desc: 'Gece Işığı sıcak ton seviyesini ayarla', type: 'range', min: 10, max: 50, step: 5, default: '25' },
                        { id: 'reduce-transparency', label: 'Saydamlığı Azalt', desc: 'Bulanık arka planları devre dışı bırakarak performansı artır', type: 'toggle', default: false }
                    ]
                },
                {
                    id: 'gorunum-yerlesim',
                    title: 'Yerleşim',
                    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
                    items: [
                        { id: 'sidebar-side', label: 'Sol Menü Konumu', desc: 'Araç menüsünü pencerenin soluna veya sağına taşı', type: 'select', options: [{ val: 'left', name: 'Sol' }, { val: 'right', name: 'Sağ' }], default: 'left' },
                        { id: 'side-panel-side', label: 'Yan Panel Konumu', desc: 'Yer imi, geçmiş ve sabitlenmiş yan panelleri ana içeriğin solunda veya sağında göster', type: 'select', options: [{ val: 'left', name: 'Sol' }, { val: 'right', name: 'Sağ' }], default: 'right' },
                        { id: 'movable-menus', label: 'Menüleri Taşı', desc: 'Ayarlar, yardım ve araç panellerini başlıklarından sürükleyerek taşı; çizim menüsü her zaman taşınabilir', type: 'toggle', default: false },
                        { id: 'save-menu-positions', label: 'Menü Konumlarını Kaydet', desc: 'Taşıdığınız menülerin konumlarını bu cihazda sakla ve sonraki açılışta geri yükle', type: 'toggle', default: true },
                        { id: 'bookmarks-bar', label: 'Yer İmleri Çubuğu', desc: 'Çubuğu otomatik göster, sürekli açık tut veya gizle', type: 'select', options: [{ val: 'auto', name: 'Otomatik' }, { val: 'always', name: 'Her zaman' }, { val: 'never', name: 'Gizle' }], default: 'auto' },
                        { id: 'show-home-btn', label: 'Ana Sayfa Düğmesi', desc: 'Gezinme araçlarında ana sayfa düğmesini göster', type: 'toggle', default: true },
                        { id: 'compact-tabs', label: 'Kompakt Sekmeler', desc: 'Sekme boyutlarını küçülterek daha fazla alan kazan', type: 'toggle', default: false },
                        { id: 'page-zoom', label: 'Varsayılan Sayfa Yakınlaştırma', desc: 'Siteye özel yakınlaştırma yoksa kullanılacak düzey', type: 'select', options: [{ val: '75', name: '%75' }, { val: '90', name: '%90' }, { val: '100', name: '%100' }, { val: '110', name: '%110' }, { val: '125', name: '%125' }, { val: '150', name: '%150' }], default: '100' }
                    ]
                },
            ]
        },
        arama: {
            title: 'Arama ve AI',
            description: 'Arama motoru, öneriler ve yapay zeka',
            icon: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
            groups: [
                {
                    id: 'arama-motor',
                    title: 'Arama Motoru',
                    icon: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
                    items: [
                        { id: 'search-engine', label: 'Varsayılan Arama Motoru', desc: 'Adres çubuğuna yazılan aramaların gönderileceği motor', type: 'select', options: [
                            { val: 'google', name: 'Google' }, { val: 'yandex', name: 'Yandex' }, { val: 'bing', name: 'Bing' }, { val: 'duckduckgo', name: 'DuckDuckGo' }, { val: 'ecosia', name: 'Ecosia' }, { val: 'brave', name: 'Brave Search' }, { val: 'custom', name: 'Özel' }
                        ], default: 'google' },
                        { id: 'custom-search-url', label: 'Özel Arama Adresi', desc: 'Sadece "Özel" seçiliyken kullanılır. %s aranan kelimenin yerine geçer.', type: 'text', placeholder: 'https://ornek.com/ara?q=%s', default: 'https://www.google.com/search?q=%s' },
                        { id: 'search-suggestions', label: 'Arama Önerileri', desc: 'Adres çubuğuna yazarken otomatik öneriler göster', type: 'toggle', default: true },
                        { id: 'safe-search', label: 'Güvenli Arama', desc: 'Yetişkin içeriklerini arama sonuçlarından filtrele', type: 'select', options: [{ val: 'off', name: 'Kapalı' }, { val: 'moderate', name: 'Orta' }, { val: 'strict', name: 'Sıkı' }], default: 'moderate' }
                    ]
                },
                {
                    id: 'arama-ai',
                    title: 'Yapay Zeka',
                    icon: '<path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
                    items: [
                        { id: 'ai-mode-active', label: 'AI Modu', desc: 'Adres çubuğundaki aramaları yapay zekaya yönlendir', type: 'toggle', default: false },
                        { id: 'ai-provider', label: 'AI Sağlayıcı', desc: 'AI Modu için kullanılacak servis', type: 'select', options: [
                            { val: 'google-ai', name: 'Google AI Modu' }, { val: 'chatgpt', name: 'ChatGPT' }, { val: 'gemini', name: 'Gemini' }, { val: 'perplexity', name: 'Perplexity' }, { val: 'claude', name: 'Claude' }
                        ], default: 'google-ai' }
                    ]
                }
            ]
        },
        gizlilik: {
            title: 'Gizlilik ve Güvenlik',
            description: 'Reklam, izleyici ve bağlantı güvenliği',
            icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
            groups: [
                {
                    id: 'gizlilik-koruma',
                    title: 'Koruma',
                    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
                    items: [
                        { id: 'ad-block', label: 'Reklam Engelleyici', desc: 'Web sayfalarındaki rahatsız edici reklamları engelle', type: 'toggle', default: true },
                        { id: 'track-protect', label: 'İzleyici Koruması', desc: 'Gizliliğinizi tehlikeye atan çerezleri ve izleyicileri engelle', type: 'toggle', default: true },
                        { id: 'https-only', label: 'Yalnızca HTTPS Modu', desc: 'Güvensiz HTTP bağlantılarını otomatik güvenli sürüme yükselt', type: 'toggle', default: true },
                        { id: 'do-not-track', label: 'Takip Etme İsteği', desc: 'Göz atma trafiğinizi web sitelerinden gizleyin', type: 'toggle', default: true },
                        { id: 'block-third-party-cookies', label: 'Üçüncü Taraf Çerezlerini Engelle', desc: 'Siteler arası izlemeyi önlemek için üçüncü taraf çerezlerini reddet', type: 'toggle', default: true },
                        { id: 'fingerprint-protection', label: 'Parmak İzi Koruması', desc: 'Canvas, WebGL ve font parmak izlerini rastgeleleştir', type: 'toggle', default: false },
                        { id: 'password-manager', label: 'Anka Web Parola Yöneticisi', desc: 'Parolaları işletim sisteminin şifrelemesiyle bu cihazda sakla. Yerel sistem kimlik doğrulaması hazır olmadığından otomatik doldurma güvenli biçimde kapalıdır.', type: 'toggle', default: false },
                        { id: 'password-manager-open', label: 'Kayıtlı Parolaları Yönet', desc: 'Kayıtları incele, sil ve yeni parola girerken yerel güvenlik denetimini gör. Parola verileri hiçbir denetim için ağa gönderilmez.', type: 'button', btnText: 'Parolaları Yönet', action: 'openPasswordManager' }
                    ]
                },
                {
                    id: 'gizlilik-temizlik',
                    title: 'Temizlik',
                    icon: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
                    items: [
                        { id: 'download-scan', label: 'Dosya Risk Denetimi', desc: 'Şüpheli dosya türlerini işaretler (antivirüs değil)', type: 'toggle', default: true },
                        { id: 'clear-cache-exit', label: 'Çıkışta Önbelleği Sil', desc: 'Kapatıldığında çerezleri ve önbelleği temizle', type: 'toggle', default: false },
                        { id: 'clear-browsing-data', label: 'Gezinti Verilerini Temizle', desc: 'Geçmiş, indirme listesi, çerezler, site verileri ve önbellek türlerini ve zaman aralığını seç', type: 'button', btnText: 'Verileri seç ve temizle', action: 'clearBrowsingData' }
                    ]
                }
            ]
        },
        performans: {
            title: 'Performans',
            description: 'Hız, bellek ve kaynak kullanımı',
            icon: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
            groups: [
                {
                    id: 'performans-hiz',
                    title: 'Hız',
                    icon: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
                    items: [
                        { id: 'hw-accel', label: 'Donanım Hızlandırma', desc: 'Değişiklik uygulama yeniden başlatıldığında etkinleşir', type: 'toggle', default: true },
                        { id: 'hardware-acceleration-override', label: 'WebGL Uyumluluk Modu', desc: 'GPU engel listesini yok sayar; yeniden başlatma gerekir', type: 'toggle', default: false },
                        { id: 'preload-pages', label: 'Sayfa Ön Yükleme', desc: 'Sık ziyaret edilen sayfaları önceden yükle', type: 'toggle', default: true },
                        { id: 'memory-saver', label: 'Bellek Tasarrufu', desc: 'Kullanılmayan sekmeleri askıya alarak bellekten tasarruf et', type: 'toggle', default: false },
                        { id: 'background-tab-throttling', label: 'Arka Plan Sekme Tasarrufu', desc: 'Chromium’un arka plandaki sekmelerde zamanlayıcı ve çizim hızını düşürerek CPU ve pil kullanımını azaltmasını sağlar', type: 'toggle', default: true },
                        { id: 'smart-tab-manager', label: 'Yerel Akıllı Sekme Yöneticisi', desc: 'Ağ kullanmadan yerel kurallarla boşta sekmeleri ve etkin sekme sayısını yönetir; üretken yapay zeka modeli değildir', type: 'toggle', default: false },
                        { id: 'disk-backed-tab-saver', label: 'Sekme Kurtarmayı Diske Kaydet', desc: 'Bellek baskısında boş sekmeleri kapatıp URL ve gruplarını diskte saklar. Windows sayfa dosyası veya Linux swap ayarını değiştirmez; form içerikleri korunmaz.', type: 'toggle', default: false },
                        { id: 'max-live-tabs', label: 'Canlı Sekme Sınırı', desc: 'Arka planda aynı anda çalışabilecek sekme sayısı', type: 'number', min: 1, max: 30, placeholder: '10', default: '10' },
                        { id: 'tab-sleep-minutes', label: 'Boşta Sekmeyi Uyut (dakika)', desc: 'Etkin olmayan sekmelerin uykuya alınma süresi; 0 ile kapatılır', type: 'number', min: 0, max: 1440, placeholder: '20', default: '20' },
                        { id: 'low-end-mode', label: 'Düşük Donanım Modu', desc: 'Görsel efektleri azaltıp düşük bellek ve işlemci kullanımını tercih et', type: 'toggle', default: false },
                        { id: 'fps-meter', label: 'FPS Göstergesi', desc: 'Anlık kare hızını ekranın köşesinde küçük bir etiket olarak göster', type: 'toggle', default: false },
                        { id: 'fps-limit', label: 'FPS Sınırlayıcı', desc: 'Web sayfalarının animasyon kare hızını sınırlar; arayüz ve video oynatımını etkilemez', type: 'select', options: [{ val: '0', name: 'Kapalı (ekran yenilemesine göre)' }, { val: '30', name: '30 FPS' }, { val: '45', name: '45 FPS' }, { val: '60', name: '60 FPS' }, { val: '90', name: '90 FPS' }, { val: '120', name: '120 FPS' }], default: '0' },
                        { id: 'system-monitor', label: 'Sistem Performans Göstergesi', desc: 'FPS yanında işletim sisteminin yaklaşık toplam CPU kullanımını göster', type: 'toggle', default: false },
                        { id: 'monitor-position', label: 'Performans Göstergesi Konumu', desc: 'FPS ve CPU değerlerini ekranın sol veya sağ alt köşesinde göster', type: 'select', options: [{ val: 'left', name: 'Sol' }, { val: 'right', name: 'Sağ' }], default: 'left' },
                        { id: 'monitor-background', label: 'Gösterge Arka Planı', desc: 'Küçük performans etiketinin arka plan rengini seç', type: 'select', options: [{ val: 'black', name: 'Siyah' }, { val: 'graphite', name: 'Grafit' }, { val: 'accent', name: 'Vurgu rengi' }, { val: 'light', name: 'Açık' }], default: 'black' },
                        { id: 'monitor-opacity', label: 'Gösterge Arka Plan Saydamlığı', desc: 'Etiket kutusunun arka plan opaklığını ayarla', type: 'range', min: 10, max: 100, step: 5, default: '70' },
                        { id: 'monitor-scale', label: 'Gösterge Boyutu', desc: 'FPS/CPU etiketinin metin ve boşluk ölçeğini ayarla', type: 'range', min: 80, max: 150, step: 5, default: '100' },
                        { id: 'game-mode', label: 'Oyuncu Modu', desc: 'Oyun için koyu tema ve daha düşük arayüz yükü uygula; kapatınca önceki tercihlerini geri yükle', type: 'toggle', default: false }
                    ]
                }
            ]
        },
        gelismis: {
            title: 'Gelişmiş',
            description: 'Geliştirici seçenekleri ve veri yönetimi',
            icon: '<circle cx="12" cy="12" r="3"/><path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3"/>',
            groups: [
                {
                    id: 'gelismis-gelistirici',
                    title: 'Geliştirici',
                    icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
                    items: [
                        { id: 'dev-tools-shortcut', label: 'Geliştirici Araçları', desc: 'Uygulama içi konsol ve element denetleyicisini etkinleştir', type: 'toggle', default: true },
                        { id: 'experimental-features', label: 'Deneysel Özellikler', desc: 'Henüz kararlı olmayan deneysel özellikleri etkinleştir', type: 'toggle', default: false },
                        { id: 'cache-size-limit', label: 'Maksimum Önbellek (MB)', desc: 'Tarayıcı HTTP önbelleğinin boyut sınırı', type: 'number', min: 100, max: 5000, placeholder: '500', default: '500' },
                        { id: 'developer-packs', label: 'Yerel Geliştirici Paketleri', desc: 'manifest.json bulunan güvenilir tarayıcı eklentilerini bu kullanıcı hesabı için yönet', type: 'button', btnText: 'Paketleri yönet ve manifest oluştur', action: 'openDeveloperPacks' }
                    ]
                },
                {
                    id: 'gelismis-devtools',
                    title: 'Geliştirici Araçları',
                    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
                    items: [
                        { id: 'reload-page', label: 'Sayfayı Yenile', desc: 'Geçerli sekmeyi normal şekilde yeniler', type: 'button', btnText: 'Yenile', action: 'reloadCurrentPage' },
                        { id: 'hard-reload-page', label: 'Önbelleği Atla ve Yenile', desc: 'Önbelleği temizleyip sayfayı sert şekilde yeniler', type: 'button', btnText: 'Sert Yenile', action: 'hardReloadCurrentPage' },
                        { id: 'clear-console', label: 'Konsolu Temizle', desc: 'Renderer konsolundaki tüm çıktıları temizler', type: 'button', btnText: 'Konsolu Temizle', action: 'clearConsoleOutput' },
                        { id: 'copy-system-info', label: 'Sistem Bilgilerini Kopyala', desc: 'OS, CPU, RAM ve sürüm bilgilerini panoya kopyalar', type: 'button', btnText: 'Kopyala', action: 'copySystemInfo' },
                        { id: 'show-system-info', label: 'Sistem Bilgilerini Göster', desc: 'Detaylı donanım ve işletim sistemi bilgilerini gösterir', type: 'button', btnText: 'Göster', action: 'showSystemInfo' }
                    ]
                },
                {
                    id: 'gelismis-veri',
                    title: 'Veri Yönetimi',
                    icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
                    items: [
                        { id: 'export-settings-btn', label: 'Ayar Dosyası Oluştur', desc: 'Ayarları ve yalnızca Okul Modu açık/kapalı durumunu işletim sistemi güvenli deposuyla şifrelenmiş .ankaconfig dosyasına kaydet; parola ve okul hesapları dışarı aktarılmaz', type: 'button', btnText: 'Ayar Dosyasını Kaydet', action: 'exportSettingsToFile' },
                        { id: 'import-settings-btn', label: 'Ayar Dosyasını Yükle', desc: 'Bu cihazda güvenli biçimde şifrelenmiş .ankaconfig dosyasındaki ayarları parolasız yükle', type: 'button', btnText: 'Ayar Dosyasını Aç', action: 'importSettingsFromFile' },
                        { id: 'clear-i18n-cache', label: 'Çeviri Önbelleğini Temizle', desc: 'Otomatik çevirileri yeniden indirmek için önbelleği siler', type: 'button', btnText: 'Önbelleği Temizle', action: 'clearI18nCache' },
                        { id: 'clear-temp-data-btn', label: 'Anka Web Geçici Dosyalarını Temizle', desc: 'Önbellek, oturum ve AppData/Roaming altındaki tüm Anka Web verilerini siler. Uygulama kapatılır, temizlenir ve otomatik yeniden başlatılır.', type: 'button', btnText: 'Temizle ve Yeniden Başlat', action: 'clearTempDataAndRestart' }
                    ]
                }
            ]
        }
    };

    const settingIndex = {};
    const groupIndex = {};
    for (const catKey in SETTINGS_DATA) {
        for (const group of SETTINGS_DATA[catKey].groups) {
            groupIndex[group.id] = group;
            for (const s of group.items) {
                s._group = group.id;
                s._cat = catKey;
                settingIndex[s.id] = s;
            }
        }
    }

    const statusChecks = {};
    const pendingIds = new Set();

    let cachedIpc;
    let panelOpen = false;
    let panelBusy = false;
    let hideTimer = 0;
    let currentTab = 'genel';
    let fpsFrameCount = 0;
    let fpsLastTime = 0;
    let fpsAnimationId = 0;
    let cpuRefreshTimer = 0;
    let fpsEl = null;
    let externalTimer = 0;
    let stylesReady = false;
    let dismissLock = () => {};
    let searchQuery = '';
    let autoThemeTimer = 0;
    let suppressThemeBroadcast = false;
    let activeConfirm = null;
    let translationBanner = null;
    let translationInFlight = false;
    let settingsHydrationStarted = false;
    let settingsHydrationFinished = false;
    const settingsEditedDuringHydration = new Set();

    const domCache = {
        panel: null,
        overlay: null,
        body: null,
        title: null,
        search: null,
        searchHint: null,
        navItems: null
    };

    function ipc() {
        if (cachedIpc !== undefined) return cachedIpc;
        try { cachedIpc = require('electron').ipcRenderer; }
        catch (e) { cachedIpc = null; }
        return cachedIpc;
    }

    function t(text) {
        if (!text) return text;
        if (!ANKA_I18N) return text;
        const lang = ANKA_I18N.getLang();
        if (lang === 'tr') return text;
        const cache = ANKA_I18N.getCache();
        return cache[lang + '|' + text] || text;
    }

    async function prefetchTexts(texts) {
        if (!ANKA_I18N) return;
        const lang = ANKA_I18N.getLang();
        if (lang === 'tr') return;
        await ANKA_I18N.translateBatch(texts, lang);
    }

    function collectTabTexts(cat) {
        const texts = [];
        if (cat.title) texts.push(cat.title);
        if (cat.description) texts.push(cat.description);
        for (const g of cat.groups) {
            if (g.title) texts.push(g.title);
            for (const s of g.items) {
                if (s.label) texts.push(s.label);
                if (s.desc) texts.push(s.desc);
                if (s.placeholder) texts.push(s.placeholder);
                if (s.options) for (const o of s.options) if (o.name) texts.push(o.name);
                if (s.btnText) texts.push(s.btnText);
            }
        }
        return texts;
    }

    function showTranslationBanner(show) {
        if (!domCache.body) return;
        if (show) {
            if (translationBanner) return;
            translationBanner = document.createElement('div');
            translationBanner.className = 'anka-translate-banner';
            translationBanner.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg><span>Çeviriler hazırlanıyor…</span>';
            const content = domCache.panel.querySelector('.settings-content');
            if (content) content.insertBefore(translationBanner, domCache.body);
        } else if (translationBanner) {
            translationBanner.remove();
            translationBanner = null;
        }
    }

    function findSetting(id) { return settingIndex[id] || null; }

    function getDefault(s) {
        if (s.id === 'ui-animations' || s.id === 'smooth-scrolling') return LOW_END ? false : s.default;
        if (s.id === 'low-end-mode') return LOW_END;
        return s.default;
    }

    function getVal(s) {
        const stored = lsGet('set_' + s.id);
        if (stored === null) {
            if (s.id === 'start-fullscreen') return !!document.fullscreenElement;
            return getDefault(s);
        }
        if (s.type === 'toggle') return stored === 'true';
        if (s.type === 'select' && !s.options.some((o) => o.val === stored)) return getDefault(s);
        if (s.type === 'range') {
            const legacy = s.id === 'font-scale' ? { small: 90, normal: 100, large: 110 } : { compact: 90, normal: 100, large: 110, board: 125 };
            const value = Number.isFinite(Number(stored)) ? Number(stored) : legacy[stored];
            return String(Number.isFinite(value) ? Math.max(s.min, Math.min(s.max, value)) : getDefault(s));
        }
        if (s.type === 'number') {
            const n = parseInt(stored, 10);
            if (isNaN(n)) return getDefault(s);
            return String(Math.max(s.min, Math.min(s.max, n)));
        }
        return stored;
    }

    function isChanged(s) {
        const stored = lsGet('set_' + s.id);
        if (stored === null) return false;
        return stored !== String(getDefault(s));
    }

    function isSchoolActive() { return lsGet('set_school-mode') === 'true'; }
    function isLocked(id) { return isSchoolActive() && Object.prototype.hasOwnProperty.call(SCHOOL_POLICY, id); }

    function toast(message, type) {
        if (typeof showToast === 'function') { showToast(message, type); return; }
        const old = document.getElementById('anka-fallback-toast');
        if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'anka-fallback-toast';
        if (type === 'error') el.className = 'error';
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }

    function panelToast(message, type) {
        if (lsGet('set_notifications') === 'false') return;
        let el = document.getElementById('sp-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sp-toast';
            el.className = 'sp-toast';
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.className = 'sp-toast ' + (type || '');
        void el.offsetWidth;
        el.classList.add('visible');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('visible'), 2400);
    }

    function ensureConfirmDialog() {
        let overlay = document.getElementById('anka-confirm-overlay');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'anka-confirm-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = '<div id="anka-confirm-dialog"><h3 id="anka-confirm-title"></h3><p id="anka-confirm-message"></p><div id="anka-confirm-actions"><button type="button" class="sp-btn secondary" data-action="cancel"></button><button type="button" class="sp-btn" data-action="confirm"></button></div></div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function confirmBox(message, options) {
        const opts = options || {};
        if (typeof window.ankaConfirm === 'function') {
            return Promise.resolve(window.ankaConfirm(message, opts));
        }
        return new Promise((resolve) => {
            if (activeConfirm) {
                activeConfirm.resolve(false);
                activeConfirm = null;
            }
            const overlay = ensureConfirmDialog();
            const titleEl = document.getElementById('anka-confirm-title');
            const msgEl = document.getElementById('anka-confirm-message');
            const confirmBtn = overlay.querySelector('[data-action="confirm"]');
            const cancelBtn = overlay.querySelector('[data-action="cancel"]');
            titleEl.textContent = opts.title || 'Onay';
            msgEl.textContent = message;
            confirmBtn.textContent = opts.confirmText || 'Tamam';
            cancelBtn.textContent = opts.cancelText || 'İptal';
            confirmBtn.className = 'sp-btn' + (opts.danger ? ' danger' : '');
            overlay.classList.add('visible');
            overlay.style.display = 'flex';
            requestAnimationFrame(() => { overlay.style.opacity = '1'; });
            const finish = (result) => {
                overlay.classList.remove('visible');
                setTimeout(() => { overlay.style.display = 'none'; }, 180);
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onOverlayClick);
                document.removeEventListener('keydown', onKey);
                activeConfirm = null;
                resolve(result);
            };
            const onConfirm = () => finish(true);
            const onCancel = () => finish(false);
            const onOverlayClick = (e) => { if (e.target === overlay) finish(false); };
            const onKey = (e) => { if (e.key === 'Escape') finish(false); };
            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            overlay.addEventListener('click', onOverlayClick);
            document.addEventListener('keydown', onKey);
            activeConfirm = { resolve: finish };
            setTimeout(() => confirmBtn.focus(), 50);
        });
    }

    function notifyMain(id, val) {
        const api = window.electronAPI;
        const i = ipc();
        if (i && typeof i.invoke === 'function') {
            i.invoke('save-app-setting:commit', { id, val }).then((result) => {
                if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'Ayar kaydedilemedi.');
            }).catch((err) => {
                console.error('Ayar kalıcı olarak kaydedilemedi:', id, err);
                toast('Ayar kaydedilemedi. Depolama alanını ve dosya izinlerini kontrol edin.', 'error');
            });
        } else if (i) {
            i.send('save-app-setting', { id, val });
        } else if (api && api.sendSettingUpdate) {
            api.sendSettingUpdate({ id, val });
        } else {
            console.error('Ayar kaydedilemedi: IPC bağlantısı kullanılamıyor.', id);
            toast('Ayar kaydedilemedi: uygulama bağlantısı kullanılamıyor.', 'error');
        }
    }

    function getChannel() { return typeof themeChannel !== 'undefined' && themeChannel ? themeChannel : null; }

    function getStoredMode() {
        const stored = lsGet('set_theme-preset');
        if (stored !== null && THEME_IDS.includes(stored)) return stored;
        const legacy = lsGet('set_dark-mode');
        if (legacy === 'false') return 'light';
        if (legacy === 'true') return 'dark';
        return 'system';
    }

    function ensureThemeStored() {
        const mode = getStoredMode();
        if (lsGet('set_theme-preset') !== mode) lsSet('set_theme-preset', mode);
        lsRemove('set_dark-mode');
    }

    function resolveTheme(mode) {
        if (!THEME_IDS.includes(mode) || mode === 'system') return lightMQ.matches ? 'light' : 'dark';
        return mode;
    }

    function applyCustomThemeCss(value) {
        const css = String(value || '');
        let style = document.getElementById('anka-custom-theme-css');
        if (!style) {
            style = document.createElement('style');
            style.id = 'anka-custom-theme-css';
            document.head.appendChild(style);
        }
        style.textContent = css.length <= 32768 &&
            !/@import|url\s*\(|expression\s*\(|-moz-binding|behavior\s*:|javascript\s*:/i.test(css)
            ? css : '';
    }

    function applyTheme(mode, force) {
        mode = THEME_IDS.includes(mode) ? mode : 'system';
        const theme = resolveTheme(mode);
        const root = document.documentElement;
        const body = document.body;
        const key = mode + '|' + theme + '|' + (body ? 1 : 0);
        if (!force && root.dataset.themeKey === key) return;
        root.dataset.themeKey = key;
        const cls = theme === 'light' ? 'light-theme' : theme === 'dark' ? '' : 'theme-' + theme;
        const targets = body ? [root, body] : [root];
        for (const node of targets) {
            node.classList.remove(...THEME_CLASSES);
            if (cls) node.classList.add(cls);
        }
        root.dataset.themePreset = theme;
        root.dataset.themeMode = mode;
        root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
        const channel = getChannel();
        if (channel && !suppressThemeBroadcast && settingsHydrationFinished) channel.postMessage({ id: 'theme-preset', mode, val: theme });
        const i = ipc();
        if (i && settingsHydrationFinished) i.send('set-theme-source', mode === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark');
        if (typeof syncOpenNewTabThemes === 'function') syncOpenNewTabThemes();
        applyCustomAccent();
        applyCustomThemeCss(lsGet('set_custom-theme-css') || '');
    }

    function applyCustomAccent() {
        const root = document.documentElement;
        const custom = lsGet('set_custom-accent') || lsGet('set_accent-quick') || '';
        if (custom && /^#[0-9a-f]{6}$/i.test(custom)) {
            root.style.setProperty('--accent', custom);
            const r = parseInt(custom.slice(1, 3), 16);
            const g = parseInt(custom.slice(3, 5), 16);
            const b = parseInt(custom.slice(5, 7), 16);
            root.style.setProperty('--accent-soft', 'rgba(' + r + ',' + g + ',' + b + ',.14)');
        } else {
            root.style.removeProperty('--accent');
            root.style.removeProperty('--accent-soft');
        }
    }

    function applyFontFamily() {
        const root = document.documentElement;
        const body = document.body;
        const stored = lsGet('set_font-family');
        const map = {
            system: '',
            sans: 'system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"Noto Sans",Helvetica,Arial,sans-serif',
            serif: 'Georgia,"Times New Roman",Times,serif',
            mono: 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace'
        };
        const family = stored && stored !== 'system' && map[stored] ? map[stored] : '';
        if (family) {
            root.style.setProperty('--font', family);
            root.style.fontFamily = family;
            if (body) body.style.fontFamily = family;
        } else {
            root.style.removeProperty('--font');
            root.style.removeProperty('font-family');
            if (body) body.style.removeProperty('font-family');
        }
    }

    function applyFontScale(value) {
        const scale = Math.max(80, Math.min(150, Number(value) || 100)) / 100;
        const root = document.documentElement;
        const uiScale = Number(root.dataset.uiScale || 100) / 100;
        root.dataset.fontScale = String(Math.round(scale * 100));
        root.style.setProperty('--anka-font-scale', String(scale));
        root.style.fontSize = 16 * scale * uiScale + 'px';
        const base = Math.max(13, Math.min(15, window.innerWidth * 0.009 + 9));
        if (document.body) document.body.style.fontSize = (base * scale * uiScale) + 'px';
    }

    function applyUiScale(value) {
        const scale = Math.max(85, Math.min(125, Number(value) || 100)) / 100;
        const root = document.documentElement;
        root.dataset.uiScale = String(Math.round(scale * 100));
        root.style.setProperty('--anka-ui-scale', String(scale));
        const fontScale = Number(root.dataset.fontScale || 100) / 100;
        root.style.fontSize = 16 * fontScale * scale + 'px';
        const base = Math.max(13, Math.min(15, window.innerWidth * 0.009 + 9));
        if (document.body) document.body.style.fontSize = (base * fontScale * scale) + 'px';
    }

    function applyIconGlyphs() {
        const targets = [
            ...document.querySelectorAll('.side-btn i, .t-btn:not(#t-text), #open-external-btn, #downloads-btn')
        ];
        for (const target of targets) {
            if (target.querySelector('.icon-glyph')) continue;
            const textNodes = Array.from(target.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            for (const textNode of textNodes) {
                const glyph = document.createElement('span');
                glyph.className = 'icon-glyph';
                glyph.textContent = textNode.textContent;
                target.replaceChild(glyph, textNode);
            }
        }
    }

    function applyIconStyle(value) {
        const style = value === 'emoji' ? 'emoji' : 'monochrome';
        document.documentElement.dataset.iconStyle = style;
        applyIconGlyphs();
    }

    function applyPanelDensity() {
        const stored = lsGet('set_panel-density') || 'normal';
        document.documentElement.dataset.density = stored;
    }

    function applyReduceTransparency() {
        const on = lsGet('set_reduce-transparency') === 'true';
        document.documentElement.classList.toggle('reduce-transparency', on);
        if (document.body) document.body.classList.toggle('reduce-transparency', on);
    }

    function applyAutoTheme() {
        clearTimeout(autoThemeTimer);
        const enabled = lsGet('set_auto-theme') === 'true';
        if (!enabled) return;
        const now = new Date();
        const hour = now.getHours();
        const darkStart = parseInt(lsGet('set_auto-theme-dark-start') || '19', 10);
        const lightStart = parseInt(lsGet('set_auto-theme-light-start') || '7', 10);
        let isDark;
        if (darkStart < lightStart) isDark = hour >= darkStart && hour < lightStart;
        else if (darkStart > lightStart) isDark = hour >= darkStart || hour < lightStart;
        else isDark = hour >= 19;
        const desiredMode = isDark ? 'dark' : 'light';
        const currentMode = getStoredMode();
        if (currentMode === 'system' || currentMode === 'dark' || currentMode === 'light') {
            if (resolveTheme(currentMode) !== desiredMode) {
                if (typeof window.applySetting === 'function' && typeof window.saveSetting === 'function') {
                    window.saveSetting('theme-preset', desiredMode, true);
                }
            }
        }
        const nextHour = (hour + 1) % 24;
        const now2 = new Date();
        now2.setHours(nextHour, 0, 5, 0);
        autoThemeTimer = setTimeout(applyAutoTheme, Math.max(1000, now2 - Date.now()));
    }

    function themeSnapshot() {
        return {
            themePreset: getStoredMode(),
            uiScale: String(getVal(findSetting('ui-scale'))),
            fontScale: String(getVal(findSetting('font-scale'))),
            touchMode: getVal(findSetting('touch-mode')) === true,
            uiAnimations: getVal(findSetting('ui-animations')) === true,
            nightLight: lsGet('set_night-light') === 'true',
            nightLightStrength: String(lsGet('set_night-light-strength') || '25')
        };
    }

    function bindThemeChannel() {
        const channel = getChannel();
        if (!channel) return;
        channel.onmessage = (event) => {
            const data = event.data;
            if (!data) return;
            if (data.id === 'theme-preset') {
                const mode = getStoredMode();
                const incomingMode = THEME_IDS.includes(data.mode) ? data.mode : mode;
                suppressThemeBroadcast = true;
                try {
                if (incomingMode !== mode) refreshControl('theme-preset', findSetting('theme-preset'));
                applyTheme(incomingMode, true);
                } finally {
                    suppressThemeBroadcast = false;
                }
            } else if (data.id === 'theme-settings-request') {
                channel.postMessage({ id: 'theme-settings-snapshot', settings: themeSnapshot() });
            }
        };
    }

    function setToggleClass(name, on) {
        document.documentElement.classList.toggle(name, on);
        if (document.body) document.body.classList.toggle(name, on);
    }

    function ensureStyles() {
        if (stylesReady || document.getElementById('settings-styles')) { stylesReady = true; return; }
        const style = document.createElement('style');
        style.id = 'settings-styles';
        style.textContent = SETTINGS_CSS;
        document.head.appendChild(style);
        stylesReady = true;
    }

    function ensureFps() {
        let el = document.getElementById('fps-display');
        if (!el && document.body) {
            ensureStyles();
            el = document.createElement('div');
            el.id = 'fps-display';
            const fps = document.createElement('span');
            fps.id = 'fps-value';
            fps.textContent = 'FPS: --';
            const cpu = document.createElement('span');
            cpu.id = 'cpu-value';
            cpu.textContent = 'CPU: --%';
            el.append(fps, cpu);
            document.body.appendChild(el);
        }
        if (el) {
            el.style.setProperty('position', 'fixed', 'important');
            el.style.setProperty('inset', 'auto auto 10px 10px', 'important');
            el.style.setProperty('box-sizing', 'border-box');
            el.style.setProperty('width', 'max-content', 'important');
            el.style.setProperty('height', 'auto', 'important');
            el.style.setProperty('min-width', '0', 'important');
            el.style.setProperty('min-height', '0', 'important');
            el.style.setProperty('max-width', 'calc(100vw - 20px)', 'important');
            el.style.setProperty('max-height', '48px', 'important');
            el.style.setProperty('overflow', 'hidden');
            el.style.setProperty('white-space', 'nowrap');
            el.style.setProperty('contain', 'layout paint style');
            el.style.setProperty('z-index', '2147483647', 'important');
            el.style.setProperty('isolation', 'isolate');
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'off');
            if (!el.parentElement || el.parentElement !== document.body) document.body.appendChild(el);
        }
        fpsEl = el;
        return el;
    }

    function updateFPS(now) {
        fpsFrameCount++;
        if (now - fpsLastTime >= 1000) {
            if (!fpsEl || !fpsEl.isConnected) {
                fpsEl = ensureFps();
                if (fpsEl) syncPerformanceMonitor();
            }
            const fpsValue = fpsEl && fpsEl.querySelector('#fps-value');
            if (fpsValue) fpsValue.textContent = 'FPS: ' + fpsFrameCount;
            fpsFrameCount = 0;
            fpsLastTime = now;
        }
        fpsAnimationId = requestAnimationFrame(updateFPS);
    }

    function updateSystemCpu() {
        const api = ipc();
        if (!api || typeof api.invoke !== 'function') return;
        api.invoke('get-system-performance').then((result) => {
            if (!result || !Number.isFinite(result.cpuPercent)) return;
            const el = document.getElementById('fps-display');
            const cpu = el && el.querySelector('#cpu-value');
            if (cpu) cpu.textContent = 'CPU: ' + Math.round(result.cpuPercent) + '%';
        }).catch((err) => console.error('Sistem CPU kullanımı okunamadı:', err));
    }

    function updateMonitorPosition() {
        const el = ensureFps();
        if (!el) return;
        const position = lsGet('set_monitor-position') === 'right' ? 'right' : 'left';
        el.dataset.position = position;
        el.style.setProperty('inset', position === 'right' ? 'auto 10px 10px auto' : 'auto auto 10px 10px', 'important');
        const backgrounds = {
            black: [0, 0, 0],
            graphite: [38, 42, 51],
            accent: [255, 71, 87],
            light: [244, 246, 251]
        };
        const color = backgrounds[lsGet('set_monitor-background')] || backgrounds.black;
        const opacity = Math.max(10, Math.min(100, Number(lsGet('set_monitor-opacity')) || 70)) / 100;
        const scale = Math.max(80, Math.min(150, Number(lsGet('set_monitor-scale')) || 100)) / 100;
        el.style.setProperty('--fps-background', 'rgba(' + color.join(',') + ',' + opacity + ')');
        el.style.setProperty('font-size', (11 * scale) + 'px');
        el.style.setProperty('padding', (4 * scale) + 'px ' + (8 * scale) + 'px');
        el.style.setProperty('gap', (7 * scale) + 'px');
        el.style.setProperty('color', lsGet('set_monitor-background') === 'light' ? '#17171b' : '#fff');
        el.querySelectorAll('span').forEach((span) => {
            span.style.color = lsGet('set_monitor-background') === 'light' ? '#17171b' : '#fff';
        });
    }

    function syncPerformanceMonitor() {
        const fps = lsGet('set_fps-meter') === 'true';
        const cpu = lsGet('set_system-monitor') === 'true';
        const el = ensureFps();
        if (!el) return;
        el.style.setProperty('display', fps || cpu ? 'flex' : 'none', 'important');
        const fpsValue = el.querySelector('#fps-value');
        const cpuValue = el.querySelector('#cpu-value');
        if (fpsValue) fpsValue.hidden = !fps;
        if (cpuValue) cpuValue.hidden = !cpu;
        updateMonitorPosition();
        if (fps && !fpsAnimationId) {
            fpsFrameCount = 0;
            fpsLastTime = performance.now();
            fpsAnimationId = requestAnimationFrame(updateFPS);
        } else if (!fps && fpsAnimationId) {
            cancelAnimationFrame(fpsAnimationId);
            fpsAnimationId = 0;
        }
        if (cpu && !cpuRefreshTimer) {
            updateSystemCpu();
            cpuRefreshTimer = window.setInterval(updateSystemCpu, 1500);
        } else if (!cpu && cpuRefreshTimer) {
            clearInterval(cpuRefreshTimer);
            cpuRefreshTimer = 0;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncPerformanceMonitor, { once: true });
    } else {
        requestAnimationFrame(syncPerformanceMonitor);
    }

    function setupMovableMenus() {
        if (window.__ankaMovableMenusReady || !document.body) return;
        window.__ankaMovableMenusReady = true;
        const getPanels = (root) => [
            ['settings-panel', root.querySelector('#settings-panel'), '.settings-header'],
            ['help-panel', root.querySelector('#help-panel'), '.help-header'],
            ['anka-site-info-panel', root.querySelector('#anka-site-info-panel'), 'strong'],
            ['anka-media-panel', root.querySelector('#anka-media-panel'), '[data-movable-handle]'],
            ['xt-side', root.querySelector('#xt-side'), '.xt-side-head'],
            ['paint-menu', root.querySelector('#paint-menu'), '#paint-handle'],
            ['keyboard', root.querySelector('#keyboard'), '#kb-handle']
        ];
        const readPositions = () => {
            try {
                const positions = JSON.parse(localStorage.getItem('anka_menu_positions') || '{}');
                return positions && typeof positions === 'object' ? positions : {};
            } catch (err) {
                console.error('Menü konumları okunamadı:', err);
                return {};
            }
        };
        const isMovable = () => lsGet('set_movable-menus') === 'true';
        const isPanelMovable = (panel) => panel && (panel.id === 'paint-menu' || isMovable());
        const shouldSave = () => lsGet('set_save-menu-positions') !== 'false';
        const resetPanel = (panel) => {
            if (!panel) return;
            if (!panel.classList.contains('user-moved')) {
                delete panel.dataset.ankaPositionRestored;
                return;
            }
            panel.style.removeProperty('position');
            panel.style.removeProperty('left');
            panel.style.removeProperty('top');
            panel.style.removeProperty('right');
            panel.style.removeProperty('bottom');
            panel.style.removeProperty('transform');
            panel.classList.remove('user-moved', 'moved', 'is-dragging', 'anka-menu-moving');
            delete panel.dataset.ankaPositionRestored;
        };
        const restore = (panel) => {
            if (!isPanelMovable(panel) || !shouldSave() || panel.dataset.ankaPositionRestored === 'true') return;
            panel.dataset.ankaPositionRestored = 'true';
            const position = readPositions()[panel.id];
            if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
            panel.style.position = 'fixed';
            panel.style.left = Math.max(8, Math.min(position.x, window.innerWidth - 80)) + 'px';
            panel.style.top = Math.max(44, Math.min(position.y, window.innerHeight - 80)) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transform = 'none';
            panel.classList.add('user-moved');
        };
        const refreshPanels = () => {
            for (const [, panel] of getPanels(document)) {
                if (!panel) continue;
                if (!isPanelMovable(panel)) resetPanel(panel);
                else if (shouldSave()) {
                    delete panel.dataset.ankaPositionRestored;
                    restore(panel);
                }
            }
        };
        window.__ankaRefreshMovableMenus = refreshPanels;
        const restoreTree = (root) => {
            if (root.nodeType === Node.ELEMENT_NODE && ['settings-panel', 'help-panel', 'anka-site-info-panel', 'anka-media-panel', 'xt-side', 'paint-menu', 'keyboard'].includes(root.id)) {
                restore(root);
            }
            for (const [, panel] of getPanels(root)) {
                if (panel) restore(panel);
            }
        };
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    restoreTree(node);
                    if (node.querySelector) restoreTree(node);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        restoreTree(document);
        document.addEventListener('pointerdown', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;
            if (target.closest('#paint-handle')) return;
            const movable = isMovable();
            const legacyHandle = target.closest('#paint-handle,#kb-handle');
            if (!movable) {
                if (legacyHandle && !target.closest('button,input,select,textarea,a,[role="button"]')) event.stopImmediatePropagation();
                return;
            }
            if (event.button !== 0) return;
            const entry = getPanels(document).find(([, panel, handleSelector]) => {
                const handle = target.closest(handleSelector);
                return panel && handle && panel.contains(handle);
            });
            if (!entry || target.closest('button,input,select,textarea,a,[role="button"]')) return;
            const panel = entry[1];
            restore(panel);
            const startRect = panel.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const pointerId = event.pointerId;
            const clamp = (x, y) => ({
                x: Math.max(8, Math.min(x, window.innerWidth - panel.offsetWidth - 8)),
                y: Math.max(44, Math.min(y, window.innerHeight - panel.offsetHeight - 8))
            });
            panel.style.position = 'fixed';
            panel.style.transform = 'none';
            panel.style.left = startRect.left + 'px';
            panel.style.top = startRect.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.classList.add('user-moved', 'anka-menu-moving');
            event.preventDefault();
            event.stopImmediatePropagation();
            const move = (moveEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                const pos = clamp(startRect.left + moveEvent.clientX - startX, startRect.top + moveEvent.clientY - startY);
                panel.style.left = pos.x + 'px';
                panel.style.top = pos.y + 'px';
            };
            const finish = (finishEvent) => {
                if (finishEvent.pointerId !== pointerId) return;
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', finish);
                document.removeEventListener('pointercancel', finish);
                panel.classList.remove('anka-menu-moving');
                if (shouldSave()) {
                    const positions = readPositions();
                    positions[panel.id] = { x: panel.getBoundingClientRect().left, y: panel.getBoundingClientRect().top };
                    try { localStorage.setItem('anka_menu_positions', JSON.stringify(positions)); }
                    catch (err) {
                        console.error('Menü konumu kaydedilemedi:', err);
                        if (typeof window.showToast === 'function') window.showToast('Menü konumu kaydedilemedi.', 'error');
                    }
                }
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', finish);
            document.addEventListener('pointercancel', finish);
        }, true);
    }

    function updateMenuPositionControls() {
        const row = document.querySelector('.sp-item[data-id="save-menu-positions"]');
        if (row) row.style.display = '';
    }

    function applySetting(id, val) {
        const boolVal = val === true || val === 'true';
        const root = document.documentElement;
        if (id === 'fps-meter' || id === 'system-monitor' || id === 'monitor-position' || id === 'monitor-background' || id === 'monitor-opacity' || id === 'monitor-scale') {
            syncPerformanceMonitor();
        } else if (id === 'fps-limit') {
            window.dispatchEvent(new CustomEvent('anka-fps-limit-change', {
                detail: { fps: [0, 30, 45, 60, 90, 120].includes(Number(val)) ? Number(val) : 0 }
            }));
        } else if (id === 'start-fullscreen') {
            if (window.electronAPI && window.electronAPI.setFullscreen) window.electronAPI.setFullscreen(boolVal);
            else if (ipc()) ipc().send('set-fullscreen', boolVal);
            else if (boolVal && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
            else if (!boolVal && document.fullscreenElement) document.exitFullscreen().catch(() => {});
        } else if (id === 'ai-mode-active') {
            const btn = document.getElementById('ai-mode-btn');
            if (btn) {
                btn.classList.toggle('active', boolVal);
                btn.setAttribute('aria-pressed', String(boolVal));
            }
            if (typeof setAiMode === 'function' && (typeof aiModeActive === 'undefined' || aiModeActive !== boolVal)) setAiMode(boolVal);
        } else if (id === 'theme-preset') {
            applyTheme(THEME_IDS.includes(String(val)) ? String(val) : 'system');
        } else if (id === 'custom-accent' || id === 'accent-quick') {
            applyCustomAccent();
        } else if (id === 'custom-theme-css') {
            applyCustomThemeCss(val);
        } else if (id === 'font-family') {
            applyFontFamily();
        } else if (id === 'icon-style') {
            applyIconStyle(String(val));
        } else if (id === 'panel-density') {
            applyPanelDensity();
        } else if (id === 'auto-theme' || id === 'auto-theme-dark-start' || id === 'auto-theme-light-start') {
            applyAutoTheme();
        } else if (id === 'language') {
            const lang = String(val || 'tr');
            if (ANKA_I18N) ANKA_I18N.setLang(lang);
            if (typeof syncOpenNewTabThemes === 'function') syncOpenNewTabThemes();
            if (panelOpen) renderTab(currentTab);
        } else if (id === 'smooth-scrolling') {
            root.style.scrollBehavior = boolVal ? 'smooth' : 'auto';
            root.classList.toggle('smooth', boolVal);
        } else if (id === 'font-scale') {
            applyFontScale(val);
        } else if (id === 'ui-scale') {
            applyUiScale(val);
        } else if (id === 'logo-size') {
            root.style.setProperty('--anka-logo-size', Math.max(36, Math.min(56, Number(val) || 44)) + 'px');
        } else if (id === 'movable-menus') {
            root.dataset.movableMenus = boolVal ? 'on' : 'off';
            if (typeof window.__ankaRefreshMovableMenus === 'function') window.__ankaRefreshMovableMenus();
            updateMenuPositionControls();
        } else if (id === 'save-menu-positions') {
            if (!boolVal) {
                try { localStorage.removeItem('anka_menu_positions'); }
                catch (err) {
                    console.error('Kayıtlı menü konumları silinemedi:', err);
                    if (typeof window.showToast === 'function') window.showToast('Kayıtlı menü konumları silinemedi.', 'error');
                }
            }
            if (typeof window.__ankaRefreshMovableMenus === 'function') window.__ankaRefreshMovableMenus();
        } else if (id === 'side-panel-side') {
            root.dataset.sidePanelSide = val === 'left' ? 'left' : 'right';
            if (typeof window.applyChromeLayout === 'function') window.applyChromeLayout();
        } else if (['sidebar-side', 'bookmarks-bar', 'show-home-btn', 'tab-memory', 'page-zoom'].includes(id)) {
            if (typeof window.applyChromeLayout === 'function') window.applyChromeLayout();
        } else if (id === 'touch-mode') {
            setToggleClass('touch-mode', boolVal);
        } else if (id === 'low-end-mode') {
            if (typeof window.setPaintPerformanceMode === 'function') window.setPaintPerformanceMode(boolVal);
            setToggleClass('perf-lite', boolVal || !!(window.ANKA_ENV && window.ANKA_ENV.lowEnd));
            setToggleClass('reduce-effects', boolVal || lsGet('set_ui-animations') === 'false');
            if (typeof window.__ankaApplyLimits === 'function') window.__ankaApplyLimits();
        } else if (id === 'max-live-tabs' || id === 'tab-sleep-minutes' || id === 'memory-saver' || id === 'smart-tab-manager' || id === 'disk-backed-tab-saver') {
            if (typeof window.__ankaApplyLimits === 'function') window.__ankaApplyLimits();
        } else if (id === 'compact-tabs') {
            root.classList.toggle('compact-tabs', boolVal);
        } else if (id === 'vertical-tabs') {
            root.dataset.verticalTabs = boolVal ? 'on' : 'off';
            if (typeof closeTabDropdown === 'function') closeTabDropdown();
            if (typeof window.applyChromeLayout === 'function') window.applyChromeLayout();
        } else if (id === 'experimental-features') {
            root.dataset.experimental = boolVal ? 'on' : 'off';
        } else if (id === 'notifications') {
            root.dataset.notifications = boolVal ? 'on' : 'off';
        } else if (id === 'quick-menu-button') {
            const quickMenuButton = document.getElementById('quick-actions-btn');
            if (quickMenuButton) quickMenuButton.hidden = !boolVal;
            if (!boolVal && typeof window.closeQuickActions === 'function') window.closeQuickActions();
        } else if (id === 'sidebar-help-button') {
            const helpButton = document.getElementById('btn-help');
            if (helpButton) helpButton.hidden = !boolVal;
        } else if (id === 'quick-menu-help' || id === 'quick-menu-groups' || id === 'quick-menu-window-name' || id === 'quick-menu-copy-page-url' || id === 'quick-menu-site-shortcut') {
            if (typeof window.refreshQuickActionsMenu === 'function') window.refreshQuickActionsMenu();
        } else if (id === 'search-suggestions') {
            root.dataset.searchSuggestions = boolVal ? 'on' : 'off';
        } else if (id === 'school-mode') {
            root.dataset.schoolMode = boolVal ? 'on' : 'off';
            if (typeof window.applySchoolChrome === 'function') window.applySchoolChrome();
        } else if (id === 'game-mode') {
            applyPlayerMode(boolVal);
        } else if (id === 'ui-animations') {
            const reduce = !boolVal;
            setToggleClass('reduce-effects', reduce);
            root.classList.toggle('perf-lite', reduce || !!(window.ANKA_ENV && window.ANKA_ENV.lowEnd));
        } else if (id === 'reduce-transparency') {
            applyReduceTransparency();
        } else if (id === 'night-light' || id === 'night-light-strength') {
            const enabled = lsGet('set_night-light') === 'true';
            const strength = Math.max(10, Math.min(50, Number(lsGet('set_night-light-strength')) || 25));
            root.classList.toggle('night-light', enabled);
            root.style.setProperty('--anka-night-light-strength', String(strength / 100));
        } else if (id === 'profile-isolation') {
            window.ANKA_PROFILE_ISOLATION = boolVal;
        }

        if ((id === 'font-scale' || id === 'ui-scale' || id === 'logo-size' || id === 'touch-mode' || id === 'ui-animations' || id === 'night-light' || id === 'night-light-strength') && typeof syncOpenNewTabThemes === 'function') {
            syncOpenNewTabThemes();
        }
    }

    function refreshControl(id, s) {
        if (!panelOpen || !domCache.body) return;
        const ctl = domCache.body.querySelector('[data-id="' + id + '"]');
        if (!ctl || document.activeElement === ctl) return;
        const v = getVal(s);
        if (ctl.type === 'checkbox') ctl.checked = v === true;
        else ctl.value = v === undefined || v === null ? '' : String(v);
        if (s.type === 'range') {
            const output = document.getElementById('value-' + id);
            if (output) output.value = String(v) + '%';
        }
    }

    function saveSetting(id, val, force) {
        if (!force && isLocked(id)) {
            toast('Bu ayar Okul Modu tarafından yönetiliyor.', 'error');
            return false;
        }
        const s = findSetting(id);
        const isToggle = !!s && s.type === 'toggle';
        let out;
        if (isToggle) out = val === true || val === 'true' ? 'true' : 'false';
        else {
            out = String(val);
            if (s && s.type === 'select' && !s.options.some((o) => o.val === out)) return false;
        }
        const changed = lsGet('set_' + id) !== out;
        if (!lsSet('set_' + id, out)) {
            toast('Ayar yerel depolamaya yazılamadı.', 'error');
            return false;
        }
        if (id === 'theme-preset') lsSet('set_theme-preset-selected', 'true');
        if (settingsHydrationStarted && !settingsHydrationFinished) settingsEditedDuringHydration.add(id);
        applySetting(id, out);
        if (s) refreshControl(id, s);
        const persisted = isToggle && id === 'game-mode' ? lsGet('set_game-mode') === 'true' : out === 'true';
        notifyMain(id, isToggle ? persisted : out);
        if (changed && (id === 'restore-session' || id === 'disk-backed-tab-saver')) {
            window.dispatchEvent(new Event('anka:session-storage-setting-changed'));
        }
        refreshChangedIndicators();
        return true;
    }

    function syncSchool(on) {
        const was = isSchoolActive();
        const str = on ? 'true' : 'false';
        if (on && lsGet('set_game-mode') === 'true') saveSetting('game-mode', 'false', true);
        if (lsGet('set_school-mode') !== str) saveSetting('school-mode', str, true);
        else applySetting('school-mode', str);
        if (on && !was) saveProfileSnapshot('school', Object.keys(SCHOOL_POLICY));
        if (on) {
            for (const id of Object.keys(SCHOOL_POLICY)) {
                if (lsGet('set_' + id) !== SCHOOL_POLICY[id]) saveSetting(id, SCHOOL_POLICY[id], true);
            }
        } else if (was) {
            restoreProfileSnapshot('school', Object.keys(SCHOOL_POLICY));
        }
    }

    function saveProfileSnapshot(name, ids) {
        const values = {};
        for (const id of ids) values[id] = lsGet('set_' + id);
        const key = 'anka_' + name + '_profile_snapshot';
        if (!lsSet(key, JSON.stringify(values))) return false;
        return true;
    }

    function restoreProfileSnapshot(name, ids) {
        const key = 'anka_' + name + '_profile_snapshot';
        const stored = lsGet(key);
        if (stored === null) return;
        let values = null;
        try { values = JSON.parse(stored); } catch (e) {}
        lsRemove(key);
        for (const id of ids) {
            const setting = findSetting(id);
            if (!setting) continue;
            const previous = values && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : null;
            if (previous === null) {
                saveSetting(id, getDefault(setting), true);
                lsRemove('set_' + id);
            } else {
                saveSetting(id, previous, true);
            }
        }
    }

    function applyPlayerMode(enabled) {
        if (enabled && isSchoolActive()) {
            lsSet('set_game-mode', 'false');
            document.documentElement.dataset.gameMode = 'off';
            if (document.body) document.body.classList.remove('player-mode');
            const button = document.getElementById('btn-player-mode');
            if (button) button.setAttribute('aria-pressed', 'false');
            lsRemove('anka_player_profile_snapshot');
            notifyMain('game-mode', false);
            toast('Oyuncu Modu, Okul Modu kapatılmadan açılamaz.', 'error');
            return;
        }
        const ids = Object.keys(PLAYER_POLICY);
        if (enabled) {
            if (!lsGet('anka_player_profile_snapshot') && !saveProfileSnapshot('player', ids)) {
                lsSet('set_game-mode', 'false');
                const button = document.getElementById('btn-player-mode');
                if (button) button.setAttribute('aria-pressed', 'false');
                notifyMain('game-mode', false);
                toast('Oyuncu profili kaydedilemedi; ayarlar değiştirilmedi.', 'error');
                return;
            }
            document.documentElement.dataset.gameMode = 'on';
            if (document.body) document.body.classList.add('player-mode');
            const button = document.getElementById('btn-player-mode');
            if (button) button.setAttribute('aria-pressed', 'true');
            for (const id of ids) {
                const setting = findSetting(id);
                if (setting && lsGet('set_' + id) !== PLAYER_POLICY[id]) saveSetting(id, PLAYER_POLICY[id], true);
            }
        } else {
            document.documentElement.dataset.gameMode = 'off';
            if (document.body) document.body.classList.remove('player-mode');
            const button = document.getElementById('btn-player-mode');
            if (button) button.setAttribute('aria-pressed', 'false');
            restoreProfileSnapshot('player', ids);
        }
    }

    function togglePlayerMode() {
        saveSetting('game-mode', lsGet('set_game-mode') !== 'true', true);
    }

    function applyStoredSettings() {
        for (const catKey in SETTINGS_DATA) {
            for (const group of SETTINGS_DATA[catKey].groups) {
                for (const s of group.items) {
                    if (s.type === 'button' || s.type === 'button-status') continue;
                    const stored = lsGet('set_' + s.id);
                    if (s.id === 'start-fullscreen') {
                        if (stored === 'true') applySetting(s.id, true);
                        continue;
                    }
                    applySetting(s.id, stored !== null ? stored : getDefault(s));
                }
            }
        }
        applySetting('school-mode', isSchoolActive());
        applyCustomAccent();
        applyFontFamily();
        applyPanelDensity();
        applyReduceTransparency();
        applyAutoTheme();
        window.addEventListener('resize', () => applyFontScale(getVal(findSetting('font-scale'))), { passive: true });
    }

    function flushExternal() {
        externalTimer = 0;
        const all = pendingIds.has('*');
        const ids = Array.from(pendingIds);
        pendingIds.clear();
        if (all) {
            ensureThemeStored();
            applyStoredSettings();
            if (panelOpen && currentTab !== 'okul' && currentTab !== 'hakkinda') renderTab(currentTab);
            return;
        }
        for (const id of ids) {
            if (id === 'school-mode') { applySetting(id, isSchoolActive()); continue; }
            const s = findSetting(id);
            if (!s || s.type === 'button' || s.type === 'button-status' || id === 'start-fullscreen') continue;
            applySetting(id, getVal(s));
            refreshControl(id, s);
        }
        refreshChangedIndicators();
    }

    function onStorage(event) {
        if (localArea && event.storageArea && event.storageArea !== localArea) return;
        const key = event.key;
        if (key === null) pendingIds.add('*');
        else if (key.startsWith('set_')) pendingIds.add(key.slice(4));
        else return;
        if (!externalTimer) externalTimer = setTimeout(flushExternal, 40);
    }

    function getNavCount(catKey) {
        if (catKey === 'okul' || catKey === 'hakkinda') return 0;
        const cat = SETTINGS_DATA[catKey];
        if (!cat) return 0;
        let count = 0;
        for (const group of cat.groups) for (const s of group.items) if (isChanged(s)) count++;
        return count;
    }

    function getChangedTotal() {
        let n = 0;
        for (const id in settingIndex) if (isChanged(settingIndex[id])) n++;
        return n;
    }

    function refreshChangedIndicators() {
        if (!panelOpen || !domCache.panel) return;
        if (!domCache.navItems) domCache.navItems = domCache.panel.querySelectorAll('.settings-nav-item[data-tab]');
        for (const item of domCache.navItems) {
            const count = getNavCount(item.dataset.tab);
            const counter = item.querySelector('.nav-count');
            if (counter) {
                counter.textContent = String(count);
                counter.style.display = count > 0 ? '' : 'none';
            }
        }
        const hint = domCache.searchHint;
        if (hint) {
            const total = getChangedTotal();
            if (!searchQuery && total > 0) {
                hint.textContent = total + ' ayar varsayılandan farklı';
                hint.classList.add('visible');
            } else if (!searchQuery) {
                hint.classList.remove('visible');
            }
        }
        if (!domCache.body) return;
        const items = domCache.body.querySelectorAll('.sp-item[data-id]');
        for (const item of items) {
            const id = item.dataset.id;
            const s = findSetting(id);
            if (!s) continue;
            const changed = isChanged(s);
            item.classList.toggle('changed', changed);
            const dot = item.querySelector('.changed-dot');
            if (dot) dot.style.display = changed ? '' : 'none';
        }
        const groups = domCache.body.querySelectorAll('.sp-group[data-group]');
        for (const gEl of groups) {
            const gid = gEl.dataset.group;
            const grp = groupIndex[gid];
            if (!grp) continue;
            let c = 0;
            for (const it of grp.items) if (isChanged(it)) c++;
            const badge = gEl.querySelector('.gp-badge');
            if (badge) { badge.textContent = String(c); badge.style.display = c > 0 ? '' : 'none'; }
        }
    }

    function getCollapseState() {
        try { return JSON.parse(lsGet('anka_settings_collapsed') || '{}') || {}; }
        catch (e) { return {}; }
    }

    function setCollapseState(state) {
        try { lsSet('anka_settings_collapsed', JSON.stringify(state)); } catch (e) {}
    }

    function isGroupCollapsed(gid) {
        const state = getCollapseState();
        if (Object.prototype.hasOwnProperty.call(state, gid)) return !!state[gid];
        return false;
    }

    function toggleGroup(gid, headerEl) {
        const state = getCollapseState();
        state[gid] = !isGroupCollapsed(gid);
        setCollapseState(state);
        const groupEl = headerEl.closest('.sp-group');
        if (groupEl) groupEl.classList.toggle('collapsed', state[gid]);
    }

    function collapseAllGroups(collapse) {
        const state = getCollapseState();
        if (!domCache.body) return;
        const groups = domCache.body.querySelectorAll('.sp-group[data-group]');
        for (const el of groups) {
            state[el.dataset.group] = collapse;
            el.classList.toggle('collapsed', collapse);
        }
        setCollapseState(state);
    }

    function renderControl(s, v, locked) {
        const dis = locked ? ' disabled' : '';
        if (s.type === 'language-pack') {
    const lang = s.lang;
    const texts = collectAllSettingsTexts();
    const prog = ANKA_I18N ? ANKA_I18N.getPackProgress(texts, lang) : { done: 0, total: texts.length, percent: 0 };
    const isFull = prog.percent === 100;
    const needsRestart = isFull && restartRequiredPacks.has(lang);
    const isQueued = packCurrentLang === lang || packQueue.indexOf(lang) !== -1;
    const statusClass = isFull ? 'ok' : (isQueued || prog.done > 0 ? 'info' : 'no');
    const statusText = isQueued ? 'İndirme devam ediyor' : (isFull ? 'İndirildi' : (prog.done > 0 ? prog.done + '/' + prog.total : 'Hazır değil'));
    return `<div class="pack-row" data-pack-lang="${lang}"><span class="pack-status sp-status ${statusClass}" id="pack-status-${lang}">${statusText}</span><div class="pack-bar"><div class="pack-bar-fill${isFull ? ' done' : ''}" id="pack-fill-${lang}" style="width:${prog.percent}%"></div></div><button type="button" class="sp-btn${isFull && !needsRestart ? ' secondary' : ''}" data-action="${needsRestart ? 'restart-app' : 'download-pack'}" data-lang="${lang}" id="pack-btn-${lang}"${isQueued ? ' disabled' : ''}>${isQueued ? 'İndiriliyor…' : (needsRestart ? 'Uygulamayı Yeniden Başlat' : (isFull ? 'Yeniden İndir' : 'İndir'))}</button>${needsRestart ? '<span class="pack-complete-note">Paket indirildi. Uygulamayı yeniden başlatmak için yukarıdaki düğmeye tıklayın.</span>' : ''}</div>`;
}
        if (s.type === 'toggle') {
            return `<label class="sp-toggle"><input type="checkbox" data-id="${s.id}"${v ? ' checked' : ''}${dis}><span class="sp-slider"></span></label>`;
        }
        if (s.type === 'select') {
            let opts = '';
            for (const o of s.options) opts += `<option value="${esc(o.val)}"${v === o.val ? ' selected' : ''}>${esc(t(o.name))}</option>`;
            return `<select class="sp-select" data-id="${s.id}"${dis}>${opts}</select>`;
        }
        if (s.type === 'range') {
            return `<div class="sp-range"><input type="range" data-id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${esc(v)}" aria-label="${esc(t(s.label))}"${dis}><output id="value-${s.id}">${esc(v)}%</output></div>`;
        }
        if (s.type === 'text') {
            return `<input class="sp-text" type="text" data-id="${s.id}" value="${esc(v || '')}" placeholder="${esc(t(s.placeholder || ''))}"${dis}>`;
        }
        if (s.type === 'css') {
            return `<textarea class="sp-css-editor" data-id="${s.id}" rows="8" maxlength="32768" spellcheck="false" placeholder=":root { --accent: #7c5cff; }"${dis}>${esc(v || '')}</textarea>`;
        }
        if (s.type === 'number') {
            return `<input class="sp-text" type="number" data-id="${s.id}" min="${s.min}" max="${s.max}" value="${esc(v || '')}" placeholder="${esc(t(s.placeholder || ''))}"${dis}>`;
        }
        if (s.type === 'color') {
            const safeVal = /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ff4757';
            return `<div class="sp-color-wrap"><input type="color" class="sp-color" data-id="${s.id}" value="${safeVal}"><button type="button" class="sp-color-reset" data-reset-id="${s.id}" title="${esc(t('Tema varsayılanına dön'))}">${esc(t('Sıfırla'))}</button></div>`;
        }
        if (s.type === 'button') {
            const isDanger = s.action === 'clearTempDataAndRestart';
            return `<button class="sp-btn${isDanger ? ' danger' : ''}" type="button" data-action="${s.action}">${esc(t(s.btnText))}</button>`;
        }
        if (s.type === 'button-status') {
            return `<div class="sp-item-ctl"><span class="sp-status info" id="status-${s.id}">Kontrol ediliyor...</span><button class="sp-btn" type="button" id="btn-${s.id}" data-action="${s.action}">${esc(t(s.btnText))}</button></div>`;
        }
        return '';
    }

    function rowHTML(s) {
        const v = getVal(s);
        const locked = isLocked(s.id);
        const changed = isChanged(s);
        const ctl = renderControl(s, v, locked);
        const isButton = s.type === 'button' || s.type === 'button-status' || s.type === 'language-pack';
        const label = esc(t(s.label));
        const desc = esc(t(s.desc));
        if (isButton) {
            return `<div class="sp-item${locked ? ' locked' : ''}" data-id="${s.id}"><div class="sp-item-main"><div class="sp-item-label">${label}</div><div class="sp-item-desc">${desc}${locked ? ' <span class="lock-note">· Okul Modu tarafından yönetiliyor</span>' : ''}</div></div>${ctl}</div>`;
        }
        return `<div class="sp-item${locked ? ' locked' : ''}${changed ? ' changed' : ''}" data-id="${s.id}"><div class="sp-item-main"><div class="sp-item-label"><span class="changed-dot" style="display:${changed ? '' : 'none'}"></span>${label}</div><div class="sp-item-desc">${desc}${locked ? ' <span class="lock-note">· Okul Modu tarafından yönetiliyor</span>' : ''}</div></div><div class="sp-item-ctl">${ctl}</div></div>`;
    }

    function groupHTML(group) {
        const collapsed = isGroupCollapsed(group.id);
        let changedCount = 0;
        for (const s of group.items) if (isChanged(s)) changedCount++;
        let rows = '';
        for (const s of group.items) rows += rowHTML(s);
        return `<div class="sp-group${collapsed ? ' collapsed' : ''}" data-group="${group.id}"><div class="sp-group-header" data-gid="${group.id}"><div class="gp-icon"><svg viewBox="0 0 24 24">${group.icon || '<circle cx="12" cy="12" r="10"/>'}</svg></div><div class="gp-title">${esc(t(group.title))}</div><div class="gp-badge" style="display:${changedCount > 0 ? '' : 'none'}">${changedCount}</div><div class="gp-arrow"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div></div><div class="sp-group-body">${rows}</div></div>`;
    }

    function matchesQueryDeep(s) {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || t(s.label).toLowerCase().includes(q) || t(s.desc).toLowerCase().includes(q);
    }

    async function renderTab(catKey) {
        if (!domCache.body) return;
        currentTab = catKey;
        if (domCache.panel) {
            if (!domCache.navItems) domCache.navItems = domCache.panel.querySelectorAll('.settings-nav-item[data-tab]');
            for (const item of domCache.navItems) item.classList.toggle('active', item.dataset.tab === catKey);
        }
        const titleEl = domCache.title;
        if (catKey === 'okul') {
            titleEl.innerHTML = esc(t('Okul Modu')) + '<small>' + esc(t('Kurumsal yönetim ve kullanıcılar')) + '</small>';
            renderSchoolSettings(domCache.body);
            return;
        }
        if (catKey === 'hakkinda') {
            titleEl.innerHTML = esc(t('Hakkında')) + '<small>' + esc(t('Sürüm bilgisi ve güncelleme')) + '</small>';
            renderAboutSettings(domCache.body);
            return;
        }
        const cat = SETTINGS_DATA[catKey];
        if (!cat) return;
        const lang = ANKA_I18N ? ANKA_I18N.getLang() : 'tr';
        if (lang !== 'tr' && !translationInFlight) {
            const texts = collectTabTexts(cat);
            const cache = ANKA_I18N.getCache();
            const missing = texts.some((x) => !cache[lang + '|' + x]);
            if (missing) {
                translationInFlight = true;
                showTranslationBanner(true);
                try { await prefetchTexts(texts); }
                catch (e) {}
                translationInFlight = false;
                showTranslationBanner(false);
                if (currentTab !== catKey) return;
            }
        }
        titleEl.innerHTML = esc(t(cat.title)) + '<small>' + esc(t(cat.description)) + '</small>';
        if (searchQuery) {
            const grouped = {};
            const order = [];
            for (const g in SETTINGS_DATA) {
                for (const group of SETTINGS_DATA[g].groups) {
                    for (const s of group.items) {
                        if (matchesQueryDeep(s)) {
                            if (!grouped[s._group]) { grouped[s._group] = []; order.push(s._group); }
                            grouped[s._group].push(s);
                        }
                    }
                }
            }
            if (!order.length) {
                domCache.body.innerHTML = '<div class="sp-empty"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg><div>"' + esc(searchQuery) + '" için sonuç bulunamadı.</div></div>';
                return;
            }
            let html = '';
            for (const gid of order) {
                const grp = groupIndex[gid];
                if (!grp) continue;
                html += groupHTML({ ...grp, items: grouped[gid] });
            }
            domCache.body.innerHTML = html;
            updateMenuPositionControls();
            refreshChangedIndicators();
            return;
        }
        let html = '';
        for (const group of cat.groups) html += groupHTML(group);
        domCache.body.innerHTML = html;
        updateMenuPositionControls();
        refreshChangedIndicators();
        const checks = [];
        for (const group of cat.groups) for (const s of group.items) if (s.statusCheck) checks.push(s.statusCheck);
        for (const name of checks) if (statusChecks[name]) queueMicrotask(statusChecks[name]);
    }

    function refreshNavLabels() {
        if (!domCache.panel) return;
        const items = domCache.panel.querySelectorAll('.settings-nav-item[data-tab]');
        for (const it of items) {
            const cat = SETTINGS_DATA[it.dataset.tab];
            const lbl = it.querySelector('.nav-label');
            if (cat && lbl) lbl.textContent = t(cat.title);
            if (it.dataset.tab === 'okul' && lbl) lbl.textContent = t('Okul Modu');
            if (it.dataset.tab === 'hakkinda' && lbl) lbl.textContent = t('Hakkında');
        }
    }

    function handleSettingChange(e) {
        const tgt = e.target;
        const id = tgt.dataset && tgt.dataset.id;
        if (!id) return;
        const s = findSetting(id);
        if (!s) return;
        if (s.type === 'toggle') {
            if (!saveSetting(id, tgt.checked)) tgt.checked = !tgt.checked;
            else panelToast(t(s.label) + (tgt.checked ? ' açıldı' : ' kapatıldı'), 'success');
        } else if (s.type === 'select') {
            if (!saveSetting(id, tgt.value)) tgt.value = String(getVal(s));
            else panelToast(t(s.label) + ' güncellendi', 'success');
        } else if (s.type === 'text') {
            const v = tgt.value.trim();
            if (id === 'custom-search-url' && v && !(/^https?:\/\//i.test(v) && v.includes('%s'))) {
                panelToast('Adres http(s) ile başlamalı ve %s içermeli', 'error');
                tgt.value = String(getVal(s) || '');
                return;
            }
            saveSetting(id, v);
        } else if (s.type === 'css') {
            const v = tgt.value;
            if (v.length > 32768 || /@import|url\s*\(|expression\s*\(|-moz-binding|behavior\s*:|javascript\s*:/i.test(v)) {
                panelToast('CSS en fazla 32 KB olabilir; harici kaynak veya çalıştırılabilir CSS kullanılamaz.', 'error');
                tgt.value = String(getVal(s) || '');
                return;
            }
            saveSetting(id, v);
        } else if (s.type === 'number') {
            let num = parseInt(tgt.value, 10);
            if (isNaN(num)) num = parseInt(getDefault(s), 10);
            if (s.min !== undefined && num < s.min) num = s.min;
            if (s.max !== undefined && num > s.max) num = s.max;
            tgt.value = num;
            saveSetting(id, String(num));
        } else if (s.type === 'range') {
            const num = Math.max(s.min, Math.min(s.max, parseInt(tgt.value, 10) || Number(s.default)));
            tgt.value = String(num);
            saveSetting(id, String(num));
        } else if (s.type === 'color') {
            saveSetting(id, tgt.value);
        }
    }

    function handleSettingInput(event) {
        const target = event.target;
        const id = target.dataset && target.dataset.id;
        const setting = id && findSetting(id);
        if (!setting) return;
        if (setting.type === 'range') {
            const value = Math.max(setting.min, Math.min(setting.max, parseInt(target.value, 10) || Number(setting.default)));
            target.value = String(value);
            const output = document.getElementById('value-' + id);
            if (output) output.value = value + '%';
            applySetting(id, String(value));
        } else if (setting.type === 'color') {
            applySetting(id, target.value);
        }
    }

    function setupPanelEvents() {
        const panel = domCache.panel;
        const sidebar = panel.querySelector('.settings-sidebar');
        const body = domCache.body;
        const guideButton = panel.querySelector('#settings-feature-guide');
        if (guideButton) guideButton.addEventListener('click', () => {
            if (typeof window.__ankaOpenWelcomeGuide === 'function') window.__ankaOpenWelcomeGuide();
            else panelToast('Tanıtım sayfası açılamadı.', 'error');
        });
        sidebar.addEventListener('click', (e) => {
            const item = e.target.closest('.settings-nav-item');
            if (!item) return;
            if (item.id === 'reset-settings-btn') resetSettings();
            else if (item.id === 'reset-all-data-btn') resetAllAppData();
            else if (item.dataset.tab) renderTab(item.dataset.tab);
        });
        body.addEventListener('input', handleSettingInput);
        body.addEventListener('change', handleSettingChange);
        body.addEventListener('click', (e) => {
            const resetBtn = e.target.closest('[data-reset-id]');
            if (resetBtn) {
                const id = resetBtn.dataset.resetId;
                const s = findSetting(id);
                if (s) { saveSetting(id, getDefault(s)); panelToast('Varsayılana döndürüldü', 'success'); }
                return;
            }
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) { executeSettingAction(actionBtn.dataset.action, actionBtn); return; }
            const groupHeader = e.target.closest('.sp-group-header');
            if (groupHeader) { toggleGroup(groupHeader.dataset.gid, groupHeader); return; }
        });
        const search = domCache.search;
        if (search) {
            let searchTimer = 0;
            search.addEventListener('input', (e) => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    searchQuery = e.target.value.trim();
                    if (domCache.searchHint) {
                        if (searchQuery) domCache.searchHint.classList.remove('visible');
                        else refreshChangedIndicators();
                    }
                    renderTab(currentTab);
                }, 140);
            });
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.target.value = ''; searchQuery = ''; renderTab(currentTab); }
            });
        }
        const expandBtn = document.getElementById('sp-expand-all');
        if (expandBtn) expandBtn.addEventListener('click', () => { collapseAllGroups(false); panelToast('Tüm gruplar açıldı', 'success'); });
        const collapseBtn = document.getElementById('sp-collapse-all');
        if (collapseBtn) collapseBtn.addEventListener('click', () => { collapseAllGroups(true); panelToast('Tüm gruplar kapatıldı', 'success'); });
        const closeSettings = () => {
            if (document.body.dataset.systemPage === 'settings' && typeof window.__ankaCloseSystemTab === 'function') window.__ankaCloseSystemTab();
            else toggleSettings();
        };
        domCache.overlay.addEventListener('click', closeSettings);
        document.getElementById('close-settings-btn').addEventListener('click', closeSettings);
        bindSettingsLock();
        setupUpdateListeners();
        if (window.AnkaWindowUtils) {
            window.AnkaWindowUtils.register('settings', {
                panel,
                overlay: domCache.overlay,
                group: 'modal',
                isOpen: () => panelOpen,
                close: () => { if (panelOpen) toggleSettings(); },
                dismissOnEscape: false
            });
        }
        renderTab('genel');
    }

    function createSettingsPanel() {
        if (document.getElementById('settings-panel')) {
            domCache.panel = document.getElementById('settings-panel');
            domCache.overlay = document.getElementById('settings-overlay');
            domCache.body = document.getElementById('settings-body');
            domCache.title = document.getElementById('sp-title');
            domCache.search = document.getElementById('sp-search');
            domCache.searchHint = document.getElementById('sp-search-hint');
            domCache.navItems = null;
            return;
        }
        ensureStyles();
        ensureFps();
        const navHTML = (() => {
            let html = '';
            for (const key in SETTINGS_DATA) {
                const cat = SETTINGS_DATA[key];
                const count = getNavCount(key);
                html += `<div class="settings-nav-item${key === 'genel' ? ' active' : ''}" data-tab="${key}"><span class="nav-icon"><svg viewBox="0 0 24 24">${cat.icon || ''}</svg></span><span class="nav-label">${esc(t(cat.title))}</span><span class="nav-count" style="display:${count > 0 ? '' : 'none'}">${count}</span></div>`;
            }
            html += `<div class="settings-nav-item" data-tab="okul"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></span><span class="nav-label">${esc(t('Okul Modu'))}</span></div>`;
            html += '<div class="settings-nav-spacer"></div><div class="settings-nav-divider"></div>';
            html += `<div class="settings-nav-item danger" id="reset-settings-btn"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></span><span class="nav-label">${esc(t('Ayarları Sıfırla'))}</span></div>`;
            html += `<div class="settings-nav-item danger-strong" id="reset-all-data-btn"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></span><span class="nav-label">${esc(t('Her Şeyi Sıfırla'))}</span></div>`;
            html += '<div class="settings-nav-divider"></div>';
            html += `<div class="settings-nav-item" data-tab="hakkinda"><span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span><span class="nav-label">${esc(t('Hakkında'))}</span></div>`;
            return html;
        })();
        document.body.insertAdjacentHTML('beforeend', `
<div id="settings-panel" role="dialog" aria-modal="true" aria-label="Ayarlar">
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="settings-brand"><div class="settings-brand-icon">⚙</div><div>${esc(t('Ayarlar'))}</div></div>
      <button type="button" class="settings-guide-button" id="settings-feature-guide">${esc(t('Tüm özellikleri tanıt'))}</button>
      ${navHTML}
    </div>
    <div class="settings-content">
      <div class="settings-header">
        <div class="settings-header-top">
          <h1 class="settings-title" id="sp-title">${esc(t('Genel'))}<small>${esc(t('Temel tarayıcı davranışları'))}</small></h1>
          <div class="settings-search-wrap"><span class="search-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg></span><input id="sp-search" class="settings-search" type="text" placeholder="${esc(t('Ayar ara...'))}" autocomplete="off" spellcheck="false"></div>
          <div class="settings-header-actions">
            <button type="button" class="sp-hdr-btn" id="sp-expand-all" title="${esc(t('Tüm grupları aç'))}"><svg viewBox="0 0 24 24"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg><span>${esc(t('Aç'))}</span></button>
            <button type="button" class="sp-hdr-btn" id="sp-collapse-all" title="${esc(t('Tüm grupları kapat'))}"><svg viewBox="0 0 24 24"><path d="M7 9l5-5 5 5M7 15l5 5 5-5"/></svg><span>${esc(t('Kapat'))}</span></button>
            <button type="button" class="sp-hdr-btn" id="close-settings-btn" title="${esc(t('Kapat'))}" aria-label="${esc(t('Kapat'))}"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>
        </div>
        <div class="sp-search-hint" id="sp-search-hint"></div>
      </div>
      <div class="settings-body" id="settings-body"></div>
    </div>
  </div>
</div>
<div id="settings-overlay"></div>
<div id="settings-lock-overlay">
  <form id="settings-lock-dialog">
    <h3>${esc(t('Ayarlar kilitli'))}</h3>
    <p>${esc(t('Devam etmek için Okul Modu ayar parolasını girin.'))}</p>
    <input class="sp-text school-input" id="settings-lock-password" type="password" autocomplete="current-password" required style="width:100%;margin-bottom:8px">
    <div id="settings-lock-error" role="alert"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
      <button class="sp-btn secondary" id="settings-lock-cancel" type="button">${esc(t('Vazgeç'))}</button>
      <button class="sp-btn" type="submit">${esc(t('Aç'))}</button>
    </div>
  </form>
</div>`);
        domCache.panel = document.getElementById('settings-panel');
        domCache.overlay = document.getElementById('settings-overlay');
        domCache.body = document.getElementById('settings-body');
        domCache.title = document.getElementById('sp-title');
        domCache.search = document.getElementById('sp-search');
        domCache.searchHint = document.getElementById('sp-search-hint');
        domCache.navItems = null;
        setupPanelEvents();
    }

    async function loadSchoolConfig() {
        const api = ipc();
        if (!api) throw new Error(t('Okul Modu yalnızca Anka Web uygulamasında kullanılabilir.'));
        return api.invoke('school-mode:get-config');
    }

    function schoolToggle(labelText, description, checked) {
        const row = document.createElement('div');
        row.className = 'school-row';
        const info = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'sp-item-label';
        label.textContent = labelText;
        const detail = document.createElement('div');
        detail.className = 'sp-item-desc';
        detail.textContent = description;
        info.append(label, detail);
        const toggle = document.createElement('label');
        toggle.className = 'sp-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!checked;
        const slider = document.createElement('span');
        slider.className = 'sp-slider';
        toggle.append(input, slider);
        row.append(info, toggle);
        return { row, input };
    }

    function schoolTextInput(type, placeholder, value = '') {
        const input = document.createElement('input');
        input.className = 'sp-text school-input';
        input.type = type;
        input.placeholder = placeholder;
        input.value = value;
        input.autocomplete = type === 'password' ? 'new-password' : type === 'url' ? 'url' : 'off';
        return input;
    }

    function validSchoolUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (error) {
            return false;
        }
    }

    async function renderSchoolSettings(body) {
        body.replaceChildren();
        const group = document.createElement('div');
        group.className = 'sp-group';
        const loading = document.createElement('div');
        loading.className = 'sp-empty';
        loading.textContent = t('Okul ayarları yükleniyor...');
        group.append(loading);
        body.append(group);
        let config;
        try {
            config = await loadSchoolConfig();
        } catch (error) {
            loading.textContent = error.message || t('Okul ayarları yüklenemedi.');
            return;
        }
        if (!body.isConnected || currentTab !== 'okul') return;
        group.replaceChildren();

        const overview = document.createElement('section');
        overview.className = 'school-card';
        const overviewTitle = document.createElement('h3');
        overviewTitle.textContent = t('Bu bilgisayardaki Okul Modu');
        const overviewDescription = document.createElement('p');
        overviewDescription.textContent = t('Okul Modu yeni sekmeleri okul başlangıç adresine yönlendirir ve okul profili tarafından belirlenen güvenlik ayarlarını bu bilgisayarda uygular. Bu ayarlar yalnızca yerel bilgisayarı etkiler.');
        const mode = schoolToggle(t('Okul Modu'), t('Yeni sekmeler okul başlangıç sayfasını kullanır.'), config.enabled);
        const modeNote = document.createElement('p');
        modeNote.className = 'school-help';
        modeNote.textContent = t('Etkinleştirildiğinde yönetilen ayarlar: ') +
            Object.keys(SCHOOL_POLICY).map((id) => (findSetting(id) && findSetting(id).label) || id).join(', ') + '.';
        overview.append(overviewTitle, overviewDescription, mode.row, modeNote);
        group.append(overview);

        const urlCard = document.createElement('section');
        urlCard.className = 'school-card';
        const urlTitle = document.createElement('h3');
        urlTitle.textContent = t('Okul başlangıç sayfası');
        const urlDescription = document.createElement('p');
        urlDescription.textContent = t('Yeni sekmelerde açılacak güvenilir okul sitesinin adresini girin. Örnek: https://www.eba.gov.tr/');
        const urlInput = schoolTextInput('url', 'https://www.eba.gov.tr/', config.startUrl);
        urlInput.setAttribute('aria-label', t('Okul başlangıç adresi'));
        urlCard.append(urlTitle, urlDescription, urlInput);
        group.append(urlCard);

        const lockCard = document.createElement('section');
        lockCard.className = 'school-card';
        const lock = schoolToggle(t('Ayarlar parolası'), t('Ayarlar panelini açarken parola iste.'), config.lockSettings);
        const lockDescription = document.createElement('p');
        lockDescription.className = 'school-warning';
        lockDescription.textContent = t('Bu parola unutulursa kurtarılamaz. Okul yönetici parolasından farklı bir parola kullanın.');
        const settingsPassword = schoolTextInput('password', config.hasSettingsPassword ? t('Yeni parola (değiştirmek için)') : t('Ayarlar parolası'));
        settingsPassword.autocomplete = 'new-password';
        lockCard.append(lock.row, lockDescription, settingsPassword);
        group.append(lockCard);

        const usersCard = document.createElement('section');
        usersCard.className = 'school-card';
        const usersTitle = document.createElement('h3');
        usersTitle.textContent = t('Bu bilgisayardaki kullanıcılar');
        const login = schoolToggle(t('Açılışta kullanıcı seçimi'), t('Etkinleştirildiğinde Anka Web açılırken kullanıcı seçimi gösterilir.'), config.userLoginEnabled);
        const loginHelp = document.createElement('p');
        loginHelp.className = 'school-help';
        loginHelp.textContent = t('Önce kullanıcı ekleyin. İsteğe bağlı kullanıcı parolaları bu bilgisayarda korunur; bu özellik bilgisayar hesabı veya Windows/Linux oturum parolası istemez.');
        const userList = document.createElement('div');
        userList.className = 'school-users';
        const userForm = document.createElement('div');
        userForm.className = 'school-user-form';
        const usernameInput = schoolTextInput('text', t('Kullanıcı adı'));
        usernameInput.autocomplete = 'username';
        const displayNameInput = schoolTextInput('text', t('Ekranda görünecek ad'));
        const userPasswordInput = schoolTextInput('password', t('İsteğe bağlı kullanıcı parolası'));
        const addUser = document.createElement('button');
        addUser.type = 'button';
        addUser.className = 'sp-btn';
        addUser.textContent = t('Kullanıcı ekle');
        userForm.append(usernameInput, displayNameInput, userPasswordInput, addUser);
        usersCard.append(usersTitle, login.row, loginHelp, userList, userForm);
        group.append(usersCard);

        const status = document.createElement('div');
        status.className = 'school-card';
        status.setAttribute('role', 'status');
        const renderUsers = () => {
            const rows = document.createDocumentFragment();
            for (const user of config.users || []) {
                const row = document.createElement('div');
                row.className = 'school-user';
                const name = document.createElement('strong');
                name.textContent = user.displayName + ' (@' + user.username + ')';
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'sp-btn secondary';
                remove.textContent = t('Kaldır');
                remove.addEventListener('click', async () => {
                    if (!await confirmBox(t('Bu kullanıcı bu bilgisayardan kaldırılsın mı?'), { title: t('Kullanıcıyı kaldır'), danger: true })) return;
                    try {
                        const result = await ipc().invoke('school-mode:remove-user', user.id);
                        if (!result.ok) throw new Error(result.error || t('Kullanıcı kaldırılamadı.'));
                        config.users = result.config.users;
                        config.userLoginEnabled = result.config.userLoginEnabled;
                        login.input.checked = !!config.userLoginEnabled;
                        status.textContent = t('Kullanıcı kaldırıldı.');
                        renderUsers();
                    } catch (error) {
                        status.textContent = error.message || t('Kullanıcı kaldırılamadı.');
                    }
                });
                row.append(name, remove);
                rows.append(row);
            }
            if (!config.users || !config.users.length) {
                const empty = document.createElement('p');
                empty.className = 'school-help';
                empty.textContent = t('Henüz kullanıcı eklenmedi.');
                rows.append(empty);
            }
            userList.replaceChildren(rows);
        };
        renderUsers();
        addUser.addEventListener('click', async () => {
            addUser.disabled = true;
            try {
                const result = await ipc().invoke('school-mode:save-user', {
                    username: usernameInput.value,
                    displayName: displayNameInput.value,
                    password: userPasswordInput.value
                });
                if (!result.ok) throw new Error(result.error || t('Kullanıcı eklenemedi.'));
                config.users = result.users;
                usernameInput.value = '';
                displayNameInput.value = '';
                userPasswordInput.value = '';
                status.textContent = t('Kullanıcı eklendi.');
                renderUsers();
            } catch (error) {
                status.textContent = error.message || t('Kullanıcı eklenemedi.');
            } finally {
                addUser.disabled = false;
            }
        });
        group.append(status);

        const sharingCard = document.createElement('section');
        sharingCard.className = 'school-card';
        const sharingTitle = document.createElement('h3');
        sharingTitle.textContent = t('Okul ağı ve bilgisayar eşleştirme');
        const sharingDescription = document.createElement('p');
        sharingDescription.textContent = t('Ayrı yönetim panelinden bilgisayarları eşleştirin, istekleri onaylayın veya reddedin, seçili cihazları kaldırın ve okul ayarlarını tekli ya da toplu gönderin.');
        const steps = document.createElement('ol');
        steps.className = 'school-steps';
        [
            t('Yönetici bilgisayarında paneli açıp güçlü yönetici parolası oluşturun.'),
            t('Panelde yerel ağ sunucusunu başlatın. Gösterilen IP adresi, bağlantı noktası ve SHA-256 parmak izini not edin.'),
            t('Yeni eşleştirme daveti üretin. Diğer bilgisayarda “Şifreli davet dosyasını içe aktar” seçeneğini kullanın veya bilgileri elle girin.'),
            t('Her bilgisayardan gelen isteği yönetim panelinde ayrıca onaylayın. Sonra hedef bilgisayarları seçerek politika gönderin.'),
            t('Hedef bilgisayarda kullanıcı politikayı görüp kabul etmelidir. Herhangi bir ekran, sekme veya geçmiş bilgisi paylaşılmaz.')
        ].forEach((text) => {
            const item = document.createElement('li');
            item.textContent = text;
            steps.append(item);
        });
        const openPanel = document.createElement('button');
        openPanel.type = 'button';
        openPanel.className = 'sp-btn';
        openPanel.textContent = t('Yönetim panelini aç');
        const panelStatus = document.createElement('p');
        panelStatus.className = 'school-help';
        openPanel.addEventListener('click', async () => {
            openPanel.disabled = true;
            try {
                const api = ipc();
                if (!api || typeof api.invoke !== 'function') throw new Error(t('Yönetim paneli bu ortamda açılamıyor.'));
                const result = await api.invoke('school-management:open-panel');
                if (!result || !result.ok) throw new Error(t('Yönetim paneli açılamadı.'));
                panelStatus.textContent = t('Panel ayrı pencerede açıldı. Bilgisayar istekleri, hedef seçimi ve toplu ayarlar panelde bulunur.');
            } catch (error) {
                panelStatus.textContent = error.message || t('Yönetim paneli açılamadı.');
            } finally {
                openPanel.disabled = false;
            }
        });
        sharingCard.append(sharingTitle, sharingDescription, steps, openPanel, panelStatus);
        group.append(sharingCard);

        const requestsCard = document.createElement('section');
        requestsCard.className = 'school-card';
        const requestsTitle = document.createElement('h3');
        requestsTitle.textContent = t('Bekleyen bilgisayar istekleri');
        const requestsHelp = document.createElement('p');
        requestsHelp.className = 'school-help';
        requestsHelp.textContent = t('İstekleri görmek için yönetici parolanızı doğrulayın. Onaylamadığınız hiçbir bilgisayar eşleşmez.');
        const requestsPassword = schoolTextInput('password', t('Yönetici parolası'));
        requestsPassword.autocomplete = 'current-password';
        const loadRequests = document.createElement('button');
        loadRequests.type = 'button';
        loadRequests.className = 'sp-btn secondary';
        loadRequests.textContent = t('İstekleri yenile');
        const requestList = document.createElement('div');
        requestList.className = 'school-users';
        const requestStatus = document.createElement('p');
        requestStatus.className = 'school-help';
        const renderRequests = (requests) => {
            const rows = document.createDocumentFragment();
            if (!requests.length) {
                const empty = document.createElement('p');
                empty.className = 'school-help';
                empty.textContent = t('Bekleyen istek yok.');
                rows.append(empty);
            }
            for (const request of requests) {
                const row = document.createElement('div');
                row.className = 'school-user';
                const name = document.createElement('strong');
                name.textContent = request.name + ' · ' + new Date(request.createdAt).toLocaleString();
                const actions = document.createElement('div');
                actions.className = 'school-user-actions';
                for (const [action, label] of [['approve', t('Onayla')], ['deny', t('Reddet')]]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = action === 'approve' ? 'sp-btn' : 'sp-btn secondary';
                    button.textContent = label;
                    button.addEventListener('click', async () => {
                        button.disabled = true;
                        try {
                            const result = await ipc().invoke('school-management:' + action, requestsPassword.value, request.id);
                            if (!result.ok) throw new Error(result.error || t('İstek işlenemedi.'));
                            requestStatus.textContent = action === 'approve' ? t('Bilgisayar eşleştirildi.') : t('Bağlantı isteği reddedildi.');
                            loadRequests.click();
                        } catch (error) {
                            requestStatus.textContent = error.message || t('İstek işlenemedi.');
                        } finally {
                            button.disabled = false;
                        }
                    });
                    actions.append(button);
                }
                row.append(name, actions);
                rows.append(row);
            }
            requestList.replaceChildren(rows);
        };
        loadRequests.addEventListener('click', async () => {
            loadRequests.disabled = true;
            try {
                const result = await ipc().invoke('school-management:state', requestsPassword.value);
                if (!result.ok) throw new Error(result.error || t('Yönetici doğrulanamadı.'));
                renderRequests(result.state.pending || []);
                requestStatus.textContent = t('İstek listesi güncellendi.');
            } catch (error) {
                requestStatus.textContent = error.message === 'invalid-password' ? t('Yönetici parolası doğru değil.') : error.message || t('İstekler alınamadı.');
                renderRequests([]);
            } finally {
                loadRequests.disabled = false;
            }
        });
        requestsCard.append(requestsTitle, requestsHelp, requestsPassword, loadRequests, requestList, requestStatus);
        group.append(requestsCard);

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'sp-btn';
        save.textContent = t('Okul ayarlarını kaydet');
        save.addEventListener('click', async () => {
            if (!validSchoolUrl(urlInput.value.trim())) {
                status.textContent = t('Geçerli bir http veya https adresi girin.');
                urlInput.focus();
                return;
            }
            if (lock.input.checked && !config.hasSettingsPassword && !settingsPassword.value) {
                status.textContent = t('Ayar kilidi için bir parola belirleyin.');
                settingsPassword.focus();
                return;
            }
            if (lock.input.checked && !config.lockSettings &&
                !await confirmBox(t('Bu parola unutulursa kurtarılamaz. Devam edilsin mi?'), { title: t('Ayar kilidini etkinleştir') })) return;
            save.disabled = true;
            try {
                const result = await ipc().invoke('school-mode:save-config', {
                    enabled: mode.input.checked,
                    startUrl: urlInput.value.trim(),
                    lockSettings: lock.input.checked,
                    settingsPassword: settingsPassword.value,
                    userLoginEnabled: login.input.checked
                });
                settingsPassword.value = '';
                if (!result.ok) throw new Error(result.error || t('Okul ayarları kaydedilemedi.'));
                config = result.config;
                syncSchool(!!config.enabled);
                saveSetting('school-url', config.startUrl, true);
                if (typeof window.applySchoolChrome === 'function') window.applySchoolChrome();
                status.textContent = t('Okul ayarları bu bilgisayara kaydedildi.');
            } catch (error) {
                status.textContent = error.message || t('Okul ayarları kaydedilemedi.');
            } finally {
                save.disabled = false;
            }
        });
        const saveCard = document.createElement('section');
        saveCard.className = 'school-card';
        saveCard.append(save);
        group.append(saveCard);
    }

    function getDetailedSystemInfo() {
        const info = {
            osName: 'Bilinmiyor',
            osVersion: '',
            osBuild: '',
            platform: 'unknown',
            arch: 'unknown',
            cpuModel: 'Bilinmiyor',
            cpuCores: 0,
            totalMemGB: 0,
            freeMemGB: 0,
            hostname: '',
            homedir: '',
            electronVersion: '',
            chromeVersion: '',
            nodeVersion: '',
            v8Version: '',
            appVersion: '',
            isElectron: false,
            locale: navigator.language || 'tr-TR',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
        };
        try {
            const os = require('os');
            const platform = os.platform();
            const release = String(os.release() || '');
            info.platform = platform;
            info.arch = os.arch();
            info.hostname = os.hostname();
            try { info.homedir = os.homedir(); } catch (e) {}
            const cpus = os.cpus() || [];
            info.cpuCores = cpus.length;
            if (cpus[0] && cpus[0].model) info.cpuModel = cpus[0].model.trim();
            const total = os.totalmem() || 0;
            const free = os.freemem() || 0;
            info.totalMemGB = Math.round((total / 1073741824) * 10) / 10;
            info.freeMemGB = Math.round((free / 1073741824) * 10) / 10;
            if (platform === 'win32') {
                const parts = release.split('.');
                const build = parseInt(parts[2], 10) || 0;
                info.osBuild = release;
                if (build >= 22000) info.osName = 'Windows 11';
                else if (build >= 10240) info.osName = 'Windows 10';
                else if (build >= 9600) info.osName = 'Windows 8.1';
                else if (build >= 9200) info.osName = 'Windows 8';
                else if (build >= 7601) info.osName = 'Windows 7';
                else if (build >= 2600) info.osName = 'Windows Vista';
                else if (build >= 2600 - 3000) info.osName = 'Windows XP';
                else info.osName = 'Windows';
                info.osVersion = build >= 22000 ? '23H2 / 24H2' : build >= 19041 ? '2004+ ' : '';
            } else if (platform === 'darwin') {
                const major = parseInt(release.split('.')[0], 10);
                const macNames = { 25: 'Sequoia', 24: 'Sonoma', 23: 'Ventura', 22: 'Monterey', 21: 'Big Sur', 20: 'Catalina', 19: 'Mojave', 18: 'High Sierra', 17: 'Sierra' };
                info.osName = 'macOS ' + (macNames[major] || '');
                info.osVersion = 'Darwin ' + release;
            } else if (platform === 'linux') {
                try {
                    const fs = require('fs');
                    const data = fs.readFileSync('/etc/os-release', 'utf8');
                    const pretty = data.match(/PRETTY_NAME="?([^"\n]+)"?/);
                    if (pretty && pretty[1]) info.osName = pretty[1];
                    else info.osName = 'Linux';
                    const ver = data.match(/VERSION_ID="?([^"\n]+)"?/);
                    if (ver && ver[1]) info.osVersion = ver[1];
                } catch (e) { info.osName = 'Linux'; }
                info.osBuild = release;
            } else if (platform === 'freebsd' || platform === 'openbsd' || platform === 'sunos' || platform === 'aix') {
                info.osName = platform.charAt(0).toUpperCase() + platform.slice(1);
                info.osVersion = release;
            } else {
                info.osName = platform;
                info.osVersion = release;
            }
        } catch (e) {}
        try {
            if (window.process && window.process.versions) {
                info.isElectron = !!window.process.versions.electron;
                info.electronVersion = window.process.versions.electron || '';
                info.chromeVersion = window.process.versions.chrome || '';
                info.nodeVersion = window.process.versions.node || '';
                info.v8Version = window.process.versions.v8 || '';
            }
        } catch (e) {}
        if (!info.chromeVersion) {
            const m = navigator.userAgent.match(/Chrome\/([\d.]+)/);
            if (m) info.chromeVersion = m[1];
        }
        return info;
    }

    async function collectAboutInfo() {
        const info = getDetailedSystemInfo();
        try {
            const i = ipc();
            if (i) {
                try {
                    const v = await i.invoke('anka:get-version');
                    if (v) info.appVersion = String(v).trim().replace(/^v/i, '');
                } catch (e) {}
            }
        } catch (e) {}
        if (!info.appVersion) {
            try {
                const fs = require('fs');
                const path = require('path');
                const candidates = [];
                if (process.resourcesPath) {
                    candidates.push(path.join(process.resourcesPath, 'app.asar', 'package.json'));
                    candidates.push(path.join(process.resourcesPath, 'app', 'package.json'));
                }
                candidates.push(path.join(process.cwd(), 'package.json'));
                if (typeof __dirname === 'string') {
                    let dir = __dirname;
                    for (let k = 0; k < 6; k++) {
                        candidates.push(path.join(dir, 'package.json'));
                        const parent = path.dirname(dir);
                        if (parent === dir) break;
                        dir = parent;
                    }
                }
                for (const file of candidates) {
                    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (data && data.version) { info.appVersion = String(data.version).trim().replace(/^v/i, ''); break; } }
                    catch (e) {}
                }
            } catch (e) {}
        }
        return info;
    }

    async function refreshAboutUpdateStatus() {
        const status = document.getElementById('about-update-status');
        if (!status) return;
        const i = ipc();
        if (!i) { status.textContent = t('Yalnızca uygulamada'); status.className = 'sp-status info'; return; }
        try {
            const info = await i.invoke('anka:check-for-updates');
            if (info && info.hasUpdate && info.version) {
                status.textContent = t('Yeni sürüm') + ' v' + String(info.version).trim().replace(/^v/i, '');
                status.className = 'sp-status ok';
            } else { status.textContent = t('Güncel'); status.className = 'sp-status ok'; }
        } catch (e) { status.textContent = t('Kontrol edilemedi'); status.className = 'sp-status no'; }
    }

    function runAboutUpdateCheck(btn) {
        const status = document.getElementById('about-update-status');
        const i = ipc();
        if (!i) { if (status) { status.textContent = t('Desteklenmiyor'); status.className = 'sp-status no'; } return; }
        if (btn) btn.disabled = true;
        if (status) { status.textContent = t('Denetleniyor…'); status.className = 'sp-status info'; }
        try { i.send('check-manual-update'); } catch (e) {}
        setTimeout(async () => {
            if (btn && btn.isConnected) btn.disabled = false;
            await refreshAboutUpdateStatus();
        }, 2500);
    }

    async function setDefaultBrowserFromAbout(btn) {
        if (btn) btn.disabled = true;
        try {
            const result = await requestDefaultBrowser();
            if (result && result.isDefault) panelToast(t('Anka Web varsayılan tarayıcı olarak ayarlandı.'), 'success');
            else if (result && result.openedSettings) panelToast(t('Açılan sistem ayarlarından Anka Web’i varsayılan tarayıcı olarak seçin.'), 'info');
            else panelToast(t('Varsayılan tarayıcı ayarlanamadı.'), 'error');
            if (btn && btn.isConnected) btn.disabled = false;
            await checkDefaultBrowser();
        } catch (err) {
            console.error('Varsayılan tarayıcı ayarı başarısız:', err);
            if (btn && btn.isConnected) btn.disabled = false;
            panelToast(t('Varsayılan tarayıcı ayarlanamadı.'), 'error');
        }
    }

    async function requestDefaultBrowser() {
        const api = ipc();
        if (api && typeof api.invoke === 'function') return api.invoke('anka-set-default-browser');
        if (window.electronAPI && typeof window.electronAPI.setAsDefaultBrowser === 'function') {
            return window.electronAPI.setAsDefaultBrowser();
        }
        throw new Error('Varsayılan tarayıcı ayarı desteklenmiyor.');
    }

    async function renderAboutSettings(body) {
        body.replaceChildren();
        const hero = document.createElement('div');
        hero.className = 'about-hero';
        const logo = document.createElement('img');
        logo.src = '../icons/dark-logo.png';
        logo.alt = '';
        logo.className = 'about-logo';
        logo.onerror = () => { logo.style.display = 'none'; };
        const heroInfo = document.createElement('div');
        heroInfo.className = 'about-hero-info';
        const h2 = document.createElement('h2');
        h2.textContent = 'Anka Web';
        const tagline = document.createElement('p');
        tagline.className = 'about-tagline';
        tagline.textContent = t('Hızlı, güvenli ve dokunmatik dostu modern tarayıcı deneyimi.');
        const versionBadge = document.createElement('span');
        versionBadge.className = 'about-version-badge';
        versionBadge.id = 'about-version-badge';
        versionBadge.textContent = t('Sürüm yükleniyor…');
        heroInfo.append(h2, tagline, versionBadge);
        hero.append(logo, heroInfo);
        body.appendChild(hero);
        const versionsGroup = document.createElement('div');
        versionsGroup.className = 'about-group';
        const versionRows = [
            { label: t('Anka Web Sürümü'), key: 'appVersion', id: 'about-app-version' },
            { label: t('Electron'), key: 'electronVersion', id: 'about-electron-version' },
            { label: t('Chromium'), key: 'chromeVersion', id: 'about-chromium-version' },
            { label: t('Node.js'), key: 'nodeVersion', id: 'about-node-version' },
            { label: t('V8 Motoru'), key: 'v8Version', id: 'about-v8-version' },
            { label: t('İşletim Sistemi'), key: 'osName', id: 'about-os-version' },
            { label: t('Sistem Sürümü'), key: 'osVersion', id: 'about-os-version-detail' },
            { label: t('Yapı Numarası'), key: 'osBuild', id: 'about-os-build' },
            { label: t('Mimari'), key: 'arch', id: 'about-arch-version' },
            { label: t('İşlemci'), key: 'cpuModel', id: 'about-cpu-model' },
            { label: t('Çekirdek Sayısı'), key: 'cpuCores', id: 'about-cpu-cores' },
            { label: t('Toplam Bellek'), key: 'totalMemGB', id: 'about-total-mem' }
        ];
        const valueEls = {};
        for (const row of versionRows) {
            const rowEl = document.createElement('div');
            rowEl.className = 'about-info-row';
            const labelEl = document.createElement('div');
            labelEl.className = 'about-info-label';
            labelEl.textContent = row.label;
            const valueEl = document.createElement('div');
            valueEl.className = 'about-info-value';
            valueEl.id = row.id;
            valueEl.textContent = '—';
            valueEls[row.key] = valueEl;
            rowEl.append(labelEl, valueEl);
            versionsGroup.appendChild(rowEl);
        }
        body.appendChild(versionsGroup);
        const updateGroup = document.createElement('div');
        updateGroup.className = 'about-group';
        const updateRow = document.createElement('div');
        updateRow.className = 'about-info-row';
        const updateLabel = document.createElement('div');
        updateLabel.className = 'about-info-label';
        updateLabel.textContent = t('Güncelleme Durumu');
        const updateStatus = document.createElement('span');
        updateStatus.className = 'sp-status info';
        updateStatus.id = 'about-update-status';
        updateStatus.textContent = t('Kontrol ediliyor…');
        updateRow.append(updateLabel, updateStatus);
        updateGroup.appendChild(updateRow);
        const actionsRow = document.createElement('div');
        actionsRow.className = 'about-actions';
        const checkBtn = document.createElement('button');
        checkBtn.className = 'sp-btn';
        checkBtn.type = 'button';
        checkBtn.textContent = t('Güncellemeleri Kontrol Et');
        checkBtn.addEventListener('click', () => runAboutUpdateCheck(checkBtn));
        const defaultBtn = document.createElement('button');
        defaultBtn.className = 'sp-btn secondary';
        defaultBtn.type = 'button';
        defaultBtn.textContent = t('Varsayılan Tarayıcı Yap');
        defaultBtn.addEventListener('click', () => setDefaultBrowserFromAbout(defaultBtn));
        const copyBtn = document.createElement('button');
        copyBtn.className = 'sp-btn secondary';
        copyBtn.type = 'button';
        copyBtn.textContent = t('Sistem Bilgilerini Kopyala');
        copyBtn.addEventListener('click', async () => {
            try {
                const info = await collectAboutInfo();
                const text = [
                    'Anka Web v' + info.appVersion,
                    'OS: ' + info.osName + (info.osVersion ? ' ' + info.osVersion : '') + (info.osBuild ? ' (Build ' + info.osBuild + ')' : ''),
                    'Arch: ' + info.arch,
                    'CPU: ' + info.cpuModel + ' (' + info.cpuCores + ' cores)',
                    'RAM: ' + info.totalMemGB + ' GB',
                    'Electron: ' + info.electronVersion,
                    'Chrome: ' + info.chromeVersion,
                    'Node: ' + info.nodeVersion,
                    'V8: ' + info.v8Version,
                    'Locale: ' + info.locale,
                    'Timezone: ' + info.timezone
                ].join('\n');
                await navigator.clipboard.writeText(text);
                panelToast(t('Sistem bilgileri kopyalandı'), 'success');
            } catch (e) { panelToast(t('Kopyalanamadı'), 'error'); }
        });
        actionsRow.append(checkBtn, defaultBtn, copyBtn);
        updateGroup.appendChild(actionsRow);
        const legalRow = document.createElement('div');
        legalRow.className = 'about-actions';
        const privacyLink = document.createElement('a');
        privacyLink.className = 'sp-btn secondary';
        privacyLink.href = 'https://wraitgame.surge.sh/#gizlilik';
        privacyLink.target = '_blank';
        privacyLink.rel = 'noopener noreferrer';
        privacyLink.textContent = t('Gizlilik Politikası');
        const termsLink = document.createElement('a');
        termsLink.className = 'sp-btn secondary';
        termsLink.href = 'https://wraitgame.surge.sh/#hizmet';
        termsLink.target = '_blank';
        termsLink.rel = 'noopener noreferrer';
        termsLink.textContent = t('Hizmet Şartları');
        legalRow.append(privacyLink, termsLink);
        updateGroup.appendChild(legalRow);
        const envNote = document.createElement('div');
        envNote.className = 'about-env-note';
        envNote.id = 'about-env-note';
        envNote.textContent = t('Ortam bilgisi yükleniyor…');
        updateGroup.appendChild(envNote);
        body.appendChild(updateGroup);
        const info = await collectAboutInfo();
        if (!body.isConnected || currentTab !== 'hakkinda') return;
        if (info.appVersion) { versionBadge.textContent = t('Sürüm') + ' v' + info.appVersion; if (valueEls.appVersion) valueEls.appVersion.textContent = 'v' + info.appVersion; }
        else { versionBadge.textContent = t('Sürüm bilinmiyor'); if (valueEls.appVersion) valueEls.appVersion.textContent = '—'; }
        if (valueEls.electronVersion) valueEls.electronVersion.textContent = info.electronVersion ? 'v' + info.electronVersion : '—';
        if (valueEls.chromeVersion) valueEls.chromeVersion.textContent = info.chromeVersion ? 'v' + info.chromeVersion : '—';
        if (valueEls.nodeVersion) valueEls.nodeVersion.textContent = info.nodeVersion ? 'v' + info.nodeVersion : '—';
        if (valueEls.v8Version) valueEls.v8Version.textContent = info.v8Version ? 'v' + info.v8Version : '—';
        if (valueEls.osName) valueEls.osName.textContent = info.osName || '—';
        if (valueEls.osVersion) valueEls.osVersion.textContent = info.osVersion || '—';
        if (valueEls.osBuild) valueEls.osBuild.textContent = info.osBuild || '—';
        if (valueEls.arch) valueEls.arch.textContent = info.arch || '—';
        if (valueEls.cpuModel) valueEls.cpuModel.textContent = info.cpuModel || '—';
        if (valueEls.cpuCores) valueEls.cpuCores.textContent = info.cpuCores ? String(info.cpuCores) : '—';
        if (valueEls.totalMemGB) valueEls.totalMemGB.textContent = info.totalMemGB ? info.totalMemGB + ' GB' : '—';
        if (envNote) envNote.textContent = info.isElectron ? t('Electron tabanlı sürüm. Donanım hızlandırma ve gelişmiş özellikler etkindir.') : t('Tarayıcı modunda çalışıyorsunuz. Bazı özellikler yalnızca uygulama sürümünde kullanılabilir.');
        await refreshAboutUpdateStatus();
    }

    function showSystemInfoDialog() {
        const info = getDetailedSystemInfo();
        let overlay = document.getElementById('anka-system-info-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'anka-system-info-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100020;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
        overlay.innerHTML = `
            <div style="width:min(560px,calc(100vw - 32px));max-height:82vh;overflow:auto;background:var(--bg-secondary,#18181b);border:1px solid var(--border-color,#27272a);border-radius:14px;padding:22px;color:var(--text-color,#f4f4f5);box-shadow:0 24px 70px rgba(0,0,0,.55)">
                <h3 style="margin:0 0 14px;font-size:16px">${esc(t('Sistem Bilgileri'))}</h3>
                <div class="anka-hw-grid">
                    <div class="anka-hw-card"><div class="k">${esc(t('İşletim Sistemi'))}</div><div class="v">${esc(info.osName)}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Sistem Sürümü'))}</div><div class="v">${esc(info.osVersion || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Yapı Numarası'))}</div><div class="v">${esc(info.osBuild || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Platform'))}</div><div class="v">${esc(info.platform)}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Mimari'))}</div><div class="v">${esc(info.arch)}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('İşlemci'))}</div><div class="v">${esc(info.cpuModel)}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Çekirdek Sayısı'))}</div><div class="v">${esc(String(info.cpuCores))}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Toplam Bellek'))}</div><div class="v">${esc(info.totalMemGB + ' GB')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Boş Bellek'))}</div><div class="v">${esc(info.freeMemGB + ' GB')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Bilgisayar Adı'))}</div><div class="v">${esc(info.hostname || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Kullanıcı Klasörü'))}</div><div class="v">${esc(info.homedir || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Dil'))}</div><div class="v">${esc(info.locale)}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Saat Dilimi'))}</div><div class="v">${esc(info.timezone || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Electron'))}</div><div class="v">${esc(info.electronVersion || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Chromium'))}</div><div class="v">${esc(info.chromeVersion || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('Node.js'))}</div><div class="v">${esc(info.nodeVersion || '—')}</div></div>
                    <div class="anka-hw-card"><div class="k">${esc(t('V8 Motoru'))}</div><div class="v">${esc(info.v8Version || '—')}</div></div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                    <button type="button" class="sp-btn secondary" data-role="copy">${esc(t('Kopyala'))}</button>
                    <button type="button" class="sp-btn" data-role="close">${esc(t('Kapat'))}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('[data-role="close"]').addEventListener('click', () => overlay.remove());
        overlay.querySelector('[data-role="copy"]').addEventListener('click', async () => {
            try {
                const text = Object.entries(info).map(([k, v]) => k + ': ' + v).join('\n');
                await navigator.clipboard.writeText(text);
                panelToast(t('Sistem bilgileri kopyalandı'), 'success');
            } catch (e) { panelToast(t('Kopyalanamadı'), 'error'); }
        });
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
        });
    }

    function bindSettingsLock() {
        const overlay = document.getElementById('settings-lock-overlay');
        const form = document.getElementById('settings-lock-dialog');
        const password = document.getElementById('settings-lock-password');
        const error = document.getElementById('settings-lock-error');
        const cancel = document.getElementById('settings-lock-cancel');
        let resolvePrompt = null;
        const finish = (result) => {
            overlay.style.display = 'none';
            password.value = '';
            const r = resolvePrompt;
            resolvePrompt = null;
            if (r) r(result);
        };
        dismissLock = () => finish(false);
        cancel.addEventListener('click', () => finish(false));
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const valid = await ipc().invoke('school-mode:verify-settings-password', password.value);
                if (!valid) { error.textContent = t('Parola doğru değil.'); password.select(); return; }
                finish(true);
            } catch (err) { error.textContent = t('Parola doğrulanamadı.'); }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (overlay.style.display === 'flex') dismissLock();
            else if (panelOpen) {
                if (document.body.dataset.systemPage === 'settings' && typeof window.__ankaCloseSystemTab === 'function') window.__ankaCloseSystemTab();
                else toggleSettings();
            }
        });
        window.__ankaRequestSettingsUnlock = () => new Promise((resolve) => {
            if (resolvePrompt) resolvePrompt(false);
            resolvePrompt = resolve;
            error.textContent = '';
            overlay.style.display = 'flex';
            password.value = '';
            password.focus();
        });
    }

    async function toggleSettings() {
        createSettingsPanel();
        const p = domCache.panel;
        const o = domCache.overlay;
        if (!p || !o) return;
        if (!panelOpen) {
            if (panelBusy) return;
            panelBusy = true;
            let allowed = true;
            try {
                const i = ipc();
                if (i) {
                    let cfg = null;
                    try { cfg = await i.invoke('school-mode:get-config'); } catch (e) {}
                    if (cfg && cfg.lockSettings && cfg.hasSettingsPassword) allowed = await window.__ankaRequestSettingsUnlock();
                }
            } finally { panelBusy = false; }
            if (!allowed) return;
            clearTimeout(hideTimer);
            panelOpen = true;
            renderTab(currentTab);
            p.style.display = 'flex';
            o.style.display = 'block';
            if (window.AnkaWindowUtils) window.AnkaWindowUtils.activate('settings');
            p.style.willChange = 'transform, opacity';
            o.classList.remove('visible');
            void p.offsetWidth;
            p.style.transform = 'translate(-50%, -50%) scale(1)';
            p.style.opacity = '1';
            requestAnimationFrame(() => o.classList.add('visible'));
        } else {
            panelOpen = false;
            if (window.AnkaWindowUtils) window.AnkaWindowUtils.deactivate('settings');
            p.style.transform = 'translate(-50%, -50%) scale(.96)';
            p.style.opacity = '0';
            o.classList.remove('visible');
            const root = document.documentElement;
            const wait = root.classList.contains('reduce-effects') || root.classList.contains('perf-lite') ? 0 : 220;
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                if (panelOpen) return;
                p.style.display = 'none';
                o.style.display = 'none';
                p.style.willChange = 'auto';
            }, wait);
        }
    }

    async function checkDefaultBrowser() {
        const badge = document.getElementById('status-default-browser');
        let result = null;
        try {
            const bridge = ipc();
            if (bridge && typeof bridge.invoke === 'function') {
                const status = await bridge.invoke('anka-is-default-browser');
                result = status && typeof status.isDefault === 'boolean'
                    ? status.isDefault
                    : await bridge.invoke('check-default-browser');
            } else {
                const api = window.electronAPI;
                if (api && api.checkDefaultBrowser) result = await api.checkDefaultBrowser();
            }
        } catch (e) { result = null; }
        if (badge) {
            if (result === null || result === undefined) { badge.textContent = t('Durum bilinmiyor'); badge.className = 'sp-status no'; }
            else { badge.textContent = result ? t('Varsayılan ✓') : t('Varsayılan Değil'); badge.className = 'sp-status ' + (result ? 'ok' : 'no'); }
        }
        return result;
    }

    async function initAppVersionDisplay() {
        const badge = document.getElementById('status-check-updates');
        if (!badge) return;
        const clean = (value) => String(value || '').trim().replace(/^v/i, '');
        let currentVersion = '';
        try { currentVersion = clean(await ipc().invoke('anka:get-version')); } catch (err) {}
        if (!currentVersion) {
            try {
                const fs = require('fs');
                const path = require('path');
                const candidates = [];
                if (process.resourcesPath) {
                    candidates.push(path.join(process.resourcesPath, 'app.asar', 'package.json'));
                    candidates.push(path.join(process.resourcesPath, 'app', 'package.json'));
                }
                candidates.push(path.join(process.cwd(), 'package.json'));
                if (typeof __dirname === 'string') {
                    let dir = __dirname;
                    for (let i = 0; i < 6; i++) {
                        candidates.push(path.join(dir, 'package.json'));
                        const parent = path.dirname(dir);
                        if (parent === dir) break;
                        dir = parent;
                    }
                }
                for (const file of candidates) {
                    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (data && data.version) { currentVersion = clean(data.version); break; } } catch (err) {}
                }
            } catch (err) {}
        }
        const el = document.getElementById('status-check-updates');
        if (!el) return;
        try {
            const updateInfo = await ipc().invoke('anka:check-for-updates');
            if (updateInfo && updateInfo.hasUpdate && updateInfo.version) {
                el.textContent = t('Yeni Güncelleme') + ' v' + clean(updateInfo.version);
                el.className = 'sp-status ok';
                return;
            }
        } catch (err) {}
        el.textContent = currentVersion ? t('Sürüm') + ' v' + currentVersion : t('Sürüm bilinmiyor');
        el.className = 'sp-status ' + (currentVersion ? 'ok' : 'info');
    }

    statusChecks.checkDefaultBrowser = checkDefaultBrowser;
    statusChecks.initAppVersionDisplay = initAppVersionDisplay;

    function setUpdateBadge(text, cls) {
        const el = document.getElementById('status-check-updates');
        if (!el) return;
        el.textContent = text;
        el.className = 'sp-status ' + cls;
    }

    function runUpdateCheck(btnEl) {
        const i = ipc();
        if (!i) { setUpdateBadge(t('Desteklenmiyor'), 'no'); return; }
        setUpdateBadge(t('Denetleniyor...'), 'info');
        if (btnEl) btnEl.disabled = true;
        i.send('check-manual-update');
        setTimeout(() => {
            if (btnEl) btnEl.disabled = false;
            initAppVersionDisplay();
        }, 2500);
    }

    function setupUpdateListeners() {
        if (window.hasSetupUpdateListeners) return;
        window.hasSetupUpdateListeners = true;
        const i = ipc();
        if (i) i.on('update-error', () => setUpdateBadge(t('Kontrol Başarısız'), 'no'));
    }

    function collectAllSettingsTexts() {
    if (collectAllSettingsTexts._cache) return collectAllSettingsTexts._cache;
    const out = [];
    const seen = new Set();
    const add = (v) => {
        if (!v || typeof v !== 'string') return;
        if (seen.has(v)) return;
        seen.add(v);
        out.push(v);
    };
    for (const catKey in SETTINGS_DATA) {
        const cat = SETTINGS_DATA[catKey];
        add(cat.title);
        add(cat.description);
        for (const g of cat.groups) {
            add(g.title);
            for (const s of g.items) {
                if (s.type === 'language-pack') continue;
                add(s.label);
                add(s.desc);
                add(s.placeholder);
                if (s.btnText) add(s.btnText);
                if (s.options) for (const o of s.options) add(o.name);
            }
        }
    }
    for (const element of document.querySelectorAll('[data-anka-i18n],[data-anka-i18n-attrs]')) {
        if (element.hasAttribute('data-anka-i18n')) add(element.getAttribute('data-anka-i18n-source') || element.textContent.trim());
        for (const attribute of (element.getAttribute('data-anka-i18n-attrs') || '').split(',')) {
            const name = attribute.trim();
            if (name) add(element.getAttribute('data-anka-i18n-source-' + name) || element.getAttribute(name));
        }
    }
    collectAllSettingsTexts._cache = out;
    return out;
}

const PACK_QUEUE_KEY = 'anka_i18n_pack_queue';
const validPackLanguage = (lang) => typeof lang === 'string' && /^[a-z]{2}$/.test(lang) && lang !== 'tr';
const restartRequiredPacks = new Set();
let packQueue = [];
try {
    const savedQueue = JSON.parse(lsGet(PACK_QUEUE_KEY) || '[]');
    if (Array.isArray(savedQueue)) packQueue = Array.from(new Set(savedQueue.filter(validPackLanguage))).slice(0, 13);
} catch (err) {
    console.error('Dil paketi indirme kuyruğu okunamadı:', err);
}
let packRunning = false;
let packCurrentLang = null;

function persistPackQueue() {
    const queue = packCurrentLang ? [packCurrentLang, ...packQueue] : packQueue;
    if (!lsSet(PACK_QUEUE_KEY, JSON.stringify(queue))) {
        console.error('Dil paketi indirme kuyruğu kaydedilemedi.');
    }
}

async function processPackQueue() {
    if (packRunning) return;
    if (!packQueue.length) return;
    if (!ANKA_I18N) return;
    packRunning = true;
    while (packQueue.length > 0) {
        const lang = packQueue.shift();
        packCurrentLang = lang;
        persistPackQueue();
        const completed = await downloadLanguagePack(lang);
        packCurrentLang = null;
        if (!completed) {
            packQueue.unshift(lang);
            persistPackQueue();
            break;
        }
        persistPackQueue();
    }
    packRunning = false;
    packCurrentLang = null;
    persistPackQueue();
}

async function downloadLanguagePack(lang) {
    if (!ANKA_I18N) return false;
    const texts = collectAllSettingsTexts();
    const statusEl = document.getElementById('pack-status-' + lang);
    const fillEl = document.getElementById('pack-fill-' + lang);
    const btnEl = document.getElementById('pack-btn-' + lang);
    const initialProgress = ANKA_I18N.getPackProgress(texts, lang);
    if (statusEl) { statusEl.textContent = initialProgress.done + '/' + initialProgress.total; statusEl.className = 'pack-status sp-status info'; }
    if (fillEl) { fillEl.style.width = initialProgress.percent + '%'; fillEl.className = 'pack-bar-fill'; }
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'İndiriliyor…'; }
    try {
        const result = await ANKA_I18N.downloadPack(texts, lang, (done, total) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            if (fillEl) fillEl.style.width = pct + '%';
            if (statusEl) statusEl.textContent = done + '/' + total;
        });
        restartRequiredPacks.add(lang);
        if (statusEl) { statusEl.textContent = 'İndirildi'; statusEl.className = 'pack-status sp-status ok'; }
        if (fillEl) { fillEl.style.width = '100%'; fillEl.className = 'pack-bar-fill done'; }
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = 'Uygulamayı Yeniden Başlat';
            btnEl.className = 'sp-btn';
            btnEl.dataset.action = 'restart-app';
            const note = document.createElement('span');
            note.className = 'pack-complete-note';
            note.textContent = 'Paket indirildi. Uygulamayı yeniden başlatmak için yukarıdaki düğmeye tıklayın.';
            btnEl.parentElement.appendChild(note);
        }
        panelToast(lang.toUpperCase() + ' paketi indirildi (' + result.fetched + ' yeni, ' + result.fromCache + ' önbellek)', 'success');
        if (ANKA_I18N.getLang() === lang) renderTab(currentTab);
        return true;
    } catch (e) {
        if (statusEl) { statusEl.textContent = 'Hata'; statusEl.className = 'pack-status sp-status no'; }
        if (fillEl) fillEl.className = 'pack-bar-fill error';
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Tekrar Dene'; }
        panelToast('Paket indirilemedi: ' + (e && e.message ? e.message : 'bilinmeyen hata'), 'error');
        return false;
    }
}

    async function collectExportData() {
        const api = ipc();
        if (!api) throw new Error('Ayar dosyası oluşturma desteklenmiyor.');
        const schoolConfig = await api.invoke('school-mode:get-config');
        if (!schoolConfig || typeof schoolConfig.enabled !== 'boolean') throw new Error('Okul Modu durumu alınamadı.');
        const data = {
            __meta: { app: 'Anka Web', exportedAt: new Date().toISOString(), version: 4 },
            schoolModeEnabled: schoolConfig.enabled
        };
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('set_')) continue;
            const id = key.slice(4);
            if (id === 'school-mode' || id === 'school-url' || !findSetting(id)) continue;
            data[key] = localStorage.getItem(key);
        }
        return data;
    }

    function coerceImported(s, raw) {
        if (s.type === 'toggle') return raw === true || raw === 'true' ? 'true' : 'false';
        if (s.type === 'select') { const v = String(raw); return s.options.some((o) => o.val === v) ? v : null; }
        if (s.type === 'number') { let n = parseInt(raw, 10); if (isNaN(n)) return null; if (s.min !== undefined && n < s.min) n = s.min; if (s.max !== undefined && n > s.max) n = s.max; return String(n); }
        if (s.type === 'text') { const v = String(raw).trim(); if (s.id === 'custom-search-url' && v && !(/^https?:\/\//i.test(v) && v.includes('%s'))) return null; return v; }
        if (s.type === 'color') return raw === '' ? '' : (/^#[0-9a-f]{6}$/i.test(raw) ? raw : null);
        return null;
    }

    async function exportSettingsToFile() {
        const api = ipc();
        if (!api) {
            panelToast('Ayar dosyası oluşturma desteklenmiyor.', 'error');
            return;
        }
        try {
            const result = await api.invoke('settings:export-config', await collectExportData());
            if (result && result.cancelled) return;
            if (!result || !result.ok) {
                const message = result && result.error === 'config-too-large'
                    ? 'Ayar dosyası çok büyük.'
                    : result && result.error === 'secure-storage-unavailable'
                        ? 'Bu cihazda güvenli sistem şifrelemesi kullanılamıyor; ayarlar korunmasız kaydedilmeyecek.'
                        : 'Ayar dosyası oluşturulamadı.';
                panelToast(message, 'error');
                return;
            }
            panelToast('Ayar dosyası güvenli biçimde kaydedildi. Bu dosya aynı cihaz ve kullanıcı hesabında açılabilir.', 'success');
        } catch (err) {
            console.error('Settings export failed:', err);
            panelToast('Ayar dosyası oluşturulamadı: ' + (err && err.message ? err.message : 'Bilinmeyen hata'), 'error');
        }
    }

    function applyImportedData(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
        let applied = 0;
        for (const key of Object.keys(data)) {
            if (key === '__meta') continue;
            if (Object.prototype.hasOwnProperty.call(data, key) && key.startsWith('set_')) {
                const id = key.slice(4);
                const s = findSetting(id);
                if (!s || isLocked(id) || s.type === 'button' || s.type === 'button-status') continue;
                const v = coerceImported(s, data[key]);
                if (v !== null) { saveSetting(id, v); applied++; }
            }
        }
        return { applied, schoolModeEnabled: typeof data.schoolModeEnabled === 'boolean' ? data.schoolModeEnabled : null };
    }

    async function importSettingsFromFile() {
        const api = ipc();
        if (!api) {
            panelToast('Ayar dosyası yükleme desteklenmiyor.', 'error');
            return;
        }
        try {
            const result = await api.invoke('settings:import-config');
            if (result && result.cancelled) return;
            if (!result || !result.ok) {
                const message = result && result.error === 'secure-storage-unavailable'
                    ? 'Bu cihazda ayar dosyasını açmak için gereken güvenli sistem şifrelemesi kullanılamıyor.'
                    : result && result.error === 'wrong-device'
                        ? 'Bu ayar dosyası farklı bir cihazda veya kullanıcı hesabında oluşturulmuş.'
                        : result && result.error === 'legacy-password-config'
                            ? 'Bu eski ayar dosyası parola korumalı biçimde oluşturulmuş; parola girmeden yüklenemez.'
                            : result && result.error === 'config-too-large'
                                ? 'Ayar dosyası çok büyük.'
                                : 'Ayar dosyası okunamadı veya bozuk.';
                panelToast(message, 'error');
                return;
            }
            if (typeof result.data.schoolModeEnabled === 'boolean') {
                const schoolResult = await api.invoke('school-mode:set-enabled', result.data.schoolModeEnabled);
                if (!schoolResult || !schoolResult.ok) throw new Error(schoolResult && schoolResult.error || 'Okul Modu durumu geri yüklenemedi.');
            }
            const imported = applyImportedData(result.data);
            panelToast(imported.applied + ' ' + t('ayar yüklendi, yeniden başlatılıyor…'), 'success');
            setTimeout(() => location.reload(), 1000);
        } catch (err) {
            console.error('Settings import failed:', err);
            panelToast('Ayar dosyası yüklenemedi: ' + (err && err.message ? err.message : 'Bilinmeyen hata'), 'error');
        }
    }

    async function clearI18nCache() {
        const ok = await confirmBox(t('Tüm önbelleğe alınmış çeviriler silinecek ve çeviriler yeniden indirilecek. Devam edilsin mi?'), { title: t('Çeviri Önbelleğini Temizle') });
        if (!ok) return;
        try {
            localStorage.removeItem('anka_i18n_cache_v1');
            const i = ipc();
            if (i) i.send('i18n-clear-cache');
            panelToast(t('Çeviri önbelleği temizlendi'), 'success');
            if (ANKA_I18N) ANKA_I18N.hydrateCacheFromMain({});
            if (panelOpen) renderTab(currentTab);
        } catch (e) {
            panelToast(t('Temizlenemedi'), 'error');
        }
    }

    async function clearTempDataAndRestart(btnEl) {
        const ok = await confirmBox(t('Tüm Anka Web önbellek, oturum ve geçici dosyaları silinecek. Uygulama kapatılacak, veriler temizlenecek ve otomatik yeniden başlatılacak. Devam edilsin mi?'), { title: t('Geçici Dosyaları Temizle'), confirmText: t('Temizle ve Yeniden Başlat'), danger: true });
        if (!ok) return;
        const ok2 = await confirmBox(t('Son onay: Bu işlem geri alınamaz. Tüm oturum, çerez ve önbellek verileri kalıcı olarak silinecek.'), { title: t('Son Onay'), confirmText: t('Kalıcı Olarak Sil'), danger: true });
        if (!ok2) return;
        const i = ipc();
        if (!i) { panelToast(t('Bu işlem yalnızca Anka Web uygulamasında kullanılabilir'), 'error'); return; }
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = t('Temizleniyor…'); }
        try {
            try { localStorage.clear(); } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}
            try {
                if (indexedDB && indexedDB.databases) {
                    const dbs = await indexedDB.databases();
                    for (const db of dbs) if (db && db.name) indexedDB.deleteDatabase(db.name);
                }
            } catch (e) {}
            try {
                if (typeof caches !== 'undefined') {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((k) => caches.delete(k)));
                }
            } catch (e) {}
            const result = await i.invoke('anka:clear-temp-data-and-restart');
            if (result && result.ok === false) throw new Error(result.error || t('Temizleme başarısız'));
        } catch (e) {
            if (btnEl) { btnEl.disabled = false; btnEl.textContent = t('Temizle ve Yeniden Başlat'); }
            panelToast(t('Temizleme başarısız') + ': ' + (e && e.message ? e.message : t('bilinmeyen hata')), 'error');
        }
    }

    async function copySystemInfo() {
        try {
            const info = getDetailedSystemInfo();
            const text = [
                'Anka Web',
                'OS: ' + info.osName + (info.osVersion ? ' ' + info.osVersion : '') + (info.osBuild ? ' (Build ' + info.osBuild + ')' : ''),
                'Platform: ' + info.platform,
                'Arch: ' + info.arch,
                'CPU: ' + info.cpuModel + ' (' + info.cpuCores + ' cores)',
                'RAM: ' + info.totalMemGB + ' GB (Free: ' + info.freeMemGB + ' GB)',
                'Hostname: ' + info.hostname,
                'Locale: ' + info.locale,
                'Timezone: ' + info.timezone,
                'Electron: ' + info.electronVersion,
                'Chromium: ' + info.chromeVersion,
                'Node.js: ' + info.nodeVersion,
                'V8: ' + info.v8Version
            ].join('\n');
            await navigator.clipboard.writeText(text);
            panelToast(t('Sistem bilgileri panoya kopyalandı'), 'success');
        } catch (e) {
            panelToast(t('Kopyalanamadı'), 'error');
        }
    }

    function toggleDevTools() {
        const api = window.ankaBrowserApi;
        if (!api || typeof api.toggleDevTools !== 'function') { panelToast(t('DevTools bu sekmede kullanılamıyor'), 'error'); return; }
        api.toggleDevTools();
    }

    function openDetachedDevTools() {
        const api = window.ankaBrowserApi;
        if (!api || typeof api.openDevToolsDetached !== 'function') { panelToast(t('DevTools bu sekmede kullanılamıyor'), 'error'); return; }
        api.openDevToolsDetached();
    }

    function reloadCurrentPage() {
        try { location.reload(); } catch (e) {}
    }

    function hardReloadCurrentPage() {
        try {
            const i = ipc();
            if (i) i.send('hard-reload');
            else location.reload();
        } catch (e) { location.reload(); }
    }

    function clearConsoleOutput() {
        try { console.clear(); panelToast(t('Konsol temizlendi'), 'success'); }
        catch (e) { panelToast(t('Konsol temizlenemedi'), 'error'); }
    }

    async function openDeveloperPackManager() {
        const api = ipc();
        if (!api || typeof api.invoke !== 'function') {
            panelToast(t('Paket yönetimi bu ortamda kullanılamıyor.'), 'error');
            return;
        }
        const old = document.getElementById('anka-dev-pack-manager');
        if (old) {
            if (typeof old.__ankaClose === 'function') old.__ankaClose();
            else old.remove();
            return;
        }
        const managerTexts = [
            'Yerel geliştirici paketleri',
            'Paket yönetimi bu ortamda kullanılamıyor.',
            'Paketler yalnızca bu kullanıcı hesabında çalışır. Yüklediğiniz eklenti ziyaret ettiğiniz sayfalardaki verileri okuyabilir veya değiştirebilir. Kaynağına güvenmediğiniz dosyaları yüklemeyin; yönetici izni gerekmez.',
            'İlk paketi nasıl oluştururum?',
            'Yeni bir klasör oluşturun. Aşağıdaki JSON içeriğini manifest.json adıyla kaydedin, aynı klasöre content.js ekleyin ve yalnızca ihtiyaç duyduğunuz site adresini matches/host_permissions alanına yazın. Sonra “Paket ekle” ile bu klasörü seçin. Anka Web, Electron ile uyumlu temel manifest özelliklerini destekler; Chrome API’lerinin tümü desteklenmeyebilir.',
            'Manifest şablonunu kopyala',
            'Kopyalama izni yok. Şablonu seçip kopyalayabilirsiniz.',
            'Manifest şablonu panoya kopyalandı.',
            'Yüklü paketler denetleniyor…',
            'Henüz yerel geliştirici paketi yüklenmedi.',
            'Paket listesi okunamadı.',
            'Kaldır',
            'Paket kaldırılamadı.',
            'Paket ekle',
            'Paket yüklenemedi.',
            'Klasör seçimi bekleniyor…',
            'manifest-invalid',
            'Klasörde geçerli manifest.json bulunamadı. Sürüm 2 veya 3 ve geçerli ad/sürüm alanları gerekir.',
            'load-failed',
            'Paket yüklenemedi. manifest.json içindeki dosya yollarını ve Electron uyumluluğunu kontrol edin.',
            'save-failed',
            'Paket yüklenmedi; kalıcı paket listesi kaydedilemedi.',
            'unsupported-platform',
            'Bu platformda yerel paket yükleme desteklenmiyor.',
            'Paket ekleme iptal edildi.',
            'Kapat',
            'Bazı değişiklikler için sekmeyi yenileyin.',
            'Paket yok.',
            'Yerel paket yüklü.',
            'Yüklenemeyen veya artık bulunmayan paketler: {names}. Kaldırıp yeniden ekleyin.',
            'Listeden çıkar',
            'yüklenemedi veya bulunamadı'
        ];
        try { await prefetchTexts(managerTexts); }
        catch (err) { console.warn('Geliştirici paketi arayüzü çevrilemedi:', err); }
        const localized = (text) => t(text);
        const overlay = document.createElement('div');
        overlay.id = 'anka-dev-pack-manager';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', localized('Yerel geliştirici paketleri'));
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.68)';
        const panel = document.createElement('section');
        panel.style.cssText = 'width:min(760px,100%);max-height:92vh;overflow:auto;padding:20px;border:1px solid var(--border-color,#30323a);border-radius:16px;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);box-shadow:0 24px 70px #0009;font:inherit';
        const title = document.createElement('h2');
        title.textContent = localized('Yerel geliştirici paketleri');
        title.style.cssText = 'margin:0 0 6px;font-size:20px';
        const description = document.createElement('p');
        description.textContent = localized('Paketler yalnızca bu kullanıcı hesabında çalışır. Yüklediğiniz eklenti ziyaret ettiğiniz sayfalardaki verileri okuyabilir veya değiştirebilir. Kaynağına güvenmediğiniz dosyaları yüklemeyin; yönetici izni gerekmez.');
        description.style.cssText = 'font-size:13px;line-height:1.55;opacity:.76';
        const list = document.createElement('div');
        list.style.cssText = 'display:grid;gap:8px;margin:14px 0';
        const status = document.createElement('p');
        status.setAttribute('aria-live', 'polite');
        status.style.cssText = 'min-height:20px;margin:8px 0;color:var(--text-secondary,#aaa);font-size:12px';
        const manifest = `{
  "manifest_version": 3,
  "name": "Anka Web araç paketim",
  "version": "1.0.0",
  "description": "Kişisel yerel tarayıcı aracı",
  "permissions": [],
  "host_permissions": ["https://example.com/*"],
  "content_scripts": [
    {
      "matches": ["https://example.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}`;
        const guide = document.createElement('details');
        guide.style.cssText = 'margin:12px 0;padding:12px;border:1px solid var(--border-color,#30323a);border-radius:10px';
        const summary = document.createElement('summary');
        summary.textContent = localized('İlk paketi nasıl oluştururum?');
        summary.style.cssText = 'min-height:36px;display:flex;align-items:center;cursor:pointer;touch-action:manipulation';
        const guideText = document.createElement('p');
        guideText.textContent = localized('Yeni bir klasör oluşturun. Aşağıdaki JSON içeriğini manifest.json adıyla kaydedin, aynı klasöre content.js ekleyin ve yalnızca ihtiyaç duyduğunuz site adresini matches/host_permissions alanına yazın. Sonra “Paket ekle” ile bu klasörü seçin. Anka Web, Electron ile uyumlu temel manifest özelliklerini destekler; Chrome API’lerinin tümü desteklenmeyebilir.');
        guideText.style.cssText = 'font-size:12px;line-height:1.55;opacity:.76';
        const code = document.createElement('pre');
        code.textContent = manifest;
        code.style.cssText = 'overflow:auto;max-height:250px;padding:12px;border-radius:8px;background:var(--input-bg,#111318);font:12px/1.5 ui-monospace,monospace';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = localized('Manifest şablonunu kopyala');
        copy.style.cssText = 'min-height:40px;padding:0 12px;border:1px solid var(--border-color,#30323a);border-radius:8px;background:transparent;color:inherit;touch-action:manipulation';
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(manifest);
                status.textContent = localized('Manifest şablonu panoya kopyalandı.');
            } catch (err) {
                status.textContent = localized('Kopyalama izni yok. Şablonu seçip kopyalayabilirsiniz.');
            }
        });
        guide.append(summary, guideText, code, copy);
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap';
        let keyHandler;
        const closeManager = () => {
            document.removeEventListener('keydown', keyHandler);
            overlay.remove();
        };
        overlay.__ankaClose = closeManager;
        const add = document.createElement('button');
        add.type = 'button';
        add.textContent = localized('Paket ekle');
        add.style.cssText = 'min-height:44px;padding:0 15px;border:0;border-radius:9px;background:var(--accent,#ff4757);color:#fff;font-weight:650;touch-action:manipulation';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = localized('Kapat');
        close.style.cssText = 'min-height:44px;padding:0 15px;border:1px solid var(--border-color,#30323a);border-radius:9px;background:transparent;color:inherit;touch-action:manipulation';
        const renderList = async () => {
            list.replaceChildren();
            status.textContent = localized('Yüklü paketler denetleniyor…');
            try {
                const result = await api.invoke('developer-packs:list');
                if (!result || !result.ok) throw new Error(localized('Paket listesi okunamadı.'));
                if (!result.entries.length && !(result.missing && result.missing.length)) {
                    const empty = document.createElement('p');
                    empty.textContent = localized('Henüz yerel geliştirici paketi yüklenmedi.');
                    empty.style.cssText = 'padding:14px;border:1px dashed var(--border-color,#30323a);border-radius:9px;text-align:center;opacity:.75';
                    list.append(empty);
                } else {
                    for (const entry of result.entries) {
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border-color,#30323a);border-radius:9px';
                        const info = document.createElement('span');
                        info.textContent = `${entry.name} · v${entry.version}`;
                        info.style.cssText = 'overflow-wrap:anywhere;font-size:13px';
                        const remove = document.createElement('button');
                        remove.type = 'button';
                        remove.textContent = localized('Kaldır');
                        remove.style.cssText = 'min-width:76px;min-height:40px;padding:0 10px;border:1px solid var(--border-color,#30323a);border-radius:8px;background:transparent;color:inherit;touch-action:manipulation';
                        remove.addEventListener('click', async () => {
                            remove.disabled = true;
                            try {
                                const result = await api.invoke('developer-packs:remove', entry.id);
                                if (!result || !result.ok) throw new Error(localized('Paket kaldırılamadı.'));
                                await renderList();
                            } catch (err) {
                                remove.disabled = false;
                                status.textContent = err.message || 'Paket kaldırılamadı.';
                            }
                        });
                        row.append(info, remove);
                        list.append(row);
                    }
                }
                for (const entry of result.missing || []) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #d99a3b;border-radius:9px';
                    const info = document.createElement('span');
                    info.textContent = `${entry.name} · ${localized('yüklenemedi veya bulunamadı')}`;
                    info.style.cssText = 'overflow-wrap:anywhere;font-size:13px';
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.textContent = localized('Listeden çıkar');
                    remove.style.cssText = 'min-width:110px;min-height:40px;padding:0 10px;border:1px solid var(--border-color,#30323a);border-radius:8px;background:transparent;color:inherit;touch-action:manipulation';
                    remove.addEventListener('click', async () => {
                        remove.disabled = true;
                        try {
                            const removed = await api.invoke('developer-packs:remove', entry.id);
                            if (!removed || !removed.ok) throw new Error(localized('Paket kaldırılamadı.'));
                            await renderList();
                        } catch (err) {
                            remove.disabled = false;
                            status.textContent = err.message || localized('Paket kaldırılamadı.');
                        }
                    });
                    row.append(info, remove);
                    list.append(row);
                }
                if (result.missing && result.missing.length) {
                    const names = result.missing.map((entry) => entry.name).join(', ');
                    status.textContent = localized('Yüklenemeyen veya artık bulunmayan paketler: {names}. Kaldırıp yeniden ekleyin.')
                        .replace('{names}', names);
                } else {
                    status.textContent = result.entries.length
                        ? `${result.entries.length} ${localized('Yerel paket yüklü.')}`
                        : localized('Paket yok.');
                }
            } catch (err) {
                status.textContent = err.message || localized('Paket listesi okunamadı.');
            }
        };
        add.addEventListener('click', async () => {
            add.disabled = true;
            status.textContent = localized('Klasör seçimi bekleniyor…');
            try {
                const result = await api.invoke('developer-packs:install');
                if (result && result.ok) {
                    status.textContent = `${result.extension.name} yüklendi. ${localized('Bazı değişiklikler için sekmeyi yenileyin.')}`;
                    await renderList();
                } else if (result && result.error !== 'cancelled') {
                    const errors = {
                        'manifest-invalid': localized('Klasörde geçerli manifest.json bulunamadı. Sürüm 2 veya 3 ve geçerli ad/sürüm alanları gerekir.'),
                        'load-failed': localized('Paket yüklenemedi. manifest.json içindeki dosya yollarını ve Electron uyumluluğunu kontrol edin.'),
                        'save-failed': localized('Paket yüklenmedi; kalıcı paket listesi kaydedilemedi.'),
                        'unsupported-platform': localized('Bu platformda yerel paket yükleme desteklenmiyor.')
                    };
                    status.textContent = errors[result.error] || localized('Paket yüklenemedi.');
                } else {
                    status.textContent = localized('Paket ekleme iptal edildi.');
                }
            } catch (err) {
                status.textContent = err.message || 'Paket yüklenemedi.';
            } finally {
                add.disabled = false;
            }
        });
        close.addEventListener('click', closeManager);
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) closeManager();
        });
        keyHandler = (event) => {
            if (event.key === 'Escape' && overlay.isConnected) {
                closeManager();
            }
        };
        document.addEventListener('keydown', keyHandler);
        overlay.append(panel);
        actions.append(add, close);
        panel.append(title, description, list, status, guide, actions);
        document.body.append(overlay);
        await renderList();
        add.focus();
    }

    async function executeSettingAction(action, btnEl) {
        if (action === 'restart-app') {
            const api = ipc();
            if (!api || typeof api.invoke !== 'function') {
                panelToast('Uygulama yeniden başlatılamadı.', 'error');
                return;
            }
            try {
                const result = await api.invoke('anka:restart');
                if (!result || !result.ok) panelToast('Uygulama yeniden başlatılamadı.', 'error');
            } catch (err) {
                console.error('Application restart failed:', err);
                panelToast('Uygulama yeniden başlatılamadı.', 'error');
            }
            return;
        }
        if (action === 'download-pack') {
    const lang = btnEl && btnEl.dataset ? btnEl.dataset.lang : '';
    if (!lang || !ANKA_I18N) return;
    if (packQueue.indexOf(lang) !== -1 || packCurrentLang === lang) {
        panelToast('Bu dil zaten kuyrukta veya indiriliyor', 'info');
        return;
    }
    packQueue.push(lang);
    if (!packRunning) panelToast('Dil paketi indirme kuyruğa eklendi', 'info');
    processPackQueue();
    return;
}
        if (action === 'saveDrawingNow') {
            if (typeof window.saveDrawingNow === 'function' && window.saveDrawingNow()) { panelToast(t('Çizim kaydedildi'), 'success'); return; }
            panelToast(t('Çizim kaydedilemedi'), 'error');
        } else if (action === 'clearDrawingNow') {
            if (typeof window.clearCanvas === 'function') { window.clearCanvas(); panelToast(t('Çizim temizlendi'), 'success'); }
            else panelToast(t('Çizim yüzeyi bulunamadı'), 'error');
        } else if (action === 'setDefaultBrowser') {
            if (btnEl) btnEl.disabled = true;
            try {
                const result = await requestDefaultBrowser();
                if (result && result.isDefault) panelToast(t('Varsayılan tarayıcı ayarlandı'), 'success');
                else if (result && result.openedSettings) panelToast(t('Açılan sistem ayarlarından Anka Web’i varsayılan tarayıcı olarak seçin.'), 'info');
                else panelToast(t('Varsayılan tarayıcı ayarlanamadı'), 'error');
                await checkDefaultBrowser();
            } catch (err) {
                console.error('Varsayılan tarayıcı ayarı başarısız:', err);
                panelToast(t('Varsayılan tarayıcı ayarlanamadı'), 'error');
            } finally {
                if (btnEl) btnEl.disabled = false;
            }
        } else if (action === 'checkAppUpdates') {
            runUpdateCheck(btnEl);
        } else if (action === 'exportSettingsToFile') {
            exportSettingsToFile();
        } else if (action === 'importSettingsFromFile') {
            importSettingsFromFile();
        } else if (action === 'resetDisplaySettings') {
            saveSetting('font-scale', '100');
            saveSetting('ui-scale', '100');
            panelToast('Yazı ve arayüz ölçekleri varsayılana döndürüldü.', 'success');
        } else if (action === 'clearI18nCache') {
            clearI18nCache();
        } else if (action === 'clearTempDataAndRestart') {
            clearTempDataAndRestart(btnEl);
        } else if (action === 'clearBrowsingData') {
            if (typeof window.clearBrowsingData === 'function') window.clearBrowsingData();
            else panelToast(t('Gezinti verileri penceresi açılamadı.'), 'error');
        } else if (action === 'openDeveloperPacks') {
            openDeveloperPackManager();
        } else if (action === 'toggleDevTools') {
            toggleDevTools();
        } else if (action === 'openPasswordManager') {
            if (typeof window.openPasswordManager === 'function') window.openPasswordManager();
        } else if (action === 'openDetachedDevTools') {
            openDetachedDevTools();
        } else if (action === 'reloadCurrentPage') {
            reloadCurrentPage();
        } else if (action === 'hardReloadCurrentPage') {
            hardReloadCurrentPage();
        } else if (action === 'clearConsoleOutput') {
            clearConsoleOutput();
        } else if (action === 'copySystemInfo') {
            copySystemInfo();
        } else if (action === 'showSystemInfo') {
            showSystemInfoDialog();
        }
    }

    function resetSettings() {
        for (const id of Object.keys(settingIndex)) lsRemove('set_' + id);
        lsRemove('set_dark-mode');
        lsRemove('set_theme-preset-selected');
        lsRemove('set_custom-accent');
        lsRemove('set_font-family');
        lsRemove('set_panel-density');
        lsRemove('set_auto-theme');
        lsRemove('set_auto-theme-dark-start');
        lsRemove('set_auto-theme-light-start');
        lsRemove('anka_settings_collapsed');
        const i = ipc();
        if (i) i.send('reset-app-settings');
        panelToast(t('Ayarlar sıfırlandı'), 'success');
        setTimeout(() => location.reload(), 500);
    }

    async function resetAllAppData() {
        const confirmed = await confirmBox(t('Bu işlem tüm verileri kalıcı olarak siler. Devam etmek istiyor musunuz?'), { title: t('Tüm uygulama verilerini sil'), confirmText: t('Devam et'), danger: true });
        if (!confirmed) return;
        const second = await confirmBox(t('Son onay: Tüm veriler silinecek ve geri alınamayacak.'), { title: t('Son onay'), confirmText: t('Kalıcı olarak sil'), danger: true });
        if (!second) return;
        const i = ipc();
        if (i) {
            let result;
            try { result = await i.invoke('reset-all-app-data'); }
            catch (err) { result = { ok: false, error: t('Uygulama verileri sıfırlanamadı.') }; }
            if (!result || !result.ok) { panelToast((result && result.error) || t('Uygulama verileri sıfırlanamadı.'), 'error'); return; }
        }
        try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
        location.reload();
    }

    const UPDATE_NOTIFY_CSS = `
#anka-update-notify{position:fixed;right:20px;bottom:20px;width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:var(--bg-secondary,#18181b);color:var(--text-color,#f4f4f5);border:1px solid var(--border-color,#27272a);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:16px;z-index:999999;font-family:'Segoe UI',system-ui,sans-serif;display:none;flex-direction:column;gap:10px;transform:translateY(24px) scale(.94);opacity:0;transition:transform .32s cubic-bezier(.16,1,.3,1),opacity .32s cubic-bezier(.16,1,.3,1);will-change:transform,opacity}
#anka-update-notify.show{display:flex;transform:none;opacity:1}
#anka-update-notify.hiding{transform:translateY(24px) scale(.94);opacity:0}
#anka-update-notify .aun-head{display:flex;align-items:center;gap:10px}
#anka-update-notify .aun-icon{flex:0 0 36px;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent,#ff4757),#ff7a45);display:grid;place-items:center;color:#fff;position:relative}
#anka-update-notify .aun-icon::after{content:"";position:absolute;top:0;right:0;bottom:0;left:0;border-radius:10px;border:2px solid var(--accent,#ff4757);opacity:0;animation:aun-ring 1.8s ease-out infinite}
#anka-update-notify .aun-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;position:relative;z-index:1}
#anka-update-notify .aun-title{font-size:14px;font-weight:700;line-height:1.3}
#anka-update-notify .aun-version{font-size:11px;color:var(--text-secondary,#a1a1aa);font-variant-numeric:tabular-nums}
#anka-update-notify .aun-notes{font-size:12px;color:var(--text-secondary,#a1a1aa);max-height:76px;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:8px 10px;background:var(--bg-primary,#121214);border-radius:8px;display:none}
#anka-update-notify .aun-notes.visible{display:block}
#anka-update-notify .aun-actions{display:flex;gap:8px}
#anka-update-notify .aun-btn{flex:1;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--border-color,#27272a);background:transparent;color:inherit;font:inherit;font-weight:600;font-size:12px;cursor:pointer;touch-action:manipulation;transition:background-color .15s,transform .1s,filter .15s}
#anka-update-notify .aun-btn:hover{background:var(--bg-tertiary,#27272a)}
#anka-update-notify .aun-btn:active{transform:scale(.96)}
#anka-update-notify .aun-btn.primary{flex:1.4;background:var(--accent,#ff4757);border-color:transparent;color:#fff}
#anka-update-notify .aun-btn.primary:hover{filter:brightness(1.08)}
#anka-update-notify .aun-status{font-size:11px;color:var(--text-secondary,#a1a1aa);display:none}
#anka-update-notify .aun-status.visible{display:block}
#anka-update-notify .aun-progress{height:4px;background:var(--bg-tertiary,#27272a);border-radius:2px;overflow:hidden;display:none}
#anka-update-notify .aun-progress.visible{display:block}
#anka-update-notify .aun-progress-bar{height:100%;width:100%;background:linear-gradient(90deg,var(--accent,#ff4757),#ff7a45);transform-origin:left;transform:scaleX(0);transition:transform .2s ease-out}
@keyframes aun-ring{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.55);opacity:0}}
@media (prefers-reduced-motion:reduce){#anka-update-notify,#anka-update-notify .aun-icon::after{transition:none!important;transform:none!important;animation:none!important}}
`;

    let updateNotifyEl = null;
    let updateNotifyTimer = 0;
    let updateNotifyHover = false;
    let updateNotifyData = null;

    function ensureUpdateNotifyStyles() {
        if (document.getElementById('anka-update-notify-styles')) return;
        const style = document.createElement('style');
        style.id = 'anka-update-notify-styles';
        style.textContent = UPDATE_NOTIFY_CSS;
        document.head.appendChild(style);
    }

    function ensureUpdateNotify() {
        if (updateNotifyEl && updateNotifyEl.isConnected) return updateNotifyEl;
        ensureUpdateNotifyStyles();
        const el = document.createElement('div');
        el.id = 'anka-update-notify';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<div class="aun-head"><div class="aun-icon"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></div><div><div class="aun-title">' + esc(t('Yeni Güncelleme Bulundu')) + '</div><div class="aun-version" id="aun-version"></div></div></div><div class="aun-notes" id="aun-notes"></div><div class="aun-status" id="aun-status"></div><div class="aun-progress" id="aun-progress"><div class="aun-progress-bar" id="aun-progress-bar"></div></div><div class="aun-actions" id="aun-actions"><button class="aun-btn" type="button" data-action="later">' + esc(t('Daha Sonra')) + '</button><button class="aun-btn primary" type="button" data-action="update">' + esc(t('Güncelle')) + '</button></div>';
        document.body.appendChild(el);
        el.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'later') hideUpdateNotify();
            else if (btn.dataset.action === 'update') startUpdateFromNotify();
        });
        el.addEventListener('mouseenter', () => { updateNotifyHover = true; clearTimeout(updateNotifyTimer); });
        el.addEventListener('mouseleave', () => { updateNotifyHover = false; scheduleUpdateNotifyClose(); });
        updateNotifyEl = el;
        return el;
    }

    function scheduleUpdateNotifyClose() {
        clearTimeout(updateNotifyTimer);
        if (updateNotifyHover) return;
        updateNotifyTimer = setTimeout(hideUpdateNotify, 10000);
    }

    function showUpdateNotify(data) {
        if (!document.body) return;
        const el = ensureUpdateNotify();
        updateNotifyData = data;
        const verEl = el.querySelector('#aun-version');
        const notesEl = el.querySelector('#aun-notes');
        const actions = el.querySelector('#aun-actions');
        const progress = el.querySelector('#aun-progress');
        const status = el.querySelector('#aun-status');
        if (verEl) verEl.textContent = 'v' + (data.currentVersion || '') + ' → v' + (data.version || '');
        if (notesEl) {
            if (data.notes) { notesEl.textContent = data.notes; notesEl.classList.add('visible'); }
            else { notesEl.classList.remove('visible'); notesEl.textContent = ''; }
        }
        if (actions) actions.style.display = '';
        if (progress) progress.classList.remove('visible');
        if (status) status.classList.remove('visible');
        el.classList.remove('hiding');
        el.classList.add('show');
        scheduleUpdateNotifyClose();
    }

    function hideUpdateNotify() {
        clearTimeout(updateNotifyTimer);
        const el = updateNotifyEl;
        if (!el || !el.classList.contains('show')) return;
        el.classList.remove('show');
        el.classList.add('hiding');
        setTimeout(() => { if (!el) return; el.classList.remove('hiding'); }, 340);
    }

    function startUpdateFromNotify() {
        if (!updateNotifyData) return;
        clearTimeout(updateNotifyTimer);
        const i = ipc();
        if (!i) return;
        const el = updateNotifyEl;
        if (el) {
            const actions = el.querySelector('#aun-actions');
            const progress = el.querySelector('#aun-progress');
            const status = el.querySelector('#aun-status');
            if (actions) actions.style.display = 'none';
            if (progress) progress.classList.add('visible');
            if (status) { status.classList.add('visible'); status.textContent = t('Güncelleme başlatılıyor…'); }
        }
        i.invoke('anka:start-update').catch(() => {});
    }

    function setupUpdateNotifyListeners() {
        if (window.__ankaUpdateNotifyBound) return;
        window.__ankaUpdateNotifyBound = true;
        const i = ipc();
        if (!i) return;
        i.on('update-available', (event, data) => { if (data && data.version) showUpdateNotify(data); });
        i.on('update-error', () => { hideUpdateNotify(); });
    }

    setupUpdateNotifyListeners();

    async function hydrateStoredSettings() {
        const i = ipc();
        settingsHydrationStarted = true;
        if (i) {
            try {
                const state = await i.invoke('load-app-state');
                const settings = state && state.settings ? state.settings : {};
                const localTheme = lsGet('set_theme-preset');
                const hasLocalTheme = THEME_IDS.includes(localTheme);
                const keepLocalTheme = hasLocalTheme &&
                    (lsGet('set_theme-preset-selected') === 'true' ||
                     localTheme !== 'system' ||
                     !THEME_IDS.includes(String(settings['theme-preset'])) ||
                     settings['theme-preset'] === 'system');
                for (const id of Object.keys(settings)) {
                    if (id === 'theme-preset' && !THEME_IDS.includes(String(settings[id]))) continue;
                    if (id === 'theme-preset' && keepLocalTheme) continue;
                    if (settingsEditedDuringHydration.has(id)) continue;
                    if (!lsSet('set_' + id, settings[id])) {
                        throw new Error('Yerel depolama alanı ayarları yüklemek için yeterli değil.');
                    }
                }
                if (keepLocalTheme && settings['theme-preset'] !== localTheme) notifyMain('theme-preset', localTheme);
                if (keepLocalTheme && lsGet('set_theme-preset-selected') !== 'true') lsSet('set_theme-preset-selected', 'true');
            } catch (err) {
                console.error('Kaydedilmiş ayarlar yüklenemedi:', err);
                toast('Kaydedilmiş ayarlar yüklenemedi.', 'error');
            }
            try {
                const i18nCache = await i.invoke('i18n-load-cache');
                if (i18nCache && ANKA_I18N) ANKA_I18N.hydrateCacheFromMain(i18nCache);
            } catch (err) {
                console.error('Dil önbelleği yüklenemedi:', err);
            }
        }
        settingsHydrationFinished = true;
        ensureThemeStored();
        if (lsGet('set_touch-mode-migrated') !== 'true') {
            lsSet('set_touch-mode-migrated', 'true');
            saveSetting('touch-mode', 'false', true);
        }
        const storedLang = lsGet('set_language');
        if (ANKA_I18N && storedLang) ANKA_I18N.setLang(storedLang);
        applyStoredSettings();
        if (i) {
            try {
                const cfg = await i.invoke('school-mode:get-config');
                if (cfg) syncSchool(!!cfg.enabled);
            } catch (e) {}
        }
    }

    bindThemeChannel();
    setupMovableMenus();
    applyTheme(getStoredMode());
    applyCustomAccent();
    applyCustomThemeCss(lsGet('set_custom-theme-css') || '');
    applyFontScale(getVal(findSetting('font-scale')));
    applyUiScale(getVal(findSetting('ui-scale')));
    applyIconStyle(getVal(findSetting('icon-style')));
    applyFontFamily();
    applyPanelDensity();
    applyReduceTransparency();
    applyAutoTheme();

    if (typeof window.getNewTabThemeSettings === 'function') window.getNewTabThemeSettings = themeSnapshot;

    const onSystemTheme = () => { if (getStoredMode() === 'system') applyTheme('system'); };
    if (lightMQ.addEventListener) lightMQ.addEventListener('change', onSystemTheme);
    else if (lightMQ.addListener) lightMQ.addListener(onSystemTheme);

    window.addEventListener('storage', onStorage);
    const policyIpc = ipc();
    if (policyIpc && typeof policyIpc.on === 'function') {
        policyIpc.on('school-management:policy-applied', (_event, policy) => {
            if (!policy || typeof policy.schoolModeEnabled !== 'boolean' ||
                typeof policy.strictMode !== 'boolean' || !Number.isInteger(policy.maxTabs) ||
                policy.maxTabs < 1 || policy.maxTabs > 30) return;
            let startUrl;
            try {
                startUrl = new URL(policy.startUrl);
                if (startUrl.protocol !== 'https:' && startUrl.protocol !== 'http:') return;
            } catch (error) {
                return;
            }
            const settings = {
                'safe-search': policy.strictMode ? 'strict' : 'moderate',
                'https-only': 'true',
                'ad-block': 'true',
                'track-protect': 'true',
                'max-tabs': String(policy.maxTabs),
                'max-live-tabs': String(policy.maxTabs),
                'school-mode': policy.schoolModeEnabled ? 'true' : 'false',
                'school-url': startUrl.href,
                ...(policy.settings || {})
            };
            for (const [id, value] of Object.entries(settings)) saveSetting(id, value, true);
            if (typeof window.showToast === 'function') {
                window.showToast('Onayladığınız okul politikası uygulandı.', 'success');
            }
        });
    }

    Object.assign(window, {
        toggleSettings,
        togglePlayerMode,
        saveSetting,
        applySetting,
        applyStoredSettings,
        checkDefaultBrowser,
        initAppVersionDisplay,
        createSettingsPanel,
        confirmBox
    });
    window.__toggleSettings = toggleSettings;

    window.__ankaSettingsReady = hydrateStoredSettings()
        .catch((err) => console.error('Kaydedilmiş ayarlar yüklenemedi:', err));
    window.__ankaSettingsReady
        .then(() => processPackQueue())
        .catch((err) => console.error('Dil paketi önbelleği yüklenemedi:', err));
})();