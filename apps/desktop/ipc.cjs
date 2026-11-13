const { validLocalAccount } = require('../uni-app/lib/local-reminders.mjs');

/** 正式客户端与合成验收共用同一 IPC 入口，仅信任本地主窗口的主框架和固定区域。 */
function installDesktopIPC({ipcMain, controller, getMainWindow, notifications, files, forAccount}) {
  const visible = window => window && !window.isDestroyed?.() && window.isVisible?.()!==false && window.isMinimized?.()!==true;
  const handlers = [
    ['suixing:execute', async (args,window,client)=>{
      await notifications?.waitForRead?.();
      if(args.command?.type==='readList' && args.command.reload===true)return client.execute(args.command,args.region,()=>visible(window));
      return client.execute(args.command,args.region);
    }],
    ['suixing:open-site', async (args,window,client)=>{
      if (args.login !== true) return client.openSite(args.region);
      const result = await client.openLogin(args.region);
      if (result.ok && visible(window)) window.focus?.();
      return result;
    }],
    ['suixing:reload-site', (args,_window,client)=>client.reloadSite(args.region)],
    ['suixing:prepare-summary', async (args,_window,client)=>{await notifications?.waitForRead?.();return client.prepareSummary(args.region);}],
    ['suixing:read-navigation', (args,_window,client)=>client.readNavigation(args.region)],
    ['suixing:forget-account', async (args,_window,client)=>{await notifications?.waitForRead?.();return client.forget(args.region);}],
    ['suixing:reconnect-site', (args,_window,client)=>client.reconnectSite(args.region)],
    ['suixing:connection-state', (args,_window,client)=>client.connectionState(args.region)],
    ['suixing:notifications-state', ()=>notifications?.state() || {ok:true,supported:false,enabled:false,allDayTime:'09:00',phase:'off'}],
    ['suixing:notifications-configure', args=>notifications?.configure(args) || {ok:false,code:'NOTIFICATION_UNSUPPORTED'}],
    ['suixing:notifications-context', args=>notifications?.context(args) || {ok:false,code:'NOTIFICATION_UNSUPPORTED'}],
    ['suixing:notifications-test', ()=>notifications?.test() || {ok:false,code:'NOTIFICATION_UNSUPPORTED'}],
    ['suixing:local-read', async ({key})=>files ? files.read(key) : null],
    ['suixing:local-write', async ({key,value})=>{ if (!files) throw Error('本地快照不可用'); await files.write(key,value); }],
    ['suixing:local-remove', async ({key})=>{ if (!files) throw Error('本地快照不可用'); await files.remove(key); }],
    ['suixing:local-capabilities', ()=>({ storage:!!files, multiple:!!forAccount && !!files })]
  ];
  for (const [channel,handler] of handlers) {
    ipcMain.handle(channel,(event,args)=>{
      const window=getMainWindow();
      if (!window || window.isDestroyed?.() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
          !args || !['cn','global'].includes(args.region)) return {ok:false,code:'INVALID_REQUEST',message:'请求来源或区域无效。'};
      // 关闭节流的验证窗口可能仍报告网页可见，后台读取须以原生窗口状态兜底。
      if(channel==='suixing:execute' && args.command?.type==='readList' && args.command.background===true &&
          !visible(window))return {ok:false,code:'AUTO_READ_DEFERRED',reason:'window-hidden'};
      const account = {id:args.accountId,region:args.region};
      if (args.accountId !== undefined && (!forAccount || !validLocalAccount(account))) return {ok:false,code:'INVALID_REQUEST'};
      return handler(args,window,args.accountId === undefined ? controller : forAccount(account));
    });
  }
  return ()=>handlers.forEach(([channel])=>ipcMain.removeHandler(channel));
}

module.exports = {installDesktopIPC};
