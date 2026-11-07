const { contextBridge, ipcRenderer } = require('electron');

// 只有本地应用界面加载此预载脚本。iCloud 网页没有 IPC、Node 或本地文件权限。
contextBridge.exposeInMainWorld('suixingDesktop', {
  platform: 'Windows',
  capabilities: { editText: true, editSchedule: true, editFlag: true, deleteItem: true, manageLists: true, deleteList:true, listAppearance:true, editHierarchy:true, openNewItem: true, createItem: true, showCompleted: true, reconnect: true, loadedListRefresh: true, localNotifications:true },
  execute: (command, region) => ipcRenderer.invoke('suixing:execute', { command, region }),
  readSummary: (pageId, listId, region) => ipcRenderer.invoke('suixing:execute', { command:{type:'readSummary',pageId,listId}, region }),
  openSite: region => ipcRenderer.invoke('suixing:open-site', { region }),
  openLogin: region => ipcRenderer.invoke('suixing:open-site', { region, login:true }),
  reloadSite: region => ipcRenderer.invoke('suixing:reload-site', { region }),
  reconnectSite: region => ipcRenderer.invoke('suixing:reconnect-site', { region }),
  connectionState: region => ipcRenderer.invoke('suixing:connection-state', { region }),
  notificationsState: region=>ipcRenderer.invoke('suixing:notifications-state',{region}),
  configureNotifications:(value,region)=>ipcRenderer.invoke('suixing:notifications-configure',{...value,region}),
  notificationsContext:value=>ipcRenderer.invoke('suixing:notifications-context',value),
  testNotification:region=>ipcRenderer.invoke('suixing:notifications-test',{region}),
  onNotifications:callback=>{const listener=(_event,payload)=>callback(payload);ipcRenderer.on('suixing:notifications-state',listener);return ()=>ipcRenderer.removeListener('suixing:notifications-state',listener);},
  onSnapshot: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('suixing:snapshot', listener);
    return () => ipcRenderer.removeListener('suixing:snapshot', listener);
  }
});
