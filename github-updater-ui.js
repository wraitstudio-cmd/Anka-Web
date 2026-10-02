module.exports = {
    init: function(win, currentVersion) {
        const updatePanelHtml = `
            <div id="anka-update-modal" style="
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center;
                align-items: center; z-index: 999999; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            ">
                <div style="
                    background: #1e1e1e; color: #ffffff; padding: 25px; border-radius: 12px;
                    width: 350px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); text-align: center;
                    border: 1px solid #333;
                ">
                    <h3 style="margin-top: 0; color: #4CAF50;">🚀 Yeni Güncelleme Var!</h3>
                    <p id="anka-update-text" style="font-size: 14px; color: #ccc; margin: 15px 0;">Anka Web için yeni bir sürüm yayınlandı.</p>
                    <div style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
                        <button id="anka-update-btn" style="
                            background: #4CAF50; color: white; border: none; padding: 10px 18px;
                            border-radius: 6px; cursor: pointer; font-weight: bold;
                        ">İndir ve Kur</button>
                        <button id="anka-close-btn" style="
                            background: #555; color: white; border: none; padding: 10px 18px;
                            border-radius: 6px; cursor: pointer;
                        ">İptal</button>
                    </div>
                </div>
            </div>
        `;

        if (win && win.webContents) {
            win.webContents.on('dom-ready', () => {
                win.webContents.executeJavaScript(`
                    if (!document.getElementById('anka-update-modal')) {
                        const div = document.createElement('div');
                        div.innerHTML = \`${updatePanelHtml}\`;
                        document.body.appendChild(div);
                        
                        // Örnek buton olayları
                        document.getElementById('anka-close-btn').addEventListener('click', () => {
                            document.getElementById('anka-update-modal').style.display = 'none';
                        });
                    }
                `).catch(err => console.log(err));
            });
        }
    }
};
