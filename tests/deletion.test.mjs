import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});
  t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot;
  return {window:dom.window,execute,snapshot,row:dom.window.document.getElementById(snapshot.items[1].id)};
}
function command(snapshot,type='deleteItem',index=1) {
  const item=snapshot.items[index];
  return {type,pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,...(type==='deleteItem'?{confirmed:true,requestId:'synthetic-delete-once'}:{})};
}

test('删除预检只形成唯一选区并取消详情，不提交任何事项写入',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const result=await execute(command(snapshot,'getDeleteInfo'));
  assert.equal(result.code,'DELETE_READY');assert.equal(result.deleteReady,true);assert.equal(result.dispatched,false);
  assert.deepEqual(result.snapshot.items.map(item=>item.fingerprint),snapshot.items.map(item=>item.fingerprint));
  assert.equal(window.document.querySelectorAll('.reminder-item[aria-selected="true"]').length,1);
  assert.equal(window.document.activeElement.id,snapshot.items[1].id);
  assert.equal(window.fixtureDeleteKeys,0);assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureClicks,0);
  assert.equal(window.document.querySelector('.details-popover'),null);
});

test('单行清单的 Home 无响应时只点击一次官方行，仍需排他选区和行焦点',async t=>{
  const {window,execute,row}=await setup(t);
  const grid=row.closest('[role="treegrid"]');
  grid.firstElementChild.remove();
  grid.setAttribute('aria-rowcount','1');
  row.setAttribute('aria-posinset','1');
  row.setAttribute('aria-setsize','1');
  window.fixtureIgnoreSelection=true;
  let clicks=0;
  row.addEventListener('click',event=>{
    if(event.target!==row)return;
    clicks++;
    row.setAttribute('aria-selected','true');
    row.focus();
  });
  const fresh=(await execute({type:'read'})).snapshot;
  const preview=await execute(command(fresh,'getDeleteInfo',0));
  assert.equal(preview.code,'DELETE_READY');
  assert.equal(preview.dispatched,false);
  assert.equal(clicks,1);
  assert.equal(window.document.activeElement,row);
  assert.equal(window.fixtureDeleteKeys,0);
});

test('同名事项仅删除确认的记录，Backspace 派发一次，其他字段保持，合成重载仍不存在',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const result=await execute(command(snapshot));
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);assert.equal(result.removed,true);
  assert.deepEqual(Array.from(result.snapshot.items,item=>item.fingerprint),[snapshot.items[0].fingerprint]);
  assert.equal(window.fixtureDeleteKeys,1);assert.equal(window.fixtureDeletionCount,1);assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureTextSaves,0);
  window.renderFixture('one');
  assert.deepEqual(Array.from((await execute({type:'read'})).snapshot.items,item=>item.id),[snapshot.items[0].id]);
  assert.equal((await execute(command(snapshot))).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureDeleteKeys,1);
});

test('缺少明确确认或合法请求标识时，协议和适配器均拒绝，不打开详情',async t=>{
  const {window,execute,snapshot,row}=await setup(t);let opens=0;row.querySelector('.info').addEventListener('click',()=>opens++);
  for(const changes of [{confirmed:false},{confirmed:undefined},{requestId:''},{requestId:'invalid request'}]) {
    const request={...command(snapshot),...changes};assert.equal(validCommand(request),false);assert.equal((await execute(request)).code,'INVALID_COMMAND');
  }
  assert.equal(validCommand(command(snapshot)),true);assert.equal(validCommand(command(snapshot,'getDeleteInfo')),true);
  assert.equal(opens,0);assert.equal(window.fixtureDeleteKeys,0);
});

test('旧页面、旧指纹、旧完成状态或清单变化均不导航或删除',async t=>{
  const {window,execute,snapshot,row}=await setup(t);let opens=0;row.querySelector('.info').addEventListener('click',()=>opens++);
  for(const changes of [{pageId:'old-page'},{fingerprint:'old-fingerprint'},{expectedCompleted:true},{listId:'other-list'},{id:'missing-record'}]) assert.equal((await execute({...command(snapshot),...changes})).code,'STALE_VIEW');
  assert.equal(opens,0);assert.equal(window.fixtureDeleteKeys,0);
});

test('折叠父项、可见子项、部分加载、缺少选区语义或次序不明时禁止删除',async t=>{
  for(const change of [
    (window,row)=>row.setAttribute('aria-expanded','false'),
    window=>window.document.querySelector('[role="treegrid"]').setAttribute('aria-rowcount','3'),
    (window,row)=>row.removeAttribute('aria-selected'),
    (window,row)=>row.setAttribute('aria-posinset','8')
  ]) {
    const {window,execute,snapshot,row}=await setup(t);change(window,row);
    const fresh=(await execute({type:'read'})).snapshot;
    assert.equal((await execute(command(fresh))).code,'DELETE_UNAVAILABLE');assert.equal(window.fixtureDeleteKeys,0);
  }
  const {window,execute,snapshot,row}=await setup(t);row.setAttribute('aria-level','2');
  const fresh=(await execute({type:'read'})).snapshot;
  assert.equal((await execute(command(fresh,'deleteItem',0))).code,'DELETE_UNAVAILABLE');assert.equal(window.fixtureDeleteKeys,0);
});

test('重复事项只取消自己打开的详情，不提交删除或其他存储',async t=>{
  const {window,execute,snapshot,row}=await setup(t);
  row.querySelector('.info').addEventListener('click',()=>{const node=window.document.createElement('div');node.className='repeat-info';window.document.querySelector('.reminder-item-details').append(node);});
  assert.equal((await execute(command(snapshot))).code,'DELETE_UNAVAILABLE');assert.equal(window.fixtureDeleteKeys,0);assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.document.querySelector('.details-popover'),null);
});

test('确认后层级或展开状态变化时，旧指纹不允许删除',async t=>{
  for(const change of [row=>row.setAttribute('aria-level','2'),row=>row.setAttribute('aria-expanded','false')]) {
    const {window,execute,snapshot,row}=await setup(t);change(row);
    assert.equal((await execute(command(snapshot))).code,'STALE_VIEW');assert.equal(window.fixtureDeleteKeys,0);
  }
});

test('官方文字编辑尚未结束时不转移焦点、失焦保存或发送删除键',async t=>{
  const {window,execute,snapshot,row}=await setup(t);const editor=row.querySelector('.title [role="textbox"]');editor.focus();
  assert.equal((await execute(command(snapshot))).code,'DELETE_UNAVAILABLE');assert.equal(window.document.activeElement,editor);assert.equal(window.fixtureTextBlurs,0);assert.equal(window.fixtureDeleteKeys,0);
});

test('不能排除原多选或焦点进入文本编辑时，停止在破坏性按键之前',async t=>{
  for(const name of ['fixturePreserveMultiSelection','fixtureFocusEditor']) {
    const {window,execute,snapshot,row}=await setup(t);window[name]=true;row.setAttribute('aria-selected','true');
    assert.equal((await execute(command(snapshot))).code,'DELETE_UNAVAILABLE');assert.equal(window.fixtureDeleteKeys,0);assert.equal(window.fixtureDeletionCount,0);
  }
});

test('未观察到移除返回不确定；读回后相同请求也不重新派发删除',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureRejectDeletion=true;
  const result=await execute(command(snapshot));assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(result.dispatched,true);assert.equal(result.cloudConfirmed,false);
  assert.equal(window.fixtureDeleteKeys,1);assert.equal(window.fixtureDeletionCount,0);
  await execute({type:'read'});assert.equal((await execute(command(snapshot))).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureDeleteKeys,1);
});

test('删除后其他事项同时变化时不把部分消失当作准确回执',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.fixtureAfterDelete=()=>{window.document.querySelector('.title [role="textbox"]').textContent='随行验证 · 合成外部更改';};
  assert.equal((await execute(command(snapshot))).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureDeleteKeys,1);
  assert.equal((await execute({...command(snapshot),requestId:'synthetic-second-request'})).code,'STALE_VIEW');
});
