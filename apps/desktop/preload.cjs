const { contextBridge, ipcRenderer } = require('electron');

// 只有本地应用界面加载此预载脚本。iCloud 网页没有 IPC、Node 或本地文件权限。
contextBridge.exposeInMainWorld('suixingDesktop', {
  platform: 'Windows',
  capabilities: { editText: true, editSchedule: true, editFlag: true, deleteItem: true, manageLists: true, deleteList:true, listAppearance:true, createListAppearance:true, editHierarchy:true, openNewItem: true, createItem: true, showCompleted: true, reconnect: true, loadedListRefresh: true, localNotifications:true },
  execute: (command, region, accountId) => ipcRenderer.invoke('suixing:execute', { command, region, accountId }),
  readSummary: (pageId, listId, region, accountId) => ipcRenderer.invoke('suixing:execute', { command:{type:'readSummary',pageId,listId}, region, accountId }),
  openSite: (region,accountId) => ipcRenderer.invoke('suixing:open-site', { region, accountId }),
  openLogin: (region,accountId) => ipcRenderer.invoke('suixing:open-site', { region, accountId, login:true }),
  reloadSite: (region,accountId) => ipcRenderer.invoke('suixing:reload-site', { region, accountId }),
  prepareSummary: (region,accountId) => ipcRenderer.invoke('suixing:prepare-summary', { region, accountId }),
  readNavigation: (region,accountId) => ipcRenderer.invoke('suixing:read-navigation', { region, accountId }),
  forgetAccount: (region,accountId) => ipcRenderer.invoke('suixing:forget-account', { region, accountId }),
  reconnectSite: (region,accountId) => ipcRenderer.invoke('suixing:reconnect-site', { region, accountId }),
  connectionState: (region,accountId) => ipcRenderer.invoke('suixing:connection-state', { region, accountId }),
  localCapabilities: () => ipcRenderer.invoke('suixing:local-capabilities',{region:'cn'}),
  localFiles: {
    read: key => ipcRenderer.invoke('suixing:local-read',{region:'cn',key}),
    write: (key,value) => ipcRenderer.invoke('suixing:local-write',{region:'cn',key,value}),
    remove: key => ipcRenderer.invoke('suixing:local-remove',{region:'cn',key})
  },
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
