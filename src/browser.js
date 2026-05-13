let activeTabId = null;

function createNewTab(url = 'https://www.google.com') {
    const id = 'tab-' + Date.now();
    
    // Sekme Butonu Oluşturma
    const tab = document.createElement('div');
    tab.className = 'tab'; 
    tab.id = 'btn-' + id;
    tab.innerHTML = `
        <img src="assets/icons/globe.png" class="tab-icon" onerror="this.src='https://www.google.com/favicon.ico'">
        <span class="tab-title">Yeni Sekme</span>
        <div class="close-tab" onclick="closeTab('${id}', event)">×</div>
    `;
    tab.onclick = () => switchTab(id);
    document.getElementById('tab-bar').appendChild(tab);

    // Webview Oluşturma
    const vw = document.createElement('webview');
    vw.id = id; 
    vw.src = url; 
    vw.setAttribute('allowpopups', '');
    vw.className = 'browser-view';
    document.getElementById('wv-container').appendChild(vw);

    // Yükleme Olayları
    vw.addEventListener('did-start-loading', () => {
        tab.querySelector('.tab-title').innerText = "Yükleniyor...";
    });

    vw.addEventListener('did-stop-loading', () => {
        const title = vw.getTitle();
        tab.querySelector('.tab-title').innerText = title.substring(0, 15) + (title.length > 15 ? '...' : '');
        if(id === activeTabId) {
            document.getElementById('url-input').value = vw.getURL();
        }
    });

    switchTab(id);
}

function switchTab(id) {
    document.querySelectorAll('webview, .tab').forEach(el => el.classList.remove('active'));
    
    const targetVw = document.getElementById(id);
    const targetBtn = document.getElementById('btn-' + id);
    
    if(targetVw && targetBtn) {
        targetVw.classList.add('active');
        targetBtn.classList.add('active');
        activeTabId = id;
        document.getElementById('url-input').value = targetVw.getURL();
    }
}

function closeTab(id, e) {
    if(e) e.stopPropagation();
    const tabBtn = document.getElementById('btn-' + id);
    const tabVw = document.getElementById(id);
    
    if(tabBtn) tabBtn.remove();
    if(tabVw) tabVw.remove();

    if(activeTabId === id) {
        const nextVw = document.querySelector('webview');
        if(nextVw) {
            switchTab(nextVw.id);
        } else {
            createNewTab();
        }
    }
}

// URL Çubuğu Enter Kontrolü
document.getElementById('url-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        let val = e.target.value;
        if (!val.startsWith('http')) val = 'https://www.google.com/search?q=' + val;
        document.getElementById(activeTabId).src = val;
        e.target.blur(); // Odaktan çık
    }
});