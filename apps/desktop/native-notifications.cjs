const fs=require('node:fs');
const path=require('node:path');
const {createReminderNotifications,validClock}=require('./reminder-notifications.cjs');
const {APP_NAME}=require('./identity.cjs');

/** 只用固定通知文案；不把个人标题、备注或日期写进系统通知中心。 */
function createNativeNotifications({Notification,Tray,Menu,nativeImage,controller,window,settingsPath,quit,changed=()=>{},scheduling={}}) {
  let tray=null,disposed=false,configuring=false,currentRead=null;
  const active=new Set(),supported=Notification.isSupported();
  const focus=()=>{if(window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();};
  let preferences={enabled:false,allDayTime:'09:00'};
  try {const value=JSON.parse(fs.readFileSync(settingsPath,'utf8'));if(typeof value.enabled==='boolean' && validClock(value.allDayTime))preferences={enabled:value.enabled,allDayTime:value.allDayTime};}catch{}
  function show(count,test=false) {
    if(!supported || disposed)return Promise.resolve({ok:false,code:'NOTIFICATION_UNSUPPORTED'});
    return new Promise(resolve=>{
      let settled=false,timer;
      const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve({ok,code:ok?'NOTIFICATION_SHOWN':'NOTIFICATION_UNCONFIRMED'});};
      let notification;
      try {
        notification=new Notification({title:APP_NAME,body:test?'随行验证 · 这是一条系统通知测试。':'有 '+count+' 项提醒事项已到时间，打开随行查看。',timeoutType:'default'});
        active.add(notification);notification.on('show',()=>finish(true));notification.on('failed',()=>finish(false));
        notification.on('click',focus);notification.on('close',()=>active.delete(notification));
        timer=setTimeout(()=>finish(false),5000);notification.show();
      } catch {if(notification)active.delete(notification);finish(false);}
    });
  }
  const publish=value=>{if(tray)tray.setToolTip(APP_NAME+(value.phase==='ready'?' · 通知已开启':' · 通知暂缓'));changed({ok:true,supported,...value});};
  const scheduler=createReminderNotifications({read:async(command,region,accountId)=>{
    const client = accountId ? controller.accountController?.({id:accountId,region}) : controller;
    const task=client?.execute(command,region);currentRead=task;
    try{return await task;}finally{if(currentRead===task)currentRead=null;}
  },show:count=>show(count),changed:publish,now:scheduling.now,localZone:scheduling.localZone,setInterval:scheduling.setInterval,clearInterval:scheduling.clearInterval});
  function destroyTray(restore) {if(!tray)return;if(restore && !window.isVisible())focus();tray.destroy();tray=null;}
  function ensureTray() {
    if(tray)return;
    const icon=nativeImage.createFromPath(path.join(__dirname,'assets/tray.png'));
    if(icon.isEmpty())throw Error('TRAY_UNAVAILABLE');
    tray=new Tray(icon);tray.setToolTip(APP_NAME);tray.on('double-click',focus);
    tray.setContextMenu(Menu.buildFromTemplate([{label:'打开随行',click:focus},{label:'关闭通知并停止后台运行',click:()=>configure({enabled:false,allDayTime:preferences.allDayTime})},{type:'separator'},{label:'退出随行',click:quit}]));
  }
  function configure(value) {
    if(configuring || typeof value?.enabled!=='boolean' || !validClock(value.allDayTime))return {ok:false,code:'INVALID_REQUEST'};
    if(value.enabled && !supported)return {ok:false,code:'NOTIFICATION_UNSUPPORTED'};
    configuring=true;
    try {
      if(value.enabled)ensureTray();
      const next={enabled:value.enabled,allDayTime:value.allDayTime};
      fs.mkdirSync(path.dirname(settingsPath),{recursive:true});fs.writeFileSync(settingsPath,JSON.stringify(next));preferences=next;
      if(!next.enabled){destroyTray(true);for(const note of active)note.close();active.clear();}
      return {...scheduler.configure(next),supported};
    } catch {if(!scheduler.state().enabled)destroyTray(false);return {ok:false,code:'NOTIFICATION_SETTINGS_FAILED'};}
    finally {configuring=false;}
  }
  if(preferences.enabled && supported) {try{ensureTray();}catch{preferences.enabled=false;}}
  scheduler.configure({...preferences,enabled:preferences.enabled && !!tray});
  return {state:()=>({ok:true,supported,...scheduler.state()}),configure,context:args=>scheduler.updateContext(args),test:()=>show(0,true),waitForRead:async()=>{try{await currentRead;}catch{}},
    hideOnClose:()=>scheduler.state().enabled && !!tray,
    dispose(){disposed=true;scheduler.stop();destroyTray(false);for(const note of active)note.close();active.clear();}};
}
function bindNotificationClose(window,notifications,isQuitting=()=>false) {
  const close=event=>{if(!isQuitting() && notifications.hideOnClose()){event.preventDefault();window.hide();}};
  window.on('close',close);return ()=>window.removeListener('close',close);
}
module.exports={createNativeNotifications,bindNotificationClose};
