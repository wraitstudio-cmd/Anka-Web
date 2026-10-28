let isSplitMode = false;

function toggleSplitScreen() {
    const container = document.getElementById('wv-container');
    const allWebviews = Array.from(document.querySelectorAll('webview'));

    if (!isSplitMode) {
        if (allWebviews.length < 2) return;
        isSplitMode = true;
        container.classList.add('split-mode');

        const activeWv = document.querySelector('webview.active') || allWebviews[allWebviews.length - 1];
        const activeIndex = allWebviews.indexOf(activeWv);

        let secondWv;
        if (activeIndex > 0) {
            secondWv = allWebviews[activeIndex - 1];
        } else {
            secondWv = allWebviews[activeIndex + 1];
        }

        allWebviews.forEach(wv => {
            if (wv === activeWv || wv === secondWv) {
                wv.style.display = 'inline-flex';
                wv.style.width = '50%';
                wv.style.height = '100%';
                wv.classList.add('active');
            } else {
                wv.style.display = 'none';
                wv.classList.remove('active');
            }
        });
    } else {
        isSplitMode = false;
        container.classList.remove('split-mode');
        
        allWebviews.forEach(wv => {
            wv.style.display = 'none';
            wv.style.width = '100%';
            wv.style.height = '100%';
            wv.classList.remove('active');
        });

        if (typeof activeTabId !== 'undefined' && typeof switchTab === 'function') {
            switchTab(activeTabId);
        } else if (allWebviews.length > 0) {
            const targetWv = document.querySelector(`webview[data-id="${activeTabId}"]`) || allWebviews[allWebviews.length - 1];
            targetWv.style.display = 'inline-flex';
            targetWv.classList.add('active');
        }
    }
}