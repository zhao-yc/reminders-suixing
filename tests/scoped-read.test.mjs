import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';
const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t){const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});t.after(()=>dom.window.close());dom.window.eval(source);return {window:dom.window,execute:command=>dom.window.__suixingAdapter.execute(command)};}

test('自动指定读取在官方编辑或可见弹层期间不查询事项、不失焦或点击',async t=>{
  const {window,execute}=await setup(t),navigation=await execute({type:'readLists'}),command={type:'readList',pageId:navigation.snapshot.pageId,listId:navigation.snapshot.lists[0].id,background:true};
  for(const selector of ['[role="dialog"]','[role="alertdialog"]','[role="menu"]','.details-popover','.reminder-list-detail','[data-edit="true"]']) {
    const blocker=window.document.createElement('div');
    if(selector.startsWith('[role='))blocker.setAttribute('role',selector.slice(7,-2));else if(selector.startsWith('.'))blocker.className=selector.slice(1);else blocker.setAttribute('data-edit','true');
    window.document.body.append(blocker);
    assert.equal((await execute(command)).code,'AUTO_READ_DEFERRED',selector);blocker.hidden=true;assert.equal((await execute(command)).code,'READY');blocker.remove();
  }
  const editor=window.document.querySelector('.title [role="textbox"]');editor.setAttribute('tabindex','0');editor.focus();let blurs=0;editor.addEventListener('blur',()=>blurs++);
  const rows=[...window.document.querySelectorAll('.reminder-item')];rows.forEach(row=>{row.querySelector=()=>assert.fail('自动读取不查询官方草稿');});
  assert.equal((await execute(command)).code,'AUTO_READ_DEFERRED');assert.equal(window.document.activeElement,editor);assert.equal(blurs,0);assert.equal(window.fixtureClicks,0);
});

test('后台参数必须为布尔值，自动读取仍先核对页面及官方选区',async t=>{
  const {window,execute}=await setup(t),navigation=await execute({type:'readLists'}),command={type:'readList',pageId:navigation.snapshot.pageId,listId:navigation.snapshot.lists[0].id,background:true};
  assert.equal(validCommand(command),true);assert.equal(validCommand({...command,background:'true'}),false);assert.equal((await execute({...command,background:'true'})).code,'INVALID_COMMAND');
  const blocker=window.document.createElement('div');blocker.setAttribute('role','dialog');window.document.body.append(blocker);
  assert.equal((await execute({...command,listId:navigation.snapshot.lists[1].id})).code,'STALE_VIEW');assert.equal((await execute({...command,pageId:'old'})).code,'STALE_VIEW');
});

test('后台切换仅在确认没有选区时接受空的来源清单',async t=>{
  const {window,execute}=await setup(t);
  const lists=[...window.document.querySelectorAll('[role="treeitem"]')];
  lists[0].setAttribute('aria-selected','false');
  const navigation=await execute({type:'readLists',background:true});
  assert.equal(navigation.selectedListId,'');
  const {pageId}=navigation.snapshot;
  const listId=navigation.snapshot.lists[1].id;
  const command={type:'selectList',pageId,listId,fromListId:'',background:true};
  assert.equal(validCommand(command),false,'空来源只用于控制器内部');
  assert.equal((await execute(command)).snapshot?.activeListId,listId);
  assert.equal((await execute(command)).code,'STALE_VIEW');

  lists[0].setAttribute('aria-selected','true');
  assert.equal((await execute({type:'readLists',background:true})).selectedListId,null);
  assert.equal((await execute({...command,fromListId:listId})).code,'STALE_VIEW');
});

test('指定读取在官方选中其他清单时不查询任何事项字段',async t=>{
  const {window,execute}=await setup(t),navigation=await execute({type:'readLists'});
  assert.equal(navigation.snapshot.activeListId,null);assert.equal(navigation.snapshot.items.length,0);
  window.document.querySelectorAll('.reminder-item').forEach(row=>{row.querySelector=()=>assert.fail('不能查询非指定清单的事项字段');});
  const result=await execute({type:'readList',pageId:navigation.snapshot.pageId,listId:navigation.snapshot.lists[1].id});
  assert.equal(result.code,'STALE_VIEW');assert.equal(result.snapshot,undefined);
});

test('导航之后只读取明确匹配的清单，取得新指纹后才恢复字段写入',async t=>{
  const {window,execute}=await setup(t),navigation=await execute({type:'readLists'}),command={type:'readList',pageId:navigation.snapshot.pageId,listId:navigation.snapshot.lists[0].id};
  assert.equal(validCommand(command),true);const result=await execute(command);assert.equal(result.code,'READY');assert.equal(result.snapshot.items.length,2);assert.equal(window.fixtureClicks,0);
  const item=result.snapshot.items[0];const changed=await execute({type:'setCompleted',pageId:result.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:false,completed:true});assert.equal(changed.code,'WEB_STATE_OBSERVED');assert.equal(window.fixtureClicks,1);
});

test('旧页面、未知句柄和无效指定参数不会回退到默认清单',async t=>{
  const {window,execute}=await setup(t),navigation=await execute({type:'readLists'}),command={type:'readList',pageId:navigation.snapshot.pageId,listId:navigation.snapshot.lists[0].id};
  window.document.querySelectorAll('.reminder-item').forEach(row=>{row.querySelector=()=>assert.fail('参数错误不得读取事项');});
  for(const patch of [{pageId:'old-page'},{listId:'missing'}])assert.equal((await execute({...command,...patch})).code,'STALE_VIEW');
  for(const patch of [{pageId:''},{listId:''}]){assert.equal(validCommand({...command,...patch}),false);assert.equal((await execute({...command,...patch})).code,'INVALID_COMMAND');}
});

test('指定清单仍在加载时无事项快照，加载后选区变化仍停止',async t=>{
  const {window,execute}=await setup(t),navigation=await execute({type:'readLists'}),command={type:'readList',pageId:navigation.snapshot.pageId,listId:navigation.snapshot.lists[0].id};
  window.document.body.setAttribute('aria-busy','true');assert.equal((await execute(command)).code,'LIST_LOADING');window.document.body.removeAttribute('aria-busy');
  const nodes=window.document.querySelectorAll('[role="treeitem"]');nodes[0].setAttribute('aria-selected','false');nodes[1].setAttribute('aria-selected','true');
  assert.equal((await execute(command)).code,'STALE_VIEW');assert.equal(window.fixtureClicks,0);
});
