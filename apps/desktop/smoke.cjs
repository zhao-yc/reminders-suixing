const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { BrowserWindow, ipcMain } = require('electron');
const { createController, allowedURL, validCommand } = require('./controller.cjs');
const { browserUserAgent } = require('./policy.cjs');
const { installDesktopIPC } = require('./ipc.cjs');
const { clickTestCompletion, editTestText, createTestItem, showTestCompleted, editTestSchedule, clickTestFlag, deleteTestItem, editTestList, deleteTestList, editTestListAppearance, editTestSubtask,reconnectTestClient } = require('./verification-ui.cjs');

/** 真实 Electron + 合成网页，验证 iframe 读取、IPC、同名事项写回与重载后的状态保持。 */
async function runSmoke({ frontendURL, root }) {
  console.log('正在验证桌面网页桥接和构建界面…');
  const html = fs.readFileSync(path.join(root, 'tests/fixtures/reminders.html'), 'utf8');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(request.url === '/gone' ? '<!doctype html><title>合成页面已退出</title>' : request.url === '/agent' ? '<!doctype html><iframe src="http://localhost:' + server.address().port + '/frame"></iframe>' : request.url === '/frame' ? html : '<!doctype html><meta charset="utf-8"><iframe src="/frame"></iframe>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = createController({ fixtureURL: 'http://127.0.0.1:' + server.address().port + '/', diagnostics: true });
  let ui;
  let agentWindow;
  let normalUI;
  let normalController;
  let stopIPC;
  const uiErrors=[];
  try {
    // localhost 与 127.0.0.1 是不同站点，验证登录所用的跨域 iframe 不会退回中文 Electron 标识。
    agentWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await agentWindow.loadURL('http://127.0.0.1:' + server.address().port + '/agent');
    const agentFrames = agentWindow.webContents.mainFrame.framesInSubtree;
    assert.equal(agentFrames.length, 2);
    for (const frame of agentFrames) assert.equal(await frame.executeJavaScript('navigator.userAgent'), browserUserAgent(process.versions.chrome));
    console.log('跨站登录 iframe 的浏览器标识验证通过。');
    assert.equal(allowedURL('https://www.icloud.com.cn/reminders/'), true);
    assert.equal(allowedURL('https://icloud.com.evil.example/'), false);
    assert.equal(validCommand({ type: 'setCompleted', completed: 'true' }), false);
    controller.openSite('cn');
    controller.window().hide();
    let first;
    for (let attempt = 0; attempt < 30; attempt++) {
      first = await controller.execute({ type: 'read' }, 'cn');
      if (first.ok) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(first.ok, true, first.message);
    const diagnostics = await controller.diagnostics();
    assert.equal(diagnostics.opened, true);
    assert.equal(diagnostics.frames.length, 2);
    for (const frame of diagnostics.frames) assert.equal(frame.state.runtime.ua, browserUserAgent(process.versions.chrome));
    const item = first.snapshot.items[0];
    const update = await controller.execute({ type: 'setCompleted', pageId: first.snapshot.pageId,
      listId: item.listId, id: item.id, fingerprint: item.fingerprint, expectedCompleted: false, completed: true }, 'cn');
    assert.equal(update.code, 'WEB_STATE_OBSERVED');
    assert.equal(update.cloudConfirmed, false);
    await controller.window().webContents.executeJavaScript('location.reload()');
    let reloaded;
    for (let attempt = 0; attempt < 30; attempt++) {
      reloaded = await controller.execute({ type: 'read' }, 'cn');
      if (reloaded.ok && reloaded.snapshot.pageId !== first.snapshot.pageId) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(reloaded.snapshot.items[0].completed, true);
    assert.notEqual(reloaded.snapshot.pageId, first.snapshot.pageId);
    console.log('桌面网页桥接及重载验证通过。');

    ui = new BrowserWindow({ show: false, width: 1160, height: 830, webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false
    } });
    ui.webContents.on('console-message', event => { if (event.level === 'error') {uiErrors.push(event.message);console.error('界面错误：' + event.message);} });
    stopIPC=installDesktopIPC({ipcMain,controller,getMainWindow:()=>ui});
    await ui.loadURL(frontendURL);
    await ui.webContents.executeJavaScript('new Promise((resolve,reject) => { const deadline=Date.now()+8000; const timer=setInterval(()=>{if(document.body.innerText.includes("连接我的提醒事项")){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("构建界面未完成加载"))}},50) })');
    const uiState = await ui.webContents.executeJavaScript('({title:document.title, bridge:typeof window.suixingDesktop?.execute, hasNode:typeof require})');
    assert.equal(uiState.title, '提醒事项·随行');
    assert.equal(uiState.bridge, 'function');
    assert.equal(uiState.hasNode, 'undefined');
    // 区域设置保存在本地应用源，与远程账号会话分开；重建页面时恢复，避免回到另一区域。
    const displayedRegion = () => ui.webContents.executeJavaScript('document.querySelector(".region-picker")?.textContent');
    for (const [value, label] of [['global', '其他地区'], ['cn', '中国大陆']]) {
      await ui.webContents.executeJavaScript('document.querySelector(".region-picker").click()');
      await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{const option=[...document.querySelectorAll(".uni-picker-select .uni-picker-item")].find(node=>node.textContent===' + JSON.stringify(label) + ');if(option){clearInterval(timer);option.click();resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("区域选项未出现"))}},50)})');
      const stored = await ui.webContents.executeJavaScript('localStorage.getItem("suixing.settings.region")');
      assert.equal(stored, value, '实际区域选择应通过 uni API 保存设置');
      await ui.loadURL(frontendURL);
      await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{if(document.querySelector(".region-picker")){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("区域设置界面未完成加载"))}},50)})');
      assert.ok((await displayedRegion()).includes(label), '重建页面必须恢复保存的区域');
    }
    console.log('构建界面服务区域恢复验证通过。');
    const ipcRead = await ui.webContents.executeJavaScript('window.suixingDesktop.execute({type:"read"},"cn").then(r=>({ok:r.ok,count:r.snapshot?.items.length}))');
    assert.equal(ipcRead.ok, true);
    assert.equal(ipcRead.count, 2);
    // 排序只改本地显示；合成网页中的记录次序和写入次数必须保持不变。
    await controller.window().webContents.executeJavaScript(`(()=>{
      const w=document.querySelector('iframe').contentWindow;
      w.sessionStorage.setItem('fixture-complete','false');
      for(const [index,title,date] of [[0,'随行验证 · 任务10','2030-01-20'],[1,'随行验证 · 任务2','2030-01-10']]) {
        const id='reminder-item-fixture-one-'+index;
        w.sessionStorage.setItem('fixture-text-'+id+'-title',title);
        w.sessionStorage.setItem('fixture-schedule-'+id,JSON.stringify({date,time:null,timeZone:null}));
      }
      w.renderFixture('one');
      const row=w.document.getElementById('reminder-item-fixture-one-0');
      row.querySelector('.title').previousElementSibling.innerHTML='<span class="priority" data-priority-level="9">!</span>';
    })()`);
    const sorting=await controller.execute({type:'read'},'cn');
    const originalIds=sorting.snapshot.items.map(item=>item.id);
    ui.webContents.send('suixing:snapshot',{region:'cn',result:sorting});
    const selectSort=async label=>{
      await ui.webContents.executeJavaScript('document.querySelector(".sort-picker-label").click()');
      await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(await ui.webContents.executeJavaScript('(()=>{const option=[...document.querySelectorAll(".sort-option")].find(option=>option.querySelector(".sort-option-label").textContent==='+JSON.stringify(label)+');if(!option)return false;option.click();return true})()'),true);
      await new Promise(resolve=>setTimeout(resolve,80));
    };
    const displayedIds=()=>ui.webContents.executeJavaScript('[...document.querySelectorAll(".reminder-row[data-record-id]")].map(row=>row.dataset.recordId)');
    await new Promise(resolve=>setTimeout(resolve,100));
    for(const label of ['日期：从早到晚','标题：升序']) {
      await selectSort(label);
      assert.deepEqual(await displayedIds(),originalIds.slice().reverse());
    }
    assert.deepEqual(sorting.snapshot.items.map(item=>item.priority),['low','high']);
    assert.deepEqual(await ui.webContents.executeJavaScript('[...document.querySelectorAll(".priority-mark")].map(node=>node.textContent)'),['!!!','!']);
    await selectSort('优先级：从高到低');
    assert.deepEqual(await displayedIds(),originalIds.slice().reverse());
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".list-content").textContent.includes("优先级仅查看，请在苹果设备上修改")'),true);
    await selectSort('优先级：从低到高');
    assert.deepEqual(await displayedIds(),originalIds);
    await selectSort('标题：升序');
    assert.equal(await ui.webContents.executeJavaScript('localStorage.getItem("suixing.settings.listSort")'),'title-ascending');
    await ui.loadURL(frontendURL);
    await ui.webContents.executeJavaScript('new Promise(resolve=>{const timer=setInterval(()=>{if(document.querySelector(".demo-link")){clearInterval(timer);resolve(true)}},30)})');
    ui.webContents.send('suixing:snapshot',{region:'cn',result:sorting});
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".desktop-sort").dataset.sortMode'),'title-ascending');
    assert.deepEqual(await displayedIds(),originalIds.slice().reverse());
    await selectSort('清单顺序');
    assert.deepEqual(await displayedIds(),originalIds);
    ui.show();ui.focus();ui.webContents.focus();
    await ui.webContents.executeJavaScript('(()=>{const input=document.querySelector(".toolbar-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"随行验证");input.dispatchEvent(new Event("input",{bubbles:true}));input.focus()})()');
    const press=async keyCode=>{
      ui.webContents.sendInputEvent({type:'keyDown',keyCode});
      ui.webContents.sendInputEvent({type:'keyUp',keyCode});
      await new Promise(resolve=>setTimeout(resolve,100));
    };
    await press('Tab');
    assert.equal(await ui.webContents.executeJavaScript('document.activeElement.matches(".reconnect-button")'),true,'Tab 应能到达重新连接');
    await press('Tab');
    assert.equal(await ui.webContents.executeJavaScript('document.activeElement.matches(".rename-list-button")'),true,'Tab 应能到达清单重命名');
    await press('Tab');
    assert.equal(await ui.webContents.executeJavaScript('document.activeElement.matches(".list-appearance-button")'),true,'Tab 应能到达清单颜色与图标');
    await press('Tab');
    assert.equal(await ui.webContents.executeJavaScript('document.activeElement.matches(".delete-list-button")'),true,'Tab 应能到达清单删除');
    await press('Tab');
    assert.equal(await ui.webContents.executeJavaScript('document.activeElement.matches(".flag-filter")'),true,'Tab 应先到达旗标筛选');
    await press('Tab');
    assert.equal(await ui.webContents.executeJavaScript('document.activeElement.matches(".desktop-sort .sort-picker-label")'),true,'Tab 应能到达排序菜单');
    await press('Enter');
    assert.equal(await ui.webContents.executeJavaScript('!!document.querySelector(".sort-menu")'),true,'回车应打开排序选项');
    await press('Down');
    await press('Escape');
    assert.equal(await ui.webContents.executeJavaScript('!!document.querySelector(".sort-menu")'),false);
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".desktop-sort").dataset.sortMode'),'manual','Esc 应取消未提交的选择');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".toolbar-search input").value'),'随行验证','取消排序不得清空搜索');
    await press('Enter');await press('Down');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".desktop-sort").dataset.sortMode'),'manual','方向键只移动焦点，不提交选择');
    await press('Enter');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".desktop-sort").dataset.sortMode'),'date-ascending','回车应确认当前选项');
    await press('Home');
    await press('Enter');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".desktop-sort").dataset.sortMode'),'manual');
    await press('Escape');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".toolbar-search input").value'),'随行验证');
    await press('Enter');
    await ui.webContents.executeJavaScript('document.querySelector(".toolbar-search input").focus()');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await ui.webContents.executeJavaScript('!!document.querySelector(".sort-menu")'),false,'焦点移出菜单应取消选择');
    await ui.webContents.executeJavaScript('(()=>{const input=document.querySelector(".toolbar-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"");input.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await ui.webContents.executeJavaScript('document.querySelector(".sort-picker-label").click()');
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(path.join(root,'.local/sort-menu-desktop-preview.png'),(await ui.webContents.capturePage()).toPNG());
    ui.setContentSize(390,844);await new Promise(resolve=>setTimeout(resolve,300));
    const menuBounds=await ui.webContents.executeJavaScript('(()=>{const r=document.querySelector(".sort-menu").getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
    assert.ok(menuBounds.left>=0 && menuBounds.right<=menuBounds.width+1 && menuBounds.bottom<=menuBounds.height,'窄屏排序菜单必须在窗口内');
    fs.writeFileSync(path.join(root,'.local/sort-menu-mobile-preview.png'),(await ui.webContents.capturePage()).toPNG());
    await ui.webContents.executeJavaScript('document.querySelector(".toolbar-search").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await ui.webContents.executeJavaScript('!!document.querySelector(".sort-menu")'),false,'点击菜单外应取消选择');
    ui.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,100));
    ui.hide();
    const unchanged=await controller.execute({type:'read'},'cn');
    assert.deepEqual(unchanged.snapshot.items.map(item=>item.id),originalIds);
    const sortingWrites=await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;return {completion:w.fixtureClicks,date:w.fixtureScheduleSaveClicks,text:w.fixtureTextSaves}})()');
    assert.deepEqual(sortingWrites,{completion:0,date:0,text:0});
    await controller.window().webContents.executeJavaScript(`(()=>{
      const w=document.querySelector('iframe').contentWindow;
      w.sessionStorage.setItem('fixture-complete','true');
      for(let index=0;index<2;index++) {
        const id='reminder-item-fixture-one-'+index;
        w.sessionStorage.removeItem('fixture-text-'+id+'-title');
        w.sessionStorage.removeItem('fixture-schedule-'+id);
      }
      w.renderFixture('one');
    })()`);
    console.log('构建界面日期及标题排序、清单顺序恢复和重建页面后设置恢复通过，未派发事项写入。');
    const flagStart=await controller.execute({type:'read'},'cn');const flagTarget=flagStart.snapshot.items[1];
    ui.webContents.send('suixing:snapshot',{region:'cn',result:flagStart});
    await new Promise(resolve=>setTimeout(resolve,100));ui.show();ui.focus();ui.webContents.focus();
    await ui.webContents.executeJavaScript('document.querySelector(".flag-toggle-button").focus()');
    await press('Space');
    let flagged;
    for(let attempt=0;attempt<35;attempt++) {
      flagged=await controller.execute({type:'read'},'cn');
      if(flagged.snapshot?.items.find(item=>item.id===flagTarget.id)?.flagged===true) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(flagged.snapshot.items.find(item=>item.id===flagTarget.id).flagged,true,'空格应通过正式 IPC 添加旗标');
    await ui.webContents.executeJavaScript('document.querySelector(".flag-filter").focus()');await press('Space');
    assert.equal(await ui.webContents.executeJavaScript('document.querySelector(".flag-filter").getAttribute("aria-pressed")'),'true');
    assert.deepEqual(await displayedIds(),[flagTarget.id]);
    assert.equal(await ui.webContents.executeJavaScript('('+clickTestFlag.toString()+')('+JSON.stringify({pageId:flagged.snapshot.pageId,listId:flagTarget.listId,id:flagTarget.id,completed:false,flagged:true})+')',true),true);
    let unflagged;
    for(let attempt=0;attempt<35;attempt++) {
      unflagged=await controller.execute({type:'read'},'cn');
      if(unflagged.snapshot?.items.find(item=>item.id===flagTarget.id)?.flagged===false) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(unflagged.snapshot.items.find(item=>item.id===flagTarget.id).flagged,false);
    assert.deepEqual(await displayedIds(),[],'移除最后一个旗标后该行应离开旗标筛选');
    await ui.webContents.executeJavaScript('document.querySelector(".flag-filter").click()');
    await new Promise(resolve=>setTimeout(resolve,100));
    const flagWrites=await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;return {flags:w.fixtureFlagSaves,toggles:w.fixtureFlagToggleClicks,saves:w.fixtureScheduleSaveClicks,dates:w.fixtureScheduleSaves,completed:w.fixtureClicks}})()');
    assert.deepEqual(flagWrites,{flags:2,toggles:2,saves:2,dates:0,completed:0});
    await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureScheduleSaveClicks=0');
    ui.hide();
    console.log('旗标空格操作、正式 IPC、两次单次保存和本地筛选通过，没有日期或完成状态写入。');
    // 使用真实构建出的 uni-button，验证完成与取消完成均走本地界面、受限 IPC 和共用适配器。
    for (const completed of [true, false]) {
      const current = await controller.execute({ type: 'read' }, 'cn');
      assert.equal(current.ok, true);
      const target = current.snapshot.items[0];
      assert.equal(target.completed, completed);
      ui.webContents.send('suixing:snapshot', { region: 'cn', result: current });
      const clicked = await ui.webContents.executeJavaScript('(' + clickTestCompletion.toString() + ')(' + JSON.stringify({
        pageId: current.snapshot.pageId, listId: target.listId, id: target.id, completed
      }) + ')', true);
      assert.equal(clicked, true, '构建界面的完成按钮必须可定位');
      let observed;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        observed = await controller.execute({ type: 'read' }, 'cn');
        if (observed.snapshot?.items[0].completed === !completed) break;
      }
      assert.equal(observed.snapshot?.items[0].completed, !completed);
    }
    const writes = await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureClicks');
    assert.equal(writes, 2, '重载后的完成与取消完成各只写一次');
    console.log('构建界面完成与取消完成单次派发验证通过。');
    await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;w.fixtureHideCompleted=true;w.document.querySelector(".fixture-list-menu").hidden=true;w.renderFixture("one")})()');
    const hiddenCompleted=await controller.execute({type:'read'},'cn');
    assert.equal(hiddenCompleted.snapshot.items.length,1);
    ui.webContents.send('suixing:snapshot',{region:'cn',result:hiddenCompleted});
    await new Promise(resolve=>setTimeout(resolve,100));
    for(let attempt=0;attempt<2;attempt++) {
      assert.equal(await ui.webContents.executeJavaScript('('+showTestCompleted.toString()+')('+JSON.stringify({pageId:hiddenCompleted.snapshot.pageId,listId:hiddenCompleted.snapshot.activeListId})+')',true),true);
      const shown=await controller.execute({type:'read'},'cn');
      assert.equal(shown.snapshot.items.length,2);
      assert.equal(shown.snapshot.items[0].completed,true);
    }
    const completedEvents=await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;return {actions:w.fixtureCompletedActionClicks,writes:w.fixtureClicks}})()');
    assert.equal(completedEvents.actions,1);
    assert.equal(completedEvents.writes,2);
    console.log('本地已完成页签展开官方隐藏事项，重复进入不反转、不修改事项。');
    const textValues = { title: '随行验证 · 编辑后的合成标题', notes: '随行验证 · <合成备注> & 文字\n\n第二行' };
    for (const [field, value] of Object.entries(textValues)) {
      const current = await controller.execute({ type: 'read' }, 'cn');
      const target = current.snapshot.items[0];
      ui.webContents.send('suixing:snapshot', { region: 'cn', result: current });
      const clicked = await ui.webContents.executeJavaScript('(' + editTestText.toString() + ')(' + JSON.stringify({
        pageId: current.snapshot.pageId, listId: target.listId, id: target.id, completed: target.completed, field, value
      }) + ')', true);
      assert.equal(clicked, true, '实际构建界面的文字编辑必须可操作');
      let observed;
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        observed = await controller.execute({ type: 'read' }, 'cn');
        if (observed.snapshot?.items[0][field] === value) break;
      }
      assert.equal(observed.snapshot?.items[0][field], value, '文字字段读回不一致：' + field + ' / ' + observed.code);
    }
    const textEvents = await controller.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;return {saves:w.fixtureTextSaves,preparations:w.fixtureTextPreparations,inputs:w.fixtureTextInputs,blurs:w.fixtureTextBlurs,activeTag:w.document.activeElement.tagName}})()');
    console.log('原生文字编辑事件：' + JSON.stringify(textEvents));
    assert.equal(textEvents.saves, 2);
    assert.equal(textEvents.preparations, 2);
    assert.equal(textEvents.inputs, 2);
    await controller.window().webContents.executeJavaScript('location.reload()');
    let textReloaded;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      textReloaded = await controller.execute({ type: 'read' }, 'cn');
      if (textReloaded.ok && textReloaded.snapshot.items[0].title === textValues.title) break;
    }
    for (const [field, value] of Object.entries(textValues)) assert.equal(textReloaded.snapshot.items[0][field], value);
    console.log('构建界面标题和备注经原生编辑命令各保存一次，合成页面重载保持。');
    const zone=await controller.window().webContents.executeJavaScript('Intl.DateTimeFormat().resolvedOptions().timeZone');
    for(const value of [{date:'2030-01-15',time:null,timeZone:null},{date:'2030-01-15',time:'14:35',timeZone:zone},{date:null,time:null,timeZone:null}]) {
      const current=await controller.execute({type:'read'},'cn');const target=current.snapshot.items[0];
      ui.webContents.send('suixing:snapshot',{region:'cn',result:current});
      assert.equal(await ui.webContents.executeJavaScript('('+editTestSchedule.toString()+')('+JSON.stringify({pageId:current.snapshot.pageId,listId:target.listId,id:target.id,completed:target.completed,value})+')',true),true);
      let observed;
      for(let attempt=0;attempt<60;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,100));
        const read=await controller.execute({type:'read'},'cn');const item=read.snapshot?.items[0];if (!item) continue;
        observed=await controller.execute({type:'getSchedule',pageId:read.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed},'cn');
        if (JSON.stringify(observed.schedule)===JSON.stringify(value)) break;
      }
      if (JSON.stringify(observed.schedule)!==JSON.stringify(value)) {
        const state=await ui.webContents.executeJavaScript('({notice:document.querySelector(".notice")?.textContent,editor:!!document.querySelector(".schedule-editor"),dateEnabled:document.querySelector(".schedule-date-toggle")?.getAttribute("aria-checked"),date:document.querySelector(".schedule-date-input input")?.value,timeEnabled:document.querySelector(".schedule-time-toggle")?.getAttribute("aria-checked")})');
        console.log('合成日期失败诊断：'+JSON.stringify({code:observed.code,outcome:controller.lastWriteOutcome(),state}));
      }
      assert.deepEqual(observed.schedule,value);
    }
    assert.equal(await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureScheduleSaveClicks'),3);
    assert.equal(await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureScheduleSaves'),3);
    console.log('本地日期编辑器经正式 IPC 单次设置全天、指定时间和清除，分段输入由网页接管。');
    const previewRead=await controller.execute({type:'read'},'cn');const previewItem=previewRead.snapshot.items[0];
    ui.webContents.send('suixing:snapshot',{region:'cn',result:previewRead});
    assert.equal(await ui.webContents.executeJavaScript('('+editTestSchedule.toString()+')('+JSON.stringify({pageId:previewRead.snapshot.pageId,listId:previewItem.listId,id:previewItem.id,completed:previewItem.completed,value:{date:'2030-01-15',time:'14:35',timeZone:zone},preview:true})+')',true),true);
    ui.showInactive();await new Promise(resolve=>setTimeout(resolve,250));
    fs.writeFileSync(path.join(root,'.local/date-editor-desktop-preview.png'),(await ui.webContents.capturePage()).toPNG());
    ui.setContentSize(390,844);await new Promise(resolve=>setTimeout(resolve,400));
    const sortBounds=await ui.webContents.executeJavaScript('(()=>{const root=document.querySelector(".list-controls");const tools=root.querySelector(".list-view-tools");const r=root.getBoundingClientRect(),t=tools.getBoundingClientRect();return {width:innerWidth,left:t.left,right:t.right,scroll:root.scrollWidth,box:r.width}})()');
    assert.ok(sortBounds.left>=0 && sortBounds.right<=sortBounds.width+1 && sortBounds.scroll<=Math.ceil(sortBounds.box)+1,'窄屏排序入口不得超出清单控件边界');
    const pickerStates=await ui.webContents.executeJavaScript('([...document.querySelectorAll(".schedule-editor uni-picker")].map(root=>{const pane=root.querySelector(".uni-picker-container");return {present:!!pane,hidden:!!pane && getComputedStyle(pane).display==="none",stray:[...root.querySelectorAll(".uni-picker-custom")].some(node=>!node.closest(".uni-picker-container"))}}))');
    assert.equal(pickerStates.length,2);
    assert.ok(pickerStates.every(state=>state.present && state.hidden && !state.stray),'调整窗口后关闭的日期选择器必须保持隐藏和完整容器');
    const dateBounds=await ui.webContents.executeJavaScript('({width:innerWidth,parts:[...document.querySelectorAll(".schedule-editor,.schedule-value-row,.schedule-toggle-row,.editor-actions")].map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:node.scrollWidth}})})');
    assert.ok(dateBounds.parts.length>=5);
    for(const part of dateBounds.parts) {assert.ok(part.left>=-1 && part.right<=dateBounds.width+1);assert.ok(part.scroll<=Math.ceil(part.width)+1);}
    fs.writeFileSync(path.join(root,'.local/date-editor-mobile-preview.png'),(await ui.webContents.capturePage()).toPNG());
    await ui.webContents.executeJavaScript('document.querySelector(".schedule-editor uni-picker .schedule-picker-button").click()');
    await new Promise(resolve=>setTimeout(resolve,450));
    const pickerOpen=await ui.webContents.executeJavaScript('(()=>{const pane=document.querySelector(".uni-picker-container.uni-date-select");const content=pane?.querySelector(".uni-picker-custom.uni-picker-toggle .uni-picker-content");return {visible:!!pane && getComputedStyle(pane).display!=="none",columns:content?.querySelectorAll("uni-picker-view-column").length,within:content?.getBoundingClientRect().height<=260}})()');
    assert.equal(pickerOpen.visible,true);assert.equal(pickerOpen.columns,3);assert.equal(pickerOpen.within,true);
    fs.writeFileSync(path.join(root,'.local/date-picker-mobile-preview.png'),(await ui.webContents.capturePage()).toPNG());
    await ui.webContents.executeJavaScript('document.querySelector(".uni-picker-container.uni-date-select .uni-picker-action-cancel").click()');
    await new Promise(resolve=>setTimeout(resolve,350));
    await ui.webContents.executeJavaScript('document.querySelector(".inline-editor .editor-actions > :last-child").click()');
    assert.equal(await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureScheduleSaveClicks'),3,'日期外观预览不存储');
    ui.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,250));
    ui.webContents.send('suixing:snapshot', {region:'cn',result:textReloaded});
    const keyboard = await ui.webContents.executeJavaScript(`(async()=>{
      const pause=()=>new Promise(resolve=>setTimeout(resolve,120));
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));await pause();
      const searchFocused=!!document.activeElement.closest('.toolbar-search');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true,cancelable:true}));await pause();
      const input=document.querySelector('.new-reminder-row input');if(!input)return {searchFocused,opened:false};
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'随行验证 · 输入法取消');input.dispatchEvent(new Event('input',{bubbles:true}));await pause();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));await pause();
      const composingKept=!!document.querySelector('.new-reminder-row');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();
      return {searchFocused,opened:true,composingKept,cancelled:!document.querySelector('.new-reminder-row')};
    })()`,true);
    assert.deepEqual(keyboard,{searchFocused:true,opened:true,composingKept:true,cancelled:true});
    assert.equal(await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureCreationClicks'),0);
    const createdTitle='随行验证 · 构建界面新增';
    assert.equal(await ui.webContents.executeJavaScript('('+createTestItem.toString()+')('+JSON.stringify({pageId:textReloaded.snapshot.pageId,listId:textReloaded.snapshot.activeListId,title:createdTitle})+')',true),true);
    let created;
    for(let attempt=0;attempt<50;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      created=await controller.execute({type:'read'},'cn');
      if(created.snapshot?.items.some(item=>item.title===createdTitle))break;
    }
    assert.equal(created.snapshot?.items.filter(item=>item.title===createdTitle).length,1);
    const outcome=controller.lastWriteOutcome();
    assert.equal(outcome.type,'createItem');
    assert.equal(outcome.code,'WEB_STATE_OBSERVED');
    assert.equal(outcome.stage,'observed');
    assert.equal(outcome.replyPending,false);
    assert.equal(outcome.dispatched,true);
    assert.equal(outcome.cloudConfirmed,false);
    assert.equal(await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureCreationClicks'),1);
    for(let attempt=0;attempt<30;attempt++) {
      const autosaves=await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureCreationAutosaves');
      if(autosaves===1)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureCreationAutosaves'),1);
    await controller.window().webContents.executeJavaScript('location.reload()');
    for(let attempt=0;attempt<30;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      created=await controller.execute({type:'read'},'cn');
      if(created.snapshot?.items.some(item=>item.title===createdTitle))break;
    }
    assert.equal(created.snapshot?.items.filter(item=>item.title===createdTitle).length,1);
    assert.deepEqual(controller.lastWriteOutcome(),outcome,'后续只读操作不能抹掉实际写入阶段');
    console.log('顶栏新增及搜索快捷键、输入法取消和单次新增重载保持验证通过。');
    // 普通窗口不带开发参数，使用正式 IPC 与隐藏官方容器完成同一创建流程。
    normalController=createController({fixtureURL:'http://127.0.0.1:'+server.address().port+'/'});
    let normalSnapshot;
    for(let attempt=0;attempt<30;attempt++) {
      normalSnapshot=await normalController.execute({type:'read'},'cn');
      if(normalSnapshot.ok)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(normalSnapshot.ok,true);
    assert.equal(normalController.window().isVisible(),false);
    assert.equal(normalController.window().webContents.getBackgroundThrottling(),false);
    stopIPC();
    normalUI = new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    normalUI.webContents.on('console-message',event=>{if(event.level==='error')uiErrors.push(event.message);});
    stopIPC=installDesktopIPC({ipcMain,controller:normalController,getMainWindow:()=>normalUI});
    await normalUI.loadURL(frontendURL);
    await normalUI.webContents.executeJavaScript('new Promise(resolve=>{const timer=setInterval(()=>{if(document.querySelector(".demo-link")){clearInterval(timer);resolve(true)}},30)})');
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:normalSnapshot});
    assert.equal(await normalUI.webContents.executeJavaScript('window.suixingDesktop.capabilities.createItem'),true);
    const normalTitle='随行验证 · 普通模式新增';
    assert.equal(await normalUI.webContents.executeJavaScript('('+createTestItem.toString()+')('+JSON.stringify({pageId:normalSnapshot.snapshot.pageId,listId:normalSnapshot.snapshot.activeListId,title:normalTitle})+')',true),true);
    for(let attempt=0;attempt<40;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      normalSnapshot=await normalController.execute({type:'read'},'cn');
      const saves=await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureCreationAutosaves');
      if(normalSnapshot.snapshot?.items.some(item=>item.title===normalTitle)&&saves===1)break;
    }
    assert.equal(normalSnapshot.snapshot?.items.filter(item=>item.title===normalTitle).length,1);
    for(const value of [{date:'2030-01-15',time:'14:35',timeZone:zone},{date:null,time:null,timeZone:null}]) {
      if (value.date===null) {
        await normalController.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;w.fixtureScheduleOmitLoadedDate=true;w.renderFixture("one")})()');
        normalSnapshot=await normalController.execute({type:'read'},'cn');
        const item=normalSnapshot.snapshot.items.find(item=>item.title===normalTitle);
        assert.equal(item.schedule,null);
        const details=await normalController.execute({type:'getSchedule',pageId:normalSnapshot.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed},'cn');
        assert.equal(details.scheduleSource,'official-details');assert.equal(details.schedule.time,'14:35');
      }
      const target=normalSnapshot.snapshot.items.find(item=>item.title===normalTitle);
      normalUI.webContents.send('suixing:snapshot',{region:'cn',result:normalSnapshot});
      assert.equal(await normalUI.webContents.executeJavaScript('('+editTestSchedule.toString()+')('+JSON.stringify({pageId:normalSnapshot.snapshot.pageId,listId:target.listId,id:target.id,completed:target.completed,value})+')',true),true);
      let actual;
      for(let attempt=0;attempt<60;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,100));
        normalSnapshot=await normalController.execute({type:'read'},'cn');
        const item=normalSnapshot.snapshot?.items.find(item=>item.title===normalTitle);if (!item) continue;
        actual=await normalController.execute({type:'getSchedule',pageId:normalSnapshot.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed},'cn');
        if (JSON.stringify(actual.schedule)===JSON.stringify(value)) break;
      }
      assert.deepEqual(actual.schedule,value);
    }
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureScheduleSaveClicks'),2);
    await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureScheduleOmitLoadedDate=false');
    console.log('普通模式日期字段缺失时经官方详情只读并取消，单次清除后再次打开详情核对且取消通过。');
    assert.equal(normalController.lastWriteOutcome(),null,'普通模式日期读写不依赖开发诊断');
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureCreationClicks'),1);
    assert.equal(normalController.lastWriteOutcome(),null,'普通窗口不启用开发诊断');
    await normalController.window().webContents.executeJavaScript('location.reload()');
    for(let attempt=0;attempt<30;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      normalSnapshot=await normalController.execute({type:'read'},'cn');
      if(normalSnapshot.snapshot?.items.some(item=>item.title===normalTitle))break;
    }
    assert.equal(normalSnapshot.snapshot?.items.filter(item=>item.title===normalTitle).length,1);
    const beforeOffline=normalSnapshot.snapshot;
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:normalSnapshot});
    await new Promise(resolve=>setTimeout(resolve,120));
    const offlineTarget=normalSnapshot.snapshot.items.find(item=>item.title===normalTitle);
    await normalController.window().webContents.executeJavaScript('Object.defineProperty(navigator,"onLine",{get:()=>undefined,configurable:true})');
    try {
      assert.equal((await normalController.execute({type:'read'},'cn')).code,'PAGE_NOT_READY');
      const unknownWrite=await normalController.execute({type:'setCompleted',pageId:beforeOffline.pageId,listId:offlineTarget.listId,id:offlineTarget.id,fingerprint:offlineTarget.fingerprint,expectedCompleted:offlineTarget.completed,completed:!offlineTarget.completed},'cn');
      assert.equal(unknownWrite.code,'CONNECTION_UNAVAILABLE');assert.equal(unknownWrite.dispatched,false);
      assert.equal((await normalController.reconnectSite('cn')).code,'PAGE_NOT_READY');
    } finally {await normalController.window().webContents.executeJavaScript('delete navigator.onLine');}
    await normalUI.webContents.executeJavaScript('([...document.querySelectorAll(".reminder-row")].find(row=>row.dataset.recordId==='+JSON.stringify(offlineTarget.id)+')).querySelector(".edit-title-button").click()');
    assert.equal(await normalUI.webContents.executeJavaScript('new Promise(resolve=>{const deadline=Date.now()+3000;const timer=setInterval(()=>{const input=document.querySelector(".inline-editor input");if(input){clearInterval(timer);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"随行验证 · 离线草稿");input.dispatchEvent(new Event("input",{bubbles:true}));resolve(true)}else if(Date.now()>deadline){clearInterval(timer);resolve(false)}},20)})'),true);
    const offlineCountsScript='(()=>{const w=document.querySelector("iframe").contentWindow;return {text:w.fixtureTextSaves,completed:w.fixtureClicks,dates:w.fixtureScheduleSaveClicks,created:w.fixtureCreationClicks}})()';
    const beforeOfflineCounts=await normalController.window().webContents.executeJavaScript(offlineCountsScript);
    const offlineServerPort=server.address().port;let offlineNavigations=0;
    const offlineNavigated=()=>offlineNavigations++;
    normalController.window().webContents.on('did-navigate',offlineNavigated);
    try {
      server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));
      console.log('离线流程：合成服务已停止。');
      let state;
      for(let attempt=0;attempt<20;attempt++){state=await normalController.connectionState('cn',true);if(['offline','unavailable'].includes(state.state))break;await new Promise(resolve=>setTimeout(resolve,100));}
      assert.ok(['offline','unavailable'].includes(state.state),'会话模拟断网未被识别：'+state.state);
      console.log('离线流程：连接状态为 '+state.state+'。');
      assert.equal(await normalUI.webContents.executeJavaScript('new Promise(resolve=>{const deadline=Date.now()+4000;const timer=setInterval(()=>{if(["offline","unavailable"].includes(document.querySelector(".network-notice")?.dataset.state)){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);resolve(false)}},50)})'),true);
      console.log('离线流程：界面已显示不可用。');
      const cached=await normalUI.webContents.executeJavaScript('({live:document.querySelector(".list-content")?.dataset.live,pageId:document.querySelector(".list-content")?.dataset.pageId,draft:document.querySelector(".inline-editor input")?.value ?? null,blocked:document.querySelector(".save-edit")?.hasAttribute("disabled") ?? false,recovery:!!document.querySelector(".edit-recovery")})');
      assert.deepEqual(cached,{live:'false',pageId:beforeOffline.pageId,draft:'随行验证 · 离线草稿',blocked:true,recovery:true});
      console.log('离线流程：缓存与草稿保持只读。');
      const denied=await normalController.execute({type:'setCompleted',pageId:beforeOffline.pageId,listId:offlineTarget.listId,id:offlineTarget.id,fingerprint:offlineTarget.fingerprint,expectedCompleted:offlineTarget.completed,completed:!offlineTarget.completed},'cn');
      assert.ok(['OFFLINE','CONNECTION_UNAVAILABLE'].includes(denied.code));assert.equal(denied.dispatched,false);
      console.log('离线流程：写入已被拒绝。');
      assert.ok(['OFFLINE','CONNECTION_UNAVAILABLE'].includes((await normalController.reconnectSite('cn')).code));assert.equal(offlineNavigations,0);
      console.log('离线流程：重连未导航。');
      assert.deepEqual(await normalController.window().webContents.executeJavaScript(offlineCountsScript),beforeOfflineCounts);
      normalUI.show();normalUI.focus();normalUI.webContents.focus();
      await normalUI.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      fs.writeFileSync(path.join(root,'.local/offline-desktop-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    } finally {if(!server.listening)await new Promise(resolve=>server.listen(offlineServerPort,'127.0.0.1',resolve));normalController.window().webContents.removeListener('did-navigate',offlineNavigated);}
    assert.equal((await normalController.connectionState('cn',true)).state,'available');
    console.log('离线流程：服务已恢复。');
    assert.equal(await normalUI.webContents.executeJavaScript('new Promise(resolve=>{const deadline=Date.now()+4000;const timer=setInterval(()=>{if(document.querySelector(".network-notice")?.dataset.state==="read-required"){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);resolve(false)}},50)})'),true);
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'false');
    assert.deepEqual(await normalController.window().webContents.executeJavaScript(offlineCountsScript),beforeOfflineCounts);
    assert.equal(await normalUI.webContents.executeJavaScript('(()=>{const end=document.querySelector(".end-blocked-edit"),refresh=document.querySelector(".refresh-button");if(!end || !refresh)return false;end.click();refresh.click();return true;})()'),true);
    assert.equal(await normalUI.webContents.executeJavaScript('new Promise(resolve=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{if(document.querySelector(".list-content")?.dataset.live==="true" && !document.querySelector(".network-notice")){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);resolve(false)}},50)})'),true);
    normalSnapshot=await normalController.execute({type:'read'},'cn');
    assert.notEqual(normalSnapshot.snapshot.pageId,beforeOffline.pageId);assert.equal(normalSnapshot.snapshot.items.filter(item=>item.title===normalTitle).length,1);
    assert.deepEqual(await normalController.window().webContents.executeJavaScript(offlineCountsScript),beforeOfflineCounts);
    console.log('合成服务停止时联网标志仍为真，公开资源检查拒绝写入/导航、保留显示及本地草稿；恢复不重放、显式刷新换新句柄后恢复通过。');
    const beforeReconnect=normalSnapshot.snapshot;
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:normalSnapshot});
    await new Promise(resolve=>setTimeout(resolve,100));normalUI.show();normalUI.focus();normalUI.webContents.focus();
    await normalUI.webContents.executeJavaScript('document.querySelector(".reconnect-button").focus()');
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await normalUI.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+7000;const timer=setInterval(()=>{const list=document.querySelector(".list-content"),button=document.querySelector(".reconnect-button");if(list?.dataset.pageId!=='+JSON.stringify(beforeReconnect.pageId)+' && button && !button.hasAttribute("disabled")){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("重新连接未完成"))}},50)})');
    const afterReconnect=await normalController.execute({type:'read'},'cn');
    assert.notEqual(afterReconnect.snapshot.pageId,beforeReconnect.pageId);
    const content=items=>items.map(({id,title,notes,completed,flagged,schedule,priority})=>({id,title,notes,completed,flagged,schedule,priority}));
    assert.deepEqual(content(afterReconnect.snapshot.items),content(beforeReconnect.items));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'false','同名清单不能自动猜测身份并开放写入');
    assert.ok((await normalUI.webContents.executeJavaScript('document.querySelector(".notice").textContent')).includes('重新选择清单'));
    await normalUI.webContents.executeJavaScript('document.querySelector(".list-button").click()');
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'true','用户明确选定新清单后才恢复写入');
    console.log('普通模式重新连接经键盘与正式 IPC 完成，同名清单只读保护及新句柄选择通过，事项内容未变。');
    const beforeUnloadCheck=await normalController.execute({type:'read'},'cn');normalUI.webContents.send('suixing:snapshot',{region:'cn',result:beforeUnloadCheck});await new Promise(resolve=>setTimeout(resolve,100));
    await normalController.window().webContents.executeJavaScript('window.fixtureBeforeUnload=event=>{event.preventDefault();event.returnValue="";};addEventListener("beforeunload",window.fixtureBeforeUnload);',true);
    const unloadResult=await normalUI.webContents.executeJavaScript('('+reconnectTestClient.toString()+')('+JSON.stringify({pageId:beforeUnloadCheck.snapshot.pageId,listId:beforeUnloadCheck.snapshot.activeListId,title:beforeUnloadCheck.snapshot.activeListTitle,details:true})+')',true);
    assert.equal(unloadResult.reason,'UI_ERROR');assert.equal(unloadResult.kind,'OFFICIAL_PAGE_BUSY');assert.equal(unloadResult.stage,'home');
    assert.equal(normalController.window().isDestroyed(),false);assert.equal((await normalController.execute({type:'read'},'cn')).snapshot.pageId,beforeUnloadCheck.snapshot.pageId);
    await normalController.window().webContents.executeJavaScript('removeEventListener("beforeunload",window.fixtureBeforeUnload);delete window.fixtureBeforeUnload;');
    await normalUI.webContents.executeJavaScript('document.querySelector(".refresh-button").click()');await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'true');
    console.log('官方 beforeunload 阻止离开时保留原窗口、固定阶段及只读状态，不强制忽略或继续导航，结束阻止后刷新恢复通过。');
    const hierarchyBefore=await normalController.execute({type:'read'},'cn'),hierarchyTarget=hierarchyBefore.snapshot.items.find(item=>item.title===normalTitle);
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:hierarchyBefore});await new Promise(resolve=>setTimeout(resolve,100));
    let hierarchyExpected={pageId:hierarchyBefore.snapshot.pageId,listId:hierarchyTarget.listId,id:hierarchyTarget.id,title:normalTitle};
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestSubtask.toString()+')('+JSON.stringify({...hierarchyExpected,preview:true})+')',true),true);
    assert.equal(await normalUI.webContents.executeJavaScript('document.activeElement.classList.contains("cancel-subtask")'),true);
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureSubtaskKeys || 0'),0);
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestSubtask.toString()+')('+JSON.stringify({...hierarchyExpected,preview:true})+')',true),true);
    normalUI.setContentSize(390,780);await new Promise(resolve=>setTimeout(resolve,150));
    const subtaskBounds=await normalUI.webContents.executeJavaScript('(()=>{const r=document.querySelector(".subtask-confirmation").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');
    assert.ok(subtaskBounds.left>=0 && subtaskBounds.right<=subtaskBounds.width+1);
    fs.writeFileSync(path.join(root,'.local/subtask-confirmation-mobile-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('document.activeElement.classList.contains("subtask-item-button")'),true);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureSubtaskKeys || 0'),0);
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestSubtask.toString()+')('+JSON.stringify(hierarchyExpected)+')',true),true);
    let nested;
    for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));nested=await normalController.execute({type:'read'},'cn');if(nested.snapshot?.items.find(item=>item.id===hierarchyTarget.id)?.level===2)break;}
    assert.equal(nested.snapshot.items.find(item=>item.id===hierarchyTarget.id).level,2);assert.deepEqual(content(nested.snapshot.items),content(hierarchyBefore.snapshot.items));
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureSubtaskKeys'),1);
    fs.writeFileSync(path.join(root,'.local/subtask-row-mobile-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    normalController.reloadSite('cn');
    for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,100));nested=await normalController.execute({type:'read'},'cn');if(nested.ok)break;}
    assert.equal(nested.snapshot.items.find(item=>item.id===hierarchyTarget.id).level,2);
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:nested});await new Promise(resolve=>setTimeout(resolve,100));
    hierarchyExpected={...hierarchyExpected,pageId:nested.snapshot.pageId,listId:nested.snapshot.activeListId};
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestSubtask.toString()+')('+JSON.stringify(hierarchyExpected)+')',true),true);
    let restoredHierarchy;
    for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));restoredHierarchy=await normalController.execute({type:'read'},'cn');if(restoredHierarchy.snapshot?.items.find(item=>item.id===hierarchyTarget.id)?.level===1)break;}
    assert.equal(restoredHierarchy.snapshot.items.find(item=>item.id===hierarchyTarget.id).parentId,null);assert.deepEqual(content(restoredHierarchy.snapshot.items),content(hierarchyBefore.snapshot.items));
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureSubtaskKeys'),1);
    normalUI.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,100));
    console.log('子事项经正式 IPC 缩进/提升各一次，默认回车与 Esc 取消、焦点恢复、字段保持、两级显示及合成重载通过。');
    const deletionBefore=await normalController.execute({type:'read'},'cn');
    const deletionTarget=deletionBefore.snapshot.items.find(item=>item.title===normalTitle);
    assert.ok(deletionTarget);
    const deletionExpected={pageId:deletionBefore.snapshot.pageId,listId:deletionTarget.listId,id:deletionTarget.id,title:normalTitle};
    const deletionRemaining=deletionBefore.snapshot.items.filter(item=>item.id!==deletionTarget.id).map(item=>item.fingerprint);
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:deletionBefore});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestItem.toString()+')('+JSON.stringify({...deletionExpected,preview:true})+')',true),true);
    assert.equal(await normalUI.webContents.executeJavaScript('document.activeElement.classList.contains("cancel-delete")'),true,'删除确认默认聚焦取消');
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('!!document.querySelector(".delete-confirmation")'),false);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureDeleteKeys'),0,'默认回车取消，不删除');
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestItem.toString()+')('+JSON.stringify({...deletionExpected,preview:true})+')',true),true);
    normalUI.setContentSize(390,780);await new Promise(resolve=>setTimeout(resolve,150));
    const deletionBounds=await normalUI.webContents.executeJavaScript('(()=>{const r=document.querySelector(".delete-confirmation").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');
    assert.ok(deletionBounds.left>=0 && deletionBounds.right<=deletionBounds.width+1);
    fs.writeFileSync(path.join(root,'.local/delete-confirmation-mobile-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureDeleteKeys'),0,'Esc 取消不删除');
    normalUI.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestItem.toString()+')('+JSON.stringify(deletionExpected)+')',true),true);
    let deletionAfter;
    for(let attempt=0;attempt<50;attempt++) {await new Promise(resolve=>setTimeout(resolve,100));deletionAfter=await normalController.execute({type:'read'},'cn');if(deletionAfter.ok && !deletionAfter.snapshot.items.some(item=>item.id===deletionTarget.id))break;}
    assert.deepEqual(deletionAfter.snapshot.items.map(item=>item.fingerprint),deletionRemaining);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureDeleteKeys'),1);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureDeletionCount'),1);
    assert.equal(normalController.lastWriteOutcome(),null);
    normalController.reloadSite('cn');
    for(let attempt=0;attempt<40;attempt++) {await new Promise(resolve=>setTimeout(resolve,100));deletionAfter=await normalController.execute({type:'read'},'cn');if(deletionAfter.ok)break;}
    assert.equal(deletionAfter.ok,true);assert.equal(deletionAfter.snapshot.items.some(item=>item.id===deletionTarget.id),false);
    console.log('普通模式删除经预检及确认一次提交，默认回车和 Esc 均可取消，窄屏布局、其他事项保持及合成重载通过。');
    await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentDocument.querySelector("[role=treeitem][aria-selected=true] .inline-editable-label").textContent="随行验证 · 合成原清单"');
    const listBefore=await normalController.execute({type:'read'},'cn'),listTitle='随行验证 · 普通模式新清单',renamedListTitle=listTitle+' · 改名';
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:listBefore});await new Promise(resolve=>setTimeout(resolve,100));
    const listExpected={pageId:listBefore.snapshot.pageId,listId:listBefore.snapshot.activeListId,title:listBefore.snapshot.activeListTitle,operation:'create',value:listTitle};
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestList.toString()+')('+JSON.stringify({...listExpected,cancel:true})+')',true),true);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListSaves'),0);
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestList.toString()+')('+JSON.stringify({...listExpected,preview:true})+')',true),true);
    await normalUI.webContents.executeJavaScript('document.querySelector(".list-name-input input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}))');
    assert.equal(await normalUI.webContents.executeJavaScript('!!document.querySelector(".list-editor")'),true);
    normalUI.setContentSize(390,780);await new Promise(resolve=>setTimeout(resolve,150));
    const listEditorBounds=await normalUI.webContents.executeJavaScript('(()=>{const r=document.querySelector(".list-editor").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');
    assert.ok(listEditorBounds.left>=0 && listEditorBounds.right<=listEditorBounds.width+1);
    fs.writeFileSync(path.join(root,'.local/list-editor-mobile-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    let listCreated;
    for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));listCreated=await normalController.execute({type:'read'},'cn');if(listCreated.snapshot?.activeListTitle===listTitle)break;}
    assert.equal(listCreated.snapshot.activeListTitle,listTitle);assert.equal(listCreated.snapshot.items.length,0);assert.equal(listCreated.snapshot.lists.length,listBefore.snapshot.lists.length+1);
    for(const old of listBefore.snapshot.lists)assert.ok(listCreated.snapshot.lists.some(list=>list.fingerprint===old.fingerprint));
    normalUI.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,100));
    let listChanged=listCreated;
    for(const value of [renamedListTitle,listTitle]) {
      assert.equal(await normalUI.webContents.executeJavaScript('('+editTestList.toString()+')('+JSON.stringify({pageId:listChanged.snapshot.pageId,listId:listChanged.snapshot.activeListId,title:listChanged.snapshot.activeListTitle,operation:'rename',value})+')',true),true);
      for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));listChanged=await normalController.execute({type:'read'},'cn');if(listChanged.snapshot?.activeListTitle===value)break;}
      assert.equal(listChanged.snapshot.activeListId,listCreated.snapshot.activeListId);assert.equal(listChanged.snapshot.activeListTitle,value);assert.equal(listChanged.snapshot.items.length,0);
    }
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListSaves'),3);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListInputs'),3);
    normalController.reloadSite('cn');
    for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,100));listChanged=await normalController.execute({type:'read'},'cn');if(listChanged.ok)break;}
    assert.equal(listChanged.snapshot.lists.filter(list=>list.title===listTitle).length,1);assert.equal(normalController.lastWriteOutcome(),null);
    console.log('普通模式清单新增与重命名经正式 IPC 各提交一次，取消及输入法保护、窄屏布局和合成重载保持通过。');
    const appearanceTarget=listChanged.snapshot.lists.find(list=>list.title===listTitle);
    let appearanceSnapshot=await normalController.execute({type:'selectList',pageId:listChanged.snapshot.pageId,listId:appearanceTarget.id},'cn');
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:appearanceSnapshot});await new Promise(resolve=>setTimeout(resolve,100));
    const appearanceView=await normalController.execute({type:'getListAppearance',pageId:appearanceSnapshot.snapshot.pageId,listId:appearanceTarget.id,expectedListFingerprint:appearanceTarget.fingerprint},'cn');
    assert.equal(appearanceView.code,'LIST_APPEARANCE_READY');const palette=appearanceView.appearance;
    const appearanceExpected={pageId:appearanceSnapshot.snapshot.pageId,listId:appearanceTarget.id,title:listTitle,color:palette.colors[1].key,iconKey:palette.icons[2].key};
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestListAppearance.toString()+')('+JSON.stringify({...appearanceExpected,cancel:true})+')',true),true);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListSaves'),0);
    assert.equal(await normalUI.webContents.executeJavaScript('('+editTestListAppearance.toString()+')('+JSON.stringify({...appearanceExpected,preview:true})+')',true),true);
    normalUI.setContentSize(390,780);await new Promise(resolve=>setTimeout(resolve,150));
    const appearanceBounds=await normalUI.webContents.executeJavaScript('(()=>{const r=document.querySelector(".appearance-editor").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,images:[...document.querySelectorAll(".appearance-editor img")].every(img=>img.complete && img.naturalWidth>0)}})()');
    assert.ok(appearanceBounds.left>=0 && appearanceBounds.right<=appearanceBounds.width+1);assert.equal(appearanceBounds.images,true);
    fs.writeFileSync(path.join(root,'.local/list-appearance-mobile-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    await normalUI.webContents.executeJavaScript('document.querySelector(".icon-choice[aria-checked=true]").focus()');
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".icon-choice").getAttribute("aria-checked")'),'true');
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await normalUI.webContents.executeJavaScript('document.activeElement.getAttribute("aria-checked")'),'true');
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('!!document.querySelector(".appearance-editor")'),false);
    normalUI.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,100));
    for(const desired of [appearanceExpected,{...appearanceExpected,color:palette.color,iconKey:palette.iconKey}]) {
      assert.equal(await normalUI.webContents.executeJavaScript('('+editTestListAppearance.toString()+')('+JSON.stringify(desired)+')',true),true);
      for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));appearanceSnapshot=await normalController.execute({type:'read'},'cn');const target=appearanceSnapshot.snapshot?.lists.find(list=>list.id===appearanceTarget.id);if(target?.color===desired.color && target.icon?.key===desired.iconKey)break;}
      const target=appearanceSnapshot.snapshot.lists.find(list=>list.id===appearanceTarget.id);assert.equal(target.color,desired.color);assert.equal(target.icon.key,desired.iconKey);
      normalUI.webContents.send('suixing:snapshot',{region:'cn',result:appearanceSnapshot});await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListSaves'),2);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListInputs'),0);
    normalController.reloadSite('cn');
    for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,100));listChanged=await normalController.execute({type:'read'},'cn');if(listChanged.ok)break;}
    assert.equal(listChanged.snapshot.lists.find(list=>list.title===listTitle).icon.key,palette.iconKey);
    console.log('清单颜色/图标经正式 IPC 各单次保存与恢复，取消不保存、静态图片预览、键盘单选组、窄屏及合成重载通过。');
    const removeList=listChanged.snapshot.lists.find(list=>list.title===listTitle);
    const selectedForDelete=await normalController.execute({type:'selectList',pageId:listChanged.snapshot.pageId,listId:removeList.id},'cn');
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:selectedForDelete});await new Promise(resolve=>setTimeout(resolve,100));
    const deleteListExpected={pageId:selectedForDelete.snapshot.pageId,listId:removeList.id,title:listTitle};
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestList.toString()+')('+JSON.stringify({...deleteListExpected,preview:true})+')',true),true);
    assert.equal(await normalUI.webContents.executeJavaScript('document.activeElement.classList.contains("cancel-list-delete")'),true);
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListDeleteMenus'),0,'本地取消不打开官方删除确认');
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestList.toString()+')('+JSON.stringify({...deleteListExpected,preview:true})+')',true),true);
    normalUI.setContentSize(390,780);await new Promise(resolve=>setTimeout(resolve,150));
    const listDeleteBounds=await normalUI.webContents.executeJavaScript('(()=>{const r=document.querySelector(".list-delete-confirmation").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');
    assert.ok(listDeleteBounds.left>=0 && listDeleteBounds.right<=listDeleteBounds.width+1);
    fs.writeFileSync(path.join(root,'.local/list-delete-mobile-preview.png'),(await normalUI.webContents.capturePage()).toPNG());
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(resolve=>setTimeout(resolve,100));
    normalUI.setContentSize(1160,830);await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestList.toString()+')('+JSON.stringify(deleteListExpected)+')',true),true);
    let navigation;
    for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));navigation=await normalController.execute({type:'readLists'},'cn');if(navigation.ok && !navigation.snapshot.lists.some(list=>list.id===removeList.id))break;}
    assert.equal(navigation.snapshot.lists.length,2);assert.equal(navigation.snapshot.activeListId,null);assert.equal(navigation.snapshot.items.length,0);
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureListDeleteCommits'),1);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'false');
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelectorAll(".reminder-row").length'),0,'删除后不自动展示其他清单事项');
    await normalController.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;w.fixtureFallbackFieldReads=0;w.document.querySelectorAll(".reminder-item").forEach(row=>{row.fixtureOriginalQuery=row.querySelector;row.querySelector=function(selector){if(selector.includes(".title"))w.fixtureFallbackFieldReads++;return this.fixtureOriginalQuery(selector)}})})()');
    await normalUI.webContents.executeJavaScript('document.querySelector(".refresh-button").click()');await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelectorAll(".reminder-row").length'),0,'需要选择清单时刷新只更新导航');
    assert.equal(await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureFallbackFieldReads'),0,'刷新不能读取官网自动改选清单的事项字段');
    await normalController.window().webContents.executeJavaScript('document.querySelector("iframe").contentDocument.querySelectorAll(".reminder-item").forEach(row=>{row.querySelector=row.fixtureOriginalQuery;delete row.fixtureOriginalQuery;})');
    const nextList=navigation.snapshot.lists[0];
    await normalUI.webContents.executeJavaScript('document.querySelector('+JSON.stringify('.list-button[data-list-id="'+nextList.id+'"]')+').click()');
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'true','明确选择另一清单后恢复编辑');
    // 合成空账户场景；只改变本地固定夹具，不删除真实清单。
    await normalController.window().webContents.executeJavaScript('(()=>{const w=document.querySelector("iframe").contentWindow;w.sessionStorage.setItem("fixture-deleted-lists",JSON.stringify(["one","two"]));w.document.querySelector("[role=tree]").remove();w.document.querySelector("[role=treegrid]").innerHTML="";const note=w.document.createElement("div");note.className="no-lists-note";w.document.body.append(note)})()');
    const emptyAccount=await normalController.execute({type:'read'},'cn');assert.equal(emptyAccount.snapshot.emptyAccount,true);
    normalUI.webContents.send('suixing:snapshot',{region:'cn',result:emptyAccount});await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".account-title").textContent'),'已连接 iCloud');
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".add-list-button").hasAttribute("disabled")'),false);
    await normalUI.webContents.executeJavaScript('document.querySelector(".empty-add").click()');await new Promise(resolve=>setTimeout(resolve,100));
    const firstListTitle='随行验证 · 空账户首份清单';
    await normalUI.webContents.executeJavaScript('(()=>{const input=document.querySelector(".list-name-input input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(firstListTitle)+');input.dispatchEvent(new Event("input",{bubbles:true}))})()');
    normalUI.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});normalUI.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    let firstList;
    for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));firstList=await normalController.execute({type:'read'},'cn');if(firstList.snapshot?.activeListTitle===firstListTitle)break;}
    assert.equal(firstList.snapshot.lists.length,1);assert.equal(firstList.snapshot.activeListTitle,firstListTitle);
    assert.equal(await normalUI.webContents.executeJavaScript('document.querySelector(".list-content").dataset.live'),'true','空账户新建后解除选择保护');
    assert.equal(await normalUI.webContents.executeJavaScript('('+deleteTestList.toString()+')('+JSON.stringify({pageId:firstList.snapshot.pageId,listId:firstList.snapshot.activeListId,title:firstListTitle})+')',true),true);
    for(let attempt=0;attempt<50;attempt++){await new Promise(resolve=>setTimeout(resolve,100));navigation=await normalController.execute({type:'readLists'},'cn');if(navigation.snapshot?.emptyAccount)break;}
    assert.equal(navigation.snapshot.emptyAccount,true);assert.equal(navigation.snapshot.lists.length,0);
    normalController.reloadSite('cn');
    for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,100));navigation=await normalController.execute({type:'read'},'cn');if(navigation.snapshot?.emptyAccount)break;}
    assert.equal(navigation.snapshot.emptyAccount,true);assert.equal(normalController.lastWriteOutcome(),null);
    console.log('清单删除经本地与官方确认单次提交，取消、其他清单保护、删除后显式选择、空账户新增与删除最后清单及合成重载通过。');
    stopIPC();
    normalUI.destroy();normalUI=null;
    normalController.dispose();normalController=null;
    stopIPC=installDesktopIPC({ipcMain,controller,getMainWindow:()=>ui});
    console.log('普通模式使用正式 IPC，隐藏官方容器自动保存与重载保持通过。');
    await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureNavigateOnCreate=true');
    const interrupted=await controller.execute({type:'createItem',pageId:created.snapshot.pageId,listId:created.snapshot.activeListId,title:'随行验证 · 页面退出对照',requestId:'smoke-create-navigation'},'cn');
    assert.equal(interrupted.code,'UNCERTAIN_WRITE');
    const interruptedOutcome=controller.lastWriteOutcome();
    assert.equal(interruptedOutcome.code,'UNCERTAIN_WRITE');
    assert.equal(interruptedOutcome.stage,'waiting-draft','页面上下文退出后仍应保留退出前最后阶段');
    assert.notEqual(interruptedOutcome.dispatched,false,'已派发或未知都不能诊断为没有派发');
    assert.equal(interruptedOutcome.cloudConfirmed,false);
    console.log('页面退出后保留不含正文的写入阶段，不把未知派发记录为未派发。');
    await controller.window().webContents.loadURL('http://127.0.0.1:' + server.address().port + '/home');
    const returned = once(controller.window().webContents, 'did-finish-load');
    assert.equal(controller.reloadSite('cn').ok, true);
    await returned;
    assert.equal(new URL(controller.window().webContents.getURL()).pathname, '/');
    console.log('偏离提醒事项入口后重载回到固定入口验证通过。');
    // 读写回归已进入清单页，重新加载本地界面后再从欢迎页进入明确标识的示例模式。
    await ui.loadURL(frontendURL);
    await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+8000;const timer=setInterval(()=>{const b=document.querySelector(".demo-link");if(b){clearInterval(timer);b.click();resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("示例入口未完成加载"))}},50)})');
    // 图形回归在真实窗口中刷新合成数据，避免隐藏窗口捕获到尺寸改变前的旧合成帧。
    ui.showInactive();
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(root, '.local/desktop-preview.png'), (await ui.webContents.capturePage()).toPNG());
    ui.setContentSize(390, 844);
    await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{const r=document.querySelector(".sidebar").getBoundingClientRect();if(r.right<=1){clearInterval(timer);requestAnimationFrame(()=>requestAnimationFrame(resolve))}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("窄屏侧栏没有退出内容区域"))}},50)})');
    const layout = await ui.webContents.executeJavaScript('({width:innerWidth,media:matchMedia("(max-width:760px)").matches,sidebarPosition:getComputedStyle(document.querySelector(".sidebar")).position,sidebarRight:document.querySelector(".sidebar").getBoundingClientRect().right,scrollWidth:document.body.scrollWidth})');
    console.log('窄屏布局状态：' + JSON.stringify(layout));
    assert.equal(layout.media, true);
    assert.equal(layout.sidebarPosition, 'fixed');
    assert.ok(layout.sidebarRight <= 1);
    assert.ok(layout.scrollWidth <= layout.width + 1);
    const bounds = await ui.webContents.executeJavaScript('Object.fromEntries([".workspace",".notice",".list-content",".list-controls",".search",".reminder-row",".reminder-copy"].map(s=>{const n=document.querySelector(s);const r=n.getBoundingClientRect();return [s,{left:r.left,right:r.right,width:r.width,scroll:n.scrollWidth}]}))');
    console.log('窄屏内容范围：' + JSON.stringify(bounds));
    for (const [selector, rect] of Object.entries(bounds)) {
      assert.ok(rect.left >= -1 && rect.right <= layout.width + 1, selector + ' 不能超出窄屏内容区');
      assert.ok(rect.scroll <= Math.ceil(rect.width) + 1, selector + ' 不能横向裁切内容');
    }
    fs.writeFileSync(path.join(root, '.local/mobile-preview.png'), (await ui.webContents.capturePage()).toPNG());
    assert.deepEqual(uiErrors,[],'合成检查不得忽略本地界面的脚本错误');
    const report = {
      passed: true, kind: 'Electron 合成验证，不代表真实 iCloud 或真机验收',
      checks: ['跨站 iframe 浏览器标识', '只读子页面诊断', '同源 iframe 读取', '同名事项按记录 ID 操作', '完成状态重载保持', '旧页面句柄失效', '构建界面加载', '服务区域恢复', '正式 IPC 主框架校验', '构建界面完成及取消完成各派发一次', '已完成页签展开官方隐藏事项且重复不反转', '标题和备注各保存一次及合成重载保持', '顶栏新增与搜索快捷键', '输入法取消不创建', '新增单次输入和官方自动保存', '普通模式隐藏官方容器新增与重载保持', '页面退出后保留固定阶段回执', '固定提醒事项入口恢复', '页面无 Node 权限', '桌面与手机宽度布局'],
      capturedAt: new Date().toISOString()
    };
    report.checks.push('日期编辑器单次设置全天、指定时间及清除');
    report.checks.push('普通模式隐藏官方窗口日期读写');
    report.checks.push('日期编辑器窄屏布局、选择器展开与取消');
    report.checks.push('本地清单排序、原顺序恢复、设置恢复及窄屏入口');
    report.checks.push('排序下拉框 Tab 聚焦、回车展开、方向键选择和 Esc 取消');
    report.checks.push('旗标空格操作、正式 IPC 单次保存、移除及本地筛选');
    report.checks.push('普通模式重新连接、同名清单只读保护与新页面句柄');
    report.checks.push('服务不可达时保留草稿、禁止写入与导航，恢复后手动刷新且不重放');
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    fs.writeFileSync(path.join(root, '.local/desktop-smoke.json'), JSON.stringify(report, null, 2));
    console.log('桌面合成验证通过：' + report.checks.join('、'));
  } catch(error) {
    console.error(error.stack || error.message);throw error;
  } finally {
    stopIPC?.();
    ui?.destroy();
    normalUI?.destroy();
    normalController?.dispose();
    agentWindow?.destroy();
    controller.dispose();
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { runSmoke };
