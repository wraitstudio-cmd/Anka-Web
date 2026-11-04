let splitScreenCount = 0;

function splitScreenViews(count, quiet) {
    const container = document.getElementById('wv-container');
    const views = Array.from(container ? container.querySelectorAll('webview') : []);
    if (!container) return;
    if (count > 0 && views.length < count) {
        if (!quiet && typeof showToast === 'function') showToast('Bu görünüm için en az ' + count + ' açık sekme gerekli.');
        return;
    }

    splitScreenCount = count;
    container.classList.toggle('split-mode', count > 0);
    container.classList.toggle('grid-four', count === 4);
    const splitButton = document.getElementById('btn-split');
    const gridButton = document.getElementById('btn-grid');
    if (splitButton) {
        splitButton.classList.toggle('active', count === 2);
        splitButton.setAttribute('aria-pressed', String(count === 2));
    }
    if (gridButton) {
        gridButton.classList.toggle('active', count === 4);
        gridButton.setAttribute('aria-pressed', String(count === 4));
    }
    if (count === 4) {
        let style = document.getElementById('anka-four-grid-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'anka-four-grid-style';
            style.textContent = '#wv-container.split-mode.grid-four{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:1px!important;padding:0!important}#wv-container.split-mode.grid-four webview{width:100%!important;height:100%!important;min-width:0;min-height:0;border:0!important}';
            document.head.appendChild(style);
        }
    }

    if (count === 0) {
        views.forEach((view) => {
            view.style.display = 'none';
            view.style.width = '100%';
            view.style.height = '100%';
            view.classList.remove('active');
            view.classList.remove('split-visible');
        });
        if (typeof activeTabId !== 'undefined' && typeof switchTab === 'function' && activeTabId) switchTab(activeTabId);
        return;
    }

    const active = document.getElementById(activeTabId) || document.querySelector('webview.active');
    const ordered = active ? [active, ...views.filter((view) => view !== active)] : views;
    const visible = new Set(ordered.slice(0, count));
    views.forEach((view) => {
        const shown = visible.has(view);
        view.style.display = shown ? 'block' : 'none';
        view.style.width = count === 2 ? '50%' : '100%';
        view.style.height = count === 2 ? '100%' : '100%';
        view.classList.toggle('active', shown);
        view.classList.toggle('split-visible', shown);
    });
}

function toggleSplitScreen() {
    splitScreenViews(splitScreenCount === 2 ? 0 : 2);
}

function toggleGridView() {
    splitScreenViews(splitScreenCount === 4 ? 0 : 4);
}

window.__toggleSplitScreen = toggleSplitScreen;
window.__toggleGridView = toggleGridView;
window.__ankaUpdateSplitView = () => {
    if (splitScreenCount) splitScreenViews(splitScreenCount, true);
};
