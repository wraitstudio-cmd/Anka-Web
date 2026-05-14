const { ipcMain, net, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CURRENT_VERSION = "2.1.0"; 

function checkUpdates(win) {
    const request = net.request('https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/main/latest.yml');
    request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
            try {
                const lines = data.split('\n');
                const latestVersion = lines[0].split(': ')[1].replace(/"/g, '').trim();
                const downloadUrl = lines[2].split(': ')[1].replace(/"/g, '').trim();

                if (latestVersion !== CURRENT_VERSION) {
                    win.webContents.send('update-available', { version: latestVersion, url: downloadUrl });
                }
            } catch (e) {}
        });
    });
    request.end();
}

ipcMain.on('start-download', (event, url) => {
    const filePath = path.join(app.getPath('temp'), 'anka-setup.exe');
    const file = fs.createWriteStream(filePath);

    const request = net.request(url);
    request.on('response', (response) => {
        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            file.write(chunk);
            // Arayüze yüzde gönder
            const progress = Math.round((downloadedBytes / totalBytes) * 100);
            event.sender.send('download-progress', progress);
        });

        response.on('end', () => {
            file.end();
            event.sender.send('download-complete');
            
            // 1 saniye bekle ve kur
            setTimeout(() => {
                // /S = Silent (Sessiz) kurulum
                exec(`"${filePath}" /S`, (err) => {
                    if (!err) {
                        app.isQuitting = true;
                        app.quit(); 
                    }
                });
            }, 1000);
        });
    });
    request.end();
});

module.exports = { checkUpdates };