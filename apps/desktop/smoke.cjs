const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { BrowserWindow, ipcMain } = require('electron');
const { createController, allowedURL, validCommand } = require('./controller.cjs');
const { browserUserAgent } = require('./policy.cjs');
const { installDesktopIPC } = require('./ipc.cjs');
const { clickTestCompletion, editTestText, createTestItem, showTestCompleted, editTestSchedule } = require('./verification-ui.cjs');

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
    ui.webContents.on('console-message', event => { if (event.level === 'error') console.error('界面错误：' + event.message); });
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
    })()`);
    const sorting=await controller.execute({type:'read'},'cn');
    const originalIds=sorting.snapshot.items.map(item=>item.id);
    ui.webContents.send('suixing:snapshot',{region:'cn',result:sorting});
    const selectSort=async label=>{
      await ui.webContents.executeJavaScript('document.querySelector(".sort-picker-label").click()');
      await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+4000;const timer=setInterval(()=>{const option=[...document.querySelectorAll(".uni-picker-select .uni-picker-item")].find(node=>node.textContent===' + JSON.stringify(label) + ');if(option){clearInterval(timer);option.click();setTimeout(resolve,80)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("排序选项未出现"))}},30)})');
    };
    const displayedIds=()=>ui.webContents.executeJavaScript('[...document.querySelectorAll(".reminder-row[data-record-id]")].map(row=>row.dataset.recordId)');
    await new Promise(resolve=>setTimeout(resolve,100));
    for(const label of ['日期：从早到晚','标题：升序']) {
      await selectSort(label);
      assert.deepEqual(await displayedIds(),originalIds.slice().reverse());
    }
    assert.equal(await ui.webContents.executeJavaScript('localStorage.getItem("suixing.settings.listSort")'),'title-ascending');
    await ui.loadURL(frontendURL);
    await ui.webContents.executeJavaScript('new Promise(resolve=>{const timer=setInterval(()=>{if(document.querySelector(".demo-link")){clearInterval(timer);resolve(true)}},30)})');
    ui.webContents.send('suixing:snapshot',{region:'cn',result:sorting});
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok((await ui.webContents.executeJavaScript('document.querySelector(".sort-picker-label").textContent')).includes('标题：升序'));
    assert.deepEqual(await displayedIds(),originalIds.slice().reverse());
    await selectSort('清单顺序');
    assert.deepEqual(await displayedIds(),originalIds);
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
    const report = {
      passed: true, kind: 'Electron 合成验证，不代表真实 iCloud 或真机验收',
      checks: ['跨站 iframe 浏览器标识', '只读子页面诊断', '同源 iframe 读取', '同名事项按记录 ID 操作', '完成状态重载保持', '旧页面句柄失效', '构建界面加载', '服务区域恢复', '正式 IPC 主框架校验', '构建界面完成及取消完成各派发一次', '已完成页签展开官方隐藏事项且重复不反转', '标题和备注各保存一次及合成重载保持', '顶栏新增与搜索快捷键', '输入法取消不创建', '新增单次输入和官方自动保存', '普通模式隐藏官方容器新增与重载保持', '页面退出后保留固定阶段回执', '固定提醒事项入口恢复', '页面无 Node 权限', '桌面与手机宽度布局'],
      capturedAt: new Date().toISOString()
    };
    report.checks.push('日期编辑器单次设置全天、指定时间及清除');
    report.checks.push('普通模式隐藏官方窗口日期读写');
    report.checks.push('日期编辑器窄屏布局、选择器展开与取消');
    report.checks.push('本地清单排序、原顺序恢复、设置恢复及窄屏入口');
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    fs.writeFileSync(path.join(root, '.local/desktop-smoke.json'), JSON.stringify(report, null, 2));
    console.log('桌面合成验证通过：' + report.checks.join('、'));
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
