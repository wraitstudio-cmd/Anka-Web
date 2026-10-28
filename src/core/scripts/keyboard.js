(function () {
    'use strict';

    const BLOCKED_INPUT = { button: 1, submit: 1, reset: 1, checkbox: 1, radio: 1, file: 1, color: 1, range: 1, hidden: 1, image: 1 };
    const LAYOUT = [
        [
            { n: '"', s: 'é' }, { n: '1', s: '!' }, { n: '2', s: "'" }, { n: '3', s: '^' }, { n: '4', s: '+' },
            { n: '5', s: '%' }, { n: '6', s: '&' }, { n: '7', s: '/' }, { n: '8', s: '(' }, { n: '9', s: ')' },
            { n: '0', s: '=' }, { n: '*', s: '?' }, { n: '-', s: '_' }, { cmd: 'backspace', label: '⌫', cls: 'kb-fn kb-danger', flex: '1.35' }
        ],
        [
            { cmd: 'tab', label: 'Tab', cls: 'kb-fn', flex: '1.2' },
            { n: 'q', s: 'Q' }, { n: 'w', s: 'W' }, { n: 'e', s: 'E' }, { n: 'r', s: 'R' }, { n: 't', s: 'T' },
            { n: 'y', s: 'Y' }, { n: 'u', s: 'U' }, { n: 'ı', s: 'I' }, { n: 'o', s: 'O' }, { n: 'p', s: 'P' },
            { n: 'ğ', s: 'Ğ' }, { n: 'ü', s: 'Ü' }
        ],
        [
            { cmd: 'caps', label: 'Caps', cls: 'kb-fn', flex: '1.35' },
            { n: 'a', s: 'A' }, { n: 's', s: 'S' }, { n: 'd', s: 'D' }, { n: 'f', s: 'F' }, { n: 'g', s: 'G' },
            { n: 'h', s: 'H' }, { n: 'j', s: 'J' }, { n: 'k', s: 'K' }, { n: 'l', s: 'L' }, { n: 'ş', s: 'Ş' },
            { n: 'i', s: 'İ' }, { cmd: 'enter', label: 'Enter', cls: 'kb-fn kb-enter', flex: '1.6' }
        ],
        [
            { cmd: 'shift', label: '⇧', cls: 'kb-fn', flex: '1.5' },
            { n: 'z', s: 'Z' }, { n: 'x', s: 'X' }, { n: 'c', s: 'C' }, { n: 'v', s: 'V' }, { n: 'b', s: 'B' },
            { n: 'n', s: 'N' }, { n: 'm', s: 'M' }, { n: 'ö', s: 'Ö' }, { n: 'ç', s: 'Ç' }, { n: '.', s: ':' },
            { n: ',', s: ';' }, { cmd: 'shift', label: '⇧', cls: 'kb-fn', flex: '1.5' }
        ],
        [
            { cmd: 'noop', label: 'Ctrl', cls: 'kb-fn' },
            { cmd: 'noop', label: 'Alt', cls: 'kb-fn' },
            { cmd: 'space', label: 'Boşluk', cls: 'kb-space' },
            { cmd: 'noop', label: 'AltGr', cls: 'kb-fn' },
            { cmd: 'close', label: 'Kapat', cls: 'kb-fn kb-close' }
        ]
    ];

    const GUEST_INSTALL = '(()=>{if(window.__ankaKbInsert)return;let last=null;const blocked={button:1,submit:1,reset:1,checkbox:1,radio:1,file:1,color:1,range:1,hidden:1,image:1};const ok=el=>{if(!el||el.disabled||el.readOnly)return false;if(el.isContentEditable)return true;if(el.tagName==="TEXTAREA")return true;if(el.tagName!=="INPUT")return false;return !blocked[(el.type||"text").toLowerCase()];};document.addEventListener("focusin",e=>{if(ok(e.target))last=e.target;},true);const pick=()=>{if(ok(last)&&document.contains(last))return last;if(ok(document.activeElement))return document.activeElement;const q=document.getElementById("q");if(ok(q))return q;return document.querySelector("input:not([type=hidden]):not([disabled]),textarea:not([disabled]),[contenteditable=true],[contenteditable=\\"\\"]");};const fire=(el,type,extra)=>{try{el.dispatchEvent(new InputEvent(type,Object.assign({bubbles:true,cancelable:true,composed:true},extra||{})));}catch(e){el.dispatchEvent(new Event(type,{bubbles:true}));}if(type==="input")el.dispatchEvent(new Event("change",{bubbles:true}));};const sel=(el,pos)=>{try{el.setSelectionRange(pos,pos);}catch(e){}};window.__ankaKbInsert=(action,value)=>{const el=pick();if(!ok(el))return false;try{el.focus({preventScroll:true});}catch(e){try{el.focus();}catch(e2){}}if(el.isContentEditable){if(action==="backspace")document.execCommand("delete");else if(action==="enter")document.execCommand("insertParagraph");else document.execCommand("insertText",false,action==="tab"?"\\t":String(value==null?"":value));return true;}const start=el.selectionStart!=null?el.selectionStart:String(el.value||"").length;const end=el.selectionEnd!=null?el.selectionEnd:start;const val=String(el.value||"");if(action==="backspace"){if(start!==end){if(el.setRangeText)el.setRangeText("",start,end,"end");else{el.value=val.slice(0,start)+val.slice(end);sel(el,start);}}else if(start>0){if(el.setRangeText)el.setRangeText("",start-1,start,"end");else{el.value=val.slice(0,start-1)+val.slice(start);sel(el,start-1);}}fire(el,"input",{inputType:"deleteContentBackward"});}else if(action==="enter"){el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true}));el.dispatchEvent(new KeyboardEvent("keypress",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true}));el.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true}));}else{const text=action==="tab"?"\\t":String(value==null?"":value);if(el.setRangeText)el.setRangeText(text,start,end,"end");else{el.value=val.slice(0,start)+text+val.slice(end);sel(el,start+text.length);}fire(el,"input",{inputType:"insertText",data:text});}return true;};})()';

    let shiftOn = false;
    let capsOn = false;
    let built = false;
    let lastHost = null;
    let lastHostAt = 0;
    let lastGuest = null;
    let lastGuestAt = 0;
    let pressedKey = null;

    function isEditable(el) {
        if (!el || el.disabled || el.readOnly) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag !== 'INPUT') return false;
        return !BLOCKED_INPUT[(el.type || 'text').toLowerCase()];
    }

    function kbRoot() {
        return document.getElementById('keyboard');
    }

    function keysRoot() {
        const root = kbRoot();
        if (!root) return null;
        let box = document.getElementById('kb-keys');
        if (!box) {
            box = document.createElement('div');
            box.id = 'kb-keys';
            root.appendChild(box);
        }
        return box;
    }

    function shifted() {
        return capsOn ? !shiftOn : shiftOn;
    }

    function paintLabels() {
        const box = keysRoot();
        if (!box) return;
        const up = shifted();
        const nodes = box.getElementsByClassName('kb-key');
        for (let i = 0; i < nodes.length; i++) {
            const btn = nodes[i];
            const cmd = btn.dataset.cmd;
            if (!cmd) btn.textContent = up ? btn.dataset.s : btn.dataset.n;
            else if (cmd === 'shift') btn.classList.toggle('active', shiftOn);
            else if (cmd === 'caps') btn.classList.toggle('active', capsOn);
        }
    }

    function buildKeyboard() {
        const box = keysRoot();
        if (!box || built) {
            paintLabels();
            return;
        }
        const frag = document.createDocumentFragment();
        for (let r = 0; r < LAYOUT.length; r++) {
            const row = document.createElement('div');
            row.className = 'kb-row';
            const keys = LAYOUT[r];
            for (let i = 0; i < keys.length; i++) {
                const spec = keys[i];
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'kb-key' + (spec.cls ? ' ' + spec.cls : '');
                btn.tabIndex = -1;
                if (spec.flex) btn.style.flex = spec.flex;
                if (spec.cmd) {
                    btn.dataset.cmd = spec.cmd;
                    btn.textContent = spec.label;
                } else {
                    btn.dataset.n = spec.n;
                    btn.dataset.s = spec.s;
                    btn.textContent = spec.n;
                }
                row.appendChild(btn);
            }
            frag.appendChild(row);
        }
        box.textContent = '';
        box.appendChild(frag);
        built = true;
        paintLabels();
    }

    function rememberHost(el) {
        if (!isEditable(el)) return;
        lastHost = el;
        lastHostAt = performance.now();
    }

    function rememberGuest(vw) {
        if (!vw) return;
        lastGuest = vw;
        lastGuestAt = performance.now();
    }

    function currentGuest() {
        if (lastGuest && lastGuest.isConnected) return lastGuest;
        if (typeof ankaActiveView === 'function') {
            const vw = ankaActiveView();
            if (vw) return vw;
        }
        return document.querySelector('#wv-container webview, #wv-container iframe, webview.browser-view, iframe.browser-view, iframe.anka-frame');
    }

    function insertHost(action, value) {
        const el = (lastHost && document.contains(lastHost) && isEditable(lastHost)) ? lastHost : (isEditable(document.activeElement) ? document.activeElement : null);
        if (!isEditable(el)) return false;
        try { el.focus({ preventScroll: true }); } catch (err) { try { el.focus(); } catch (err2) {} }

        if (el.isContentEditable) {
            if (action === 'backspace') document.execCommand('delete');
            else if (action === 'enter') document.execCommand('insertParagraph');
            else document.execCommand('insertText', false, action === 'tab' ? '\t' : String(value == null ? '' : value));
            return true;
        }

        const start = el.selectionStart != null ? el.selectionStart : String(el.value || '').length;
        const end = el.selectionEnd != null ? el.selectionEnd : start;
        const val = String(el.value || '');

        if (action === 'backspace') {
            if (start !== end) {
                if (el.setRangeText) el.setRangeText('', start, end, 'end');
                else {
                    el.value = val.slice(0, start) + val.slice(end);
                    try { el.setSelectionRange(start, start); } catch (err) {}
                }
            } else if (start > 0) {
                if (el.setRangeText) el.setRangeText('', start - 1, start, 'end');
                else {
                    el.value = val.slice(0, start - 1) + val.slice(start);
                    try { el.setSelectionRange(start - 1, start - 1); } catch (err) {}
                }
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (action === 'enter') {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        } else {
            const text = action === 'tab' ? '\t' : String(value == null ? '' : value);
            if (el.setRangeText) el.setRangeText(text, start, end, 'end');
            else {
                el.value = val.slice(0, start) + text + val.slice(end);
                try { el.setSelectionRange(start + text.length, start + text.length); } catch (err) {}
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
    }

    function nativeChar(vw, action, value) {
        if (!vw || typeof vw.sendInputEvent !== 'function') return false;
        try {
            if (action === 'backspace') {
                vw.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
                vw.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
                return true;
            }
            if (action === 'enter') {
                vw.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
                vw.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
                return true;
            }
            if (action === 'tab') {
                vw.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
                vw.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
                return true;
            }
            const text = String(value == null ? '' : value);
            for (let i = 0; i < text.length; i++) {
                vw.sendInputEvent({ type: 'char', keyCode: text[i] });
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    function watchGuest(vw) {
        if (!vw || vw.__ankaKbWatch) return;
        vw.__ankaKbWatch = true;
        const reset = () => { vw.__ankaKbReady = false; };
        ['did-start-loading', 'did-navigate', 'dom-ready'].forEach((name) => {
            try { vw.addEventListener(name, reset); } catch (err) {}
        });
    }

    function insertGuest(action, value) {
        const vw = currentGuest();
        if (!vw) return false;
        const payload = JSON.stringify(action) + ',' + JSON.stringify(value);

        try {
            const win = vw.contentWindow;
            const doc = win && win.document;
            if (doc) {
                if (typeof win.__ankaKbInsert !== 'function') {
                    const script = doc.createElement('script');
                    script.textContent = GUEST_INSTALL;
                    (doc.documentElement || doc.head || doc.body).appendChild(script);
                    script.remove();
                }
                if (typeof win.__ankaKbInsert === 'function') return !!win.__ankaKbInsert(action, value);
            }
        } catch (err) {}

        if (typeof vw.executeJavaScript === 'function') {
            const src = (vw.__ankaKbReady ? '' : GUEST_INSTALL + ';') + 'window.__ankaKbInsert&&window.__ankaKbInsert(' + payload + ')';
            try {
                const result = vw.executeJavaScript(src);
                if (result && typeof result.then === 'function') {
                    result.then((ok) => {
                        if (ok) vw.__ankaKbReady = true;
                        else nativeChar(vw, action, value);
                    }).catch(() => {
                        vw.__ankaKbReady = false;
                        nativeChar(vw, action, value);
                    });
                    return true;
                }
                if (result) {
                    vw.__ankaKbReady = true;
                    return true;
                }
            } catch (err) {}
        }

        return nativeChar(vw, action, value);
    }

    function preferHost() {
        const root = kbRoot();
        const active = document.activeElement;
        if (isEditable(active) && (!root || !root.contains(active))) return true;
        if (!lastHost || !document.contains(lastHost)) return false;
        return lastHostAt > lastGuestAt;
    }

    function applyKey(action, value) {
        if (preferHost()) {
            if (insertHost(action, value)) return;
        }
        if (insertGuest(action, value)) return;
        insertHost(action, value);
    }

    function handleCmd(cmd, btn) {
        if (cmd === 'close') {
            toggleKeyboard(false);
            return;
        }
        if (cmd === 'noop') return;
        if (cmd === 'shift') {
            shiftOn = !shiftOn;
            paintLabels();
            return;
        }
        if (cmd === 'caps') {
            capsOn = !capsOn;
            paintLabels();
            return;
        }
        if (cmd === 'backspace') applyKey('backspace');
        else if (cmd === 'enter') applyKey('enter');
        else if (cmd === 'tab') applyKey('tab');
        else if (cmd === 'space') applyKey('text', ' ');
        if (shiftOn && cmd !== 'shift' && cmd !== 'caps') {
            shiftOn = false;
            paintLabels();
        }
        void btn;
    }

    function press(btn) {
        if (!btn) return;
        const cmd = btn.dataset.cmd;
        if (cmd) handleCmd(cmd, btn);
        else {
            applyKey('text', shifted() ? btn.dataset.s : btn.dataset.n);
            if (shiftOn) {
                shiftOn = false;
                paintLabels();
            }
        }
    }

    function bindKeys() {
        const box = keysRoot();
        if (!box || box.__ankaBound) return;
        box.__ankaBound = true;

        box.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('.kb-key');
            if (!btn || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            if (pressedKey) pressedKey.classList.remove('pressed');
            pressedKey = btn;
            btn.classList.add('pressed');
            try { box.setPointerCapture(e.pointerId); } catch (err) {}
            press(btn);
        }, { passive: false });

        const release = (e) => {
            if (pressedKey) pressedKey.classList.remove('pressed');
            pressedKey = null;
            if (e && box.hasPointerCapture && box.hasPointerCapture(e.pointerId)) {
                try { box.releasePointerCapture(e.pointerId); } catch (err) {}
            }
        };

        box.addEventListener('pointerup', release);
        box.addEventListener('pointercancel', release);
        box.addEventListener('lostpointercapture', release);
    }

    function toggleKeyboard(force) {
        const kb = kbRoot();
        if (!kb) return;
        const open = force === true ? true : force === false ? false : !kb.classList.contains('open');
        kb.classList.toggle('open', open);
        const button = document.getElementById('btn-keyboard');
        if (button) button.classList.toggle('active', open);
        if (open) {
            buildKeyboard();
            bindKeys();
            const active = document.activeElement;
            if (!isEditable(active) || (kb && kb.contains(active))) rememberGuest(currentGuest());
            const vw = currentGuest();
            if (vw && typeof vw.executeJavaScript === 'function') {
                try { vw.executeJavaScript(GUEST_INSTALL).catch(function () {}); } catch (err) {}
            }
        }
    }

    window.toggleKeyboard = toggleKeyboard;

    document.addEventListener('focusin', (e) => {
        if (kbRoot() && kbRoot().contains(e.target)) return;
        rememberHost(e.target);
    }, true);

    document.addEventListener('pointerdown', (e) => {
        if (kbRoot() && kbRoot().contains(e.target)) return;
        const vw = e.target.closest && e.target.closest('webview, iframe, .browser-view, .anka-frame');
        if (vw) rememberGuest(vw);
        else rememberHost(e.target);
    }, true);

    function bindGuestFocus() {
        const box = document.getElementById('wv-container');
        if (!box || box.__ankaKbFocus) return;
        box.__ankaKbFocus = true;
        const mark = (node) => {
            const vw = node && node.closest ? (node.closest('webview, iframe') || (node.tagName === 'WEBVIEW' || node.tagName === 'IFRAME' ? node : null)) : node;
            if (vw) rememberGuest(vw);
        };
        box.addEventListener('pointerdown', (e) => mark(e.target), true);
        box.addEventListener('focus', (e) => mark(e.target), true);
        box.addEventListener('focusin', (e) => mark(e.target), true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            buildKeyboard();
            bindKeys();
            bindGuestFocus();
        });
    } else {
        buildKeyboard();
        bindKeys();
        bindGuestFocus();
    }
})();