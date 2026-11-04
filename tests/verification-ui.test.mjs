import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clickTestCompletion, showTestCompleted, editTestSchedule, verifyTestSorting, clickTestFlag, reconnectTestClient, deleteTestItem, editTestList, deleteTestList, selectTestListClient } = require('../apps/desktop/verification-ui.cjs');
const { testOperation, summarize } = require('../apps/desktop/live-check.cjs');
const {editTestListAppearance}=require('../apps/desktop/verification-ui.cjs');
const {editTestSubtask}=require('../apps/desktop/verification-ui.cjs');

test('日期往返专项只定位新专用事项，不回退到原日期中断事项',async()=>{
  const original={id:'original',title:'随行验证 · 最小读写验证',listId:'list',completed:false,notes:'',flagged:false,level:1};
  const snapshot={pageId:'page',activeListId:'list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'list',title:'随行验证（2026-11-04）'}],items:[original]};
  const controller={execute:async command=>{assert.equal(command.type,'read');return {ok:true,snapshot};}};
  for(const command of ['read-date-roundtrip-test-item','set-date-roundtrip-test-time','clear-date-roundtrip-test-time','delete-date-roundtrip-test-item'])assert.equal((await testOperation(controller,command,{sendSnapshot(){assert.fail('无专项事项不得发送界面操作');}})).code,'TEST_DATE_ITEM_NOT_UNIQUE');
});

test('日期专项使用正式写入回执，失败停止，不把旧状态轮询成成功',async()=>{
  const target={id:'date-test',title:'随行验证 · Windows 日期往返验证',listId:'list',completed:false,notes:'',flagged:false,level:1,fingerprint:'date-fingerprint'};
  const snapshot={pageId:'page',activeListId:'list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'list',title:'随行验证（2026-11-04）'}],items:[target]};
  let outcome=null,clicked=0;
  const controller={lastWriteOutcome:()=>outcome,execute:async command=>{if(command.type==='read')return {ok:true,snapshot};assert.equal(command.type,'getSchedule');assert.equal(command.id,'date-test');return {ok:true,snapshot,schedule:{date:null,time:null,timeZone:null},editorTimeZone:'UTC'};}};
  const result=await testOperation(controller,'set-date-roundtrip-test-time',{sendSnapshot(){},ui:{webContents:{async executeJavaScript(script){clicked++;assert.match(script,/Windows 日期往返验证/);outcome={sequence:1,ok:false,replyPending:false,code:'UNCERTAIN_WRITE',dispatched:true};return true;}}}});
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(result.dispatched,true);assert.equal(clicked,1);
});

test('日期专项汇总只含固定状态和来源，不输出日期值、标题或未知来源',()=>{
  for(const source of ['loaded-fields','official-details','synthetic-private-source']){
    const result=summarize({ok:true,code:'READY',dateTestState:'timed',dateTestSource:source,scheduleSource:source,schedule:{date:'2031-02-16',time:'10:25',timeZone:'UTC'}});
    assert.equal(result.dateTestState,'timed');assert.equal(result.dateTestSource,source.startsWith('synthetic-')?undefined:source);assert.doesNotMatch(JSON.stringify(result),/2031-02-16|10:25|synthetic-private/);
  }
});

test('子事项验收只在匹配行确认一次，取消不触发保存',async t=>{
  for(const cancel of [false,true]){
    const dom=new JSDOM('<div class="list-content" data-page-id="page" data-list-id="list"><div class="reminder-row" data-record-id="item"><div class="reminder-title">随行验证 · 合成子项</div><button class="subtask-item-button"></button></div></div>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const doc=dom.window.document;let saved=0;
    doc.querySelector('button').addEventListener('click',()=>{const editor=doc.createElement('div');editor.className='inline-editor';editor.innerHTML='<div class="subtask-confirmation"><div class="delete-title">随行验证 · 合成子项</div></div><button class="confirm-subtask"></button><button class="cancel-subtask"></button>';editor.querySelector('.confirm-subtask').addEventListener('click',()=>saved++);editor.querySelector('.cancel-subtask').addEventListener('click',()=>editor.remove());doc.querySelector('.reminder-row').append(editor);});
    assert.equal(await dom.window.eval('('+editTestSubtask.toString()+')('+JSON.stringify({pageId:'page',listId:'list',id:'item',title:'随行验证 · 合成子项',cancel})+')'),true);assert.equal(saved,cancel?0:1);
  }
});

test('子事项验收拒绝非测试标题、旧页面及错误记录，不激活按钮',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="page" data-list-id="list"><div class="reminder-row" data-record-id="item"><div class="reminder-title">随行验证 · 合成子项</div><button class="subtask-item-button"></button></div></div>',{runScripts:'outside-only'});t.after(()=>dom.window.close());let clicked=0;dom.window.document.querySelector('button').addEventListener('click',()=>clicked++);
  for(const changes of [{title:'合成普通事项'},{pageId:'old'},{id:'other'}])assert.equal(await dom.window.eval('('+editTestSubtask.toString()+')('+JSON.stringify({pageId:'page',listId:'list',id:'item',title:'随行验证 · 合成子项',...changes})+')'),false);assert.equal(clicked,0);
});

test('子事项通道只在两条专用事项之间按官网顺序预检，不用名称推测前后位置',async()=>{
  for(const reverse of [false,true]){
    const named=[{id:'parent-label',title:'随行验证 · Windows 子事项父项'},{id:'child-label',title:'随行验证 · Windows 子事项子项'}];if(reverse)named.reverse();
    const items=named.map(item=>({...item,listId:'list',level:1,parentId:null,fingerprint:item.id,completed:false,notes:'',flagged:false,schedule:{date:null,time:null}}));
    const snapshot={pageId:'page',activeListId:'list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'list',title:'随行验证（2026-11-04）'}],items};let checked=0;
    const controller={execute:async command=>{if(command.type==='read')return {ok:true,snapshot};assert.equal(command.type,'getSubtaskInfo');assert.equal(command.id,items[1].id);checked++;return {ok:true,snapshot,subtask:{parentTitle:items[0].title,affectedCount:1}};}};
    const result=await testOperation(controller,'indent-subtask-test-item',{sendSnapshot(){},ui:{webContents:{async executeJavaScript(){return false;}}}});
    assert.equal(result.code,'TEST_SUBTASK_UI_UNCONFIRMED');assert.equal(checked,1);
  }
});

test('层级预检的父项若不是另一条专用事项，通道不会激活本地确认',async()=>{
  const items=[{id:'p',title:'随行验证 · Windows 子事项父项'},{id:'c',title:'随行验证 · Windows 子事项子项'}].map(item=>({...item,listId:'list',level:1,parentId:null,fingerprint:item.id,completed:false,notes:'',flagged:false,schedule:{date:null,time:null}}));
  const snapshot={pageId:'page',activeListId:'list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'list',title:'随行验证（2026-11-04）'}],items};
  const controller={execute:async command=>command.type==='read'?{ok:true,snapshot}:{ok:true,snapshot,subtask:{parentTitle:'随行验证 · 其他事项',affectedCount:1}}};
  const result=await testOperation(controller,'indent-subtask-test-item',{sendSnapshot(){assert.fail('错误父项不进入本地确认');},ui:null});assert.equal(result.code,'TEST_SUBTASK_PLAN_UNSUPPORTED');
});

test('重连验收区分导航、页面、目标和指定读取失败，未匹配时不读事项',async()=>{
  const snapshot={pageId:'old-page',activeListId:'list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'list',title:'随行验证（2026-11-04）'}],items:[{title:'随行验证 · 最小读写验证'}]};
  for(const [navigation,scoped,reason] of [
    [{ok:false,code:'BUSY'},null,'AFTER_NAVIGATION_READ_FAILED'],
    [{ok:true,snapshot:{...snapshot,items:[]}},null,'AFTER_PAGE_UNCHANGED'],
    [{ok:true,snapshot:{...snapshot,pageId:'new-page',lists:[],items:[]}},null,'AFTER_TARGET_NOT_UNIQUE'],
    [{ok:true,snapshot:{...snapshot,pageId:'new-page',items:[]}},{ok:false,code:'STALE_VIEW'},'AFTER_SCOPED_READ_FAILED']
  ]){
    let reads=0;const controller={execute:async command=>{if(command.type==='read')return {ok:true,snapshot};if(command.type==='readLists')return navigation;assert.equal(command.type,'readList');reads++;assert.equal(command.pageId,'new-page');assert.equal(command.listId,'list');return scoped;}};
    const result=await testOperation(controller,'reconnect-test-client',{sendSnapshot(){},ui:{webContents:{async executeJavaScript(){return true;}}}});
    assert.equal(result.reason,reason);assert.equal(reads,scoped?1:0);
  }
});

test('重连本地脚本异常仅返回固定阶段，不泄漏异常正文',async()=>{
  const controller=scopedController(false),result=await testOperation(controller,'reconnect-test-client',{sendSnapshot(){},ui:{webContents:{async executeJavaScript(){throw Error('synthetic-private-reconnect-error');}}}});
  assert.equal(result.reason,'UI_EXECUTION_FAILED');assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
});

test('信箱汇总保留固定重连失败阶段与分类，不丢弃诊断证据',()=>{
  for(const reason of ['UI_NOT_READY','UI_ERROR','VIEW_NOT_RESTORED','OBSERVATION_TIMEOUT','UI_EXECUTION_FAILED','AFTER_NAVIGATION_READ_FAILED','AFTER_PAGE_UNCHANGED','AFTER_TARGET_NOT_UNIQUE','AFTER_SCOPED_READ_FAILED']){
    const result=summarize({ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason,kind:'BUSY',stage:'home'});assert.equal(result.reason,reason);assert.equal(result.kind,'BUSY');assert.equal(result.stage,'home');
  }
});

test('汇总不输出未知阶段、异常正文或其他命令夹带的原因',()=>{
  for(const data of [{code:'TEST_RECONNECT_UNCONFIRMED',reason:'synthetic-private-reason',kind:'synthetic-private-kind'},{code:'READY',reason:'UI_ERROR',kind:'BUSY'}]){
    const result=summarize({ok:false,...data,message:'synthetic-private-message'});assert.equal(result.reason,undefined);assert.equal(result.kind,undefined);assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
  }
});

test('外观验收只选择本地匹配的选项，取消不触发保存',async t=>{
  for(const cancel of [false,true]){
    const dom=new JSDOM('<div class="list-content" data-page-id="page" data-list-id="list"><div class="list-title">随行验证 · 合成外观</div><button class="list-appearance-button"></button></div>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const doc=dom.window.document;let selected=0,saved=0;
    doc.querySelector('button').addEventListener('click',()=>{const panel=doc.createElement('div');panel.className='inline-editor appearance-editor';panel.innerHTML='<button class="color-choice" data-key="color"></button><button class="icon-choice" data-key="icon"></button><button class="save-list-appearance"></button><button class="cancel-list-appearance"></button>';panel.querySelectorAll('.color-choice,.icon-choice').forEach(button=>button.addEventListener('click',()=>selected++));panel.querySelector('.save-list-appearance').addEventListener('click',()=>saved++);panel.querySelector('.cancel-list-appearance').addEventListener('click',()=>panel.remove());doc.body.append(panel);});
    assert.equal(await dom.window.eval('('+editTestListAppearance.toString()+')('+JSON.stringify({pageId:'page',listId:'list',title:'随行验证 · 合成外观',color:'color',iconKey:'icon',cancel})+')'),true);assert.equal(selected,2);assert.equal(saved,cancel?0:1);
  }
});

test('外观验收拒绝普通清单、旧句柄及已有编辑，不激活按钮',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="page" data-list-id="list"><div class="list-title">随行验证 · 合成外观</div><button class="list-appearance-button"></button></div>',{runScripts:'outside-only'});t.after(()=>dom.window.close());let clicked=0;dom.window.document.querySelector('button').addEventListener('click',()=>clicked++);
  for(const changes of [{title:'合成普通清单'},{pageId:'old'},{listId:'old'}])assert.equal(await dom.window.eval('('+editTestListAppearance.toString()+')('+JSON.stringify({pageId:'page',listId:'list',title:'随行验证 · 合成外观',...changes})+')'),false);
  assert.equal(clicked,0);
});

for (const tag of ['button', 'uni-button']) {
  for (const completed of [false, true]) {
    test(`${tag} 的${completed ? '取消完成' : '完成'}验收切换页签并且只点击目标一次`, async t => {
      const dom = new JSDOM(`<div class="list-content" data-page-id="page-test" data-list-id="list-test">
        <div class="tabs"><${tag} data-status="pending" class="${completed ? 'active' : ''}"></${tag}><${tag} data-status="completed" class="${completed ? '' : 'active'}"></${tag}></div>
        <div class="rows"></div></div>`, { runScripts: 'outside-only' });
      t.after(() => dom.window.close());
      const { document } = dom.window;
      let clicks = 0;
      let tabs = 0;
      document.querySelectorAll('.tabs > *').forEach(tab => tab.addEventListener('click', () => {
        tabs++;
        document.querySelectorAll('.tabs > *').forEach(other => other.classList.toggle('active', other === tab));
        document.querySelector('.rows').innerHTML = `<div class="reminder-row" data-record-id="other"><${tag} class="completion-button"></${tag}></div><div class="reminder-row" data-record-id="record-test"><${tag} class="completion-button ${completed ? 'checked' : ''}"></${tag}></div>`;
        document.querySelector('[data-record-id="other"] .completion-button').addEventListener('click', () => assert.fail('不能点击其他记录'));
        document.querySelector('[data-record-id="record-test"] .completion-button').addEventListener('click', () => { clicks++; });
      }));
      const expected = { pageId: 'page-test', listId: 'list-test', id: 'record-test', completed };
      assert.equal(await dom.window.eval(`(${clickTestCompletion})(${JSON.stringify(expected)})`), true);
      assert.equal(tabs, 1);
      assert.equal(clicks, 1);
    });
  }
}

test('旧页面和禁用按钮不会被开发验收入口点击', async t => {
  const dom = new JSDOM('<div class="list-content" data-page-id="new-page" data-list-id="list-test"><div class="tabs"><uni-button data-status="pending" class="active"></uni-button></div><div class="reminder-row" data-record-id="record-test"><uni-button disabled="true" class="completion-button"></uni-button></div></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.setTimeout = callback => setTimeout(callback, 0);
  let clicks = 0;
  dom.window.document.querySelector('.completion-button').addEventListener('click', () => clicks++);
  for (const pageId of ['old-page', 'new-page']) {
    assert.equal(await dom.window.eval(`(${clickTestCompletion})(${JSON.stringify({ pageId, listId: 'list-test', id: 'record-test', completed: false })})`), false);
  }
  assert.equal(clicks, 0);
});

function scopedController(completed, listTitle = '随行验证（2026-11-04）') {
  const snapshot = { pageId: 'test-page', activeListId: 'test-list', activeListTitle: listTitle,
    lists: [{ id: 'test-list', title: listTitle }], items: [{ id: 'test-item', listId: 'test-list', title: '随行验证 · 最小读写验证', completed }] };
  return { execute: async command => { assert.equal(command.type, 'read'); return { ok: true, snapshot }; } };
}

test('测试事项已经达到目标状态时，不触发界面和写入', async () => {
  const result = await testOperation(scopedController(false), 'uncomplete-test-item', {
    sendSnapshot: () => assert.fail('只读核对不应更新界面'), ui: null
  });
  assert.equal(result.code, 'UNCHANGED');
  assert.equal(result.dispatched, false);
  assert.equal(summarize(result).testCompleted, false);
});

test('自动验证拒绝普通清单，不向界面派发事项写入', async () => {
  const result = await testOperation(scopedController(false, '普通合成清单'), 'complete-test-item', { ui: null });
  assert.equal(result.code, 'TEST_LIST_NOT_UNIQUE');
});

test('界面执行中断返回不确定状态，不宣称没有点击', async () => {
  let invocations = 0;
  const result = await testOperation(scopedController(false), 'complete-test-item', {
    sendSnapshot() {}, ui: { webContents: { async executeJavaScript() { invocations++; throw new Error('合成渲染器中断'); } } }
  });
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.equal(result.cloudConfirmed, false);
  assert.equal(result.dispatched, undefined);
  assert.equal(invocations, 1);
});

test('新增自动验证拒绝普通清单，已有测试新增事项时只读返回', async () => {
  const refused = await testOperation(scopedController(false,'普通合成清单'),'create-test-item',{ui:null});
  assert.equal(refused.code,'TEST_LIST_NOT_UNIQUE');
  const base = scopedController(false);
  const controller = { async execute(command) { const result=await base.execute(command); result.snapshot.items.push({title:'随行验证 · Windows 新增验证',completed:false}); return result; } };
  const result=await testOperation(controller,'create-test-item',{sendSnapshot:()=>assert.fail('不得派发新增'),ui:null});
  assert.equal(result.code,'UNCHANGED');
  assert.equal(summarize(result).testCreatedCount,1);
});

test('本地已完成页签验收只激活一次并等待正式异步动作结束',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="tabs"><button data-status="completed"></button></div></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const tab=dom.window.document.querySelector('button');
  let clicks=0;
  tab.addEventListener('click',()=>{
    clicks++;tab.classList.add('active');tab.disabled=true;
    setTimeout(()=>{tab.disabled=false;},160);
  });
  const shown=await dom.window.eval('('+showTestCompleted.toString()+')({pageId:"synthetic-page",listId:"synthetic-list"})');
  assert.equal(shown,true);assert.equal(clicks,1);assert.equal(tab.disabled,false);
});

test('已完成页签验收遇到旧页面或正式界面错误时不宣称成功',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="tabs"><button data-status="completed"></button></div></div><div class="notice error"></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const tab=dom.window.document.querySelector('button');let clicks=0;
  tab.addEventListener('click',()=>{clicks++;tab.classList.add('active');});
  for(const pageId of ['synthetic-old-page','synthetic-page']) assert.equal(await dom.window.eval('('+showTestCompleted.toString()+')('+JSON.stringify({pageId,listId:'synthetic-list'})+')'),false);
  assert.equal(clicks,1);
});

test('日期验收只打开目标行，填写可选日期时间并保存一次',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="tabs"><button data-status="pending" class="active"></button></div><div class="reminder-row" data-record-id="other"><button class="edit-schedule-button"></button></div><div class="reminder-row" data-record-id="target"><button class="edit-schedule-button"></button></div></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
  const doc=dom.window.document,row=doc.querySelector('[data-record-id="target"]');let opened=0,saved=0,actual;
  doc.querySelector('[data-record-id="other"] button').addEventListener('click',()=>assert.fail('不能打开其他行'));
  row.querySelector('button').addEventListener('click',()=>{
    opened++;row.innerHTML='<div class="inline-editor"><div class="schedule-editor"></div><button class="save-edit"></button></div>';
    const editor=row.querySelector('.schedule-editor'),state={useDate:false,includeTime:false,date:'2026-11-04',time:'09:00'};
    function render() {
      editor.innerHTML='<button class="schedule-date-toggle" aria-checked="'+state.useDate+'"></button>'+(state.useDate?'<input class="schedule-date-input"><button class="schedule-time-toggle" aria-checked="'+state.includeTime+'"></button>'+(state.includeTime?'<input class="schedule-time-input">':''):'');
      editor.querySelector('.schedule-date-toggle').addEventListener('click',()=>{state.useDate=!state.useDate;render();});
      const dateInput=editor.querySelector('.schedule-date-input');if (dateInput) {dateInput.value=state.date;dateInput.addEventListener('input',()=>state.date=dateInput.value);}
      editor.querySelector('.schedule-time-toggle')?.addEventListener('click',()=>{state.includeTime=!state.includeTime;render();});
      const timeInput=editor.querySelector('.schedule-time-input');if (timeInput) {timeInput.value=state.time;timeInput.addEventListener('input',()=>state.time=timeInput.value);}
    }
    render();row.querySelector('.save-edit').addEventListener('click',()=>{saved++;actual=state;});
  });
  const expected={pageId:'synthetic-page',listId:'synthetic-list',id:'target',completed:false,value:{date:'2030-01-15',time:'14:35',timeZone:'UTC'}};
  assert.equal(await dom.window.eval('('+editTestSchedule.toString()+')('+JSON.stringify(expected)+')'),true);
  assert.equal(opened,1);assert.equal(saved,1);assert.equal(actual.date,'2030-01-15');assert.equal(actual.time,'14:35');
});

test('排序验收只操作专用清单的本地菜单，结束恢复原设置且普通事项不打开菜单',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="sort-picker"><button class="sort-picker-label">清单顺序 ⌄</button></div><div class="reminder-row" data-record-id="synthetic-record"><span class="reminder-title">随行验证 · 合成排序</span><button class="completion-button"></button></div></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
  const doc=dom.window.document,label=doc.querySelector('.sort-picker-label');const selected=[];
  doc.querySelector('.completion-button').addEventListener('click',()=>assert.fail('排序不得完成事项'));
  label.addEventListener('click',()=>{
    const menu=doc.createElement('div');menu.className='uni-picker-select';
    for(const text of ['清单顺序','日期：从早到晚','标题：升序','优先级：从高到低','优先级：从低到高']) {
      const option=doc.createElement('button');option.className='uni-picker-item';option.textContent=text;
      option.addEventListener('click',()=>{selected.push(text);label.textContent=text+' ⌄';menu.remove();});menu.append(option);
    }
    doc.body.append(menu);
  });
  const expected={pageId:'synthetic-page',listId:'synthetic-list',ids:['synthetic-record']};
  assert.equal(await dom.window.eval('('+verifyTestSorting.toString()+')('+JSON.stringify(expected)+')'),true);
  assert.deepEqual(selected,['日期：从早到晚','标题：升序','优先级：从高到低','优先级：从低到高','清单顺序']);
  doc.querySelector('.reminder-title').textContent='合成普通事项';
  assert.equal(await dom.window.eval('('+verifyTestSorting.toString()+')('+JSON.stringify(expected)+')'),false);
  assert.equal(selected.length,5);
});

test('排序通道只读取核对，不发送事项写入，读回冲突时不宣称通过',async()=>{
  const base=scopedController(false);let rendered=0;
  const result=await testOperation(base,'verify-test-sorting',{sendSnapshot(){},ui:{webContents:{async executeJavaScript(){rendered++;return true;}}}});
  assert.deepEqual(result,{ok:true,code:'TEST_SORTING_OBSERVED',restored:true,webItemsUnchanged:true});
  assert.equal(rendered,1);
  let reads=0;
  const changed={async execute(command){const result=structuredClone(await base.execute(command));result.snapshot.items[0].fingerprint=String(reads++);return result;}};
  const conflict=await testOperation(changed,'verify-test-sorting',{sendSnapshot(){},ui:{webContents:{executeJavaScript:async()=>true}}});
  assert.equal(conflict.code,'TEST_SORTING_UNCONFIRMED');assert.equal(conflict.webItemsUnchanged,false);
});

test('排序验收识别受控菜单的选项标签，不把勾选标记读进标签，仍恢复原设置',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="sort-picker"><div class="sort-picker-label">清单顺序 ⌄</div></div><div class="reminder-row" data-record-id="synthetic-record"><span class="reminder-title">随行验证 · 合成排序</span></div></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
  const doc=dom.window.document,field=doc.querySelector('.sort-picker-label'),changes=[];
  field.addEventListener('click',()=>{
    const menu=doc.createElement('div');menu.className='sort-menu';
    for(const label of ['清单顺序','日期：从早到晚','标题：升序','优先级：从高到低','优先级：从低到高']) {
      const option=doc.createElement('div');option.className='sort-option';
      option.innerHTML='<span class="sort-option-label">'+label+'</span><span aria-hidden="true">✓</span>';
      option.addEventListener('click',()=>{changes.push(label);field.textContent=label+' ⌄';menu.remove();});menu.append(option);
    }
    doc.body.append(menu);
  });
  const expected={pageId:'synthetic-page',listId:'synthetic-list',ids:['synthetic-record']};
  assert.equal(await dom.window.eval('('+verifyTestSorting.toString()+')('+JSON.stringify(expected)+')'),true);
  assert.deepEqual(changes,['日期：从早到晚','标题：升序','优先级：从高到低','优先级：从低到高','清单顺序']);
  assert.equal(field.textContent,'清单顺序 ⌄');
});

test('旗标验证只点击匹配页面、清单、记录和原状态的本地按钮一次',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="tabs"><button data-status="pending" class="active"></button></div><div class="reminder-row" data-record-id="synthetic-record"><button class="flag-toggle-button" aria-pressed="false"></button></div></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
  const button=dom.window.document.querySelector('.flag-toggle-button');let clicks=0;button.addEventListener('click',()=>clicks++);
  const expected={pageId:'synthetic-page',listId:'synthetic-list',id:'synthetic-record',completed:false,flagged:false};
  assert.equal(await dom.window.eval('('+clickTestFlag.toString()+')('+JSON.stringify({...expected,flagged:true})+')'),false);
  assert.equal(clicks,0);
  assert.equal(await dom.window.eval('('+clickTestFlag.toString()+')('+JSON.stringify(expected)+')'),true);assert.equal(clicks,1);
});

test('本地优先级显示与只读快照不一致时，排序验收不打开菜单或点击事项',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="sort-picker"><button class="sort-picker-label">清单顺序 ⌄</button></div><div class="reminder-row" data-record-id="synthetic-record" data-priority="high"><span class="reminder-title">随行验证 · 合成优先级</span><span class="priority-mark">!</span></div></div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());let clicks=0;dom.window.document.body.addEventListener('click',()=>clicks++);
  const expected={pageId:'synthetic-page',listId:'synthetic-list',ids:['synthetic-record'],priorities:[{id:'synthetic-record',priority:'high'}]};
  assert.equal(await dom.window.eval('('+verifyTestSorting.toString()+')('+JSON.stringify(expected)+')'),false);
  assert.equal(clicks,0);
});

test('删除验收必须先匹配测试行，取消不触发确认，确认只激活一次',async t=>{
  for(const cancel of [true,false]) {
    const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><div class="reminder-row" data-record-id="target"><span class="reminder-title">随行验证 · 删除专用</span><button class="delete-item-button"></button></div></div>',{runScripts:'outside-only'});
    t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
    const row=dom.window.document.querySelector('.reminder-row');let opened=0,confirmed=0,cancelled=0;
    row.querySelector('button').addEventListener('click',()=>{
      opened++;row.innerHTML='<div class="inline-editor"><div class="delete-confirmation">随行验证 · 删除专用</div><button class="confirm-delete"></button><button class="cancel-delete"></button></div>';
      row.querySelector('.confirm-delete').addEventListener('click',()=>confirmed++);
      row.querySelector('.cancel-delete').addEventListener('click',()=>{cancelled++;row.querySelector('.inline-editor').remove();});
    });
    const expected={pageId:'synthetic-page',listId:'synthetic-list',id:'target',title:'随行验证 · 删除专用',cancel};
    for(const changes of [{id:'other'},{title:'合成普通事项'},{pageId:'old-page'}]) assert.equal(await dom.window.eval('('+deleteTestItem.toString()+')('+JSON.stringify({...expected,...changes})+')'),false);
    assert.equal(opened,0);
    assert.equal(await dom.window.eval('('+deleteTestItem.toString()+')('+JSON.stringify(expected)+')'),true);
    assert.equal(opened,1);assert.equal(confirmed,cancel?0:1);assert.equal(cancelled,cancel?1:0);
  }
});

test('清单验收只填写匹配页面的本地编辑器，取消与保存分别只激活一次',async t=>{
  for(const cancel of [true,false]) {
    const dom=new JSDOM('<div class="list-content" data-page-id="synthetic-page" data-list-id="synthetic-list"><span class="list-title">随行验证 · 原清单</span><button class="add-list-button"></button></div>',{runScripts:'outside-only'});
    t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);const doc=dom.window.document;let opened=0,saved=0,cancelled=0,value='';
    doc.querySelector('button').addEventListener('click',()=>{
      opened++;const editor=doc.createElement('div');editor.className='inline-editor list-editor';editor.dataset.operation='create';
      editor.innerHTML='<input class="list-name-input"><button class="save-list-edit"></button><button class="cancel-list-edit"></button>';
      editor.querySelector('input').addEventListener('input',event=>value=event.target.value);
      editor.querySelector('.save-list-edit').addEventListener('click',()=>saved++);editor.querySelector('.cancel-list-edit').addEventListener('click',()=>{cancelled++;editor.remove();});doc.body.append(editor);
    });
    const expected={pageId:'synthetic-page',listId:'synthetic-list',title:'随行验证 · 原清单',operation:'create',value:'随行验证 · 新清单',cancel};
    assert.equal(await dom.window.eval('('+editTestList.toString()+')('+JSON.stringify({...expected,value:'合成普通清单'})+')'),false);assert.equal(opened,0);
    assert.equal(await dom.window.eval('('+editTestList.toString()+')('+JSON.stringify(expected)+')'),true);assert.equal(opened,1);assert.equal(value,expected.value);assert.equal(saved,cancel?0:1);assert.equal(cancelled,cancel?1:0);
  }
});

test('多个测试清单仍只定位原固定清单；原清单缺失时不改用另一个前缀清单',async()=>{
  const base=scopedController(false);
  const controller={async execute(command){const result=structuredClone(await base.execute(command));result.snapshot.lists.push({id:'managed',title:'随行验证 · Windows 清单管理验证'});return result;}};
  assert.equal((await testOperation(controller,'uncomplete-test-item',{ui:null})).code,'UNCHANGED');
  const wrong=scopedController(false,'随行验证 · Windows 清单管理验证');
  assert.equal((await testOperation(wrong,'uncomplete-test-item',{ui:null})).code,'TEST_LIST_NOT_UNIQUE');
});

test('清单删除验收必须匹配本地确认目标，取消不提交，确认仅点击一次',async t=>{
  for(const cancel of [true,false]) {
    const dom=new JSDOM('<div class="list-content" data-page-id="page" data-list-id="list"><span class="list-title">随行验证 · 管理清单</span><button class="delete-list-button"></button></div>',{runScripts:'outside-only'});
    t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);const doc=dom.window.document;let opened=0,deleted=0,cancelled=0;
    doc.querySelector('button').addEventListener('click',()=>{opened++;const panel=doc.createElement('div');panel.className='inline-editor list-delete-confirmation';panel.innerHTML='<span class="delete-title">删除清单“随行验证 · 管理清单”？</span><button class="confirm-list-delete"></button><button class="cancel-list-delete"></button>';panel.querySelector('.confirm-list-delete').addEventListener('click',()=>deleted++);panel.querySelector('.cancel-list-delete').addEventListener('click',()=>{cancelled++;panel.remove();});doc.body.append(panel);});
    const expected={pageId:'page',listId:'list',title:'随行验证 · 管理清单',cancel};
    assert.equal(await dom.window.eval('('+deleteTestList.toString()+')('+JSON.stringify({...expected,title:'合成普通清单'})+')'),false);assert.equal(opened,0);
    assert.equal(await dom.window.eval('('+deleteTestList.toString()+')('+JSON.stringify(expected)+')'),true);assert.equal(opened,1);assert.equal(deleted,cancel?0:1);assert.equal(cancelled,cancel?1:0);
  }
});

test('删除后的导航快照只从侧栏选择指定测试清单，等待可写状态，不直接调用读写协议',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="page" data-live="false"></div><button class="list-button" data-list-id="target"><span class="list-name">随行验证 · 原清单</span></button>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);let clicks=0;const doc=dom.window.document;
  doc.querySelector('button').addEventListener('click',()=>{clicks++;doc.querySelector('.list-content').dataset.listId='target';doc.querySelector('.list-content').dataset.live='true';});
  assert.equal(await dom.window.eval('('+selectTestListClient.toString()+')('+JSON.stringify({pageId:'page',listId:'target',title:'随行验证 · 原清单'})+')'),true);assert.equal(clicks,1);
});

test('真实旗标通道只允许唯一未完成、无日期的既有专用新增事项',async()=>{
  const snapshot={pageId:'test-page',activeListId:'test-list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'test-list',title:'随行验证（2026-11-04）'}],items:[{id:'synthetic-created',listId:'test-list',title:'随行验证 · Windows 新增验证',completed:false,flagged:false,schedule:{date:null,time:null,timeZone:null}}]};
  let reads=0,clicks=0;
  const controller={async execute(command){assert.equal(command.type,'read');const result=structuredClone(snapshot);if(reads++)result.items[0].flagged=true;return {ok:true,snapshot:result};}};
  const result=await testOperation(controller,'flag-created-test-item',{sendSnapshot(){},ui:{webContents:{async executeJavaScript(){clicks++;return true;}}}});
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(clicks,1);
  for(const changed of [{completed:true},{schedule:{date:'2030-01-15',time:null,timeZone:null}},{flagged:null}]) {
    const blocked=structuredClone(snapshot);Object.assign(blocked.items[0],changed);
    assert.equal((await testOperation({execute:async()=>({ok:true,snapshot:blocked})},'flag-created-test-item',{ui:null})).code,'TEST_CREATED_STATE_UNSUPPORTED');
  }
});

test('同步验证使用独立测试事项，已有记录只读返回，不重建正在核对的原事项',async()=>{
  const controller=scopedController(false);
  const read=await controller.execute({type:'read'});
  read.snapshot.items.push({id:'synthetic-sync',title:'随行验证 · Windows 同步验证',completed:false,flagged:false,schedule:{date:null,time:null,timeZone:null}});
  assert.equal((await testOperation(controller,'create-sync-test-item',{sendSnapshot(){assert.fail('已有同步事项不能再次创建');},ui:null})).code,'UNCHANGED');
  assert.equal((await testOperation(controller,'unflag-sync-test-item',{sendSnapshot(){assert.fail('旗标已经为目标状态');},ui:null})).code,'UNCHANGED');
  assert.equal(summarize(read).testSyncCount,1);assert.equal(summarize(read).testCreatedCount,0);
});

test('公开页面重连验收限定专用清单并提前撤销旧快照写权限',async()=>{
  const controller=scopedController(false),actions=[],snapshots=[];
  controller.inspectSiteConnection=async action=>{actions.push(action);return {ok:true,code:'SITE_REOPENED'};};
  assert.equal((await testOperation(controller,'reopen-test-site',{sendSnapshot:r=>snapshots.push(r),ui:null})).ok,true);
  assert.deepEqual(actions,['reopen']);assert.equal(snapshots[0].ok,false);assert.equal(snapshots[0].code,'PAGE_CHANGED');
  const denied=scopedController(false,'普通合成清单');denied.inspectSiteConnection=()=>assert.fail('不能切换普通清单的页面');
  assert.equal((await testOperation(denied,'reopen-test-site',{ui:null})).code,'TEST_LIST_NOT_UNIQUE');
});

test('本地重新连接验收只激活一次，等待新页面与可写清单，不点击任何事项',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="old-page" data-list-id="old-list" data-live="true"><span class="list-title">随行验证 · 同步清单</span></div><button class="reconnect-button"></button>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
  const doc=dom.window.document,button=doc.querySelector('button');let clicks=0;
  button.addEventListener('click',()=>{clicks++;button.disabled=true;setTimeout(()=>{const list=doc.querySelector('.list-content');list.dataset.pageId='new-page';list.dataset.listId='new-list';button.disabled=false;},15);});
  const result=await dom.window.eval('('+reconnectTestClient.toString()+')('+JSON.stringify({pageId:'old-page',listId:'old-list',title:'随行验证 · 同步清单'})+')');
  assert.equal(result,true);assert.equal(clicks,1);
});

test('重新连接验收等待前一次只读快照显示就绪，仍只点击一次',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="old-render" data-list-id="old-list" data-live="true"><span class="list-title">随行验证 · 原清单</span></div><button class="reconnect-button"></button>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,5);const doc=dom.window.document,list=doc.querySelector('.list-content');let clicks=0;
  doc.querySelector('button').addEventListener('click',()=>{clicks++;list.dataset.pageId='new-page';});
  setTimeout(()=>{list.dataset.pageId='expected-page';list.dataset.listId='expected-list';},10);
  assert.equal(await dom.window.eval('('+reconnectTestClient.toString()+')('+JSON.stringify({pageId:'expected-page',listId:'expected-list',title:'随行验证 · 原清单'})+')'),true);assert.equal(clicks,1);
});

test('重连未确认时诊断仅返回固定分类，不返回本地提示正文或重试按钮',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="expected-page" data-list-id="expected-list" data-live="true"><span class="list-title">随行验证 · 原清单</span></div><button class="reconnect-button"></button><div class="notice error">synthetic-private-message</div>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);let clicks=0;dom.window.document.querySelector('button').addEventListener('click',()=>clicks++);
  const result=await dom.window.eval('('+reconnectTestClient.toString()+')('+JSON.stringify({pageId:'expected-page',listId:'expected-list',title:'随行验证 · 原清单',details:true})+')');
  assert.equal(result.ok,false);assert.equal(result.reason,'UI_ERROR');assert.equal(result.kind,'OTHER');assert.equal(clicks,1);assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
});
