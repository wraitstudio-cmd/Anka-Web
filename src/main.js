const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { checkUpdates } = require('./updater');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Anka Web - V1.0.0",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      enableRemoteModule: true
    }
  });

win.loadFile(path.join(__dirname, '../index.html'));

win.webContents.once('did-finish-load', () => {
    checkUpdates(win);
});

  const filter = {
    urls: [
      "*://www.google.com/*",
      "*://www.youtube.com/*",
      "*://*.google.com.tr/*"
    ]
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (details.url.includes("google.com")) {
      details.requestHeaders['X-SafeSearch'] = 'active';
    }
    
    if (details.url.includes("youtube.com")) {
      details.requestHeaders['YouTube-Restrict'] = 'Strict';
    }

    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  const forbiddenKeywords = ['yasaklısite1.com', 'kumar', 'bahis', 'poker', "memz"]; 
  
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url.toLowerCase();
    const isForbidden = forbiddenKeywords.some(keyword => url.includes(keyword));
    
    if (isForbidden) {
      console.log("Engellendi:", url);
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  win.loadFile(path.join(__dirname, '../index.html'));
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});