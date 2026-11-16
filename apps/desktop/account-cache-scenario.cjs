const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {BrowserWindow,ipcMain} = require('electron');
const {createController} = require('./controller.cjs');
const {installDesktopIPC} = require('./ipc.cjs');
const {createLocalFiles} = require('./local-reminders.cjs');
const {createLocalStore,toLocalReport} = require('../uni-app/lib/local-reminders.mjs');

/** 验证快照、多账号和汇总内编辑。所有内容都来自独立合成目录。 */
async function verifyAccountCache({frontendURL,root,waitForRenderer}) {
  const directory=await fs.mkdtemp(path.join(root,'.local','account-cache-smoke-'));
  const files=createLocalFiles(directory);
  const store=createLocalStore(files);
  const accounts=[
    {id:'legacy-cn',region:'cn',label:'iCloud',confirmed:true},
    {id:'syntheticsecondaccount',region:'cn',label:'iCloud 2',appleAccount:'second@example.invalid',confirmed:true}
  ];
  const firstAppleAccount='first@example.invalid';
  const list={id:'synthetic-live-list',title:'随行验证 · 同名清单',color:'#1687ff'};
  const dateLabel=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const now=new Date(),today=dateLabel(now);
  const nextDay=new Date(now);nextDay.setDate(nextDay.getDate()+1);
  const tomorrow=dateLabel(nextDay);
  const completed=new Set(), expired=new Set(), changed=new Set(), titles=new Map(), notes=new Map(), schedules=new Map();
  const record=account=>({
    id:'synthetic-row',listId:list.id,title:titles.get(account.id) || '随行验证 · '+account.label,
    notes:notes.get(account.id) || '',metadata:schedules.get(account.id)?.date || today,
    schedule:schedules.get(account.id) || {date:today,time:null,timeZone:null},
    completed:completed.has(account.id),flagged:false,
    fingerprint:JSON.stringify([account.id,completed.has(account.id),changed.has(account.id),titles.get(account.id),notes.get(account.id),schedules.get(account.id)])
  });
  const summary=account=>({
    capturedAt:new Date().toISOString(),totalLists:1,
    lists:[{list,partial:false,items:[record(account)]}]
  });
  await store.saveAccounts(accounts);
  await Promise.all(accounts.map(account=>store.saveReport(account,toLocalReport(account,summary(account)))));
  const opened=[], writes=[], logins=[];
  let online=false;
  const byAccount=new Map(accounts.map(account=>{
    const pageId='synthetic-page-'+account.id;
    const snapshot=()=>({pageId,capturedAt:new Date().toISOString(),lists:[list],
      activeListId:list.id,activeListTitle:list.title,items:[record(account)]});
    return [account.id,{
      connectionState:()=>({ok:true,state:online?'available':'offline'}),
      prepareSummary:()=>{opened.push(account.id);return online?{ok:true}:{ok:false,code:'OFFLINE'};},
      readNavigation:()=>expired.has(account.id) ? {ok:false,code:'LOGIN_REQUIRED'} :
        {ok:true,appleAccount:account.appleAccount || firstAppleAccount,snapshot:{pageId,lists:[list],items:[]}},
      openLogin:()=>{logins.push(account.id);return {ok:false,code:'LOGIN_CANCELLED',message:'已取消登录。'};},
      execute:command=>{
        if (!online) return {ok:false,code:'OFFLINE'};
        if (command.type==='readSummary') return {ok:true,summary:summary(account)};
        if (command.type==='selectList') return {ok:command.pageId===pageId && command.listId===list.id,code:'READY',snapshot:snapshot()};
        if (command.type==='getSchedule' && command.fingerprint===record(account).fingerprint) {
          return {ok:true,code:'READY',snapshot:snapshot(),schedule:record(account).schedule,scheduleFingerprint:'synthetic-schedule',editorTimeZone:'UTC'};
        }
        if (!['setCompleted','setText','setSchedule'].includes(command.type)) return {ok:false,code:'INVALID_COMMAND'};
        writes.push({accountId:account.id,...command});
        if (command.id!==record(account).id || command.fingerprint!==record(account).fingerprint) return {ok:false,code:'STALE_VIEW'};
        if (command.type==='setSchedule') schedules.set(account.id,command.value);
        else if (command.type==='setText') (command.field==='title'?titles:notes).set(account.id,command.value);
        else completed.add(account.id);
        return {ok:true,code:'WEB_STATE_OBSERVED',snapshot:snapshot()};
      }
    }];
  }));
  const ui=new BrowserWindow({show:false,width:1120,height:820,webPreferences:{
    preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false
  }});
  const stop=installDesktopIPC({ipcMain,controller:byAccount.get(accounts[0].id),files,
    forAccount:account=>byAccount.get(account.id),getMainWindow:()=>ui});
  async function run(code) {
    try { return await ui.webContents.executeJavaScript(code); }
    catch (error) { throw new Error('合成界面操作失败：' + code, { cause:error }); }
  }
  const chooseField=field=>run(`document.querySelector('.summary-edit-option[data-field="${field}"]').click()`);
  const saveField=()=>run('document.querySelector(".summary-inline-editor .save-edit").click()');
  const setField=(element,value)=>run(`(()=>{
    const input=document.querySelector('.summary-inline-editor ${element}');
    const type=input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event("input",{bubbles:true}));
  })()`);
  try {
    await ui.loadURL(frontendURL);
    await waitForRenderer('document.querySelectorAll(".account-group").length===2 && !document.querySelector(".refresh-button[disabled]")',ui);
    assert.deepEqual(opened,accounts.map(account=>account.id));
    assert.deepEqual(await run('[...document.querySelectorAll(".account-group-toggle .list-name")].map(node=>node.textContent)'),
      ['iCloud',accounts[1].appleAccount]);
    assert.equal(await run('document.querySelector("[data-status=pending] .desktop-card-count").textContent'),'2');
    await run('document.querySelector("[data-status=pending]").click()');
    await waitForRenderer('document.querySelector(".summary-completion-button") && document.querySelector(".network-notice")?.dataset.state==="offline"',ui);
    await run('document.querySelector(".summary-completion-button").click()');
    await waitForRenderer('document.querySelector(".notice[data-code=OFFLINE_SUMMARY]")',ui);
    assert.equal(writes.length,0);
    await run('document.querySelector(".account-group-toggle").click()');
    assert.equal(await run('document.querySelector("[data-status=pending] .desktop-card-count").textContent'),'2');
    await run('document.querySelectorAll(".account-group .list-button")[0].click()');
    await waitForRenderer('document.querySelector(".cached-list-actions") && document.querySelector(".list-content").dataset.live==="false"',ui);
    assert.equal(await run('document.querySelector(".reminder-title").textContent'),'随行验证 · iCloud 2');
    assert.equal(opened.length,2);
    ui.setContentSize(390,844);
    await waitForRenderer('document.querySelector(".mobile-menu") && !document.querySelector(".desktop-sidebar-layout")',ui);
    await run('document.querySelector(".mobile-menu").click()');
    await waitForRenderer('document.querySelector(".compact-overview")',ui);
    assert.equal(await run('document.body.scrollWidth<=innerWidth'),true);
    online=true;
    await run('document.querySelector(".more-tool").click();document.querySelector(".refresh-button").click()');
    await waitForRenderer('!document.querySelector(".refresh-button[disabled]")',ui);
    assert.deepEqual(opened,[...accounts,...accounts].map(account=>account.id));
    assert.deepEqual(await run('[...document.querySelectorAll(".account-group-toggle .list-name")].map(node=>node.textContent)'),
      [firstAppleAccount,accounts[1].appleAccount]);
    await run('document.querySelector("[data-status=today]").click()');
    await waitForRenderer('document.querySelectorAll(".summary-completion-button").length===2 && document.querySelector(".network-notice")?.dataset.state!=="offline"',ui);
    await run('document.querySelectorAll(".summary-completion-button")[1].click()');
    await waitForRenderer('document.querySelectorAll(".summary-completion-button").length===1',ui);
    assert.deepEqual(writes.map(command=>[command.accountId,command.pageId,command.id,command.completed]),
      [[accounts[1].id,'synthetic-page-'+accounts[1].id,'synthetic-row',true]]);
    ui.setContentSize(1120,820);
    await waitForRenderer('document.querySelector(".desktop-sidebar-layout .summary-row")',ui);
    await run('document.querySelector(".summary-edit-button").click()');
    await waitForRenderer('document.querySelectorAll(".summary-edit-option").length===3',ui);
    await chooseField('title');
    await waitForRenderer('document.querySelector(".summary-row .summary-inline-editor input")',ui);
    assert.equal(await run('document.querySelector(".summary-inline-editor input").value'),'随行验证 · iCloud');
    await setField('input','随行验证 · 编辑后的标题');
    await saveField();
    await waitForRenderer('document.querySelector(".summary-row .reminder-title")?.textContent==="随行验证 · 编辑后的标题"',ui);
    ui.setContentSize(390,844);
    await waitForRenderer('document.querySelector(".compact-layout .summary-row")',ui);
    await chooseField('notes');
    await waitForRenderer('document.querySelector(".summary-inline-editor textarea")',ui);
    await setField('textarea','随行验证 · 取消的备注');
    await run('document.querySelector(".summary-cancel-edit").click()');
    await waitForRenderer('!document.querySelector(".summary-inline-editor")',ui);
    assert.equal(writes.length,2);
    await chooseField('notes');
    await waitForRenderer('document.querySelector(".summary-inline-editor textarea")',ui);
    await setField('textarea','随行验证 · 编辑后的备注');
    await saveField();
    await waitForRenderer('document.querySelector(".summary-row .reminder-notes")?.textContent==="随行验证 · 编辑后的备注"',ui);
    await chooseField('schedule');
    await waitForRenderer('document.querySelector(".summary-row .schedule-date-input input")',ui);
    assert.equal(await run('document.querySelector(".summary-inline-editor .schedule-date-input input").value'),today);
    assert.equal(await run('document.body.scrollWidth<=innerWidth && !document.querySelector(".list-content[data-live]")'),true);
    await setField('.schedule-date-input input',tomorrow);
    await saveField();
    await waitForRenderer('document.querySelector(".list-title")?.textContent==="今天" && !document.querySelector(".summary-row")',ui);
    assert.deepEqual(writes.slice(1).map(command=>[command.accountId,command.type,command.id,command.field || command.value.date]),[
      [accounts[0].id,'setText','synthetic-row','title'],
      [accounts[0].id,'setText','synthetic-row','notes'],
      [accounts[0].id,'setSchedule','synthetic-row',tomorrow]
    ]);
    await run('document.querySelector(".mobile-menu").click()');
    await waitForRenderer('document.querySelector(".compact-overview")',ui);
    changed.add(accounts[0].id);
    await run('document.querySelector("[data-status=pending]").click()');
    await waitForRenderer('document.querySelectorAll(".summary-completion-button").length===1',ui);
    await run('document.querySelector(".summary-edit-button").click()');
    await waitForRenderer('document.querySelector(".summary-edit-option")',ui);
    await chooseField('title');
    await waitForRenderer('document.querySelector(".notice[data-code=SUMMARY_TARGET_CHANGED]") && document.querySelector(".summary-row")',ui);
    assert.equal(writes.length,4);
    await run('document.querySelector(".mobile-menu").click()');
    await waitForRenderer('document.querySelector(".compact-overview")',ui);
    expired.add(accounts[0].id);
    await run('document.querySelector("[data-status=pending]").click()');
    await waitForRenderer('document.querySelectorAll(".summary-completion-button").length===1',ui);
    await run('document.querySelector(".summary-completion-button").click()');
    await waitForRenderer('document.querySelector(".notice:not(.network-notice)")?.textContent.includes("已取消登录")',ui);
    assert.deepEqual(logins,[accounts[0].id]);
    assert.equal(writes.length,4);
  } finally {
    stop();
    ui.destroy();
    for (const account of accounts) await store.removeReport(account);
    await files.remove('accounts');
    await fs.rmdir(directory);
  }
}

/** 同一地区的两个 Chromium 分区应保留独立状态，关闭网页后可复用，清除只作用于一个分区。 */
async function verifyAccountPartitions(fixtureURL) {
  const suffix=Date.now().toString(36);
  const options=id=>({fixtureURL,fixturePartition:'persist:suixing-synthetic-'+suffix+'-'+id});
  const first=createController(options('first'));
  const second=createController(options('second'));
  const resumed=createController(options('first'));
  async function load(client) {
    await client.prepareSummary('cn');
    const window=client.window();
    if (window.webContents.isLoading()) await new Promise(resolve=>window.webContents.once('did-stop-loading',resolve));
    return window.webContents;
  }
  try {
    const one=await load(first);
    const two=await load(second);
    await one.executeJavaScript('localStorage.setItem("synthetic-account","first")');
    await two.executeJavaScript('localStorage.setItem("synthetic-account","second")');
    await one.executeJavaScript(`(() => {
      const avatar=document.createElement('button');
      avatar.setAttribute('aria-haspopup','menu');
      avatar.innerHTML='<span class="profile-photo"></span>';
      avatar.addEventListener('click',()=>{
        const menu=document.createElement('div');
        menu.className='account-menu';
        menu.innerHTML='<div class="header"><span class="email">first@example.invalid</span></div>';
        menu.addEventListener('keydown',event=>{if(event.key==='Escape') menu.remove();});
        document.body.append(menu);
      });
      document.body.append(avatar);
    })()`);
    assert.equal((await first.readNavigation('cn')).appleAccount,'first@example.invalid');
    assert.equal(await one.executeJavaScript('!!document.querySelector(".account-menu")'),false);
    first.dispose();
    assert.equal(await (await load(resumed)).executeJavaScript('localStorage.getItem("synthetic-account")'),'first');
    assert.equal((await resumed.forget('cn')).ok,true);
    assert.equal(await (await load(resumed)).executeJavaScript('localStorage.getItem("synthetic-account")'),null);
    assert.equal(await two.executeJavaScript('localStorage.getItem("synthetic-account")'),'second');
  } finally {
    first.dispose();
    await resumed.forget('cn');
    await second.forget('cn');
  }
}

module.exports={verifyAccountCache,verifyAccountPartitions};
