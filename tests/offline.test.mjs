import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t){const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});t.after(()=>dom.window.close());let online=true;Object.defineProperty(dom.window.navigator,'onLine',{get:()=>online,configurable:true});dom.window.eval(source);const execute=command=>dom.window.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot;return {window:dom.window,execute,snapshot,connection(value){online=value;dom.window.dispatchEvent(new dom.window.Event(value?'online':'offline'));}};}
function target(snapshot,type,extra={}){const item=snapshot.items[0];return {type,pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,...extra};}

test('断网时读取和全部写入入口均停止，不触碰 DOM 或伪装成成功',async t=>{
  const {window,execute,connection}=await setup(t);connection(false);
  window.document.querySelector=()=>assert.fail('离线不读取或操作网页内容');
  for(const type of ['read','readLists','readList','getSchedule','setCompleted','setText','createItem','setSchedule','setFlagged','deleteItem','createList','renameList','deleteList','setListAppearance','setSubtask']){
    const result=await execute({type});assert.equal(result.code,'OFFLINE');assert.equal(result.dispatched,false);assert.equal(result.cloudConfirmed,false);assert.equal(result.snapshot,undefined);
  }
});

test('恢复网络不恢复旧页面句柄或自动写入，必须重新读取后明确提交',async t=>{
  const {window,execute,snapshot,connection}=await setup(t),old=target(snapshot,'setCompleted',{completed:true});
  connection(false);connection(true);await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(window.fixtureClicks,0);assert.equal((await execute(old)).code,'STALE_VIEW');
  const fresh=await execute({type:'read'});assert.notEqual(fresh.snapshot.pageId,snapshot.pageId);
  assert.equal((await execute(target(fresh.snapshot,'setCompleted',{completed:true}))).code,'WEB_STATE_OBSERVED');assert.equal(window.fixtureClicks,1);
});

test('联网标志仍为真时，原生层的可达性失败同样使旧句柄失效',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.__suixingAdapter.invalidateConnection();
  assert.equal(window.navigator.onLine,true);
  assert.equal((await execute(target(snapshot,'setCompleted',{completed:true}))).code,'STALE_VIEW');
  assert.equal(window.fixtureClicks,0);assert.notEqual((await execute({type:'read'})).snapshot.pageId,snapshot.pageId);
});

test('指针序列途中断网时停止后续点击，不自动补完完成操作',async t=>{
  const {window,execute,snapshot,connection}=await setup(t);
  window.document.querySelector('.mark-completed').addEventListener('mousedown',()=>connection(false),{once:true});
  const result=await execute(target(snapshot,'setCompleted',{completed:true}));
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(window.fixtureClicks,0);
  connection(true);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(window.fixtureClicks,0);
});

test('旗标草稿中瞬间断网再恢复也不存储，等待过程不会变成迟到重放',async t=>{
  const {window,execute,snapshot,connection}=await setup(t);
  window.document.addEventListener('click',event=>{if(event.target.matches('.flag-edit-button')){connection(false);connection(true);}});
  const result=await execute(target(snapshot,'setFlagged',{expectedFlagged:false,flagged:true}));
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(result.cloudConfirmed,false);
  assert.equal(window.fixtureFlagToggleClicks,1);assert.equal(window.fixtureScheduleSaveClicks,0);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(window.fixtureFlagSaves,0);
});

test('beforeinput 之后断网时不执行文字命令，不失焦触发存储',async t=>{
  const {window,execute,snapshot,connection}=await setup(t);
  window.document.addEventListener('beforeinput',()=>{connection(false);connection(true);},{once:true});
  const result=await execute(target(snapshot,'setText',{field:'title',value:'随行验证 · 离线不写入'}));
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(window.fixtureTextInputs,0);assert.equal(window.fixtureTextSaves,0);
});

test('新增等待中断网会拒绝异步轮询，不重复新增或输入标题',async t=>{
  const {window,execute,snapshot,connection}=await setup(t);
  window.document.querySelector('.rm-new-reminder').addEventListener('click',()=>setTimeout(()=>connection(false),10),{once:true});
  const result=await execute({type:'createItem',pageId:snapshot.pageId,listId:snapshot.activeListId,title:'随行验证 · 离线新增中断',requestId:'offline-create-once'});
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(window.fixtureCreationClicks,1);assert.equal(window.fixtureTextInputs,0);
  connection(true);await new Promise(resolve=>setTimeout(resolve,120));assert.equal(window.fixtureCreationClicks,1);assert.equal(window.fixtureTextInputs,0);
});

test('补发失焦事件途中断网时不继续派发 focusout，也不补偿已发生的保存',async t=>{
  const {window,execute,snapshot,connection}=await setup(t);
  const editor=window.document.querySelector('.title [role="textbox"]');editor.blur=()=>{};let focusouts=0;
  editor.addEventListener('blur',()=>connection(false));editor.addEventListener('focusout',()=>focusouts++);
  const result=await execute(target(snapshot,'setText',{field:'title',value:'随行验证 · 失焦时断网'}));
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(window.fixtureTextInputs,1);assert.equal(window.fixtureTextSaves,1);assert.equal(focusouts,0);
  connection(true);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(window.fixtureTextSaves,1);
});
