import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js', import.meta.url), 'utf8');
const fixture = await fs.readFile(new URL('./fixtures/reminders.html', import.meta.url), 'utf8');
function setup(t) {
  const dom = new JSDOM(fixture, { url:'https://www.icloud.com.cn/reminders/', runScripts:'dangerously' });
  dom.window.eval(source);
  t.after(()=>dom.window.close());
  return { window:dom.window, execute:command=>dom.window.__suixingAdapter.execute(command) };
}
function creation(snapshot, requestId='create-test-one', title='随行验证 · 新增合成事项') {
  return { type:'createItem', pageId:snapshot.pageId, listId:snapshot.activeListId, requestId, title };
}
test('新增只激活一次并填写本次空事项，同名旧事项保持不变且不能重放请求', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  const command=creation(snapshot,undefined,snapshot.items[0].title);
  const insert=window.document.execCommand;
  window.document.execCommand=(...args)=>{ assert.equal(window.fixtureCreationReady,true,'不能在官方创建事务结束前输入'); return insert(...args); };
  const result=await execute(command);
  assert.equal(result.code,'WEB_STATE_OBSERVED');
  assert.equal(result.cloudConfirmed,false);
  assert.equal(result.snapshot.items.length,3);
  assert.equal(result.snapshot.items[0].fingerprint,snapshot.items[0].fingerprint);
  assert.notEqual(result.snapshot.items[2].id,snapshot.items[0].id);
  assert.equal(result.snapshot.items[2].title,command.title);
  assert.equal(window.fixtureCreationClicks,1);
  assert.equal(window.fixtureTextSaves,1);
  await execute({type:'read'});
  assert.equal((await execute(command)).code,'ALREADY_SUBMITTED');
  assert.equal(window.fixtureCreationClicks,1);
});
test('没有读取、旧页面、错误清单或非法参数均不点击新增', async t => {
  const {execute,window}=setup(t);
  assert.equal((await execute({type:'createItem',title:'随行验证',requestId:'test'})).code,'STALE_VIEW');
  const {snapshot}=await execute({type:'read'});
  for(const patch of [{pageId:'old'}, {listId:'other'}, {title:''}, {title:'a\nb'}, {title:'x'.repeat(1001)}, {requestId:'../x'}]) assert.equal((await execute({...creation(snapshot),...patch})).ok,false);
  assert.equal(window.fixtureCreationClicks,0);
});
test('自定义新增控件仅点击其原生按钮一次，不激活外围手势', async t => {
  const {execute,window}=setup(t);
  const button=window.document.querySelector('.rm-new-reminder');
  const wrapper=window.document.createElement('ui-button');
  wrapper.className=button.className;wrapper.setAttribute('role','button');
  button.className='';button.type='button';button.before(wrapper);wrapper.append(button);
  let outerGestures=0;
  wrapper.addEventListener('mousedown',()=>outerGestures++);
  const {snapshot}=await execute({type:'read'});
  assert.equal((await execute(creation(snapshot))).code,'WEB_STATE_OBSERVED');
  assert.equal(window.fixtureCreationClicks,1);
  assert.equal(outerGestures,0);
});
test('已有空白草稿、禁用按钮或不支持原生输入时不创建', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  const button=window.document.querySelector('.rm-new-reminder');
  button.disabled=true;
  assert.equal((await execute(creation(snapshot))).code,'READ_ONLY');
  button.disabled=false;
  window.document.queryCommandSupported=()=>false;
  assert.equal((await execute(creation(snapshot))).code,'EDIT_UNAVAILABLE');
  window.document.queryCommandSupported=()=>true;
  window.document.querySelector('.title [role="textbox"]').textContent='';
  assert.equal((await execute(creation(snapshot))).code,'DRAFT_OPEN');
  assert.equal(window.fixtureCreationClicks,0);
});
test('点击后未出现新事项时返回未知；重新读取也不能重放原请求', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  window.fixtureDisableCreation=true;
  const command=creation(snapshot);
  assert.equal((await execute(command)).code,'UNCERTAIN_WRITE');
  assert.equal(window.fixtureCreationClicks,1);
  await execute({type:'read'});
  assert.equal((await execute(command)).code,'ALREADY_SUBMITTED');
  assert.equal(window.fixtureCreationClicks,1);
});
test('同时出现多个新事项时不得猜测目标或填写任何一个', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  window.fixtureCreationCopies=2;
  assert.equal((await execute(creation(snapshot))).code,'UNCERTAIN_WRITE');
  assert.equal(window.fixtureCreationClicks,1);
  assert.equal(window.fixtureTextInputs,0);
  assert.equal(window.fixtureTextSaves,0);
});
