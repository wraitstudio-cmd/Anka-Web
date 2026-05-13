const axios = require('axios');
const yaml = require('js-yaml');
const { ipcMain, shell } = require('electron');

const CURRENT_VERSION = "2.1.0"; 
const UPDATE_CONFIG_URL = "https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/latest.yml";

async function checkUpdates(mainWindow) {
    try {
        const response = await axios.get(UPDATE_CONFIG_URL);
        const data = yaml.load(response.data);

        if (data.version !== CURRENT_VERSION) {
            mainWindow.webContents.send('update-available', data);
        }
    } catch (error) {
        console.error("Güncelleme kontrolü sırasında hata oluştu:", error);
    }
}

module.exports = { checkUpdates };