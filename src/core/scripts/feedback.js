(function () {
    const style = document.createElement('style');
    style.textContent = `
        #anka-feedback-stack { position:fixed; top:16px; left:50%; z-index:3000000; display:grid; gap:8px; width:min(420px, calc(100vw - 28px)); transform:translateX(-50%); pointer-events:none; }
        .anka-feedback-toast { display:grid; grid-template-columns:10px minmax(0,1fr) 32px; align-items:center; gap:12px; min-height:52px; padding:10px 12px; color:var(--text-color, var(--text, #f4f4f5)); background:var(--bg-secondary, var(--panel, #18181b)); border:1px solid var(--border-color, var(--border, #35353b)); border-left:3px solid var(--accent, #ff4757); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.28); opacity:0; transform:translateY(-8px); transition:opacity .16s ease, transform .16s ease; pointer-events:auto; }
        .anka-feedback-toast.show { opacity:1; transform:none; }
        .anka-feedback-toast.error { border-left-color:#dc4c4c; }
        .anka-feedback-toast.success { border-left-color:#23885d; }
        .anka-feedback-dot { width:8px; height:8px; border-radius:50%; background:var(--accent, #ff4757); }
        .anka-feedback-toast.error .anka-feedback-dot { background:#dc4c4c; }
        .anka-feedback-toast.success .anka-feedback-dot { background:#23885d; }
        .anka-feedback-message { min-width:0; overflow-wrap:anywhere; font:500 13px/1.45 var(--font, system-ui, sans-serif); }
        .anka-feedback-close { width:32px; height:32px; border:0; border-radius:7px; background:transparent; color:var(--text-secondary, #a1a1aa); font:inherit; font-size:18px; cursor:pointer; }
        .anka-feedback-close:hover { background:var(--bg-tertiary, var(--hover, #27272a)); color:var(--text-color, var(--text, #f4f4f5)); }
        #anka-dialog-layer { position:fixed; inset:0; z-index:3000001; display:grid; place-items:center; padding:16px; background:rgba(0,0,0,.52); backdrop-filter:blur(4px); }
        #anka-dialog { width:min(440px, 100%); max-height:min(85vh, 620px); overflow:auto; padding:22px; color:var(--text-color, var(--text, #f4f4f5)); background:var(--bg-secondary, var(--panel, #18181b)); border:1px solid var(--border-color, var(--border, #35353b)); border-radius:12px; box-shadow:0 24px 70px rgba(0,0,0,.36); font-family:var(--font, system-ui, sans-serif); }
        #anka-dialog h2 { margin:0 0 10px; font-size:18px; line-height:1.3; }
        #anka-dialog p { margin:0; color:var(--text-secondary, #a1a1aa); font-size:13px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
        #anka-dialog-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:22px; }
        #anka-dialog-actions button { min-width:92px; min-height:42px; padding:0 14px; border:1px solid var(--border-color, var(--border, #35353b)); border-radius:8px; color:var(--text-color, var(--text, #f4f4f5)); background:var(--bg-tertiary, var(--hover, #27272a)); font:600 13px var(--font, system-ui, sans-serif); cursor:pointer; touch-action:manipulation; }
        #anka-dialog-actions button.primary { border-color:var(--accent, #ff4757); color:#fff; background:var(--accent, #ff4757); }
        #anka-dialog-actions button.danger { border-color:#b93636; background:#b93636; }
        #anka-dialog-actions button:focus-visible, .anka-feedback-close:focus-visible { outline:2px solid var(--accent, #ff4757); outline-offset:2px; }
        @media (max-width:480px) { #anka-dialog { padding:18px; } #anka-dialog-actions { display:grid; grid-template-columns:1fr 1fr; } #anka-dialog-actions button { min-width:0; } }
        @media (prefers-reduced-motion:reduce) { .anka-feedback-toast { transition:none; } }
    `;
    document.head.appendChild(style);

    let dialogQueue = Promise.resolve();

    function notificationsEnabled() {
        try {
            return localStorage.getItem('set_notifications') !== 'false';
        } catch (err) {
            return true;
        }
    }

    window.showToast = function (message, type = 'info') {
        if (type !== 'error' && !notificationsEnabled()) return;
        let stack = document.getElementById('anka-feedback-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'anka-feedback-stack';
            stack.setAttribute('aria-live', 'polite');
            stack.setAttribute('aria-relevant', 'additions');
            document.body.appendChild(stack);
        }
        while (stack.children.length >= 4) stack.firstElementChild.remove();
        const toast = document.createElement('div');
        toast.className = 'anka-feedback-toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        const dot = document.createElement('span');
        dot.className = 'anka-feedback-dot';
        dot.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'anka-feedback-message';
        text.textContent = String(message ?? '');
        const close = document.createElement('button');
        close.className = 'anka-feedback-close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Bildirimi kapat');
        close.textContent = '×';
        const dismiss = () => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 180);
        };
        close.addEventListener('click', dismiss);
        toast.append(dot, text, close);
        stack.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(dismiss, type === 'error' ? 6000 : 3600);
    };

    window.ankaConfirm = function (message, options = {}) {
        const run = () => new Promise((resolve) => {
            const layer = document.createElement('div');
            layer.id = 'anka-dialog-layer';
            const dialog = document.createElement('section');
            dialog.id = 'anka-dialog';
            dialog.setAttribute('role', 'alertdialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', 'anka-dialog-title');
            dialog.setAttribute('aria-describedby', 'anka-dialog-message');
            const title = document.createElement('h2');
            title.id = 'anka-dialog-title';
            title.textContent = options.title || 'Onay gerekiyor';
            const body = document.createElement('p');
            body.id = 'anka-dialog-message';
            body.textContent = String(message ?? '');
            const actions = document.createElement('div');
            actions.id = 'anka-dialog-actions';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = options.cancelText || 'Vazgeç';
            const accept = document.createElement('button');
            accept.type = 'button';
            accept.className = options.danger ? 'danger' : 'primary';
            accept.textContent = options.confirmText || 'Onayla';
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                layer.remove();
                resolve(value);
            };
            const onKey = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    finish(false);
                } else if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
                    event.preventDefault();
                    finish(true);
                }
            };
            cancel.addEventListener('click', () => finish(false));
            accept.addEventListener('click', () => finish(true));
            layer.addEventListener('pointerdown', (event) => {
                if (event.target === layer) finish(false);
            });
            actions.append(cancel, accept);
            dialog.append(title, body, actions);
            layer.appendChild(dialog);
            document.body.appendChild(layer);
            document.addEventListener('keydown', onKey, true);
        });
        const result = dialogQueue.then(run, run);
        dialogQueue = result.then(() => undefined, () => undefined);
        return result;
    };
})();