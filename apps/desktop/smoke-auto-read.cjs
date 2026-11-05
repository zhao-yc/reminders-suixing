const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {BrowserWindow,ipcMain}=require('electron');
const {createController}=require('./controller.cjs');
const {installDesktopIPC}=require('./ipc.cjs');

/** 独立的真实 Electron 合成专项：只改测试页面，不连接 Apple 或个人会话。 */
async function runSmoke({frontendURL,root}) {
  const html=fs.readFileSync(path.join(root,'tests/fixtures/reminders.html'),'utf8');
  const server=http.createServer((request,response)=>{response.setHeader('content-type','text/html; charset=utf-8');response.end(request.url==='/frame'?html:'<!doctype html><meta charset="utf-8"><iframe src="/frame"></iframe>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const controller=createController({fixtureURL:'http://127.0.0.1:'+server.address().port+'/',diagnostics:true});
  const commands=[],errors=[];let ui,stopIPC;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function waitFor(check,label,timeout=5000) {const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await pause(40);}assert.fail(label);}
  const official=source=>controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;'+source+'})()');
  const title=(value)=>official('w.sessionStorage.setItem("fixture-text-reminder-item-fixture-one-0-title",'+JSON.stringify(value)+');w.renderFixture("one");');
  const focus=()=>ui.webContents.executeJavaScript('window.dispatchEvent(new Event("focus"))');
  const visibleTitle=value=>ui.webContents.executeJavaScript('[...document.querySelectorAll(".reminder-title")].some(n=>n.textContent==='+JSON.stringify(value)+')');
  const click=async selector=>assert.equal(await ui.webContents.executeJavaScript('(()=>{const node=document.querySelector('+JSON.stringify(selector)+');if(!node)return false;node.click();return true;})()'),true,'缺少操作控件：'+selector);
  try {
    controller.openSite('cn');controller.window().hide();let first;
    await waitFor(async()=>{first=await controller.execute({type:'read'},'cn');return first.ok;},'合成页面未就绪');
    await title('随行验证 · 自动更新起点');first=await controller.execute({type:'read'},'cn');
    ui=new BrowserWindow({show:true,width:1160,height:830,title:'随行自动更新合成验证',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    ui.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    stopIPC=installDesktopIPC({ipcMain,controller:{...controller,execute:(command,region)=>{commands.push({...command});return controller.execute(command,region);}},getMainWindow:()=>ui});
    await ui.loadURL(frontendURL);await waitFor(()=>ui.webContents.executeJavaScript('!!document.querySelector(".refresh-button")'),'界面未就绪');
    ui.webContents.send('suixing:snapshot',{region:'cn',result:{...first,snapshot:{...first.snapshot,capturedAt:'2000-01-01T00:00:00.000Z'}}});
    await waitFor(()=>visibleTitle('随行验证 · 自动更新起点'),'初始清单未显示');
    await title('随行验证 · 自动更新第一次');await focus();await waitFor(()=>visibleTitle('随行验证 · 自动更新第一次'),'聚焦后未自动更新');
    assert.deepEqual(commands,[{type:'readList',pageId:first.snapshot.pageId,listId:first.snapshot.activeListId,background:true}]);
    const automaticReceipt=controller.lastAutomaticReadOutcome();
    assert.deepEqual(automaticReceipt,{sequence:1,ok:true,code:'READY',samePage:true,sameList:true,capturedAt:automaticReceipt.capturedAt});
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".list-content").dataset.capturedAt'),automaticReceipt.capturedAt);
    assert.ok(!Number.isNaN(Date.parse(automaticReceipt.capturedAt)));
    console.log('聚焦自动读取经正式 IPC 通过，未切换清单或重连。');

    await title('随行验证 · 周期自动更新');await waitFor(()=>visibleTitle('随行验证 · 周期自动更新'),'20 秒周期未自动取得内容',25000);assert.equal(commands.length,2);
    console.log('实际 20 秒计时器取得当前清单更新，无需聚焦或点击刷新。');

    await pause(3100);await click('.edit-notes-button');
    await waitFor(()=>ui.webContents.executeJavaScript('!!document.querySelector(".inline-editor textarea")'),'备注编辑器未出现');
    await ui.webContents.executeJavaScript('(()=>{const input=document.querySelector(".inline-editor textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"随行验证 · 本地未提交草稿");input.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await title('随行验证 · 编辑期间外部更新');await focus();await pause(150);assert.equal(commands.length,2);
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".inline-editor textarea").value'),'随行验证 · 本地未提交草稿');
    await click('.editor-actions > :last-child');await waitFor(()=>ui.webContents.executeJavaScript('!document.querySelector(".inline-editor")'),'取消未关闭草稿');await focus();await waitFor(()=>visibleTitle('随行验证 · 编辑期间外部更新'),'结束编辑后未取得更新');assert.equal(commands.length,3);
    console.log('本地编辑期间暂停读取并保持草稿，取消后取得外部更新，未保存草稿。');

    await pause(3100);
    await ui.webContents.executeJavaScript('(()=>{const button=document.querySelector(".auto-read-toggle");button.focus();button.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));})()');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".auto-read-toggle").getAttribute("aria-pressed")'),'false');
    await title('随行验证 · 暂停后更新');await focus();await pause(150);assert.equal(commands.length,3);
    await ui.webContents.executeJavaScript('document.querySelector(".auto-read-toggle").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
    await focus();await waitFor(()=>visibleTitle('随行验证 · 暂停后更新'),'恢复自动更新后未读取');assert.equal(commands.length,4);

    ui.hide();assert.equal(ui.isVisible(),false);
    assert.equal(await ui.webContents.executeJavaScript('document.visibilityState'),'visible','本专项关闭节流，须验证原生窗口兜底');
    await pause(3100);await title('随行验证 · 隐藏后更新');await focus();await pause(150);assert.equal(commands.length,4);
    ui.show();await waitFor(()=>visibleTitle('随行验证 · 隐藏后更新'),'窗口恢复可见后未更新');assert.equal(commands.length,5);
    console.log('自动更新暂停/恢复的键盘操作、窗口隐藏暂停与恢复可见读取通过。');

    await pause(3100);await title('随行验证 · 官方编辑后更新');await official('const panel=w.document.createElement("div");panel.id="auto-read-test-dialog";panel.setAttribute("role","dialog");w.document.body.append(panel);');
    await focus();await waitFor(async()=>commands.length===6,'官方编辑预检未执行');await pause(150);assert.equal(await visibleTitle('随行验证 · 隐藏后更新'),true);
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'true');
    await official('w.document.getElementById("auto-read-test-dialog").remove();');await pause(3100);await focus();await waitFor(()=>visibleTitle('随行验证 · 官方编辑后更新'),'官方编辑结束后未更新');assert.equal(commands.length,7);

    await ui.webContents.executeJavaScript('window.dispatchEvent(new Event("offline"));window.dispatchEvent(new Event("online"))');
    await title('随行验证 · 网络恢复待核对');await pause(3100);await focus();await pause(150);assert.equal(commands.length,7);assert.equal(await visibleTitle('随行验证 · 官方编辑后更新'),true);
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'false');
    await click('.refresh-button');await waitFor(()=>visibleTitle('随行验证 · 网络恢复待核对'),'手动核对未恢复');assert.equal(commands.at(-1).type,'read');
    await click('.auto-read-toggle');
    console.log('官方编辑期间只暂缓，网络恢复后保持只读并等待手动核对通过。');

    ui.setSize(391,800);await pause(250);assert.equal(await ui.webContents.executeJavaScript('document.documentElement.scrollWidth<=window.innerWidth+2'),true,'自动更新状态在窄屏不能横向溢出');
    fs.writeFileSync(path.join(root,'.local/desktop-auto-read-synthetic-20261105.png'),(await ui.webContents.capturePage()).toPNG());
    await pause(3100);await official('w.document.querySelector("[role=treeitem][data-list=two]").click();');
    assert.equal(await official('return w.document.querySelector("[role=treeitem][aria-selected=true]").dataset.list;'),'two');
    await click('.auto-read-toggle');await focus();await waitFor(()=>ui.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live==="false"'),'官方选区改变后未停止');
    assert.equal(await visibleTitle('随行验证 · 网络恢复待核对'),true,'官方选区改变后保留原内容，不读其他清单');
    const writes=await official('return {completion:w.fixtureClicks,text:w.fixtureTextSaves,dates:w.fixtureScheduleSaves,flag:w.fixtureFlagSaves,creation:w.fixtureCreationClicks,deletion:w.fixtureDeleteKeys,lists:w.fixtureListSaves};');
    assert.ok(Object.values(writes).every(value=>value===0),JSON.stringify(writes));assert.ok(commands.every(command=>['read','readList'].includes(command.type)));assert.deepEqual(errors,[]);
    console.log('自动读取选区保护、窄屏和零业务写入通过；本专项仅为合成网页证据。');
  } finally {
    stopIPC?.();if(ui && !ui.isDestroyed())ui.destroy();controller.dispose();await new Promise(resolve=>server.close(resolve));
  }
}
module.exports={runSmoke};
