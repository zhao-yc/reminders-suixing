import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';
import {listIconURL,appearanceColorLabel} from '../apps/uni-app/lib/list-appearance.js';
const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot,list=snapshot.lists[0];
  const get={type:'getListAppearance',pageId:snapshot.pageId,listId:list.id,expectedListFingerprint:list.fingerprint};
  return {window:dom.window,execute,snapshot,list,get};
}
function write(get,appearance,changes={}) {return {...get,type:'setListAppearance',expectedAppearanceFingerprint:appearance.fingerprint,color:appearance.colors[1].key,iconKey:appearance.icons[2].key,requestId:'synthetic-appearance-once',...changes};}

test('清单外观只读打开并取消，静态图标投影规范化本地引用，不提交名称或完成',async t=>{
  const {window,execute,get,list}=await setup(t),result=await execute(get);
  assert.equal(result.code,'LIST_APPEARANCE_READY');assert.equal(result.dispatched,false);assert.equal(result.appearance.colors.length,3);assert.equal(result.appearance.icons.length,3);
  assert.equal(result.appearance.iconKey,list.icon.key);assert.equal(window.fixtureListSaves,0);assert.equal(window.fixtureListInputs,0);assert.equal(window.fixtureListCancels,1);
  const projected=result.appearance.icons[2].icon;assert.match(projected.svg,/href="#shape-0"/);assert.doesNotMatch(projected.svg,/synthetic-original|xlink:href/);assert.match(listIconURL(projected),/^data:image\/svg\+xml/);
});

test('颜色和含本地引用图标各选一次，完成一次，其他清单及事项指纹保持',async t=>{
  const {window,execute,get,snapshot}=await setup(t),appearance=(await execute(get)).appearance,command=write(get,appearance);
  assert.equal(validCommand(command),true);const result=await execute(command);
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);assert.equal(result.snapshot.lists[0].color,command.color);assert.equal(result.snapshot.lists[0].icon.key,command.iconKey);
  assert.equal(result.snapshot.lists[1].fingerprint,snapshot.lists[1].fingerprint);assert.deepEqual(result.snapshot.items.map(x=>x.fingerprint),snapshot.items.map(x=>x.fingerprint));
  assert.equal(window.fixtureAppearanceClicks,2);assert.equal(window.fixtureListSaves,1);assert.equal(window.fixtureListInputs,0);
  await execute({type:'read'});assert.equal((await execute(command)).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureListSaves,1);
});

test('相同外观仅取消官方信息，不点击选项或完成',async t=>{
  const {window,execute,get}=await setup(t),appearance=(await execute(get)).appearance;
  assert.equal((await execute(write(get,appearance,{color:appearance.color,iconKey:appearance.iconKey}))).code,'UNCHANGED');assert.equal(window.fixtureAppearanceClicks || 0,0);assert.equal(window.fixtureListSaves,0);
});

test('图标变动进入清单指纹，旧名称与外观写请求均拒绝',async t=>{
  const {window,execute,get}=await setup(t);window.document.querySelector('.reminder-list-icon path').setAttribute('d','M1 1L5 5Z');
  assert.equal((await execute(get)).code,'STALE_VIEW');assert.equal(window.fixtureListSaves,0);
  assert.equal((await execute({...get,type:'renameList',value:'随行验证 · 合成改名',requestId:'synthetic-name'})).code,'STALE_VIEW');
});

test('未知或外链 SVG、事件属性、脚本及重复本地 ID 均不投影、不改选',async t=>{
  for(const content of ['<image href="https://example.invalid/private"/>','<path d="M0 0" onclick="alert(1)"/>','<script>synthetic-private</script>','<defs><path id="a" d="M0 0"/><path id="a" d="M1 1"/></defs>','<use href="#missing"/>','<g style="fill:url(https://example.invalid)"><path d="M0 0"/></g>']) {
    const {window,execute,get}=await setup(t);window.fixtureAfterAppearanceOpen=panel=>{panel.querySelector('.badge-emblem-picker .picker-grid-item svg').innerHTML=content;};
    const result=await execute(get);assert.equal(result.code,'LIST_APPEARANCE_UNAVAILABLE');assert.equal(window.fixtureListSaves,0);assert.equal(window.fixtureAppearanceClicks || 0,0);
    assert.doesNotMatch(JSON.stringify(result),/example.invalid|synthetic-private|onclick/);
  }
});

test('选项变动或非法目标不保存，不以位置猜测新选项',async t=>{
  const {window,execute,get}=await setup(t),appearance=(await execute(get)).appearance;
  const invalid=write(get,appearance,{expectedAppearanceFingerprint:'changed-options'});
  assert.equal((await execute(invalid)).code,'STALE_VIEW');assert.equal(window.fixtureListSaves,0);assert.equal(window.fixtureAppearanceClicks || 0,0);
  for(const changes of [{color:'https://example.invalid'},{iconKey:'other'},{requestId:'bad id'},{expectedAppearanceFingerprint:''}])assert.equal(validCommand(write(get,appearance,changes)),false);
});

test('官方拒绝选项及保存后无回执均不重放同一请求',async t=>{
  for(const reject of ['fixtureAppearanceReject','fixtureListRejectDone']){
    const {window,execute,get}=await setup(t),appearance=(await execute(get)).appearance,command=write(get,appearance);window[reject]=true;
    assert.equal((await execute(command)).code,'UNCERTAIN_WRITE');const clicks=window.fixtureAppearanceClicks,saves=window.fixtureListSaves;
    await execute({type:'read'});assert.equal((await execute(command)).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureAppearanceClicks,clicks);assert.equal(window.fixtureListSaves,saves);
  }
});

test('外观保存不把其他清单并发改名当作准确回执',async t=>{
  const {window,execute,get}=await setup(t),appearance=(await execute(get)).appearance;
  window.fixtureAfterListSave=()=>{window.document.querySelectorAll('.inline-editable-label')[1].textContent='随行验证 · 合成并发';};
  assert.equal((await execute(write(get,appearance))).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureListSaves,1);
});

test('颜色名称与图片入口不接受外部网址或过长图片',()=>{
  assert.equal(appearanceColorLabel('rgb(255, 59, 48)',0),'红色');assert.equal(appearanceColorLabel('rgb(1, 2, 3)',2),'颜色 3');
  assert.equal(listIconURL({svg:'https://example.invalid'}),'');assert.equal(listIconURL({svg:'a'.repeat(60001)}),'');
});
