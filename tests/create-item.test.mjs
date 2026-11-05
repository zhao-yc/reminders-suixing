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

test('已观察的新增保留官方输入焦点时可继续后台只读，不失焦且不扩大到弹层',async t=>{
  const {execute,window}=setup(t),before=await execute({type:'read'}),created=await execute(creation(before.snapshot));
  const editor=window.document.activeElement,row=editor.closest('.reminder-item');row.setAttribute('data-edit','true');editor.setAttribute('data-edit','true');
  const command={type:'readList',pageId:created.snapshot.pageId,listId:created.snapshot.activeListId,background:true};
  const read=await execute(command);assert.equal(read.code,'READY');assert.equal(window.document.activeElement,editor);assert.equal(window.fixtureEarlyCreationBlurs,0);assert.equal(window.fixtureCreationClicks,1);
  const panel=window.document.createElement('div');panel.setAttribute('role','dialog');row.append(panel);assert.equal((await execute(command)).code,'AUTO_READ_DEFERRED');panel.remove();assert.equal((await execute(command)).code,'READY');
});

test('新增字段再次输入或开始输入法合成便撤销后台只读放行',async t=>{
  for(const event of ['beforeinput','input','compositionstart']) {
    const {execute,window}=setup(t),before=await execute({type:'read'}),created=await execute(creation(before.snapshot));
    const editor=window.document.activeElement;editor.dispatchEvent(new window.Event(event,{bubbles:true}));
    assert.equal((await execute({type:'readList',pageId:created.snapshot.pageId,listId:created.snapshot.activeListId,background:true})).code,'AUTO_READ_DEFERRED',event);assert.equal(window.fixtureEarlyCreationBlurs,0);
  }
});

test('新增字段不匹配及连接失效后不借用旧放行',async t=>{
  const {execute,window}=setup(t),before=await execute({type:'read'}),created=await execute(creation(before.snapshot));
  const editor=window.document.activeElement,command={type:'readList',pageId:created.snapshot.pageId,listId:created.snapshot.activeListId,background:true};
  editor.textContent='随行验证 · 外部变化';assert.equal((await execute(command)).code,'AUTO_READ_DEFERRED');editor.textContent='随行验证 · 新增合成事项';
  window.__suixingAdapter.invalidateConnection();const fresh=await execute({type:'read'});assert.equal((await execute({...command,pageId:fresh.snapshot.pageId,listId:fresh.snapshot.activeListId})).code,'AUTO_READ_DEFERRED');
});
test('新增只激活一次并填写本次空事项，同名旧事项保持不变且不能重放请求', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  const command=creation(snapshot,undefined,snapshot.items[0].title);
  const insert=window.document.execCommand;
  window.document.execCommand=(...args)=>{ assert.equal(window.fixtureCreationReady,true,'不能在官方创建事务结束前输入'); return insert(...args); };
  const result=await execute(command);
  assert.equal(result.code,'WEB_STATE_OBSERVED');
  assert.equal(result.stage,'observed');
  assert.equal(result.cloudConfirmed,false);
  assert.equal(result.snapshot.items.length,3);
  assert.equal(result.snapshot.items[0].fingerprint,snapshot.items[0].fingerprint);
  assert.notEqual(result.snapshot.items[2].id,snapshot.items[0].id);
  assert.equal(result.snapshot.items[2].title,command.title);
  assert.equal(window.fixtureCreationClicks,1);
  assert.equal(window.fixtureTextBlurs,0,'新事项等待网页自动保存，不强制失焦');
  for(let attempt=0;attempt<20&&window.fixtureTextSaves!==1;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(window.fixtureTextSaves,1);
  assert.equal(window.fixtureCreationAutosaves,1);
  assert.equal(window.fixtureEarlyCreationBlurs,0);
  assert.equal(window.sessionStorage.getItem('fixture-text-'+result.snapshot.items[2].id+'-title'),command.title);
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
  const result=await execute(command);
  assert.equal(result.code,'UNCERTAIN_WRITE');
  assert.equal(result.stage,'waiting-draft');
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

test('已打开新草稿后输入异常，回执保留失败阶段且原请求不得重放', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  let inputs=0;
  window.document.execCommand=()=>{inputs++;throw Error('合成文字命令失败');};
  const command=creation(snapshot);
  const result=await execute(command);
  assert.equal(result.code,'UNCERTAIN_WRITE');
  assert.equal(result.stage,'input-command');
  assert.equal(window.fixtureCreationClicks,1);
  assert.equal(inputs,1);
  assert.equal(window.fixtureTextSaves,0);
  await execute({type:'read'});
  assert.equal((await execute(command)).code,'ALREADY_SUBMITTED');
  assert.equal(inputs,1);
});

test('主动开启的阶段回执不包含标题、请求标识或新记录标识', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  const messages=[];
  window.__suixingDiagnosticPhases=true;
  window.__suixingDiagnosticWriteSequence=42;
  window.console.info=message=>messages.push(message);
  const result=await execute(creation(snapshot,'synthetic-private-request','随行验证 · synthetic-private-title'));
  assert.equal(result.ok,true);
  assert.deepEqual(messages,['preflight','waiting-draft','writing-title','input-command','input-accepted','input-settled','awaiting-autosave','observing-title','observed'].map(stage=>'suixing-create-stage:42:'+stage));
  assert.doesNotMatch(JSON.stringify(messages),/synthetic|fixture|随行验证/);
});

test('新增输入被网页取消时保留取消阶段，不再执行文字命令或继续核对标题', async t => {
  const {execute,window}=setup(t);
  const {snapshot}=await execute({type:'read'});
  window.document.addEventListener('beforeinput',event=>event.preventDefault());
  window.document.execCommand=()=>{assert.fail('网页取消后不得继续执行文字命令');};
  const result=await execute(creation(snapshot));
  assert.equal(result.code,'UNCERTAIN_WRITE');
  assert.equal(result.stage,'input-cancelled');
  assert.equal(window.fixtureCreationClicks,1);
  assert.equal(window.fixtureTextSaves,0);
});
