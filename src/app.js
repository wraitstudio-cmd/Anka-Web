window.onload = () => {
    // 1. Önce tarayıcıyı başlat
    if(typeof createNewTab === "function") {
        createNewTab('https://www.eba.gov.tr');
    }

    // 2. Çizim katmanını temizle ve şeffaf yap
    const layer = document.getElementById('draw-layer');
    layer.style.pointerEvents = 'none'; // Siteye dokunmayı engelleme
    
    // 3. Kalem menüsünün kapalı olduğundan emin ol
    document.getElementById('paint-menu').style.display = 'none';
};