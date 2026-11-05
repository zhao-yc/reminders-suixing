import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { validCommand } from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});
  t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command);
  return {window:dom.window,execute,snapshot:(await execute({type:'read'})).snapshot};
}
function command(snapshot,flagged=true,index=1) {
  const item=snapshot.items[index];
  return {type:'setFlagged',pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,expectedFlagged:item.flagged,flagged};
}

test('旗标按同名事项的记录ID单次设置与取消，不修改日期、备注或完成状态',async t=>{
  const {window,execute,snapshot}=await setup(t);let current=snapshot;
  for(const flagged of [true,false]) {
    const result=await execute(command(current,flagged));
    assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);
    current=result.snapshot;assert.equal(current.items[1].flagged,flagged);assert.equal(current.items[0].flagged,false);
    assert.equal(current.items[1].completed,false);assert.equal(current.items[1].notes,'');
    assert.equal(window.sessionStorage.getItem('fixture-schedule-'+snapshot.items[1].id),null);
  }
  assert.equal(window.fixtureFlagToggleClicks,2);assert.equal(window.fixtureFlagSaves,2);
  assert.equal(window.fixtureScheduleSaveClicks,2);assert.equal(window.fixtureScheduleSaves,0);assert.equal(window.fixtureClicks,0);
});

test('旗标已是目标状态时只读返回，不打开详情或存储',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const result=await execute(command(snapshot,false));
  assert.equal(result.code,'UNCHANGED');assert.equal(result.dispatched,false);
  assert.equal(window.fixtureFlagToggleClicks,0);assert.equal(window.fixtureScheduleSaveClicks,0);
  assert.equal(window.document.querySelector('.details-popover'),null);
});

test('旗标格结构缺失、重复或未知时不可用，不猜测为未加旗标',async t=>{
  const {window,execute,snapshot}=await setup(t);const row=window.document.getElementById(snapshot.items[1].id);
  for(const html of ['','<div class="flag-container" role="gridcell"></div><div class="flag-container" role="gridcell"></div>','<div class="flag-container" role="gridcell"><span class="合成未知图标"></span></div>']) {
    row.querySelectorAll('.flag-container').forEach(node=>node.remove());row.insertAdjacentHTML('beforeend',html);
    const read=await execute({type:'read'});assert.equal(read.snapshot.items[1].flagged,null);
    const change={...command(read.snapshot),expectedFlagged:false};
    assert.equal((await execute(change)).code,'FLAG_UNAVAILABLE');
  }
  assert.equal(window.fixtureFlagToggleClicks,0);assert.equal(window.fixtureScheduleSaveClicks,0);
});

test('页面或旗标变化后旧指纹不可覆盖，其他字段写入也拒绝旧旗标快照',async t=>{
  const {window,execute,snapshot}=await setup(t);const row=window.document.getElementById(snapshot.items[1].id);
  row.querySelector('.flag-container').innerHTML='<div class="flag"></div>';
  assert.equal((await execute(command(snapshot))).code,'STALE_VIEW');
  assert.equal((await execute({...command(snapshot),type:'setCompleted',completed:true})).code,'STALE_VIEW');
  assert.equal(window.fixtureFlagToggleClicks,0);assert.equal(window.fixtureClicks,0);
});

test('官方详情旗标与行状态冲突时取消自己的草稿，不切换或存储',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.document.getElementById(snapshot.items[1].id).querySelector('.info').addEventListener('click',()=>window.document.querySelector('.flag-edit-button').setAttribute('aria-pressed','true'));
  const result=await execute(command(snapshot));assert.equal(result.code,'STALE_VIEW');assert.equal(result.dispatched,false);
  assert.equal(window.fixtureFlagToggleClicks,0);assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureScheduleCancels,1);
});

test('不覆盖已有编辑窗口，重复事项或歧义旗标入口保留官方编辑',async t=>{
  const {window,execute,snapshot}=await setup(t);const button=window.document.getElementById(snapshot.items[1].id).querySelector('.info');
  button.click();assert.equal((await execute(command(snapshot))).code,'EDIT_UNAVAILABLE');
  assert.equal(window.fixtureScheduleCancels,0);window.document.querySelector('.secondary').click();
  button.addEventListener('click',()=>{const node=window.document.createElement('div');node.className='repeat-info';window.document.querySelector('.reminder-item-details').append(node);},{once:true});
  assert.equal((await execute(command(snapshot))).code,'FLAG_UNAVAILABLE');
  const read=await execute({type:'read'});
  button.addEventListener('click',()=>{const node=window.document.querySelector('.flag-edit-button');node.after(node.cloneNode(true));},{once:true});
  assert.equal((await execute(command(read.snapshot))).code,'FLAG_UNAVAILABLE');
  assert.equal(window.fixtureFlagToggleClicks,0);assert.equal(window.fixtureScheduleSaveClicks,0);
});

test('网页不确认旗标草稿时只切换一次，不换方式或重放',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureFlagRejectToggle=true;
  const change=command(snapshot);assert.equal((await execute(change)).code,'UNCERTAIN_WRITE');
  assert.equal(window.fixtureFlagToggleClicks,1);assert.equal(window.fixtureScheduleSaveClicks,0);
  assert.equal((await execute(change)).code,'STALE_VIEW');assert.equal(window.fixtureFlagToggleClicks,1);
});

test('存储未结束时返回不确定，重新读取也不会再次保存已有草稿',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureScheduleDisableSave=true;
  const result=await execute(command(snapshot));assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(result.cloudConfirmed,false);
  assert.equal(window.fixtureScheduleSaveClicks,1);assert.equal(window.fixtureFlagSaves,0);
  const read=await execute({type:'read'});
  assert.equal((await execute(command(read.snapshot))).code,'EDIT_UNAVAILABLE');assert.equal(window.fixtureScheduleSaveClicks,1);
});

test('旗标草稿期间原事项被外部改名时不存储或补偿覆盖',async t=>{
  const {window,execute,snapshot}=await setup(t);const row=window.document.getElementById(snapshot.items[1].id);
  row.querySelector('.info').addEventListener('click',()=>window.document.querySelector('.flag-edit-button').addEventListener('click',()=>{row.querySelector('.title [role="textbox"]').textContent='随行验证 · 合成外部改名';}));
  assert.equal((await execute(command(snapshot))).code,'UNCERTAIN_WRITE');
  assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(row.querySelector('.title [role="textbox"]').textContent,'随行验证 · 合成外部改名');
});

test('旗标协议只接受布尔目标与当前记录指纹，非法参数不打开详情',async t=>{
  const {window,execute,snapshot}=await setup(t);const change=command(snapshot);
  assert.equal(validCommand(change),true);
  for(const invalid of [{...change,flagged:'true'},{...change,expectedFlagged:null},{...change,id:''}]) assert.equal(validCommand(invalid),false);
  assert.equal((await execute({...change,flagged:'true'})).code,'INVALID_COMMAND');
  assert.equal(window.fixtureFlagToggleClicks,0);assert.equal(window.fixtureScheduleSaveClicks,0);
});
