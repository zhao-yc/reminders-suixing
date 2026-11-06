/** 正式客户端与合成验收共用同一 IPC 入口，仅信任本地主窗口的主框架和固定区域。 */
function installDesktopIPC({ipcMain, controller, getMainWindow, notifications}) {
  const visible = window => window && !window.isDestroyed?.() && window.isVisible?.()!==false && window.isMinimized?.()!==true;
  const handlers = [
    ['suixing:execute', async (args,window)=>{
      await notifications?.waitForRead?.();
      if(args.command?.type==='readList' && args.command.reload===true)return controller.execute(args.command,args.region,()=>visible(window));
      return controller.execute(args.command,args.region);
    }],
    ['suixing:open-site', args=>controller.openSite(args.region)],
    ['suixing:reload-site', args=>controller.reloadSite(args.region)],
    ['suixing:reconnect-site', args=>controller.reconnectSite(args.region)],
    ['suixing:connection-state', args=>controller.connectionState(args.region)],
    ['suixing:notifications-state', ()=>notifications?.state() || {ok:true,supported:false,enabled:false,allDayTime:'09:00',phase:'off'}],
    ['suixing:notifications-configure', args=>notifications?.configure(args) || {ok:false,code:'NOTIFICATION_UNSUPPORTED'}],
    ['suixing:notifications-context', args=>notifications?.context(args) || {ok:false,code:'NOTIFICATION_UNSUPPORTED'}],
    ['suixing:notifications-test', ()=>notifications?.test() || {ok:false,code:'NOTIFICATION_UNSUPPORTED'}]
  ];
  for (const [channel,handler] of handlers) {
    ipcMain.handle(channel,(event,args)=>{
      const window=getMainWindow();
      if (!window || window.isDestroyed?.() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
          !args || !['cn','global'].includes(args.region)) return {ok:false,code:'INVALID_REQUEST',message:'请求来源或区域无效。'};
      // 关闭节流的验证窗口可能仍报告网页可见，后台读取须以原生窗口状态兜底。
      if(channel==='suixing:execute' && args.command?.type==='readList' && args.command.background===true &&
          !visible(window))return {ok:false,code:'AUTO_READ_DEFERRED',reason:'window-hidden'};
      return handler(args,window);
    });
  }
  return ()=>handlers.forEach(([channel])=>ipcMain.removeHandler(channel));
}

module.exports = {installDesktopIPC};
