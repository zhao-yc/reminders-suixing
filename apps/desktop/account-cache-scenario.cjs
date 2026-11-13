const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {BrowserWindow,ipcMain} = require('electron');
const {createController} = require('./controller.cjs');
const {installDesktopIPC} = require('./ipc.cjs');
const {createLocalFiles} = require('./local-reminders.cjs');
const {createLocalStore,toLocalReport} = require('../uni-app/lib/local-reminders.mjs');

/** 通过实际前端和 IPC 验证冷启动只读、账户分组及手动刷新。所有内容都来自独立合成目录。 */
async function verifyAccountCache({frontendURL,root,waitForRenderer}) {
  const directory=await fs.mkdtemp(path.join(root,'.local','account-cache-smoke-'));
  const files=createLocalFiles(directory);
  const store=createLocalStore(files);
  const accounts=[
    {id:'legacy-cn',region:'cn',label:'iCloud',confirmed:true},
    {id:'syntheticsecondaccount',region:'cn',label:'iCloud 2',confirmed:true}
  ];
  const list={id:'synthetic-live-list',title:'随行验证 · 同名清单',color:'#1687ff'};
  const summary=account=>({
    capturedAt:new Date().toISOString(),totalLists:1,
    lists:[{list,partial:false,items:[{id:'synthetic-row',title:'随行验证 · '+account.label,completed:false,flagged:false}]}]
  });
  await store.saveAccounts(accounts);
  await Promise.all(accounts.map(account=>store.saveReport(account,toLocalReport(account,summary(account)))));
  const opened=[];
  let online=false;
  const byAccount=new Map(accounts.map(account=>[account.id,{
    connectionState:()=>({ok:true,state:online?'available':'offline'}),
    prepareSummary:()=>{opened.push(account.id);return online?{ok:true}:{ok:false,code:'OFFLINE'};},
    readNavigation:()=>({ok:true,snapshot:{pageId:'synthetic-page-'+account.id,lists:[list],items:[]}}),
    execute:command=>command.type==='readSummary'?{ok:true,summary:summary(account)}:{ok:false,code:'OFFLINE'}
  }]));
  const ui=new BrowserWindow({show:false,width:1120,height:820,webPreferences:{
    preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false
  }});
  const stop=installDesktopIPC({ipcMain,controller:byAccount.get(accounts[0].id),files,
    forAccount:account=>byAccount.get(account.id),getMainWindow:()=>ui});
  const run=code=>ui.webContents.executeJavaScript(code);
  try {
    await ui.loadURL(frontendURL);
    await waitForRenderer('document.querySelectorAll(".account-group").length===2 && !document.querySelector(".refresh-button[disabled]")',ui);
    assert.deepEqual(opened,accounts.map(account=>account.id));
    assert.equal(await run('document.querySelector("[data-status=pending] .desktop-card-count").textContent'),'2');
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
