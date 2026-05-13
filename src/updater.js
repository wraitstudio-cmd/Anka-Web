const { ipcMain, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CURRENT_VERSION = "2.1.0"; 

function checkUpdates(win) {
    const request = net.request('https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/latest.yml');
    
    request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
            const lines = data.split('\n');
            const latestVersion = lines[0].split(': ')[1].replace(/"/g, '').trim();
            const downloadUrl = lines[2].split(': ')[1].trim();

            if (latestVersion !== CURRENT_VERSION) {
                win.webContents.send('update-available', { 
                    version: latestVersion, 
                    url: downloadUrl 
                });
            }
        });
    });
    request.end();
}

ipcMain.on('start-download', (event, url) => {
    const filePath = path.join(process.env.TEMP, 'anka-setup.exe');
    const file = fs.createWriteStream(filePath);

    const request = net.request(url);
    request.on('response', (response) => {
        response.on('data', (chunk) => {
            file.write(chunk);
        });
        response.on('end', () => {
            file.end();
            exec(`"${filePath}" /S`, (err) => {
                if (!err) app.quit();
            });
        });
    });
    request.end();
});

module.exports = { checkUpdates };