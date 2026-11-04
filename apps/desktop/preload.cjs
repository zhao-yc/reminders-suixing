const { contextBridge, ipcRenderer } = require('electron');

// 只有本地应用界面加载此预载脚本。iCloud 网页没有 IPC、Node 或本地文件权限。
contextBridge.exposeInMainWorld('suixingDesktop', {
  platform: 'Windows',
  capabilities: { editText: true, openNewItem: true, createItem: true, showCompleted: true },
  execute: (command, region) => ipcRenderer.invoke('suixing:execute', { command, region }),
  openSite: region => ipcRenderer.invoke('suixing:open-site', { region }),
  reloadSite: region => ipcRenderer.invoke('suixing:reload-site', { region }),
  onSnapshot: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('suixing:snapshot', listener);
    return () => ipcRenderer.removeListener('suixing:snapshot', listener);
  }
});
