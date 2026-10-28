(function () {
    'use strict';

    if (window.__ankaSettingsLoaded) return;
    window.__ankaSettingsLoaded = true;
    const ANKA_I18N = window.AnkaI18n;

    const THEME_IDS = ['system', 'dark', 'light', 'catppuccin', 'cyberpunk', 'dracula', 'nord', 'oled', 'emerald'];
    const THEME_CLASSES = ['light-theme', 'theme-catppuccin', 'theme-cyberpunk', 'theme-dracula', 'theme-nord', 'theme-oled', 'theme-emerald'];
    const lightMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : { matches: false };
    const reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const LOW_END = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2 || reducedMQ.matches;

    const SCHOOL_POLICY = {
        'dev-tools-shortcut': 'false',
        'ai-mode-active': 'false',
        'search-suggestions': 'false',
        'notifications': 'false',
        'ad-block': 'true',
        'track-protect': 'true',
        'https-only': 'true',
        'max-tabs': '6'
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
html[data-density="compact"] #settings-panel{--sp-density:1}
html[data-density="comfortable"] #settings-panel{--sp-density:1.15}
.settings-layout{display:flex;height:100%;width:100%}
.settings-sidebar{width:224px;flex-shrink:0;background:var(--bg-primary,#121214);padding:16px 10px 12px;border-right:1px solid var(--border-color,#27272a);display:flex;flex-direction:column;gap:2px;overflow-y:auto;scrollbar-width:thin;overflow-x:hidden;contain:layout style}
.settings-brand{display:flex;align-items:center;gap:10px;padding:4px 10px 16px;font-size:15px;font-weight:700;color:var(--text-color,#f4f4f5)}
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
.sp-group-header{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;user-select:none;background:var(--bg-primary,#121214);transition:background-color .15s ease;font-size:13px;font-weight:600;color:var(--text-color,#f4f4f5)}
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
.sp-item{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border-color,#27272a);gap:16px;transition:background-color .15s ease;position:relative}
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
.sp-select,.sp-text{background:var(--bg-tertiary,#27272a);color:var(--text-color,#f4f4f5);border:1px solid var(--border-color,#27272a);padding:6px 10px;border-radius:7px;font-size:12px;outline:none;flex-shrink:0;transition:border-color .15s ease,box-shadow .15s ease}
.sp-select:focus,.sp-text:focus{border-color:var(--accent,#ff4757);box-shadow:0 0 0 2px rgba(255,71,87,.14)}
.sp-select{min-width:140px;cursor:pointer}
.sp-text{width:200px;max-width:100%}
.sp-select:disabled,.sp-text:disabled{cursor:not-allowed;opacity:.5}
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
.school-users{display:grid;gap:6px;margin:10px 0}
.school-user{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;background:var(--bg-tertiary,#27272a);border-radius:8px;font-size:12.5px}
.school-user strong{overflow-wrap:anywhere;font-weight:600}
.school-user-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
.school-user-form .school-input{width:100%}
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
#fps-display{position:fixed;top:50px;right:20px;z-index:999999;background:rgba(0,0,0,.85);color:var(--accent,#ff4757);padding:6px 12px;border-radius:6px;display:none;font-family:monospace;font-size:12px;pointer-events:none;border:1px solid var(--border-color,#27272a)}
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
  .sp-select,.sp-text{width:100%}
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
                        { id: 'notifications', label: 'Bildirimler', desc: 'Uygulama içi anlık bildirimlere izin ver', type: 'toggle', default: true },
                        { id: 'auto-save', label: 'Otomatik Kayıt', desc: 'Çalışma alanını, ayarları ve çizimleri otomatik kaydet', type: 'toggle', default: true },
                        { id: 'start-fullscreen', label: 'Tam Ekran Başlat', desc: 'Uygulama açıldığında otomatik tam ekrana geç', type: 'toggle', default: false },
                        { id: 'startup-page', label: 'Başlangıç Sayfası', desc: 'Tarayıcı açıldığında yüklenen sayfa', type: 'select', options: [{ val: 'home', name: 'Hız Çubuğu (Ana Sayfa)' }, { val: 'blank', name: 'Boş Sayfa' }], default: 'home' },
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
                            { val: 'emerald', name: 'Emerald Forest' }
                        ], default: 'system' },
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
                        { id: 'font-scale', label: 'Yazı Boyutu Ölçeği', desc: 'Tarayıcı arayüzü ve sayfalardaki yazıları ölçekle', type: 'range', min: 100, max: 130, step: 5, default: '100' },
                        { id: 'ui-scale', label: 'Arayüz Ölçeği', desc: 'Tarayıcı arayüzünü ve kontrolleri ölçekle', type: 'range', min: 100, max: 125, step: 5, default: '100' },
                        { id: 'panel-density', label: 'Panel Yoğunluğu', desc: 'Ayarlar panelindeki öğeler arası boşluk', type: 'select', options: [
                            { val: 'compact', name: 'Sıkışık' },
                            { val: 'normal', name: 'Normal (Varsayılan)' },
                            { val: 'comfortable', name: 'Ferah' }
                        ], default: 'normal' }
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
                        { id: 'reduce-transparency', label: 'Saydamlığı Azalt', desc: 'Bulanık arka planları devre dışı bırakarak performansı artır', type: 'toggle', default: false }
                    ]
                },
                {
                    id: 'gorunum-yerlesim',
                    title: 'Yerleşim',
                    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
                    items: [
                        { id: 'sidebar-side', label: 'Sol Menü Konumu', desc: 'Araç menüsünü pencerenin soluna veya sağına taşı', type: 'select', options: [{ val: 'left', name: 'Sol' }, { val: 'right', name: 'Sağ' }], default: 'left' },
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
                        { id: 'fingerprint-protection', label: 'Parmak İzi Koruması', desc: 'Canvas, WebGL ve font parmak izlerini rastgeleleştir', type: 'toggle', default: false }
                    ]
                },
                {
                    id: 'gizlilik-temizlik',
                    title: 'Temizlik',
                    icon: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
                    items: [
                        { id: 'download-scan', label: 'Dosya Risk Denetimi', desc: 'Şüpheli dosya türlerini işaretler (antivirüs değil)', type: 'toggle', default: true },
                        { id: 'clear-cache-exit', label: 'Çıkışta Önbelleği Sil', desc: 'Kapatıldığında çerezleri ve önbelleği temizle', type: 'toggle', default: false }
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
                        { id: 'fps-meter', label: 'FPS Göstergesi', desc: 'Sağ üst köşede anlık kare hızını göster', type: 'toggle', default: false }
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
                        { id: 'cache-size-limit', label: 'Maksimum Önbellek (MB)', desc: 'Bellekte tutulacak HTTP önbelleğinin üst sınırı', type: 'number', min: 100, max: 5000, placeholder: '500', default: '500' }
                    ]
                },
                {
                    id: 'gelismis-devtools',
                    title: 'Geliştirici Araçları',
                    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
                    items: [
                        { id: 'devtools-toggle', label: 'DevTools Aç/Kapat', desc: 'Geliştirici araçları penceresini açar veya kapatır', type: 'button', btnText: 'Aç / Kapat', action: 'toggleDevTools' },
                        { id: 'devtools-detached', label: 'DevTools Ayrı Pencerede Aç', desc: 'DevTools\'u ayrı bir pencerede açar', type: 'button', btnText: 'Ayrı Aç', action: 'openDetachedDevTools' },
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
                        { id: 'export-settings-btn', label: 'Ayarları Dosyaya Kaydet', desc: 'Tüm tercihleri seçtiğiniz konuma JSON dosyası olarak kaydet', type: 'button', btnText: 'Dosyaya Kaydet', action: 'exportSettingsToFile' },
                        { id: 'import-settings-btn', label: 'Dosyadan Ayarları Yükle', desc: 'Daha önce kaydettiğiniz ayar dosyasını yükle', type: 'button', btnText: 'Dosyadan Yükle', action: 'importSettingsFromFile' },
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
    let fpsEl = null;
    let externalTimer = 0;
    let stylesReady = false;
    let dismissLock = () => {};
    let searchQuery = '';
    let autoThemeTimer = 0;
    let activeConfirm = null;
    let translationBanner = null;
    let translationInFlight = false;

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
        if (api && api.sendSettingUpdate) api.sendSettingUpdate({ id, val });
        else if (i) i.send('settings-update', { id, val });
        if (i) i.send('save-app-setting', { id, val });
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
        if (channel) channel.postMessage({ id: 'theme-preset', val: theme });
        const i = ipc();
        if (i) i.send('set-theme-source', mode === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark');
        if (typeof syncOpenNewTabThemes === 'function') syncOpenNewTabThemes();
        applyCustomAccent();
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
        const stored = lsGet('set_font-family');
        const map = {
            system: '',
            sans: 'system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"Noto Sans",Helvetica,Arial,sans-serif',
            serif: 'Georgia,"Times New Roman",Times,serif',
            mono: 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace'
        };
        if (stored && stored !== 'system' && map[stored]) root.style.setProperty('--font', map[stored]);
        else root.style.removeProperty('--font');
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
            uiAnimations: getVal(findSetting('ui-animations')) === true
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
                const incoming = String(data.val);
                if (THEME_IDS.includes(incoming) && incoming !== 'system' && resolveTheme(mode) !== incoming) saveSetting('theme-preset', incoming, true);
                else applyTheme(mode);
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
            el.textContent = 'FPS: 60';
            document.body.appendChild(el);
        }
        return el;
    }

    function updateFPS(now) {
        fpsFrameCount++;
        if (now - fpsLastTime >= 1000) {
            if (!fpsEl || !fpsEl.isConnected) fpsEl = document.getElementById('fps-display');
            if (fpsEl) fpsEl.textContent = 'FPS: ' + fpsFrameCount;
            fpsFrameCount = 0;
            fpsLastTime = now;
        }
        fpsAnimationId = requestAnimationFrame(updateFPS);
    }

    function applySetting(id, val) {
        const boolVal = val === true || val === 'true';
        const root = document.documentElement;
        if (id === 'fps-meter') {
            const el = ensureFps();
            if (el) el.style.display = boolVal ? 'block' : 'none';
            if (boolVal) {
                if (!fpsAnimationId) {
                    fpsFrameCount = 0;
                    fpsLastTime = performance.now();
                    fpsAnimationId = requestAnimationFrame(updateFPS);
                }
            } else if (fpsAnimationId) {
                cancelAnimationFrame(fpsAnimationId);
                fpsAnimationId = 0;
            }
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
        } else if (id === 'font-family') {
            applyFontFamily();
        } else if (id === 'panel-density') {
            applyPanelDensity();
        } else if (id === 'auto-theme' || id === 'auto-theme-dark-start' || id === 'auto-theme-light-start') {
            applyAutoTheme();
        } else if (id === 'language') {
            const lang = String(val || 'tr');
            if (ANKA_I18N) ANKA_I18N.setLang(lang);
            if (panelOpen) renderTab(currentTab);
        } else if (id === 'smooth-scrolling') {
            root.style.scrollBehavior = boolVal ? 'smooth' : 'auto';
            root.classList.toggle('smooth', boolVal);
        } else if (id === 'font-scale') {
            const scale = Math.max(100, Math.min(130, Number(val) || 100)) / 100;
            root.dataset.fontScale = String(Math.round(scale * 100));
            root.style.setProperty('--anka-font-scale', String(scale));
            root.style.fontSize = 16 * scale + 'px';
            if (typeof window.__ankaApplyZoomSettings === 'function') window.__ankaApplyZoomSettings();
        } else if (id === 'ui-scale') {
            const scale = Math.max(100, Math.min(125, Number(val) || 100)) / 100;
            root.dataset.uiScale = String(Math.round(scale * 100));
            root.style.setProperty('--anka-ui-scale', String(scale));
        } else if (['sidebar-side', 'bookmarks-bar', 'show-home-btn', 'tab-memory', 'page-zoom'].includes(id)) {
            if (typeof window.applyChromeLayout === 'function') window.applyChromeLayout();
        } else if (id === 'touch-mode') {
            setToggleClass('touch-mode', boolVal);
        } else if (id === 'compact-tabs') {
            root.classList.toggle('compact-tabs', boolVal);
        } else if (id === 'notifications') {
            root.dataset.notifications = boolVal ? 'on' : 'off';
        } else if (id === 'search-suggestions') {
            root.dataset.searchSuggestions = boolVal ? 'on' : 'off';
        } else if (id === 'school-mode') {
            root.dataset.schoolMode = boolVal ? 'on' : 'off';
            if (typeof window.applySchoolChrome === 'function') window.applySchoolChrome();
        } else if (id === 'ui-animations') {
            const reduce = !boolVal;
            setToggleClass('reduce-effects', reduce);
            root.classList.toggle('perf-lite', reduce || !!(window.ANKA_ENV && window.ANKA_ENV.lowEnd));
        } else if (id === 'reduce-transparency') {
            applyReduceTransparency();
        }
        if ((id === 'font-scale' || id === 'ui-scale' || id === 'touch-mode' || id === 'ui-animations') && typeof syncOpenNewTabThemes === 'function') {
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
        lsSet('set_' + id, out);
        applySetting(id, out);
        if (s) refreshControl(id, s);
        if (changed || force) notifyMain(id, isToggle ? out === 'true' : out);
        refreshChangedIndicators();
        return true;
    }

    function syncSchool(on) {
        const was = isSchoolActive();
        const str = on ? 'true' : 'false';
        if (lsGet('set_school-mode') !== str) saveSetting('school-mode', str, true);
        else applySetting('school-mode', str);
        for (const id of Object.keys(SCHOOL_POLICY)) {
            if (on) {
                if (lsGet('set_' + id) !== SCHOOL_POLICY[id]) saveSetting(id, SCHOOL_POLICY[id], true);
            } else if (was) {
                saveSetting(id, getDefault(findSetting(id)), true);
            }
        }
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
    const statusClass = isFull ? 'ok' : (prog.done > 0 ? 'info' : 'no');
    const statusText = isFull ? 'İndirildi' : (prog.done > 0 ? prog.done + '/' + prog.total : 'Hazır değil');
    return `<div class="pack-row" data-pack-lang="${lang}"><span class="pack-status sp-status ${statusClass}" id="pack-status-${lang}">${statusText}</span><div class="pack-bar"><div class="pack-bar-fill${isFull ? ' done' : ''}" id="pack-fill-${lang}" style="width:${prog.percent}%"></div></div><button type="button" class="sp-btn${isFull ? ' secondary' : ''}" data-action="download-pack" data-lang="${lang}" id="pack-btn-${lang}">${isFull ? 'Yeniden İndir' : 'İndir'}</button></div>`;
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
            return `<input class="sp-text" type="text" data-id="${s.id}" value="${esc(v || '')}" placeholder="${esc(s.placeholder || '')}"${dis}>`;
        }
        if (s.type === 'number') {
            return `<input class="sp-text" type="number" data-id="${s.id}" min="${s.min}" max="${s.max}" value="${esc(v || '')}" placeholder="${esc(s.placeholder || '')}"${dis}>`;
        }
        if (s.type === 'color') {
            const safeVal = /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ff4757';
            return `<div class="sp-color-wrap"><input type="color" class="sp-color" data-id="${s.id}" value="${safeVal}"><button type="button" class="sp-color-reset" data-reset-id="${s.id}" title="Tema varsayılanına dön">Sıfırla</button></div>`;
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
            refreshChangedIndicators();
            return;
        }
        let html = '';
        for (const group of cat.groups) html += groupHTML(group);
        domCache.body.innerHTML = html;
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
            html += `<div class="settings-nav-item" data-tab="hakkinda"><span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span><span class="nav-label">${esc(t('Hakkında'))}</span></div>`;
            html += '<div class="settings-nav-spacer"></div><div class="settings-nav-divider"></div>';
            html += `<div class="settings-nav-item danger" id="reset-settings-btn"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></span><span class="nav-label">${esc(t('Ayarları Sıfırla'))}</span></div>`;
            html += `<div class="settings-nav-item danger-strong" id="reset-all-data-btn"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></span><span class="nav-label">${esc(t('Her Şeyi Sıfırla'))}</span></div>`;
            return html;
        })();
        document.body.insertAdjacentHTML('beforeend', `
<div id="settings-panel" role="dialog" aria-modal="true" aria-label="Ayarlar">
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="settings-brand"><div class="settings-brand-icon">⚙</div><div>${esc(t('Ayarlar'))}</div></div>
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
        const i = ipc();
        if (!i) throw new Error('Okul Modu yalnızca Anka Web uygulamasında kullanılabilir.');
        return i.invoke('school-mode:get-config');
    }

    function schoolToggle(labelText, description, checked) {
        const row = document.createElement('div');
        row.className = 'school-row';
        const info = document.createElement('div');
        info.innerHTML = '<div class="sp-item-label"></div><div class="sp-item-desc"></div>';
        info.children[0].textContent = labelText;
        info.children[1].textContent = description;
        const toggle = document.createElement('label');
        toggle.className = 'sp-toggle';
        toggle.innerHTML = '<input type="checkbox"><span class="sp-slider"></span>';
        const input = toggle.querySelector('input');
        input.checked = !!checked;
        row.append(info, toggle);
        return { row, input };
    }

    function schoolTextInput(type, placeholder, value = '') {
        const input = document.createElement('input');
        input.className = 'sp-text school-input';
        input.type = type;
        input.placeholder = placeholder;
        input.value = value;
        input.autocomplete = type === 'password' ? 'new-password' : 'url';
        return input;
    }

    function validSchoolUrl(value) {
        try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:'; }
        catch (e) { return false; }
    }

    async function renderSchoolSettings(body) {
        body.replaceChildren();
        const group = document.createElement('div');
        group.className = 'sp-group';
        const loading = document.createElement('div');
        loading.className = 'sp-empty';
        loading.textContent = t('Okul ayarları yükleniyor...');
        group.appendChild(loading);
        body.appendChild(group);
        let config;
        try { config = await loadSchoolConfig(); }
        catch (err) { loading.textContent = err.message; return; }
        if (!body.isConnected || currentTab !== 'okul') return;
        group.replaceChildren();
        const modeCard = document.createElement('section');
        modeCard.className = 'school-card';
        const mode = schoolToggle(t('Okul Modu'), t('Açıldığında yeni sekmeler ve uygulama başlangıcı seçilen okul sitesine gider.'), config.enabled);
        const policyNote = document.createElement('p');
        policyNote.style.marginTop = '8px';
        policyNote.textContent = t('Açıkken yönetilen ayarlar') + ': ' + Object.keys(SCHOOL_POLICY).map((id) => (findSetting(id) && findSetting(id).label) || id).join(', ') + '.';
        modeCard.append(mode.row, policyNote);
        group.appendChild(modeCard);
        const urlCard = document.createElement('section');
        urlCard.className = 'school-card';
        const urlTitle = document.createElement('h3');
        urlTitle.textContent = t('Başlangıç Sitesi');
        const urlDescription = document.createElement('p');
        urlDescription.textContent = t('Varsayılan EBA adresini değiştirebilirsiniz.');
        const urlInput = schoolTextInput('url', 'https://www.eba.gov.tr/', config.startUrl);
        urlCard.append(urlTitle, urlDescription, urlInput);
        group.appendChild(urlCard);
        const lockCard = document.createElement('section');
        lockCard.className = 'school-card';
        const lock = schoolToggle(t('Ayarları Parola ile Kilitle'), t('Okul ayarlarına her girişte parola istenir.'), config.lockSettings);
        const lockDescription = document.createElement('p');
        lockDescription.className = 'school-warning';
        lockDescription.style.marginTop = '8px';
        lockDescription.textContent = t('Parola geri alınamaz. Unutursanız kullanıcı verilerini sıfırlamanız gerekir.');
        const settingsPassword = schoolTextInput('password', config.hasSettingsPassword ? t('Yeni parola (değiştirmek için)') : t('Ayar parolası'));
        lockCard.append(lock.row, lockDescription, settingsPassword);
        group.appendChild(lockCard);
        const usersCard = document.createElement('section');
        usersCard.className = 'school-card';
        const login = schoolToggle(t('Girişte Kullanıcı Seçimi'), t('Kapalıyken uygulama giriş ekranı göstermez.'), config.userLoginEnabled);
        usersCard.appendChild(login.row);
        const userList = document.createElement('div');
        userList.className = 'school-users';
        const userForm = document.createElement('div');
        userForm.className = 'school-user-form';
        const usernameInput = schoolTextInput('text', t('Kullanıcı adı'));
        const displayNameInput = schoolTextInput('text', t('Görünen ad'));
        const userPasswordInput = schoolTextInput('password', t('Parola (opsiyonel)'));
        const addUser = document.createElement('button');
        addUser.type = 'button';
        addUser.className = 'sp-btn';
        addUser.textContent = t('Kullanıcı Ekle');
        userForm.append(usernameInput, displayNameInput, userPasswordInput, addUser);
        usersCard.append(userList, userForm);
        group.appendChild(usersCard);
        const status = document.createElement('div');
        status.className = 'school-card';
        status.style.fontSize = '11.5px';
        status.style.color = 'var(--text-secondary,#a1a1aa)';
        group.appendChild(status);
        const renderUsers = () => {
            const frag = document.createDocumentFragment();
            for (const user of config.users || []) {
                const row = document.createElement('div');
                row.className = 'school-user';
                const name = document.createElement('strong');
                name.textContent = `${user.displayName} (@${user.username})`;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'sp-btn secondary';
                remove.style.padding = '4px 10px';
                remove.style.fontSize = '11px';
                remove.textContent = t('Kaldır');
                remove.addEventListener('click', async () => {
                    try {
                        const result = await ipc().invoke('school-mode:remove-user', user.id);
                        if (!result.ok) { status.textContent = result.error; return; }
                        config.users = result.config.users;
                        status.textContent = t('Kullanıcı kaldırıldı.');
                        renderUsers();
                    } catch (err) { status.textContent = t('Kullanıcı kaldırılamadı.'); }
                });
                row.append(name, remove);
                frag.appendChild(row);
            }
            userList.replaceChildren(frag);
        };
        renderUsers();
        addUser.addEventListener('click', async () => {
            try {
                const result = await ipc().invoke('school-mode:save-user', { username: usernameInput.value, displayName: displayNameInput.value, password: userPasswordInput.value });
                if (!result.ok) { status.textContent = result.error; return; }
                config.users = result.users;
                usernameInput.value = ''; displayNameInput.value = ''; userPasswordInput.value = '';
                status.textContent = t('Kullanıcı eklendi.'); renderUsers();
            } catch (err) { status.textContent = t('Kullanıcı eklenemedi.'); }
        });
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'sp-btn';
        save.textContent = t('Okul Ayarlarını Kaydet');
        save.addEventListener('click', async () => {
            if (!validSchoolUrl(urlInput.value.trim())) { status.textContent = t('Geçerli bir http(s) adresi girin.'); return; }
            if (lock.input.checked && !config.hasSettingsPassword && !settingsPassword.value) { status.textContent = t('Ayar kilidi için parola belirleyin.'); return; }
            if (lock.input.checked && !config.lockSettings && !await confirmBox(t('Bu parola unutulursa kurtarılamaz. Devam edilsin mi?'), { title: t('Ayar kilidini etkinleştir') })) return;
            save.disabled = true;
            try {
                const result = await ipc().invoke('school-mode:save-config', {
                    enabled: mode.input.checked, startUrl: urlInput.value.trim(),
                    lockSettings: lock.input.checked, settingsPassword: settingsPassword.value,
                    userLoginEnabled: login.input.checked
                });
                settingsPassword.value = '';
                if (!result.ok) { status.textContent = result.error; return; }
                config = result.config;
                syncSchool(!!config.enabled);
                if (typeof window.applySchoolChrome === 'function') window.applySchoolChrome();
                saveSetting('school-url', config.startUrl, true);
                status.textContent = t('Okul ayarları kaydedildi.');
            } catch (err) { status.textContent = t('Kaydedilemedi.'); }
            finally { save.disabled = false; }
        });
        const saveCard = document.createElement('div');
        saveCard.className = 'school-card';
        saveCard.appendChild(save);
        group.appendChild(saveCard);
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
        const api = window.electronAPI;
        let sent = false;
        if (api && api.setAsDefaultBrowser) { api.setAsDefaultBrowser(); sent = true; }
        else if (ipc()) { ipc().send('set-as-default-browser'); sent = true; }
        if (!sent) { panelToast(t('Bu işlem bu ortamda desteklenmiyor.'), 'error'); return; }
        if (btn) btn.disabled = true;
        setTimeout(async () => {
            if (btn && btn.isConnected) btn.disabled = false;
            const result = await checkDefaultBrowser();
            if (result) panelToast(t('Anka Web varsayılan tarayıcı olarak ayarlandı.'), 'success');
            else panelToast(t('Varsayılan yapılamadı. İşletim sisteminden onaylayın.'), 'error');
        }, 1500);
    }

    async function renderAboutSettings(body) {
        body.replaceChildren();
        const hero = document.createElement('div');
        hero.className = 'about-hero';
        const logo = document.createElement('img');
        logo.src = '../../src/icons/dark-logo.png';
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
            p.style.willChange = 'transform, opacity';
            o.classList.remove('visible');
            void p.offsetWidth;
            p.style.transform = 'translate(-50%, -50%) scale(1)';
            p.style.opacity = '1';
            requestAnimationFrame(() => o.classList.add('visible'));
        } else {
            panelOpen = false;
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
            const api = window.electronAPI;
            if (api && api.checkDefaultBrowser) result = await api.checkDefaultBrowser();
            else if (ipc()) result = await ipc().invoke('check-default-browser');
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
                if (s.btnText) add(s.btnText);
                if (s.options) for (const o of s.options) add(o.name);
            }
        }
    }
    collectAllSettingsTexts._cache = out;
    return out;
}

let packQueue = [];
let packRunning = false;
let packCurrentLang = null;

async function processPackQueue() {
    if (packRunning) return;
    if (!packQueue.length) return;
    if (!ANKA_I18N) return;
    packRunning = true;
    while (packQueue.length > 0) {
        const lang = packQueue.shift();
        packCurrentLang = lang;
        await downloadLanguagePack(lang);
    }
    packRunning = false;
    packCurrentLang = null;
}

async function downloadLanguagePack(lang) {
    if (!ANKA_I18N || !domCache.body) return;
    const texts = collectAllSettingsTexts();
    const statusEl = document.getElementById('pack-status-' + lang);
    const fillEl = document.getElementById('pack-fill-' + lang);
    const btnEl = document.getElementById('pack-btn-' + lang);
    if (statusEl) { statusEl.textContent = '0/' + texts.length; statusEl.className = 'pack-status sp-status info'; }
    if (fillEl) { fillEl.style.width = '0%'; fillEl.className = 'pack-bar-fill'; }
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'İndiriliyor…'; }
    try {
        const result = await ANKA_I18N.downloadPack(texts, lang, (done, total) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            if (fillEl) fillEl.style.width = pct + '%';
            if (statusEl) statusEl.textContent = done + '/' + total;
        });
        if (statusEl) { statusEl.textContent = 'İndirildi'; statusEl.className = 'pack-status sp-status ok'; }
        if (fillEl) { fillEl.style.width = '100%'; fillEl.className = 'pack-bar-fill done'; }
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Yeniden İndir'; btnEl.className = 'sp-btn secondary'; }
        panelToast(lang.toUpperCase() + ' paketi indirildi (' + result.fetched + ' yeni, ' + result.fromCache + ' önbellek)', 'success');
        if (ANKA_I18N.getLang() === lang) renderTab(currentTab);
    } catch (e) {
        if (statusEl) { statusEl.textContent = 'Hata'; statusEl.className = 'pack-status sp-status no'; }
        if (fillEl) fillEl.className = 'pack-bar-fill error';
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Tekrar Dene'; }
        panelToast('Paket indirilemedi: ' + (e && e.message ? e.message : 'bilinmeyen hata'), 'error');
    }
}

    function collectExportData() {
        const data = { __meta: { app: 'Anka Web', exportedAt: new Date().toISOString(), version: 3 } };
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (key.startsWith('set_')) {
                    const id = key.slice(4);
                    if (id === 'school-mode' || id === 'school-url' || isLocked(id)) continue;
                    if (!findSetting(id)) continue;
                    data[key] = localStorage.getItem(key);
                } else if (key === 'okul_modu') {
                    data[key] = localStorage.getItem(key);
                }
            }
        } catch (e) {}
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
        const data = collectExportData();
        const json = JSON.stringify(data, null, 2);
        const filename = 'ankaweb-ayarlar-' + new Date().toISOString().slice(0, 10) + '.json';
        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'JSON dosyası', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(json);
                await writable.close();
                panelToast(t('Ayarlar dosyaya kaydedildi'), 'success');
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
            }
        }
        try {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            panelToast(t('Ayarlar indirildi'), 'success');
        } catch (e) {
            panelToast(t('Dosya oluşturulamadı'), 'error');
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
            } else if (key === 'okul_modu' && (data[key] === 'true' || data[key] === 'false')) {
                lsSet(key, data[key]);
                applied++;
            }
        }
        return applied;
    }

    async function importSettingsFromFile() {
        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{ description: 'JSON dosyası', accept: { 'application/json': ['.json'] } }],
                    multiple: false
                });
                const file = await handle.getFile();
                const text = await file.text();
                const data = JSON.parse(text);
                const count = applyImportedData(data);
                panelToast(count + ' ' + t('ayar yüklendi, yeniden başlatılıyor…'), 'success');
                setTimeout(() => location.reload(), 1000);
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
            }
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onerror = () => panelToast(t('Dosya okunamadı'), 'error');
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    const count = applyImportedData(data);
                    panelToast(count + ' ' + t('ayar yüklendi, yeniden başlatılıyor…'), 'success');
                    setTimeout(() => location.reload(), 1000);
                } catch (err) { panelToast(t('Geçersiz ayar dosyası'), 'error'); }
            };
            reader.readAsText(file);
        };
        input.click();
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
        const i = ipc();
        if (!i) { panelToast(t('Bu işlem yalnızca uygulamada kullanılabilir'), 'error'); return; }
        try { i.send('devtools-toggle'); } catch (e) {}
    }

    function openDetachedDevTools() {
        const i = ipc();
        if (!i) { panelToast(t('Bu işlem yalnızca uygulamada kullanılabilir'), 'error'); return; }
        try { i.send('devtools-detached'); } catch (e) {}
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

    function executeSettingAction(action, btnEl) {
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
            const api = window.electronAPI;
            let sent = false;
            if (api && api.setAsDefaultBrowser) { api.setAsDefaultBrowser(); sent = true; }
            else if (ipc()) { ipc().send('set-as-default-browser'); sent = true; }
            if (!sent) { panelToast(t('Bu işlem bu ortamda desteklenmiyor'), 'error'); return; }
            setTimeout(async () => {
                const result = await checkDefaultBrowser();
                if (result) panelToast(t('Varsayılan tarayıcı ayarlandı'), 'success');
                else panelToast(t('Varsayılan yapılamadı'), 'error');
            }, 1500);
        } else if (action === 'checkAppUpdates') {
            runUpdateCheck(btnEl);
        } else if (action === 'exportSettingsToFile') {
            exportSettingsToFile();
        } else if (action === 'importSettingsFromFile') {
            importSettingsFromFile();
        } else if (action === 'clearI18nCache') {
            clearI18nCache();
        } else if (action === 'clearTempDataAndRestart') {
            clearTempDataAndRestart(btnEl);
        } else if (action === 'toggleDevTools') {
            toggleDevTools();
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
        if (i) {
            try {
                const state = await i.invoke('load-app-state');
                const settings = state && state.settings ? state.settings : {};
                for (const id of Object.keys(settings)) {
                    if (id === 'theme-preset' && !THEME_IDS.includes(String(settings[id]))) continue;
                    lsSet('set_' + id, settings[id]);
                }
            } catch (e) {}
            try {
                const i18nCache = await i.invoke('i18n-load-cache');
                if (i18nCache && ANKA_I18N) ANKA_I18N.hydrateCacheFromMain(i18nCache);
            } catch (e) {}
        }
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

    ensureThemeStored();
    bindThemeChannel();
    applyTheme(getStoredMode());
    applyCustomAccent();
    applyFontFamily();
    applyPanelDensity();
    applyReduceTransparency();
    applyAutoTheme();

    if (typeof window.getNewTabThemeSettings === 'function') window.getNewTabThemeSettings = themeSnapshot;

    const onSystemTheme = () => { if (getStoredMode() === 'system') applyTheme('system'); };
    if (lightMQ.addEventListener) lightMQ.addEventListener('change', onSystemTheme);
    else if (lightMQ.addListener) lightMQ.addListener(onSystemTheme);

    window.addEventListener('storage', onStorage);

    Object.assign(window, {
        toggleSettings,
        saveSetting,
        applySetting,
        applyStoredSettings,
        checkDefaultBrowser,
        initAppVersionDisplay,
        createSettingsPanel,
        confirmBox
    });
    window.__toggleSettings = toggleSettings;

    hydrateStoredSettings();
})();