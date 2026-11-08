const { contextBridge, ipcRenderer } = require('electron');

try {
    const url = new URL(location.href);
    if (url.protocol === 'file:' &&
        url.pathname.endsWith('/src/renderer/newtab.html') &&
        url.searchParams.get('incognito') !== '1') {
        contextBridge.exposeInMainWorld('ankaSettingsBridge', {
            load: () => ipcRenderer.invoke('load-app-state'),
            save: (id, val) => ipcRenderer.invoke('save-app-setting:commit', { id, val })
        });
    }
} catch (err) {
    console.error('New-tab settings bridge could not be initialized:', err);
}
