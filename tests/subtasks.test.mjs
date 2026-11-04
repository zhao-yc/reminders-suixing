import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';
const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t,parents={},extra=false){
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});t.after(()=>dom.window.close());const win=dom.window;
  if(extra)win.sessionStorage.setItem('fixture-created-one',JSON.stringify([{id:'reminder-item-extra',title:'随行验证 · 合成后续子项'}]));
  win.sessionStorage.setItem('fixture-parents',JSON.stringify(parents));win.renderFixture('one');win.eval(source);
  const execute=command=>win.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot;
  return {window:win,execute,snapshot};
}
function command(snapshot,index=1,direction='indent'){
  const item=snapshot.items[index];return {type:'getSubtaskInfo',pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,direction};
}
function write(command,info,requestId='synthetic-subtask-once'){return {...command,type:'setSubtask',confirmed:true,expectedHierarchyFingerprint:info.subtask.hierarchyFingerprint,requestId};}

test('子事项预检只打开并取消详情、形成唯一单选，不发送层级键或字段写入',async t=>{
  const {window,execute,snapshot}=await setup(t),request=command(snapshot),info=await execute(request);
  assert.equal(validCommand(request),true);assert.equal(info.code,'SUBTASK_READY');assert.equal(info.dispatched,false);assert.equal(info.subtask.affectedCount,1);
  assert.equal(info.subtask.parentTitle,snapshot.items[0].title);assert.equal(window.fixtureSubtaskKeys || 0,0);assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureTextInputs,0);
  assert.equal(window.document.querySelectorAll('.reminder-item[aria-selected="true"]').length,1);assert.equal(window.document.activeElement.id,request.id);
});

test('普通事项缩进和提升各只发送一次官方键，保持记录、字段与顺序',async t=>{
  const {window,execute,snapshot}=await setup(t),request=command(snapshot),info=await execute(request),change=write(request,info);
  assert.equal(validCommand(change),true);const result=await execute(change);
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);assert.equal(result.snapshot.items[1].parentId,snapshot.items[0].id);assert.equal(result.snapshot.items[1].level,2);
  assert.equal(result.snapshot.items[0].title,snapshot.items[0].title);assert.deepEqual(result.snapshot.items.map(item=>item.id),snapshot.items.map(item=>item.id));assert.equal(window.fixtureSubtaskKeys,1);
  await execute({type:'read'});assert.equal((await execute(change)).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureSubtaskKeys,1);
  const out=command(result.snapshot,1,'outdent'),preflight=await execute(out),restored=await execute(write(out,preflight,'synthetic-outdent-once'));
  assert.equal(restored.code,'WEB_STATE_OBSERVED');assert.equal(restored.snapshot.items[1].level,1);assert.equal(restored.snapshot.items[1].parentId,null);assert.equal(window.fixtureSubtaskKeys,2);
  assert.deepEqual(restored.snapshot.items.map(item=>item.fingerprint),snapshot.items.map(item=>item.fingerprint));assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureTextInputs,0);
});

test('提升包含后续同级子项的影响说明，并精确核对新分组',async t=>{
  const parents={'reminder-item-fixture-one-1':'reminder-item-fixture-one-0','reminder-item-extra':'reminder-item-fixture-one-0'};
  const {execute,snapshot}=await setup(t,parents,true),request=command(snapshot,1,'outdent'),info=await execute(request);
  assert.equal(info.subtask.affectedCount,2);assert.equal(info.subtask.affectedTitles[1],'随行验证 · 合成后续子项');
  const result=await execute(write(request,info));assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.snapshot.items[1].parentId,null);assert.equal(result.snapshot.items[2].parentId,snapshot.items[1].id);assert.equal(result.snapshot.items[2].level,2);
});

test('子项改归其他父项后，即使文字与层级相同也使旧事项指纹失效',async t=>{
  const {window,execute}=await setup(t,{'reminder-item-extra':'reminder-item-fixture-one-0'},true),doc=window.document,extra=doc.getElementById('reminder-item-extra');
  doc.getElementById('reminder-item-fixture-one-1').before(extra);window.applyFixtureHierarchy();const snapshot=(await execute({type:'read'})).snapshot;
  window.sessionStorage.setItem('fixture-parents',JSON.stringify({'reminder-item-extra':'reminder-item-fixture-one-1'}));doc.querySelector('[role="treegrid"]').append(extra);window.applyFixtureHierarchy();
  const old=command(snapshot,1,'outdent');assert.equal((await execute(old)).code,'STALE_VIEW');assert.equal(window.fixtureSubtaskKeys || 0,0);
});

test('首项、已有子项的主事项、跨完成状态及未知/不完整层级均停止',async t=>{
  const {window,execute,snapshot}=await setup(t);assert.equal((await execute(command(snapshot,0))).code,'SUBTASK_UNAVAILABLE');
  window.document.querySelectorAll('.mark-completed')[0].dataset.completed='true';const refreshed=(await execute({type:'read'})).snapshot;
  assert.equal((await execute(command(refreshed))).code,'SUBTASK_UNAVAILABLE');
  window.document.querySelectorAll('.mark-completed')[0].dataset.completed='false';window.document.querySelector('[role="treegrid"]').setAttribute('aria-rowcount','5');
  assert.equal((await execute(command((await execute({type:'read'})).snapshot))).code,'SUBTASK_UNAVAILABLE');assert.equal(window.fixtureSubtaskKeys || 0,0);
});

test('重复父项或目标拒绝层级写入，已有详情不接管',async t=>{
  for(const index of [0,1]){
    const {window,execute,snapshot}=await setup(t);window.document.querySelectorAll('.info')[index].addEventListener('click',()=>{const repeat=window.document.createElement('div');repeat.className='repeat-info';window.document.querySelector('.reminder-item-details').append(repeat);});
    assert.equal((await execute(command(snapshot))).code,'SUBTASK_UNAVAILABLE');assert.equal(window.fixtureSubtaskKeys || 0,0);assert.equal(window.document.querySelector('.details-popover'),null);
  }
  const {window,execute,snapshot}=await setup(t);window.document.body.insertAdjacentHTML('beforeend','<div class="details-popover"></div>');assert.equal((await execute(command(snapshot))).code,'EDIT_UNAVAILABLE');assert.equal(window.fixtureScheduleCancels,0);
});

test('确认后其他内容变化或无法确认排他单选时不发送层级键',async t=>{
  const {window,execute,snapshot}=await setup(t),request=command(snapshot),info=await execute(request);
  window.document.querySelectorAll('.title [role="textbox"]')[0].textContent='随行验证 · 合成外部修改';
  assert.equal((await execute(write(request,info))).code,'STALE_VIEW');assert.equal(window.fixtureSubtaskKeys || 0,0);
  window.fixtureIgnoreSelection=true;const next=command((await execute({type:'read'})).snapshot);
  // 取消旧选区，拒绝把残留单选当作新导航成功。
  window.document.querySelectorAll('.reminder-item').forEach(row=>row.setAttribute('aria-selected','false'));
  assert.equal((await execute(next)).code,'SUBTASK_UNAVAILABLE');assert.equal(window.fixtureSubtaskKeys || 0,0);
});

test('官方未改变层级或同时改变其他字段时返回不确定且去重',async t=>{
  for(const mode of ['reject','concurrent']){
    const {window,execute,snapshot}=await setup(t),request=command(snapshot),info=await execute(request),change=write(request,info);
    if(mode==='reject')window.fixtureRejectSubtask=true;else window.fixtureAfterSubtask=()=>{window.document.querySelectorAll('.title [role="textbox"]')[0].textContent='随行验证 · 合成并发修改';};
    assert.equal((await execute(change)).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureSubtaskKeys,1);await execute({type:'read'});assert.equal((await execute(change)).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureSubtaskKeys,1);
  }
});

test('层级协议拒绝缺少确认、无效方向、空指纹与请求标识',async t=>{
  const {execute,snapshot}=await setup(t),request=command(snapshot),info=await execute(request),change=write(request,info);
  for(const patch of [{confirmed:false},{direction:'move'},{expectedHierarchyFingerprint:''},{requestId:'bad id'}]){assert.equal(validCommand({...change,...patch}),false);assert.equal((await execute({...change,...patch})).code,'INVALID_COMMAND');}
});
