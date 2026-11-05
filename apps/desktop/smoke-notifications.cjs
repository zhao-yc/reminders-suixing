const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {BrowserWindow,ipcMain,Notification,Tray,Menu,nativeImage}=require('electron');
const {createController}=require('./controller.cjs');
const {installDesktopIPC}=require('./ipc.cjs');
const {createNativeNotifications,bindNotificationClose}=require('./native-notifications.cjs');
const {createTestItem}=require('./verification-ui.cjs');

/** 合成网页与虚拟时钟，走正式 IPC、真实托盘和系统通知；不访问 Apple。 */
async function runSmoke({frontendURL,root}) {
  const html=fs.readFileSync(path.join(root,'tests/fixtures/reminders.html'),'utf8');
  const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url==='/frame'?html:'<!doctype html><iframe src="/frame"></iframe>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const controller=createController({fixtureURL:'http://127.0.0.1:'+server.address().port+'/',diagnostics:true});
  let ui,notifications,stopIPC,unbind,tick,clock=Date.parse('2030-01-15T05:59:00Z');
  const realClock=process.argv.includes('--notification-real-clock'),target=Math.ceil((Date.now()+30000)/60000)*60000;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(target).map(part=>[part.type,part.value]));
  const schedule=realClock?{date:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute,timeZone:'Asia/Shanghai'}:{date:'2030-01-15',time:'14:00',timeZone:'Asia/Shanghai'};
  const shown=[],created=[];const errors=[];
  function ObservedNotification(options){created.push(options);const value=new Notification(options);value.on('show',()=>shown.push(options));return value;}
  ObservedNotification.isSupported=()=>Notification.isSupported();
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(check,message,timeout=7000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await pause(40);}assert.fail(message);}
  try {
    controller.openSite('cn');controller.window().hide();let first;
    await until(async()=>{first=await controller.execute({type:'read'},'cn');return first.ok;},'合成网页未就绪');
    await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;w.sessionStorage.setItem("fixture-complete","false");for(let i=0;i<2;i++)w.sessionStorage.setItem("fixture-schedule-reminder-item-fixture-one-"+i,JSON.stringify('+JSON.stringify(schedule)+'));w.renderFixture("one");})()');
    first=await controller.execute({type:'read'},'cn');assert.equal(first.ok,true);
    ui=new BrowserWindow({show:true,width:1160,height:830,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});ui.show();
    ui.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    notifications=createNativeNotifications({Notification:ObservedNotification,Tray,Menu,nativeImage,controller,window:ui,settingsPath:path.join(root,'.local/notification-synthetic-preferences.json'),quit:()=>{},changed:state=>ui.webContents.send('suixing:notifications-state',state),
      scheduling:realClock?{}:{now:()=>clock,localZone:()=> 'Asia/Shanghai',setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}}});
    if(notifications.state().enabled)notifications.configure({enabled:false,allDayTime:'09:00'});
    unbind=bindNotificationClose(ui,notifications);stopIPC=installDesktopIPC({ipcMain,controller,getMainWindow:()=>ui,notifications});
    await ui.loadURL(frontendURL);await until(()=>ui.webContents.executeJavaScript('!!document.querySelector(".notifications-settings-button")'),'界面未就绪');
    ui.webContents.send('suixing:snapshot',{region:'cn',result:first});await until(()=>ui.webContents.executeJavaScript('document.querySelectorAll(".reminder-row").length===2'),'合成事项未显示');
    const createdViaUI=await ui.webContents.executeJavaScript('('+createTestItem.toString()+')('+JSON.stringify({pageId:first.snapshot.pageId,listId:first.snapshot.activeListId,title:'随行验证 · 通知新增恢复检查'})+')',true);
    assert.equal(createdViaUI,true);await until(()=>controller.lastWriteOutcome()?.ok===true && !controller.lastWriteOutcome().replyPending,'合成新增正式回执未完成');
    await until(()=>ui.webContents.executeJavaScript('document.querySelectorAll(".reminder-row[data-record-id]").length===3 && !document.querySelector(".new-reminder-row")'),'合成新增未进入本地界面');
    const writeSequence=controller.lastWriteOutcome().sequence;
    await ui.webContents.executeJavaScript('document.querySelector(".notifications-settings-button").click()');await pause(80);
    await ui.webContents.executeJavaScript('document.querySelector(".enable-system-notifications").click()');await until(()=>notifications.state().enabled,'正式通知设置未启用');await pause(120);
    assert.equal(ui.isVisible(),true);ui.close();assert.equal(ui.isDestroyed(),false);assert.equal(ui.isVisible(),false);
    if(realClock){console.log('真实系统时钟专项：窗口已留在托盘，等候下一个测试到期时间，不修改系统时钟。');await until(()=>shown.length>0,'真实时钟到期后没有系统 show 回执',Math.max(1000,target-Date.now()+25000));}
    else {clock=Date.parse('2030-01-15T06:00:03Z');await tick();}
    assert.equal(shown.length,1,'隐藏后应取得一次系统 show 事件');assert.match(shown[0].body,/2 项/);assert.doesNotMatch(JSON.stringify(shown),/同名事项|fixture|2030/);
    if(realClock)await pause(16000);else await tick();assert.equal(created.length,1,'重复读取不再次派发同一到期提醒');
    const receipt=controller.lastAutomaticReadOutcome();assert.equal(receipt.ok,true);assert.equal(receipt.samePage,true);assert.equal(receipt.sameList,true);
    assert.equal(controller.lastWriteOutcome().sequence,writeSequence,'通知链不追加业务写入');assert.deepEqual(errors,[]);
    const creationState=await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;return {clicks:w.fixtureCreationClicks,earlyBlurs:w.fixtureEarlyCreationBlurs};})()');
    assert.deepEqual(creationState,{clicks:1,earlyBlurs:0},'新增仍只提交一次并保留自动保存焦点');
    console.log('通知闭环通过：正式新增一次且不失焦、设置 IPC、合成页面日期、'+(realClock?'真实系统时钟':'虚拟时钟')+'到期、隐藏至真实托盘、后台指定读取、2 项聚合系统 show 回执、去重且不追加业务写入。');
    console.log('这是合成页面'+(realClock?'，未修改系统时钟':'与虚拟时间')+'，不是实际账号、物理休眠或用户看到横幅的证据。');
  } finally {stopIPC?.();unbind?.();notifications?.dispose();if(ui && !ui.isDestroyed())ui.destroy();controller.dispose();await new Promise(resolve=>server.close(resolve));}
}
module.exports={runSmoke};
