import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clickTestCompletion, showTestCompleted, editTestSchedule, verifyTestSorting, clickTestFlag, reconnectTestClient, deleteTestItem, editTestList } = require('../apps/desktop/verification-ui.cjs');
const { testOperation, summarize } = require('../apps/desktop/live-check.cjs');

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
