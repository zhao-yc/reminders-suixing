/** 正式客户端与合成验收共用同一 IPC 入口，仅信任本地主窗口的主框架和固定区域。 */
function installDesktopIPC({ipcMain, controller, getMainWindow}) {
  const handlers = [
    ['suixing:execute', args=>controller.execute(args.command,args.region)],
    ['suixing:open-site', args=>controller.openSite(args.region)],
    ['suixing:reload-site', args=>controller.reloadSite(args.region)]
  ];
  for (const [channel,handler] of handlers) {
    ipcMain.handle(channel,(event,args)=>{
      const window=getMainWindow();
      if (!window || window.isDestroyed?.() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
          !args || !['cn','global'].includes(args.region)) return {ok:false,code:'INVALID_REQUEST',message:'请求来源或区域无效。'};
      return handler(args);
    });
  }
  return ()=>handlers.forEach(([channel])=>ipcMain.removeHandler(channel));
}

module.exports = {installDesktopIPC};
