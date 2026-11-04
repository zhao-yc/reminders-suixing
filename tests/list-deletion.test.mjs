import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot;
  return {window:dom.window,execute,snapshot};
}
function command(snapshot) {
  const list=snapshot.lists.find(list=>list.id===snapshot.activeListId);
  return {type:'deleteList',pageId:snapshot.pageId,listId:list.id,expectedListFingerprint:list.fingerprint,confirmed:true,requestId:'synthetic-list-delete-once'};
}

test('同名清单仅删除当前句柄，官方菜单与确认各一次，忽略测量副本并要求重新选择',async t=>{
  const {window,execute,snapshot}=await setup(t);const result=await execute(command(snapshot));
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);assert.equal(result.needsListSelection,true);
  assert.equal(result.snapshot.activeListId,null);assert.equal(result.snapshot.items.length,0);assert.equal(result.snapshot.lists.length,1);assert.equal(result.snapshot.lists[0].fingerprint,snapshot.lists[1].fingerprint);
  assert.equal(window.fixtureListDeleteMenus,1);assert.equal(window.fixtureListDeleteCommits,1);assert.equal(window.fixtureListDeleteCancels,0);
  assert.equal((await execute(command(snapshot))).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureListDeleteCommits,1);
});

test('删除后和只读清单导航均不自动读取官方页面改选的其他事项',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.fixtureAfterListDelete=()=>{const row=window.document.querySelector('.reminder-item');row.querySelector=()=>{assert.fail('不得自动读取其他清单事项');};};
  assert.equal((await execute(command(snapshot))).code,'WEB_STATE_OBSERVED');
  const navigation=await execute({type:'readLists'});assert.equal(navigation.ok,true);assert.equal(navigation.snapshot.items.length,0);assert.equal(navigation.snapshot.activeListId,null);
});

test('没有明确确认、合法请求或当前清单指纹时不打开删除菜单',async t=>{
  const {window,execute,snapshot}=await setup(t);
  for(const changes of [{confirmed:false},{requestId:''},{expectedListFingerprint:''}]) {
    const request={...command(snapshot),...changes};assert.equal(validCommand(request),false);assert.equal((await execute(request)).code,'INVALID_COMMAND');
  }
  assert.equal(validCommand(command(snapshot)),true);assert.equal(validCommand({type:'readLists'}),true);
  assert.equal(window.fixtureListDeleteMenus,0);
});

test('本地确认后清单改名或页面变化时，旧请求不提交',async t=>{
  const {window,execute,snapshot}=await setup(t);
  assert.equal((await execute({...command(snapshot),pageId:'old-page'})).code,'STALE_VIEW');
  window.document.querySelector('.inline-editable-label').textContent='随行验证 · 外部改名';
  assert.equal((await execute(command(snapshot))).code,'STALE_VIEW');assert.equal(window.fixtureListDeleteMenus,0);
});

test('共享清单或确认标题不匹配时只取消自己的确认，不点击删除',async t=>{
  for(const shared of [true,false]) {
    const {window,execute,snapshot}=await setup(t);window.fixtureListShared=shared;
    if(!shared)window.document.querySelector('[data-action="delete-list"]').addEventListener('click',()=>{window.document.querySelector('[role="alertdialog"] h1').textContent='删除列表“随行验证 · 另一份清单”？';});
    assert.equal((await execute(command(snapshot))).code,'LIST_DELETE_UNAVAILABLE');assert.equal(window.fixtureListDeleteCommits,0);assert.equal(window.fixtureListDeleteCancels,1);
  }
});

test('已有官方弹窗或文字编辑时不接管、不失焦保存',async t=>{
  for(const editing of [true,false]) {
    const {window,execute,snapshot}=await setup(t);
    if(editing)window.document.querySelector('.title [role="textbox"]').focus();
    else window.document.body.insertAdjacentHTML('beforeend','<div role="alertdialog"><button>取消</button></div>');
    assert.equal((await execute(command(snapshot))).code,'EDIT_UNAVAILABLE');assert.equal(window.fixtureListDeleteMenus,0);assert.equal(window.fixtureTextBlurs,0);
  }
});

test('删除按钮重复或禁用时不猜测目标确认按钮',async t=>{
  for(const duplicate of [true,false]) {
    const {window,execute,snapshot}=await setup(t);
    window.document.querySelector('[data-action="delete-list"]').addEventListener('click',()=>{const button=window.document.querySelector('ui-alert-footer > .destructive');if(duplicate)button.after(button.cloneNode(true));else button.disabled=true;});
    assert.equal((await execute(command(snapshot))).code,'LIST_DELETE_UNAVAILABLE');assert.equal(window.fixtureListDeleteCommits,0);assert.equal(window.fixtureListDeleteCancels,1);
  }
});

test('官方确认提交后没有回执则停下，同一请求在读取后也不重放',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureListDeleteReject=true;
  const result=await execute(command(snapshot));assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(result.dispatched,true);assert.equal(window.fixtureListDeleteCommits,1);
  await execute({type:'readLists'});assert.equal((await execute(command(snapshot))).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureListDeleteMenus,1);assert.equal(window.fixtureListDeleteCommits,1);
});

test('其他清单同时变化时，不把目标消失提升为精确删除回执',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.fixtureAfterListDelete=()=>{window.document.querySelector('.inline-editable-label').textContent='随行验证 · 并发改名';};
  assert.equal((await execute(command(snapshot))).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureListDeleteCommits,1);
});

test('删除最后一份清单后保持已识别的空账户，可从空状态新建第一份清单',async t=>{
  const {window,execute}=await setup(t);window.document.querySelectorAll('[role="treeitem"]')[1].remove();
  const one=(await execute({type:'read'})).snapshot,result=await execute(command(one));
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.snapshot.emptyAccount,true);assert.equal(result.snapshot.lists.length,0);
  const created=await execute({type:'createList',pageId:result.snapshot.pageId,listId:'',expectedListFingerprint:'empty-list-set',value:'随行验证 · 第一份清单',requestId:'synthetic-create-from-empty'});
  assert.equal(created.code,'WEB_STATE_OBSERVED');assert.equal(created.snapshot.lists.length,1);assert.equal(created.snapshot.activeListTitle,'随行验证 · 第一份清单');
});

test('首次空账户没有树控件时仍能识别，清单导航读取清除旧事项写权限',async t=>{
  const {window,execute,snapshot}=await setup(t);await execute({type:'readLists'});
  const item=snapshot.items[0];assert.equal((await execute({type:'setCompleted',pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,completed:true})).code,'STALE_VIEW');
  window.document.querySelector('[role="tree"]').remove();window.document.querySelector('[role="treegrid"]').innerHTML='';window.document.body.insertAdjacentHTML('beforeend','<div class="no-lists-note"></div>');
  const empty=await execute({type:'read'});assert.equal(empty.ok,true);assert.equal(empty.snapshot.emptyAccount,true);
  assert.equal((await execute({type:'createList',pageId:empty.snapshot.pageId,listId:'',expectedListFingerprint:'empty-list-set',value:'随行验证 · 空账户新增',requestId:'synthetic-first-list'})).ok,true);
});
