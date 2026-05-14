const { ipcMain, net, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CURRENT_VERSION = "2.3.0"; 

function checkUpdates(win) {
    const request = net.request('https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/main/latest.yml');
    
    request.on('error', (err) => {
        console.error("Bağlantı hatası:", err.message);
    });

    request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
            try {
                const lines = data.split('\n').filter(line => line.trim() !== '');
                const latestVersion = lines[0].split(': ')[1].replace(/"/g, '').trim();
                const downloadUrl = lines[2].split(': ')[1].replace(/"/g, '').trim();

                if (latestVersion !== CURRENT_VERSION) {
                    win.webContents.send('update-available', { 
                        version: latestVersion, 
                        url: downloadUrl 
                    });
                }
            } catch (e) {
                console.error("YAML okuma hatası:", e);
            }
        });
    });
    request.end();
}

ipcMain.on('start-download', (event, url) => {
    const filePath = path.join(app.getPath('temp'), 'anka-setup.exe');
    
    if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
    }

    const file = fs.createWriteStream(filePath);
    const request = net.request(url);

    request.on('error', (err) => {
        event.sender.send('download-error', err.message);
    });

    request.on('response', (response) => {
        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;

        if (response.statusCode !== 200) {
            event.sender.send('download-error', `Sunucu hatası: ${response.statusCode}`);
            return;
        }

        response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            file.write(chunk);
            
            if (totalBytes > 0) {
                const progress = Math.round((downloadedBytes / totalBytes) * 100);
                event.sender.send('download-progress', progress);
            }
        });

        response.on('end', () => {
            file.end();
            event.sender.send('download-complete');
            
            setTimeout(() => {
                const installCmd = process.platform === 'win32' ? `"${filePath}" /S` : `open "${filePath}"`;
                
                exec(installCmd, (err) => {
                    if (!err) {
                        app.isQuitting = true;
                        setTimeout(() => app.quit(), 500);
                    } else {
                        event.sender.send('download-error', "Kurulum başlatılamadı.");
                    }
                });
            }, 1500);
        });
    });
    request.end();
});

module.exports = { checkUpdates };